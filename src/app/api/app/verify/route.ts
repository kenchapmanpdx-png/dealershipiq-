// GET /api/app/verify — Server-side token verification for PWA layout
// Returns decoded session if valid, 401 if not.
// 2026-04-18 C-2: The session cookie is HttpOnly; verification must happen on
//   the server. This endpoint is the ONLY way the client learns that their
//   session is active.
// 2026-04-18 H-16: Also re-checks `users.status === 'active'` on every call so
//   deactivated employees lose access even if their 7-day signed token is
//   still valid.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAppToken } from '@/lib/app-auth';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_COOKIE_NAME = 'diq_session';

function clearCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ error: 'No session' }, { status: 401 });
  }

  const session = verifyAppToken(cookie.value);
  if (!session) {
    return clearCookie(
      NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    );
  }

  // H-16: Re-verify user is still active AND still a member of the dealership
  // the token was issued for. This is the server-side revocation path — drop a
  // row in users.status or memberships and access dies on the next request.
  try {
    const { data: user } = await serviceClient
      .from('users')
      .select('status')
      .eq('id', session.userId)
      .maybeSingle();

    if (!user || user.status === 'inactive' || user.status === 'deactivated') {
      log.info('app.verify.inactive_user_rejected', { user_id: session.userId });
      return clearCookie(
        NextResponse.json({ error: 'Session revoked' }, { status: 401 })
      );
    }

    const { data: membership } = await serviceClient
      .from('dealership_memberships')
      .select('user_id')
      .eq('user_id', session.userId)
      .eq('dealership_id', session.dealershipId)
      .maybeSingle();

    if (!membership) {
      log.info('app.verify.membership_revoked', {
        user_id: session.userId,
        dealership_id: session.dealershipId,
      });
      return clearCookie(
        NextResponse.json({ error: 'Session revoked' }, { status: 401 })
      );
    }
  } catch (err) {
    // Fail-closed on DB error — better to force re-auth than leak a revoked session
    log.error('app.verify.db_error', { error: (err as Error).message });
    return clearCookie(
      NextResponse.json({ error: 'Session unverifiable' }, { status: 503 })
    );
  }

  return NextResponse.json(session);
}
