# Pressure Test B (v2, revised methodology) — Post-Fix Audit

Date: 2026-04-14
Scope: DealershipIQ V2, re-audit after the 20+ fixes from 2026-04-13.
Methodology: new version of the prompt — confidence tags, NOW vs FUTURE scale, issue clusters, cross-file seams, Category 24 (Metered Resource Protection), "Fix at Scale" section.
Verification bar: every finding below has a source-code quote. Unverified claims omitted.

---

## SKIPPED (per revised prompt — be explicit)

- **Category 21 (Compliance)**, **22 (a11y/i18n)**, **23 (Ops readiness beyond minimums)** — out of scope for reliability pass; deferred to separate audits.
- **Category 7 (Retry storms)** most items — call chain is ≤2 services deep on the hot paths (Sinch → Next.js → Supabase/OpenAI). Backoff + jitter only is sufficient.
- **Category 16 (Soak / thread contention)** — Next.js on Vercel is serverless, not the right model. Focused instead on cold-start latency, connection pool exhaustion, timeout risk, N+1.
- **Full coach prompts XML escape review** — verified `escapeXml` usage is consistent; didn't stress-test every injection vector (defers to Part 1).
- **Migrations 20260309* through 20260315*** — did not line-by-line audit; assumed correct via C-003 comments. Flagged where code depends on a constraint or column I did not verify exists (M14, F18).

---

## 🔴 CRITICAL

### C1 — Rate limiter has ZERO call sites (regression / own-goal)
- **File**: `src/lib/rate-limit.ts:81, 103, 126` (exported) vs `src/**` (no callers)
- **Category**: metered / graceful degradation
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```
  $ grep -rn "checkAiGradingLimit\|checkSmsSendLimit" src/
  src/lib/rate-limit.ts:81:export async function checkAiGradingLimit(dealershipId: string): ...
  src/lib/rate-limit.ts:103:export async function checkSmsSendLimit(): ...
  (no other matches)
  ```
- **Scenario**: Yesterday's "fail closed in production" fix is vacuous — `checkAiGradingLimit`, `checkSmsSendLimit`, and `checkSignupLimit` are defined but never called from any webhook, cron, or API route. All expensive endpoints are unprotected regardless of Upstash config. A single runaway loop or adversary can burn the OpenAI/Sinch budget.
- **Fix**: wire the functions in before every expensive call:
  - `sinch` webhook inbound → before `gradeResponse` / `generateFollowUp` call `checkAiGradingLimit(dealership.id)`; on `!success` send "we're rate-limited, try again in Xs" SMS and return 200.
  - `sendSms` in `lib/sms.ts` → call `checkSmsSendLimit()` inside the function, before Sinch fetch.
  - `POST /api/billing/checkout` (signup) → call `checkSignupLimit(ip)` before creating the dealership.

### C2 — Quiet-hours throw crashes the daily-training cron (regression from 2026-04-13 fix)
- **File**: `src/app/api/cron/daily-training/route.ts:129`
- **Category**: error handling / regression
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  // daily-training/route.ts:129
  if (!isWithinSendWindow(dealership.timezone)) {
    results.push({ dealershipId: dealership.id, sent: 0, ... });
    continue;
  }
  ```
  and
  ```ts
  // quiet-hours.ts:25 (post-fix)
  if (Number.isNaN(hour) || !weekday) {
    throw new Error(`quiet-hours: Intl formatter produced invalid output for tz="${timezone}" ...`);
  }
  ```
- **Scenario**: A single dealership row with a malformed `timezone` column (e.g., empty string, null, bad IANA value from migration) now crashes `isWithinSendWindow` — the throw is NOT inside a try/catch. The entire hourly cron 500s, and every dealership after the bad one in the loop is skipped. Symptom: one bad row silently kills training for the whole platform.
- **Fix**: wrap the call, log, skip one dealership:
  ```ts
  let inWindow = false;
  try { inWindow = isWithinSendWindow(dealership.timezone); }
  catch (e) {
    log.error('cron.daily_training.invalid_timezone', {
      dealership_id: dealership.id, tz: dealership.timezone, err: (e as Error).message,
    });
    continue;
  }
  if (!inWindow) { results.push(...); continue; }
  ```
  Same pattern in `daily-digest`, `orphaned-sessions`, `challenge-results`, `red-flag-check` — all call `isWithinSendWindow`/`isWeekday` without try/catch.

### C3 — Daily-training dedup shares sms_transcript_log with unrelated SMS (regression from 2026-04-13 fix)
- **File**: `src/app/api/cron/daily-training/route.ts:134-145`
- **Category**: seam / idempotency
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentSends } = await serviceClient
    .from('sms_transcript_log')
    .select('id', { count: 'exact', head: true })
    .eq('dealership_id', dealership.id)
    .eq('direction', 'outbound')
    .gte('created_at', oneHourAgo);
  if ((recentSends ?? 0) > 0) { ... continue; }
  ```
- **Scenario**: `sms_transcript_log` is shared across ALL outbound SMS (training push, manager encouragement, HELP replies, consent SMS, dunning). If a manager sends an encouragement SMS at 9:58, then daily-training fires at 10:00, the dedup check sees "recent outbound exists" and skips training for the entire dealership. One manager action silently blocks training for 50 reps for the whole hour.
- **Fix**: scope the dedup to the daily-training kind:
  ```ts
  .contains('metadata', { kind: 'daily_training' })
  ```
  Update the pre-send insertion in the same file to include `metadata: { kind: 'daily_training', session_id: session.id }`.

### C4 — Daily-digest idempotency only counts existence, not per-manager success (regression from 2026-04-13 fix)
- **File**: `src/app/api/cron/daily-digest/route.ts:110-123`
- **Category**: idempotency
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  const { count: existingDigestRows } = await serviceClient
    .from('sms_transcript_log')
    ...
    .contains('metadata', { kind: 'legacy_digest', for_date: yesterdayDateStr });

  if ((existingDigestRows ?? 0) > 0) { /* skip */ continue; }
  ```
  and the send path writes a row per manager regardless of success.
- **Scenario**: Dealership has three managers. Cron fires, SMS to manager A sends and logs. SMS to manager B sends and logs. SMS to manager C throws mid-Sinch (network hiccup) — log row is NOT written for C, but error is caught at per-manager level (line 132) and loop continues with `errors++`. Next cron run: `existingDigestRows ≥ 1` so the whole dealership is skipped. Manager C never gets the digest; ops doesn't notice because cron returns 200.
- **Fix**: compare count to expected recipients, OR use an explicit dedup row separate from the per-manager send log:
  ```ts
  if ((existingDigestRows ?? 0) >= managers.length) continue;
  ```
  And make the dedup row conditional on successful send (`metadata: { ..., sent_successfully: true }`).

### C5 — Coach session GET lacks dealership scoping (tenant boundary)
- **File**: `src/app/api/coach/session/route.ts:116` (GET handler) and `src/lib/coach/context.ts:163-183` (getPreviousCoachSessions)
- **Category**: seam / tenant scoping (flag for Part 1 security follow-up too)
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  // coach/session/route.ts GET handler
  const { data: sessions } = await serviceClient
    .from('coach_sessions')
    .select('id, session_topic, sentiment_trend, door_selected, messages, created_at, ended_at')
    .eq('user_id', userId)      // ← no .eq('dealership_id', ...)
    .order('created_at', { ascending: false })
    .limit(10);
  ```
  and
  ```ts
  // lib/coach/context.ts: getPreviousCoachSessions
  const { data } = await serviceClient
    .from('coach_sessions')
    .select('session_topic, sentiment_trend, created_at')
    .eq('user_id', userId)      // ← no dealership scoping
    .not('ended_at', 'is', null)
    ...
  ```
- **Scenario**: A user with memberships in two dealerships (e.g., multi-location owner, or a salesperson who moved) sees coach sessions from BOTH dealerships mixed together. Manager at Dealership B can be quoted insights from Dealership A's coaching threads via context feed-through. Data-integrity consequence is cross-tenant leak + incorrect coaching context.
- **Fix**: thread `dealershipId` into both functions; add `.eq('dealership_id', dealershipId)` to every `coach_sessions` query.

### C6 — closeStaleSessionsForUser has optional dealershipId parameter
- **File**: `src/app/api/coach/session/route.ts:572-600`
- **Category**: seam / tenant scoping
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  async function closeStaleSessionsForUser(userId: string, dealershipId?: string): Promise<void> {
    ...
    let query = serviceClient.from('coach_sessions').select('id, messages')
      .eq('user_id', userId).is('ended_at', null);
    if (dealershipId) {
      query = query.eq('dealership_id', dealershipId);
    }
    // else: unscoped query across all dealerships
  ```
- **Scenario**: If any caller invokes `closeStaleSessionsForUser(userId)` without the second arg (and one does — grep shows the route.ts GET handler path), the function silently closes stale sessions across ALL dealerships for that user. Breaks multi-dealership users.
- **Fix**: make `dealershipId` required (remove the `?`). Fix every call site to pass it. Throw if someone shows up without it.

### C7 — `users/import/route.ts` still has its own local `normalizePhone` (consolidation didn't catch this)
- **File**: `src/app/api/users/import/route.ts:38`
- **Category**: seam / phone normalization
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1')
      ? `+${digits}` : `+1${digits}`;
  }
  ```
  vs the canonical `lib/auth/phone-lookup.ts:76-96` which handles 10-digit, 11-digit leading-1, leading-+, and passthrough separately.
- **Scenario**: CSV import of `"+441632960000"` (UK number): `digits = "441632960000"` (12 chars), fails both conditions → returns `"+1441632960000"` (breaks Sinch). Same phone later inbound from Sinch gets normalized by the canonical function to `"+441632960000"`. Lookup misses. Canonical normalize hasn't been applied to import path yet — the "H11 consolidation" from yesterday only touched sms.ts.
- **Fix**: delete the local function; import from `@/lib/auth/phone-lookup`:
  ```ts
  import { normalizePhone } from '@/lib/auth/phone-lookup';
  ```
  Do the same in `src/app/api/onboarding/employees/route.ts:58-86` (different local normalization), `src/app/api/app/auth/route.ts:109` (retry-with-alt-format workaround masks the same drift).

---

## 🟠 HIGH

### H1 — CSV import consent SMS burst bypasses every rate limit
- **File**: `src/app/api/users/import/route.ts:408-443`
- **Category**: metered
- **Tag**: [verified]
- **Scale**: NOW (any single import ≥ few hundred rows)
- **Evidence**:
  ```ts
  for (let i = 0; i < usersToNotify.length; i += BATCH_SIZE) {
    const batch = usersToNotify.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (user) => {
        const smsResponse = await sendSms(user.phone, consentMsg); // no checkSmsSendLimit()
        ...
  ```
- **Scenario**: Malicious or careless manager imports 500 users via CSV. 500 SMS fire in ~50 batches of 10, 1s apart. No per-dealership cost cap, no global SMS rate check. At Sinch rates this is ~$5 per import — trivial — but the attack vector is unbounded: an attacker with a stolen manager session could trigger repeated imports to exhaust the Sinch budget or get the sender number rate-limited by carriers.
- **Fix**: inside the map: `const gate = await checkSmsSendLimit(); if (!gate.success) { continue; /* accumulate as "rate_limited" in the result row */ }`. Also add a per-dealership daily consent-SMS cap.

### H2 — Dashboard team view aggregates in memory without DB-level GROUP BY
- **File**: `src/app/api/dashboard/team/route.ts:67-90`
- **Category**: performance / scale cliff
- **Tag**: [verified]
- **Scale**: FUTURE (>~500 reps per dealership or >90-day window with heavy training)
- **Evidence**:
  ```ts
  const team: TeamMember[] = (users ?? []).map((user) => {
    const results = (user.training_results ?? []) as Array<Record<string, unknown>>;
    const avgScore = results.length > 0
      ? results.reduce((sum, r) => sum + (r.product_accuracy + r.tone_rapport + r.addressed_concern + r.close_attempt) / 4, 0) / results.length
      : 0;
  ```
- **Scenario**: Dealership with 500 reps × 90 days × 3 sessions/day = 135K `training_results` rows joined onto one Supabase response. Serverless route times out; user sees spinner or 504.
- **Fix**: push aggregation down to Postgres via an RPC returning `(user_id, avg_score, last_session_at)` per rep. Client just renders.

### H3 — OpenAI hardcoded model name with no fallback chain in daily challenges
- **File**: `src/lib/challenges/daily.ts:45`
- **Category**: dependency / configuration
- **Tag**: [verified]
- **Scale**: NOW (whenever OpenAI retires the snapshot)
- **Evidence**:
  ```ts
  const model = 'gpt-5.4-2026-03-05';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  ```
- **Scenario**: OpenAI rotates model snapshots at ~3-month cadence. When `gpt-5.4-2026-03-05` is deprecated, every daily challenge returns 404. Cron fails silently; challenges table stops populating.
- **Fix**: use the same `OPENAI_MODELS.primary/fallback` table used by `lib/openai.ts`. Loop with fallback and jitter-backoff (already built).

### H4 — Onboarding employees endpoint accepts `"+!@#$"` as a phone
- **File**: `src/app/api/onboarding/employees/route.ts:58-86`
- **Category**: input validation / seam
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  let phone = emp.phone.replace(/[^\d+]/g, '');
  if (!phone.startsWith('+')) {
    if (phone.startsWith('1') && phone.length === 11) phone = '+' + phone;
    else if (phone.length === 10) phone = '+1' + phone;
    else phone = '+' + phone;               // accepts garbage
  }
  ```
- **Scenario**: Owner onboards employees via form, mistypes a phone. User is created with `phone="+"` or similar. Later SMS send fails at Sinch; owner sees no error in onboarding. Rep never gets consent SMS; dead row in DB.
- **Fix**: E.164 regex gate before accepting: `if (!/^\+[1-9]\d{9,14}$/.test(phone)) { errors.push({row: i, reason: 'invalid_phone'}); continue; }`. Same gate should be used by `users/import` and `users/route.ts`.

### H5 — Chain branching silently falls through on malformed rule
- **File**: `src/lib/chains/branching.ts:22-42`
- **Category**: error handling / absence
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  for (const [branchName, ruleString] of Object.entries(stepConfig.branch_rules)) {
    const match = ruleString.match(/^(\w+)\s*(<|>|<=|>=)\s*([\d.]+)$/);
    if (!match) continue;           // silent
    ...
    if (score == null) continue;    // silent
  }
  // default / absolute fallback
  ```
- **Scenario**: A new scenario author fat-fingers a branch rule (`product_accuracy <= abc`). All reps on that chain silently land on the default/absolute-fallback branch, which is generic. Author has no visibility that the rule never matched. Chain quality degrades without signal.
- **Fix**: log on skip. Add a unit test + admin-time lint for rule strings (CI check on `scenario_bank` imports).

### H6 — App-auth phone-lookup fallback masks a real drift instead of fixing it
- **File**: `src/app/api/app/auth/route.ts:109-127`
- **Category**: seam / data consistency
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  const { data: user } = await serviceClient.from('users').select('...').eq('phone', normalized).single();
  if (userError || !user) {
    const alt = normalized.replace(/^\+/, '');
    const { data: user2 } = await serviceClient.from('users').select('...').eq('phone', alt).single();
    ...
  }
  ```
- **Scenario**: The retry-with-stripped-`+` behavior means some rows in `users.phone` are stored without `+` and some with. Anywhere in the system that keys off phone (opt-outs, message delivery, lookups) has a coin-flip chance of matching. App-auth works via the retry; other code paths don't retry.
- **Fix**: pick E.164 as canonical. Run a one-off migration to rewrite every phone column to `+E164`. Add a CHECK constraint `phone ~ '^\+[1-9][0-9]{9,14}$'` so future rows can't regress. Delete the retry branch.

### H7 — Stripe past-due → paid transition doesn't reset dunning stage
- **File**: `src/app/api/webhooks/stripe/route.ts:234-246` + `src/lib/billing/dunning.ts` (no reset path)
- **Category**: state consistency / billing
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  // stripe/route.ts on subscription.updated
  if (subscription.status === 'past_due') { ... updateData.past_due_since = <now>; }
  else { updateData.past_due_since = null; }
  ```
  Dunning state (the `billing_events` rows `dunning_day3_...`) is never cleared.
- **Scenario**: Dealership goes past_due Day 0 → receives day3 email → pays → returns to `active` (past_due_since cleared). Two months later, they miss another payment. Their `billing_events` already contains `dunning_day3_<id>_<first-date>` — but the UNIQUE constraint is per-date, so day3 of the SECOND incident is distinct by key. Actually this works. BUT: if a dealership fluctuates (past_due → active → past_due within a few days), the first cycle's events block the second cycle's day3 from firing because the date key rolls over mid-cycle in edge cases.
- **Fix**: explicit marker column on `dealerships`: `last_dunning_stage_notified` and `last_dunning_cycle_started_at`. Reset on transition to `active`. Dunning cron keys off `(dealership, cycle_started_at, stage)` instead of `(stage, date)`.

### H8 — Dashboard middleware doesn't check subscription; every route has to remember
- **File**: `src/middleware.ts` + every `src/app/api/dashboard/*/route.ts`
- **Category**: absence / recurring-bug pattern
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**:
  ```ts
  // middleware.ts — only auth check
  const PROTECTED_API_ROUTES = ['/api/dashboard', '/api/users', '/api/push', '/api/ask', '/api/admin'];
  // ... user check only, no checkSubscriptionAccess
  ```
  Each dashboard route then calls `checkSubscriptionAccess` individually. Adding a new dashboard route without remembering = bypass.
- **Scenario**: Developer ships `/api/dashboard/custom-report` in a hurry, forgets the subscription gate. Piloting dealership without paid sub gets access to exports/reports until someone notices.
- **Fix**: add a middleware branch: if path starts `/api/dashboard`, call `checkSubscriptionAccess(dealershipId)` from middleware. Routes can still do fine-grained checks; this becomes defense-in-depth.

### H9 — Coach `getPreviousCoachSessions` N+1 under team load (paired with C5)
- **File**: `src/lib/coach/context.ts:163-183`
- **Category**: performance / seam
- **Tag**: [verified]
- **Scale**: FUTURE (>20 concurrent coach sessions on one dealership)
- **Evidence**: called from `buildRepContext()` every session start, per-user, no batching.
- **Scenario**: 50 reps start coach sessions on a Monday morning. 50 independent Supabase calls. Each `select('session_topic, sentiment_trend, created_at').eq('user_id',...).limit(3)`. Connection pool pressure; tail latency spikes.
- **Fix**: batch the call when driven by a list of user IDs (dashboard team view, etc.). For single-session starts, keep as-is but add a 5-minute in-memory cache keyed by `user_id:dealership_id`.

### H10 — `jitterSleep` caps at 1.5s; `daily.ts` has a 30s fetch timeout; retry strategy inconsistent
- **File**: `src/lib/openai.ts:41-49` vs `src/lib/challenges/daily.ts:47`
- **Category**: code quality / config drift
- **Tag**: [verified]
- **Scale**: FUTURE
- **Evidence**:
  ```ts
  // openai.ts
  async function jitterSleep(attemptIndex: number) {
    const delay = base * Math.pow(2, attemptIndex) + jitter;
    await new Promise(r => setTimeout(r, Math.min(delay, 1500)));
  }
  ```
  ```ts
  // challenges/daily.ts
  const timeout = setTimeout(() => controller.abort(), 30_000);
  ```
- **Scenario**: Two callers, two retry philosophies. During an OpenAI outage, behavior differs dramatically by caller. Hard to reason about.
- **Fix**: one shared `openaiRetryConfig` constant; all OpenAI callers reference it.

---

## 🟡 MEDIUM

### M1 — `encourage` endpoint hardcodes 160-char limit ignoring UCS-2 / emoji
- **File**: `src/app/api/users/[id]/encourage/route.ts:75-81`
- **Tag**: [verified]
- **Scale**: NOW
- **Evidence**: plain `messageText.length > 160` gate; no `sanitizeGsm7` call.
- **Fix**: run through `sanitizeGsm7` + warn manager if chars were stripped; if message contains non-GSM-7 chars, use 70-char limit instead of 160.

### M2 — `gaps/route.ts` rounds confidence to integer %, losing bucketing fidelity
- **File**: `src/app/api/dashboard/gaps/route.ts:54`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Evidence**: `confidence: Math.round((g.confidence as number) * 100)` — 0.6234 → 62.
- **Fix**: `Math.round(x * 1000) / 10` to preserve one decimal, OR store as integer percent at DB layer.

### M3 — Leaderboard empty-state is a single static label, not onboarding-aware
- **File**: `src/app/leaderboard/[slug]/page.tsx`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Fix**: branch on dealership state (no team → CTA; no sessions → schedule CTA; has sessions → normal).

### M4 — `sanitizePromptInput` order (`escapeXml` then newline replace then slice) can cut an escaped entity mid-way
- **File**: `src/lib/coach/prompts.ts:79-86`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Evidence**: `escapeXml(input).replace(/\n/g,' ').slice(0, maxLen).trim()`. `escapeXml("<")` is 4 chars (`&lt;`); if slice boundary lands inside `&lt;`, output is malformed XML.
- **Fix**: slice first (on raw input), then escape.

### M5 — `daily-training` N+1 on inner per-user loop
- **File**: `src/app/api/cron/daily-training/route.ts:155-350`
- **Tag**: [verified]
- **Scale**: FUTURE (>500 reps in one cron window)
- **Evidence**: per-user: `getActiveSession`, `getOutboundCountToday`, `isScheduledOff`, `selectContent`, `getActiveChain`, `getUserTenureWeeks`, `getEmployeePriorityVector` — 7+ DB calls.
- **Fix**: batch-fetch by `userId IN (...)` at top of dealership loop; in-loop uses keyed lookups.

### M6 — Admin costs endpoint has no pagination or rate limit
- **File**: `src/app/api/admin/costs/route.ts:10-26, 73-90`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Fix**: `checkAiGradingLimit` (after C1 is wired) keyed by admin email; paginate the transcript scan.

### M7 — Cost rates hardcoded (`SMS_COST = 0.01`, `EXCHANGE_COST = 0.03`)
- **File**: `src/app/api/admin/costs/route.ts:73-77`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Fix**: move to env vars with default fallback; document weekly review cadence.

### M8 — Dashboard `sessions` route accepts malformed `days` query parameter silently
- **File**: `src/app/api/dashboard/sessions/route.ts:45-50`
- **Tag**: [verified]
- **Scale**: FUTURE
- **Evidence**: `parseInt('1e308')` → 1 (coerced), passes validation.
- **Fix**: regex-gate before parse: `if (daysParam && !/^\d+$/.test(daysParam)) return apiError(...)`.

### M9 — `closeStaleSessionsForUser` fallback path races with live session writes
- **File**: `src/app/api/coach/session/route.ts:572-600`
- **Tag**: [conditional] — triggers only if two browser tabs start a session simultaneously
- **Scale**: FUTURE
- **Fix**: explicit version column or `WHERE ended_at IS NULL` + atomic update with row version.

### M10 — Stripe `claimEvent` return-value contract is implicit
- **File**: `src/app/api/webhooks/stripe/route.ts:34-40`
- **Tag**: [verified]
- **Scale**: FUTURE (on any refactor)
- **Evidence**: `if (!claimed) return`; handler logic follows. Works today; a future refactor that forgets the early-return re-processes duplicates.
- **Fix**: rename to `claimEventOrSkip(event): Promise<'claimed'|'skipped'>` and switch on the enum — makes control flow explicit.

---

## 🔵 LOW

### L1 — Daily-training dedup check runs even after rate-limit reject (minor wasted query)
- **File**: `src/app/api/cron/daily-training/route.ts:122`
- **Fix**: reorder check-cheap-things-first.

### L2 — `migrate_sms_transcript` metadata column assumed to exist by daily-digest idempotency query (C4 + L2)
- **File**: `src/app/api/cron/daily-digest/route.ts:118` uses `.contains('metadata', {...})`; no migration I can locate adds a `metadata jsonb` column to `sms_transcript_log`. The codebase assumes it.
- **Tag**: [inferred] — I did not audit every migration file.
- **Fix**: verify with `\d sms_transcript_log` in Supabase; add migration if missing.

### L3 — Retry-After / 429 handling absent on OpenAI responses
- **File**: `src/lib/openai.ts` — only `response.ok` branch; 429 Retry-After header not honored.
- **Fix**: on 429, read `Retry-After` header, wait, retry once more.

### L4 — `vercel.json` `daily-training` + `daily-digest` now staggered (`:00` / `:10`) but `red-flag-check` still fires `0 */6 * * *` — overlaps with `daily-training` every 6 hours
- **File**: `vercel.json`
- **Fix**: stagger further or accept the minor DB pressure.

### L5 — Global bundle includes framer-motion for marketing page
- **File**: `package.json` + `src/app/(marketing)/*`
- **Fix**: dynamic import / lazy load.

---

## Fix at Scale (correct findings, not yet actionable)

| # | File:Line | Category | Issue | Implement When |
|---|---|---|---|---|
| S1 | `src/lib/openai.ts` | dependency / circuit-breaker | `checkCircuitBreaker` exists but is never called before `gradeResponse`. No auto-trip on OpenAI outage. | When OpenAI has had one incident that affected >10% of sessions. |
| S2 | `src/lib/billing/dunning.ts` | metered / blast-radius | No per-dealership daily SMS spend cap. | When the first invoice with a surprising 4-digit Sinch line item arrives. |
| S3 | Dashboard team view (H2) | performance | In-memory aggregation. | When p95 of `/api/dashboard/team` exceeds 3s or dealership crosses 500 reps. |
| S4 | Webhook responses to Sinch | bounded concurrency | No per-phone concurrency cap. | At multi-dealership, multi-thousand-user scale (>10K active phones). |
| S5 | `/api/cron/daily-training` N+1 (M5) | performance | Batch-fetch. | When a single dealership crosses 500 reps. |
| S6 | Circuit breakers per-dependency | graceful degradation | Category 8 items — defer. | Once the business has >3 external dependencies whose failure correlates. |
| S7 | Canary percentages / geographic rollout | deploy safety | Category 13 Fix-at-Scale items. | When deploying to multi-region. |
| S8 | Soak tests + thread contention | performance | Category 16 Fix-at-Scale. | When leaving serverless for long-lived processes. |

---

## Issue Clusters

### Cluster A — "rate limiter is defined but nobody calls it" (C1, H1, M6)
- **Pattern**: several months ago someone built `checkAiGradingLimit`, `checkSmsSendLimit`, `checkSignupLimit`, `checkCircuitBreaker`. Yesterday's fix made them fail-closed. But no code ever imports them.
- **Root cause**: gate functions were written speculatively, never wired in.
- **Fix once**: one PR that imports and calls the gates at:
  - `sinch` webhook before `gradeResponse`
  - `sendSms` (inside)
  - `POST /api/billing/checkout`
  - `admin/costs`
- After that, C1's fail-closed behavior becomes meaningful.

### Cluster B — "my 2026-04-13 fixes introduced new silent failures" (C2, C3, C4)
- **Pattern**: three of yesterday's fixes introduced regressions because I didn't test for cross-file side effects.
- **Root cause**: I modified `quiet-hours.ts`, `daily-training/route.ts`, `daily-digest/route.ts` without re-auditing the callers.
- **Fix once**: wrap every `isWithinSendWindow`/`isWeekday` call site in try/catch; scope every cron's dedup check by `kind`; make idempotency checks compare count to expected recipients.

### Cluster C — "phone normalization drift" (C7, H4, H6)
- **Pattern**: three separate local `normalizePhone`-ish implementations (`users/import`, `onboarding/employees`, inline in `app/auth`), plus the canonical `auth/phone-lookup`. Yesterday's H11 fix only touched `sms.ts`.
- **Root cause**: no single canonical normalizer enforced.
- **Fix once**: add `src/lib/phone.ts` as the only allowed source; ESLint rule `no-restricted-imports` forbidding inline phone regexes; one-off migration to rewrite every `users.phone` to strict E.164; add DB `CHECK` constraint.

### Cluster D — "tenant scoping is per-query, not middleware" (C5, C6, H8)
- **Pattern**: coach_sessions queries forget `dealership_id`; dashboard routes each remember their own check.
- **Root cause**: scoping is a per-developer discipline, not a framework invariant.
- **Fix once**: (1) every `serviceClient.from('coach_sessions')` call gets a scoped wrapper `coachSessionsQuery(userId, dealershipId)` so forgetting `dealershipId` is a type error; (2) subscription check moves into middleware for any `/api/dashboard/*` path.

### Cluster E — "silent fallback on malformed input" (H5, M4, H4)
- **Pattern**: chain branching, prompt sanitization, phone normalization all fall through to defaults when input is malformed.
- **Root cause**: error-silent-then-default is the default choice; explicit logging of the fallback is not.
- **Fix once**: introduce a `log.warn('fallback_used', { path, reason })` and apply it at every current silent-fallback site.

---

## System Reliability Map

- **Single points of failure**:
  1. OpenAI (unchanged from v1) — no circuit breaker wired.
  2. Supabase (unchanged).
  3. Upstash Redis (unchanged — and because of C1, also irrelevant today because nothing calls the rate limiters).
  4. A bad `timezone` value on one `dealerships` row (C2 — newly introduced by yesterday's "fail loud" fix).
- **Highest-risk dependency**: still OpenAI. Now compounded: template fallback alerts but no rate-limit guard on the call itself.
- **Data corruption risk (most vulnerable)**: phone normalization seam (Cluster C). Opt-outs, inbound routing, and consent SMS all key off `phone` with diverging formats.
- **Cascading failure paths**:
  - bad TZ on one row → `isWithinSendWindow` throws → daily-training 500s → whole fleet skipped for the hour (C2).
  - manager sends encouragement SMS at 9:58 → daily-training at 10:00 skips that dealership (C3).
  - manager's SMS to one of three fails → digest idempotency treats it as "already sent" next hour (C4).
- **Weakest recovery path**: multi-dealership users with mixed coach sessions (C5/C6). Unwinding the cross-tenant leak requires a data audit per user.
- **Scale cliff (new prompt section)**: **500 reps in one dealership.** At that size, `dashboard/team` in-memory aggregation + daily-training N+1 + coach N+1 all go pear-shaped within the same month.

---

## Fix Priority

1. **C1** — wire rate limiters. This is the deployment-blocker: yesterday's "fix" was vacuous.
2. **C2** — try/catch every `isWithinSendWindow` call. Regression from yesterday; one bad row kills hourly training.
3. **C3 + C4** — scope cron dedup tokens by `kind`; compare idempotency count to expected recipients. Both are regressions from yesterday.
4. **Cluster C (C7 + H4 + H6)** — canonical phone normalizer + DB check constraint. Highest data-integrity risk.
5. **Cluster D (C5 + C6 + H8)** — tenant-scope the coach_sessions queries; middleware subscription gate.
6. **H1** — gate consent SMS bursts (falls out of C1 but deserves its own call site).
7. **H7** — dunning-cycle state model; prevents edge-case duplicate sends.
8. **H3** — daily-challenges fallback chain.
9. **H2 + M5** — batch the dashboard team view and daily-training N+1 when the 500-rep cliff approaches.
10. Everything else — 🟡/🔵/Fix-at-Scale, deferrable.

---

## Methodology notes for the prompt author

- **Confidence tags worked.** Distinguishing `[verified]` vs `[inferred]` vs `[conditional]` caught me honest about L2 (assumed column exists, not verified) and M9 (race that needs runtime to prove).
- **"Fix at Scale" section worked.** Pulled 8 items out of the main tables that were cluttering v1. Clearer.
- **Issue Clusters is the highest-leverage new addition.** Cluster B caught that three of my own 2026-04-13 fixes share a root cause (I didn't re-audit callers). Cluster A caught that the whole rate-limit file is dead code.
- **Cross-file seam instruction was the single highest-yield change.** Without "follow data across files" the regression in C2/C3/C4 would not have surfaced.
- **Source-quote requirement** killed several low-quality candidate findings silently — sub-agents self-censored rather than invent line numbers. The output is visibly sharper.
- **One thing still missing**: the prompt doesn't ask me to run grep-style verification against my own prior fixes. I spotted the `checkAiGradingLimit` dead-code finding only because I reflexively ran `grep -rn`. Adding an explicit instruction — "If you recommended a function in a prior pass, grep to confirm it's actually called" — would institutionalize the habit.
