// Phase 1J: Next.js Middleware
// JWT verification using jose (stateless, no outbound HTTP to Supabase Auth).
// Extracts dealership_id and role from token claims.
// Protects dashboard routes (manager+ role required).
// Protects API routes (appropriate role checks).

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import { updateSession } from '@/lib/supabase/middleware';

// Routes that require authentication
const PROTECTED_ROUTES = ['/dashboard'];
const PROTECTED_API_ROUTES = ['/api/dashboard', '/api/users', '/api/push', '/api/ask', '/api/admin'];
const AUTH_ROUTES = ['/login', '/reset-password', '/update-password'];
const PUBLIC_API_ROUTES = ['/api/webhooks', '/api/cron', '/api/auth', '/api/leaderboard'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public API routes — no auth required (webhooks, crons have their own auth)
  if (PUBLIC_API_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Refresh Supabase session (handles cookie management)
  const { supabaseResponse, user } = await updateSession(request);

  // Auth routes — redirect to dashboard if already logged in
  if (AUTH_ROUTES.some((route) => pathname.startsWith(route))) {
    if (user) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return supabaseResponse;
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

    const { dealershipId, userRole } = claims;

    // Dashboard requires manager or owner role
    if (userRole !== 'manager' && userRole !== 'owner') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Inject claims into request headers for downstream API routes
    const response = supabaseResponse;
    response.headers.set('x-user-id', user.id);
    if (dealershipId) response.headers.set('x-dealership-id', dealershipId);
    if (userRole) response.headers.set('x-user-role', userRole);

    return response;
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

    const response = supabaseResponse;
    response.headers.set('x-user-id', user.id);
    if (claims.dealershipId) response.headers.set('x-dealership-id', claims.dealershipId);
    if (claims.userRole) response.headers.set('x-user-role', claims.userRole);

    return response;
  }

  return supabaseResponse;
}

/**
 * Verify JWT using jose and extract custom claims (dealership_id, user_role).
 * Stateless — no outbound HTTP to Supabase Auth.
 * Uses SUPABASE_JWT_SECRET (HS256).
 */
async function verifyAndExtractClaims(
  request: NextRequest
): Promise<{ dealershipId: string | null; userRole: string | null } | null> {
  try {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) return null;

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
