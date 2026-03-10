# Session State

## Current Phase
Phase 5: Billing + Self-Service
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

## What's Next
1. Run migrations on Supabase (Phase 4 + Phase 5)
2. Create commit for Phase 5
3. Create GitHub pull request
4. Set Stripe credentials in Vercel (.env.STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET)
5. Test Stripe webhook integration
6. Phase 6 (if needed): Landing page SEO, account settings, advanced billing features

## Blocked Items
See `docs/NEEDS-REVIEW.md` for credential dependencies. Phase 5 requires:
- STRIPE_SECRET_KEY (Phase 5 webhooks + checkout)
- STRIPE_WEBHOOK_SECRET (Phase 5 webhooks)
