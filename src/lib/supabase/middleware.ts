// Phase 1G: Supabase middleware client (refreshes auth tokens on every request)
// Used by src/middleware.ts to keep session alive
//
// 2026-04-18 H-11: accepts an optional `requestHeaders` override so the top-
// level middleware can inject `x-nonce` (for nonce-based CSP) into the
// request headers that Next.js sees during rendering. Server components can
// then read `headers().get('x-nonce')` when they need to render a nonce-
// carrying inline script.

import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

export async function updateSession(
  request: NextRequest,
  requestHeaders?: Headers
) {
  const nextInit = requestHeaders
    ? { request: { headers: requestHeaders } }
    : { request };
  let supabaseResponse = NextResponse.next(nextInit);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next(nextInit);
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session — do not remove this call.
  // getUser() validates the token with Supabase Auth server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
