# Session State

## Current Phase
Phase 2: SMS + Engine
Status: Core code complete, pending commit + PR

## What's Built

### Phase 1 — Schema + Auth Foundation (COMPLETE)
- 8 migrations applied to Supabase project `nnelylyialhnyytfeoom`
- 18 tables, 29 RLS policies, 9 functions
- Custom Access Token Hook enabled (JWT claims injection)
- Supabase client libraries (browser, server, middleware, service)
- Auth pages (login, reset-password, update-password, callback)
- JWT middleware route protection
- Generated TypeScript types from live schema
- PR #1 merged to main

### Phase 2 — SMS + Engine (IN PROGRESS)
Branch: `feat/phase2-sms-engine`

**Built:**
- `src/types/sinch.ts` — Sinch Conversation API types
- `src/lib/sinch-auth.ts` — OAuth 2.0 token caching + HMAC webhook verification
- `src/lib/sms.ts` — SMS send, GSM-7 validation, keyword detection, CTIA HELP response
- `src/lib/state-machine.ts` — Session state machine (pending→active→grading→completed)
- `src/lib/openai.ts` — AI grading with Structured Outputs, fallback chain, XML defense
- `src/lib/cron-auth.ts` — CRON_SECRET verification (timingSafeEqual)
- `src/lib/quiet-hours.ts` — Quiet hours enforcement (timezone-aware)
- `src/lib/rate-limit.ts` — Upstash Redis rate limiting (fail-open, no-op without credentials)
- `src/lib/service-db.ts` — Updated: getUserByPhone, getActiveSession, updateSessionStatus, insertTranscriptLog, insertTrainingResult, tryLockUser, registerOptOut, removeOptOut, insertConsentRecord, createConversationSession, getEligibleUsers, getOrphanedSessions, insertDeliveryLog, isFeatureEnabled, getFeatureFlagConfig
- `src/app/api/webhooks/sms/sinch/route.ts` — Inbound webhook: HMAC verify → 200 OK → async processing → keyword detection → advisory lock → state machine → AI grading → response SMS
- `src/app/api/cron/daily-training/route.ts` — Hourly cron: timezone scan → eligible users → create session → send question
- `src/app/api/cron/sync-optouts/route.ts` — Sinch Consents API opt-out sync
- `src/app/api/cron/orphaned-sessions/route.ts` — Abandoned session detector (>2hr threshold)
- `vercel.json` — Cron schedule configuration
- `.env.example` — Environment variable documentation
- `docs/NEEDS-REVIEW.md` — Blocked items log

**tsc --noEmit:** PASSING

**Not yet built (deferred — needs credentials):**
- Sentry integration (NR-002)
- Axiom structured logging (NR-002)
- Better Stack uptime monitoring (NR-002)
- Nightly synthetic test (NR-006)

## What's Next
1. Commit + push Phase 2 branch
2. Create Phase 2 PR
3. Phase 3: Manager Dashboard

## Blocked Items
See `docs/NEEDS-REVIEW.md` for credential dependencies.
