// Phase 1G: Auth callback handler
// Handles OAuth redirects and email confirmation/password-reset links.
// Supabase sends users here with a `code` param that we exchange for a session.

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // S5: Validate redirect target by parsing to a URL and comparing origins.
  // The prior `startsWith('//')` check let `/\\attacker.com` (browser-normalized
  // to `//attacker.com`) and URL-encoded `%2F%2Fattacker.com` bypass. Parsing
  // resolves all of those to either same-origin or another origin.
  //
  // 2026-04-18 L-5: This redirect is TERMINAL — the value of `next` is only
  // used in the `${origin}${next}` concatenation below. No downstream route
  // re-interprets the path as an open-redirect destination. If you ever add
  // a second-hop redirect (e.g. a /welcome flow that honors `?to=`), re-audit —
  // unrestricted passthrough of `pathname + search + hash` is safe only
  // because the value is bound to our origin here and then rendered as a
  // browser navigation, not another server-side redirect.
  const rawNext = searchParams.get('next') ?? '/dashboard';
  let next = '/dashboard';
  try {
    const parsed = new URL(rawNext, origin);
    if (parsed.origin === origin) {
      next = parsed.pathname + parsed.search + parsed.hash;
    }
  } catch {
    // fall through to default
  }

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth code exchange failed — redirect to login with error indicator
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
