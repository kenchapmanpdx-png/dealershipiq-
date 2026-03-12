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
- **Resolution:** All Sinch credentials set in Vercel. Webhook configured. Test number `+12029983810` activated.

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
- **Context:** Trial account: $2.00 credit, test number expires 03/24/2026, outbound restricted to verified numbers, "Test message from Sinch:" prepended to all messages.
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
- **Status:** Open — requires action
- **Context:** Phase 6C Scenario Chains requires rows in `chain_templates` table. Templates define 3-day storylines with step prompts, branch rules, and difficulty levels. Without templates, chains cannot start.
- **Action needed:** Create seed script (`scripts/seed-chain-templates.ts`) or manually insert templates for objection_handling, product_knowledge, closing_technique at easy/medium/hard difficulty levels.
- **Recommendation:** Seed 3-5 templates per domain to start. Each template needs step_prompts JSONB with base_prompt, persona, branches, branch_rules for each step.

## NR-014: Phase 6 feature flag enablement for testing
- **Status:** Open — requires Ken's action
- **Context:** All Phase 6 features are deployed but OFF by default. Feature flags: manager_quick_create_enabled, daily_challenge_enabled, scenario_chains_enabled, peer_challenge_enabled.
- **Action needed:** Enable flags for test dealership in Supabase: `UPDATE feature_flags SET enabled = true WHERE dealership_id = '<test_dealership_id>' AND flag_name IN ('manager_quick_create_enabled', 'daily_challenge_enabled', 'scenario_chains_enabled', 'peer_challenge_enabled');`
- **Recommendation:** Enable one feature at a time for isolated testing. Start with manager_quick_create (simplest flow to verify).
