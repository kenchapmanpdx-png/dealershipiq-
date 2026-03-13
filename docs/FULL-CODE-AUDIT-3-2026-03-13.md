# DealershipIQ Full Code Audit #3 — 2026-03-13

**Methodology:** v3 audit prompt (10-phase, red-team lens, mandatory inventories)
**Scope:** All 113 TypeScript files. Third pass after Audit #1 fixes applied and Audit #2 findings cataloged.
**Build status:** `tsc --noEmit` passes clean.
**Audit #1 fixes:** All 16 verified applied and correct.
**Audit #2 findings:** All 22 verified present and accurately described.

---

## SUMMARY TABLE

| Severity | New (this audit) | Carried from Audit #2 | Total Open |
|----------|------------------|-----------------------|------------|
| CRITICAL | 2 | 4 (C-006 through C-009) | 6 |
| HIGH | 4 | 5 (H-009 through H-013) | 9 |
| MEDIUM | 5 | 6 (M-013 through M-018) | 11 |
| LOW | 3 | 6 (L-013 through L-018) | 9 |
| **TOTAL** | **14** | **21** | **35** |

Plus C-003 (serviceClient RLS migration) — multi-sprint, deferred.

---

## NEW CRITICAL FINDINGS

### C-010: TCPA — Opt-Out Check Fails Open on DB Error

- **File:** `src/lib/sms.ts` lines 49, 64
- **Bug:** `isOptedOut()` returns `false` on both env-missing AND DB error:
```typescript
if (!url || !key) return false; // sends SMS if DB unreachable
// ...
} catch { return false; } // sends SMS on query failure
```
- **Impact:** TCPA violation. If Supabase is down or env vars misconfigured, ALL opt-out checks pass. SMS sent to opted-out users. Federal fine: $500–$1,500 per message.
- **Fix:** Fail-closed: return `true` (block send) on any error. Add alerting.
- **Severity rationale:** TCPA regulatory exposure overrides "unlikely" probability.

### C-011: Stripe Idempotency Check — Error Object Not Checked

- **File:** `src/app/api/webhooks/stripe/route.ts` lines 30-34
- **Bug:** Extends C-009. The `.maybeSingle()` call returns `{ data, error }`. Code checks `data` (line 36) but never checks `error`. If the query fails with a Supabase error (not an exception), `data` is null, `existing` is falsy, and the event is processed despite DB failure. Combined with C-009's missing try-catch, this creates two failure modes: (1) exception → unhandled → 500 → Stripe retry loop; (2) error object → silent pass-through → double-processing.
- **Impact:** Double-processing of subscription updates, payment status changes.
- **Fix:** Check both error and wrap in try-catch (see C-009 fix in Audit #2).

---

## NEW HIGH FINDINGS

### H-014: TCPA — HELP Response Exceeds 160 Characters

- **File:** `src/lib/sms.ts` ~line 186 (`helpResponse()`)
- **Bug:** HELP response template: `"DealershipIQ: Daily sales training for ${dealershipName}. Commands: STOP to opt-out, HELP for info, TRAIN for extra practice, CHALLENGE to compete, OFF/VACATION for scheduling. Msg&data rates may apply. Reply STOP to cancel."`
- With a typical 20-char dealership name, this is ~230 characters (2 SMS segments).
- **Impact:** TCPA requires HELP responses to be delivered. Multi-segment messages have higher delivery failure rates. Carrier filtering may block long HELP responses from short codes.
- **Fix:** Trim to single segment (≤160 chars). Remove redundant "Reply STOP to cancel" (already says "STOP to opt-out").

### H-015: persona-moods ALL_MOODS Incomplete — getMoodPromptModifier Broken

- **File:** `src/lib/persona-moods.ts` line 122
- **Bug:** `const ALL_MOODS: MoodConfig[] = [...TIER_3_MOODS]` — only includes TIER_3 moods. `getMoodPromptModifier()` searches `ALL_MOODS`, so any mood from TIER_1 or TIER_2 (friendly, supportive, encouraging, direct, witty, etc.) returns empty string `''`.
- **Impact:** `selectPersonaMood()` correctly picks tenure-appropriate moods from all tiers. But when `getMoodPromptModifier()` is called with that mood, it fails to find the config for TIER_1/TIER_2 moods. AI grading/training prompts lack persona modifiers for newer employees.
- **Affected flow:** Training prompt assembly → `getMoodPromptModifier(mood)` → returns `''` → prompt has no personality → generic tone for TIER_1/TIER_2 employees.
- **Fix:** `const ALL_MOODS = [...TIER_1_MOODS, ...TIER_2_MOODS, ...TIER_3_MOODS]`

### H-016: Vehicle Data Brand Fallback — Wrong Brand Vehicles Sent

- **File:** `src/lib/vehicle-data.ts`
- **Bug:** If dealership brand filter returns empty results, falls back to returning ANY vehicle from the database. A Ford dealership could receive Toyota inventory in training scenarios.
- **Impact:** Training scenarios reference wrong brand vehicles. Employees practice on irrelevant content. Manager trust erodes.
- **Fix:** Return empty + log warning instead of falling back to wrong-brand vehicles. Let calling code handle no-vehicle gracefully.

### H-017: User Import — Promise.all Consent SMS Batch Failure

- **File:** `src/app/api/users/import/route.ts` lines 332-352
- **Bug:** Escalated from M-016 (Audit #2). `Promise.all()` means one Sinch API failure kills the entire batch. Combined with: no retry mechanism, no record of which SMS succeeded/failed, and the response to manager doesn't indicate partial failure.
- **Impact:** Manager imports 10 reps → 1 SMS fails → remaining 9 consent SMS may not send → employees never get onboarded → manager doesn't know.
- **Fix:** `Promise.allSettled()` + return per-user success/failure status in response.

---

## NEW MEDIUM FINDINGS

### M-019: Non-GSM-7 Characters in Source Templates

- **Files:** `lib/schedule-awareness.ts` lines 109, 120, 136; `api/webhooks/sms/sinch/route.ts` line 374
- **Bug:** Smart quotes (`"..."`) and em-dash (`—`) in hardcoded SMS templates. `sanitizeGsm7()` handles these at send time, but the source strings are misleading and create maintenance risk.
- **Impact:** If `sanitizeGsm7()` is ever bypassed or modified, these messages fail delivery or consume double segments (UCS-2 encoding).
- **Fix:** Replace in source: `"` → `"`, `'` → `'`, `—` → `-`.

### M-020: Webhook SMS Dedup — No Cleanup Threshold Enforcement

- **File:** `src/app/api/webhooks/sms/sinch/route.ts` lines 155-158
- **Bug:** Cache cleanup fires when size > 10000, deletes first 1000 entries. But between cleanups, cache grows unbounded. On sustained high traffic, cleanup never catches up.
- **Impact:** Memory growth in long-lived serverless instances. Less severe on Vercel (cold starts), but problematic if infra changes.
- **Fix:** Use LRU cache with hard cap instead of periodic cleanup.

### M-021: Coach Session Rate Limit In-Memory (Cross-Instance Blind)

- **File:** `src/app/api/coach/session/route.ts` lines 57-64
- **Bug:** In-memory Map for rate limiting. Resets on cold start. Doesn't share across Vercel instances. Same user hitting different instances gets fresh limits each time.
- **Impact:** Rate limit effectively disabled in production. User can exceed limits by retrying (different instance each time).
- **Fix:** Move to Upstash Redis (same as planned rate-limit.ts fix) or DB-backed counter.

### M-022: Chain Operations Missing dealershipId Validation

- **File:** `src/lib/chains/lifecycle.ts`
- **Bug:** `getActiveChain()`, `recordChainStepResult()`, and `completeChain()` operate by `chain_id` or `user_id` without requiring `dealership_id`. The calling code (webhook handler) does pass the correct user context, but the functions themselves don't enforce tenant isolation.
- **Impact:** If any new caller invokes these functions without proper context, cross-tenant chain access is possible. Defense-in-depth violation.
- **Fix:** Add `dealership_id` parameter to all chain functions and include in WHERE clauses.

### M-023: Daily Challenge Division by Zero

- **File:** `src/lib/challenges/daily.ts`
- **Bug:** Challenge ranking computes percentages without checking for zero participants. `score / totalParticipants * 100` when `totalParticipants === 0` → NaN in results SMS.
- **Impact:** Corrupted challenge results SMS. Edge case: dealership with 1 rep who doesn't respond.
- **Fix:** Guard: `if (totalParticipants === 0) return;`

---

## NEW LOW FINDINGS

### L-019: Frontend Double-Submit on Forms

- **Files:** `signup/page.tsx`, `login/page.tsx`, billing forms
- **Bug:** No submit-in-progress flag. Rapid double-click submits form twice.
- **Impact:** Duplicate API calls. For signup: potentially duplicate account creation attempts.
- **Fix:** Disable submit button on click; re-enable on response.

### L-020: PWA Token Not Validated Client-Side

- **File:** `src/app/app/[slug]/layout.tsx`
- **Bug:** Client stores token but doesn't check expiration before making API calls. Expired token → API returns 401 → user sees generic error.
- **Impact:** Poor UX. Token expires after 7 days; user gets no prompt to re-auth.
- **Fix:** Check `payload.expiresAt < Date.now()` on page load; redirect to auth if expired.

### L-021: Billing Portal URL Not Validated

- **File:** `src/app/api/billing/portal/route.ts`
- **Bug:** Stripe returns a portal URL that is used directly in redirect without validation. If Stripe account is compromised or returns unexpected URL, user could be redirected maliciously.
- **Impact:** Very low probability (requires Stripe compromise). Defense-in-depth.
- **Fix:** Validate URL starts with `https://billing.stripe.com/`.

---

## CROSS-CUTTING PATTERNS

### Pattern 1: serviceClient in User-Facing Routes

10 of 26 serviceClient usages are in user-facing API routes where RLS should be used instead. All 10 have manual `dealership_id` filters, but a single missing filter = cross-tenant exposure.

**Root cause:** No RLS policies written yet. All routes bootstrapped with serviceClient for speed.

**Affected routes (UNJUSTIFIED serviceClient):**
1. `api/onboarding/brands/route.ts`
2. `api/onboarding/employees/route.ts`
3. `api/users/route.ts`
4. `api/users/[id]/route.ts`
5. `api/users/[id]/encourage/route.ts`
6. `api/users/import/route.ts`
7. `api/dashboard/meeting-script/route.ts`
8. `api/dashboard/coach-themes/route.ts`
9. `api/push/training/route.ts`
10. `app/leaderboard/[slug]/route.ts` (public)

**Justified usages (16):** cron jobs (6), webhooks (2), phone-based auth (2), libraries (5), admin (1).

### Pattern 2: user_metadata Trust Boundary Violation

Only ONE route (`meeting-script`) falls back to `user_metadata?.dealership_id`. All other routes correctly use `app_metadata` only. This was verified by searching all files for `user_metadata?.dealership_id`.

**Finding from verification:** `dashboard/layout.tsx` uses `user.user_metadata?.full_name` for display — no security risk.

### Pattern 3: Fail-Open Error Handling

Multiple components fail-open on errors:
- `isOptedOut()` → returns false (sends SMS) on DB error — **C-010**
- Rate limiting → passes through if Upstash not configured — **C-005 (Audit #1)**
- AI grading → returns template scores on failure — **H-005 (Audit #1, fixed)**
- Vehicle data → returns wrong-brand vehicles on empty — **H-016**

**Philosophy fix needed:** Establish convention: security-critical functions fail-CLOSED. Convenience functions may fail-open with logging.

### Pattern 4: No Retry/Partial-Failure Handling in Batch Operations

- User import consent SMS: `Promise.all` — **H-017**
- Dunning email: catches error, relies on cron retry — adequate
- Challenge results SMS: individual try-catch — adequate

---

## FIX VERIFICATION — AUDIT #1 FINDINGS

All 16 fixes from Audit #1 re-verified:

| ID | Status | Verification |
|----|--------|-------------|
| B-001 | ✅ FIXED | `JSON.parse(atob(token))` confirmed in `[slug]/layout.tsx` |
| B-002 | ✅ FIXED | Dealership membership validation confirmed in `app/auth/route.ts` |
| C-001 | ✅ FIXED | `verifyCronSecret()` imported and used in `dunning-check/route.ts` |
| C-002 | ✅ FIXED | `lib/dunning.ts` deleted. `billing/dunning.ts` is sole implementation |
| C-004 | ✅ FIXED | `getLocalDateString()`, `getLocalYesterdayString()`, `isLocalMonday()` in `quiet-hours.ts`. Used by daily-training, daily-digest |
| C-005 | ✅ FIXED | `console.error` with "NO-OP in production" message in `rate-limit.ts` |
| H-001 | ✅ FIXED | Manager/owner role check added to employees + brands endpoints |
| H-002 | ✅ FIXED | Signup aligned to 12 chars |
| H-003 | ✅ FIXED | `credentials: 'include'` replaces cookie parsing in `MeetingScript.tsx` |
| H-005 | ✅ FIXED | `console.error` on all-model-failure in `openai.ts` |
| H-006 | ✅ FIXED | `Set.has()` in `sync-optouts/route.ts` |
| H-007 | ✅ FIXED | Date-based dedup check in `red-flag-check/route.ts` |
| H-008 | ✅ FIXED | Hour-delta math in `quiet-hours.ts` |
| M-004 | ✅ FIXED | `===` in `state-machine.ts` |
| M-005 | ✅ FIXED | XML escape in `openai.ts` |
| M-008 | ✅ FIXED | Defensive domain key check in `training-content.ts` |

---

## SMS STRING INVENTORY

### Character Count Risks (Post-Interpolation)

| Template | File | Est. Chars | Segments | Risk |
|----------|------|-----------|----------|------|
| HELP response | `lib/sms.ts` | ~230 | 2 | **HIGH** — TCPA delivery risk |
| Meeting script SMS | `lib/meeting-script/assemble.ts` | ≤320 | 2-3 | Enforced limit ✅ |
| Meeting details response | `lib/meeting-script/assemble.ts` | ≤612 | 4 | Enforced limit ✅ |
| Challenge morning SMS | `lib/challenges/daily.ts` | ≤306 | 2 | Enforced limit ✅ |
| Peer challenge results | `lib/challenges/peer.ts` | ≤320 | 2 | Enforced truncation ✅ |
| Chain completion SMS | `lib/chains/lifecycle.ts` | 150-200 | 1-2 | No enforcement ⚠️ |
| Consent SMS | `api/users/route.ts` | ~145-165 | 1-2 | Marginal — depends on dealership name |
| Encouragement SMS | `api/users/[id]/encourage/route.ts` | ≤160 | 1 | Enforced limit ✅ |
| Error fallbacks | `lib/openai.ts` | 38-53 | 1 | Safe ✅ |
| Schedule responses | `lib/schedule-awareness.ts` | 23-104 | 1 | Safe ✅ |

### Non-GSM-7 Characters in Source

| File | Line | Character | Handled |
|------|------|-----------|---------|
| `lib/schedule-awareness.ts` | 109 | Smart quotes `"..."` | Yes — `sanitizeGsm7()` |
| `lib/schedule-awareness.ts` | 120 | Smart quotes | Yes — `sanitizeGsm7()` |
| `lib/schedule-awareness.ts` | 136 | Smart quotes | Yes — `sanitizeGsm7()` |
| `api/webhooks/sms/sinch/route.ts` | 374 | Em-dash `—` | Yes — `sanitizeGsm7()` |
| `api/users/route.ts` | 159 | Smart apostrophe `'` | Yes — `sanitizeGsm7()` |
| `api/users/[id]/encourage/route.ts` | 73 | Smart apostrophe `'` | Yes — `sanitizeGsm7()` |

All non-GSM-7 characters are sanitized at send time. Source cleanup recommended (M-019) but not blocking.

---

## serviceClient USAGE INVENTORY

### Justified (16 usages)

| File | Type | Reason |
|------|------|--------|
| `cron/red-flag-check/route.ts` | Cron | No user context |
| `cron/sync-optouts/route.ts` | Cron | No user context |
| `cron/daily-digest/route.ts` | Cron | No user context |
| `cron/daily-training/route.ts` | Cron | No user context |
| `cron/challenge-results/route.ts` | Cron | No user context |
| `cron/orphaned-sessions/route.ts` | Cron | No user context |
| `webhooks/sms/sinch/route.ts` | Webhook | Sinch HMAC auth, no JWT |
| `webhooks/stripe/route.ts` | Webhook | Stripe signature auth, no JWT |
| `api/coach/session/route.ts` | PWA | Phone-based HMAC token |
| `api/app/auth/route.ts` | PWA Auth | Phone-based auth, no JWT |
| `api/billing/checkout/route.ts` | Signup | No existing user/session |
| `api/admin/costs/route.ts` | Admin | Hardcoded email gate |
| `lib/billing/dunning.ts` | Library | Called by crons |
| `lib/billing/lookup.ts` | Library | Called by webhook |
| `lib/chains/lifecycle.ts` | Library | Called by cron/webhook |
| `lib/challenges/daily.ts` | Library | Called by cron |

### Unjustified — Should Migrate to RLS (10 usages)

| File | Auth Present | dealership_id Filter | Risk |
|------|-------------|---------------------|------|
| `api/onboarding/brands/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/onboarding/employees/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/users/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/users/[id]/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/users/[id]/encourage/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/users/import/route.ts` | Manager JWT ✅ | **PARTIAL** — C-008 | **HIGH** (global phone query) |
| `api/dashboard/meeting-script/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/dashboard/coach-themes/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `api/push/training/route.ts` | Manager JWT ✅ | Yes | Low (filter present) |
| `leaderboard/[slug]/route.ts` | None (public) | Partial | Medium (public + service role) |

**Migration effort:** Write RLS policies (4h) + swap client in 10 routes (4h) + test (4h) = ~12 hours.

---

## RECOMMENDED FIX PRIORITY (ALL AUDITS CONSOLIDATED)

### Tier 1: Deploy Blockers (before next deploy)

| ID | Issue | Effort |
|----|-------|--------|
| C-010 | Opt-out fail-open (TCPA) | 30 min |
| C-006 | Open redirect in auth callback | 15 min |
| C-007 | user_metadata fallback in meeting-script | 10 min |
| C-008 | Global phone query in user import | 20 min |
| C-009 + C-011 | Stripe idempotency error handling | 20 min |

**Total Tier 1: ~1.5 hours**

### Tier 2: High Priority (this sprint)

| ID | Issue | Effort |
|----|-------|--------|
| H-014 | HELP response > 160 chars | 20 min |
| H-015 | ALL_MOODS incomplete | 5 min |
| H-016 | Vehicle data wrong-brand fallback | 20 min |
| H-017 | Consent SMS batch failure | 15 min |
| H-009 | Verify no other user_metadata fallbacks | 30 min (done — only meeting-script) |
| H-010 | Dashboard subscription gating | 2 hours |
| H-011 | Chain step recording race condition | 1 hour |
| H-012 | JSON.parse try-catch in manager-create | 10 min |
| H-013 | Encourage route silent SMS failure | 20 min |

**Total Tier 2: ~5 hours**

### Tier 3: Medium (next sprint)

| ID | Issue | Effort |
|----|-------|--------|
| M-019 | Non-GSM-7 chars in source | 15 min |
| M-020 | SMS dedup cache unbounded | 30 min |
| M-021 | Coach rate limit in-memory | 1 hour |
| M-022 | Chain ops missing dealershipId | 45 min |
| M-023 | Challenge division by zero | 10 min |
| M-013 | Coach context division by zero | 10 min |
| M-014 | Peer challenge blind truncation | 15 min |
| M-015 | Coaching prompt domain unvalidated | 10 min |
| M-016 | (Escalated to H-017) | — |
| M-017 | Onboarding brands dual-storage | 1 hour |
| M-018 | PWA slug client-side validation | 30 min |

**Total Tier 3: ~5 hours**

### Tier 4: Low (backlog)

L-013 through L-021 — ~4 hours total.

### Tier 5: Architecture (multi-sprint)

| Item | Effort |
|------|--------|
| C-003: RLS migration (10 routes) | ~12 hours |
| Integration tests (zero exist) | Multi-sprint |
| Sentry/Axiom observability | 4-8 hours |
| `salesperson` → `employee` rename | 4-6 hours |

---

## BUILD STATUS

```
tsc --noEmit: PASS
Audit #1 fixes (16): ALL VERIFIED APPLIED
Audit #2 findings (22): ALL VERIFIED PRESENT
New findings (14): CATALOGED
```
