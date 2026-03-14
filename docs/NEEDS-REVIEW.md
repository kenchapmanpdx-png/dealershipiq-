# Needs Review

## NR-001: Upstash Redis for rate limiting
- **Status:** Deferred
- **Context:** Rate limiting module (`src/lib/rate-limit.ts`) built with fail-open pattern. Passes through all requests when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` not set.
- **Action needed:** Create Upstash Redis database, add env vars to Vercel.
- **Recommendation:** Free tier sufficient. Defer until after multi-exchange flow is stable.

## NR-002: Sentry + Axiom observability
- **Status:** Deferred
- **Context:** Build Master requires Sentry error tracking, Axiom structured logging, Better Stack uptime monitoring. None configured.
- **Action needed:** Sentry wizard (interactive), Axiom dataset + token, Better Stack uptime monitor.
- **Recommendation:** High priority — runtime errors (like the GPT-5.4 max_tokens bug) are invisible without logging. Only diagnosable by inference from Supabase state.

## NR-003: Sinch credentials
- **Status:** RESOLVED 2026-03-10
- **Resolution:** All Sinch credentials set in Vercel. Webhook configured. Number `+12057010434` activated 03/12/2026 (replaced test `+12029983810`).

## NR-004: OpenAI API key
- **Status:** RESOLVED 2026-03-10
- **Resolution:** `OPENAI_API_KEY` set in Vercel. GPT-5.4 and GPT-4o-mini both verified working.

## NR-005: CRON_SECRET
- **Status:** RESOLVED (pre-existing)
- **Resolution:** Already in Vercel env vars since 11/27/25.

## NR-006: Nightly synthetic test
- **Status:** Deferred
- **Context:** Build Master requires automated nightly test simulating full SMS conversation flow.
- **Recommendation:** Build after multi-exchange flow is proven stable. Requires Sentry/logging first to capture failures.

## NR-007: Sinch trial account upgrade for production
- **Status:** BLOCKED — requires Ken's action
- **Context:** Trial account: $18.00 credit, test number expires 03/24/2026, outbound restricted to verified numbers, "Test message from Sinch:" prepended to all messages.
- **Action needed:** Upgrade Sinch account (billing), register 10DLC campaign, rent production number.
- **Recommendation:** CRITICAL before any real user testing. Budget ~$2/month for number + per-message costs.

## NR-008: Supabase old project cleanup
- **Status:** Informational
- **Context:** Old projects `hbhcwbqxiumfauidtnbz` and `bjcqstoekfdxsosssgbl` still exist. May incur costs.
- **Recommendation:** Delete after confirming no dependency. All env vars now point to `nnelylyialhnyytfeoom`.

## NR-009: Multi-exchange transcript dependency
- **Status:** Open — monitoring
- **Context:** Multi-exchange grading uses `getSessionTranscript()` to build full conversation history. Opening question must be logged to `sms_transcript_log` when session is created (by cron or manually). If transcript is empty, grading only sees the final exchange.
- **Risk:** Manual test sessions created via Supabase API may not have transcript entries for the opening question. Cron-created sessions should be fine since the cron inserts the transcript.
- **Recommendation:** Verify transcript completeness after next test. Add defensive check in grading if transcript is empty.

## NR-010: Stripe product + price setup
- **Status:** BLOCKED — requires Ken's action
- **Context:** Phase 5 billing code reads `STRIPE_PRICE_ID` env var. No Stripe product/price exists yet.
- **Action needed:** 1) Create Stripe account (if not already). 2) Create Product "DealershipIQ" with recurring price ($449/mo per location). 3) Copy price ID (price_xxx) to Vercel env var `STRIPE_PRICE_ID`. 4) Set `STRIPE_SECRET_KEY` in Vercel. 5) Create webhook endpoint pointing to `https://dealershipiq-wua7.vercel.app/api/webhooks/stripe` with events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed. 6) Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET` in Vercel.
- **Recommendation:** Use Stripe Test Mode first. Switch to Live Mode when ready for real payments.

## NR-011: Resend API key for dunning emails
- **Status:** BLOCKED — requires Ken's action
- **Context:** Dunning emails use Resend API (`sendDunningEmail()` in `src/lib/billing/dunning.ts`). Sends from `noreply@dealershipiq.com`.
- **Action needed:** 1) Create Resend account. 2) Verify domain (or use Resend's shared domain for testing). 3) Set `RESEND_API_KEY` in Vercel.
- **Recommendation:** Free tier (100 emails/day) is more than sufficient. Domain verification recommended for deliverability.

## NR-012: Pilot dealership flagging
- **Status:** RESOLVED 2026-03-11
- **Resolution:** Both existing dealerships flagged as `is_pilot = true` via Supabase Management API.

## NR-013: Phase 6 chain template seeding
- **Status:** RESOLVED 2026-03-12
- **Resolution:** 9 chain templates seeded via Supabase REST API: 3 domains (objection_handling, product_knowledge, closing_technique) × 3 difficulties (easy/medium/hard). Each template has 3 steps with deterministic branching rules. Seed script at `scripts/seed-chain-templates.ts`.

## NR-014: Phase 6 feature flag enablement for testing
- **Status:** RESOLVED 2026-03-12
- **Resolution:** All 4 Phase 6 feature flags enabled for both pilot dealerships (Demo Honda + Test Dealership): manager_quick_create_enabled, daily_challenge_enabled, scenario_chains_enabled, peer_challenge_enabled.

## NR-015: Sinch Conversation API dashboard broken
- **Status:** Open — Sinch platform issue
- **Context:** All Conversation API pages (/convapi/apps, /convapi/overview, /convapi/app/{id}) return "Oops! Something went wrong". Getting Started page works. This prevents UI verification of webhook target URL, triggers, and HMAC secret.
- **Impact:** Cannot modify webhook config through dashboard if changes needed. Webhook was configured 03/10/2026 and SMS pipeline was verified working at that time.
- **Recommendation:** Monitor. If webhook issues arise, use Sinch REST API (requires OAuth with SINCH_KEY_ID + SINCH_KEY_SECRET) or contact Sinch support.

## NR-020: Ghost tables — keep for future features
- **Status:** Informational
- **Context:** 7 tables exist in schema but are not queried by application code: prompt_versions, leaderboard_entries, usage_tracking, system_messages, employee_schedules, employee_priority_vectors, sms_delivery_log (write-only — delivery tracking without read path yet).
- **Recommendation:** Keep. All planned for future features (adaptive weighting, schedule awareness, prompt management, delivery analytics). Remove only if feature is permanently canceled.

## NR-021: Durable webhook processing queue deferred
- **Status:** Deferred by design
- **Context:** COWORK-INSTRUCTIONS specifies operational tables (processed_webhooks, sms_inbound_jobs, sms_webhook_quarantine) for durable webhook processing. Current implementation: in-memory Set + UNIQUE sinch_message_id constraint on sms_transcript_log. No retry backoff. No quarantine table.
- **Impact:** Acceptable for pilot (<5,000 webhooks/day). No retry if Vercel function crashes mid-processing. Orphaned session detector (cron every 2h) mitigates.
- **Recommendation:** Revisit at 10+ dealerships or if orphaned session rate exceeds 1%.

## NR-016: Duplicate Vercel project cleanup
- **Status:** Open — requires Ken's action
- **Context:** Two Vercel projects exist for DealershipIQ: `dealershipiq` (dealershipiq.vercel.app) and `dealershipiq-wua7` (dealershipiq-wua7.vercel.app). Both deploy from the same GitHub repo (kenchapmanpdx-png/dealershipiq-). The `dealershipiq` project has only 7 basic env vars (no SINCH_* vars) — it's incomplete/stale.
- **Impact:** Both projects deploy on every push to main, wasting build minutes ($1.13 this cycle). The stale project could confuse future work.
- **Recommendation:** Delete `dealershipiq` project (dealershipiq.vercel.app) to avoid confusion and save build minutes. Production is `dealershipiq-wua7`.
