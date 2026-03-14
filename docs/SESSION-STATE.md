# Session State

## Current Phase
Phase: Production hardening + feature iteration
Status: Phases 1-6 deployed. Audit 1 complete — all findings remediated, 5 migrations applied to Supabase (52 RLS policies active).

## What's Built

### Phase 1 — Schema + Auth Foundation (COMPLETE)
- 8 migrations applied to Supabase project `nnelylyialhnyytfeoom`
- 18 tables, 29 RLS policies, 9 functions
- Custom Access Token Hook enabled
- Supabase client libraries, auth pages, JWT middleware
- PR #1 created

### Phase 2 — SMS + Engine (COMPLETE)
- Sinch webhook handler with HMAC verification + async processing
- AI grading with Structured Outputs + fallback chain
- Daily training cron, opt-out sync cron, orphaned session detector
- State machine, keyword detection, quiet hours, rate limiting
- 16 service-db functions
- PR created on `feat/phase2-sms-engine`

### Phase 3 — Manager Dashboard (COMPLETE)
Branch: `feat/phase3-manager-dashboard`

**API Routes (11):** team, sessions, coaching-queue, gaps, users CRUD, import, encourage, push training, ask IQ, public leaderboard
**Cron Jobs (2):** daily-digest (8 AM local), red-flag-check (every 6h)
**Dashboard Pages (5):** overview, sessions, coaching, team management, public leaderboard
**Service DB additions:** getManagersForDealership, getDailyDigestStats, getRedFlagUsers

**tsc --noEmit:** PASSING

### Phase 4 — Training Intelligence (COMPLETE)
Branch: `feat/phase4-training-intelligence`

**Libraries (7):**
1. `src/lib/adaptive-weighting.ts` — Per-employee priority vectors across domains (objection_handling, product_knowledge, closing_technique, competitive_positioning, financing)
2. `src/lib/schedule-awareness.ts` — SMS-based schedule parsing (OFF, VACATION keywords) + availability checking
3. `src/lib/persona-moods.ts` — 10 customer mood types (friendly, impatient, skeptical, enthusiastic, price_focused, indecisive, knowledgeable, emotional, time_pressured, comparison_shopper)
4. `src/lib/scoring-expansion.ts` — Behavioral scoring dimensions (urgency, competitive_positioning)
5. `src/lib/training-content.ts` — Integrates all above to generate personalized roleplay/quiz/objection scenarios
6. `src/types/vehicle.ts` — Vehicle reference data types (makes, models, trims, features, selling points, competitive sets)

**Database (1 migration):**
- `supabase/migrations/20260310000001_phase4_vehicle_tables.sql` — 6 tables: makes, models, trims, trim_features, selling_points, competitive_sets (global reference, public read)

**Service-db additions (8 functions):**
- getEmployeePriorityVector, upsertPriorityVector, getLastTrainingDomain, getAdaptiveWeightingConfig
- getEmployeeSchedule, upsertEmployeeSchedule

**tsc --noEmit:** PASSING

### Phase 5 — Billing + Self-Service (COMPLETE — REBUILT 03/11/2026)
Branch: main (direct commit)

**Types (1 new):**
- `src/types/billing.ts` — SubscriptionStatus, DunningStage, BillingState, BillingEvent, CheckoutRequest, DunningTemplate, CostEntry

**Libraries (4 new/rewritten):**
1. `src/lib/stripe.ts` — REWRITTEN: STRIPE_PRICE_ID env var (not hardcoded), 30-day trial, client_reference_id, automatic_tax, lazy Proxy pattern
2. `src/lib/billing/subscription.ts` — `checkSubscriptionAccess()` (pilot/trialing/active/past_due+14d grace), `computeDunningStage()`, `daysSinceUTC()`
3. `src/lib/billing/lookup.ts` — `findDealershipByStripeCustomer()`, `findDealershipBySubscription()`
4. `src/lib/billing/dunning.ts` — 5 dunning templates (day1/3/14/21/30), `sendDunningEmail()` via Resend, `processDunning()` cron handler, auto-cancel at day 30

**API Routes (4 new, 2 rewritten):**
- `POST /api/billing/checkout` — REWRITTEN: Creates Supabase Auth user → dealership → membership → app_metadata → Stripe Checkout
- `GET /api/billing/status` — REWRITTEN: Returns full BillingState with dunning_stage, days_remaining_in_trial, is_active
- `POST /api/webhooks/stripe` — REWRITTEN: 6 event handlers, idempotent via billing_events, Day 1 dunning from webhook
- `GET /api/admin/costs` — NEW: Ken-only per-dealership cost tracking (SMS + AI, 24h/7d/30d)
- `POST /api/onboarding/brands` — NEW: Save dealership brands post-checkout
- `POST /api/onboarding/employees` — NEW: Import employees with phone normalization

**Dashboard Pages (2 new):**
- `src/app/(dashboard)/dashboard/billing/page.tsx` — Subscription status, Customer Portal, trial countdown, pilot badge
- `src/app/(dashboard)/dashboard/onboarding/page.tsx` — 3-step wizard: brands → employees → done

**Components (1 new):**
- `src/components/dashboard/BillingBanner.tsx` — Trial countdown (last 7 days), dunning stage banners, canceled state

**Modified files (7):**
1. `src/app/(dashboard)/layout.tsx` — BillingBanner + Billing nav link (owner-only)
2. `src/app/(marketing)/signup/page.tsx` — Added password, timezone, 30-day trial messaging
3. `src/app/api/cron/daily-training/route.ts` — Subscription gating
4. `src/app/api/cron/daily-digest/route.ts` — Subscription gating
5. `src/app/api/cron/red-flag-check/route.ts` — Dunning processing piggybacked
6. `src/app/api/push/training/route.ts` — Subscription gating
7. `src/app/api/coach/session/route.ts` — Subscription gating

**Database (1 migration applied to production):**
- `supabase/migrations/20260311160000_billing_events.sql` — billing_events table (stripe_event_id UNIQUE), is_pilot + trial_ends_at columns, `has_active_subscription()` RLS function, RLS on billing_events, billing_enabled feature flag

**Subscription gating (two layers):**
- Application: `checkSubscriptionAccess()` on all 5 entry points (2 crons, push training, coach session, RLS function)
- RLS: `has_active_subscription(d_id)` — pilots, active, trialing, past_due all pass through

**Docs:**
- `docs/ENVIRONMENTS.md` — Production env var inventory + Phase 5 env vars Ken must set

**tsc --noEmit:** PASSING

### Phase 6 — Growth Features (REBUILT 03/12/2026)
Branch: main (direct commit c61c2dc)

Complete rebuild per DealershipIQ-Strategic-Build-Order-v5 spec. Old monolithic files deleted, replaced by modular structure.

**Types (2 new):**
- `src/types/challenges.ts` — ManagerScenario, GradingRubric, GeneratedScenario, DailyChallenge, ChallengeResult, PeerChallenge, DisambiguationOption
- `src/types/chains.ts` — ChainTemplate, StepPrompt, BranchTemplate, ChainContext, StepResult, ScenarioChain

**Libraries (8 new, 4 deleted):**
1. `src/lib/manager-create/generate.ts` — 6A: TRAIN: keyword → GPT-5.4 Structured Output → scenario + rubric → NOW confirmation (30-min expiry)
2. `src/lib/challenges/daily.ts` — 6B: generateDailyChallenge, getYesterdayResults, buildChallengeMorningSMS, rankChallengeResponses, buildResultsSMS
3. `src/lib/chains/branching.ts` — 6C: Deterministic branch selection from step config + previous scores
4. `src/lib/chains/templates.ts` — 6C: Template loading, selection (weakest domains + difficulty), variable substitution
5. `src/lib/chains/lifecycle.ts` — 6C: startChain, continueChain, recordChainStepResult, buildChainCompletionSMS, incrementMissedDay, getActiveChain
6. `src/lib/challenges/peer.ts` — 6D: CHALLENGE [name] → disambiguation → ACCEPT/PASS → grade both → results. 4h expiry, default wins.
7. `src/lib/training/content-priority.ts` — Content selection: manager_scenario > peer_challenge > chain_step > daily_challenge > adaptive
8. Deleted: `src/lib/scenario-chains.ts`, `src/lib/peer-challenge.ts`, `src/lib/daily-challenge.ts`, `src/lib/manager-content-create.ts`

**Database (1 migration applied to production):**
- `supabase/migrations/20260312000000_phase6_rebuild.sql`
  - NEW tables: chain_templates, manager_scenarios (with RLS + indexes)
  - ALTERed: scenario_chains (+chain_template_id, chain_context, total_steps, work_days_without_response, started_at, last_step_at, expanded status CHECK)
  - ALTERed: daily_challenges (+taxonomy_domain, persona_mood, vehicle_context, winner_user_id, participation_count, status CHECK)
  - ALTERed: peer_challenges (challenged_id/scenario_text nullable, +grading_rubric, taxonomy_domain, challenger/challenged_session_id, disambiguation_options, accepted_at, completed_at, winner_id, expanded status CHECK)
  - ALTERed: conversation_sessions (+challenge_id, scenario_chain_id, chain_step)
  - Feature flags: manager_quick_create_enabled, daily_challenge_enabled (mwf default), scenario_chains_enabled, peer_challenge_enabled (all ENABLED for pilot dealerships 03/12/2026)

**API Routes (1 new, 2 deleted):**
- `GET /api/cron/challenge-results` — EOD: ranks daily challenge responses, sends results SMS, updates challenge status
- Deleted: `/api/cron/daily-challenge`, `/api/cron/expire-challenges`

**Modified files (4):**
1. `src/app/api/cron/daily-training/route.ts` — Rewritten: content-priority system (5 tiers), chain continuation/start logic, challenge-linked sessions
2. `src/app/api/webhooks/sms/sinch/route.ts` — Phase 6 keywords: TRAIN:, NOW, CHALLENGE [name], ACCEPT, PASS, disambiguation numbers. Post-grading hooks for chain step recording + peer challenge completion.
3. `src/app/api/cron/orphaned-sessions/route.ts` — Peer challenge expiry piggybacked
4. `src/lib/service-db.ts` — createConversationSession (+challengeId, scenarioChainId, chainStep), getActiveSession returns challenge/chain fields

**vercel.json:** 7 cron routes. Vercel Pro upgrade (03/12/2026): daily-training + daily-digest now hourly (`0 * * * *`), red-flag-check every 6h (`0 */6 * * *`), orphaned-sessions every 2h (`0 */2 * * *`). Resolves C-008 timezone limitation.

**tsc --noEmit:** PASSING

### Production Deployment (COMPLETE)
Date: 03/10/2026

**Build Fixes (5 commits on main):**
1. `vercel.json` — All cron schedules changed to once-daily (Vercel Hobby plan limits crons to max 1x/day)
2. `next.config.mjs` — Added `eslint.ignoreDuringBuilds: true` + `typescript.ignoreBuildErrors: true` (92+ lint issues tracked separately)
3. `src/lib/supabase/service.ts` — Converted to lazy singleton + Proxy (env vars unavailable at build time)
4. `src/lib/stripe.ts` — Same lazy singleton + Proxy pattern (Stripe client threw at build time)
5. `src/app/page.tsx` — Deleted (conflicted with `(marketing)/page.tsx` for `/` route → caused `ENOENT` during build)

**Production URL:** `https://dealershipiq-wua7.vercel.app`
**Build result:** 35 pages (8 static, 27 dynamic/serverless)
**Landing page:** Verified live — hero, features, pricing, Sign In, Get Started all rendering

**Known non-blocking warnings:**
- `@vercel/functions` module not found (dynamic require in try/catch)
- `jose` CompressionStream/DecompressionStream Edge Runtime warnings

**Git auto-deploy:** WORKING. Confirmed via Vercel API — pushes to main trigger production deploys, branch pushes trigger preview deploys. GitHub integration metadata present on all recent deployments.

### Sinch Conversation API Configuration (UPDATED 03/10/2026)

**Sinch Project:** My first project (USD $18.00 credits — TRIAL ACCOUNT, expires 03/24/2026)

**Conversation API App:** DealershipIQ
- App ID: `01KKCA66G864KM336AZFT79X5K`
- SMS Channel: Active (Service Plan ID: `bed87a6bcbdc4ea6ab4ece8d6d999a56`)

**Webhook:**
- ID: `01KKCB5EYBDXWN7K0BPEED6RV8`
- Target: `https://dealershipiq-wua7.vercel.app/api/webhooks/sms/sinch` (FIXED — was `/sinch-v2`)
- Triggers: MESSAGE_INBOUND, MESSAGE_DELIVERY
- HMAC secret configured

**Phone Number:**
- Old (invalid): `+12085797336` — was never a provisioned number
- Previous (test): `+12029983810` — expired
- New: `+12057010434` — activated 03/12/2026
- Capabilities: SMS + VOICE
- Linked to service plan `bed87a6bcbdc4ea6ab4ece8d6d999a56`

**Verified Numbers (for outbound in trial mode):**
- `+13604485632` — Ken's phone

**Access Key:** DealershipIQ Production
- Created: 03/10/2026

**Vercel Environment Variables (dealershipiq-wua7):**
| Variable | Status |
|----------|--------|
| SINCH_PROJECT_ID | Added 03/10/2026 |
| SINCH_APP_ID | Added 03/10/2026 |
| SINCH_KEY_ID | Added 03/10/2026 |
| SINCH_KEY_SECRET | Added 03/10/2026 |
| SINCH_WEBHOOK_SECRET | Added 03/10/2026 |
| CRON_SECRET | Pre-existing (11/27/25) |
| OPENAI_API_KEY | Pre-existing (11/26/25) |
| ENABLE_SMS_SEND | Pre-existing (11/29/25) |
| NEXT_PUBLIC_BASE_URL | Pre-existing (11/27/25) |
| SINCH_SERVICE_PLAN_ID | Pre-existing (11/26/25, MVP) |
| SINCH_API_TOKEN | Pre-existing (11/26/25, MVP) |
| SINCH_PHONE_NUMBER | Updated 03/12/2026 → `+12057010434` |
| ADMIN_API_KEY | Pre-existing (11/26/25) |

### Multi-Exchange + GPT-5.4 Upgrade (03/10/2026)

**Changes deployed:**
1. **GPT-5.4 upgrade** — Primary model switched from `gpt-4o-2024-11-20` to `gpt-5.4-2026-03-05` for grading and training content. Fallback remains `gpt-4o-mini`. Applied to `openai.ts`, `manager-content-create.ts`, `scenario-chains.ts`.
2. **Multi-exchange state machine** — 3 exchanges per session for all modes. `step_index` column tracks exchange (0→1→2). Session stays `active` between exchanges, transitions to `grading` only on final exchange. Objection mode: progressive coaching between exchanges. Roleplay: customer escalation. Quiz: 3 different questions.
3. **Never Naked feedback format** — Grading system prompt rewritten: `[score]/10 ⭐ What worked: [...] Level up: [...] 💡 Pro tip: "[exact phrase]"`. Product fact hallucination explicitly forbidden.
4. **Question format cleanup** — Removed all meta-framing ("DealershipIQ Training:", "Reply with your best sales response!"). Questions now read as direct customer speech.
5. **Quiet hours** — Mon-Sat 10AM-7PM, Sun 11AM-7PM. Grading feedback and Ask IQ exempt.
6. **Weekday-only training** — Daily cron skips weekends. Uses `training_send_hour` from dealership `settings` JSONB (default 10, range 9-12).
7. **GPT-5.4 API fix** — GPT-5.4 rejects `max_tokens` param (requires `max_completion_tokens`). Added `tokenLimitParam()` helper for model-aware token limits. This was the root cause of the multi-exchange failure on first test.

**Test status:** New objection session created (a60115dd). Awaiting Ken's reply to verify full 3-exchange flow.

### Consent SMS + Knowledge Gaps Page (03/10/2026)

**Consent SMS (compliance — double opt-in):**
- `POST /api/users` and `POST /api/users/import` now send consent SMS after creating user: "[Dealership] uses DealershipIQ for sales training. Reply YES to opt in, or STOP to decline."
- Webhook intercepts all messages from `pending_consent` users before training state machine. YES/START → activate + record consent + welcome. STOP/NO → inactive + opt-out. Other → reminder.
- Non-blocking: SMS failure doesn't block user creation.
- `getUserByPhone` now returns `status` field. Added `getDealershipName()` and `updateUserStatus()` to service-db.

**Knowledge Gaps page:**
- New page at `/dashboard/gaps` — table of low-confidence Ask IQ queries from past 30 days.
- Columns: confidence badge (color-coded), question, user, topic, date. Click to expand full question + AI response.
- Added to dashboard nav bar.

**Phase 3 completion status:**
- Built: Dashboard (overview, team, sessions, coaching, gaps), daily digest cron, red flag alerts cron, push training API, consent SMS flow, encouragement SMS, CSV import, Ask IQ gaps API + UI, dealership switcher, 60s polling
- Phase 3 spec coverage: COMPLETE

### SMS Pipeline Debugging Session (03/10/2026 — RESOLVED)

**Outcome:** SMS end-to-end working. First successful inbound webhook → AI grading → outbound SMS reply delivered.

**Root causes found and fixed (7):**
1. **Supabase URL/key mismatch (3 projects):** All env vars pointed to `nnelylyialhnyytfeoom` (correct). But old MVP vars lingered in some contexts. FIXED — consolidated all Vercel env vars.
2. **Missing phone column in insertTranscriptLog:** Function never passed `phone` param to `sms_transcript_log`. Caused PostgreSQL 23502 (NOT NULL violation) on every transcript insert. FIXED — added `phone` param and updated all 13 call sites.
3. **Sinch webhook killed by 404s:** Original webhook URL (`/sinch-v2`) returned 404s, causing Sinch to permanently disable the callback. FIXED — deleted old webhook, created new (ID: `01KKCPP5P16MDCD6J0147V3VZS`).
4. **Missing mode column in insertTrainingResult:** Function signature didn't include `mode` (TRAINING_MODE column not nullable). FIXED — added to function and all call sites.
5. **Outbound SMS delivery failure code 61:** Conversation API REST wrapper returned 61 (unroutable). FIXED — switched from Conversation API wrapper to direct XMS REST API call via `/sms/xms/v1/mo_message`.
6. **Sinch REST API env vars wrong in Vercel:** `SINCH_SERVICE_PLAN_ID`, `SINCH_API_TOKEN`, `SINCH_PHONE_NUMBER` were stale MVP values. FIXED — re-set all three to correct Sinch values.
7. **OpenAI API key missing in Vercel:** `OPENAI_API_KEY` not in production env. FIXED — added to Vercel.
8. **Silent drop when no active session:** User texted but no active training session existed. System silently dropped request. FIXED — now sends "no active training session" message.

**SMS pipeline now working (verified):**
- Inbound webhook (MESSAGE_INBOUND) → User lookup by phone → Session lookup (active status) → AI grading (OpenAI GPT-4o Structured Outputs) → training_results insert → Outbound SMS via XMS REST API
- Sessions auto-complete after grading
- New sessions created by daily cron (8 AM local) or manually via manager dashboard

**Trial account info:**
- Sinch: $18.00 credit (expires 03/24/2026)
- Inbound number: `+12057010434`
- Verified outbound number: `+13604485632` (Ken's phone)
- Trial limitation: SMS body prepended with "Test message from Sinch:" — custom content still delivered

### Merged PRs

**PR #1–#5:** Phase 1–6 implementations (merged prior to this session)
**PR #6 — fix(lint): resolve all 85 ESLint errors, re-enable build checks** — MERGED
**PR #7 — feat(seo): add metadata, Open Graph, JSON-LD, sitemap, robots.txt** — MERGED

### Phase 4A — Persona Moods + Behavioral Scoring (03/11/2026)

**Database changes (migration run via Supabase SQL Editor):**
- `conversation_sessions`: Added `persona_mood TEXT`, `difficulty_coefficient FLOAT DEFAULT 1.0`
- `training_results`: Added `urgency_creation INTEGER`, `competitive_positioning INTEGER`
- `users`: Added `trainee_start_date DATE`
- Feature flags inserted: `persona_moods_enabled`, `behavioral_scoring_urgency`, `behavioral_scoring_competitive` (all enabled for test dealership)

**Persona Moods:**
- 7 moods: friendly, skeptical, rushed, price_shopping, angry_spouse, no_credit, impatient
- Tenure-based progression: Tier 1 (weeks 1-2: friendly/price_shopping), Tier 2 (weeks 3-4: +skeptical/rushed/impatient), Tier 3 (week 5+: +angry_spouse/no_credit)
- Mood injected into scenario generation prompts and AI follow-up generation
- `persona_mood` stored on conversation_sessions for analytics

**Behavioral Scoring:**
- `urgency_creation` (0-2): 0=none, 1=generic, 2=specific/natural
- `competitive_positioning` (0-2): 0=none, 1=generic, 2=specific/factual
- Dynamic JSON schema — behavioral fields only appear in grading schema when feature flags enabled
- Behavioral scoring addendum appended to grading system prompt when active

**Engagement Micro-Details:**
- First name greeting: "Hey {first_name}, [scenario]"
- Streak milestones at 3/7/14/30/60/90 days with motivational prefixes
- `getUserTenureWeeks()`, `getUserStreak()`, `getRecentScoreTrend()` helpers added to service-db

**Files modified (7):** openai.ts, service-db.ts, persona-moods.ts (rewritten), daily-training/route.ts, sinch/route.ts, training-content.ts, SQL migration

**tsc --noEmit:** PASSING

### Phase 4B/4C/4D — Vehicle Data, Schedule Awareness, Adaptive Weighting (03/11/2026)

**Phase 4B — Vehicle Data Pipeline (COMPLETE):**
- NEW vehicle tables: makes → models → model_years → trims (trim-level FKs). Dropped old model-level schema.
- Migration: `supabase/migrations/20260311_phase4b_vehicle_tables_v2.sql` — 8 tables, RLS on dealership_brands only
- fueleconomy.gov seed: `scripts/seed-vehicle-data.py` — 4 makes, 60 models, 103 model_years, 337 trims (Honda/Toyota/Hyundai/Kia, 2025-2026)
- LLM competitive intel: `scripts/generate-competitive-intel.py` — 306+ competitive_sets, 1100+ selling_points via GPT-4o-mini
- Export/import review workflow: `scripts/export-vehicle-intel.py`, `scripts/import-vehicle-intel.py`
- Prompt integration: `src/lib/vehicle-data.ts` — `getVehicleContextForScenario()` + `formatVehiclePrompt()`, feature-flag gated (`vehicle_data_enabled`)
- Training content wired: `src/lib/training-content.ts` — vehicle context injected into system prompts when flag enabled
- Types rewritten: `src/types/vehicle.ts` — TrimWithContext, VehicleContext, CompetitiveSet, SellingPoint
- Old model-level vehicle functions removed from service-db.ts
- Feature flag: `vehicle_data_enabled` (default false, enabled for test dealership)

**Phase 4C — Schedule Awareness (COMPLETE):**
- Fixed service-db schedule functions to match actual DB schema (`recurring_days_off INTEGER[]`, `one_off_absences DATE[]`)
- Schedule-awareness.ts: `dayNameToNumber()` conversion, updated `isScheduledOff()` to check both recurring days and one-off absences
- SMS webhook: OFF/VACATION keywords detected before state machine routing, parsed → schedule updated → confirmation SMS
- Daily cron: checks `isScheduledOff()` per user before sending, skips if off

**Phase 4D — Adaptive Weighting (COMPLETE):**
- `selectTrainingDomain()` wired into daily cron for per-user domain selection
- `updatePriorityVectorAfterGrading()` wired into webhook after final exchange grading
- `training_domain TEXT` column added to `conversation_sessions` and `training_results`
- Fixed `upsertPriorityVector()` to use correct column name (`last_updated_at`)
- `getActiveSession()` returns `training_domain` field
- Average score (accuracy + rapport + concern + close / 4) feeds back into priority vector

**Database (2 migrations):**
- `supabase/migrations/20260311_phase4bcd_columns.sql` — training_domain on conversation_sessions + training_results
- `supabase/migrations/20260311_phase4b_vehicle_tables_v2.sql` — Build Master vehicle schema (8 tables)

**tsc --noEmit:** PASSING

### Phase 4.5A — Coach Mode MVP (03/11/2026)

**Database (1 migration applied to production):**
- `coach_sessions` table: JSONB messages, session_topic, sentiment_trend, coaching_style, door_selected, rep_context_snapshot
- NO RLS — service_role + explicit user_id filtering (employees are phone-identified, not Supabase Auth)
- Feature flags: `coach_mode_enabled` (enabled for test dealership), `coach_proactive_outreach` (disabled)
- 3 indexes: user+created_at, dealership+created_at, session_topic

**Types (1 new):**
- `src/types/coach.ts` — CoachDoor, SessionTopic, SentimentTrend, CoachingStyle, CoachMessage, CoachSession, RepContextSnapshot, ExchangeClassification

**Libraries (3 new):**
1. `src/lib/coach/prompts.ts` — Common preamble (9 rules: AI transparency, privacy, pricing guardrails, crisis→988), door-specific prompts (tactical=AAR+word-tracks, debrief=AAR+inner-game, career=GROW), style adaptation, classify exchange tool schema
2. `src/lib/coach/context.ts` — `buildRepContext()` with parallel fetches (user, dealership, tenure, streak, priority vector, gaps, prev sessions, domain scores), `getTenureDescription()`
3. `src/lib/coach/compaction.ts` — `needsCompaction()` (>10 messages), `isMaxExchanges()` (>=20 messages), `compactMessages()` (first 8→GPT-4o-mini synopsis + last 4 full), `buildMessageHistory()`

**API Routes (4 new):**
1. `POST/GET /api/coach/session` — Start/continue sessions, lazy stale close (24h), rate limit 30/hour, GPT-4o for coaching, function calling for sentiment/topic classification, exchange limit 20
2. `GET /api/coach/context` — Internal route, admin API key auth, returns rep training snapshot
3. `GET /api/dashboard/coach-themes` — Manager JWT auth, aggregated anonymous themes/sentiment, privacy minimum 3 unique users
4. `POST /api/app/auth` — Phone + last-4-digits PWA auth, E.164 normalization, base64 session token

**PWA Pages (4 new):**
1. `src/app/app/[slug]/layout.tsx` — PWA shell with phone auth, session context, bottom tab bar (Ask IQ + Coach, Coach hidden for language=es)
2. `src/app/app/[slug]/page.tsx` — Ask IQ placeholder
3. `src/app/app/[slug]/coach/page.tsx` — Coach main: Three Doors entry, session list, chat
4. `src/app/app/[slug]/coach/[id]/page.tsx` — Continue existing session by URL

**Components (3 new):**
1. `src/components/coach/ThreeDoors.tsx` — Tactical/debrief/career entry with confidentiality notice
2. `src/components/coach/ChatInterface.tsx` — Chat UI with optimistic rendering, loading dots, error handling
3. `src/components/coach/SessionList.tsx` — Recent sessions as cards with topic/date/preview

**Modified files (4):**
1. `src/app/api/webhooks/sms/sinch/route.ts` — COACH keyword detection, feature flag check, sends coach URL via SMS
2. `src/app/(dashboard)/dashboard/page.tsx` — Coach themes card with topic breakdown and insufficient_data message
3. `src/app/api/cron/daily-digest/route.ts` — Weekly micro-insight (Monday only, positive signals, GSM-7), stale session cleanup
4. `src/lib/openai.ts` — `tokenLimitParam` exported (needed by compaction)

**tsc --noEmit:** PASSING

### Phase 4.5B — Morning Meeting Script (03/11/2026)

**Database (1 migration applied to production):**
- `meeting_scripts` table: dealership_id, script_date (unique pair), sms_text, full_script JSONB. RLS enabled (managers see own dealership).
- `red_flag_events` table: persists red-flag-check cron findings for morning script consumption. RLS enabled.
- Feature flags: `morning_script_enabled` (true default — replaces digest), `cross_dealership_benchmark` (false default)

**Types (1 new):**
- `src/types/meeting-script.ts` — MeetingScriptFullScript, MeetingScriptData, MeetingScriptResponse

**Libraries (4 new):**
1. `src/lib/meeting-script/queries.ts` — 6 data queries: getShoutout (top scorer yesterday), getTeamGap (knowledge gaps + vehicle answer lookup), getCoachingFocus (weakest domain + curated prompt), getAtRiskReps (from red_flag_events, excludes scheduled off), getTeamNumbers (completion rate + delta)
2. `src/lib/meeting-script/assemble.ts` — buildMeetingSMS (320 char limit, GSM-7), buildFullScript (JSONB), formatDetailsResponse (4-segment expanded)
3. `src/lib/meeting-script/benchmark.ts` — Cross-dealership ranking, privacy-safe (rank + total only), brand-specific when 5+ same-brand peers
4. `src/lib/meeting-script/coaching-prompts.ts` — 3 curated prompts per domain (5 domains), {top_model}/{competitor_model} variable substitution from vehicle data

**API Routes (1 new):**
1. `GET /api/dashboard/meeting-script` — Manager JWT auth, returns today's script or yesterday's fallback

**Components (1 new):**
1. `src/components/dashboard/MeetingScript.tsx` — 5 sections (shoutout, gap, coaching focus, private at-risk, numbers), time estimate badges, private section visually distinct

**Modified files (4):**
1. `src/app/api/cron/daily-digest/route.ts` — Timezone filter 8→7, morning_script_enabled flag check, parallel query execution, UPSERT meeting_scripts, backward-compatible legacy digest
2. `src/app/api/cron/red-flag-check/route.ts` — Persists findings to red_flag_events table
3. `src/app/api/webhooks/sms/sinch/route.ts` — DETAILS keyword handler for managers (returns expanded script, does not count toward daily cap)
4. `src/app/(dashboard)/dashboard/page.tsx` — MeetingScript component at top of dashboard

**tsc --noEmit:** PASSING

### Phase 6 Data Seeding (03/12/2026)

**Chain templates seeded (9 total):**
- objection_handling: Price Objection (easy), Trade-In Dispute (medium), Hostile Buyer — Payment Shock (hard)
- product_knowledge: Feature Walkthrough (easy), EV vs Hybrid Deep Dive (medium), Expert Buyer — Spec Showdown (hard)
- closing_technique: Warm Close (easy), Spouse Approval Close (medium), The Ghost — Re-engage and Close (hard)

Each template: 3 steps, deterministic branching on empathy/close_attempt/product_knowledge scores, variable substitution ({customer_name}, {vehicle}, {competitor_vehicle}).

**Feature flags enabled for both pilot dealerships:** manager_quick_create_enabled, daily_challenge_enabled, scenario_chains_enabled, peer_challenge_enabled.

**Seed script:** `scripts/seed-chain-templates.ts`

### Full Codebase Audit + Fixes (03/12/2026)

**Audit scope:** 16 feature flows, 4 cross-feature interaction scenarios, 4 cross-cutting checks.
**Findings:** 11 critical, 12 high, 14 medium, 7 low — ALL FIXED in commit a280cca.
**Audit report:** `docs/AUDIT-RESULTS.md`

**Critical fixes (highlights):**
- GSM-7 compliance: removed emoji from grading prompts, added sanitizeGsm7() to all SMS
- Database-backed idempotency for webhook dedup (was in-memory Set, lost on cold start)
- Keyword priority reordered (STOP/HELP now always checked first)
- Atomic peer challenge completion (race condition prevented)
- Chain expiry wired into orphaned-sessions cron (incrementMissedDay was never called)
- maxDuration=60 on all 7 cron routes (was defaulting to 10s timeout)
- Natural opt-out patterns no longer match during active training sessions
- HMAC-signed PWA session tokens (was base64-only)

**High fixes (highlights):**
- Vehicle data from DB in chain lifecycle (was hardcoded as CR-V)
- Message cap check (3/day) in daily training cron
- Non-atomic signup wrapped with Auth user rollback
- RLS enabled on coach_sessions (defense in depth)
- Self-challenge prevention in peer challenges

**Migration applied:** `20260312100000_coach_sessions_rls.sql` (RLS + deny-anon policy on coach_sessions)

**tsc --noEmit:** PASSING (22 files changed, +1177/-201)

### Re-Audit + Fixes (03/12/2026)

**Re-audit found 5 additional issues (all fixed in commit da036a9):**
1. Webhook route missing `maxDuration = 60` (HIGH — was added to crons but missed on webhook)
2. Coach session `authenticateRep()` not using `verifyAppToken()` HMAC verification (HIGH)
3. Hardcoded `'fallback-dev-secret'` in app/auth (HIGH)
4. Past vacation dates accepted by schedule-awareness parser (MEDIUM)
5. CSV parser doesn't handle RFC 4180 quoted fields (MEDIUM)

**Accepted/deferred:** In-memory rate limiting (NR-001), concurrent cron prevention (needs Redis), Hobby plan timezone (C-008), coach-themes user_id SELECT (false positive).

**Re-audit report:** `docs/AUDIT-RECHECK.md`
**tsc --noEmit:** PASSING

### Vercel Pro Upgrade (03/12/2026)

**Cron schedule changes:**
| Cron | Old (Hobby) | New (Pro) | Rationale |
|------|-------------|-----------|-----------|
| daily-training | `0 13 * * *` | `0 * * * *` | Hourly — covers all dealership timezones |
| daily-digest | `0 14 * * *` | `0 * * * *` | Hourly — morning brief at local hour 7 |
| red-flag-check | `0 15 * * *` | `0 */6 * * *` | Every 6h as originally designed |
| orphaned-sessions | `0 4 * * *` | `0 */2 * * *` | Every 2h — faster cleanup + peer/chain expiry |
| sync-optouts | `0 5 * * *` | `0 5 * * *` | No change (daily sufficient) |
| dunning-check | `0 16 * * *` | `0 16 * * *` | No change (daily sufficient) |
| challenge-results | `0 22 * * *` | `0 22 * * *` | No change (EOD results) |

**maxDuration changes:**
- Webhook route: 60s → 300s (Pro max for serverless; GPT-5.4 multi-exchange can stack)
- All cron routes: 60s (unchanged — sufficient)

**Resolved:** C-008 timezone limitation. H-007 comments removed from daily-training and daily-digest.

### Security Hardening (03/12/2026)

**Full security audit:** 28 findings (3 CRITICAL, 5 HIGH, 14 MEDIUM, 6 LOW). 15 code-level fixes applied in commit c28e899. RLS policy applied directly to production via Supabase SQL Editor.

**Critical fixes:**
- S-001: Fail-closed auth secret validation (no secret = reject all, not fail open)
- S-003: Removed `document.cookie` parsing for Supabase token on dashboard (XSS vector)
- S-004: Stripped phone numbers from public leaderboard API response

**High fixes:**
- S-002: In-memory rate limiting on PWA phone auth (5 attempts / 5min, 15min lockout)
- S-005: RLS `users_update_manager` WITH CHECK constrains `status` to valid values + prevents cross-dealership reassignment via `last_active_dealership_id`. Note: `role` lives on `dealership_memberships`, not `users` — role escalation guarded by separate policy.
- S-006: Real-time TCPA opt-out check before every outbound SMS

**Medium fixes:**
- S-007: Prompt injection sanitization on coach mode rep context (strip injection keywords, XML delimiters)
- S-008: TRAIN: SMS input sanitization (strip injection keywords, 500 char limit)
- S-009: Payload size limits (10KB JSON on checkout, 5MB CSV on import)
- S-012: Strip `stripe_customer_id` and `subscription_id` from billing status response
- S-013: Security headers in vercel.json (X-Frame-Options DENY, nosniff, XSS-Protection, Referrer-Policy, Permissions-Policy)
- S-014: CSV formula injection defense (strip leading =+-@\t\r)
- S-017: Timing-safe admin API key comparison on coach context route
- S-028: Remove hardcoded URL fallback in webhook route

**Low fixes:**
- S-023: .gitignore env files (.env, .env.local, .env.production)

**Deferred (needs Upstash Redis):** S-010 (Redis-backed rate limiting), S-011 (rate limit /api/ask), S-021 (global rate limiting middleware)

**tsc --noEmit:** PASSING

### Security Audit #2 (03/12/2026)

**Full re-scan:** 17 new findings (3 CRITICAL, 4 HIGH, 7 MEDIUM, 3 LOW). All previous 15 fixes verified holding. Report: `docs/SECURITY-AUDIT-2.md`

**Key findings (not yet fixed):**
- SA2-001 (CRITICAL): MeetingScript.tsx still parses auth token from document.cookie (S-003 fix missed this component)
- SA2-002 (CRITICAL): Onboarding employees endpoint inserts nonexistent columns (email, role, dealership_id) — completely broken, every import silently fails
- SA2-003 (CRITICAL): Auth callback open redirect via unvalidated `?next=` parameter
- SA2-007 (HIGH): TCPA opt-out check fails open on database error (returns false instead of true)

**Status:** Findings documented, fixes pending.

### Sinch Configuration Verification (03/12/2026)

**Verified via Sinch dashboard:**
- Phone `+12057010434`: Active, SMS+VOICE, linked to service plan `bed..a56`
- Service Plan: Active, API token confirmed
- Project ID: `a8585c34-c1b0-4e3c-8e33-4e03ed5dd94c`
- Access Key: `DealershipIQ Production` (Key ID: `819b8956-f53c-46cc-b550-e1613e64affc`)
- SMS Channel in Conversation API: Active
- Account credit: $18.00

**Verified in Vercel (dealershipiq-wua7):**
All 8 SINCH_* env vars present: SINCH_PHONE_NUMBER (updated today), SINCH_API_TOKEN, SINCH_SERVICE_PLAN_ID, SINCH_PROJECT_ID, SINCH_APP_ID, SINCH_KEY_ID, SINCH_KEY_SECRET, SINCH_WEBHOOK_SECRET.

**Webhook endpoint verified:** `GET /api/webhooks/sms/sinch` returns 405 Method Not Allowed (correct — POST only).

**Blocked:** Sinch Conversation API dashboard pages (/convapi/apps, /convapi/overview, /convapi/app/{id}) all return "Oops! Something went wrong". Cannot verify webhook target URL, triggers, or HMAC secret through dashboard. This is a Sinch platform issue. The Getting Started page works but doesn't expose webhook details.

**Note:** Two Vercel projects exist — `dealershipiq` (dealershipiq.vercel.app) and `dealershipiq-wua7` (dealershipiq-wua7.vercel.app). Production is `dealershipiq-wua7`. The `dealershipiq` project has only 7 env vars (no SINCH_ vars) and should be deleted or consolidated.

### Landing Page V2 Redesign (03/12/2026)

**Complete redesign** of `(marketing)/page.tsx` and supporting components. Prior version was basic centered layout. New version follows million-dollar-website playbook: dark surfaces, fluid typography, glass morphism, ambient gradient orbs, scroll-triggered animations.

**New components (4):**
1. `src/components/marketing/PhoneMockup.tsx` — Animated SMS conversation cycling through 3 messages (system question → rep response → AI grade 9.2/10). Phone frame with notch, status bar, typing indicator dots.
2. `src/components/marketing/ScrollReveal.tsx` — IntersectionObserver-based reveal animations with configurable direction/delay. `StaggerReveal` wrapper for sequential child animation. Both respect `prefers-reduced-motion`.
3. `src/components/marketing/AnimatedCounter.tsx` — Scroll-triggered numeric counters that parse prefix/number/suffix from strings like "<5s", "100%", "3x". Ease-out cubic over 1200ms.
4. `src/components/marketing/FAQ.tsx` — Interactive accordion with +/× icon rotation, smooth max-height transitions.

**Page sections (8):**
1. Hero — Split layout: copy left (eyebrow pill, gradient headline, dual CTAs, trust signals), PhoneMockup right
2. Metrics bar — 4 animated counters (<5s, 100%, 3x, 0)
3. Social proof — 3 testimonial cards (Marcus T./GM, Rachel K./Sales Mgr, David L./Dealer Principal)
4. Features — 6-card bento grid with SVG icons in accent containers
5. How It Works — 4 steps with gradient step numbers (01-04), connector lines
6. Pricing — $449/mo card with gradient border, 2-col feature grid, CTA
7. FAQ — 5-question interactive accordion
8. Final CTA — Ambient orbs, closing headline, large CTA button

**Design system additions (`globals.css`):**
- `gradient-border` (pseudo-element gradient mask), `step-number` (gradient text), `quote-mark`, `gradient-line`, `message-in` keyframe, `shimmer` animation

**Layout updates (`(marketing)/layout.tsx`):**
- Header: desktop nav links (Features/How It Works/Pricing anchors)
- Footer: 4-column grid (brand, description, Product links, Account links), gradient-line separator

**Fixes applied post-deploy:**
- Reduced section padding from py-24/py-32/py-40 → py-16/py-20/py-24 (excessive whitespace)
- ScrollReveal rootMargin changed from -40px → +80px (trigger before entering viewport)
- ScrollReveal translateY reduced from 32px → 20px (subtler entrance)

**Commits:** c4cdfd7 (feat: premium landing page), 27cbba2 (fix: tighten section spacing), c7f13b6 (fix: trigger scroll animations earlier)

**ESLint fixes (10 backend files):** Cleaned 12+ pre-existing issues (unused imports, let→const, unused vars) that were blocking Vercel builds.

**Architecture fixes:** Extracted `verifyAppToken` to `src/lib/app-auth.ts` and `useRepSession`/`SessionContext` to `src/lib/pwa/session-context.tsx` (both were invalid Next.js route/layout exports).

**tsc --noEmit:** PASSING

### Landing Page V2 — Phone Mockup + Hero Iterations (03/13/2026)

**PhoneMockup conversation rewritten 6 times** based on Ken's feedback:
1. Original trade-in/KBB scenario → rejected ("don't care for that conversation")
2. "I need to think about it" generic stall → rejected ("unrealistic exchange")
3. Co-buyer scenario (wife wants Hyundai) → rejected ("rep too passive", then "not trying to close — sending them home")
4. Payment objection ($640/mo) with bracketing → good structure but exchange 3 was a wasted layup
5. Restructured: exchange 2 moved to end, new middle exchange (customer dodges number, rep brackets)
6. **FINAL (Ken-authored scenario):** CR-V "sleep on it" → rep isolates hesitation to numbers → $1,500 incentives expiring Saturday → buyer reveals $500/mo target → rep closes with "under $500, drive it home tonight?" → AI grade 8.4/10 with correction (ask current payment to reframe gap)

**Key PhoneMockup specs (locked):**
- Fixed height container with auto-scroll (`h-[340px] sm:h-[380px]`)
- 36s loop timer, individual message delays tuned per-message
- Rep's incentive reply and AI grade get extra dwell time
- Labels: Customer / You / AI Coach
- AI grade includes both praise AND correction (💡 tip)
- No meta-framing, direct speech only, condensed messages

**Hero section update:**
- Added "Not another order taker." tagline between headline and subheadline
- Muted white (`text-white/50`), speaks to GM pain point of post-COVID order-taker reps

**Commits:** 779db75, 80bec9d, 587be2b, 781e568, 1fc6a40, 56ef1cc, 2e98f2a, fdb7626, 75ada8e, c6c6ae0, d6ffe11

**tsc --noEmit:** PASSING

### Department-Aware Training — Doc Patches Applied (03/13/2026)

Applied all 5 patches from `Department-Cowork-Handoff-v1.md`:

**Patch 1 — DealershipIQ-Build-Master.md:** Schema updates (department + receives_training on dealership_memberships), conversation_sessions department snapshot, department-aware training trigger, HELP keyword fix, onboarding department fields, dashboard department filter, push training department targeting, Ask IQ department context, daily digest scoping, red flag per-department, department transfer side effects, trainee mode department respect, monthly insights, adaptive weighting department-scoped, vehicle data service exception, TRAIN keyword department routing, daily/peer challenge department scoping, leaderboard department grouping, regression checkpoint, SMS cost estimate updated (30 employees × 22 days), prompt templates with employee_department tag.

**Patch 2 — COWORK-INSTRUCTIONS-v4.2.md:** Role Model table (owner/manager/employee), Department Model section, 3 Escalation Boundaries items, 2 Prohibited items, fallback table fix.

**Patch 3 — DealershipIQ-Architecture-Reference.md:** Core Data Model description updated, Role Model table (salesperson→employee), Onboarding Sequence department fields, Bulk Employee Import CSV with department, AI Grading Prompt XML `<employee_department>` tag, Vehicle Data Pipeline service department exception, Training Curriculum department-aware description, Manager Quick-Create department column, "daily sales training" → "daily training" globally, salesperson→employee in prose.

**Patch 4 — prompt templates:** Content merged into Build Master (all 5 templates include `<employee_department>`).

**Patch 5 — DealershipIQ-Feature-List.md:** New file created with Department-Aware Training feature list.

**Global text sweep:** `salesperson` → `employee` completed across all workspace docs. Codebase rename (TypeScript types, SQL migrations, API routes, AI prompts) deferred to Phase 1A migration — requires coordinated code change with new migration, type updates, and 30+ file edits.

**Verification:** All 53 checklist items verified. 50 PASS, 2 fixed during verification (missed "daily sales training" instances in Architecture Reference), 1 DEFERRED (codebase salesperson→employee rename).

### Full Code Audit #2 (03/13/2026)

**Scope:** All 95+ TypeScript files — API routes, lib services, frontend pages, components, types.
**Build status:** `tsc --noEmit` passes clean.
**Report:** `docs/FULL-CODE-AUDIT-2026-03-13.md`

**Findings:** 2 BLOCKER, 5 CRITICAL, 8 HIGH, 12 MEDIUM, 12 LOW.

### Audit #2 Fixes Applied (03/13/2026)

**16 issues fixed across 19 files (+278/-210 lines):**

| ID | Severity | Fix |
|----|----------|-----|
| B-001 | BLOCKER | PWA token: `split(':')` → `JSON.parse(atob(token))` |
| B-002 | BLOCKER | PWA auth: Added dealership slug + membership validation |
| C-001 | CRITICAL | Dunning cron: `===` → `verifyCronSecret()` timing-safe |
| C-002 | CRITICAL | Deleted dead `lib/dunning.ts`, consolidated into `billing/dunning.ts` |
| C-004 | CRITICAL | Timezone: Added local date helpers, fixed message cap + digest + Monday detection |
| C-005 | CRITICAL | Rate limit: Added error-level logging when rate limiting is disabled |
| H-001 | HIGH | Onboarding: Added manager/owner role check to employees + brands |
| H-002 | HIGH | Password: Aligned signup to 12 chars (was 8) |
| H-003 | HIGH | MeetingScript: `document.cookie` parsing → `credentials: 'include'` |
| H-005 | HIGH | AI grading: Added error logging when all models fail |
| H-006 | HIGH | Sync opt-outs: `Array.includes` → `Set.has` (O(1)) |
| H-007 | HIGH | Red flags: Added date-based dedup before inserting events |
| H-008 | HIGH | quiet-hours: Rewrote `nextSendWindow()` with UTC-safe hour deltas |
| M-004 | MEDIUM | State machine: `>=` → `===` for `isFinalExchange()` |
| M-005 | MEDIUM | XML injection: Escape `<>` in employee response |
| M-008 | MEDIUM | Training content: Defensive domain key check |

**Not fixed (deferred):**
- C-003: Service role in user routes → requires significant migration to RLS-first pattern (multi-sprint)
- H-004: Webhook SMS cache leak → low impact on Vercel (cold starts reset memory)
- M-001 through M-003, M-006, M-007, M-010, M-011: Moderate risk, deferred to next sprint
- L-001 through L-012: Low risk, deferred

**tsc --noEmit:** PASSING

### Code Audit #3 (2026-03-13)

Full v3 audit executed (10-phase methodology with red-team lens, mandatory inventories).

**New findings:** 14 (2 CRITICAL, 4 HIGH, 5 MEDIUM, 3 LOW)
**Total open findings across all audits:** 35 + C-003 (deferred)

Key new findings:
- C-010: Opt-out check fails open on DB error (TCPA — $500-$1,500/message fine)
- C-011: Stripe idempotency check ignores Supabase error object
- H-014: HELP SMS response > 160 chars (TCPA delivery risk)
- H-015: ALL_MOODS only includes TIER_3 — getMoodPromptModifier broken for TIER_1/TIER_2
- H-016: Vehicle data falls back to wrong-brand vehicles
- H-017: Promise.all kills entire consent SMS batch on single failure

**Inventories completed:**
- SMS string inventory: 44+ templates cataloged with char counts and GSM-7 compliance
- serviceClient inventory: 26 usages (16 justified, 10 unjustified — need RLS migration)

Full report: `docs/FULL-CODE-AUDIT-3-2026-03-13.md`

### Audit #3 — Tier 1 Fixes Applied (03/13/2026, commit b621b98)

**5 CRITICAL fixes across 6 files:**
- C-010: isOptedOut() now fails-closed on DB error (TCPA compliance)
- C-006: Auth callback validates ?next= redirect target
- C-007: Meeting-script drops user_metadata fallback
- C-008: User import phone lookup scoped to dealership
- C-009/C-011: Stripe idempotency check in try-catch + checks error object

### Audit #3 — Tier 2 Fixes Applied (03/13/2026, commit 9ac9dcb)

**9 HIGH fixes across 13 files:**
- H-009: Confirmed no user_metadata fallbacks anywhere (clean)
- H-010: checkSubscriptionAccess() added to all 6 dashboard routes
- H-011: Chain step recording uses atomic RPC with fallback
- H-012: JSON.parse wrapped in try-catch in manager-create
- H-013: Encourage route logs failed SMS, returns 502
- H-014: HELP response trimmed to single SMS segment (<=160 chars)
- H-015: ALL_MOODS includes all 3 tiers (was TIER_3 only)
- H-016: Vehicle data returns null instead of wrong-brand vehicles
- H-017: Consent SMS uses Promise.allSettled

**tsc --noEmit:** PASSING

**Remaining open:** 11 MEDIUM + 9 LOW + C-003 (deferred). H-011 RPC function needs to be created in Supabase SQL Editor (Ken manual step).

### Audit #3 — Tier 3+4 Fixes Applied (03/13/2026, commit a1db0d9)

**11 MEDIUM + LOW fixes across 11 files:**
- M-014: Peer challenge SMS word-boundary truncation
- M-015: Log unknown coaching prompt domains
- M-017: Onboarding brands single source of truth (no settings fallback)
- M-018: PWA slug client-side validation (clear session on URL slug change)
- M-019: Replace non-GSM-7 em-dash in sinch webhook SMS string
- M-020: SMS dedup cache evicts oldest half (was fixed 1000)
- M-021: Documented in-memory rate limit limitation (deferred to Upstash)
- M-022: getActiveChain scoped to dealershipId for tenant isolation
- L-015: In-memory rate limiting added to Ask IQ route
- L-017: buildChainCompletionSMS guards empty scores (division by zero)
- L-018: Stripe billing portal API call has 10s timeout
- L-020: PWA token expiration checked client-side
- L-021: Stripe portal URL validated before returning to client

**False positives verified:** M-013 (coach division by zero — already guarded), M-023 (daily challenge division by zero — early return), L-019 (login/reset buttons — already disabled during loading), L-016 (Sinch dedup — addressed by M-020)

**Deferred:** L-013 (coaching modal accessibility), L-014 (dashboard pagination) — frontend UX, not security/correctness. M-021 needs Upstash Redis.

**tsc --noEmit:** PASSING

### Audit Batch 1 — C-003 serviceClient → RLS Migration (03/13/2026, commit c99fa0d)
Branch: `fix/batch1-serviceclient-rls`

**10 route files migrated from serviceClient to RLS-backed authenticated client:**
- `users/route.ts` — opt-out check, user INSERT, membership INSERT → RLS. Cross-tenant phone check + rollback DELETE stay serviceClient.
- `users/[id]/route.ts` — membership SELECT, user UPDATE → RLS. serviceClient import removed entirely.
- `users/[id]/encourage/route.ts` — user+membership SELECT → RLS with `!inner` join. serviceClient import removed.
- `users/import/route.ts` — membership+optout SELECT, user+membership INSERT → RLS. serviceClient import removed.
- `onboarding/brands/route.ts` — dealership_brands UPSERT → RLS (FOR ALL policy). serviceClient import removed.
- `onboarding/employees/route.ts` — user+membership INSERT → RLS. serviceClient import removed.
- `push/training/route.ts` — user+membership SELECT → RLS with `!inner` join. serviceClient import removed.
- `dashboard/meeting-script/route.ts` — meeting_scripts SELECT → RLS. Fully migrated, no serviceClient.
- `dashboard/coach-themes/route.ts` — auth migrated to RLS. coach_sessions stays serviceClient (deny-all RLS).

**Justified serviceClient retained (14 files):** webhooks (sms/sinch, stripe), crons (4), billing/checkout, admin/costs, app/auth (PWA HMAC), coach/session (deny-all RLS), leaderboard (public endpoint), ask (no INSERT policy on askiq_queries), users/route.ts (cross-tenant phone check).

**Also fixed:** daily-digest unused import, layout.tsx hooks-order violation.

**Quality gates:** tsc ✅, eslint ✅, next build ✅

### Audit Batch 2 — Deferred Items (03/13/2026, branch `fix/batch2-deferred-items`)
See prior session for details. M-001 advisory lock, M-003 DB-backed rate limit, M-010 modal accessibility, C-005 bypass logging.

### Audit Batch 3 — Red Team Findings (03/12/2026, branch `fix/batch3-red-team-findings`)
See prior session for details. RT-001 through RT-009.

## What's Next
1. **Merge 3 audit PRs** — batch3 → batch2 → batch1 (or all into main)
2. **Create record_chain_step RPC in Supabase** — Ken manual step for H-011 atomic fix
3. **Phase 1A codebase rename** — `salesperson` → `employee` (~30 files)
4. **Ken manual steps for Phase 5:** Stripe product/price, env vars
5. Sentry/Axiom observability (NR-002)
6. Sinch production upgrade (trial expires 03/24/2026)
7. Upstash Redis for production rate limiting (M-021, L-015 upgrade)
8. Integration tests (zero exist)
9. L-013 coaching modal accessibility, L-014 dashboard pagination

## Blocked Items
- **Sinch trial account** — Test number expires 03/24/2026. $18.00 credit available.
- **Sinch Conversation API dashboard** — Platform pages broken. Use REST API.
- **Audit findings status:** 5 CRITICAL fixed, 9 HIGH fixed, 8 MEDIUM fixed (3 deferred), 5 LOW fixed (2 deferred). C-003 COMPLETE (Batch 1).

## V4 Fresh Audit (2026-03-13)

Ran 6-agent parallel audit after all prior fixes merged. Found 14 new issues.

### Branches
- `fix/audit-v4-batch3` — V4-C-001, V4-C-002: Welcome SMS ≤160 chars + hard truncation at 320
- `fix/audit-v4-batch2` — V4-H-001..H-004: Division by zero guards + V4-M-002..M-006: Robustness
- `fix/audit-v4-batch1` — V4-M-001: Error object sanitization (43 files, 62 locations) + checklist remediation

### Completion Criteria: 12/12 PASS
1. Zero serviceClient in user-facing routes — PASS (all justified with C-003 comments)
2. RLS policies verified — PASS
3. Sinch HMAC timing-safe — PASS
4. Stripe raw body signature — PASS
5. Zero PII in logs — PASS
6. Zero "sales training" in SMS — PASS
7. SMS length validation — PASS (hard truncate at 320)
8. Feature flags on gated features — PASS
9. Opt-out fail-closed — PASS
10. Stripe checkout idempotency — PASS
11. All auth from app_metadata — PASS (user_metadata documented as display-only)
12. Division by zero guards — PASS (4 locations)

### Deferred
- V4-L-001/L-002: RLS policy consistency (SQL migration needed)
- V4-L-003: vitest infrastructure (Ken action item)

### PR URLs
- Batch 3: https://github.com/kenchapmanpdx-png/dealershipiq-/pull/new/fix/audit-v4-batch3
- Batch 2: https://github.com/kenchapmanpdx-png/dealershipiq-/pull/new/fix/audit-v4-batch2
- Batch 1: https://github.com/kenchapmanpdx-png/dealershipiq-/pull/new/fix/audit-v4-batch1

## C-003 serviceClient Inventory (v5 — 2026-03-13)

### Migrated to RLS (Batch 1, prior session)
| Route | Tables | Status |
|-------|--------|--------|
| users/[id]/route.ts | users, dealership_memberships | MIGRATED — serviceClient import removed |
| users/[id]/encourage/route.ts | users, dealership_memberships | MIGRATED — serviceClient import removed |
| users/import/route.ts | users, dealership_memberships, sms_opt_outs | MIGRATED — serviceClient import removed |
| onboarding/brands/route.ts | dealership_brands | MIGRATED — serviceClient import removed |
| onboarding/employees/route.ts | users, dealership_memberships | MIGRATED — serviceClient import removed |
| push/training/route.ts | users, dealership_memberships | MIGRATED — serviceClient import removed |
| dashboard/meeting-script/route.ts | meeting_scripts | MIGRATED — serviceClient import removed |

### Migrating Now (v5)
| Route | Table | Operation | Fix |
|-------|-------|-----------|-----|
| dashboard/coach-themes | coach_sessions | SELECT | Add manager SELECT RLS policy → migrate to RLS client |
| ask/route | askiq_queries | INSERT | Add authenticated INSERT RLS policy → migrate to RLS client |

### Justified serviceClient (Stays)
| Route | Reason |
|-------|--------|
| admin/costs | Cross-tenant admin query. No single-tenant JWT can see all dealerships. Auth by email allowlist. |
| app/auth | PWA phone auth. No JWT exists. Creates HMAC session token. |
| billing/checkout | Signup bootstrap. Creates Auth user + dealership before JWT exists. admin.createUser requires service_role. |
| coach/session | PWA phone auth (HMAC token, not JWT). coach_sessions has deny-all RLS. Even with SELECT policy, no JWT to scope it. |
| leaderboard/[slug] | Public endpoint. No auth, no JWT. |
| users/route (2 calls) | Cross-tenant phone duplicate check (line 81). Rollback DELETE (line 149, no DELETE policy). All tenant-scoped queries already on RLS. |

### Cron + Webhook Routes (All Justified)
cron/daily-training, cron/daily-digest, cron/challenge-results, cron/red-flag-check, cron/sync-optouts, cron/orphaned-sessions, webhooks/sms/sinch, webhooks/stripe — No user context. serviceClient required.

---

## Audit Remediation — Completion (2026-03-13)

### Step 1: Webhook Signatures (RT-001, RT-002) — VERIFIED
- RT-001: `src/lib/sinch-auth.ts` — HMAC-SHA256 + `crypto.timingSafeEqual` + 5min replay window
- RT-002: `src/app/api/webhooks/stripe/route.ts` — `request.text()` raw body + `stripe.webhooks.constructEvent`

### Step 2: Vitest Infrastructure — DONE
- vitest + @vitest/coverage-v8 in devDependencies
- `vitest.config.ts`, `src/test/setup.ts`, `src/test/supabase-mock.ts`
- 2 test files, 17 tests, all passing

### Step 3: C-003 Service Role Migration — DONE
- SQL migration: `20260313100000_c003_rls_policies.sql` (coach_sessions SELECT, askiq_queries INSERT)
- `dashboard/coach-themes/route.ts` migrated from serviceClient to RLS
- `ask/route.ts` migrated from serviceClient to RLS
- 17 tenant isolation tests passing
- 6 justified serviceClient uses remain (inventory above)

### Step 4: Remaining Remediation — DONE
| Item | Status | Evidence |
|------|--------|----------|
| RT-003 PII in logs | FIXED | 5 files sanitized: raw err→.message, fullName removed, res.text() removed |
| RT-004 No "sales training" in SMS | PASS | `grep -rni "sales training" src/` returns 0 results |
| RT-006 Feature flags | PASS | `isFeatureEnabled` enforced in 10+ route/lib files |
| RT-007 Opt-out fail-closed | PASS | `src/lib/sms.ts` returns true on all error paths (lines 52, 68, 74) |
| RT-008 ALL_MOODS complete | PASS | `persona-moods.ts:122` — spreads all 3 tiers |
| RT-009 Stripe idempotency | PASS | `stripe.ts:41,69` — key = `checkout_${dealershipId}_${email}` |
| M-001 Advisory lock | PASS | SQL uses `pg_try_advisory_xact_lock` (transaction-scoped) |
| M-003 Coach rate limit | PASS | DB-backed `checkRateLimit()` at `coach/session/route.ts:613` |
| C-005 Rate limit disabled | PASS | `rate-limit.ts:23,40` — logs at `console.error` level |

### Quality Gates
- `npx tsc --noEmit` — PASS
- `npx vitest run` — 2 files, 17 tests, all PASS

### Supabase Applied — RLS Policies + H-011 RPC (2026-03-13)

**C-003 RLS policies applied in Supabase SQL Editor:**
- `coach_sessions_select_manager` — SELECT for authenticated managers, scoped to `get_dealership_id()` + `is_manager()`
- `askiq_insert_authenticated` — INSERT for authenticated users, scoped to `get_dealership_id()`

**H-011 `record_chain_step` RPC created:**
- Function: `public.record_chain_step(p_chain_id uuid, p_step int, p_result jsonb) → boolean`
- Language: plpgsql, SECURITY DEFINER
- Atomic check-and-update: appends step result only if step number not already present
- Returns true if chain is complete (step_results length >= total_steps)
- GRANT EXECUTE to authenticated + service_role

**Verification — 48 active RLS policies (pg_policies query output):**

| Table | Policy | Cmd |
|-------|--------|-----|
| askiq_queries | askiq_insert_authenticated | INSERT |
| askiq_queries | askiq_select | SELECT |
| coach_sessions | coach_sessions_deny_anon | ALL |
| coach_sessions | coach_sessions_select_manager | SELECT |
| consent_records | consent_insert_manager | INSERT |
| consent_records | consent_select_manager | SELECT |
| conversation_sessions | sessions_select | SELECT |
| custom_training_content | custom_training_dealership_isolation | SELECT |
| custom_training_content | custom_training_insert_manager | INSERT |
| custom_training_content | custom_training_update_manager | UPDATE |
| daily_challenges | daily_challenges_dealership_isolation | SELECT |
| daily_challenges | daily_challenges_insert_manager | INSERT |
| daily_challenges | daily_challenges_update_manager | UPDATE |
| dealership_brands | Managers manage own dealership brands | ALL |
| dealership_brands | Managers see own dealership brands | SELECT |
| dealership_memberships | memberships_delete_manager | DELETE |
| dealership_memberships | memberships_insert_manager | INSERT |
| dealership_memberships | memberships_select_own_dealership | SELECT |
| dealership_memberships | memberships_update_manager | UPDATE |
| dealerships | dealerships_select_member | SELECT |
| dealerships | dealerships_update_manager | UPDATE |
| employee_priority_vectors | priority_vectors_select | SELECT |
| employee_schedules | schedules_manage_manager | ALL |
| employee_schedules | schedules_select | SELECT |
| feature_flags | feature_flags_manage_owner | ALL |
| feature_flags | feature_flags_select | SELECT |
| knowledge_gaps | gaps_manage_manager | UPDATE |
| knowledge_gaps | gaps_select | SELECT |
| leaderboard_entries | leaderboard_select | SELECT |
| meeting_scripts | Managers see own meeting scripts | SELECT |
| peer_challenges | peer_challenges_dealership_isolation | SELECT |
| peer_challenges | peer_challenges_insert_own | INSERT |
| peer_challenges | peer_challenges_update_participant | UPDATE |
| prompt_versions | prompt_versions_select | SELECT |
| red_flag_events | Managers see own dealership red flags | SELECT |
| scenario_chains | scenario_chains_dealership_isolation | SELECT |
| scenario_chains | scenario_chains_insert_own | INSERT |
| scenario_chains | scenario_chains_update_own | UPDATE |
| sms_delivery_log | delivery_log_select_manager | SELECT |
| sms_opt_outs | opt_outs_select_manager | SELECT |
| sms_transcript_log | transcript_select_manager | SELECT |
| system_messages | system_messages_select | SELECT |
| training_results | training_results_select | SELECT |
| usage_tracking | usage_select_manager | SELECT |
| users | users_insert_manager | INSERT |
| users | users_select_own | SELECT |
| users | users_update_manager | UPDATE |
| users | users_update_own | UPDATE |

**Function verification:**
```
routine_name: record_chain_step
routine_type: FUNCTION
return_type: boolean
security_type: DEFINER
```

---

## Audit 1: Infrastructure (2026-03-13)

**Report:** `docs/AUDIT-1-INFRASTRUCTURE.md`

**Findings:** 4 Critical, 5 High, 12 Medium, 4 Low, 7 Info

### Remediation (2026-03-14) — COMPLETE

All findings remediated in code. Migrations written but not yet applied to Supabase. Build gates passing (tsc, lint, vitest, next build).

**Batch 1 (Criticals):**
- C-001 + C-002: Migration `20260314000001_c001_c002_enable_rls.sql` — enables RLS on `chain_templates` (global reference, authenticated SELECT) and `model_years` (authenticated SELECT)
- C-003: `billing_events` documented as service-role-only by design (COMMENT ON TABLE in migration)
- C-004: Migration `20260314000002_c004_meeting_scripts_policy.sql` — adds manager SELECT policy

**Batch 2 (Highs):**
- H-001: Migration `20260314000003_h001_missing_fk_indexes.sql` — 8 indexes
- H-002: Migration `20260314000004_h002_standardize_phase6_rls.sql` — 13 policies refactored from `auth.jwt()` to `get_dealership_id()`/`get_user_role()`
- H-003: C-003 comments added to 7 routes (challenge-results, daily-digest, dunning-check, red-flag-check, sync-optouts, app/auth)
- H-004: Migration `20260314000005_h004_transcript_insert_policy.sql` — INSERT policy on `sms_transcript_log`. `insertTranscriptLog()` in service-db.ts updated to accept optional RLS client. 3 routes (push/training, users/import, users/[id]/encourage) now pass authenticated client.
- H-005: Coach session C-003 comment updated to reflect 03/13 manager SELECT policy

**Batch 3 (Mediums):**
- M-001: Ghost tables logged to NEEDS-REVIEW.md (NR-020) — keep for future features
- M-002 + M-003: `ENABLE_SMS_SEND` and `APP_TOKEN_SECRET` added to `.env.example` and `docs/ENVIRONMENTS.md`
- M-004: URL vars documented — `NEXT_PUBLIC_APP_URL` (billing/Stripe), `NEXT_PUBLIC_BASE_URL` (webhook consent links)
- M-007: Durable queue deferral logged to NEEDS-REVIEW.md (NR-021)
- M-009: service-db functions verified — all include dealership_id filters

**Pre-existing lint fixes:** `supabase-mock.ts` (let→const), `tenant-isolation.test.ts` (unused var prefix)

### Migrations Applied to Supabase (2026-03-14)

All 5 migrations applied successfully via SQL Editor:
1. `20260314000001_c001_c002_enable_rls.sql` — chain_templates + model_years RLS enabled
2. `20260314000002_c004_meeting_scripts_policy.sql` — meeting_scripts manager SELECT policy
3. `20260314000003_h001_missing_fk_indexes.sql` — 8 FK indexes
4. `20260314000004_h002_standardize_phase6_rls.sql` — 12 Phase 6 policies refactored (4 tables × 3 policies each)
5. `20260314000005_h004_transcript_insert_policy.sql` — sms_transcript_log INSERT policy + billing_events comment

**Corrections during application:**
- Migration 1: `chain_templates` has no `dealership_id` column (global reference data). Changed to `USING (true)`.
- Migration 4: Production policies use `TO public` role (not `TO authenticated`). Rewrote to match. Excluded `dealership_brands` (already uses `current_setting()`) and `manager_scenarios` (zero policies in DB).

**Verification — 52 active RLS policies (pg_policies query, post-migration):**

| tablename | policyname | cmd | roles |
|---|---|---|---|
| askiq_queries | askiq_insert_authenticated | INSERT | {authenticated} |
| askiq_queries | askiq_select | SELECT | {authenticated} |
| chain_templates | chain_templates_select_authenticated | SELECT | {authenticated} |
| coach_sessions | coach_sessions_deny_anon | ALL | {public} |
| coach_sessions | coach_sessions_select_manager | SELECT | {authenticated} |
| consent_records | consent_insert_manager | INSERT | {authenticated} |
| consent_records | consent_select_manager | SELECT | {authenticated} |
| conversation_sessions | sessions_select | SELECT | {authenticated} |
| custom_training_content | custom_training_dealership_isolation | SELECT | {public} |
| custom_training_content | custom_training_insert_manager | INSERT | {public} |
| custom_training_content | custom_training_update_manager | UPDATE | {public} |
| daily_challenges | daily_challenges_dealership_isolation | SELECT | {public} |
| daily_challenges | daily_challenges_insert_manager | INSERT | {public} |
| daily_challenges | daily_challenges_update_manager | UPDATE | {public} |
| dealership_brands | Managers manage own dealership brands | ALL | {public} |
| dealership_brands | Managers see own dealership brands | SELECT | {public} |
| dealership_memberships | memberships_delete_manager | DELETE | {authenticated} |
| dealership_memberships | memberships_insert_manager | INSERT | {authenticated} |
| dealership_memberships | memberships_select_own_dealership | SELECT | {authenticated} |
| dealership_memberships | memberships_update_manager | UPDATE | {authenticated} |
| dealerships | dealerships_select_member | SELECT | {authenticated} |
| dealerships | dealerships_update_manager | UPDATE | {authenticated} |
| employee_priority_vectors | priority_vectors_select | SELECT | {authenticated} |
| employee_schedules | schedules_manage_manager | ALL | {authenticated} |
| employee_schedules | schedules_select | SELECT | {authenticated} |
| feature_flags | feature_flags_manage_owner | ALL | {authenticated} |
| feature_flags | feature_flags_select | SELECT | {authenticated} |
| knowledge_gaps | gaps_manage_manager | UPDATE | {authenticated} |
| knowledge_gaps | gaps_select | SELECT | {authenticated} |
| leaderboard_entries | leaderboard_select | SELECT | {authenticated} |
| meeting_scripts | Managers see own meeting scripts | SELECT | {public} |
| meeting_scripts | meeting_scripts_select_manager | SELECT | {authenticated} |
| model_years | model_years_select_public | SELECT | {authenticated} |
| peer_challenges | peer_challenges_dealership_isolation | SELECT | {public} |
| peer_challenges | peer_challenges_insert_own | INSERT | {public} |
| peer_challenges | peer_challenges_update_participant | UPDATE | {public} |
| prompt_versions | prompt_versions_select | SELECT | {authenticated} |
| red_flag_events | Managers see own dealership red flags | SELECT | {public} |
| scenario_chains | scenario_chains_dealership_isolation | SELECT | {public} |
| scenario_chains | scenario_chains_insert_own | INSERT | {public} |
| scenario_chains | scenario_chains_update_own | UPDATE | {public} |
| sms_delivery_log | delivery_log_select_manager | SELECT | {authenticated} |
| sms_opt_outs | opt_outs_select_manager | SELECT | {authenticated} |
| sms_transcript_log | sms_transcript_log_insert_authenticated | INSERT | {authenticated} |
| sms_transcript_log | transcript_select_manager | SELECT | {authenticated} |
| system_messages | system_messages_select | SELECT | {authenticated} |
| training_results | training_results_select | SELECT | {authenticated} |
| usage_tracking | usage_select_manager | SELECT | {authenticated} |
| users | users_insert_manager | INSERT | {authenticated} |
| users | users_select_own | SELECT | {authenticated} |
| users | users_update_manager | UPDATE | {authenticated} |
| users | users_update_own | UPDATE | {authenticated} |

**New policies (4):** chain_templates_select_authenticated, model_years_select_public, meeting_scripts_select_manager, sms_transcript_log_insert_authenticated.
**Pre-existing duplicate:** meeting_scripts has both "Managers see own meeting scripts" (old, `{public}`) and "meeting_scripts_select_manager" (new, `{authenticated}`). Both enforce dealership isolation + manager role. The old policy can be dropped in a future cleanup pass.
**Total:** 52 (up from 48 pre-migration).

---

## API Routes (32 total)

### Phase 3 — Dashboard
`GET /api/dashboard/team`, `GET /api/dashboard/sessions`, `GET /api/dashboard/coaching-queue`, `GET /api/dashboard/gaps`, `GET /api/users`, `POST /api/users`, `GET /api/users/[id]`, `PUT /api/users/[id]`, `POST /api/users/import`, `PUT /api/users/[id]/encourage`, `POST /api/push/training`, `POST /api/ask`, `GET /api/leaderboard/[slug]`

### Phase 4.5A — Coach Mode
`POST /api/coach/session`, `GET /api/coach/context`, `POST /api/app/auth`

### Phase 4.5B — Meeting Script
`GET /api/dashboard/meeting-script`, `GET /api/dashboard/coach-themes`

### Phase 5 — Billing
`POST /api/billing/checkout`, `GET /api/billing/status`, `POST /api/billing/portal`, `POST /api/webhooks/stripe`, `GET /api/admin/costs`, `POST /api/onboarding/brands`, `POST /api/onboarding/employees`

### Crons (7)
`GET /api/cron/daily-training` (hourly), `GET /api/cron/daily-digest` (hourly), `GET /api/cron/orphaned-sessions` (2h), `GET /api/cron/sync-optouts` (hourly), `GET /api/cron/red-flag-check` (6h), `GET /api/cron/dunning-check` (6h), `GET /api/cron/challenge-results` (hourly)

### Webhooks
`POST /api/webhooks/sms/sinch`, `POST /api/webhooks/stripe`

### Auth
`GET /api/auth/callback`

---

## Feature Flags

| Flag | Default | Enabled For | Used In |
|------|---------|-------------|---------|
| manager_quick_create_enabled | false | Demo Honda, Test Dealership | users/route POST |
| daily_challenge_enabled | false | Demo Honda, Test Dealership | daily-training cron |
| scenario_chains_enabled | false | Demo Honda, Test Dealership | daily-training cron |
| peer_challenge_enabled | false | Demo Honda, Test Dealership | daily-training cron |
| coach_mode_enabled | false | — | sms webhook (COACH keyword) |
| morning_script_enabled | true | — | daily-digest cron |
| cross_dealership_benchmark | false | — | meeting script |
| vehicle_data_enabled | true | — | training content generation |
| persona_moods_enabled | true | — | AI grading |
| behavioral_scoring_urgency | true | — | AI grading |
| behavioral_scoring_competitive | true | — | AI grading |
| department_content_enabled | true | — | AI prompt generation |

---

### What's Next
- Apply 5 migrations to Supabase SQL Editor
- Commit and push remediation branch
- Run Audit 2 (Core Flows) against main repo
- Verify in production
