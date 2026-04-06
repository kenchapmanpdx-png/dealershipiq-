// GET /api/app/verify — Server-side token verification for PWA layout
// Returns decoded session if valid, 401 if not.

import { NextRequest, NextResponse } from 'next/server';
import { verifyAppToken } from '@/lib/app-auth';

export async function GET(request: NextRequest) {
  const cookie = request.cookies.get('diq_session');
  if (!cookie?.value) {
    return NextResponse.json({ error: 'No session' }, { status: 401 });
  }

  const session = verifyAppToken(cookie.value);
  if (!session) {
    // Clear invalid cookie
    const res = NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    res.cookies.set('diq_session', '', { path: '/', maxAge: 0 });
    return res;
  }

  return NextResponse.json(session);
}
