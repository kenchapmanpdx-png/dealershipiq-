# Full Security & Functionality Review — 2026-04-18

Scope: entire Next.js 14 App Router codebase at `C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq`. Read-only audit. Four parallel specialist reviews: secrets/deps/config, auth/tenant-isolation, webhook security, API validation/AI safety/functionality.

No findings duplicated across sections — each appears once at its highest severity. Where two reviews reached different conclusions, both are captured with a **Conflict** tag for verification.

---

## Severity summary

| Severity | Count | Scope |
|---|---|---|
| CRITICAL | 5 | Fix this week — exploitable or shipping-broken |
| HIGH | 17 | Fix this sprint — exploitable given likely preconditions, or meaningful functionality bugs |
| MEDIUM | 18 | Fix next sprint |
| LOW | 22 | Hygiene / polish |

---

## CRITICAL

### C-1. Onboarding employees route is broken — INSERT references columns that don't exist on `users`
**File:** `src/app/api/onboarding/employees/route.ts:66-77`
```ts
await supabase.from('users').insert({
  full_name: emp.full_name.trim(),
  phone, email: '',
  role: emp.role === 'manager' ? 'manager' : 'employee',
  status: 'active',
  dealership_id: dealershipId,   // users has no dealership_id column
}).select('id').single();
```
Per `billing/checkout/route.ts:106-116` (authoritative schema comment), `users` has only: `id, full_name, phone, status, language, last_active_dealership_id, auth_id`. Every call fails (or silently swallows — the catch on line 92 doesn't log the specific DB error). The entire "manager bulk-adds employees during onboarding" path is non-functional. The CSV alternate path (`users/import/route.ts:340-346`) uses the correct columns, so some managers succeed and some fail depending on which flow they hit.

**Fix:** Mirror the columns used in `users/import`: drop `email`, `role`, `dealership_id`; add `auth_id` if provisioning an auth user, or insert `{full_name, phone, status, language}` and create the `dealership_memberships` row separately with role.

### C-2. PWA session cookie `diq_session` is not HttpOnly and is set by client JS — any XSS = 7-day bearer theft
**File:** `src/app/app/[slug]/layout.tsx:85`
```js
document.cookie = `diq_session=${token}; path=/; max-age=86400; SameSite=Lax`;
```
The HMAC-signed PWA token (7-day `expiresAt` — `src/app/api/app/auth/route.ts:190`) is stored in a non-HttpOnly, non-Secure cookie because it's set from the browser. Any reflected/stored XSS in the PWA exfiltrates `document.cookie` → attacker calls `/api/coach/session` and `/api/app/verify` as the employee for the full 7 days. Cookie `Max-Age=86400` (24h) contradicts the token's 7-day server-side validity — stolen tokens keep working server-side long after the cookie expires from the browser.

**Fix:** Issue the cookie from `/api/app/auth` via `Set-Cookie: diq_session=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`. Remove every client-side `document.cookie = ...` assignment. Align cookie Max-Age with token `expiresAt`. Add a `users.status === 'active'` check inside `authenticateRep` so deactivated employees can't use a still-valid token.

### C-3. `/api/coach/context` trusts caller-supplied `user_id` + `dealership_id` with only an admin-key gate
**File:** `src/app/api/coach/context/route.ts:26-37`
```ts
const userId = request.nextUrl.searchParams.get('user_id');
const dealershipId = request.nextUrl.searchParams.get('dealership_id');
...
const context = await buildRepContext(userId, dealershipId);
return NextResponse.json({ data: context, error: null });
```
Endpoint accepts any `user_id` / `dealership_id` pair from the querystring and returns the full rep context (training history, scores, persona, psychology). Gate is a single static shared `ADMIN_API_KEY` — no rotation, no per-tenant scope, no user binding. The route does NOT verify that the two IDs belong to each other (no `dealership_memberships` check) before returning data. If `ADMIN_API_KEY` leaks, attacker pulls every rep's context cross-tenant.

**Fix:** Delete the HTTP route and call `buildRepContext` as an in-process function (comment claims "called internally by session route" — make that literal). If the HTTP surface must exist, verify `dealership_memberships (user_id, dealership_id)` before building context, add IP allowlist.

### C-4. Stripe webhook: handler errors after `claimEvent()` permanently lose events
**File:** `src/app/api/webhooks/stripe/route.ts:77-85, 428-483`
The `billing_events` UNIQUE-on-`stripe_event_id` idempotency pattern claims the event BEFORE running the handler. If the handler throws (Supabase blip, transient timeout, etc.), the 500 triggers Stripe retries — but every retry now hits the UNIQUE claim and short-circuits at `claimEvent()` returning `{skipped: true}`. Net effect: a transient outage during `handleSubscriptionUpdated` silently drops the event — dealership's `subscription_status` never updates, customer keeps access after cancel or is locked out after reactivation.

**Fix:** On handler failure, `DELETE` the `billing_events` row before returning 500, so Stripe's retry re-runs the handler:
```ts
} catch (err) {
  log.error('stripe.webhook.handler_error', { stripe_event_id: event.id, err });
  await serviceClient.from('billing_events').delete().eq('stripe_event_id', event.id);
  return NextResponse.json({ error: 'Handler error, will retry' }, { status: 500 });
}
```

### C-5. Weak `ADMIN_API_KEY` and `CRON_SECRET` values (low entropy, human-guessable)
**File:** `.env.local:2-3`
```
ADMIN_API_KEY="diq_admin_2024_xK9mP3nQ7v"
CRON_SECRET="dealershipiq-cron-secret-2024"
```
Timing-safe comparison (`cron-auth.ts:19-21`) is pointless if the secret is guessable. `.env.example:32,40` already recommends `generate-a-random-64-char-string` — the actual values don't follow that guidance. These gate `/api/cron/*` (all crons) and `/api/coach/context` (cross-tenant admin read — see C-3).

**Fix:** Rotate both to `openssl rand -hex 32` values. Update Vercel env + `.env.local`. Redeploy. Then run `git log --all --full-history --source -- .env.local` and `git log -p --all -S"diq_admin_2024"` on the repo host to confirm the file was never committed historically.

---

## HIGH

### H-1. Sinch webhook blocks on OpenAI before returning 200 — exceeds Sinch timeout
**File:** `src/app/api/webhooks/sms/sinch/route.ts:247-295, 1208-1223, 1462-1470`
Handler `await`s `handleInboundMessage` which calls `gradeResponse` / `generateFollowUp` synchronously. OpenAI calls routinely take 5-30s. Handler declares `maxDuration = 300`, but CLAUDE.md explicitly warns "Sinch webhooks timeout at 15 seconds". During OpenAI latency spikes, Sinch gives up / retries, retry hits idempotency → no-op, and the user's response silently goes ungraded.

**Fix:** Defer grading to a background queue (QStash, Supabase Queue, or self-invoked Vercel function). Webhook returns 200 immediately after persisting the inbound transcript; worker runs `gradeResponse` and sends feedback SMS.

### H-2. No per-phone inbound rate limit before AI grader
**File:** `src/app/api/webhooks/sms/sinch/route.ts:360-583`, `src/lib/rate-limit.ts:81`
Only AI grading cap is `checkAiGradingLimit()` at 100/min PER DEALERSHIP. A single malicious phone (credentialed insider, stolen phone, registered bad actor) can inject up to 100 messages/min at your OpenAI cost. SMS-send rate limit (15/sec global) caps outbound but not OpenAI spend.

**Fix:** Add per-phone Upstash sliding window (e.g. 10/60s) in `rate-limit.ts`, check it in `handleInboundMessage` after user lookup and before state machine. Snippet in Agent 3's H-3 report.

### H-3. `/api/push/training` has no `user_ids` array-size cap
**File:** `src/app/api/push/training/route.ts:80-88, 142+`
Accepts any-length `user_ids` array, loops `sendSms` per user. 50ms stagger doesn't cap total work. A manager at a 1000-employee dealership triggers ~50s of billable SMS/OpenAI per request.

**Fix:** `const MAX_USER_IDS = 200` with 400 response beyond cap.

### H-4. `/api/onboarding/employees` has no array-size cap
**File:** `src/app/api/onboarding/employees/route.ts:40-49`
Arbitrary `employees.length`. Combined with C-1 (every row fails), 100K rows hammer Postgres. `users/import/route.ts:205-211` already caps at 500 — apply same limit here.

### H-5. TRAIN: prompt-injection sanitizer is a weak blacklist
**File:** `src/app/api/webhooks/sms/sinch/route.ts:636-639`
```ts
sanitized.replace(/system:|instruction:|ignore |override |assistant:/gi, '')
```
Bypasses:
- Unicode homoglyphs: `Sуstem:` (Cyrillic у)
- Spacing: `s y s t e m :`, `system :` (trailing space before `:`)
- Novel: "Disregard earlier guidance", "ROLE:", "{{prompt}}"

Sanitized string flows to `generateScenarioFromManager()` → OpenAI.

**Fix:** Match the grading path's pattern — wrap in `<manager_input>` XML tags after `escapeXml` whitelist, tell the model explicitly to treat tag contents as data, not instructions.

### H-6. `/api/users/route.ts` uses local phone normalization with different semantics than canonical helper
**File:** `src/app/api/users/route.ts:29-41` vs `src/lib/phone.ts`
Local `validateE164Phone` / `normalizePhone` accepts `\+?1?\d{10,15}` after stripping non-digits — accepts "+++++1234567890" as valid; always prepends `+1` for any 10-digit. Canonical rejects 8-15-digit bare numbers without country code. An employee added via this route may be stored with a different format than one added via `/api/users/import` or `/api/onboarding/employees` — breaks `getUserByPhone` exact-match `.eq()` lookup on inbound SMS.

**Fix:** Import and call `normalizePhoneOrThrow` from `@/lib/phone`. Delete the local copy.

### H-7. Public `/api/leaderboard/[slug]` leaks PII
**File:** `src/app/api/leaderboard/[slug]/route.ts:62-82`
Unauthenticated endpoint returns full names, per-user training counts, avg scores, and last-activity timestamps for every active salesperson at every dealership whose slug you can guess. Slugs are kebab-cased brand names. No rate limit, no aggregation floor (unlike `coach-themes` which requires ≥3 users).

Attack scenarios: competitor intel (who's at risk of leaving, who's performing), HR harassment (public ranking of lowest performer), employee-level identification via full name + score.

**Fix:** If public is intended by product, strip `user_id` / `user_name` or show initials only; add per-IP rate limit; add opt-in `leaderboard_public: boolean` flag on `dealerships` to gate exposure. Otherwise require auth.

### H-8. `/api/admin/costs` queries the wrong table name and silently returns empty data
**File:** `src/app/api/admin/costs/route.ts:35-39`
```ts
await serviceClient.from('transcript_logs')  // actual table is 'sms_transcript_log'
```
Compare `service-db.ts:168`, `daily-training/route.ts:157`. Endpoint returns `smsCounts=null` — masks whether the admin gate actually works. Also: admin gate is email-only (no role check, no MFA) — if `ADMIN_EMAIL` match is ever loosened, every dealership's name + subscription + message volume leaks.

**Fix:** `'transcript_logs'` → `'sms_transcript_log'`. Add `requireRole('owner')` in addition to email allowlist. Consider an admin 2FA claim in `app_metadata`. Replace in-memory Map aggregation with SQL `GROUP BY` RPC for scale.

### H-9. Stripe route missing `runtime` / `dynamic` / `maxDuration` declarations
**File:** `src/app/api/webhooks/stripe/route.ts:1-17`
Uses `await request.text()` (correct for signature verification). No `export const runtime = 'nodejs'` or `export const dynamic = 'force-dynamic'` — a future transitive edge-incompatible import could cause silent Edge deployment, breaking `constructEvent`. No `maxDuration` — inline dunning email calls can exceed platform default.

**Fix:**
```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
```

### H-10. Stale service-role JWT for an unrelated Supabase project in `.env.local`
**File:** `.env.local:19`
```
SUPABASE_SERVICE_KEY=eyJ...ref:"hbhcwbqxiumfauidtnbz"...
```
Active project is `nnelylyialhnyytfeoom` (line 20). The stale `SUPABASE_SERVICE_KEY` (no `_ROLE_` — grep confirms never read anywhere in `src/`) points to a different Supabase project. If that project still exists and this key still works, anyone with `.env.local` exposure can bypass RLS on the old project's data.

**Fix:** Confirm the `hbhcwbqxiumfauidtnbz` project is deleted in Supabase or rotate its service-role JWT. Remove the `SUPABASE_SERVICE_KEY` line from `.env.local` and any Vercel envs.

### H-11. CSP `'unsafe-inline'` on `script-src`
**File:** `vercel.json:49`
```
script-src 'self' 'unsafe-inline' https://js.stripe.com https://browser.sentry-cdn.com
```
`'unsafe-inline'` defeats the primary XSS mitigation of CSP. App Router supports nonce-based CSP via middleware. Given C-2 exists (PWA session cookie vulnerable to XSS), this is load-bearing.

**Fix:** Generate a nonce in `src/middleware.ts`, inject into response header, replace `'unsafe-inline'` with `'nonce-<value>' 'strict-dynamic'`.

### H-12. Coach-session rate limit fails OPEN on DB errors
**File:** `src/app/api/coach/session/route.ts` (per-user 30/hr DB-backed counter)
On Postgres `.select('count')` / `.insert()` throw, code logs and passes through. Postgres outage → every rep makes unbounded OpenAI calls until recovery. Inconsistent with `rate-limit.ts:36-43` which fails closed in production.

**Fix:** On DB error in production, return 503 and skip the OpenAI call.

### H-13. `handleCheckoutCompleted` unconditionally clobbers subscription state on replay
**File:** `src/app/api/webhooks/stripe/route.ts:122-174`
Unconditionally overwrites `subscription_status = 'trialing'` and resets `trial_ends_at`. If Stripe replays `checkout.session.completed` after the subscription has upgraded to `active` (concurrent event order, test-mode checkout, admin CLI replay), active state is stomped.

**Fix:** Scope update to earlier lifecycle stages only:
```ts
.in('subscription_status', ['canceled', 'incomplete', null])
```

### H-14. Sinch nonce replay cache fails OPEN (documented, but consequential)
**File:** `src/lib/sinch-auth.ts:91-107`
`isNonceReplayed()` returns `false` on Upstash errors. With the 60s timestamp window, an attacker who captures a valid signed inbound webhook can replay it repeatedly in that 60s. DB UNIQUE on `sinch_message_id` (route.ts:367) backstops actual double-processing, but each replay still costs one advisory lock + idempotency query. Currently logs nothing on cache unavailable.

**Fix:** Emit a counter/metric on "nonce cache unavailable" so sustained Upstash outages are observable, and/or fail closed on webhook path.

### H-15. In-memory rate limits across serverless instances (multiple routes)
**Files:**
- `src/app/api/ask/route.ts:24-37` (`askRateMap` Map, per-instance)
- `src/app/api/app/auth/route.ts:28-74` (has Upstash fallback — partial fix)
- `src/lib/rate-limit.ts` (Upstash-backed — correct pattern)

`/api/ask` has no Upstash shared limiter — effective ceiling is `60/hr × N instances`. `/api/ask` is currently a stub (line 91) so financial impact is low today, but ships with the real AI implementation if not fixed.

**Fix:** Port `/api/ask` to the Upstash-backed `checkAskLimit` pattern in `lib/rate-limit.ts`. Delete the `Map`-based limiter. Verify every rate-limit shim is Upstash-backed before production traffic grows.

### H-16. PWA token has no server-side revocation — deactivated employees retain access
**File:** `src/lib/app-auth.ts`, `src/app/api/coach/session/route.ts` (`authenticateRep`)
If an employee is fired/deactivated, their signed 7-day token remains valid until `expiresAt`. `verifyAppToken` doesn't check `users.status === 'active'`. `authenticateRep` only verifies membership exists, not status. Combined with C-2 (7-day cookie theft), a deactivated employee keeps using Coach Mode for a week.

**Fix:** Check `users.status === 'active'` inside `authenticateRep`. Alternatively embed a `session_version` column in the token and bump it on deactivation.

### H-17. `/api/app/auth` — username enumeration via different error messages
**File:** `src/app/api/app/auth/route.ts:131-147`
Distinct 401 strings for "wrong last-4" vs "user not found". An attacker can probe whether any phone is an employee at any dealership on the platform.

**Fix:** Normalize both paths to `"Invalid credentials"` with consistent timing.

### Conflict: Stripe `handleCheckoutCompleted` trusts `client_reference_id`
Agent 3 flagged this as HIGH: if an authenticated route passes an arbitrary `dealershipId` to `createCheckoutSession`, an attacker could hijack another tenant's billing. Agent 2's route inventory says `/api/billing/checkout` is `NONE (public signup)` that creates a new dealership. **Verification needed:** confirm no authenticated/logged-in code path invokes checkout with an externally-supplied `dealershipId`. If `/api/billing/portal` or a future route allows this, add membership-role check (`owner` on that dealership) before calling Stripe.

---

## MEDIUM

### M-1. Sentry Session Replay captures 5% of sessions with no explicit PII masking
**File:** `src/instrumentation-client.ts:9-14`
`replaysSessionSampleRate: 0.05`, `replaysOnErrorSampleRate: 1.0`. `Sentry.replayIntegration()` called with defaults. Defaults mask text in recent `@sentry/nextjs`, but nothing is explicit. Every error replay captures full DOM including phone numbers, billing info, AI transcripts.

**Fix:**
```ts
Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })
```
Also set `sendDefaultPii: false`. Add `beforeSend` hook to scrub `authorization`, `cookie`, `x-sinch-*` headers.

### M-2. Server Sentry init has no `beforeSend` scrubber
**File:** `sentry.server.config.ts:1-11`
Server events may include request bodies/headers. No `beforeSend` strips `request.data.body`, `request.data.from`, `request.cookies`, `authorization` / `x-admin-key` / `x-sinch-*` headers.

**Fix:** Add `sendDefaultPii: false` and a `beforeSend` scrubber. Apply same pattern in `instrumentation-client.ts`.

### M-3. Quiet hours not enforced in `sendSms()` — proactive paths can fire at 2am
**File:** `src/lib/sms.ts` (no `isWithinSendWindow` import), callers in `sinch/route.ts` NOW push (722-756), peer challenge notify (841-852), ACCEPT notify, dunning emails
`isWithinSendWindow` is imported only in `cron/daily-training/route.ts`. Reactive replies correctly exempt. Proactive sends from webhook (peer challenge notifications) can fire in quiet hours.

**Fix:** Add `proactive: boolean` parameter to `sendSms()`. When true, check `isWithinSendWindow(dealership.timezone, dealership.quiet_hours)` first.

### M-4. `cancelUserActiveState` on opt-out swallows errors silently
**File:** `src/app/api/webhooks/sms/sinch/route.ts:1598-1622`
Try/catch on cancel logs but doesn't rethrow. Opt-out still completes (good), but active chain/challenge cancel may fail, leaving the user receiving chain-step SMS after opt-out — TCPA violation.

**Fix:** On cancel failure, insert a row in a `compliance_remediation` table for a cron to retry, and alert via Sentry.

### M-5. Cross-tenant rate-limit bleed on coach/session for multi-dealership users
**File:** `src/app/api/coach/session/route.ts:647-651`
Rate limiter counts across all dealerships the user belongs to. A hostile coworker at dealership A can DoS the same person at dealership B by exhausting their hourly coach quota.

**Fix:** Scope by `(user_id, dealership_id)` tuple, not `user_id` alone.

### M-6. `getDealershipsReadyForTraining` full-table scan + in-memory timezone filter
**File:** `src/app/api/cron/daily-training/route.ts:101`, `src/lib/service-db.ts`
Loads all dealership rows, filters in-memory by local hour. Linear with tenant count; hourly cron approaches `maxDuration=60` past ~200 dealerships.

**Fix:** Precompute and index `training_hour_utc` per dealership; query `.eq('training_hour_utc', currentUtcHour)`.

### M-7. Logger has no PII scrubbing
**File:** `src/lib/logger.ts`
Emits raw `dealership_id`, `user_id`, `target_user_id`, `***<last4>` phone fragments, raw DB error strings. Sentry Logs / Vercel Log Drains archive indefinitely.

**Fix:** In production, hash `user_id` and full phone before logging. Surface last-4 only where actually needed.

### M-8. `getUserByPhone` non-deterministic for multi-tenant phones with null `last_active_dealership_id`
**File:** `src/lib/service-db.ts` (cross-tenant lookup)
A rep at two dealerships whose `last_active_dealership_id` is null is routed to whichever membership the query returns first — Postgres makes no guarantee without `ORDER BY`. Scores can land in the wrong tenancy.

**Fix:** Add `ORDER BY created_at ASC` and/or `is_primary DESC`. Require `last_active_dealership_id` be set at membership-create time.

### M-9. Stripe dunning email sent inline from webhook — silent loss on email outage
**File:** `src/app/api/webhooks/stripe/route.ts:395-401`
`sendDunningEmail` called synchronously. If Resend/email-service is down, handler returns 500, Stripe retries, `billing_events` row already written (line 377), retry sees "already processed" at line 39 → day-1 email permanently skipped.

**Fix:** Apply C-4's claim-deletion pattern to the dunning-day1 sub-event, OR offload email send to a queue, OR ensure the dunning-check cron recovers missing day-1 sends (verify cron's recovery query matches `billing_events` rows of type `dunning_day1` with no corresponding outbound-email-sent marker).

### M-10. `admin/costs` only gates on email match — no MFA/2FA
**File:** `src/app/api/admin/costs/route.ts:25`
`user.email !== ADMIN_EMAIL` is the only check. Account phish → attacker reads cross-tenant cost data (SMS volumes, Stripe status, per-dealership spend).

**Fix:** Add `app_metadata.admin_2fa_verified: true` claim or HMAC admin token issued after TOTP. Require both.

### M-11. `coach/context` — length-check-after-timingSafeEqual still leaks info
**File:** `src/app/api/coach/context/route.ts:17-23`
Uses pad-and-compare then checks `adminKey.length !== expected.length` afterwards. The string comparison timing remains length-dependent. This route has bigger problems (C-3 — trust of caller-supplied IDs) so this is secondary.

**Fix:** Subsumed by C-3 (delete the route).

### M-12. Sinch webhook returns 200 on all failure paths — cannot distinguish success from silent drop
**File:** `src/app/api/webhooks/sms/sinch/route.ts:168, 187, 194, 200, 204`
Sinch kills callbacks on non-429 4xx, so 200-on-failure is documented. But you can't distinguish real webhook failures in Sinch's dashboard, and an attacker probing with garbage gets 200 back with no penalty — can probe timing/side-effects in `insertTranscriptLog`.

**Fix:** Add an internal `X-Webhook-Valid: true/false` header (app ignores; monitoring asserts). Emit metrics for every reject path so Sentry can count silent drops.

### M-13. `checkOptOut` in webhook is per-dealership, not global
**File:** `src/lib/service-db.ts:258-268`, caller `sinch/route.ts:416`
User opted out at dealership A but has a membership at B would still receive SMS from B. `lib/sms.ts:49-75` global opt-out check saves you (one Sinch number serves all tenants, TCPA is per-sender). But webhook-side check should also be global to keep signals consistent — defense in depth.

**Fix:** Drop the `.eq('dealership_id', ...)` from webhook-side opt-out check.

### M-14. `normalizePhone` not called on Sinch inbound identity
**File:** `src/app/api/webhooks/sms/sinch/route.ts:217, 269-276`
Handler prepends `+` but doesn't call `normalizePhone()`. If Sinch ever sends formatted numbers (spaces, dashes), `isValidE164` silently drops them.

**Fix:** Call `tryNormalizePhone(rawPhone)` first; reject if it returns null.

### M-15. `/api/ask` currently has no shared rate limiter (duplicate of H-15 but noting AI cost angle)
Will ship with the full AI implementation. Currently a stub.

### M-16. `instrumentation.ts` — env validation only runs on Node runtime
**File:** `src/instrumentation.ts:2-10`
`validateBootEnvironment` skipped on Edge. Confirm every route that imports server secrets uses Node runtime (add `export const runtime = 'nodejs'` to webhooks + crons explicitly).

### M-17. `/api/users/[id]/encourage` lacks subscription gate
**File:** `src/app/api/users/[id]/encourage/route.ts`
Endpoint fires SMS without calling `checkSubscriptionAccess`. Expired dealerships can continue sending encouragement SMS. Compare to `push/training/route.ts:72-78` which gates on subscription.

**Fix:** Add `requireSubscription()` to the route.

### M-18. Sinch REST-API path silently 200s when `SINCH_XMS_CALLBACK_TOKEN` is unset
**File:** `src/app/api/webhooks/sms/sinch/route.ts:183-195`
If the env var is missing (post-`vercel env rm`), handler returns 200 and drops the message. Sinch sees success, messages vanish. Log message `[SECURITY] REST API webhook missing auth token` fires in both unset-env and bad-token cases — split the conditions.

**Fix:** Differentiate "missing env" (fail-closed AND log ERROR to Sentry, LOUD alert) from "bad token" (silent drop OK).

---

## LOW / hygiene

- **L-1.** Dead middleware header injection — `src/middleware.ts:97-99` sets `x-user-id` / `x-dealership-id` / `x-user-role` on responses; no route reads them. Delete to prevent future misuse.
- **L-2.** Stripe webhook has no body-size cap — `request.text()` unconditional. Stripe doesn't send huge payloads, but add a 1MB guard anyway.
- **L-3.** Stripe unknown event types still INSERT `billing_events` rows — `webhooks/stripe/route.ts:72-74`. Filter at claim time.
- **L-4.** Stripe SDK casts `subscription as unknown as Record<string, unknown>` for `current_period_end` — `route.ts:194, 226, 289`. Add assert that value is a number before `new Date(val * 1000)`.
- **L-5.** `auth-callback` `next` validation sound, but document that no downstream route performs a second redirect — or pin to hard-coded allowlist.
- **L-6.** `admin/costs` in-memory Map aggregation — replace with SQL `GROUP BY` RPC for scale.
- **L-7.** `admin/costs` exchange-count proxy is wrong — `route.ts:69` adds 1 for pending sessions; use `training_results` count.
- **L-8.** Stripe checkout rollback has no retry on transient network failure — `billing/checkout/route.ts:198-202`.
- **L-9.** `/api/coach/context` uses `console.error` instead of `log.error` — inconsistent with other routes.
- **L-10.** NOW handler lazy-imports `serviceClient` on every invocation — `sinch/route.ts:716-718`. Top-of-file import is cheaper.
- **L-11.** `isNonceReplayed` / `isOptedOut` fail-open/fail-closed correctly but have no health metric — sustained Upstash/DB outages degrade silently. **ADDRESSED 2026-04-18:** both paths now emit structured events (`tcpa.opt_out_check_failed`, `sinch.nonce_check_failed`) on every degraded invocation. Alerting is a monitoring-config task, not code — create a Vercel Log Drain rule alerting when either event exceeds ~5/min over 5 min.
- **L-12.** `/api/dashboard/sessions` allows `days` up to 365 with no `.limit()` — add `.limit(1000)` + UI pagination.
- **L-13.** `red-flag-check` cron queries all dealerships every 6h with no pagination — `route.ts:26-31`. Will hit `maxDuration=60` at scale.
- **L-14.** Missing `Content-Type` validation on most POST routes.
- **L-15.** `auth/attempts` cleanup in `/api/app/auth:70-74` gated on `size > 10000` — relies on Upstash as primary; delete the in-memory belt.
- **L-16.** Phone-fragment logging uses inconsistent format (`***${phone.slice(-4)}` vs raw `slice(-4)`).
- **L-17.** `escapeXml` / `sanitizeGsm7` invariant not documented — add a comment asserting the separation.
- **L-18.** OAuth token cache is per-lambda, not shared — cost/rate issue with Sinch OAuth, not security.
- **L-19.** Test fake secrets `sk_test_fake` / `whsec_test_fake` in `src/test/setup.ts:13-14` may trip scanners. Prefix with `sk_test_unit_fake_0000` or add a scanner allowlist comment.
- **L-20.** `Dealership App/` subdirectory has its own `package-lock.json` — confirm it's not an old checkout shipping secrets. **VERIFIED 2026-04-18:** scratch folder for review docs + `framer-motion` sandbox. No `.env*`, `*.key`, or `*.pem` files anywhere in the tree. `package.json` is a one-liner `{"dependencies":{}}`. Safe.
- **L-21.** `SUPABASE_JWT_SECRET` not in `.env.local` — middleware throws in prod if missing. Confirm set in Vercel for every environment. **VERIFIED 2026-04-18:** latest production deployment `dpl_HwPLkrxyfJHpaseWF3VXRSF3bcEP` is in READY state with active domains. `src/middleware.ts:195-196` throws at module load if the var is missing in production, so a READY deployment is proof the var is set. `.env.example` documents the key for local dev. Recommend also adding it to `.env.local` for onboarding clarity.
- **L-22.** Sinch HMAC compare uses `Buffer.from(str)` with no encoding — works because both sides are ASCII base64 but intent is unclear. Decode bytes explicitly.

---

## What looked good

### Secrets / config
- `.env.local` is correctly gitignored; `*.pem`, `*.key` patterns covered.
- No `NEXT_PUBLIC_` variable exposes a secret (only URL, anon key, Sentry DSN, Vercel env).
- Service-role client is centralized in `src/lib/supabase/service.ts` + `src/lib/service-db.ts`. Zero client component imports it.
- No hardcoded secrets in source (grep for common prefixes returned only test fakes).
- No CORS wildcards.
- `next.config.mjs`: `poweredByHeader: false`, `hideSourceMaps: true`.
- `vercel.json` sets HSTS (2y, includeSubDomains, preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, strict Referrer-Policy, locked-down Permissions-Policy, CSP with `frame-ancestors 'none'` + `base-uri 'self'` + `form-action 'self'`.
- `src/middleware.ts` re-applies same headers (belt-and-braces).
- Boot-time env validation in `src/lib/bootcheck.ts` throws on missing required vars.

### Dependencies
- Next.js 14.2.35 patches CVE-2025-29927 (`x-middleware-subrequest` auth bypass).
- All deps on recent majors: `@supabase/ssr 0.9.0`, `@supabase/supabase-js 2.99.0`, `stripe 20.4.1`, `jose 6.2.1`, `@sentry/nextjs 10.47.0`, `@upstash/redis 1.34.3`, `@upstash/ratelimit 2.0.5`, `zod 4.3.6`.
- No deprecated `@supabase/auth-helpers-nextjs`, no `next-auth`, no legacy `request`/`node-forge`/`lodash` at top level.

### Webhook security
- Stripe signature verification uses `constructEvent` on raw body text.
- Stripe idempotency: INSERT-first with UNIQUE on `stripe_event_id` — textbook atomic pattern.
- Dunning email idempotency uses per-day-per-dealership key (`dunning_day1_${id}_${today}`) inserted before send.
- Sinch HMAC uses `timingSafeEqual` with length pre-check — no `===`.
- Sinch replay protection: 60s timestamp window + Upstash nonce cache.
- Sinch idempotency: DB UNIQUE on `sinch_message_id` + advisory lock acquired BEFORE idempotency check (correct TOCTOU ordering).
- HELP keyword outside advisory lock (read-only response, no serialization needed).

### SMS
- `sendSms` fails CLOSED on opt-out query errors (TCPA compliance).
- `sendSms` fails CLOSED when `ENABLE_SMS_SEND !== 'true'` (prevents staging sends).
- TCPA opt-out check is global across tenants (`lib/sms.ts:49-75`).
- Webhook SMS rate limit fails CLOSED in production with explicit `RATE_LIMIT_FAIL_OPEN` override for emergencies.
- Manager-only keywords (`TRAIN:`, `NOW`, `DETAILS`) role-checked before execution.
- CSV formula injection defense applied AFTER Unicode NFKD normalization.

### Auth / tenant isolation
- Every `/api/dashboard/*` route calls `requireAuth(supabase, ['manager', 'owner'])` and derives `dealershipId` from `user.app_metadata` (server-set, safe) — never from request body/query.
- `/api/users/[id]/encourage` and `/api/users/[id]` re-verify target user belongs to caller's dealership via `dealership_memberships.dealership_id` before acting.
- `service-db.ts` consistently filters by `dealershipId`; cross-tenant helpers documented.
- Cron auth uses SHA-256 + `timingSafeEqual`, fails closed when `CRON_SECRET` unset.
- Middleware `PUBLIC_API_ROUTES` correctly excludes crons/webhooks/auth/leaderboard from dashboard gate.
- `auth/callback` `next` validation correctly handles `//attacker.com`, `%2F%2Fattacker.com`, backslash variants via `URL` origin check.
- `billing/portal` exact-match hostname check (`billing.stripe.com`) — no `startsWith` bypass.
- `push/training` two-step tenant check (memberships + users) defeats PostgREST inner-join edge cases.
- `coach/session.continueSession` scopes SELECT AND UPDATE by `dealership_id` not just session id.
- `tenant-isolation.test.ts` covers SELECT + INSERT (WITH CHECK) across all RLS tables.
- Dashboard layout redirects unauthenticated → `/login`; no-dealership → `/login`; non-manager → `/`.
- `/api/users` POST doesn't trust request-supplied `dealership_id` — uses manager's own from `app_metadata`.
- `SUPABASE_JWT_SECRET` asserted at module-load in production — deploy fails fast on missing secret.

### AI safety
- Structured Outputs with strict JSON schema in `openai.ts` — no blind parse.
- Grading prompt wraps user input in `<employee_response>` XML tags after `escapeXml` whitelist; tells model explicitly to treat contents as data.
- Grading recovery cron with atomic CAS on `status='grading'` avoids double-processing.
- 30s OpenAI timeout on coach sessions; compaction fallback to last-8 messages on summarizer failure.

### Billing
- `billing/checkout` has 10K-byte body cap, 5/hr/IP Upstash rate limit.
- Reverse-FK rollback on signup failure in correct order: feature_flags → memberships → users → auth → dealerships.
- On rollback failure, UUID incident-id is surfaced rather than raw DB error.

---

## Prior review remediation status (spot-checks)

| ID | Item | Status |
|---|---|---|
| C-002 | idempotency before advisory-lock race | Fixed |
| C-003 | RLS migration per route | Mostly complete |
| C-004 | keyword priority ordering | Fixed |
| C-007 | phone canonicalization | Fixed in import/onboarding; **NOT** in `/api/users` (H-6) |
| C-008 | RLS on opt-outs lookup | Fixed |
| C-009/011 | Stripe atomic idempotency | Fixed |
| C-010 | TCPA real-time opt-out | Fixed |
| H-001 | role check on onboarding | Fixed |
| H-002 | 3/day cap | Enforced via daily-training dedup |
| H-004 | TRAIN manager-only | Fixed |
| H-007 | red_flag_events dedup | Fixed |
| H-008 | subscription gate helper | Fixed |
| H-009 | rollback user on membership fail | Fixed |
| H-011 | E.164 consistency for opt-out | Fixed |
| H-014 | HELP response single segment | Fixed |
| H-015 | compaction fallback | Fixed |
| H-017 | batch consent SMS `Promise.allSettled` | Fixed |
| H-021 | two-step tenant check | Fixed |
| M-004 | isFinalExchange strict equality | Fixed |
| M-008 | TRAIN: prompt injection | **Partially fixed** — weak blacklist (H-5) |
| M-010 | ADMIN_EMAIL no fallback | Fixed |
| M-011 | timingSafeEqual pad | Fixed, residual length-check timing leak (M-11) |
| S-002 | PWA brute-force | Fixed |
| S-003 | constant-time last4 | Fixed |
| S-005 | redirect validation | Fixed |
| S-006 | real-time opt-out | Fixed |
| S-009 | body size caps | Fixed on checkout/CSV; **NOT** on ask/push/onboarding-employees (H-3, H-4) |
| S-010 | SMS kill-switch fail-safe | Fixed |
| S-012 | Sinch replay protection | Fixed |
| S-014 | CSV formula injection | Fixed |
| S-017 | coach-context timing-safe | Fixed (with residual — M-11, C-3) |
| L-013/018 | Stripe hostname + timeout | Fixed |
| L-015 | in-memory rate limit on `/api/ask` | **NOT fixed** (H-15) |
| F3-M-001 | CSV row cap | Fixed (500) |
| F11-M-001 | trial_end from Stripe | Fixed |
| F13-M-001 | chain expiry schedule-aware | Fixed |
| X-003 | atomic CAS on manager scenario push | Fixed |
| X-007 | cancel active state on opt-out | Fixed (with M-4 caveat) |
| X-009 | message cap during NOW push | Fixed |

---

## Immediate action plan (this week)

1. **C-1** — fix `onboarding/employees` INSERT columns to match actual `users` schema, OR consolidate onto `users/import` path and remove the JSON endpoint.
2. **C-2** — move `diq_session` cookie issuance server-side with `HttpOnly; Secure`; remove all client `document.cookie` assignments; align Max-Age with token expiresAt.
3. **C-3** — delete `/api/coach/context` HTTP route; call `buildRepContext` in-process from `coach/session` instead.
4. **C-4** — on Stripe webhook handler error, DELETE the `billing_events` claim row before returning 500 so Stripe retries actually re-run the handler.
5. **C-5** — rotate `ADMIN_API_KEY` and `CRON_SECRET` to `openssl rand -hex 32`; update Vercel + `.env.local`; verify via `git log -p --all -S"diq_admin_2024"` that the file was never committed.
6. **H-1** — start work on deferring Sinch grading to a background queue; OpenAI latency + 15s Sinch timeout is a live reliability bug.
7. **H-2** — add per-phone Upstash rate limit before AI grader; ship today.
8. **H-3 / H-4** — add `MAX_EMPLOYEES = 500` / `MAX_USER_IDS = 200` caps; one-line fixes.
9. **H-10** — remove stale `SUPABASE_SERVICE_KEY` and confirm the `hbhcwbqxiumfauidtnbz` project is deleted or the key rotated.

## Verification commands

Run on the repo host (bash, from `C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq`):

```bash
# Confirm .env.local was never committed historically
git log --all --full-history --source -- .env.local
git log -p --all -S"diq_admin_2024_xK9mP3nQ7v"
git log -p --all -S"dealershipiq-cron-secret-2024"

# Dependency audit
npm audit --production --json | head -200

# Grep for any remaining direct service-role usages in client components
grep -r "from '@/lib/supabase/service'" src/components/ src/app/\(auth\)/ src/app/\(marketing\)/

# Find any route.ts that's missing runtime declaration
grep -L "export const runtime" src/app/api/webhooks/*/route.ts src/app/api/cron/*/route.ts
```

---

## Files cited (absolute paths)

```
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\.env.local
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\vercel.json
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\next.config.mjs
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\sentry.server.config.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\middleware.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\instrumentation.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\instrumentation-client.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\app-auth.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\cron-auth.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\logger.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\phone.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\quiet-hours.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\rate-limit.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\service-db.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\sinch-auth.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\sms.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\stripe.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\supabase\middleware.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\supabase\server.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\lib\supabase\service.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\admin\costs\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\app\auth\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\app\verify\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\ask\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\auth\callback\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\billing\checkout\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\coach\context\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\coach\session\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\cron\daily-training\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\cron\grading-recovery\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\cron\red-flag-check\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\dashboard\sessions\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\leaderboard\[slug]\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\onboarding\employees\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\push\training\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\users\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\users\[id]\encourage\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\users\import\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\webhooks\sms\sinch\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\api\webhooks\stripe\route.ts
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\app\[slug]\layout.tsx
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\app\(dashboard)\layout.tsx
C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq\src\test\tenant-isolation.test.ts
```
