// 2026-04-18 C-3: This HTTP route has been removed.
//
// Previously exposed `GET /api/coach/context?user_id=X&dealership_id=Y` gated
// only by a shared ADMIN_API_KEY header. That design trusted the caller to pass
// a (user, dealership) pair — any valid caller could read any rep's training
// snapshot across every dealership (massive multi-tenant data leak if the
// admin key was ever exposed, and the key was weak: see C-5).
//
// The function this route wrapped (`buildRepContext`) is already called
// in-process from `src/app/api/coach/session/route.ts` after verifying that
// the authenticated rep actually belongs to the dealership. There is no
// external consumer and no reason to keep the HTTP surface.
//
// If you need to reintroduce an admin-only endpoint for support tooling,
// rebuild it from scratch with:
//   1. Supabase Auth for a human admin (not a shared static key).
//   2. An authorization check that the admin has access to that dealership.
//   3. Structured audit logging of every access (who viewed whose context).
//
// This file intentionally exports nothing so Next.js does not create a route.
export {};
