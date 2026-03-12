# DealershipIQ Security Audit

**Date:** 2026-03-12
**Scope:** Full codebase — auth, secrets, injection, API protection, database, SMS/webhook, client-side, dependencies

## Findings Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3 |
| HIGH | 5 |
| MEDIUM | 14 |
| LOW | 6 |

---

## CRITICAL

### S-001: Empty HMAC Secret Fallback Allows Token Forgery
**File:** `src/app/api/app/auth/route.ts`
**Issue:** `APP_AUTH_SECRET || CRON_SECRET || ''` — if both env vars unset, secret is empty string. Attacker can forge valid HMAC signatures and impersonate any employee.
**Fix:** Validate `APP_AUTH_SECRET` is set and non-empty at startup. Throw if missing.

### S-002: PWA Auth Brute-Forceable (No Rate Limiting)
**File:** `src/app/api/app/auth/route.ts`
**Issue:** Phone + last-4-digits auth = 10,000 combinations. No rate limiting. Attacker can enumerate all combinations in minutes.
**Fix:** Rate limit: 3 attempts/min per phone, 10 attempts/hour lockout. Use Upstash Redis.

### S-003: Auth Token Extracted from document.cookie in Dashboard
**File:** `src/app/(dashboard)/dashboard/page.tsx`
**Issue:** Client-side JS parses `document.cookie` to extract Supabase auth token, sends in Authorization header. Exposes token to XSS. Major anti-pattern.
**Fix:** Remove entirely. Supabase auto-includes auth cookie. Use server-side auth or `createBrowserClient()`.

---

## HIGH

### S-004: Public Leaderboard Exposes Full Phone Numbers
**File:** `src/app/api/leaderboard/[slug]/route.ts`
**Issue:** Public endpoint (no auth) returns full phone numbers for all dealership employees. Combined with S-002, this is a complete account takeover chain.
**Fix:** Remove `phone` from public response. Or mask: `+1555***4567`.

### S-005: RLS Policy Allows Manager → Owner Privilege Escalation
**File:** `supabase/migrations/20260309000008_phase1k_rls_policies.sql`
**Issue:** `users_update_manager` policy has `WITH CHECK (true)`. Manager can UPDATE any column including `role` to `owner`.
**Fix:** Constrain WITH CHECK to allowed columns/values: `role IN ('salesperson', 'manager')`.

### S-006: TCPA Opt-Out Enforcement Gap
**File:** `src/app/api/cron/daily-training/route.ts`
**Issue:** Opt-out sync runs on cron schedule. Window between user texting STOP and sync completing means cron could send SMS to opted-out user. TCPA violation risk.
**Fix:** Add real-time opt-out check before every outbound SMS send (query `sms_opt_outs` table directly).

### S-007: Prompt Injection in Coach Mode System Prompt
**File:** `src/lib/coach/prompts.ts`
**Issue:** Rep context (name, dealership, stats) injected into system prompt without sanitization. Malicious `full_name` via CSV import could inject instructions.
**Fix:** Wrap in XML delimiters (`<rep_context>`), sanitize (strip newlines, escape `<>`, truncate to 200 chars).

### S-008: SMS Input to GPT Unsanitized (TRAIN: keyword)
**File:** `src/app/api/webhooks/sms/sinch/route.ts`
**Issue:** Manager's TRAIN: input passed to GPT with minimal sanitization. Could inject prompt override instructions.
**Fix:** Length limit (5-500 chars), strip keywords like `system:`, `instruction`, `ignore`. Use structured output mode.

---

## MEDIUM

### S-009: Missing Input Size Limits
**Files:** `users/import/route.ts`, `billing/checkout/route.ts`, `ask/route.ts`
**Issue:** POST endpoints accept unbounded request bodies. DoS via multi-GB payloads.
**Fix:** Check `content-length` header. Reject CSV > 5MB, JSON > 10KB.

### S-010: In-Memory Rate Limiting Bypassed on Multi-Instance
**File:** `src/app/api/coach/session/route.ts`
**Issue:** Rate limit uses `Map` — cleared on cold start, not shared across Vercel instances.
**Fix:** Migrate to Upstash Redis (NR-001 tracks this).

### S-011: No Rate Limiting on /api/ask and /api/push/training
**Files:** `ask/route.ts`, `push/training/route.ts`
**Issue:** Authenticated users can spam unlimited AI queries or SMS pushes.
**Fix:** Per-dealership rate limit: 100 asks/hour, 5 pushes/5min.

### S-012: Stripe IDs Exposed in Billing Status Response
**File:** `src/app/api/billing/status/route.ts`
**Issue:** Response includes `stripe_customer_id` and `subscription_id`. Information disclosure.
**Fix:** Remove from response payload.

### S-013: Missing Security Headers
**Files:** `next.config.mjs`, `vercel.json`
**Missing:** X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Content-Security-Policy.
**Fix:** Add headers block to `vercel.json` or middleware.

### S-014: CSV Formula Injection
**File:** `src/app/api/users/import/route.ts`
**Issue:** Imported `full_name` values starting with `=`, `+`, `-`, `@` could execute as formulas if exported to Excel.
**Fix:** Reject or prefix fields starting with formula characters.

### S-015: Session Token Contains Plaintext Metadata
**File:** `src/app/api/app/auth/route.ts`
**Issue:** Base64 token contains userId, dealershipId, firstName in cleartext. Reveals internal IDs if intercepted.
**Fix:** Encrypt token payload with AES-256-GCM, or use opaque tokens with server-side storage.

### S-016: Coach Session Ownership Not Verified in GET
**File:** `src/app/api/coach/session/route.ts`
**Issue:** GET returns sessions filtered by userId from token, but doesn't verify dealership membership independently.
**Fix:** Add dealership_memberships check after token verification.

### S-017: Admin API Key Without Constant-Time Comparison
**File:** `src/app/api/coach/context/route.ts`
**Issue:** String `!==` comparison is not timing-safe. No rate limiting on failures.
**Fix:** Use `crypto.timingSafeEqual()`. Rate limit: 10/min.

### S-018: Missing ON DELETE CASCADE on Dealership FK
**File:** Multiple migrations
**Issue:** Dealership deletion leaves orphaned records across all tenant-scoped tables.
**Fix:** Add `ON DELETE CASCADE` to all `dealership_id` foreign keys.

### S-019: Coach Messages Stored Unencrypted
**File:** `coach_sessions` table
**Issue:** Sensitive coaching conversations stored as plaintext JSONB.
**Fix:** Application-layer encryption before insert, decrypt on read. Lower priority — defense-in-depth.

### S-020: No CORS Restriction
**File:** middleware.ts
**Issue:** No explicit CORS headers. External domains can attempt CSRF against API.
**Fix:** Add CORS middleware allowing only production domain.

### S-021: No Global Rate Limiting Middleware
**File:** src/middleware.ts
**Issue:** No per-IP request throttling. Individual routes unprotected unless explicitly coded.
**Fix:** Add Upstash Redis rate limiter in middleware: 100 req/60s per IP.

### S-022: Subscription Check Once Per Dealership in Cron
**File:** `src/app/api/cron/daily-training/route.ts`
**Issue:** Subscription checked at dealership level, not re-checked if it expires mid-execution for large dealerships.
**Fix:** Re-check per batch of 50 users.

---

## LOW

### S-023: .gitignore Missing Root .env Pattern
**File:** `.gitignore`
**Fix:** Add `.env`, `.env.production`, `.env.*.production`.

### S-024: Phone Normalization Inconsistency
**File:** `src/lib/sms.ts`
**Issue:** Outbound strips leading `+`, inbound may include it.
**Fix:** Standardize to E.164 everywhere.

### S-025: Transcript Immutability Not DB-Enforced
**File:** RLS policies
**Issue:** No explicit DENY UPDATE/DELETE policies on `sms_transcript_log`.
**Fix:** Add `WITH CHECK (false)` policies for UPDATE/DELETE.

### S-026: Feature Flags Not Always Dealership-Scoped in Queries
**File:** `src/lib/service-db.ts`
**Fix:** Always include `dealership_id` filter in feature flag queries.

### S-027: Missing IP Logging on Sensitive Endpoints
**File:** API routes
**Fix:** Log `x-forwarded-for` on auth failures for abuse detection.

### S-028: Hardcoded Production URL Fallback
**File:** `src/app/api/webhooks/sms/sinch/route.ts`
**Issue:** `NEXT_PUBLIC_BASE_URL ?? 'https://dealershipiq-wua7.vercel.app'`.
**Fix:** Throw if env var missing.

---

## Priority Matrix

### Immediate (This Week)
| ID | Fix | Effort |
|----|-----|--------|
| S-001 | Validate APP_AUTH_SECRET non-empty | 15 min |
| S-002 | Rate limit PWA auth endpoint | 1 hour |
| S-003 | Remove document.cookie parsing | 30 min |
| S-004 | Remove phone from public leaderboard | 15 min |
| S-013 | Add security headers to vercel.json | 15 min |

### This Sprint
| ID | Fix | Effort |
|----|-----|--------|
| S-005 | Fix RLS WITH CHECK policy | 30 min |
| S-006 | Real-time opt-out check before SMS send | 1 hour |
| S-007 | Sanitize coach prompt context | 30 min |
| S-008 | Sanitize TRAIN: input | 30 min |
| S-009 | Add request size limits | 30 min |
| S-012 | Remove Stripe IDs from response | 15 min |
| S-014 | CSV formula injection defense | 15 min |
| S-017 | Timing-safe admin key comparison | 15 min |

### Next Sprint (Requires Upstash Redis)
| ID | Fix | Effort |
|----|-----|--------|
| S-010 | Redis-backed rate limiting | 2 hours |
| S-011 | Rate limit /api/ask + /api/push | 1 hour |
| S-021 | Global rate limiting middleware | 2 hours |

### Backlog
| ID | Fix | Effort |
|----|-----|--------|
| S-015 | Encrypt token payload | 2 hours |
| S-018 | ON DELETE CASCADE migration | 1 hour |
| S-019 | Coach message encryption | 3 hours |
| S-020 | CORS restriction | 30 min |
| S-022 | Per-batch subscription check | 30 min |
| S-023–S-028 | Low-priority fixes | 2 hours total |
