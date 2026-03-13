// POST /api/app/auth — Phone-based authentication for employee PWA
// Verifies phone + last 4 digits, returns session token
// Phase 4.5A

import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { serviceClient } from '@/lib/supabase/service';

// S-001: Fail-closed — reject all auth if no signing secret configured
function getAuthSecret(): string {
  const secret = process.env.APP_AUTH_SECRET || process.env.CRON_SECRET;
  if (!secret) {
    throw new Error('APP_AUTH_SECRET or CRON_SECRET must be set');
  }
  return secret;
}

// S-002: In-memory rate limit for PWA auth (brute-force protection)
const authAttempts = new Map<string, { count: number; blockedUntil: number }>();
const AUTH_MAX_ATTEMPTS = 5;
const _AUTH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_BLOCK_MS = 15 * 60 * 1000; // 15 minute lockout

function checkAuthRateLimit(phone: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(phone);

  if (entry && entry.blockedUntil > now) {
    return false; // Still blocked
  }

  if (!entry || entry.blockedUntil <= now) {
    // Reset if block expired
    if (entry && entry.blockedUntil <= now) {
      authAttempts.set(phone, { count: 1, blockedUntil: 0 });
    }
    return true;
  }

  return true;
}

function recordAuthAttempt(phone: string, success: boolean): void {
  const now = Date.now();
  if (success) {
    authAttempts.delete(phone);
    return;
  }

  const entry = authAttempts.get(phone) || { count: 0, blockedUntil: 0 };
  entry.count += 1;

  if (entry.count >= AUTH_MAX_ATTEMPTS) {
    entry.blockedUntil = now + AUTH_BLOCK_MS;
    entry.count = 0;
  }

  authAttempts.set(phone, entry);

  // Cleanup old entries periodically
  if (authAttempts.size > 10000) {
    authAttempts.forEach((val, key) => {
      if (val.blockedUntil < now && val.count === 0) authAttempts.delete(key);
    });
  }
}

export async function POST(request: NextRequest) {
  try {
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

    // S-002: Rate limit by phone number
    if (!checkAuthRateLimit(normalized)) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        { status: 429 }
      );
    }

    // Verify last 4 digits match
    if (!normalized.endsWith(last_four)) {
      recordAuthAttempt(normalized, false);
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Look up user by phone
    const { data: user, error: userError } = await serviceClient
      .from('users')
      .select('id, full_name, language, dealership_id, status')
      .eq('phone', normalized)
      .single();

    if (userError || !user) {
      // Try alternate format without +
      const alt = normalized.replace(/^\+/, '');
      const { data: user2 } = await serviceClient
        .from('users')
        .select('id, full_name, language, dealership_id, status')
        .eq('phone', alt)
        .single();

      if (!user2) {
        recordAuthAttempt(normalized, false);
        return NextResponse.json({ error: 'User not found' }, { status: 401 });
      }

      recordAuthAttempt(normalized, true);
      return await createSessionResponse(user2, dealership_slug);
    }

    recordAuthAttempt(normalized, true);
    return await createSessionResponse(user, dealership_slug);
  } catch (err) {
    console.error('Auth error:', err);
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
    return NextResponse.json({ error: 'Dealership not found' }, { status: 404 });
  }

  const { data: membership } = await serviceClient
    .from('dealership_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('dealership_id', dealership.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this dealership' }, { status: 403 });
  }

  const dealershipId = dealership.id as string;

  // Create HMAC-signed session token
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
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

  return NextResponse.json({ token, first_name: firstName });
}

// verifyAppToken moved to @/lib/app-auth to avoid invalid Next.js route exports
