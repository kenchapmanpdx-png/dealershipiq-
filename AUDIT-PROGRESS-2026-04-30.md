# Audit Progress — 2026-04-30

Status of every item from `AUDIT-2026-04-29.md` after the fix sprint.

## Completed (deployed)

### Critical
- **C1** internal-worker bypass header read in Sinch webhook — `77594a2` predecessor commits (`ec33fa3`).
- **C2 + H1** dropped local HS256 `jwtVerify` in middleware. Reads `app_metadata` from `getUser()` validated user. JWT alg pinning concern resolved by removing the local-verify path entirely.
- **C3** optional off-thread Sinch dispatch gated on `SINCH_OFF_THREAD_ENABLED=true` + `INTERNAL_WORKER_SECRET`.
- **C4a** `runtime = 'nodejs'` pinned on all 9 cron routes.
- **C4b** `updateSessionStatus` now writes `grading_started_at` on transition to `'grading'`, clears on terminal.
- **C5a** leaderboard refactored to 2-query pattern (BOTH page server component AND API route).
- **C7** `subscription-drift` cron disabled in `vercel.json`; route short-circuits 200 if `STRIPE_SECRET_KEY` unset.
- **C9** RLS policies added to 9 orphan tables (billing_events service-only, manager_scenarios dealership-scoped, 7 reference tables manager-read).

### High
- **H2** removed dead `x-subscription-required` header pattern + `requireSubscription()` helper. Dashboard routes call `checkSubscriptionAccess()` directly (correct gate).
- **H3** `/api/billing/checkout` short-circuits 503 when `STRIPE_*` envs missing — no more orphan auth-user/dealership creation.
- **H5** cron budget guards:
  - `red-flag-check`: `createBudget` + `.limit(1000)` + `.in('subscription_status', ['active','trialing'])` + `budget.markProcessed()`.
  - `sync-optouts`: `createBudget` around batch loop.
  - `daily-training`: inner-loop `if (budget.shouldStop()) break`.
- **H6** `/api/ask` adds `checkSubscriptionAccess()` gate before serving Ask IQ.
- **H9** `/api/coach/session` adds `export const maxDuration = 60` and `runtime = 'nodejs'`.
- **H11** `REVOKE EXECUTE ON FUNCTION public.record_chain_step / rls_auto_enable FROM PUBLIC, anon, authenticated`.
- **H12** `search_path = public, pg_catalog` pinned on all SECURITY DEFINER + SECURITY INVOKER functions flagged by Supabase advisor (custom_access_token_hook, has_active_subscription, get_dealership_id, get_user_role, is_manager, unlock_user, try_lock_user, set_updated_at, validate_timezone, switch_active_dealership, erase_user_everywhere, record_chain_step, rls_auto_enable).
- **H13** `INTERNAL_WORKER_SECRET` added to bootcheck `OPTIONAL_FUTURE_ENV_PROD`.

### Medium
- **M2** investigated auth_rls_initplan policies — left for manual rewrite (auto-rewrite would risk semantic changes).
- **M3** 3 missing FK indexes added: `conversation_sessions.challenge_id`, `conversation_sessions.scenario_chain_id`, `users.last_active_dealership_id`.
- **M8** `getRedFlagUsers` rewritten from O(4 × N) N+1 to O(4) bulk queries. Same flag semantics.
- **M9** `/api/dashboard/coaching-queue` added `.limit(2000)`.
- **M12** `X-XSS-Protection` header removed from middleware + `vercel.json`.
- **M16** `/api/users/[id]?mode=` validated against enum (deactivate, erase). Typo returns 400 instead of silent deactivate.
- **M19** `log.warn('openai.generate_follow_up.fallback', ...)` before silent template fallback.

### Other production fixes (incident-response, not audit)
- Module-level throw in `src/middleware.ts:195` removed (deploy-crash bug).
- Bootcheck `REQUIRED_DEPS_PROD` `require.resolve` check dropped — Next.js per-lambda bundling made it unreliable.

## Outstanding

### Critical
- **C8** regenerate `src/types/supabase.ts` (12 columns missing on `conversation_sessions`). Run: `supabase gen types typescript --project-id nnelylyialhnyytfeoom --schema public > src/types/supabase.ts`. Requires Supabase CLI installed locally.

### High
- **H4** Stripe webhook un-claim race — dead-letter on un-claim failure. **Low priority** until Stripe is configured.
- **H7** bump `next@14.2` to current 14.2 patch. **Deferred** — mid-sprint major-framework bumps risk new incidents.
- **H8** set `NEXT_PUBLIC_VERCEL_ENV=production` in Vercel UI so Sentry tags prod events correctly.
- **H10** backfill `supabase_migrations.schema_migrations` with the 23 historical migration files. Schema is consistent today; needed only if the project ever does a branch / restore from migrations table.

### Medium
- **M1** consolidate multiple permissive RLS policies (8 tables, perf only).
- **M4** OpenAI v7→v6 fallthrough total budget — moot once C3 off-thread dispatch is enabled.
- **M6** `handleNowKeyword` push-loop budget — moot once C3 off-thread dispatch is enabled (loop runs in internal-worker lambda with 300s budget).
- **M7** zod validation across all JSON-body routes (broad refactor).
- **M10/M11** CSP `'unsafe-inline'` for `style-src` (Tailwind compromise).
- **M13** `/api/billing/checkout` email-confirm before trial activation. **Defer** — tied to Stripe setup.
- **M14** Stripe webhook env-missing → bootcheck — **defer** until Stripe configured (then promote envs to REQUIRED).
- **M15** `processedMessages` in-memory cache hint (minor).
- **M17** error-shape consistency across routes (broad refactor).
- **M18** daily-digest `Set` dedup → SQL `DISTINCT` (Supabase PostgREST doesn't support `DISTINCT` cleanly; the `Set` approach is correct).
- **M20** Supabase Auth DB connection percentage (Supabase project setting).
- **M21** reference data with 0 rows (informational; likely intentional).

### Cruft cleanup (Vercel UI — Ken's task)
- Delete unused env vars: `SUPABASE_SERVICE_KEY` (legacy), `ENABLE_SCHEDULER`, `ENABLE_AI`.
- Add: `NEXT_PUBLIC_VERCEL_ENV=production` for Production env.

## Future-feature env vars

When the corresponding feature ships, generate the secret + set in Vercel + move from `OPTIONAL_FUTURE_ENV_PROD` to `REQUIRED_ENV_PROD` in `src/lib/bootcheck.ts`:

| Env var | Feature |
|---|---|
| `STRIPE_SECRET_KEY` `STRIPE_WEBHOOK_SECRET` `STRIPE_PRICE_ID` | Stripe billing |
| `UPSTASH_REDIS_REST_URL` `UPSTASH_REDIS_REST_TOKEN` | Rate limiting (currently fail-open) |
| `APP_TOKEN_SECRET` | PWA login |
| `SINCH_XMS_CALLBACK_TOKEN` | Sinch REST/XMS path (Conversation API HMAC is what's currently wired) |
| `INTERNAL_WORKER_SECRET` | Off-thread Sinch dispatch (C1 + C3 wired in code; flip on by setting `SINCH_OFF_THREAD_ENABLED=true` in Vercel after generating the secret) |

## Commits in this sprint

1. `9fa076d` — restore OneDrive-truncated files from f6efa17.
2. `81c5eb9` — leaderboard PAGE 2-query refactor (separate from API route).
3. `216af85` — bootcheck: drop `require.resolve` deps check (per-lambda bundling false-positive).
4. `ec33fa3` — H3 + H5 + H6 + C1 + C3 + H12 follow-up (DB).
5. `a9cccc5` — M9 + M12 + M16 + M19 + M2 + M3 (DB). **Build failed** — TS error in M19.
6. `77594a2` — M19 build fix + M8 N+1 rewrite. Production restored.

## Verification

All three originally-broken endpoints are returning correct responses on commit `77594a2`:

| Path | Expected | Actual |
|---|---|---|
| `/` | 200 marketing page | ✅ 200 |
| `/leaderboard/demo-honda` | 200 with empty state | ✅ 200 "No training sessions yet" |
| `/api/cron/grading-recovery` (no auth) | 401 | ✅ `{"error":"Unauthorized"}` |

Vercel cron's authenticated calls hit the route with the Bearer token and execute normally.
