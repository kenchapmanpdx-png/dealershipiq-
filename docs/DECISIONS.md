# Decisions Log

Append-only. Each entry records a technical or product decision with rationale.

## D-001: Sinch XMS REST API for outbound SMS
- **Date:** 2026-03-10
- **Decision:** Use Sinch XMS REST API (`/xms/v1/{servicePlanId}/batches`) instead of Conversation API REST wrapper for outbound SMS.
- **Rationale:** Conversation API wrapper returned delivery failure code 61 (unroutable). XMS direct call works. Simpler auth (Bearer token vs HMAC signing).
- **Affected files:** `src/lib/sms.ts`

## D-002: Sinch Conversation API for inbound webhooks
- **Date:** 2026-03-10
- **Decision:** Keep Sinch Conversation API webhook for inbound message processing.
- **Rationale:** Already configured, HMAC verification working. Inbound path works fine — only outbound was broken.
- **Affected files:** `src/app/api/webhooks/sms/sinch/route.ts`

## D-003: GPT-5.4 as primary AI model
- **Date:** 2026-03-10
- **Decision:** Primary model `gpt-5.4-2026-03-05` for grading, training content generation, manager content, scenario chains. Fallback `gpt-4o-mini-2024-07-18`. Keep `gpt-4o-mini` for daily-challenge and peer-challenge (speed > quality).
- **Rationale:** User requested upgrade. GPT-5.4 produces better coaching feedback and more natural customer voice.
- **Affected files:** `src/lib/openai.ts`, `src/lib/manager-content-create.ts`, `src/lib/scenario-chains.ts`

## D-004: max_completion_tokens for GPT-5.x models
- **Date:** 2026-03-10
- **Decision:** Use `tokenLimitParam()` helper that sends `max_completion_tokens` for GPT-5.x models and `max_tokens` for older models.
- **Rationale:** GPT-5.4 API rejects `max_tokens` with 400 error. Backward compat needed for gpt-4o-mini fallback.
- **Affected files:** `src/lib/openai.ts`

## D-005: Never Naked feedback format
- **Date:** 2026-03-10
- **Decision:** All grading feedback follows Never Naked format: `[score]/10 ⭐ What worked: [...] Level up: [...] 💡 Pro tip: "[exact phrase]"`
- **Rationale:** User feedback — grading was too vague, didn't name specific techniques or stats. Never Naked = every score has context, every critique has a fix.
- **Affected files:** `src/lib/openai.ts` (GRADING_SYSTEM_PROMPT)

## D-006: No meta-framing in training questions
- **Date:** 2026-03-10
- **Decision:** Training questions sent as raw customer speech. No "DealershipIQ Training:", no "Reply with your best sales response!", no labels.
- **Rationale:** User feedback — meta-framing breaks immersion. Trainees should feel like they're responding to a real customer.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`

## D-007: No product fact hallucination in grading
- **Date:** 2026-03-10
- **Decision:** Grading system prompt explicitly forbids citing specific vehicle features, specs, or comparisons unless provided in the prompt context.
- **Rationale:** User feedback — AI was grading on made-up vehicle specs. "Elaborate more on the CR-V's unique features" when no feature list was given.
- **Affected files:** `src/lib/openai.ts` (GRADING_SYSTEM_PROMPT)

## D-008: 3-exchange multi-exchange state machine
- **Date:** 2026-03-10
- **Decision:** All training modes use 3 exchanges before grading. `step_index` 0→1→2 on `conversation_sessions`. Mode-specific behavior: objection (progressive coaching + escalation), roleplay (no mid-coaching, customer escalates), quiz (3 different questions).
- **Rationale:** Single-exchange sessions were too shallow. Real sales conversations have back-and-forth.
- **Affected files:** `src/lib/state-machine.ts`, `src/lib/openai.ts`, `src/app/api/webhooks/sms/sinch/route.ts`

## D-009: Quiet hours — send windows
- **Date:** 2026-03-10
- **Decision:** Mon-Sat 10AM-7PM, Sun 11AM-7PM local time. Grading feedback and Ask IQ exempt (respond immediately regardless of time).
- **Rationale:** TCPA compliance. Don't wake people up. But don't delay feedback when someone just texted you.
- **Affected files:** `src/lib/quiet-hours.ts`, `src/app/api/webhooks/sms/sinch/route.ts`

## D-010: Weekday-only training with configurable send hour
- **Date:** 2026-03-10
- **Decision:** Daily training cron skips weekends. `training_send_hour` stored in dealership `settings` JSONB (default 10, range 9-12).
- **Rationale:** Salespeople don't want training texts on weekends. Per-dealership hour lets managers align with their schedule.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`, `src/lib/service-db.ts`, `src/lib/quiet-hours.ts`

## D-011: Supabase project consolidation
- **Date:** 2026-03-10
- **Decision:** All env vars point to single Supabase project `nnelylyialhnyytfeoom`. Old projects `hbhcwbqxiumfauidtnbz` and `bjcqstoekfdxsosssgbl` deprecated.
- **Rationale:** Three different Supabase URLs in Vercel env vars caused silent data loss. Webhook wrote to one DB, grading read from another.
- **Affected files:** Vercel env vars only

## D-012: Vercel Hobby plan — cron and deploy constraints
- **Date:** 2026-03-10
- **Decision:** Accept Hobby plan limits: max 1x/day cron frequency, env vars baked at deploy time (changes require redeploy), no serverless concurrency control.
- **Rationale:** Sufficient for current phase. Upgrade to Pro when load requires it.
- **Affected files:** `vercel.json`

## D-013: Double opt-in consent SMS flow
- **Date:** 2026-03-10
- **Decision:** When a user is added (single add or CSV import), system sends a consent SMS: "[Dealership] uses DealershipIQ for sales training. Reply YES to opt in, or STOP to decline." User stays `pending_consent` until they reply. YES/START → activate + record consent. STOP/NO → mark inactive + register opt-out. Unrecognized replies get a reminder. All messages from `pending_consent` users are intercepted before the training state machine.
- **Rationale:** TCPA compliance. Can't send training messages without explicit consent. Double opt-in is the standard for A2P SMS programs.
- **Affected files:** `src/app/api/users/route.ts`, `src/app/api/users/import/route.ts`, `src/app/api/webhooks/sms/sinch/route.ts`, `src/lib/service-db.ts`

## D-014: Non-blocking consent SMS on user creation
- **Date:** 2026-03-10
- **Decision:** Consent SMS failures don't block user creation. User is created with `pending_consent` status regardless of SMS delivery. Try/catch wraps the send.
- **Rationale:** User record integrity matters more than SMS delivery. Manager shouldn't see an error if Sinch is temporarily down. The user can be re-sent consent later.
- **Affected files:** `src/app/api/users/route.ts`, `src/app/api/users/import/route.ts`

## D-015: Phase 4 Scope Finalized
- **Date:** 2026-03-11
- **Decision:** Phase 4 scoped to 6 features executed exceptionally well, filtered through vertical-scalability lens (must work for service advisors and F&I, not just sales). Phase 4: Persona Moods (F) + Behavioral Scoring (G), Vehicle Data Pipeline, Schedule Awareness (D), Adaptive Weighting (A) with Rematch + Yesterday on the Floor enhancements. Phase 4.5 (NEW): Coach Mode MVP (text-only, tactical + debrief, training data integration, strict privacy) + Morning Meeting Script (SMS brief + dashboard card). All engagement ideas from three-source creative review (Phantom Up, Streak Freeze, Ghost Closer, etc.) deferred to validated ideas shelf with specific pull triggers. See `DealershipIQ-Phase4-CoachMode-Master-Consolidation-v1.md`.
- **Rationale:** Solo founder, pre-revenue. Can't be everything to everyone. Features must scale to F&I and service verticals without code changes.

## D-016: Persona mood tenure-based progression tiers
- **Date:** 2026-03-11
- **Decision:** Persona moods use 3-tier progression based on user tenure (weeks since `trainee_start_date` or account creation). Tier 1 (weeks 1-2): friendly + price_shopping only. Tier 2 (weeks 3-4): adds skeptical, rushed, impatient. Tier 3 (week 5+): full roster including angry_spouse, no_credit. Weighted random selection within each tier. Mood stored on `conversation_sessions.persona_mood` for analytics.
- **Rationale:** New trainees need confidence-building scenarios. Harder moods introduced gradually. Build Master spec: "Weeks 1-2: friendly/neutral only. Weeks 3-4: skeptical, rushed. Week 5+: angry, no-credit."
- **Affected files:** `src/lib/persona-moods.ts`, `src/app/api/cron/daily-training/route.ts`

## D-017: Behavioral scoring as optional 0-2 scale, feature-flag gated
- **Date:** 2026-03-11
- **Decision:** `urgency_creation` and `competitive_positioning` use 0-2 integer scale (present/absent/excellent), not 1-5 nuance scale. Only included in grading JSON schema when respective feature flags are enabled per dealership. Dynamic schema construction in `callOpenAIGrading()`. Scores saved to `training_results` columns (nullable — null when flag disabled).
- **Rationale:** Build Master: "0-2 scale, not 1-5 nuance scale." Per-dealership gating lets us enable gradually. Null columns don't break existing queries.
- **Affected files:** `src/lib/openai.ts`, `src/app/api/webhooks/sms/sinch/route.ts`, `src/lib/service-db.ts`

## D-018: Engagement micro-details as prompt-level changes
- **Date:** 2026-03-11
- **Decision:** First name greeting, streak milestones, and score trend injection are all prompt-level changes in the daily training cron. No new API routes. Streak calculation walks backward through completed sessions skipping weekends. Milestones at 3/7/14/30/60/90 days with short motivational prefix prepended to training SMS.
- **Rationale:** Build Master: "implement during 4A — prompt-level changes, near-zero cost." SMS character budget is tight — milestone messages kept under 40 chars.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`, `src/lib/persona-moods.ts`, `src/lib/service-db.ts`

## D-019: Schedule awareness uses DB schema as-is (recurring_days_off INTEGER[], one_off_absences DATE[])
- **Date:** 2026-03-11
- **Decision:** Fixed service-db and schedule-awareness to match actual Phase 1F table schema rather than altering tables. `recurring_days_off` stores 0-6 (Sun-Sat), `one_off_absences` stores ISO date strings. Added `dayNameToNumber()` conversion in schedule-awareness for SMS keyword parsing (OFF MON → 1). Schedule check runs per-user in daily cron before sending.
- **Rationale:** Phase 1F tables were created months ago with a specific schema. Altering columns risks breaking other references. Adapter pattern in service-db is cleaner.
- **Affected files:** `src/lib/service-db.ts`, `src/lib/schedule-awareness.ts`, `src/app/api/cron/daily-training/route.ts`

## D-020: Adaptive weighting domain selection in cron, weight updates in webhook
- **Date:** 2026-03-11
- **Decision:** `selectTrainingDomain()` called per-user in daily cron (domain selection at send time). `updatePriorityVectorAfterGrading()` called in webhook after final exchange grading (weight update at grade time). Average of 4 core scores feeds priority vector. `training_domain` stored on both `conversation_sessions` and `training_results` for traceability. Graceful degradation: domain selection failure falls back to random mode selection.
- **Rationale:** Build Master: "Daily training cron queries employee_priority_vectors and calls weighted selection." Weight updates happen naturally after grading in webhook flow. Two-column tracking enables dashboard analytics on domain distribution.
- **Affected files:** `src/app/api/cron/daily-training/route.ts`, `src/app/api/webhooks/sms/sinch/route.ts`

## D-021: Vehicle tables — trim-level FKs, drop old model-level schema
- **Date:** 2026-03-11
- **Decision:** New schema: makes → models → model_years → trims. competitive_sets uses vehicle_a_trim_id / vehicle_b_trim_id. selling_points uses trim_id. Old model-level vehicle functions removed from service-db. Global reference tables (no RLS) except dealership_brands (tenant-scoped).
- **Rationale:** Build Master spec requires trim-level granularity for accurate competitive comparisons. Model-level FKs couldn't differentiate between trim variants (e.g., CR-V LX vs CR-V EX-L).
- **Affected files:** `supabase/migrations/20260311_phase4b_vehicle_tables_v2.sql`, `src/lib/service-db.ts`, `src/types/vehicle.ts`

## D-022: Vehicle context injection — feature-flag gated, graceful degradation
- **Date:** 2026-03-11
- **Decision:** `getVehicleContextForScenario()` checks `vehicle_data_enabled` flag per dealership. Returns null when disabled. `training-content.ts` catches errors and proceeds without vehicle data. Vehicle specs injected into system prompt (not user prompt) with explicit instruction to only use provided data.
- **Rationale:** Vehicle data pipeline is new and may have gaps. Feature flag allows per-dealership rollout. Graceful degradation ensures training never breaks due to vehicle data issues.
- **Affected files:** `src/lib/vehicle-data.ts`, `src/lib/training-content.ts`

## D-023: Scripts use environment variables only — no hardcoded secrets
- **Date:** 2026-03-11
- **Decision:** All Python scripts (seed, generate, export, import) read credentials from env vars only. Empty defaults with early exit if missing. GitHub push protection caught hardcoded keys — removed from history.
- **Rationale:** Security best practice. GitHub push protection blocks commits with secrets.
- **Affected files:** `scripts/*.py`

## D-024: Coach Mode — GPT-4o for coaching, GPT-4o-mini for classification/compaction
- **Date:** 2026-03-11
- **Decision:** GPT-4o for coaching responses (emotional nuance). GPT-4o-mini for sentiment/topic classification and message compaction (speed + cost).
- **Rationale:** Coaching requires empathy and nuanced language. Classification is mechanical. Cost optimization without quality loss.
- **Affected files:** `src/app/api/coach/session/route.ts`, `src/lib/coach/compaction.ts`

## D-025: Coach Mode — no RLS, service_role with explicit user_id filtering
- **Date:** 2026-03-11
- **Decision:** coach_sessions table has NO RLS. All access via service_role client with explicit `.eq('user_id', userId)` filtering. Phone-based auth token (base64 of userId:dealershipId:firstName:language:timestamp) validated in API routes.
- **Rationale:** Employees don't have Supabase Auth accounts. Phone-based PWA auth uses custom token. RLS requires `auth.uid()` which doesn't exist for employee sessions.
- **Affected files:** `supabase/migrations/20260311120000_coach_sessions.sql`, `src/app/api/coach/session/route.ts`

## D-026: Coach Mode — manager NEVER sees individual session content
- **Date:** 2026-03-11
- **Decision:** Dashboard coach-themes endpoint returns ONLY aggregated topic/sentiment counts. Minimum 3 unique users required. No session IDs, no message text, no user attribution.
- **Rationale:** Privacy is core to coaching trust. Build Master: "Manager will never read or review individual coaching sessions."
- **Affected files:** `src/app/api/dashboard/coach-themes/route.ts`

## D-027: Coach Mode — scoring dimensions for rep context (not training domains)
- **Date:** 2026-03-11
- **Decision:** Rep context snapshot uses the 4 scoring dimensions (product_accuracy, tone_rapport, addressed_concern, close_attempt) not training domains (objection_handling, etc.) for trend analysis. These map to actual `training_results` columns.
- **Rationale:** `getRecentScoreTrend()` accepts scoring dimension names as parameter. Training domains are content categories, not measurable scoring axes.
- **Affected files:** `src/lib/coach/context.ts`

## D-028: Morning script replaces daily digest, same cron slot
- **Date:** 2026-03-11
- **Decision:** Morning meeting script is the UPGRADED daily digest. Same cron, no new slot (budget 6/40). `morning_script_enabled` flag controls behavior: true → morning script, false → legacy digest. Timezone filter changed from hour 8 to hour 7 (arrives before 8am meeting).
- **Rationale:** Cron budget constraint. One cron handles both formats. Feature flag allows gradual rollout and instant rollback.
- **Affected files:** `src/app/api/cron/daily-digest/route.ts`

## D-029: No LLM calls in script generation
- **Date:** 2026-03-11
- **Decision:** Morning meeting script uses pure query + template + curated prompts. Coaching focus prompts are a hand-curated lookup table (3 per domain, 5 domains). Variable substitution ({top_model}, {competitor_model}) from vehicle data. Random selection for MVP; rotation tracking deferred.
- **Rationale:** Zero LLM cost for script generation. Curated prompts are more actionable than generated ones. Spec explicitly requires no LLM calls.
- **Affected files:** `src/lib/meeting-script/coaching-prompts.ts`, `src/lib/meeting-script/assemble.ts`

## D-030: Red flag events persisted for morning script consumption
- **Date:** 2026-03-11
- **Decision:** Red-flag-check cron now INSERTs findings into `red_flag_events` table in addition to sending SMS alerts. Morning script queries this table instead of re-running detection logic. Single source of truth for at-risk data.
- **Rationale:** Spec: "Do NOT re-query the same signals as the red-flag-check cron. Instead, consume the red flag system's output." Persisting eliminates duplicated detection logic.
- **Affected files:** `src/app/api/cron/red-flag-check/route.ts`, `src/lib/meeting-script/queries.ts`

## D-031: Cross-dealership benchmark — privacy-safe, brand-aware
- **Date:** 2026-03-11
- **Decision:** Benchmark only runs when `cross_dealership_benchmark` flag enabled AND 3+ active dealerships. Returns only rank + total + brand label. Same-brand ranking used when 5+ same-brand dealerships. Never exposes other dealerships' names, scores, or rep data.
- **Rationale:** Privacy is paramount. Relative ranking provides competitive motivation without revealing competitors' data.
- **Affected files:** `src/lib/meeting-script/benchmark.ts`

## D-032: Idempotent webhook processing via billing_events table
- **Date:** 2026-03-11
- **Decision:** Every Stripe webhook event checked against `billing_events.stripe_event_id` (UNIQUE constraint) before processing. Skip if exists. Record after processing (success or failure). Error payload stored in billing_events for debugging.
- **Rationale:** Build Master: "highest-risk code in the system." Stripe may retry webhooks. Duplicate processing would corrupt subscription state.
- **Affected files:** `src/app/api/webhooks/stripe/route.ts`

## D-033: Two-layer subscription gating (application + RLS)
- **Date:** 2026-03-11
- **Decision:** Application layer: `checkSubscriptionAccess()` returns boolean, called on 5 entry points. Pilots always pass. Trialing checks expiry. Active passes. Past_due gets 14-day grace. RLS layer: `has_active_subscription(d_id)` SQL function — lighter check (pilots, active, trialing, past_due all pass; no grace period logic). Application code handles nuance; RLS is the safety net.
- **Rationale:** Defense in depth. Application code handles business logic (grace periods, dunning). RLS prevents data leaks even if application check is bypassed.
- **Affected files:** `src/lib/billing/subscription.ts`, `supabase/migrations/20260311160000_billing_events.sql`

## D-034: Dunning piggybacked on red-flag-check cron (no new cron slot)
- **Date:** 2026-03-11
- **Decision:** `processDunning()` called at the end of the red-flag-check cron (runs every 6h). No dedicated dunning cron. Day 1 email sent immediately from webhook; Days 3/14/21/30 from cron. Deduplication via billing_events table (dunning_email_{stage}_{dealershipId}).
- **Rationale:** Cron budget (6/40 on Vercel Hobby). Red-flag-check already runs frequently. Dunning doesn't need its own slot.
- **Affected files:** `src/app/api/cron/red-flag-check/route.ts`, `src/lib/billing/dunning.ts`

## D-035: STRIPE_PRICE_ID env var, not hardcoded price
- **Date:** 2026-03-11
- **Decision:** `createCheckoutSession()` reads `STRIPE_PRICE_ID` from env. No hardcoded $449/mo. Allows price changes without code deploy.
- **Rationale:** Pricing will change. Env var is a deploy-time config, not a code change.
- **Affected files:** `src/lib/stripe.ts`

## D-036: Self-service signup creates full account before Stripe Checkout
- **Date:** 2026-03-11
- **Decision:** Signup flow: create Supabase Auth user → dealership row (with slug) → user row → membership → set app_metadata → then redirect to Stripe Checkout. `client_reference_id` = dealershipId for webhook correlation. If dealership creation fails, auth user is cleaned up.
- **Rationale:** Webhook needs a dealership to update. Creating the account first means checkout.session.completed can immediately link Stripe customer to existing dealership. Alternative (create on webhook) risks orphaned Stripe subscriptions.
- **Affected files:** `src/app/api/billing/checkout/route.ts`

## D-037: Computed dunning stage, not stored in DB
- **Date:** 2026-03-11
- **Decision:** `computeDunningStage()` calculates dunning stage at read time from `subscription_status` + `past_due_since` + `daysSinceUTC()`. No dunning_stage column in dealerships table.
- **Rationale:** Storing stage creates staleness risk. Computing from past_due_since is always correct. Avoids cron job to update stage column.
- **Affected files:** `src/lib/billing/subscription.ts`

## D-038: is_pilot flag for permanent free access
- **Date:** 2026-03-11
- **Decision:** `dealerships.is_pilot` BOOLEAN DEFAULT false. Pilots bypass all subscription checks (application + RLS). Must be set manually in DB by Ken.
- **Rationale:** Test dealerships and early partners need permanent free access. Flag is simpler than creating fake subscriptions.
- **Affected files:** `src/lib/billing/subscription.ts`, `supabase/migrations/20260311160000_billing_events.sql`
