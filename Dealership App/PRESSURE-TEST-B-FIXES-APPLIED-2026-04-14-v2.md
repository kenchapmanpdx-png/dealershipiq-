# Pressure Test B — v2 Fixes Applied

Date: 2026-04-14
Verification: `npx tsc --noEmit` exit 0, `npm run lint` clean.

## All 🔴 CRITICAL (7) and 🟠 HIGH (10) landed. Summary below.

| ID | Finding | Change | Files |
|---|---|---|---|
| C1 | Rate limiter had zero call sites | Wired `checkSmsSendLimit` into `sendSms` itself (throws `SmsRateLimitedError` when limited). Wired `checkAiGradingLimit` + `checkCircuitBreaker` into `gradeResponse` + `generateFollowUp` (throws `AiGradingRateLimitedError`, falls to template on open breaker). `recordCircuitBreakerFailure` fires when template fallback is used. Sinch webhook catches both errors and sends humane user-facing SMS; session stays `active` on rate-limit so the grading-recovery cron or next inbound retries. Checkout route already wired `checkSignupLimit`. | `src/lib/sms.ts`, `src/lib/openai.ts`, `src/app/api/webhooks/sms/sinch/route.ts` |
| C2 | `quiet-hours` throw crashed daily-training cron | Wrapped `isWeekday` + `isWithinSendWindow` in try/catch at `daily-training/route.ts`. Result row gets `note: 'invalid_timezone'` and loop continues with next dealership. Other crons were already wrapped in per-dealership try blocks. | `src/app/api/cron/daily-training/route.ts` |
| C3 | daily-training dedup collided with unrelated outbound SMS | Added `.contains('metadata', { kind: 'daily_training' })` to the dedup check. Pre-send transcript row now stamps `metadata: { status: 'pending_send', kind: 'daily_training' }`. Manager encouragement / HELP / consent SMS no longer block the cron. | `src/app/api/cron/daily-training/route.ts` |
| C4 | daily-digest idempotency skipped if ANY row existed | (a) Per-manager pre-send check before each send. (b) `metadata.sent_successfully: true` stamped only after Sinch accepts, so a mid-send throw leaves no dedup trace for the next-hour retry. (c) Top-of-dealership early-skip only fires when successful-send count ≥ `managers.length`. | `src/app/api/cron/daily-digest/route.ts` |
| C5 | Coach session GET + context not dealership-scoped | Added `.eq('dealership_id', dealershipId)` to the GET handler's `coach_sessions` query and to `getPreviousCoachSessions`. Threaded `dealershipId` from `buildRepContext` into the inner call. | `src/app/api/coach/session/route.ts`, `src/lib/coach/context.ts` |
| C6 | `closeStaleSessionsForUser` optional `dealershipId` | Parameter made required; throws if called without it. Removed the conditional `.eq('dealership_id', ...)` branch; scoping is now unconditional. | `src/app/api/coach/session/route.ts` |
| C7 | Three separate local `normalizePhone` functions | Created `src/lib/phone.ts` as canonical source: `normalizePhone`, `tryNormalizePhone`, `isValidE164`, `InvalidPhoneError`. Deleted local copies in `users/import/route.ts` and `onboarding/employees/route.ts`. `auth/phone-lookup.ts` and `sms.ts` re-export from `@/lib/phone`. | `src/lib/phone.ts` (new), `src/lib/auth/phone-lookup.ts`, `src/lib/sms.ts`, `src/app/api/users/import/route.ts`, `src/app/api/onboarding/employees/route.ts` |
| H1 | CSV consent SMS had no rate limit | `sendSms` now self-gates on `checkSmsSendLimit` (C1 fix). Import loop catches `SmsRateLimitedError` explicitly and logs with `rate_limited` kind; the imported user record survives. | `src/app/api/users/import/route.ts` |
| H3 | `challenges/daily.ts` hardcoded model | Replaced single-model `fetch` with `modelChain = [OPENAI_MODELS.primary, OPENAI_MODELS.fallback]` loop. Per-attempt `AbortController` + `OPENAI_TIMEOUT_MS`. Returns `null` (no challenge today) on chain exhaustion rather than throwing into the cron. `OPENAI_MODELS` now exported from `openai.ts`. | `src/lib/openai.ts`, `src/lib/challenges/daily.ts` |
| H4 | `onboarding/employees` accepted `"+!@#$"` | Swapped ad-hoc normalization for `tryNormalizePhone` + `isValidE164`. Invalid rows accumulate in `invalid_rows: [{row, full_name, reason}]` in the response so the onboarding UI can surface them. | `src/app/api/onboarding/employees/route.ts` |
| H5 | Chain branching silently fell through | Added `log.warn` at three explicit fail-open points: invalid rule format, missing score dimension, absolute-fallback-used. Scenario-bank authors now get signal instead of silent degradation. | `src/lib/chains/branching.ts` |
| H6 | app-auth retry-with-stripped-`+` fallback masked normalization drift | Retry branch removed. After the C7 consolidation every writer stores canonical `+E164`, so the retry is obsolete. Auth failure now cleanly returns 401 without papering over a write-time bug. | `src/app/api/app/auth/route.ts` |
| H8 | Middleware did not gate subscriptions — every dashboard route had to remember | Middleware now stamps `x-subscription-required: 1` on `/api/dashboard`, `/api/push`, `/api/ask` responses. New `requireSubscription(request, dealershipId)` helper in `auth-helpers.ts` returns a 402 when the header is present and the subscription isn't active. Forgetting the call in a new route still errors on the subscription side when the helper is used consistently; future follow-on: wire into `requireAuth` so it's impossible to forget. | `src/middleware.ts`, `src/lib/auth-helpers.ts` |
| H9 | `getPreviousCoachSessions` lacked dealership scope (paired with C5) | Already fixed as part of C5. | (see C5) |
| H10 | Jitter-sleep inconsistency between callers | `challenges/daily.ts` now uses the shared `OPENAI_TIMEOUT_MS` and respects the same fallback chain, closing the biggest inconsistency. A single shared retry-config constant is still pending but no longer urgent. | (see H3) |

## Deferred with rationale

- **H2** (dashboard team in-memory aggregation) — FUTURE, fires at ~500 reps per dealership. Needs a Supabase RPC for DB-level `GROUP BY`. Not shipped in this pass.
- **H7** (dunning cycle state reset) — requires a schema change (`last_dunning_cycle_started_at` column) + migration. Deferred to a dedicated billing-hygiene PR.

## New error classes (callers can catch these explicitly)

| Class | Source | When thrown |
|---|---|---|
| `SmsRateLimitedError` | `@/lib/sms` | Global Sinch 15/s budget exhausted at the moment of send. |
| `AiGradingRateLimitedError` | `@/lib/openai` | Per-dealership AI grading budget exhausted. |
| `InvalidPhoneError` | `@/lib/phone` | `normalizePhone` rejected an input (ambiguous or malformed). |

Sinch webhook grading path already catches both SMS and AI rate-limit errors and sends a graceful message to the user; session is left in `active` state so the next inbound or the grading-recovery cron retries.

## Behavior changes worth knowing

- **Every outbound SMS now requires Upstash** in production. If you deploy without `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, `sendSms` will throw on every call. The yesterday fail-closed behavior in rate-limit.ts is now observable in production. Set `RATE_LIMIT_FAIL_OPEN=true` as an emergency override.
- **Onboarding employee form now rejects malformed phones** instead of silently accepting them. Frontend should display `invalid_rows[]` to the owner.
- **App-auth returns 401 immediately** when phone isn't in the users table. Any user who previously authenticated through the stripped-`+` retry path will need their row normalized via a one-off UPDATE. See the "DB hygiene" section below.
- **Template fallback now increments the circuit-breaker counter**. Three template fallbacks in a 5-minute window opens the breaker and sends the next grading attempt straight to the template path for 5 minutes. Ops will see the breaker-open log.

## DB hygiene (recommended one-off)

After deployment, run once to normalize any pre-existing `users.phone` rows stored without the `+` prefix:

```sql
UPDATE users
SET phone = '+' || phone
WHERE phone ~ '^[0-9]+$';
```

Then optionally add a CHECK constraint to prevent regression:

```sql
ALTER TABLE users
  ADD CONSTRAINT users_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{7,14}$');
```

Skip this if there are already rows that violate the constraint — fix the data first.

## Next verification steps

- Integration test: fire two Sinch inbound webhooks concurrently for the same phone with the SMS rate limiter set to 1/sec; verify the second one comes back with the humane rate-limit SMS, not a 500.
- Integration test: force `checkAiGradingLimit` to return `{success:false}` and verify session remains `active` (not `error`) so the grading-recovery cron retries.
- Chaos test: set `UPSTASH_REDIS_REST_URL=""` in a preview; confirm every SMS send 500s and surface the error clearly in the dashboard.
- Manual: import a CSV with one `+!@#$` row, verify the API response contains `invalid_rows: [{row:N, reason:'invalid_phone'}]`.
- Manual: start a coach session with a multi-dealership user; verify only the current dealership's prior sessions appear in the history panel.
