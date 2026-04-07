# DealershipIQ Full Code Review — 2026-04-07

## Scope
125 TypeScript/TSX files across entire `src/` directory. Six parallel reviewers covering: SMS webhook, database layer, AI grading, cron/billing/auth, dashboard/components, and lib/types/config.

---

## CRITICAL FINDINGS (Fix Before Production)

### 1. Webhook Signature Bypass — REST API + Conversation API Inbound
- **File:** `src/app/api/webhooks/sms/sinch/route.ts` lines 154-186, 195-211
- **Issue:** REST API inbound messages (`mo_text`/`mo_binary`) and Conversation API messages (`contact_message`) are processed WITHOUT HMAC signature verification. Signature check only runs if neither format matches.
- **Impact:** Any actor who can reach the endpoint can forge SMS from any phone number, triggering training sessions, bypassing opt-out checks, or sending manager-only keywords (TRAIN:, NOW, CHALLENGE).
- **Fix:** Verify HMAC signature BEFORE branching on message type.

### 2. Idempotency Race Condition + Lock Ordering Bug
- **File:** `src/app/api/webhooks/sms/sinch/route.ts` lines 273-335
- **Issue:** (a) In-memory Set + DB check is not atomic — two concurrent webhooks can both pass and process the same message. (b) Advisory lock (`tryLockUser`) is acquired AFTER the idempotency check, violating the documented invariant.
- **Impact:** Duplicate training sessions, duplicate grades, double SMS charges.
- **Fix:** Use database UNIQUE constraint on `sinch_message_id` with INSERT-only approach. Move lock acquisition before idempotency check.

### 3. Missing Tenant Isolation — 12 Functions in service-db.ts
- **File:** `src/lib/service-db.ts`
- **Functions missing `dealership_id` filter:**
  - READ: `getScenarioChain()`, `getDailyChallenge()`, `getPeerChallenge()`, `getCustomTrainingContent()`, `getSessionTranscript()`
  - WRITE: `updateSessionStep()`, `updateSessionStatus()`, `updateScenarioChain()`, `updateDailyChallenge()`, `updatePeerChallenge()`, `updateCustomTrainingContent()`
- **Impact:** Cross-dealership data access/modification via ID guessing. Service role bypasses RLS.
- **Fix:** Add `dealershipId` parameter and `.eq('dealership_id', dealershipId)` filter to every function.

### 4. App Token Accepts Missing Expiration
- **File:** `src/lib/app-auth.ts` lines 34-38
- **Issue:** `payload.expiresAt < Date.now()` — if `expiresAt` is stripped from token, `undefined < Date.now()` evaluates to `false`, accepting the token as valid forever.
- **Fix:** Check `!payload.expiresAt || typeof payload.expiresAt !== 'number'` before comparison.

### 5. Cron Timeout — Unbounded Dealership × User Loops
- **File:** `src/app/api/cron/daily-training/route.ts` lines 99-338
- **Issue:** Nested loop: all dealerships × all eligible users × 50ms sleep per user. 100 dealerships × 100 users = 500+ seconds. Vercel timeout = 60s max on Pro.
- **Impact:** Cron silently fails partway through, leaving some dealerships unserved.
- **Fix:** Paginate or queue. Break into per-dealership invocations.

### 6. Stripe Webhook Idempotency Race
- **File:** `src/app/api/webhooks/stripe/route.ts` lines 30-51
- **Issue:** Between signature verification and idempotency INSERT, duplicate events can both pass. Two `invoice.payment_failed` events could both trigger dunning emails.
- **Fix:** Use `UNIQUE(stripe_event_id)` constraint with upsert.

### 7. Prompt Injection — v6 Grading Path
- **File:** `src/lib/openai.ts`
- **Issue:** Conversation history not XML-escaped in v6 grading path. Employee SMS content is injected into prompts and could include XML-breaking tags.
- **Fix:** Escape `<`, `>`, `&` in all user-supplied strings before prompt injection.

### 8. Prompt Injection — Coach System Prompt
- **File:** `src/lib/coach/prompts.ts` lines 78-86
- **Issue:** `sanitizePromptInput()` only removes basic patterns. Bypasses possible via Unicode encoding, case variations, double spaces.
- **Fix:** Whitelist allowed characters instead of blacklisting patterns.

### 9. IDOR — Encourage + Delete User Endpoints
- **Files:** `src/app/api/users/[id]/encourage/route.ts`, `src/app/api/users/[id]/route.ts`
- **Issue:** Both endpoints fetch users by URL `id` parameter without validating the user belongs to the calling manager's dealership. Timing attacks possible even with RLS.
- **Fix:** Add `.eq('dealership_memberships.dealership_id', dealershipId)` to queries.

### 10. CSV Formula Injection
- **File:** `src/app/api/users/import/route.ts` lines 127-132
- **Issue:** `sanitizeCsvField()` strips leading `=+\-@` but Unicode equivalents (`\u003D`) bypass it.
- **Fix:** Normalize Unicode with `value.normalize('NFKD')` before stripping.

---

## HIGH-SEVERITY WARNINGS

### Performance

| # | File | Issue |
|---|------|-------|
| 1 | `service-db.ts` getRedFlagUsers (829) | N+1 pattern: 4 queries per user × N users. 50 users = 200 queries. |
| 2 | `sinch/route.ts` handleNowKeyword (679-713) | SMS send loop with 50ms delay, no rate limit, no backoff. Can timeout webhook. |
| 3 | `api/dashboard/sessions/route.ts` (66) | No `.limit()` on training_results query. 500 users × 100 sessions = 50k rows. |
| 4 | `api/dashboard/coaching-queue/route.ts` (54) | Same unbounded query pattern. |
| 5 | `api/leaderboard/[slug]/route.ts` (62) | API route has NO limit (page.tsx has `.limit(1000)` but API doesn't). |
| 6 | Dashboard pages polling | 60s interval with no visibility-change pause. Tab left open = infinite requests. |

### Security

| # | File | Issue |
|---|------|-------|
| 7 | `cron-auth.ts` (19) | Length check before `timingSafeEqual` leaks secret length via timing. |
| 8 | `rate-limit.ts` (36-54) | Rate limiting completely disabled when Upstash Redis not configured (NO-OP). |
| 9 | `api/app/auth/route.ts` (20-67) | In-memory auth rate limit Map cleared on every Vercel deployment. |
| 10 | `sinch/route.ts` (156-158) | No E.164 phone number validation on inbound. |
| 11 | `middleware.ts` (37) | `pathname.startsWith(route)` too loose — `/dashboard-admin` would match `/dashboard`. |
| 12 | `vercel.json` (41) | CSP includes `'unsafe-inline'` and `'unsafe-eval'`, defeating purpose. |

### Correctness

| # | File | Issue |
|---|------|-------|
| 13 | `challenge-results/route.ts` (54-62) | Invalid timezone causes `parseInt` to return NaN. `NaN !== 17` always true → results never send. |
| 14 | `stripe/route.ts` (196-209) | `past_due_since` read-then-write race: duplicate webhooks both set timestamp. |
| 15 | `sinch/route.ts` (510-541) | Session state checked but not locked — concurrent request can change status between check and update. |
| 16 | `openai.ts` | v6 grading path missing score range validation (1-5 constraint not in OpenAI schema). |
| 17 | `service-db.ts` createDealershipWithManager (1197) | 3 sequential inserts (dealership, user, membership) not transactional. Partial failure = orphaned records. |
| 18 | `users/import/route.ts` (323-348) | CSV import retry creates duplicate membership (no idempotency key). |

### Monitoring

| # | File | Issue |
|---|------|-------|
| 19 | `daily-training/route.ts` (305-329) | SMS send failures caught and counted but endpoint returns 200. No alerting. |
| 20 | `billing/dunning.ts` (234-254) | Failed dunning emails retry on next cron (6h delay). No dead-letter tracking. |
| 21 | `sinch/route.ts` (1217+) | If `sendSms()` fails after grading, session marked completed but user never gets feedback. |
| 22 | Sentry configs | No `beforeSend()` hook to filter PII (phone numbers in URLs). |

---

## INFO / IMPROVEMENTS

| # | File | Issue |
|---|------|-------|
| 1 | `service-db.ts` | Multiple functions return `any` type — getScenarioChain, getDailyChallenge, getPeerChallenge, etc. |
| 2 | `service-db.ts` | Magic numbers throughout (training hour 9-12, completion threshold 0.3, trend limit 3). Extract to constants. |
| 3 | `service-db.ts` | Code duplication: getEligibleUsers and getEligibleUsersForChallenge do similar work. |
| 4 | `service-db.ts` | Inconsistent error handling: some functions check PGRST116, others throw immediately. |
| 5 | `types/database.ts` | Still a stub — needs full `supabase gen types typescript` output. |
| 6 | `instrumentation-client.ts` | File appears truncated at line 31 (OneDrive sync issue?). Verify `captureRouterTransitionStart` export is complete. |
| 7 | `coach/context.ts` (34-51) | `Promise.all()` means one failed fetch kills entire context. Use `Promise.allSettled()`. |
| 8 | `cron/sync-optouts/route.ts` (53-74) | N+1: one query per phone in opt-out list. Batch query instead. |
| 9 | Missing DB indexes | `sms_transcript_log(user_id, direction, created_at)` and `training_results(dealership_id, created_at)` likely unindexed. |
| 10 | `orphaned-sessions/route.ts` (21-34) | Marks sessions abandoned without checking if user is scheduled off. |

---

## SUMMARY BY SEVERITY

| Severity | Count |
|----------|-------|
| 🔴 Critical | 10 |
| 🟡 High Warning | 22 |
| 🔵 Info | 10 |
| **Total** | **42** |

---

## RECOMMENDED FIX ORDER

### Sprint 1 (This Week) — Security
1. Add HMAC verification to ALL webhook inbound paths (Critical #1)
2. Add `dealership_id` to all 12 unscoped service-db functions (Critical #3)
3. Fix app token expiration bypass (Critical #4)
4. Fix IDOR on encourage + delete endpoints (Critical #9)
5. Add E.164 phone validation (Warning #10)

### Sprint 2 (Next Week) — Data Integrity
6. Fix idempotency with DB constraint + lock ordering (Critical #2)
7. Fix Stripe webhook idempotency race (Critical #6)
8. Wrap createDealershipWithManager in transaction (Warning #17)
9. Fix CSV formula injection + import idempotency (Critical #10, Warning #18)

### Sprint 3 — Reliability
10. Paginate daily-training cron (Critical #5)
11. Fix prompt injection in v6 grading + coach (Critical #7, #8)
12. Add timeouts to OpenAI calls in webhook
13. Add SMS send failure recovery/retry
14. Implement Redis-backed rate limiting

### Sprint 4 — Performance & Polish
15. Refactor getRedFlagUsers N+1 queries
16. Add `.limit()` to all unbounded dashboard queries
17. Add visibility-change pause to dashboard polling
18. Add PII filtering to Sentry
19. Generate proper Supabase TypeScript types
20. Add database indexes

---

*Reviewed: 125 files, ~25,000 lines of TypeScript*
*Review date: April 7, 2026*
