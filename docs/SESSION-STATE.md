# Session State

## Current Phase
Phase: SMS Pipeline debugging (Phase 2 prerequisite)
Status: SMS END-TO-END WORKING — first successful grading + SMS reply delivered

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

**vercel.json:** 7 cron routes (removed daily-challenge + expire-challenges, added challenge-results at 10pm UTC)

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

**Sinch Project:** My first project (USD $2.00 test credits — TRIAL ACCOUNT)

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
- New (test): `+12029983810` — activated 03/10/2026, expires 03/24/2026, $0/month
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
| SINCH_PHONE_NUMBER | Updated 03/10/2026 → `+12029983810` |
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
- Sinch: $2.00 credit (expires 03/24/2026)
- Inbound number: `+12029983810` (SMS + VOICE capable)
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

## What's Next
1. **Phase 6 end-to-end testing:** Test TRAIN:/NOW/CHALLENGE/ACCEPT/PASS keywords via SMS (requires Sinch trial to still be active)
2. **Ken manual steps for Phase 5:** Create Stripe product/price, set STRIPE_PRICE_ID + STRIPE_WEBHOOK_SECRET + RESEND_API_KEY in Vercel, configure Stripe webhook endpoint (see NR-010, NR-011)
3. Sentry/Axiom observability (NR-002)
4. Sinch production upgrade (NR-007 — trial expires 03/24/2026)
5. Verify 3-exchange objection flow

## Blocked Items
- **Sinch trial account** — Test number expires 03/24/2026. $20 deposit processing (up to 1 day). Multi-segment SMS fails until credit clears. Single-segment still works.
