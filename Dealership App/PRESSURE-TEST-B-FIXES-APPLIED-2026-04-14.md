# Pressure Test B — Fixes Applied

Date: 2026-04-14
Verification: `npx tsc --noEmit` clean, `npm run lint` clean.

## Shipped (code landed in repo)

| ID | Finding | Change | Files |
|---|---|---|---|
| C1 | Rate limiter no-op in prod | Fail-closed in `NODE_ENV=production` unless `RATE_LIMIT_FAIL_OPEN=true`. Structured log on bypass. Added `@upstash/redis` + `@upstash/ratelimit` to `package.json`. | `src/lib/rate-limit.ts`, `package.json` |
| C4 | No OpenAI timeout | Added `fetchWithTimeout` (10s default, `OPENAI_TIMEOUT_MS` override) wrapping all 3 OpenAI fetch sites. `AbortController`-based. | `src/lib/openai.ts` |
| C5 | Silent template fallback | Emits `log.error` + `Sentry.captureMessage` when all models fail and template fallback is used. | `src/lib/openai.ts` |
| C6 | Stripe webhook drops on unresolved customer | `claimEvent` now throws for `invoice.*` and `customer.subscription.*` when dealership lookup fails. Webhook returns 500 so Stripe retries (72h). | `src/app/api/webhooks/stripe/route.ts` |
| C7 | Cron timeout budget | New `src/lib/cron-budget.ts` helper. Applied to `daily-training` — loop bails gracefully with `partial:true` when <10s remain. | `src/lib/cron-budget.ts`, `src/app/api/cron/daily-training/route.ts`, `src/app/api/cron/subscription-drift/route.ts` |
| C8 | Cron dedup token | `daily-training` inserts `sms_transcript_log` row with `sinch_message_id="pending:<session.id>"` BEFORE `sendSms`. Upgraded to real ID after. On retry, the hourly outbound dedup check catches it. | `src/app/api/cron/daily-training/route.ts` |
| C10 | Dunning duplicate emails | `billing_events` INSERT now precedes `sendDunningEmail` in `processDunning` and in the Stripe `invoice.payment_failed` day-1 path. UNIQUE on `stripe_event_id` blocks duplicates. | `src/lib/billing/dunning.ts`, `src/app/api/webhooks/stripe/route.ts` |
| C11 | State-machine transitions not enforced | New `transitionSessionStatus(id, dealership, expectedFrom, to)` uses `.eq('status', expectedFrom)` so races fail loudly. `updateSessionStatus` now also stamps/clears `grading_started_at`. | `src/lib/service-db.ts` |
| C12 | Silent defaults in quiet-hours | `getLocalTime` now throws if `Intl` emits invalid hour/weekday (instead of defaulting to 0 = midnight). | `src/lib/quiet-hours.ts` |
| C2/C3 | Stuck `grading` state has no recovery | New migration adds `conversation_sessions.grading_started_at` column + index. New `/api/cron/grading-recovery` route resets sessions stuck >3 min back to `active`. Scheduled every 5 min in `vercel.json`. | `supabase/migrations/20260414000001_grading_recovery.sql`, `src/app/api/cron/grading-recovery/route.ts`, `vercel.json` |
| H4 | No structured logs in Stripe webhook | Replaced every `console.error` with `log.error(event, {stripe_event_id, stripe_customer_id, ...})`. | `src/app/api/webhooks/stripe/route.ts` |
| H5 | Stripe/Supabase drift has no reconciliation | New `/api/cron/subscription-drift` cron (every 12h) pulls live Stripe status, diffs against Supabase, corrects drift. | `src/app/api/cron/subscription-drift/route.ts`, `vercel.json` |
| H6 | Unknown Stripe statuses treated as `canceled` | `normalizeStatus` whitelists `active/trialing/past_due/canceled/unpaid/incomplete/incomplete_expired/paused`. Unknown statuses pass through + alert. | `src/app/api/webhooks/stripe/route.ts` |
| H8 | Checkout rollback order | Rollback steps tracked individually; incomplete rollbacks return a support-reference code instead of silent 500. Order preserved (child→parent FK). | `src/app/api/billing/checkout/route.ts` |
| H9 | User import orphaned rows | On membership-insert failure, the just-created `users` row is deleted so the retry doesn't see "phone already exists". | `src/app/api/users/import/route.ts` |
| H10 | `getLocalYesterdayString` DST edge | Rewrote to format today's date via `Intl` then subtract one day via `setUTCDate` on a calendar-Date. Fails loud on bad inputs. | `src/lib/quiet-hours.ts` |
| H11 | Phone normalization inconsistent | `sms.ts` opt-out check now imports `normalizePhone` from `auth/phone-lookup` (canonical E.164) plus an alt-no-`+` form for OR match. | `src/lib/sms.ts` |
| H12 | Score regex too strict | `replaceScoreInFeedback` accepts `NN/20`, `NN / 20`, `NN out of 20`, `NN-of-20`, `Score: NN/20`. Prepends score if nothing matches. | `src/lib/openai.ts` |
| H13 | JSON parse errors silent | `callOpenAIGrading` now logs model + 200-char content preview on parse/http/empty/timeout errors. | `src/lib/openai.ts` |
| H14 | No retry backoff on OpenAI chain | `jitterSleep(attempt)` between primary→fallback attempts for both `gradeResponse` and `generateFollowUp`. | `src/lib/openai.ts` |
| H15 | Coach compaction loses context on summarizer failure | On `summarizeMessages` throw, `recentMessages` falls back to last 8 (not 4). Warns. | `src/lib/coach/compaction.ts` |
| H16 | Legacy digest no idempotency | Pre-send check against `sms_transcript_log` metadata `{kind:'legacy_digest', for_date:<local yesterday>}`. Skips and reports `already_sent_today`. | `src/app/api/cron/daily-digest/route.ts` |
| H17 | `processDunning` called from wrong cron | Removed from `red-flag-check`. Called from `dunning-check` where it belongs. | `src/app/api/cron/red-flag-check/route.ts`, `src/app/api/cron/dunning-check/route.ts` |
| H18 | No structured logger | New `src/lib/logger.ts` (`log.debug/info/warn/error`) emitting JSON lines. Used by Stripe webhook, rate-limit, OpenAI, crons. | `src/lib/logger.ts` + call sites |
| H19 | Sinch opt-out sync single-page | New `fetchAllSinchOptOuts` paginates via `next_page_token` up to 50 pages. | `src/app/api/cron/sync-optouts/route.ts` |
| H21 | Push training tenant scoping | Two-step validation: `dealership_memberships` EXISTS check → users SELECT restricted to validated IDs. Removes reliance on PostgREST inner-join semantics. | `src/app/api/push/training/route.ts` |
| M6 (bonus) | Orphaned-sessions race on status | `incrementMissedDay` now reads and writes with `.eq('status','active')` guard. | `src/lib/chains/lifecycle.ts` |
| M10 (bonus) | `helpResponse` null crash | `dealershipName` typed `string \| null \| undefined`; falls back to "your dealership". | `src/lib/sms.ts` |

Also: staggered `daily-digest` to `10 * * * *` so it doesn't co-fire with `daily-training` at `:00` every hour (L8).

## Deferred (touch too much surface for one pass)

| ID | Finding | Why deferred | Recommendation |
|---|---|---|---|
| H1 | Sinch webhook lock hygiene | Requires refactoring 1,656-line `webhooks/sms/sinch/route.ts` to ensure every early-return path lives inside the `try { ... } finally { unlockUser(...) }` block. High risk of regression without integration tests first. | Write failing test: fire two concurrent webhooks with same `messageId`, verify single transcript row. Then refactor with grep for every `return NextResponse.json` inside the handler. |
| H2 | Inbound during `grading` state is dropped | Architectural — requires a `pending_responses` table + drain loop after grading completes. | Follow-on PR. Minimum viable: send a user-visible "hold on" SMS instead of silently discarding. |
| H3 | NOW keyword race between concurrent managers | Needs DB migration (unique partial index on `pending_push` state) or `SELECT FOR UPDATE` via RPC. | Add a migration with `CREATE UNIQUE INDEX scenario_chains_single_pending ON scenario_chains (dealership_id) WHERE status='pending_push'`. |
| H7 | Hardcoded status strings | Type-level refactor touching 4+ files. Low urgency; current strings are all correct today. | Extract `SubscriptionStatus` enum next quarter. |
| H20 | `setTimeout(1000)` inside webhook | Moving to background queue is architectural (Inngest/Vercel Queues/Supabase Edge Functions). | Ship when adding any other async job infra. For now, the 1s delay is inside a Vercel 300s `maxDuration` so it's not immediately breaking. |
| C9 | Transactional opt-out sync | Needs Supabase RPC (`plpgsql` function). The migration alone is ~20 lines but requires review. | Follow-on migration. In the meantime, H19 pagination removes the biggest related risk. |

## New crons added to `vercel.json`

```
/api/cron/grading-recovery    */5 * * * *    (resets sessions stuck in grading)
/api/cron/subscription-drift  0 */12 * * *   (Supabase ↔ Stripe reconciliation)
```

Also changed: `daily-digest` moved from `0 * * * *` → `10 * * * *` to stagger with `daily-training`.

## New migration to apply

```
supabase/migrations/20260414000001_grading_recovery.sql
```

Run before deploying the grading-recovery cron.

## New env vars to set

| Var | Where | Purpose |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Vercel prod | Required. Rate limiter is fail-closed in prod without it. |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel prod | Required. As above. |
| `OPENAI_TIMEOUT_MS` | Optional, default 10000 | Override OpenAI fetch timeout. |
| `GRADING_TIMEOUT_MIN` | Optional, default 3 | Minutes a session can sit in `grading` before recovery cron resets it. |
| `RATE_LIMIT_FAIL_OPEN=true` | Emergency only | Forces rate limiter to fail-open even in prod. Use if Upstash has an outage. |

## Install new dependencies

```
npm install
```

(picks up `@upstash/redis` and `@upstash/ratelimit` added to `package.json`).

## Next verification steps (not done in this pass)

- Integration test: fire two Sinch webhooks with same `messageId` concurrently; expect single transcript row.
- Integration test: simulate OpenAI 20s hang; expect webhook to return in <15s with graceful error SMS.
- Chaos drill: unset `OPENAI_API_KEY` in preview; expect template fallback + Sentry alert + user-visible SMS with SLA.
- Manual: trigger `/api/cron/subscription-drift` once in preview with a dealership whose Supabase status disagrees with Stripe; verify correction.
- Manual: run `/api/cron/grading-recovery` against a session manually set to `grading` with `grading_started_at = now()-10min`; verify reset.
