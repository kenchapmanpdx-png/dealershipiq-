# Needs Review

## NR-001: Upstash Redis credentials needed for rate limiting (Phase 2F)
- **Status:** Blocked on credentials
- **Context:** Rate limiting module (`src/lib/rate-limit.ts`) built with fail-open pattern. Passes through all requests when `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` not set.
- **Action needed:** Create Upstash Redis database, add env vars to Vercel.
- **Recommendation:** Free tier sufficient for launch. Can defer until after Sinch integration testing.

## NR-002: Sentry + Axiom setup (Phase 2G observability)
- **Status:** Blocked on credentials / wizard setup
- **Context:** Build Master requires Sentry error tracking, Axiom structured logging, Better Stack uptime monitoring.
- **Action needed:**
  1. Sentry: `npx @sentry/wizard -i nextjs` (interactive — needs manual run)
  2. Axiom: Create dataset, get token, install `next-axiom`
  3. Better Stack: Create uptime monitor for webhook endpoint
- **Recommendation:** Run Sentry wizard after Phase 2 merge. Axiom and Better Stack can be Phase 2.1 follow-up.

## NR-003: Sinch credentials needed for SMS testing
- **Status:** Blocked on credentials
- **Context:** All SMS code references `SINCH_PROJECT_ID`, `SINCH_APP_ID`, `SINCH_KEY_ID`, `SINCH_KEY_SECRET`, `SINCH_WEBHOOK_SECRET`.
- **Action needed:** Provide Sinch Conversation API credentials and set in Vercel env vars.

## NR-004: OpenAI API key needed for grading
- **Status:** Blocked on credentials
- **Context:** `OPENAI_API_KEY` required for AI grading (`src/lib/openai.ts`).
- **Action needed:** Provide OpenAI API key and set in Vercel env vars.

## NR-005: CRON_SECRET generation
- **Status:** Can self-resolve
- **Context:** Cron endpoints require `CRON_SECRET` Bearer token. Generate a 64-char random string.
- **Recommendation:** Will generate and set in Vercel during deployment phase.

## NR-006: Nightly synthetic test (Phase 2G acceptance criteria)
- **Status:** Deferred
- **Context:** Build Master requires automated nightly test simulating full SMS conversation flow. Needs working Sinch + OpenAI credentials to implement.
- **Recommendation:** Build after credentials available and basic SMS flow verified manually.
