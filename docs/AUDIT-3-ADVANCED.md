# Audit 3/4: Advanced Features (Flows 5-16)

**Repo:** `dealershipiq` (main, production)
**Date:** 2026-03-14
**Auditor:** Automated (Claude)
**Scope:** Document-only trace of 12 advanced flows. No fixes applied.
**Prerequisites:** AUDIT-1-INFRASTRUCTURE.md, AUDIT-2-CORE-FLOWS.md, AUDIT-3-DASHBOARD-COACH.md

---

## Features Audited

| Flow | Feature | Entry Point | Status |
|------|---------|-------------|--------|
| 5 | Scenario Chain Lifecycle | `src/lib/chains/lifecycle.ts` | IMPLEMENTED |
| 6 | Daily Challenge | `src/lib/challenges/daily.ts` | IMPLEMENTED |
| 7 | Peer Challenge | `src/lib/challenges/peer.ts` | IMPLEMENTED |
| 8 | Manager Quick-Create | `src/lib/manager-create/generate.ts` | IMPLEMENTED |
| 9 | Coach Mode Privacy | `src/app/api/coach/session/route.ts` | IMPLEMENTED |
| 10 | Morning Meeting Script | `src/app/api/cron/daily-digest/route.ts` | IMPLEMENTED |
| 11 | Stripe Billing | `src/app/api/webhooks/stripe/route.ts` | IMPLEMENTED |
| 12 | Self-Service Signup | `src/app/(marketing)/signup/page.tsx` | IMPLEMENTED |
| 13 | Schedule Awareness + Streaks | `src/lib/schedule-awareness.ts` | IMPLEMENTED (no streaks) |
| 14 | Adaptive Weighting + Rematch | `src/lib/adaptive-weighting.ts` | IMPLEMENTED (no rematch) |
| 15 | Ask IQ → Knowledge Gaps | `src/app/api/ask/route.ts` | PARTIAL — placeholder AI |
| 16 | Trainee Mode + Language + Model Launch | `src/app/api/webhooks/sms/sinch/route.ts` | PARTIAL — see notes |

---

## Not Implemented (Logged and Skipped)

| Feature | Expected Entry Point | Status |
|---------|---------------------|--------|
| Streaks | `src/lib/streaks.ts` or similar | NOT IMPLEMENTED — no streak tracking, no streak prefixes beyond what daily-training adds |
| Rematch | `src/lib/challenges/peer.ts` rematch flow | NOT IMPLEMENTED — no rematch keyword or flow found |
| Language Switching | SMS keyword handler for LANG/LANGUAGE | NOT IMPLEMENTED — `users.language` column exists but no SMS keyword to change it |
| Trainee Mode Toggle | SMS keyword TRAINEE or feature flag | NOT IMPLEMENTED — no trainee-specific toggle found |
| Model Launch (Hot Swap) | Runtime model selector | NOT IMPLEMENTED — GPT-5.4 hardcoded in openai.ts, GPT-4o in coach, no hot-swap mechanism |

---

## Summary

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| Flow 5: Scenario Chains | 0 | 0 | 2 | 1 | 1 |
| Flow 6: Daily Challenge | 0 | 0 | 1 | 0 | 1 |
| Flow 7: Peer Challenge | 0 | 0 | 1 | 1 | 0 |
| Flow 8: Manager Quick-Create | 0 | 0 | 0 | 1 | 1 |
| Flow 9: Coach Mode Privacy | 0 | 1 | 1 | 0 | 1 |
| Flow 10: Morning Meeting Script | 0 | 0 | 1 | 0 | 1 |
| Flow 11: Stripe Billing | 1 | 1 | 1 | 0 | 1 |
| Flow 12: Self-Service Signup | 1 | 1 | 0 | 0 | 0 |
| Flow 13: Schedule Awareness | 0 | 0 | 1 | 0 | 0 |
| Flow 14: Adaptive Weighting | 0 | 0 | 0 | 1 | 1 |
| Flow 15: Ask IQ | 0 | 0 | 1 | 1 | 0 |
| Flow 16: Trainee/Lang/Model | 0 | 0 | 0 | 0 | 1 |
| **Total** | **2** | **3** | **9** | **5** | **8** |

---

## Issues

### CRITICAL

#### F11-C-001: Stripe Webhook Queries Nonexistent `users.dealership_id` Column

- **Location:** `src/app/api/webhooks/stripe/route.ts:284-288`
- **Code:**
  ```
  .from('users')
  .select('email, full_name')
  .eq('dealership_id', dealership.id)
  .in('role', ['manager', 'owner'])
  ```
- **Problem:** `users` table has no `dealership_id` column (confirmed via `src/types/supabase.ts:835-845`). Also has no `role` column and no `email` column. PostgREST returns 400 error on any of these. The entire Day 1 dunning email path silently fails.
- **Impact:** No dunning emails sent on `invoice.payment_failed` webhook events. Managers never learn about failed payments from the webhook path. The cron fallback at day 3+ has the same bug (see F11-C-001b below).
- **Evidence:** `VERIFIED — supabase.ts:835-845` (users Row type: no dealership_id, no role, no email)

#### F11-C-001b: Dunning Cron Also Queries Nonexistent `users.dealership_id` and `users.role`

- **Location:** `src/lib/billing/dunning.ts:210-214`
- **Code:**
  ```
  .from('users')
  .select('email, full_name')
  .eq('dealership_id', dealership.id as string)
  .in('role', ['manager', 'owner'])
  ```
- **Problem:** Same schema mismatch as F11-C-001. The entire dunning email pipeline is broken — both webhook-triggered (day 1) and cron-triggered (day 3/14/21/30) paths fail silently.
- **Impact:** Zero dunning emails ever sent. Payment failures go unnoticed until day 30 auto-cancellation (which does work since it updates dealerships table directly, not users).
- **Fix:** Query `dealership_memberships` JOIN `users` (by user_id) for membership lookup. Manager role is on `dealership_memberships.role`, not `users.role`. Email is NOT on users table — either add `email` column to users or query Supabase Auth admin API.

#### F12-C-001: Self-Service Signup Inserts Nonexistent Columns into `users` Table

- **Location:** `src/app/api/billing/checkout/route.ts:93-101`
- **Code:**
  ```
  await serviceClient.from('users').insert({
    id: userId,
    email,
    full_name: managerName,
    phone: '',
    role: 'owner',
    status: 'active',
    dealership_id: dealershipId,
  });
  ```
- **Problem:** `users` table has no `email`, `role`, or `dealership_id` columns. This INSERT fails with PostgREST error. The catch block (line 162-171) rolls back by deleting the Auth user and dealership, returning a generic "Signup failed" error.
- **Impact:** Self-service signup is completely broken. No new dealership can sign up. Auth user gets created then deleted. Stripe checkout never reached.
- **Evidence:** `VERIFIED — supabase.ts:846-856` (users Insert type: no email, no role, no dealership_id)

### HIGH

#### F9-H-001: Coach Mode `closeSession()` Missing Dealership Scope

- **Location:** `src/app/api/coach/session/route.ts:481-503`
- **Code:**
  ```
  await serviceClient
    .from('coach_sessions')
    .update(updateData)
    .eq('id', sessionId);
  ```
- **Problem:** `closeSession()` only filters by `sessionId` — no `user_id` or `dealership_id` scope. While it's called from contexts where ownership is already verified (lines 267, 289), the function itself accepts a bare `sessionId` string. `closeStaleSessionsForUser()` at line 555-577 also queries without dealership scope — it fetches ALL open sessions for a user_id across all dealerships, then closes them.
- **Impact:** In a multi-dealership scenario, a user authenticated at Dealership A could have their Dealership B coach sessions closed by the stale session cleanup. Low severity in single-dealership pilot but breaks multi-tenancy.
- **Evidence:** `VERIFIED — route.ts:481-503` (no .eq('dealership_id', ...) on update)

#### F11-H-001: Stripe Webhook `handlePaymentFailed` Queries Nonexistent `users.dealership_id`

- **Location:** `src/app/api/webhooks/stripe/route.ts:283-288`
- **Description:** Same root cause as F11-C-001 but called out separately because this is a different code path with different severity: the dunning email failure is silent (try/catch absorbs it) and doesn't prevent the `subscription_status: 'past_due'` update from succeeding.
- **Impact:** The subscription status update works. Only the email notification is broken.

#### F12-H-001: Self-Service Signup Rollback Deletes Dealership Without Cascade

- **Location:** `src/app/api/billing/checkout/route.ts:165-166`
- **Code:**
  ```
  await serviceClient.auth.admin.deleteUser(userId);
  await serviceClient.from('dealerships').delete().eq('id', dealershipId);
  ```
- **Problem:** If the failure occurs after dealership_membership INSERT (line 106) but before feature flags, the rollback deletes the dealership but NOT the membership or feature_flags rows (orphaned FK references). The `deleteUser` call handles auth, but dealership_memberships and feature_flags are not cleaned up.
- **Impact:** Orphaned rows in dealership_memberships referencing deleted dealership. FK constraints may prevent the dealership DELETE from succeeding at all (depends on CASCADE configuration).

### MEDIUM

#### F5-M-001: Chain Lifecycle Uses Application-Level Race Window Fallback

- **Location:** `src/lib/chains/lifecycle.ts:160-199`
- **Description:** `recordChainStepResult()` tries atomic RPC (`record_chain_step`) first. If RPC doesn't exist, falls back to read-check-write pattern with console.warn. The fallback has a race window: two concurrent grading completions for the same chain could both read the same `step_results`, both insert, and one overwrites the other.
- **Impact:** Duplicate step results or lost step results if two chain-linked sessions grade simultaneously. Mitigated by advisory lock on inbound SMS, but not guaranteed (see AUDIT-2 F1-H-001).
- **Evidence:** `VERIFIED — lifecycle.ts:173-174` (console.warn confirms RPC may not exist)

#### F5-M-002: Chain Template SELECT Bypasses RLS (serviceClient)

- **Location:** `src/lib/chains/templates.ts` (imported via lifecycle.ts)
- **Description:** Chain template queries use `serviceClient` (service role). AUDIT-1 C-001 flagged that `chain_templates` has RLS disabled entirely. Even after RLS is enabled, the service client bypasses it.
- **Impact:** Cross-tenant template leakage if chain_templates contains dealership-specific data. Current templates appear to be shared/global, so practical risk is low.
- **Evidence:** `VERIFIED — AUDIT-1 C-001` (RLS disabled on chain_templates)

#### F6-M-001: Daily Challenge Date Uses UTC, Not Dealership Timezone

- **Location:** `src/lib/training/content-priority.ts:148`
- **Code:** `const todayStr = new Date().toISOString().split('T')[0];`
- **Problem:** `checkDailyChallenge()` computes today's date in UTC. A dealership in US/Pacific at 10pm on March 13 (UTC: 6am March 14) would look for March 14's challenge instead of March 13's. If the challenge was created for March 13, it wouldn't match.
- **Impact:** Late-day challenge misses for western US dealerships. Challenge generated for one date served on the wrong date near midnight UTC.
- **Fix:** Pass timezone through from daily-training cron and use `getLocalDateString()`.

#### F7-M-001: Peer Challenge `checkPeerChallenge()` Missing Dealership Scope

- **Location:** `src/lib/training/content-priority.ts:88-109`
- **Code:**
  ```
  .from('peer_challenges')
  .select(...)
  .eq('status', 'active')
  .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
  ```
- **Problem:** No `.eq('dealership_id', dealershipId)` filter. A user belonging to two dealerships could have a peer challenge from Dealership A served during Dealership B's daily training.
- **Impact:** Cross-tenant content leakage in multi-dealership user scenario. Low risk in single-dealership pilot.

#### F9-M-001: Coach Session GET Returns Message Content Without Rate Limiting

- **Location:** `src/app/api/coach/session/route.ts:86-131`
- **Description:** GET endpoint returns last 10 sessions with message content preview (100 chars). No rate limiting on GET. An attacker with a valid session token could enumerate session history rapidly.
- **Impact:** Low — session content is the user's own data. But no pagination or cursor-based fetching means all 10 sessions loaded per request.

#### F10-M-001: Morning Meeting Script Queries Coach Sessions Without Dealership Scope

- **Location:** `src/app/api/cron/daily-digest/route.ts:172-176`
- **Code:**
  ```
  .from('coach_sessions')
  .select('user_id')
  .eq('dealership_id', dealership.id)
  ```
- **Status:** Actually correctly scoped. No issue on this specific query. However, the subsequent user phone lookup at line 186-190 queries `users` table by `id` without dealership verification. A user who was removed from a dealership but still has coach_sessions would still receive the micro-insight SMS.
- **Impact:** Minimal — stale user receives one extra SMS per week.

#### F13-M-001: Schedule `isScheduledOff()` Uses UTC Date for Day-of-Week

- **Location:** `src/lib/schedule-awareness.ts:155-156`
- **Code:** `const dayOfWeekNum = date.getDay();` where `date` is `new Date()` (UTC)
- **Problem:** If dealership is US/Pacific and it's 11pm Monday local (Tuesday UTC), `getDay()` returns Tuesday (2) instead of Monday (1). An employee who set "OFF TUE" would be skipped on their actual Tuesday if the cron runs before UTC midnight.
- **Impact:** Employees may receive training on their day off, or miss training on a work day near UTC date boundaries.

#### F15-M-001: Ask IQ AI Response Is Hardcoded Placeholder

- **Location:** `src/app/api/ask/route.ts:88-91`
- **Code:** `const aiResponse = 'Thank you for your question...'` with `confidence = 0.0`
- **Problem:** Every Ask IQ query gets a placeholder response with 0% confidence. All queries immediately become "knowledge gaps" in the dashboard (since confidence < 70%).
- **Impact:** The knowledge gaps dashboard is flooded with 100% of queries, making it useless for identifying actual gaps. The feature is essentially a question logger, not an AI assistant.
- **Evidence:** `VERIFIED — route.ts:88-91` (placeholder text), `VERIFIED — gaps/route.ts:64` (.lt('confidence', 0.7) — all 0.0 confidence queries match)

#### F11-M-001: Stripe `handleCheckoutCompleted` Hardcodes 30-Day Trial

- **Location:** `src/app/api/webhooks/stripe/route.ts:112-114`
- **Code:**
  ```
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);
  ```
- **Problem:** Trial period is hardcoded in the webhook handler, not derived from the Stripe subscription's trial_end field. If Stripe's trial period is configured differently (e.g., 14 days or 60 days), the local database will be out of sync.
- **Impact:** Trial end date mismatch between Stripe and DealershipIQ. Could allow or deny access incorrectly at trial boundaries.

### LOW

#### F5-L-001: Chain Context Stores Vehicle Name as Interpolated String

- **Location:** `src/lib/chains/lifecycle.ts:35`
- **Description:** Vehicle context is fetched at chain start and stored as a formatted string (`2026 Toyota Camry`). If vehicle data updates mid-chain, the chain continues with stale vehicle info.
- **Impact:** Cosmetic. Multi-day chains could reference outdated vehicle inventory.

#### F7-L-001: Peer Challenge Results SMS Truncated at 320 Characters

- **Location:** `src/lib/challenges/peer.ts` (per agent summary)
- **Description:** Results SMS is truncated to 320 chars (2 SMS segments). If both participants have long names or detailed scores, the message may be cut off mid-sentence.
- **Impact:** Cosmetic. User sees partial results message.

#### F8-L-001: Manager Scenario NOW Confirmation 30-Minute Window

- **Location:** `src/lib/manager-create/generate.ts`
- **Description:** Manager creates scenario via `TRAIN: <text>`, gets confirmation prompt with 30-minute window to reply `NOW`. If manager is busy and replies after 30 minutes, the scenario is still stored but `NOW` confirmation silently fails.
- **Impact:** Manager confusion. The scenario still enters the content priority queue for next-day delivery.

#### F14-L-001: K-Consecutive-Pass Weight Decay Not Implemented

- **Location:** `src/lib/adaptive-weighting.ts:122-131`
- **Code:** `// TODO: Implement K consecutive pass tracking for weight decay.`
- **Description:** Per the spec, domains where an employee scores above threshold K consecutive times should decay in weight. Not implemented — weights only update on grading, never decay on sustained good performance.
- **Impact:** Over time, domains the employee consistently performs well in retain higher weight than they should, reducing training variety.

#### F15-L-001: Ask IQ In-Memory Rate Limit Not Shared Across Vercel Instances

- **Location:** `src/app/api/ask/route.ts:25-37`
- **Description:** Rate limit uses in-memory Map. Each Vercel function instance has its own Map. A user hitting different instances could exceed the 60/hour limit.
- **Impact:** Rate limit is per-instance, not global. At pilot scale (low traffic), effectively one instance, so it works.

### INFO

#### F5-I-001: Chain Branching Is Deterministic, Not LLM-Driven

- **Location:** `src/lib/chains/branching.ts`
- **Description:** Branch selection evaluates rules against prior step scores (e.g., `close_attempt < 2.5`). No LLM call for branch selection — it's pure conditional logic. This is correct and efficient.

#### F6-I-001: Challenge Frequency Is Configurable Per Dealership

- **Location:** `src/lib/training/content-priority.ts:144-146`
- **Description:** `daily_challenge_enabled` flag's config JSONB stores `frequency: 'daily' | 'mwf' | 'tue_thu'`. Clean implementation.

#### F8-I-001: Manager Quick-Create Sanitizes Prompt Input

- **Location:** `src/app/api/webhooks/sms/sinch/route.ts` (per summary: S-008 prompt injection defense)
- **Description:** TRAIN: keyword handler strips injection characters before passing to OpenAI. Good defense-in-depth.

#### F9-I-001: Coach Mode Rate Limit Is DB-Backed

- **Location:** `src/app/api/coach/session/route.ts:619-646`
- **Description:** Rate limit counts user messages across all coach sessions in the last hour via DB query. Survives cold starts. Correct implementation.

#### F10-I-001: Morning Meeting Script Runs 6 Queries in Parallel

- **Location:** `src/app/api/cron/daily-digest/route.ts:241-249`
- **Description:** `Promise.all` for shoutout, gap, coaching focus, at-risk, numbers, benchmark. Good performance pattern.

#### F11-I-001: Stripe Webhook Idempotency Is Properly Implemented

- **Location:** `src/app/api/webhooks/stripe/route.ts:30-51`
- **Description:** Checks `billing_events.stripe_event_id` before processing. Returns 500 on DB error (Stripe retries). Returns 200 with `skipped: true` on duplicate. Clean C-009/C-011 compliance.

#### F14-I-001: Adaptive Weighting Exploration Bonus Prevents Stagnation

- **Location:** `src/lib/adaptive-weighting.ts:155`
- **Description:** `beta = 0.1` exploration bonus added to all domain weights during selection. Ensures even low-weight domains have a chance of being selected. Good algorithm design.

#### F16-I-001: No Language or Trainee Mode Keywords in SMS Handler

- **Location:** `src/app/api/webhooks/sms/sinch/route.ts:212-228` (keyword priority chain)
- **Description:** Keyword priority chain has 14 levels. No LANG, LANGUAGE, TRAINEE, or MODEL keyword. The `users.language` column exists and is used in Coach Mode token payload (`app-auth.ts:43`) but cannot be changed via SMS.

---

## Verification Log

### Flow 5: Scenario Chain Lifecycle

| Check | File:Line | Result |
|-------|-----------|--------|
| startChain creates DB row | lifecycle.ts:66-80 | VERIFIED |
| continueChain selects branch | lifecycle.ts:111 | VERIFIED |
| recordChainStepResult tries atomic RPC | lifecycle.ts:160-171 | VERIFIED — falls back on error |
| buildChainCompletionSMS exists | lifecycle.ts (exported) | VERIFIED |
| incrementMissedDay / expiration | lifecycle.ts (not shown in excerpt) | UNABLE TO VERIFY — not in read excerpt |
| Templates loaded from DB | chains/templates.ts | VERIFIED (per agent) |
| Vehicle context integration | lifecycle.ts:32-42 | VERIFIED |

### Flow 6: Daily Challenge

| Check | File:Line | Result |
|-------|-----------|--------|
| generateDailyChallenge uses GPT-5.4 | challenges/daily.ts | VERIFIED (per agent) |
| rankChallengeResponses at EOD | challenges/daily.ts | VERIFIED (per agent) |
| Challenge results cron fires at 5pm local | cron/challenge-results/route.ts | VERIFIED (per agent) |
| Feature flag gate | content-priority.ts:140 | VERIFIED |
| Frequency config (daily/mwf/tue_thu) | content-priority.ts:144-146 | VERIFIED |

### Flow 7: Peer Challenge

| Check | File:Line | Result |
|-------|-----------|--------|
| CHALLENGE keyword parsed | sinch/route.ts:331-335 | VERIFIED |
| ACCEPT/PASS keywords | sinch/route.ts:338-345 | VERIFIED |
| Disambiguation flow (1-9 replies) | sinch/route.ts:348-351 | VERIFIED |
| 4-hour expiry | challenges/peer.ts | VERIFIED (per agent) |
| checkAndCompleteChallenge atomic | challenges/peer.ts | VERIFIED (per agent) |
| Dealership scope on peer lookup | content-priority.ts:92-99 | ISSUE — F7-M-001 |

### Flow 8: Manager Quick-Create

| Check | File:Line | Result |
|-------|-----------|--------|
| TRAIN: keyword handler | sinch/route.ts:306-308 | VERIFIED |
| NOW confirmation handler | sinch/route.ts:312-328 | VERIFIED |
| S-008 prompt injection defense | sinch/route.ts (handleTrainKeyword) | VERIFIED (per agent) |
| Scenario stored with 30-min window | manager-create/generate.ts | VERIFIED (per agent) |
| Content priority picks it up first | content-priority.ts:42-43 | VERIFIED |

### Flow 9: Coach Mode Privacy

| Check | File:Line | Result |
|-------|-----------|--------|
| Phone token auth (cookie/header) | route.ts:585-588 | VERIFIED |
| HMAC signature verification | route.ts:593 → app-auth.ts:24-29 | VERIFIED — timingSafeEqual |
| Dealership membership check | route.ts:598-612 | VERIFIED — D2-M-001 fix applied |
| Session ownership on continue | route.ts:230-236 | VERIFIED — D2-H-001 (user_id + dealership_id) |
| Session update scoped | route.ts:347-351, 366-370 | VERIFIED — D2-H-001 |
| closeSession NOT scoped | route.ts:499-502 | ISSUE — F9-H-001 |
| closeStaleSessionsForUser NOT scoped | route.ts:561-565 | ISSUE — F9-H-001 |
| Rate limit (30/hour) | route.ts:619-646 | VERIFIED — DB-backed |
| Exchange limit (20 messages) | route.ts:281 → compaction.ts | VERIFIED |
| Message compaction (>10 messages) | route.ts:405 → compaction.ts | VERIFIED (per import) |
| Subscription gating | route.ts:42-48 | VERIFIED |
| Feature flag gate | route.ts:51-57 | VERIFIED |
| GPT-4o model (not 5.4) | route.ts:24 | VERIFIED — `gpt-4o-2024-11-20` |
| 30s timeout on GPT call | route.ts:409-410 | VERIFIED — AbortController |

### Flow 10: Morning Meeting Script

| Check | File:Line | Result |
|-------|-----------|--------|
| Cron fires at local hour 7 | daily-digest/route.ts:39 | VERIFIED |
| Feature flag branching | daily-digest/route.ts:81-84 | VERIFIED |
| 6 parallel data queries | daily-digest/route.ts:241-249 | VERIFIED |
| Legacy digest fallback | daily-digest/route.ts:103-143 | VERIFIED |
| Monday micro-insight | daily-digest/route.ts:159-213 | VERIFIED — per-dealership timezone check |
| Subscription gating | daily-digest/route.ts:55-56 | VERIFIED |
| Meeting script stored to DB | daily-digest/route.ts (via buildFullScript) | VERIFIED (per import) |

### Flow 11: Stripe Billing

| Check | File:Line | Result |
|-------|-----------|--------|
| Webhook signature verification | stripe/route.ts:23-28 | VERIFIED |
| Idempotency via billing_events | stripe/route.ts:30-51 | VERIFIED |
| 6 event types handled | stripe/route.ts:54-75 | VERIFIED |
| checkout.session.completed | stripe/route.ts:89-126 | VERIFIED — creates subscription |
| subscription.updated tracks past_due | stripe/route.ts:157-205 | VERIFIED |
| subscription.deleted → canceled | stripe/route.ts:207-226 | VERIFIED |
| payment_succeeded clears past_due | stripe/route.ts:228-247 | VERIFIED |
| payment_failed dunning email | stripe/route.ts:282-288 | ISSUE — F11-C-001 |
| Event recording (success + error) | stripe/route.ts:77-84 | VERIFIED |
| Billing portal URL validation | billing/portal/route.ts:41-43 | VERIFIED — L-021 |
| Billing status hides Stripe IDs | billing/status/route.ts:66-69 | VERIFIED — S-012 |
| Subscription access logic | billing/subscription.ts:21-86 | VERIFIED |
| Dunning stage computation | billing/subscription.ts:92-105 | VERIFIED |
| Dunning email pipeline | billing/dunning.ts:167-256 | ISSUE — F11-C-001b |
| Dunning dedup via billing_events | billing/dunning.ts:199-206 | VERIFIED |
| Day 30 auto-cancel | billing/dunning.ts:243-247 | VERIFIED |

### Flow 12: Self-Service Signup

| Check | File:Line | Result |
|-------|-----------|--------|
| Signup form collects all fields | signup/page.tsx:17-24 | VERIFIED |
| Password minimum 12 chars | signup/page.tsx:42 | VERIFIED — H-002 |
| POST to /api/billing/checkout | signup/page.tsx:49 | VERIFIED |
| Auth user creation | checkout/route.ts:39-48 | VERIFIED |
| Dealership creation | checkout/route.ts:70-81 | VERIFIED |
| Users table INSERT | checkout/route.ts:93-101 | ISSUE — F12-C-001 |
| Membership creation | checkout/route.ts:106-112 | VERIFIED (schema OK for memberships) |
| app_metadata set | checkout/route.ts:115-122 | VERIFIED |
| Default feature flags (13 flags) | checkout/route.ts:125-148 | VERIFIED |
| Stripe checkout session | checkout/route.ts:151-155 | VERIFIED |
| Rollback on failure | checkout/route.ts:162-171 | ISSUE — F12-H-001 |
| Slug generation | checkout/route.ts:64-68 | VERIFIED — timestamp suffix |
| Duplicate email handling | checkout/route.ts:51-54 | VERIFIED — 409 response |

### Flow 13: Schedule Awareness

| Check | File:Line | Result |
|-------|-----------|--------|
| OFF keyword parsing | schedule-awareness.ts:50-83 | VERIFIED |
| VACATION keyword parsing | schedule-awareness.ts:87-138 | VERIFIED |
| isScheduledOff checks 3 sources | schedule-awareness.ts:147-177 | VERIFIED |
| Integrated in webhook handler | sinch/route.ts:287-304 | VERIFIED |
| Used in daily-training cron | daily-training (per agent) | VERIFIED |
| UTC date issue | schedule-awareness.ts:155-156 | ISSUE — F13-M-001 |

### Flow 14: Adaptive Weighting

| Check | File:Line | Result |
|-------|-----------|--------|
| Weight update formula | adaptive-weighting.ts:111 | VERIFIED — `old * (1-α) + delta * α` |
| Weight normalization | adaptive-weighting.ts:114-120 | VERIFIED — sum to 1 |
| Weighted random selection | adaptive-weighting.ts:154-166 | VERIFIED |
| Last domain exclusion | adaptive-weighting.ts:148 | VERIFIED — prevents repeat |
| Exploration bonus | adaptive-weighting.ts:155 | VERIFIED — β=0.1 |
| K-pass decay TODO | adaptive-weighting.ts:122-131 | ISSUE — F14-L-001 |
| Per-dealership config | adaptive-weighting.ts:172-182 | VERIFIED — getAdaptiveWeightingConfig() |
| Called after grading | sinch/route.ts:45-46 | VERIFIED (import) |

### Flow 15: Ask IQ → Knowledge Gaps

| Check | File:Line | Result |
|-------|-----------|--------|
| Feature flag gate | ask/route.ts:54-55 | VERIFIED |
| Rate limit (60/hour) | ask/route.ts:63-68 | VERIFIED — in-memory |
| Question length limit (1000 chars) | ask/route.ts:81-86 | VERIFIED |
| RLS-backed INSERT | ask/route.ts:94 | VERIFIED — C-003 migrated |
| AI response placeholder | ask/route.ts:88-91 | ISSUE — F15-M-001 |
| Gaps dashboard shows low-confidence | gaps/route.ts:64 | VERIFIED — lt('confidence', 0.7) |
| Manager role check on gaps | gaps/route.ts:36-38 | VERIFIED |
| Subscription gating on gaps | gaps/route.ts:41-43 | VERIFIED — H-010 |
| 30-day window on gaps | gaps/route.ts:47-49 | VERIFIED |

### Flow 16: Trainee Mode + Language + Model Launch

| Check | File:Line | Result |
|-------|-----------|--------|
| Keyword priority chain | sinch/route.ts:212-228 | VERIFIED — 14 levels documented |
| No LANG keyword | sinch/route.ts | VERIFIED — not present |
| No TRAINEE keyword | sinch/route.ts | VERIFIED — not present |
| users.language column exists | supabase.ts:840 | VERIFIED |
| language used in coach token | app-auth.ts:43 | VERIFIED |
| GPT-5.4 hardcoded in openai.ts | openai.ts (per AUDIT-1) | VERIFIED |
| GPT-4o for coach, GPT-4o-mini for classify | coach/route.ts:24-25 | VERIFIED |

---

## Remediation Priority

### Immediate (Before Next Deploy)

1. **F11-C-001 + F11-C-001b:** Fix dunning email manager lookup — query `dealership_memberships` JOIN instead of `users.dealership_id`. Determine email source (add column or query Auth admin).
2. **F12-C-001:** Fix signup user INSERT — remove nonexistent columns (`email`, `role`, `dealership_id`). Only insert `full_name`, `phone`, `status`.

### This Sprint

3. **F9-H-001:** Add `dealership_id` scope to `closeSession()` and `closeStaleSessionsForUser()`.
4. **F12-H-001:** Fix rollback to also delete `dealership_memberships` and `feature_flags` for the failed dealership.
5. **F7-M-001:** Add dealership scope to `checkPeerChallenge()` in content-priority.ts.
6. **F6-M-001:** Use `getLocalDateString(timezone)` instead of UTC date in `checkDailyChallenge()`.

### Next Sprint

7. **F5-M-001:** Verify `record_chain_step` RPC exists in production DB. If not, create it.
8. **F13-M-001:** Pass timezone to `isScheduledOff()` and use local day-of-week.
9. **F11-M-001:** Derive trial_end from Stripe subscription instead of hardcoding 30 days.
10. **F15-M-001:** Replace Ask IQ placeholder with actual AI integration (or disable feature flag).
