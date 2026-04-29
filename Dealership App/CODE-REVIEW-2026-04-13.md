# DealershipIQ Full Code Review — April 13, 2026

## Verdict: Solid Foundation, Targeted Fixes Needed

The codebase is well-structured and security-conscious. Webhooks are properly verified, JWT auth is stateless, and RLS is used correctly. The main issues are: N+1 query patterns in cron jobs, rate limiting that doesn't persist across serverless instances, and heavy auth code duplication across 15+ routes.

---

## Critical Issues (Fix This Week)

### 1. N+1 Query in Red Flag Cron
- **File:** `src/lib/service-db.ts` lines 846-975
- **Problem:** `getRedFlagUsers()` loops through each user making 4 separate DB queries per user. A 50-person dealership = 200+ queries per cron run (runs every 6 hours).
- **Fix:** Batch all queries using `.in('user_id', allUserIds)` then group results in memory.

### 2. N+1 Query in Opt-Out Sync Cron
- **File:** `src/app/api/cron/sync-optouts/route.ts` lines 53-74
- **Problem:** Individual DB query per opted-out phone number. Could be 1000s of queries.
- **Fix:** Batch in chunks of 100 using `.in('phone', chunk)`.

### 3. Admin Email Hardcoded as Fallback
- **File:** `src/app/api/admin/costs/route.ts` line 11
- **Problem:** If `ADMIN_EMAIL` env var is missing, falls back to a hardcoded email. Anyone with that email gets admin access to all dealership cost data.
- **Fix:** Remove fallback. Throw error if env var not set.

### 4. Rate Limiting Completely Disabled Without Redis
- **File:** `src/lib/rate-limit.ts` lines 36-42
- **Problem:** If Upstash Redis isn't configured, all rate limits silently pass through. AI grading, signup, billing endpoints are unprotected.
- **Fix:** Require Redis in production. Add startup validation.

---

## High Priority (Fix This Sprint)

### 5. In-Memory Rate Limits Don't Work on Vercel
- **Files:** `src/app/api/app/auth/route.ts` lines 20-67, `src/app/api/ask/route.ts` lines 24-37
- **Problem:** Rate limit Maps reset on every cold start. Distributed across instances. Brute-force attacks not throttled.
- **Fix:** Move all rate limiting to Upstash Redis.

### 6. Phone Auth Validation Too Loose
- **File:** `src/app/api/app/auth/route.ts` lines 81-89
- **Problem:** Accepts phone numbers without strict E.164 validation. Silent normalization could cause ambiguous matching.
- **Fix:** Use `isValidE164()` from `src/lib/sms.ts` after normalization.

### 7. Unbounded Leaderboard Query
- **File:** `src/app/api/leaderboard/[slug]/route.ts` lines 62-81
- **Problem:** Public endpoint with no `.limit()` or pagination. Large dealerships fetch all training results into memory.
- **Fix:** Add `.limit(1000)` and cursor-based pagination.

### 8. Coach Session Rate Limit Loads Full Messages
- **File:** `src/app/api/coach/session/route.ts` lines 642-669
- **Problem:** Queries ALL coach_sessions from past hour including full JSONB message arrays just to count messages. Potentially 100KB+ per check.
- **Fix:** Select only `id` column or use a count query.

### 9. Webhook In-Memory Cache Diverges from DB
- **File:** `src/app/api/webhooks/sms/sinch/route.ts` lines 335-359
- **Problem:** `processedMessages` Set is lost on cold start. Two Vercel instances could both process the same message.
- **Fix:** Remove in-memory cache. Rely solely on DB UNIQUE constraint + advisory lock (already implemented).

### 10. Missing Security Headers
- **File:** Middleware
- **Problem:** No explicit `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection` headers.
- **Fix:** Add to Next.js middleware response headers.

---

## Medium Priority (Next 2 Weeks)

### 11. Auth Pattern Duplicated 15+ Times
- **Files:** Every protected API route
- **Problem:** Identical 8-line auth extraction + role check copied into every route handler.
- **Fix:** Extract to `src/lib/auth-helpers.ts` with `extractAuthContext()` utility.

### 12. Error Response Pattern Duplicated
- **Files:** Every API route
- **Problem:** Same try/catch + `console.error` + 500 response in every route.
- **Fix:** Create `withErrorHandler()` wrapper or middleware.

### 13. Missing `.env.example` Variables
- **Missing:** `STRIPE_PRICE_ID`, `SINCH_PHONE_NUMBER`, `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_APP_URL`
- **Fix:** Update `.env.example` with all required vars.

### 14. Type Safety Gaps in service-db.ts
- **File:** `src/lib/service-db.ts` — 15+ instances of `any`
- **Problem:** Loose client parameter typing. Heavy `as` casts throughout.
- **Fix:** Create proper interfaces for Supabase client parameter.

### 15. Dashboard Coaching Queue Filters in Memory
- **File:** `src/app/api/dashboard/coaching-queue/route.ts` lines 54-70
- **Problem:** Fetches ALL 7-day training results then filters in JS. 500+ results/week wasted.
- **Fix:** Push filters to database query.

### 16. Silent Error Catching in Cron Jobs
- **File:** `src/app/api/cron/red-flag-check/route.ts` lines 85-87
- **Problem:** Catches errors silently with empty catch block. A failed duplicate check could mean a genuinely at-risk employee gets no alert.
- **Fix:** Log warnings in catch blocks. Still continue processing.

### 17. Coach Session Close Race Condition
- **File:** `src/app/api/coach/session/route.ts` lines 490-520
- **Problem:** GPT topic classification takes 2-3s. User could send another message during this window.
- **Fix:** Move classification to background job.

---

## Low Priority (Backlog)

### 18. Orphaned/Unclear Files
- `src/lib/adaptive-weighting.ts` — no visible usage
- `src/lib/scoring-expansion.ts` — unclear purpose
- `src/lib/state-machine.ts` — no apparent usage
- **Action:** Verify usage or remove.

### 19. Verbose Error Logging
- **Files:** Multiple routes
- **Problem:** Full error messages logged. Stack traces could leak implementation details in logs.
- **Fix:** Use error codes, not raw messages.

### 20. Missing Shared Utilities
- No centralized API response type
- No form validation schemas despite Zod being installed
- Phone validation exists in 2+ places
- **Fix:** Create `src/lib/schemas.ts`, `src/lib/api-helpers.ts`.

### 21. Naming Inconsistencies
- Mixed function naming: `sanitizeGsm7()` vs `escapeXml()` vs `normalizePhone()`
- Mixed client creation: `createServerSupabaseClient()` vs `getServiceClient()`
- **Fix:** Standardize verb patterns across utilities.

### 22. React Component Memoization
- **File:** `src/components/coach/ChatInterface.tsx`
- **Problem:** No React.memo or useMemo. Messages list re-renders on every prop change.
- **Fix:** Wrap in React.memo, memoize formatted messages.

### 23. Duplicate framer-motion Install
- Present in both root `package.json` AND `Dealership App/package.json`
- **Fix:** Remove from `Dealership App/package.json` (that's not the project root).

---

## What's Working Well

- **Webhook security:** Both Sinch and Stripe webhooks properly verify signatures
- **Cron auth:** Timing-safe comparison via `crypto.timingSafeEqual()`
- **JWT verification:** Stateless, no outbound calls to Supabase Auth
- **TCPA compliance:** Real-time opt-out check before every SMS send
- **Idempotency:** Stripe + Sinch webhooks use DB UNIQUE constraints + advisory locks
- **RLS policies:** Most routes use RLS-backed Supabase client
- **Project structure:** Clean Next.js App Router patterns, proper client/server separation
- **Type organization:** Well-separated by domain in `src/types/`

---

## Remediation Roadmap

| Week | Items | Effort |
|------|-------|--------|
| This week | #1-4 (N+1 queries, admin email, rate limit) | 4-6 hours |
| Next week | #5-10 (Redis rate limits, validation, headers) | 6-8 hours |
| Week 3 | #11-17 (DRY patterns, type safety, cron fixes) | 8-10 hours |
| Backlog | #18-23 (cleanup, naming, memoization) | 4-6 hours |
