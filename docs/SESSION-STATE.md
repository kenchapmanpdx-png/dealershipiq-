# Session State

## Current Phase
Phase 6: Growth Features
Status: COMPLETE

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

**vercel.json:** Added 2 new cron routes (daily-challenge, expire-challenges) at `0 * * * *` schedule

**tsc --noEmit:** PASSING

### Sinch Conversation API Configuration (COMPLETE)

**Sinch Project:** My first project (USD $2.00 test credits)

**Conversation API App:** DealershipIQ
- App ID: `01KKCA66G864KM336AZFT79X5K`
- SMS Channel: Active (Service Plan ID: `bed87a6bcbdc4ea6ab4ece8d6d999a56`)

**Webhook:**
- ID: `01KKCB5EYBDXWN7K0BPEED6RV8`
- Target: `https://dealershipiq-wua7.vercel.app/api/webhooks/sms/sinch-v2`
- Triggers: MESSAGE_INBOUND, MESSAGE_DELIVERY
- HMAC secret configured

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
| SINCH_PHONE_NUMBER | Pre-existing (11/26/25, MVP) |
| ADMIN_API_KEY | Pre-existing (11/26/25) |

## What's Next
1. Run Phase 4-6 migrations on Supabase
2. Merge PRs in order: Phase 2 → 3 → 4 → 5 → 6
3. Test Sinch webhook end-to-end (send SMS → verify inbound webhook fires)
4. Test Phase 6 features:
   - Scenario chains: Create chain → advance to step 2 → check narrative continuity
   - Daily challenges: Create challenge → submit responses → verify leaderboard grading
   - Peer challenges: Test CHALLENGE keyword parsing → expiration handling
   - Manager content: Test CREATE: keyword → AI formatting → approval flow
5. Integration testing: Verify crons fire correctly (daily-challenge, expire-challenges)
6. Post-Phase 6: Landing page SEO, advanced account settings, or Phase 7 features

## Blocked Items
None. Phase 6 is complete and Sinch Conversation API configured. All TypeScript checks passing.
