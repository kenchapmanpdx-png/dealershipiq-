// POST /api/app/auth — Phone-based authentication for employee PWA
// Verifies phone + last 4 digits, sets HttpOnly session cookie
// Phase 4.5A
// C-003: Phone token auth — no JWT, creates session token for PWA
// 2026-04-18 C-2: Cookie is now set server-side with HttpOnly; Secure; SameSite=Lax.
//   Max-Age aligned with the 7-day token expiresAt. Previously the cookie was
//   set from client JS (document.cookie), so any XSS in the PWA meant a 7-day
//   token-theft window.
// 2026-04-18 H-17: Error messages normalized — both "no user" and "bad last-4"
//   return "Invalid credentials" to prevent username enumeration across tenants.

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { serviceClient } from '@/lib/supabase/service';
import { isValidE164 } from '@/lib/sms';
import { checkAuthAttemptLimit } from '@/lib/rate-limit';
import { log } from '@/lib/logger';
import { requireJsonContentType } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_COOKIE_NAME = 'diq_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days — matches token expiresAt

/** S3: constant-time equality for fixed-length last-4 digit auth. */
function constantTimeEqualLast4(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 4 || b.length !== 4) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// D2-M-002: Dedicated secret for coach tokens. No CRON_SECRET fallback.
function getAuthSecret(): string {
  const secret = process.env.APP_TOKEN_SECRET;
  if (!secret) {
    throw new Error('APP_TOKEN_SECRET must be set');
  }
  return secret;
}

// 2026-04-18 L-15: Removed in-memory `authAttempts` Map + helpers. Upstash
// `checkAuthAttemptLimit` is the shared-state primary limiter across every
// Vercel instance (see src/lib/rate-limit.ts). The in-memory belt was
// per-lambda and scaled with fleet size rather than containing it, plus it
// only fired AFTER the Upstash gate already passed — so it added no defense
// in depth, only cleanup cost at 10k entries. A single source of truth is
// easier to reason about and fails closed in production if Upstash is down.

// H-17: Generic error response used for every "bad credentials" outcome so
// attackers can't distinguish "user exists, wrong last-4" from "no such user".
function invalidCredentialsResponse(): NextResponse {
  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  try {
    // L-14: content-type gate
    const ctErr = requireJsonContentType(request);
    if (ctErr) return ctErr;

    const { phone, last_four, dealership_slug } = await request.json();

    if (!phone || !last_four || last_four.length !== 4) {
      return NextResponse.json(
        { error: 'Phone and last 4 digits required' },
        { status: 400 }
      );
    }

    // Normalize phone: strip spaces, dashes, parens; ensure E.164
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '');
    if (!normalized.startsWith('+')) {
      if (normalized.startsWith('1') && normalized.length === 11) {
        normalized = '+' + normalized;
      } else if (normalized.length === 10) {
        normalized = '+1' + normalized;
      } else {
        normalized = '+' + normalized;
      }
    }

    // Validate E.164 format after normalization
    if (!isValidE164(normalized)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      );
    }

    // S6 / L-15: Rate limit by phone via Upstash. Single source of truth —
    // shared across every Vercel instance, fails closed in production if
    // Upstash is unreachable (see `checkAuthAttemptLimit`).
    const upstashGate = await checkAuthAttemptLimit(normalized);
    if (!upstashGate.success) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        { status: 429 }
      );
    }

    // S3: constant-time comparison. Previously used `endsWith`, which leaks
    // information via per-character timing differences under statistical
    // sampling. The helper enforces 4-digit length on both sides.
    const expectedLast4 = normalized.slice(-4);
    if (!constantTimeEqualLast4(expectedLast4, String(last_four ?? ''))) {
      return invalidCredentialsResponse();
    }

    // H6: Look up user by canonical E.164 phone only. Previously this
    // retried without the "+" prefix to paper over write-time normalization
    // drift; that masked the real bug instead of fixing it. After the C7
    // consolidation every writer stores `+E164`, so the retry is obsolete.
    const { data: user, error: userError } = await serviceClient
      .from('users')
      .select('id, full_name, language, status')
      .eq('phone', normalized)
      .single();

    if (userError || !user) {
      return invalidCredentialsResponse();
    }

    // H-16 component: reject deactivated users at auth time (defense in depth —
    // authenticateRep also re-checks on each request).
    if (user.status !== 'active' && user.status !== 'pending_consent') {
      log.warn('app.auth.inactive_user', { user_id: user.id, status: user.status });
      return invalidCredentialsResponse();
    }

    return await createSessionResponse(user, dealership_slug);
  } catch (err) {
    log.error('app.auth.unexpected_error', { error: (err as Error).message });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function createSessionResponse(
  user: Record<string, unknown>,
  dealershipSlug: string
) {
  const userId = user.id as string;
  const firstName = ((user.full_name as string) ?? '').split(' ')[0] || 'there';
  const language = (user.language as string) ?? 'en';

  // B-002 fix: Verify user belongs to the dealership identified by slug
  const { data: dealership } = await serviceClient
    .from('dealerships')
    .select('id')
    .eq('slug', dealershipSlug)
    .single();

  if (!dealership) {
    // H-17: Normalize — don't leak "dealership not found" vs "no membership".
    return invalidCredentialsResponse();
  }

  const { data: membership } = await serviceClient
    .from('dealership_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('dealership_id', dealership.id)
    .maybeSingle();

  if (!membership) {
    // H-17: Normalize — don't leak "exists but not a member".
    return invalidCredentialsResponse();
  }

  const dealershipId = dealership.id as string;

  // Create HMAC-signed session token
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000; // 7 days
  const secret = getAuthSecret();

  const payload = {
    userId,
    dealershipId,
    firstName,
    language,
    expiresAt,
  };

  const payloadStr = JSON.stringify(payload);
  const signature = createHmac('sha256', secret).update(payloadStr).digest('hex');

  const tokenData = {
    ...payload,
    sig: signature,
  };

  const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');

  // C-2: Session info returned to client in body for immediate hydration;
  // the bearer token itself is stored ONLY in the HttpOnly cookie so XSS
  // cannot exfiltrate it via document.cookie.
  const res = NextResponse.json({
    userId,
    dealershipId,
    firstName,
    language,
    first_name: firstName, // backward-compat for existing callers
  });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });

  return res;
}
