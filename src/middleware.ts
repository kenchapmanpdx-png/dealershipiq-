// Phase 1J: Next.js Middleware
// JWT verification using jose (stateless, no outbound HTTP to Supabase Auth).
// Extracts dealership_id and role from token claims.
// Protects dashboard routes (manager+ role required).
// Protects API routes (appropriate role checks).
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
import { jwtVerify } from 'jose';
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
// H8: Subscription-gated API prefixes. Middleware injects an
// `x-subscription-required=1` header; dashboard route handlers read it via
// `requireSubscription()` helper (see `@/lib/auth-helpers`). This keeps the
// enforcement centralized so a new `/api/dashboard/*` route that forgets the
// explicit `checkSubscriptionAccess` call still gets gated at the route
// helper level rather than silently serving data to an unpaid dealership.
const SUBSCRIPTION_GATED_PREFIXES = ['/api/dashboard', '/api/push', '/api/ask'];
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
    response.headers.set('X-XSS-Protection', '1; mode=block');
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
    response.headers.set('X-XSS-Protection', '1; mode=block');
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

    // Stateless JWT verification with jose — extract custom claims
    const claims = await verifyAndExtractClaims(request);
    if (!claims) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    // Dashboard requires manager or owner role
    if (claims.userRole !== 'manager' && claims.userRole !== 'owner') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // 2026-04-18 L-1: Removed x-user-id / x-dealership-id / x-user-role response
    // headers. They were set on the *response* (not the request), meaning the
    // client received them — a minor info disclosure. And no downstream route
    // read them: every route re-derives identity server-side from
    // supabase.auth.getUser() + app_metadata. Don't reintroduce — if a route
    // needs identity, read it from the session directly.
    return addSecurityHeaders(supabaseResponse);
  }

  // Protected API routes — require auth + inject headers
  if (PROTECTED_API_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const claims = await verifyAndExtractClaims(request);
    if (!claims) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // L-1: identity headers removed — same reasoning as above.
    const response = supabaseResponse;
    void claims; // claims validity already enforced above

    // H8: mark the route as subscription-gated so any route handler that
    // uses `requireSubscription()` knows to enforce the check. Having the
    // marker here means "forgot to call requireSubscription" is a per-route
    // bug rather than a cross-cutting security hole.
    if (SUBSCRIPTION_GATED_PREFIXES.some((p) => pathname.startsWith(p))) {
      response.headers.set('x-subscription-required', '1');
    }

    return addSecurityHeaders(response);
  }

  return addSecurityHeaders(supabaseResponse);
}

/**
 * Verify JWT using jose and extract custom claims (dealership_id, user_role).
 * Stateless — no outbound HTTP to Supabase Auth.
 * Uses SUPABASE_JWT_SECRET (HS256).
 */
// S15: fail loudly at module-load time if the secret is missing. Previously
// we logged-and-returned-null, which resulted in "everything 401s" in prod
// with the actual cause buried in logs. A module-level assertion trips Vercel's
// deploy health check and prevents a broken version from serving traffic.
if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_JWT_SECRET) {
  throw new Error('SUPABASE_JWT_SECRET must be set in production. Deploy aborted.');
}

async function verifyAndExtractClaims(
  request: NextRequest
): Promise<{ dealershipId: string | null; userRole: string | null } | null> {
  try {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) {
      // In non-production envs we still want the middleware to degrade
      // gracefully so `npm run dev` works without the secret set.
      console.error('[AUTH] SUPABASE_JWT_SECRET is not set — all JWT verification will fail');
      return null;
    }

    // Extract token from Supabase auth cookie
    const authCookie = request.cookies.getAll().find(
      (c) => c.name.startsWith('sb-') && c.name.endsWith('-auth-token')
    );

    if (!authCookie) return null;

    // Supabase stores the token as a JSON array — parse it
    let tokenValue: string;
    try {
      const parsed = JSON.parse(authCookie.value) as string[];
      tokenValue = parsed[0]; // access token is first element
    } catch {
      tokenValue = authCookie.value;
    }

    if (!tokenValue) return null;

    const secret = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(tokenValue, secret);

    const appMetadata = payload.app_metadata as
      | { dealership_id?: string; user_role?: string }
      | undefined;

    return {
      dealershipId: appMetadata?.dealership_id ?? null,
      userRole: appMetadata?.user_role ?? null,
    };
  } catch {
    return null;
  }
}

export const config = {
  matcher: [
    // Match all routes except static files and _next internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
