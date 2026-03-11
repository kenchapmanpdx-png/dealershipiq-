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
