// Phase 1J: Next.js Middleware
// Reads dealership_id + user_role from the authenticated user object that
// `updateSession` already validated via supabase.auth.getUser(). No local
// JWT signature verification — that path was incompatible with Supabase's
// 2026-Q1 migration to ECC P-256 asymmetric signing (legacy HS256 secret
// can't verify P-256-signed user tokens). Trusting getUser()'s validated
// user is correct because Supabase Auth Server is the only thing that
// can mint a real session anyway.
//
// 2026-04-18 H-11: Nonce-based CSP. The previous CSP in vercel.json used
// `script-src 'self' 'unsafe-inline' ...` which negates the primary XSS
// mitigation CSP provides. We now generate a random 128-bit nonce per page
// request, propagate it via the `x-nonce` request header (Next.js automatic-
// nonce convention — scripts rendered by Next inherit it), and override the
// CSP response header with `'nonce-<value>' 'strict-dynamic'`. The vercel.json
// CSP remains a fallback for responses that bypass middleware (e.g. static
// assets served directly by the CDN).

import { NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Generate a cryptographically random nonce for CSP.
 * 16 bytes = 128 bits of entropy — more than enough for a per-request value.
 * Edge runtime: use Web Crypto (globalThis.crypto.getRandomValues).
 */
function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // base64 encode without padding — valid in CSP nonce-source
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Build the nonce-based CSP header. Mirrors vercel.json's policy but replaces
 * script-src's `'unsafe-inline'` with a per-request nonce + `strict-dynamic`.
 * style-src keeps `'unsafe-inline'` for now — Tailwind's critical CSS is
 * inlined and migrating it to nonce-based styling is a larger change than H-11.
 */
function buildCspHeader(nonce: string): string {
  return [
    `default-src 'self'`,
    // strict-dynamic + nonce: browsers that understand strict-dynamic will
    // ignore 'self' / host allowlists and ONLY trust scripts carrying the
    // nonce (or loaded by one that does). Legacy fallbacks kept for older UAs.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com https://browser.sentry-cdn.com`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self' https://*.supabase.co https://api.openai.com https://api.stripe.com https://*.ingest.us.sentry.io`,
    `frame-src https://js.stripe.com`,
    `worker-src 'self' blob:`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

// Routes that require authentication
const PROTECTED_ROUTES = ['/dashboard'];
const PROTECTED_API_ROUTES = ['/api/dashboard', '/api/users', '/api/push', '/api/ask', '/api/admin'];
// 2026-04-29: removed SUBSCRIPTION_GATED_PREFIXES + x-subscription-required
// header pattern. The header was set on the *response* (so route handlers
// could not read it) and `requireSubscription()` was never actually called
// from any route. Every dashboard route already calls
// `checkSubscriptionAccess(dealershipId)` directly, which is the real gate.
const AUTH_ROUTES = ['/login', '/reset-password', '/update-password'];
// 2026-04-18 H-1: `/api/internal/*` is the off-thread dispatch target for
// the Sinch webhook. It authenticates via a shared `x-worker-secret` header
// (checked inside each route), not via Supabase auth cookies — the caller is
// a server-to-server self-invocation with no user session. Adding it here
// skips the unnecessary cookie parse + Supabase session refresh.
const PUBLIC_API_ROUTES = ['/api/webhooks', '/api/cron', '/api/auth', '/api/leaderboard', '/api/internal'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // H-11: nonce + CSP applied per-request. API responses and page responses
  // both get the header; only HTML pages use the nonce for inline scripts,
  // but putting the header on API responses is harmless and blocks any XSS
  // injected via an API error template.
  const nonce = generateCspNonce();
  const cspHeader = buildCspHeader(nonce);

  // Propagate nonce to the app via request header. Next.js reads `x-nonce`
  // from the incoming request when rendering and applies it to framework-
  // generated inline scripts (hydration chunks, preload scripts, etc.).
  // If we ever emit our own inline <script>, read headers().get('x-nonce')
  // in the server component and pass nonce={nonce} to it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  // Public API routes — no auth required (webhooks, crons have their own auth)
  if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    // 2026-04-29 M12: removed X-XSS-Protection — modern browsers ignore it
    // and it has historically introduced vulnerabilities (XS-Leaks via the
    // legacy auditor). CSP is the real defense.
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('Content-Security-Policy', cspHeader);
    return response;
  }

  // Refresh Supabase session (handles cookie management)
  // H-11: pass mutated requestHeaders so the x-nonce reaches server components.
  const { supabaseResponse, user } = await updateSession(request, requestHeaders);

  // Helper to add security headers to response
  const addSecurityHeaders = (response: NextResponse): NextResponse => {
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    // M12: X-XSS-Protection intentionally not set (modern browsers ignore + historical XS-Leak vector).
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    // H-11: override the vercel.json unsafe-inline CSP with a strict
    // nonce-based one. Middleware headers take precedence over vercel.json
    // for dynamic responses that pass through middleware.
    response.headers.set('Content-Security-Policy', cspHeader);
    return response;
  };

  // Auth routes — redirect to dashboard if already logged in
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (user) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return addSecurityHeaders(supabaseResponse);
  }

  // Protected dashboard routes — require authenticated manager
  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // 2026-04-29: read role/dealership from the user object that
    // updateSession already validated via supabase.auth.getUser().
    // app_metadata is set server-side at signup/role-change and cannot be
    // tampered with by the client.
    const userRole = (user.app_metadata?.user_role ?? null) as string | null;
    const dealershipId = (user.app_metadata?.dealership_id ?? null) as string | null;

    if (!userRole || !dealershipId) {
      // Authenticated but no app_metadata — orphaned account.
      return NextResponse.redirect(new URL('/login', request.url));
    }

    if (userRole !== 'manager' && userRole !== 'owner') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    return addSecurityHeaders(supabaseResponse);
  }

  // Protected API routes — require auth
  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userRole = user.app_metadata?.user_role;
    const dealershipId = user.app_metadata?.dealership_id;
    if (!userRole || !dealershipId) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    return addSecurityHeaders(supabaseResponse);
  }

  return addSecurityHeaders(supabaseResponse);
}

export const config = {
  matcher: [
    // Match all routes except static files and _next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
