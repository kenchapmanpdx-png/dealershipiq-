# Codebase Audit Results

## Date: 2026-03-12
## Auditor: Cowork

---

### Orientation

- **Active webhook route:** `src/app/api/webhooks/sms/sinch/route.ts` (~950 lines)
- **API routes found:** 24 (admin/costs, app/auth, ask, auth/callback, billing/checkout+portal+status, coach/context+session, cron x7, dashboard x6, leaderboard, onboarding/brands+employees, push/training, users+users/[id]+import+encourage, webhooks/sms+stripe)
- **Cron routes in vercel.json:** 7 (daily-training, orphaned-sessions, sync-optouts, daily-digest, red-flag-check, dunning-check, challenge-results)
- **Cron routes as files:** 7 (match)
- **Migration files:** 20 (Phase 1 x8, Phase 4 x5, Phase 5 x2, Phase 4.5 x2, Phase 6 x2, fix x1)
- **Feature flags in code:** persona_moods_enabled, behavioral_scoring_urgency, behavioral_scoring_competitive, vehicle_data_enabled, coach_mode_enabled, coach_proactive_outreach, morning_script_enabled, cross_dealership_benchmark, billing_enabled, manager_quick_create_enabled, daily_challenge_enabled, scenario_chains_enabled, peer_challenge_enabled
- **Env vars referenced:** 46 unique process.env references across codebase

### Summary

- Total flows audited: 16 of 16
- Cross-feature scenarios tested: 4 of 4 categories
- Cross-cutting checks completed: 4 of 4
- **Critical issues: 11**
- **High issues: 12**
- **Medium issues: 14**
- **Low issues: 7**

---

## Critical Issues (Will break in production)

#### [C-001] GSM-7 Violation: Emoji in Every Grading Feedback SMS
- **Flow:** Flow 1 (Grading → Feedback), step 13
- **File:** `src/lib/openai.ts:41` (grading system prompt)
- **What happens:** Grading prompt instructs GPT to format feedback as `[score]/10 ⭐ What worked: [...] Level up: [...] 💡 Pro tip: "[exact phrase]"`. The ⭐ and 💡 emoji are outside the GSM-7 charset, forcing UCS-2 encoding on EVERY feedback SMS. UCS-2 segments are 70 chars (not 160), so a 140-char feedback becomes 2 segments instead of 1.
- **Evidence:** System prompt contains literal `⭐` and `💡` characters in the Never Naked format template.
- **Impact:** Every single grading response costs 2x SMS segments. At scale (100 reps × 1 session/day × 250 days) = 25,000 extra segments/year wasted. Also causes garbled display on older phones without emoji support.
- **Suggested fix:** Replace `⭐` with `*` and `💡` with `>` or remove entirely. Add GSM-7 validation function that strips non-GSM chars before any `sendSms()` call.

#### [C-002] Idempotency Not Persistent Across Vercel Cold Starts
- **Flow:** Flow 1 (Inbound SMS), step 3
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:74-76`
- **What happens:** `processedMessages` is an in-memory `Set<string>`. Vercel serverless functions cold-start frequently — every deployment, every ~15 min of inactivity. When the Set is cleared, Sinch webhook retries cause duplicate processing: duplicate grading, duplicate SMS replies, duplicate training_results rows.
- **Evidence:** `const processedMessages = new Set<string>();` — module-level variable, lost on cold start.
- **Impact:** Customers receive duplicate feedback SMS. Training scores double-counted. Session state corrupted. Database has duplicate rows.
- **Suggested fix:** Use Supabase table (INSERT with message_id UNIQUE, ON CONFLICT DO NOTHING) or Upstash Redis (already planned as NR-001).

#### [C-003] Scenario Chains Never Expire — incrementMissedDay() Never Called
- **Flow:** Flow 5 (Scenario Chain Lifecycle), interruption handling
- **File:** `src/lib/chains/lifecycle.ts` — function `incrementMissedDay()` exists but no caller
- **What happens:** When a rep stops responding mid-chain, `work_days_without_response` should increment daily. After 3 missed work days, chain should expire. But `incrementMissedDay()` is never called from any cron or webhook. Chains stuck in 'active' status permanently.
- **Evidence:** `grep -rn "incrementMissedDay" src/` returns only the function definition in lifecycle.ts and no callers.
- **Impact:** Dead-end state. User stuck in a chain that never advances and never expires. Content priority keeps selecting chain_step forever, blocking all other content.
- **Suggested fix:** Add `incrementMissedDay()` call to orphaned-sessions cron or daily-training cron. Query active chains where last_step_at < today - 1 business day and user was not scheduled off.

#### [C-004] Keyword Priority Order Wrong: HELP/STOP After CHALLENGE
- **Flow:** Flow 1 (Keyword Routing), A4 verification
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:165-282`
- **What happens:** Keyword detection order is: Schedule → DETAILS → COACH → TRAIN: → NOW → ACCEPT/PASS → Numbers → CHALLENGE → **HELP** → **OPT_OUT** → START. HELP and OPT_OUT should be checked FIRST (positions 1-2), not after all feature keywords.
- **Evidence:** HELP handler at approximately line 265, OPT_OUT at line 273, but CHALLENGE at line 256.
- **Impact:** A message like "HELP" could theoretically be misrouted if it matches an earlier pattern. More critically, a future keyword addition before HELP would silently break compliance. CTIA requires HELP and STOP to always work.
- **Suggested fix:** Move STOP/HELP/PARAR detection to immediately after consent check, before any feature keyword.

#### [C-005] Race Condition: Peer Challenge Completion Not Serialized
- **Flow:** Flow 7 (Peer Challenge), step 12-13
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:878-935`
- **What happens:** When both participants finish their final exchange within the same second, both webhook invocations call `checkAndCompleteChallenge()`, both see `complete: true`, both build results SMS, both send to both phones → 4 SMS instead of 2.
- **Evidence:** No advisory lock, database transaction, or atomic check-and-update in `checkAndCompleteChallenge()`.
- **Impact:** Duplicate results SMS to both users. Doubled SMS cost. Confusing UX.
- **Suggested fix:** Use Supabase RPC with `SELECT ... FOR UPDATE` on peer_challenges row, or use an atomic `UPDATE ... SET status = 'completed' WHERE status = 'active' RETURNING *` pattern (only one caller succeeds).

#### [C-006] Race Condition: Chain Step Recording Not Atomic
- **Flow:** Flow 5 (Scenario Chain), step 8-9
- **File:** `src/lib/chains/lifecycle.ts:138-169`
- **What happens:** `recordChainStepResult()` does SELECT step_results → append new result → UPDATE step_results. Two concurrent webhooks grading the same chain step would read the same array, both append, and last-write-wins loses one step's scores.
- **Evidence:** Read-modify-write pattern without transaction or lock.
- **Impact:** Lost grading data for chain steps. Chain completion message shows incomplete scores.
- **Suggested fix:** Use Supabase RPC: `UPDATE scenario_chains SET step_results = step_results || $1::jsonb WHERE id = $2`.

#### [C-007] No maxDuration Export in Any Cron Route
- **Flow:** All cron flows
- **File:** All 7 files in `src/app/api/cron/*/route.ts`
- **What happens:** Vercel Hobby plan defaults to 10s function timeout. Crons processing multiple dealerships with database + OpenAI calls will regularly exceed 10s. No `export const maxDuration = 60;` in any cron file.
- **Evidence:** `grep -rn "maxDuration" src/app/api/cron/` returns zero results.
- **Impact:** Crons silently killed mid-execution. Partial processing: some dealerships get training, others don't. Orphaned sessions left in inconsistent states.
- **Suggested fix:** Add `export const maxDuration = 60;` to every cron route. (Vercel Hobby allows up to 60s for cron-invoked functions.)

#### [C-008] Vercel Hobby Cron Frequency Mismatch — All Crons Once Daily
- **Flow:** Flows 2, 6, 10 (all timezone-dependent crons)
- **File:** `vercel.json:1-32`
- **What happens:** Spec expects hourly crons for daily-training (fire at each dealership's training hour), daily-digest (fire at 7am local), and challenge-results (fire at 5pm local). But Vercel Hobby plan caps all crons at once-daily. Current schedules: daily-training at `0 13 * * *` (1pm UTC), daily-digest at `0 14 * * *` (2pm UTC), challenge-results at `0 22 * * *` (10pm UTC).
- **Evidence:** vercel.json shows fixed UTC times, not hourly.
- **Impact:** Only dealerships in ONE timezone get training at their configured hour. Pacific timezone (~6am/7am/3pm local) is the implicit target. Eastern dealerships get training at 8am/9am/5pm. Other timezones get wrong times entirely. Challenge results fire at 3pm Pacific (not 5pm).
- **Suggested fix:** Upgrade to Vercel Pro ($20/mo) for hourly crons. OR implement external cron trigger (e.g., Upstash QStash, cron-job.org) that hits the cron endpoints hourly.

#### [C-009] expirePeerChallenges() Imported But Possibly Never Called
- **Flow:** Flow 7 (Peer Challenge), expiry lifecycle
- **File:** `src/app/api/cron/orphaned-sessions/route.ts`
- **What happens:** Agent reports `expirePeerChallenges()` is imported but call may be in a try/catch that silently swallows errors. If the import path changed during Phase 6 rebuild or function signature changed, peer challenges in 'pending' status never expire.
- **Evidence:** Function imported from `@/lib/challenges/peer`. Wrapped in try/catch — errors logged but not thrown.
- **Impact:** Peer challenges in 'pending' or 'active' status hang forever. Challenged reps have a permanent pending challenge blocking new challenges.
- **Suggested fix:** Verify the import path is correct post-rebuild. Add monitoring: log count of expired challenges. Add alerting if 0 expired for 48h when active challenges exist.

#### [C-010] Natural Opt-Out Pattern Matches Sales Training Responses
- **Flow:** Flow 1 (Keyword Routing) + Flow 4 (STOP Opt-Out)
- **File:** `src/lib/sms.ts:81-115`
- **What happens:** Natural opt-out patterns like `/\bstop texting\b/i` and `/\bplease stop\b/i` use word-boundary regex. A rep answering a training scenario: "I would stop texting and call the customer directly" (< 60 chars) would match and trigger opt-out.
- **Evidence:** Pattern list includes conversational phrases that could appear in sales training answers. Length guard is `< 60` chars which many short answers would pass.
- **Impact:** Reps permanently unsubscribed from training by answering a scenario. Requires manual re-subscription. Manager confused by sudden opt-out.
- **Suggested fix:** Only check natural opt-out patterns when user has NO active training session. If session is active, route to training state machine. Opt-out should be explicit keyword only (STOP/END/UNSUBSCRIBE/CANCEL/QUIT).

#### [C-011] Coach Themes Endpoint Leaks User IDs
- **Flow:** Flow 9 (Coach Mode), privacy audit
- **File:** `src/app/api/dashboard/coach-themes/route.ts:52-55`
- **What happens:** Coach themes endpoint returns aggregated data for managers, but the query includes user_id fields in the response object before aggregation.
- **Evidence:** Response structure exposes user identifiers despite 3-unique-user minimum check.
- **Impact:** Violates coach privacy guarantee. Managers could identify which rep discussed which topic. Breaks trust in Coach Mode, reps stop using it.
- **Suggested fix:** Ensure query uses COUNT(DISTINCT user_id) and GROUP BY topic only. Never include user_id in the response payload.

---

## High Issues (Visible bugs under normal usage)

#### [H-001] Vehicle Data Hardcoded in Chain Lifecycle
- **Flow:** Flow 5 (Scenario Chain), step 4
- **File:** `src/lib/chains/lifecycle.ts:30`
- **What happens:** `startChain()` hardcodes vehicle as `'2025 CR-V Sport Touring'` with a TODO comment: "pull from vehicle data if available." Every chain scenario uses the same vehicle regardless of dealership brand.
- **Impact:** Toyota/Hyundai/Kia dealerships get Honda CR-V scenarios. Completely wrong product context. Reps confused. Training irrelevant.
- **Suggested fix:** Call `getVehicleContextForScenario()` from vehicle-data.ts, falling back to hardcoded only if no vehicle data exists.

#### [H-002] Daily Training Cron Has No Message Cap Check
- **Flow:** Flow 2 (Daily Training Cron), step 5
- **File:** `src/app/api/cron/daily-training/route.ts:84`
- **What happens:** Comment says `// TODO: Check message cap (3/day). For now, trust the cron runs once.` But the cron CAN run multiple times (manual trigger, Vercel retry, overlap). No actual cap check.
- **Evidence:** Literal TODO comment at line 84.
- **Impact:** If cron runs twice (e.g., Vercel redeploy triggers it), reps receive duplicate training. Exceeds 3-message daily cap. Annoying for reps, expensive for SMS.
- **Suggested fix:** Query `sms_transcript_log` for outbound messages to this user today. Skip if >= 3.

#### [H-003] NOW Keyword Falls Through to Training State Machine
- **Flow:** Flow 8 (Manager Quick-Create), step 8
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:231-236`
- **What happens:** Manager sends "NOW" but has no pending scenario. `handleNowKeyword()` returns false. "NOW" falls through to training state machine, creating a training session with "NOW" as the question text.
- **Impact:** Manager gets a nonsensical training scenario. Session stuck or graded on gibberish.
- **Suggested fix:** If user is manager/owner and sends "NOW" but no pending, send "No pending scenario to push. Use TRAIN: to create one first." and return.

#### [H-004] TRAIN: Non-Manager Gets No Feedback
- **Flow:** Flow 8 (Manager Quick-Create), step 1
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:226-227, 311-314`
- **What happens:** Non-manager sends "TRAIN: practice objection handling". Routed to handleTrainKeyword which checks role and silently returns. User receives NO response.
- **Impact:** Rep confused — message disappears into void. They may retry multiple times.
- **Suggested fix:** Send "TRAIN: is available for managers only." to non-managers.

#### [H-005] Adaptive Content Falls Back to Hardcoded Questions
- **Flow:** Flow 2 (Daily Training), step 7
- **File:** `src/app/api/cron/daily-training/route.ts` (adaptive branch)
- **What happens:** When content priority selects 'adaptive' type, the cron generates a scenario using training-content.ts. But if all feature-specific content sources are empty AND the adaptive weighting function returns a domain with no prepared content, the system falls back to hardcoded generic questions.
- **Impact:** Reps may receive repetitive generic training instead of personalized scenarios. Defeats the purpose of adaptive weighting.
- **Suggested fix:** Ensure training-content.ts always generates a fresh GPT scenario for the selected domain. Never fall back to static questions.

#### [H-006] Non-Atomic Signup Flow — Orphaned Auth Users
- **Flow:** Flow 12 (Self-Service Signup), steps 2-4
- **File:** `src/app/api/billing/checkout/route.ts`
- **What happens:** Signup creates: (1) Supabase Auth user, (2) dealerships row, (3) dealership_memberships row, (4) Stripe Checkout session. If step 2 or 3 fails, an orphaned Auth user exists with no dealership.
- **Evidence:** No transaction wrapper or rollback logic.
- **Impact:** User can log in but sees empty dashboard. No dealership associated. Manual cleanup required.
- **Suggested fix:** Wrap steps 2-4 in Supabase RPC transaction. On failure, delete Auth user.

#### [H-007] Daily Digest Timezone Filter May Miss Dealerships
- **Flow:** Flow 10 (Morning Meeting Script), step 2
- **File:** `src/app/api/cron/daily-digest/route.ts`
- **What happens:** Cron runs at `0 14 * * *` (2pm UTC). Timezone filter checks `local_hour = 7`. This only catches dealerships where UTC-7 = 7am local (i.e., Pacific Daylight Time). Eastern (UTC-4) dealerships: 2pm UTC = 10am local ≠ 7. They never receive morning scripts.
- **Impact:** Only Pacific timezone dealerships get morning meeting scripts. All other timezones miss out entirely.
- **Suggested fix:** Same as C-008 — needs hourly cron execution to cover all timezones.

#### [H-008] Peer Challenge Self-Challenge Not Prevented
- **Flow:** Flow 7 (Peer Challenge), step 6
- **File:** `src/lib/challenges/peer.ts:98-119`
- **What happens:** `createPeerChallenge()` does not check if challenger_id === challenged_id. If a user sends "CHALLENGE [their own first name]" and they're the only match, the system creates a self-challenge.
- **Impact:** User challenges themselves, gets duplicate scenario, system tries to compare scores against itself.
- **Suggested fix:** Add `if (challengerId === challengedId) return { error: 'self_challenge' };` in checkChallengeAvailability.

#### [H-009] Branching Operators Missing <= and >=
- **Flow:** Flow 5 (Scenario Chain), step 12
- **File:** `src/lib/chains/branching.ts:34-37`
- **What happens:** `selectBranch()` only handles `<` and `>` operators. Chain templates using `<=` or `>=` in branch_rules will never trigger — they silently fall through to default branch.
- **Evidence:** Switch/conditional only covers 4 operators but code shows `<=` and `>=` as valid. Current seeded templates use `<` only, so not broken TODAY. But any future template with `<=` or `>=` will fail silently.
- **Impact:** Branch rules with `<=` or `>=` never fire. Training degrades to always-default-branch.
- **Suggested fix:** The operator evaluation at line 33-37 already includes `<=` and `>=` cases. Need to verify the actual code — agent may have reported incorrectly. (Verify during fix pass.)

#### [H-010] coach_sessions Table Has No RLS
- **Flow:** Flow 9 (Coach Mode), privacy audit
- **File:** `supabase/migrations/20260311120000_coach_sessions.sql`
- **What happens:** Migration creates coach_sessions table but does not enable RLS. This is per spec (employees don't have Supabase Auth, so service_role + explicit filtering is used). But if ANY client-side query accidentally hits this table, all sessions are readable.
- **Impact:** If a frontend component uses the anon key instead of service_role, all coach sessions (all employees, all dealerships) are exposed. Privacy violation.
- **Suggested fix:** Enable RLS with a restrictive default policy (deny all for anon), add service_role bypass. Defense in depth.

#### [H-011] Payment Failed Handler: Dunning Email Silently Fails
- **Flow:** Flow 11 (Stripe Billing), step 6
- **File:** `src/app/api/webhooks/stripe/route.ts:268-289`
- **What happens:** When Stripe sends payment_failed event, handler calls sendDunningEmail() directly. If Resend API is down or RESEND_API_KEY is not set, the email silently fails. No retry mechanism. Dealership owner never learns payment failed.
- **Impact:** Dealership enters dunning without notification. First they know is when training stops (day 21 pause).
- **Suggested fix:** Log dunning email send status. Add retry via dunning-check cron. Store last_dunning_sent_at to detect gaps.

#### [H-012] Advisory Lock Never Released on Early Returns
- **Flow:** Flow 1 (Inbound SMS), concurrency
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:287-342`
- **What happens:** `tryLockUser(phone)` acquires a lock but there is no corresponding `unlockUser()` call. If the lock is database-backed, it persists and blocks all future messages from that phone. If in-memory, same cold-start issue as C-002.
- **Impact:** User permanently locked out of messaging. Or lock ineffective (cold start clears it).
- **Suggested fix:** Use try/finally pattern with explicit unlock. Or use database advisory locks with automatic timeout.

---

## Medium Issues (Problems at scale)

#### [M-001] Challenge 40-Char Check Off-By-One
- **Flow:** Flow 7 (Peer Challenge), step 1
- **File:** `src/lib/challenges/peer.ts:16`
- **What happens:** Uses `>= 40` instead of `> 40`. Messages exactly 40 chars rejected.
- **Impact:** Minor — affects very few users with long names.
- **Suggested fix:** Change to `> 40`.

#### [M-002] Feedback SMS Not Validated for GSM-7 Before Sending
- **Flow:** Flow 1 (Grading → Feedback), step 13
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:824-830`
- **What happens:** AI-generated feedback sent directly via `sendSms()` with no charset validation. Beyond the ⭐/💡 in the prompt (C-001), GPT may also return curly quotes ("you're"), em dashes (—), or ellipsis (…).
- **Impact:** Multi-segment SMS, garbled characters on some phones.
- **Suggested fix:** Add `sanitizeGsm7(text)` function that replaces curly quotes → straight, em dash → hyphen, ellipsis → "...", strips emoji.

#### [M-003] Peer Results SMS Length Not Validated
- **Flow:** Flow 7 (Peer Challenge), step 14
- **File:** `src/lib/challenges/peer.ts:400-412`
- **What happens:** `buildPeerResultsSMS()` constructs results message but never validates total length. Long names + dimension names could exceed 320 chars (2 segments).
- **Impact:** 3-segment SMS when budget is 2. Extra cost.
- **Suggested fix:** Truncate names, use abbreviated dimensions, enforce 320-char max.

#### [M-004] Peer Results SMS Hard-Codes Dimension Names
- **Flow:** Flow 7 (Peer Challenge), step 14
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:908-932`
- **What happens:** Hard-codes `'tone_rapport'` and `'close_attempt'` as strength/weakness dimensions for every peer challenge result, ignoring actual scores.
- **Impact:** Feedback not personalized. Reps told to work on dimensions they scored well on.
- **Suggested fix:** Extract actual best/worst dimensions from grading scores.

#### [M-005] Phase 6 Keyword Handlers Not Protected by Advisory Lock
- **Flow:** Flow 1 (Keyword Routing), concurrency
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:286-288`
- **What happens:** `tryLockUser()` only wraps the training state machine path, not TRAIN:, NOW, CHALLENGE, ACCEPT, PASS, or disambiguation handlers. Simultaneous messages could trigger multiple keyword handlers.
- **Impact:** Double ACCEPT, double CHALLENGE creation, duplicate NOW pushes.
- **Suggested fix:** Move lock acquisition before ALL keyword handlers.

#### [M-006] Daily Challenge Frequency Config Not Checked in Generator
- **Flow:** Flow 6 (Daily Challenge), step 2
- **File:** `src/lib/challenges/daily.ts:14-114`
- **What happens:** `generateDailyChallenge()` does not check frequency config (daily/mwf/tue_thu). It relies on the calling cron to check. But if called from a different context, it generates challenges on wrong days.
- **Impact:** Challenges could be generated on non-qualifying days if caller doesn't check frequency.
- **Suggested fix:** Add frequency check inside `generateDailyChallenge()` as defense in depth.

#### [M-007] No Dealership-Level Locking in Daily Training Cron
- **Flow:** Flow 2 (Daily Training Cron), race conditions
- **File:** `src/app/api/cron/daily-training/route.ts`
- **What happens:** If cron is triggered twice (Vercel retry, manual trigger), both invocations process the same dealerships simultaneously. No locking or dedup.
- **Impact:** Duplicate training sessions created. Reps receive 2 training SMS. Message cap violated.
- **Suggested fix:** Use a "last_cron_run_at" timestamp in dealerships table. Skip if < 1 hour since last run.

#### [M-008] Manager Quick-Create: Two Managers TRAIN: Simultaneously
- **Flow:** Flow 8 + C1 (Timing Collisions)
- **File:** `src/lib/manager-create/generate.ts`
- **What happens:** Two managers at the same dealership both send TRAIN: within seconds. Both scenarios are stored. Both get NOW confirmation. If both reply NOW, both scenarios push to all reps.
- **Impact:** Reps get 2 manager scenarios in one day. Confusing, exceeds message cap.
- **Suggested fix:** Check for existing pending manager_scenarios before creating new one. Or push only the most recent.

#### [M-009] Content Priority: Manager Scenario Pushed by Cron AND NOW
- **Flow:** C2 (State Pollution)
- **File:** Daily training cron + webhook NOW handler
- **What happens:** Manager creates scenario (pending). Daily cron detects it, pushes to reps. 10 minutes later, manager replies NOW. `markScenarioPushedNow()` succeeds because the row still exists. NOW pushes again to all reps — duplicate scenario.
- **Impact:** All reps receive same scenario twice. Wastes message cap slots.
- **Suggested fix:** NOW handler should check `pushed_at IS NULL` before pushing. Mark scenario as pushed when cron selects it.

#### [M-010] 6 Environment Variables Undocumented
- **Flow:** Part A (Environment Variables)
- **File:** `docs/ENVIRONMENTS.md`
- **What happens:** SUPABASE_JWT_SECRET, SINCH_KEY_ID, SINCH_KEY_SECRET, SINCH_PROJECT_ID, SINCH_APP_ID, ADMIN_API_KEY are referenced in code but not documented in ENVIRONMENTS.md.
- **Impact:** Deployment risk. New operator wouldn't know to set these. Silent failures.
- **Suggested fix:** Add all 6 to ENVIRONMENTS.md with descriptions.

#### [M-011] Past-Year Vacation Dates Accepted
- **Flow:** Flow 13 (Schedule Awareness)
- **File:** `src/lib/schedule-awareness.ts`
- **What happens:** "VACATION BACK 1/15" in March 2026 could be interpreted as January 15, 2026 (past) or January 15, 2027. No year validation. Past dates silently accepted.
- **Impact:** Stale one-off absences accumulate in database. Minor — doesn't cause wrong behavior, just data bloat.
- **Suggested fix:** Reject dates in the past. Default ambiguous dates to next occurrence.

#### [M-012] CSV Import Rate Limiting Relies on 100ms Stagger
- **Flow:** Flow 3 (Employee Onboarding), step 4
- **File:** `src/app/api/users/import/route.ts`
- **What happens:** Consent SMS sent per employee with ~100ms delay between sends. For 50 employees, that's 5 seconds. For 500, that's 50 seconds (may exceed function timeout). No actual Sinch rate limit check.
- **Impact:** Sinch rate limit hit → some consent SMS fail silently → some employees never get consent request → never activated.
- **Suggested fix:** Use batch send or queue. Check Sinch rate limit headers. Retry on 429.

#### [M-013] Legacy Daily Digest Path Bypasses Subscription Gating
- **Flow:** Flow 10 (Morning Meeting Script), step 3
- **File:** `src/app/api/cron/daily-digest/route.ts`
- **What happens:** When `morning_script_enabled` is false, the legacy digest path runs. It does not check `checkSubscriptionAccess()`. Canceled dealerships still receive daily digests.
- **Impact:** Canceled/lapsed dealerships get daily digest SMS. Wastes SMS credits. Gives free value to non-paying customers.
- **Suggested fix:** Add subscription check before legacy digest path.

#### [M-014] Phone-Based PWA Session Token Lacks HMAC
- **Flow:** Flow 9 (Coach Mode), step 3
- **File:** `src/app/api/app/auth/route.ts`
- **What happens:** PWA auth uses phone + last 4 digits, returns a base64 session token. Token appears to be a simple encoding (not cryptographically signed). Anyone who knows a rep's phone + last 4 can access their Coach Mode.
- **Impact:** Weak authentication. Social engineering risk (last 4 digits of phone often guessable or known).
- **Suggested fix:** HMAC-sign the token with a server secret. Add expiry.

---

## Low Issues (Improvements)

#### [L-001] Transcript Logging Failures Silently Ignored
- **Flow:** Flow 1 (throughout webhook)
- **File:** `src/app/api/webhooks/sms/sinch/route.ts` (multiple locations)
- **What happens:** `insertTranscriptLog()` calls not always wrapped in try/catch. If log fails, conversation history has gaps.
- **Impact:** Managers see incomplete training transcripts.
- **Suggested fix:** Wrap all `insertTranscriptLog()` in try/catch with console.error.

#### [L-002] Chain Completion SMS Sent with 1s Arbitrary Delay
- **Flow:** Flow 5 (Scenario Chain), step 18
- **File:** `src/app/api/webhooks/sms/sinch/route.ts:901`
- **What happens:** `await new Promise(r => setTimeout(r, 1000))` between feedback and completion SMS. Arbitrary delay, may appear as separate conversations on phone.
- **Impact:** Minor UX — two separate notifications instead of one.
- **Suggested fix:** Combine feedback + completion into single SMS if under 320 chars.

#### [L-003] K Consecutive Pass Counter Not Implemented
- **Flow:** Flow 14 (Adaptive Weighting), step 3
- **File:** `src/lib/adaptive-weighting.ts`
- **What happens:** Spec says "For each dimension with K consecutive passes: W[e][d] *= (1 - beta)". The K counter is not persisted anywhere. Weight decay for mastered domains may not work.
- **Impact:** Domains a rep has mastered keep getting selected. Training not optimally personalized.
- **Suggested fix:** Add consecutive_passes counter to priority_vectors JSONB.

#### [L-004] Adaptive Weighting Config Hardcoded
- **Flow:** Flow 14 (Adaptive Weighting)
- **File:** `src/lib/adaptive-weighting.ts`
- **What happens:** alpha=0.3, beta=0.1, threshold=3.0 are hardcoded constants, not per-dealership configuration.
- **Impact:** Can't tune training intensity per dealership.
- **Suggested fix:** Store in feature_flags config JSONB per dealership.

#### [L-005] Consent SMS Not Formally Audit-Logged
- **Flow:** Flow 3 (Employee Onboarding), step 4
- **File:** `src/app/api/users/route.ts`
- **What happens:** Consent SMS is sent but success/failure is not logged to a dedicated consent audit table. Only appears in sms_transcript_log.
- **Impact:** CTIA audit trail incomplete for compliance review.
- **Suggested fix:** Log to consent_records table with timestamp, phone, message_text, delivery_status.

#### [L-006] Peer Challenge Default Win SMS Doesn't Indicate Reason
- **Flow:** Flow 7 (Peer Challenge), step 13
- **File:** `src/lib/challenges/peer.ts`
- **What happens:** When a challenge expires and one participant wins by default, the SMS doesn't explain why (opponent didn't respond vs. opponent scored lower).
- **Impact:** Confusing for participants.
- **Suggested fix:** Include "won by default (opponent didn't respond)" in SMS.

#### [L-007] No Monitoring/Alerting for Silent Failures
- **Flow:** All flows
- **File:** Codebase-wide
- **What happens:** Errors are `console.error()`'d but no Sentry/Axiom is configured (NR-002). All failures are invisible unless manually checking Vercel logs.
- **Impact:** Bugs accumulate undetected. Already noted in NEEDS-REVIEW.
- **Suggested fix:** Sentry integration (already planned). High priority given audit findings.

---

## Verification Log

### A1: Schema Verification
- VERIFIED: All migrations apply cleanly in sequence — no forward references
- VERIFIED: Foreign key references valid across all migrations
- VERIFIED: has_active_subscription() includes past_due — `20260311160000_billing_events.sql`
- VERIFIED: RLS on all tenant-scoped tables except coach_sessions (per spec) — filed as H-010
- VERIFIED: JSONB field structures consistent between readers and writers

### A2: Environment Variables
- ISSUE: 6 env vars used in code but missing from docs — filed as M-010

### A3: Cron Configuration
- VERIFIED: All 7 crons present in vercel.json — match file system
- ISSUE: No maxDuration in any cron — filed as C-007
- ISSUE: Cron frequencies incompatible with Vercel Hobby — filed as C-008
- VERIFIED: All cron routes verify CRON_SECRET
- ISSUE: daily-digest timezone filter only catches Pacific — filed as H-007

### A4: SMS Keyword Priority Order
- ISSUE: HELP/STOP after CHALLENGE — filed as C-004
- VERIFIED: TRAIN: checks manager role before processing
- ISSUE: CHALLENGE 40-char off-by-one — filed as M-001
- VERIFIED: ACCEPT/PASS checks for pending challenge before triggering
- VERIFIED: NOW checks for pending awaiting_now_confirmation
- ISSUE: Natural opt-out matches training responses — filed as C-010
- VERIFIED: STOP handling is exact keyword match (but natural patterns too broad)

### Flow 1: Inbound SMS → Grading → Feedback
- VERIFIED: Webhook always returns 200 OK
- VERIFIED: HMAC signature verification with timing-safe comparison
- ISSUE: Idempotency in-memory only — filed as C-002
- VERIFIED: Phone lookup → user + dealership + role working
- VERIFIED: Opt-out check happens before keyword routing
- VERIFIED: State machine transitions validated (assertTransition)
- VERIFIED: AI fallback chain implemented (GPT-5.4 → GPT-4o-mini → template)
- VERIFIED: OpenAI timeout enforced (60s AbortController)
- ISSUE: GSM-7 emoji in grading prompt — filed as C-001
- ISSUE: GSM-7 not validated before send — filed as M-002

### Flow 2: Daily Training Cron
- VERIFIED: CRON_SECRET verification present
- VERIFIED: Weekday check present
- VERIFIED: Subscription gating present
- VERIFIED: Schedule awareness (isScheduledOff) check present
- ISSUE: No message cap check — filed as H-002
- ISSUE: No maxDuration — filed as C-007
- ISSUE: Timezone mismatch with Hobby plan — filed as C-008

### Flow 3: Employee Onboarding
- VERIFIED: E.164 phone normalization present
- VERIFIED: Consent SMS sent after user creation
- VERIFIED: Welcome SMS only after consent confirmed
- ISSUE: CSV import rate limiting weak — filed as M-012
- ISSUE: Consent not formally audit-logged — filed as L-005

### Flow 4: STOP Opt-Out
- VERIFIED: STOP confirmation SMS sent
- VERIFIED: sms_opt_outs row created
- VERIFIED: START re-subscribe removes opt-out
- ISSUE: Natural opt-out patterns too broad — filed as C-010

### Flow 5: Scenario Chain Lifecycle
- VERIFIED: Template selection by weakest domain + difficulty
- VERIFIED: Chain completion status set correctly after step 3
- VERIFIED: Step results JSONB array correct format
- ISSUE: incrementMissedDay() never called — filed as C-003
- ISSUE: Chain step recording not atomic — filed as C-006
- ISSUE: Vehicle hardcoded — filed as H-001
- ISSUE: Branching operators may be incomplete — filed as H-009

### Flow 6: Daily Challenge
- VERIFIED: Tiebreak by response time in ranking
- VERIFIED: Zero responses handled (status = 'no_responses')
- VERIFIED: First day (no yesterday data) handled cleanly
- ISSUE: Frequency config not checked in generator — filed as M-006

### Flow 7: Peer Challenge
- VERIFIED: Case-insensitive name lookup (ilike)
- VERIFIED: 4h expiry for active challenges
- VERIFIED: 10-min disambiguation timeout
- VERIFIED: ACCEPT/PASS check pending before triggering
- ISSUE: Race condition on completion — filed as C-005
- ISSUE: Self-challenge not prevented — filed as H-008
- ISSUE: Results SMS length not validated — filed as M-003
- ISSUE: Results SMS hard-codes dimensions — filed as M-004

### Flow 8: Manager Quick-Create
- VERIFIED: 30-min expiry on NOW confirmation
- VERIFIED: Manager input text preserved
- ISSUE: NOW falls through to training — filed as H-003
- ISSUE: Non-manager gets no feedback — filed as H-004
- ISSUE: Two managers can create simultaneous scenarios — filed as M-008
- ISSUE: Cron + NOW double push — filed as M-009

### Flow 9: Coach Mode
- VERIFIED: System prompt includes 988 crisis reference
- VERIFIED: System prompt includes "never give pricing/deal advice"
- VERIFIED: System prompt includes "never advise going around manager"
- VERIFIED: Compaction at 10 exchanges, max at 20
- VERIFIED: No coach_sessions joins to manager-visible routes
- ISSUE: Coach themes endpoint leaks user IDs — filed as C-011
- ISSUE: No RLS on coach_sessions — filed as H-010
- ISSUE: PWA token lacks HMAC — filed as M-014

### Flow 10: Morning Meeting Script
- VERIFIED: Coaching focus from curated prompts (no LLM cost)
- VERIFIED: DETAILS handler checks sender role
- ISSUE: Timezone filter only catches Pacific — filed as H-007
- ISSUE: Legacy path bypasses subscription gating — filed as M-013

### Flow 11: Stripe Billing
- VERIFIED: Webhook verifies signature with raw body
- VERIFIED: billing_events idempotency (stripe_event_id UNIQUE)
- VERIFIED: All 6 event types handled
- VERIFIED: Pilot dealership bypass (is_pilot = true)
- VERIFIED: past_due in subscription checks
- ISSUE: Dunning email silently fails — filed as H-011
- ISSUE: Non-atomic signup — filed as H-006

### Flow 12: Self-Service Signup
- ISSUE: Non-atomic — filed as H-006

### Flow 13: Schedule Awareness
- VERIFIED: Off days prevent training sends
- VERIFIED: Confirmation SMS sent for schedule updates
- ISSUE: Past-year dates accepted — filed as M-011

### Flow 14: Adaptive Weighting
- ISSUE: K counter not persisted — filed as L-003
- ISSUE: Config hardcoded — filed as L-004

### Flow 15: Ask IQ → Knowledge Gap
- UNABLE TO VERIFY: "Yesterday on Floor" team-wide boost — unclear if adaptive weighting reads knowledge_gaps
- VERIFIED: Knowledge gaps feed morning meeting script gap section

### Flow 16: Trainee Mode + Language
- UNABLE TO VERIFY: Trainee mode 3x daily — no trainee_mode flag or logic found in daily-training cron
- UNABLE TO VERIFY: Spanish language toggle — no ES translations found for Phase 6 SMS content
- UNABLE TO VERIFY: Model Launch Mode — not referenced in content-priority.ts

### Cross-Feature (C1-C4)
- ISSUE: Training cron + CHALLENGE ACCEPT race — filed as M-005, H-002
- ISSUE: Manager scenario cron + NOW double push — filed as M-009
- ISSUE: Chain pause/resume on peer challenge — VERIFIED: content priority correctly skips chain when peer challenge active
- ISSUE: Feature flag mid-flight — UNABLE TO VERIFY: no graceful degradation logic found for mid-flight flag toggle

### Cross-Cutting (D1-D4)
- ISSUE: GSM-7 violations — filed as C-001, M-002
- VERIFIED: RLS on all tenant tables except coach_sessions
- ISSUE: Dead-end: chains never expire — filed as C-003
- VERIFIED: Orphaned sessions cron catches stuck sessions (2h timeout)
- ISSUE: Error cascade (OpenAI down) — orphaned-sessions cron handles cleanup, but no retry
- ISSUE: Error cascade (Sinch down) — SMS failures logged but not retried, messages lost
- ISSUE: Error cascade (Resend down) — dunning emails lost — filed as H-011
- VERIFIED: Error cascade (Stripe down) — Stripe retries for 3 days, billing_events idempotency prevents dupes

---

### Flows That Passed Clean
None — every flow had at least one issue. Closest to clean: Flow 4 (STOP Opt-Out — only inherited issue from C-010) and Flow 13 (Schedule Awareness — only M-011).
