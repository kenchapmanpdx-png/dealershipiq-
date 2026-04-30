// GET/POST /api/auth/logout — Sign out of the dashboard Supabase session.
// 2026-04-30: Added because DashboardNav.tsx links to this path but the route
// did not exist (404 on logout). Supports GET so a plain <a href> from the
// nav works, and POST for any future programmatic callers.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request) {
  const supabase = await createServerSupabaseClient();
  // signOut clears the sb-* cookies via the cookie adapter wired in
  // createServerSupabaseClient().
  await supabase.auth.signOut();

  // Build absolute redirect URL from the incoming request so it works in
  // both prod and preview deploys without hardcoding.
  const url = new URL('/login', request.url);
  return NextResponse.redirect(url, { status: 302 });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
