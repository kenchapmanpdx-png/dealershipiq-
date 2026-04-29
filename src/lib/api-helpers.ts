// Shared API response helpers for consistent error/success handling
// Eliminates repeated NextResponse.json() patterns across 15+ routes

import { NextResponse } from 'next/server';

/**
 * Returns a standardized error response with the given message and HTTP status.
 * Usage: `return apiError('User not found', 404);`
 *
 * @param message Error message
 * @param status HTTP status code (default 500)
 * @returns NextResponse with { error: message } JSON and given status
 */
export function apiError(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Returns a standardized success response with the given data.
 * Usage: `return apiSuccess({ team }, 200);` or `return apiSuccess(newUser, 201);`
 *
 * @param data Response payload (any JSON-serializable object)
 * @param status HTTP status code (default 200)
 * @returns NextResponse with data JSON and given status
 */
export function apiSuccess<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * 2026-04-18 L-14: Reject POST/PUT/PATCH requests whose Content-Type is not
 * application/json. Defends against two things:
 *   1. CSRF-lite: a cross-origin HTML form can POST `text/plain`,
 *      `application/x-www-form-urlencoded`, or `multipart/form-data` without
 *      a preflight. Requiring `application/json` forces the preflight check
 *      (CORS) on any non-simple request, giving us a same-origin gate that
 *      does not rely on cookies alone.
 *   2. Accidental misuse: a client that sends form-encoded data would
 *      deserialize as an empty body, and route handlers that trust
 *      `await req.json()` to throw would not catch this path cleanly.
 *
 * Returns a NextResponse (415) to return from the route, or null if the
 * content type is acceptable.
 *
 * Webhooks with their own signature verification (Sinch HMAC, Stripe
 * signature) don't need this — the signature already binds the body.
 */
export function requireJsonContentType(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return null;
  // Allow empty-body POSTs (e.g. `/api/billing/portal` which takes no payload).
  // Content-Length: 0 means the client did not send a body, so there is no
  // content type to validate.
  const contentLength = request.headers.get('content-length');
  if (contentLength === '0') return null;
  const ct = request.headers.get('content-type') ?? '';
  // Accept "application/json" and "application/json; charset=utf-8" etc.
  if (!/^application\/json(\s*;.*)?$/i.test(ct.trim())) {
    return NextResponse.json(
      { error: 'Content-Type must be application/json' },
      { status: 415 }
    );
  }
  return null;
}
