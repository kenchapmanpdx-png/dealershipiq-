# Audit 4/4: Cross-Feature + Cross-Cutting

## Date: 2026-03-14

---

### Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 6 |
| LOW | 2 |
| INFO | 3 |

---

### Issues

#### X-001 — Training Cron + ACCEPT Handler Race (HIGH)

**Scenario:** Daily training cron sends a scenario to User A at 10:00am. Simultaneously, User A replies ACCEPT to a pending peer challenge. Both paths create a `conversation_session` and send outbound SMS.

**Evidence:**
- ISSUE — `src/app/api/cron/daily-training/route.ts:232-247`: Cron creates session + sends SMS without holding advisory lock.
- ISSUE — `src/app/api/webhooks/sms/sinch/route.ts:750-774`: ACCEPT handler creates two sessions (challenger + challenged) and sends SMS. ACCEPT handler holds advisory lock (`route.ts:198`), but cron does not acquire a lock — it iterates users in a simple for-loop (`route.ts:90`).
- VERIFIED — `src/lib/service-db.ts:287-297`: `tryLockUser()` exists and is used by webhook handler.

**Risk:** User ends up with two overlapping active sessions (one from cron, one from ACCEPT). Whichever reply arrives first gets routed to whichever `getActiveSession` returns (likely the most recent). The other session becomes orphaned.

**Mitigation:** Cron should acquire advisory lock per user before session creation, or `getActiveSession` should close/abandon any existing active session before returning.

---

#### X-002 — Two Simultaneous TRAIN: Messages (MEDIUM)

**Scenario:** Manager sends `TRAIN: situation A` and immediately sends `TRAIN: situation B` before the first finishes GPT generation.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:198`: Advisory lock acquired on phone, serializing all processing for same phone.
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:443-446`: Existing pending NOW confirmation is cleared before creating new scenario.

**Result:** Advisory lock serializes the two messages. Second TRAIN: clears the first pending confirmation. No race. **NOT AN ISSUE.**

---

#### X-003 — Manager Scenario Double-Push Race (HIGH)

**Scenario:** Training cron picks up an unpushed manager scenario at the same moment the manager replies NOW. Both attempt to push the same scenario to all reps.

**Evidence:**
- ISSUE — `src/app/api/cron/daily-training/route.ts:131-132`: Cron calls `markScenarioPushed(content.sourceId)` after selecting the scenario, but the select at `src/lib/training/content-priority.ts:69-77` reads `.is('pushed_at', null)`. Between the SELECT and the UPDATE, the NOW handler can also read `pushed_at IS NULL`.
- ISSUE — `src/app/api/webhooks/sms/sinch/route.ts:512`: `markScenarioPushedNow()` sets `pushed_at` at `src/lib/manager-create/generate.ts:180`. No atomic compare-and-swap — both paths do a non-conditional UPDATE.
- `src/lib/manager-create/generate.ts:198-203`: `markScenarioPushed()` also does unconditional UPDATE of `pushed_at`.

**Risk:** All reps receive the same scenario twice — once from NOW push, once from cron. Double sessions created.

**Mitigation:** Use an atomic `UPDATE ... SET pushed_at = now() WHERE pushed_at IS NULL RETURNING id` pattern. If zero rows returned, skip push.

---

#### X-004 — COACH Keyword Bypasses Active Session Grading Check (INFO)

**Scenario:** User has an active training session, texts COACH instead of answering.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:258-278`: COACH keyword is checked at priority 6, before the state machine routing at line 366. The active session remains active but unresponded.
- VERIFIED — `src/app/api/cron/orphaned-sessions/route.ts:21-34`: Orphaned cron catches active sessions older than 2 hours and marks them abandoned.

**Result:** By design. COACH sends a link; the active session eventually gets cleaned up by orphaned cron. No data corruption.

---

#### X-005 — Consent-Pending User Cannot Trigger Keywords (INFO)

**Scenario:** User in `pending_consent` status texts COACH, TRAIN:, CHALLENGE, etc.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:252-255`: Consent check at priority 5 returns early for `pending_consent` users, before any Phase 6 keywords at priorities 6-13.

**Result:** By design. No action possible until consent is given.

---

### Section 2: State Pollution / Stale References

#### X-006 — Error-State Sessions Not Cleaned by Orphaned Cron (MEDIUM)

**Scenario:** AI grading fails (OpenAI outage). Session transitions to `error` status. Orphaned cron never cleans it.

**Evidence:**
- ISSUE — `src/lib/service-db.ts:462`: `getOrphanedSessions()` queries `.in('status', ['active', 'grading'])`. Sessions in `error` status are excluded.
- `src/app/api/cron/orphaned-sessions/route.ts:21`: Calls `getOrphanedSessions(2)` — only active/grading.

**Risk:** Error sessions accumulate indefinitely. `getActiveSession()` queries for `active` or `grading` status, so error sessions don't block new sessions. Low functional impact but causes table bloat.

**Mitigation:** Add `'error'` to the status filter in `getOrphanedSessions()`, or add a separate cleanup query for error sessions older than 24 hours.

---

#### X-007 — Active Chain Not Cleaned on Opt-Out (MEDIUM)

**Scenario:** User has an active scenario chain, then opts out via STOP/PARAR/CANCELAR.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:240-243`: Opt-out handler calls `handleNaturalOptOut()`.
- ISSUE — Opt-out flow updates user status and records opt-out but does not close active scenario chains. `scenario_chains` rows with `status = 'active'` persist.
- VERIFIED — `src/app/api/cron/orphaned-sessions/route.ts:41-45`: Stale chain cleanup exists — chains with `last_step_at` older than 24 hours get `incrementMissedDay()` called. After enough missed days, the chain expires.

**Risk:** Chain persists until it naturally expires via missed-day counter (could be 3+ days). If user re-subscribes before expiry, the old chain resumes unexpectedly.

**Mitigation:** Opt-out handler should set active chains to `canceled` status.

---

#### X-008 — Peer Challenge EOD Correctly Distinguishes Session Types (INFO)

**Scenario:** Challenge-results cron runs at 5pm. Does it accidentally process non-challenge sessions?

**Evidence:**
- VERIFIED — `src/app/api/cron/challenge-results/route.ts:28-32`: Queries `daily_challenges` table specifically, filtered by `challenge_date` and `status = 'active'`.
- VERIFIED — Ranking uses `rankChallengeResponses(challengeId, dealershipId)` which joins against the specific challenge ID.

**Result:** No cross-contamination. Challenge results are properly scoped to the challenge's sessions.

---

### Section 3: Message Cap Enforcement

#### X-009 — Push/Encourage/Challenge-Results Bypass Message Cap (MEDIUM)

**Scenario:** User already received 3 outbound messages today. Manager replies NOW to push a scenario. Challenge-results cron sends EOD results. Both succeed despite cap.

**Evidence:**
- VERIFIED — `src/app/api/cron/daily-training/route.ts:99-110`: Message cap (3/day) enforced. Counts outbound messages in `sms_transcript_log` for today.
- ISSUE — `src/app/api/webhooks/sms/sinch/route.ts:519-544`: NOW push handler iterates reps and calls `sendSms()` without checking message cap.
- ISSUE — `src/app/api/cron/challenge-results/route.ts:106-118`: Challenge results cron sends SMS to all participants without checking message cap.
- ISSUE — Grading feedback (`sinch/route.ts:944`) is sent without cap check — this is by design (Never Naked principle: always respond to user's input).
- Chain completion SMS (`sinch/route.ts:988`) also bypasses cap.

**Risk:** Users can exceed 3 outbound/day. Not a TCPA violation (cap is business rule, not legal), but unexpected from manager's perspective.

**Mitigation:** Add cap check to NOW push and challenge-results cron. Grading feedback should remain exempt (user-initiated).

---

#### X-010 — STOP Keyword Exempt from Cap (VERIFIED)

**Evidence:**
- VERIFIED — STOP/END/CANCEL/QUIT/UNSUBSCRIBE are intercepted by Sinch before reaching webhook (`src/lib/sms.ts:155-156` comment). Our webhook never sees these.
- VERIFIED — Natural opt-out patterns (`src/lib/sms.ts:158-167`) trigger opt-out recording, not an outbound SMS response beyond the Sinch auto-reply.

**Result:** TCPA-compliant. STOP always works regardless of cap.

---

### Section 4: Feature Flag Mid-Flight Consistency

#### X-011 — Peer Challenge ACCEPT Doesn't Check Feature Flag (HIGH)

**Scenario:** Manager disables `peer_challenge_enabled` after User A sends CHALLENGE to User B. User B replies ACCEPT — the challenge proceeds.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:573`: CHALLENGE keyword handler checks `isFeatureEnabled(user.dealershipId, 'peer_challenge_enabled')` at line 573.
- ISSUE — `src/app/api/webhooks/sms/sinch/route.ts:734-816`: ACCEPT keyword handler (`handleAcceptKeyword`) does NOT check `peer_challenge_enabled`. It calls `getPendingChallengeForUser()` directly and proceeds.

**Risk:** Challenge proceeds after feature was disabled. Sessions created, SMS sent, grading occurs. Not a security issue but violates manager's intent.

**Mitigation:** Add `isFeatureEnabled(user.dealershipId, 'peer_challenge_enabled')` check at the top of `handleAcceptKeyword`.

---

#### X-012 — Challenge-Results Cron Doesn't Check Feature Flag (LOW)

**Scenario:** Manager disables `daily_challenge_enabled` mid-day. At 5pm, the challenge-results cron still processes and sends results.

**Evidence:**
- ISSUE — `src/app/api/cron/challenge-results/route.ts:28-32`: Queries `daily_challenges` by date and status, no feature flag check.

**Risk:** Low — the challenge was already active and responses collected. Sending results for an already-completed challenge is arguably correct behavior. Suppressing results would confuse participants who already responded.

---

#### X-013 — Coach Session Continues After Flag Disabled (LOW)

**Scenario:** User starts a coach session via web. Manager disables `coach_mode_enabled`. User continues chatting in the existing session.

**Evidence:**
- VERIFIED — `src/app/api/coach/session/route.ts`: POST (new session) checks `coach_mode_enabled`. Subsequent messages to an existing session (PATCH/PUT) do not re-check the flag.

**Risk:** Low — existing session continues but no new sessions can be created. Natural session expiry (30 min inactivity or max messages) will end it.

---

### Section 5: GSM-7 Compliance

#### X-014 — GSM-7 Sanitization Comprehensive (VERIFIED)

**Evidence:**
- VERIFIED — `src/lib/sms.ts:97`: `sanitizeGsm7(text)` called on every outbound message inside `sendSms()`.
- VERIFIED — `src/lib/sms.ts:19-41`: `sanitizeGsm7()` replaces smart quotes, em/en dashes, ellipsis characters, and strips all non-GSM-7 characters.
- VERIFIED — All outbound SMS in the codebase goes through `sendSms()`:
  - `src/app/api/cron/daily-training/route.ts:245`
  - `src/app/api/webhooks/sms/sinch/route.ts:183,261,265,291,317,369,381,418,431,454,479,490,533,551,620,636,660,685,700,715,728,784,800,829,846,944,988,1046`
  - `src/app/api/cron/challenge-results/route.ts:108`
- VERIFIED — `src/lib/sms.ts:99-106`: Hard truncation at 320 chars (2-segment max).

**Result:** All outbound SMS is GSM-7 safe. No gaps.

---

### Section 6: RLS Completeness

#### X-015 — All Tables Have RLS Enabled (VERIFIED)

**Evidence:**
- VERIFIED — `supabase/migrations/20260309000008_phase1k_rls_policies.sql`: RLS policies for core tables (dealerships, users, conversation_sessions, training_results, etc.).
- VERIFIED — `supabase/migrations/20260314000001_c001_c002_enable_rls.sql`: Enables RLS on `chain_templates` and `model_years` (Audit 1 C-001/C-002 fixes).
- VERIFIED — `supabase/migrations/20260313100000_c003_rls_policies.sql`: RLS for `askiq_queries`.
- VERIFIED — `supabase/migrations/20260312100000_coach_sessions_rls.sql`: RLS for `coach_sessions`.
- VERIFIED — `supabase/migrations/20260314000004_h002_standardize_phase6_rls.sql`: RLS for Phase 6 tables.

**Result:** All tables have RLS enabled. API routes using `createServerSupabaseClient()` are policy-enforced. Service-role routes (`serviceClient`) bypass RLS by design — all are in cron/webhook context with dealership_id scoping enforced in application code.

---

### Section 7: Dead-End States

#### X-016 — Pending Sessions from Sinch Failure Not Cleaned (MEDIUM)

**Scenario:** Daily training cron creates a session (status `pending`), then `sendSms()` throws because Sinch is down. Session is never updated to `active`.

**Evidence:**
- ISSUE — `src/app/api/cron/daily-training/route.ts:232-247`: Session created at line 232 (status defaults to `pending`), then `sendSms()` at line 245. If `sendSms()` throws, the catch at line 270 logs the error but the session remains `pending`.
- ISSUE — `src/lib/service-db.ts:462`: `getOrphanedSessions()` queries `.in('status', ['active', 'grading'])` — `pending` sessions are not cleaned up.

**Risk:** Pending sessions accumulate. They don't block new sessions (getActiveSession filters by active/grading), but they create data noise.

**Mitigation:** Add `'pending'` to orphaned session cleanup, or wrap session creation + SMS send in a transaction that rolls back on failure.

---

#### X-017 — Follow-Up Generation Failure Leaves Session in Error (MEDIUM)

**Scenario:** Mid-exchange (step 0 or 1), `generateFollowUp()` throws. Session transitions to `error` status.

**Evidence:**
- VERIFIED — `src/app/api/webhooks/sms/sinch/route.ts:867-1001` (handleFinalExchange) and the mid-exchange handler both call OpenAI. On failure, session is set to `error`.
- VERIFIED — `src/lib/openai.ts`: `generateFollowUp()` has a 30-second timeout and throws on failure.
- ISSUE — Error sessions are not retried. User receives `ERROR_SMS` but cannot retry. Must wait for next day's training.
- Cross-ref X-006: Error sessions not cleaned by orphaned cron.

**Risk:** User loses their training session on transient OpenAI failure. No retry mechanism.

---

#### X-018 — Content Priority Always Has Fallback (VERIFIED)

**Evidence:**
- VERIFIED — `src/lib/training/content-priority.ts:60`: `selectContent()` returns `{ type: 'adaptive' }` as final fallback.
- VERIFIED — `src/app/api/cron/daily-training/route.ts:196-217`: Adaptive path always generates a question via `getTrainingQuestion()`.

**Result:** No dead-end in content selection. If all priority tiers fail, adaptive standalone always works.

---

### Section 8: External Service Outage

#### X-019 — Resend Dedup Bug Blocks Dunning Email Retry (HIGH)

**Scenario:** Resend API is down. `sendDunningEmail()` returns false. But `billing_events` is still inserted (recording the dunning event). Next cron run sees the existing billing_event and skips the email.

**Evidence:**
- ISSUE — `src/lib/billing/dunning.ts:243-251`: The `billing_events` INSERT happens AFTER `sendDunningEmail()` but is NOT conditional on `sent === true`. Line 243 checks `if (sent) emailsSent++` but line 246-251 inserts the billing event regardless.

**Actual code flow (dunning.ts:234-251):**
```
const sent = await sendDunningEmail({...});
if (sent) emailsSent++;
// Record the dunning event for deduplication — ALWAYS RUNS
await serviceClient.from('billing_events').insert({...});
```

- `src/lib/billing/dunning.ts:199-204`: Dedup check queries `billing_events` for `dunning_{stage}` event type. If found, skips.

**Risk:** Dunning email permanently lost for that stage. Customer never receives the payment reminder. Revenue impact.

**Mitigation:** Only insert `billing_events` when `sent === true`. On failure, let the next cron run retry.

---

#### X-020 — Sinch Outage: Pending Sessions Leak (MEDIUM)

Cross-reference to X-016. When Sinch is down:
- Sessions created by daily-training cron remain in `pending` status
- Sessions created by NOW push (`sinch/route.ts:522`) also remain pending
- Sessions created by ACCEPT handler (`sinch/route.ts:750-774`) also remain pending

All these share the same root cause: session creation before SMS send, with no rollback on SMS failure.

---

#### X-021 — Stripe Concurrent Webhook Race on past_due_since (MEDIUM — accepted)

**Scenario:** Stripe sends `invoice.payment_failed` and `customer.subscription.updated` nearly simultaneously. Both read `past_due_since IS NULL` and both attempt to set it.

**Evidence:**
- `src/app/api/webhooks/stripe/route.ts:197-206`: `handleSubscriptionUpdated` checks `past_due_since` before setting.
- `src/app/api/webhooks/stripe/route.ts:278-290`: `handlePaymentFailed` also checks `past_due_since` before setting.
- Both use read-then-write pattern without transaction isolation.

**Risk:** Minor — worst case is `past_due_since` gets set twice to slightly different timestamps. Dunning stage calculation uses the stored value, so the first write wins. Second write overwrites with a near-identical timestamp. Functional impact negligible.

---

### Verification Log

| ID | Check | Result | File:Line |
|----|-------|--------|-----------|
| X-001 | Cron + ACCEPT race | ISSUE — no lock in cron | `daily-training/route.ts:90-247`, `sinch/route.ts:750` |
| X-002 | Two TRAIN: messages | VERIFIED — advisory lock serializes | `sinch/route.ts:198` |
| X-003 | Manager scenario double-push | ISSUE — no CAS on pushed_at | `content-priority.ts:69-77`, `generate.ts:198-203` |
| X-004 | COACH bypasses session | VERIFIED — by design | `sinch/route.ts:258` |
| X-005 | Consent blocks keywords | VERIFIED — by design | `sinch/route.ts:252` |
| X-006 | Error sessions not cleaned | ISSUE — orphaned cron misses error status | `service-db.ts:462` |
| X-007 | Chain not cleaned on opt-out | ISSUE — opt-out doesn't cancel chains | `sinch/route.ts:240` |
| X-008 | Challenge EOD scope | VERIFIED — properly scoped | `challenge-results/route.ts:28-32` |
| X-009 | Cap bypass on push/results | ISSUE — no cap check | `sinch/route.ts:519`, `challenge-results/route.ts:106` |
| X-010 | STOP exempt from cap | VERIFIED — Sinch intercepts | `sms.ts:155-156` |
| X-011 | ACCEPT skips flag check | ISSUE — no feature flag gate | `sinch/route.ts:734` |
| X-012 | Results cron skips flag | ISSUE — low risk, results already earned | `challenge-results/route.ts:28` |
| X-013 | Coach continues after disable | VERIFIED — low risk, natural expiry | `coach/session/route.ts` |
| X-014 | GSM-7 coverage | VERIFIED — all paths through sendSms | `sms.ts:97` |
| X-015 | RLS completeness | VERIFIED — all tables covered | multiple migrations |
| X-016 | Pending session leak | ISSUE — pending not cleaned | `daily-training/route.ts:232`, `service-db.ts:462` |
| X-017 | Follow-up failure dead-end | ISSUE — no retry mechanism | `sinch/route.ts:867` |
| X-018 | Content priority fallback | VERIFIED — adaptive always available | `content-priority.ts:60` |
| X-019 | Resend dedup bug | ISSUE — billing_event recorded on failure | `dunning.ts:243-251` |
| X-020 | Sinch outage session leak | ISSUE — cross-ref X-016 | `daily-training/route.ts:232` |
| X-021 | Stripe concurrent race | ISSUE — accepted, negligible impact | `stripe/route.ts:197,278` |

---

### Skipped (Feature Not Implemented)

Per AUDIT-3-ADVANCED.md:

| Feature | Reason |
|---------|--------|
| Streaks | No streak tracking beyond daily-training prefix |
| Rematch | No rematch keyword or flow |
| Language Switching | No SMS keyword to change `users.language` |
| Trainee Mode Toggle | No trainee-specific toggle |
| Model Launch (Hot Swap) | GPT-5.4 hardcoded, no runtime selector |
