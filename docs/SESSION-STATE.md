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

### Phase 5 — Billing + Self-Service (COMPLETE)
Branch: `feat/phase5-billing-self-service`

**Libraries (2):**
1. `src/lib/stripe.ts` — Stripe API wrapper (checkout, billing portal, subscription status, webhook signature verification)
2. `src/lib/dunning.ts` — Dunning stage calculations (6 stages: past_due → 30-day cancellation)

**API Routes (6):**
- `POST /api/billing/checkout` — Create Stripe Checkout session (no auth, new signups)
- `POST /api/billing/portal` — Create Stripe Customer Portal session (auth-protected, manager+)
- `GET /api/billing/status` — Get subscription status (auth-protected)
- `POST /api/webhooks/stripe` — Webhook handler (checkout.session.completed, subscription.*, invoice.*)
- `GET /api/cron/dunning-check` — Daily dunning check (10 AM UTC)

**Marketing Pages (3):**
- `src/app/(marketing)/layout.tsx` — Marketing layout (no sidebar, minimal nav)
- `src/app/(marketing)/page.tsx` — Landing page (hero, features, pricing)
- `src/app/(marketing)/signup/page.tsx` — Self-service signup (dealership name, email, locations → Stripe Checkout)

**Database (1 migration):**
- `supabase/migrations/20260310000002_phase5_billing_columns.sql` — Add stripe_customer_id, subscription_status, subscription_id, max_locations, current_period_end, past_due_since to dealerships table

**Service-db additions (4 functions):**
- updateDealershipBilling() — Update billing columns
- getDealershipByStripeCustomer() — Lookup dealership by Stripe customer ID
- getPastDueDealerships() — Get all dealerships with past_due subscriptions
- createDealershipWithManager() — Create dealership + manager account from signup

**npm package:** stripe (20.4.1)

**vercel.json:** Added dunning-check cron (0 10 * * *)

**tsc --noEmit:** PASSING

### Phase 6 — Growth Features (COMPLETE)
Branch: `feat/phase6-growth-features`

**Libraries (4):**
1. `src/lib/scenario-chains.ts` — Progressive 3-day storylines (Day N grading feeds Day N+1 scenario generation)
2. `src/lib/peer-challenge.ts` — Head-to-head training with CHALLENGE [name] keyword parsing, 4-hour expiry, no-show default wins
3. `src/lib/daily-challenge.ts` — Team leaderboard push (morning: send challenge + previous day top 3; evening: grade all responses, text top 3)
4. `src/lib/manager-content-create.ts` — SMS-based content creation (CREATE: scenario idea → AI formats → approval flow)

**Database (1 migration):**
- `supabase/migrations/20260310000003_phase6_growth_tables.sql` — 4 tables: scenario_chains, daily_challenges, peer_challenges, custom_training_content (all with RLS policies)

**Service-db additions (18 functions):**
- Scenario chains: getScenarioChain, getScenarioChainByUserDealership, createScenarioChain, updateScenarioChain
- Daily challenges: createDailyChallenge, getDailyChallenge, getDailyChallengeByChallengeDate, updateDailyChallenge
- Peer challenges: createPeerChallenge, getPeerChallenge, getPeerChallengesForUser, updatePeerChallenge, getExpiredPeerChallenges
- Custom training: createCustomTrainingContent, getCustomTrainingContent, updateCustomTrainingContent, getPendingApprovals, getApprovedContent
- Helpers: getUserByName, getEligibleUsersForChallenge

**API Routes (2):**
- `GET /api/cron/daily-challenge` — Morning: create challenge + send to team; Evening: grade responses + send top 3 leaderboard
- `GET /api/cron/expire-challenges` — Hourly: mark expired peer challenges, award default wins

**AI Integration:**
- Added `getOpenAICompletion()` helper to `src/lib/openai.ts` for generic text completion (not structured output)
- Supports scenario generation, content formatting, peer challenge grading

**vercel.json:** Added 2 new cron routes (daily-challenge, expire-challenges)

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

**Phase 4B — Vehicle Data Pipeline:**
- Vehicle tables (makes, models, trims, trim_features, selling_points, competitive_sets) confirmed applied
- Added 3 vehicle query functions to service-db: `getVehicleModelsForDealership()`, `getCompetitiveSet()`, `getSellingPoints()`
- Types in `src/types/vehicle.ts` (VehicleProfile, Make, Model, Trim, etc.)
- Ready for seed data import and prompt injection integration

**Phase 4C — Schedule Awareness:**
- Fixed service-db schedule functions to match actual DB schema (`recurring_days_off INTEGER[]`, `one_off_absences DATE[]`)
- Schedule-awareness.ts: `dayNameToNumber()` conversion, updated `isScheduledOff()` to check both recurring days and one-off absences
- SMS webhook: OFF/VACATION keywords detected before state machine routing, parsed → schedule updated → confirmation SMS
- Daily cron: checks `isScheduledOff()` per user before sending, skips if off

**Phase 4D — Adaptive Weighting:**
- `selectTrainingDomain()` wired into daily cron for per-user domain selection
- `updatePriorityVectorAfterGrading()` wired into webhook after final exchange grading
- `training_domain TEXT` column added to `conversation_sessions` and `training_results`
- Fixed `upsertPriorityVector()` to use correct column name (`last_updated_at`)
- `getActiveSession()` returns `training_domain` field
- Average score (accuracy + rapport + concern + close / 4) feeds back into priority vector

**Database (1 migration):**
- `supabase/migrations/20260311_phase4bcd_columns.sql` — training_domain on conversation_sessions + training_results

**Files modified (4):** service-db.ts, schedule-awareness.ts, daily-training/route.ts, sinch/route.ts

**tsc --noEmit:** PASSING

## What's Next
1. **Vehicle data seeding** — Seed Honda/Toyota/Hyundai/Kia makes/models/trims into vehicle tables
2. **Prompt injection** — Wire vehicle specs into training scenario generation
3. **Phase 4.5 — Coach Mode MVP** — coaching PWA, morning meeting script
4. Sentry/Axiom observability (NR-002)
5. Sinch production upgrade (NR-007 — trial expires 03/24/2026)

## Blocked Items
- **Sinch trial account** — Test number expires 03/24/2026. $20 deposit processing (up to 1 day). Multi-segment SMS fails until credit clears. Single-segment still works.
