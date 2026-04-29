// POST /api/app/logout — Clear PWA session cookie server-side.
// 2026-04-18 C-2: Added when the diq_session cookie became HttpOnly — the
//   client can no longer clear it via `document.cookie = ''` and must call
//   this endpoint on sign-out / auth failure.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSION_COOKIE_NAME = 'diq_session';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
