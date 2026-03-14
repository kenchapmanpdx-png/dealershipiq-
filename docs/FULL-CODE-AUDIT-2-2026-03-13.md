# DealershipIQ Full Code Audit #2 — 2026-03-13

**Scope:** All 113 TypeScript files. Second pass after 16 fixes from Audit #1 were applied.
**Build status:** `tsc --noEmit` passes clean.
**Prior audit fixes verified:** All 16 fixes from Audit #1 confirmed applied and correct.

---

## CRITICAL

### C-006: Open Redirect in Auth Callback
- **File:** `src/app/api/auth/callback/route.ts` line 11, 17
- **Bug:** `next` query parameter is read from URL and used directly in `NextResponse.redirect()` without validation. Attacker crafts `/api/auth/callback?code=valid&next=//evil.com` → user redirected to `evil.com` with a valid session.
- **Impact:** Session hijacking via phishing. Attacker uses legitimate Supabase auth flow to redirect authenticated users to a malicious site.
- **Fix:** Validate `next` is a relative path starting with `/` and doesn't contain `//`:
```typescript
const raw = searchParams.get('next') ?? '/dashboard';
const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
```

### C-007: Meeting Script Route Falls Back to user_metadata for Dealership ID
- **File:** `src/app/api/dashboard/meeting-script/route.ts` lines 37-39
- **Bug:** Falls back to `user.user_metadata?.dealership_id` if `app_metadata` is missing. `user_metadata` is user-editable (set at signup via Supabase client). An attacker could set `user_metadata.dealership_id` to another dealership's ID via the Supabase client SDK.
- **Impact:** Cross-tenant data access — manager from Dealership A reads Dealership B's morning meeting scripts.
- **Fix:** Only trust `app_metadata`:
```typescript
const dealershipId = user.app_metadata?.dealership_id as string;
if (!dealershipId) return NextResponse.json({ error: 'No dealership' }, { status: 403 });
```

### C-008: User Import Fetches All Users Globally (Not Dealership-Scoped)
- **File:** `src/app/api/users/import/route.ts` lines 164-166
- **Bug:** Duplicate phone check fetches ALL users in the system without filtering by dealership:
```typescript
const { data: existingUsers } = await serviceClient
  .from('users')
  .select('phone');
```
- **Impact:** Two issues: (1) cross-tenant metadata leak — reveals that a phone number is in use at another dealership; (2) false duplicate rejection — phone X at Dealership A blocks importing phone X at Dealership B, even though multi-dealership employees should be allowed.
- **Fix:** Scope to dealership via join:
```typescript
const { data: existingUsers } = await serviceClient
  .from('dealership_memberships')
  .select('users!inner(phone)')
  .eq('dealership_id', dealershipId);
```

### C-009: Stripe Webhook Idempotency Check Not Error-Handled
- **File:** `src/app/api/webhooks/stripe/route.ts` lines 30-38
- **Bug:** The `billing_events` query at line 30-34 is outside the try-catch. If the DB query fails (timeout, connection error), the error propagates as an unhandled exception, returning 500. Stripe retries → next attempt hits same DB issue → infinite retry loop. Meanwhile, if the query returns an error object (not exception), `existing` is undefined, and the code proceeds to process the event — potentially double-processing.
- **Impact:** Double-processing of billing events (duplicate subscription updates, incorrect status) OR infinite retry loop on DB failure.
- **Fix:** Wrap idempotency check in try-catch; return 500 on failure (signals Stripe to retry later):
```typescript
try {
  const { data: existing, error } = await serviceClient
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();
  if (error) throw error;
  if (existing) return NextResponse.json({ received: true, skipped: true });
} catch (err) {
  console.error('Stripe idempotency check failed:', err);
  return NextResponse.json({ error: 'DB error' }, { status: 500 });
}
```

---

## HIGH

### H-009: user_metadata Fallback Pattern Likely in Other Dashboard Routes
- **Files:** All dashboard routes that extract `dealershipId` from user object
- **Bug:** Same pattern as C-007 may exist in `coach-themes`, `coaching-queue`, `gaps`, `sessions`, `team` routes. Each route that falls back to `user_metadata?.dealership_id` is vulnerable.
- **Impact:** Cross-tenant data access across multiple dashboard endpoints.
- **Fix:** Audit all routes; remove `user_metadata` fallback everywhere. Only `app_metadata.dealership_id` should be trusted.

### H-010: Dashboard Endpoints Missing Subscription Gating
- **Files:** `dashboard/team`, `dashboard/sessions`, `dashboard/gaps`, `dashboard/coaching-queue`, `dashboard/coach-themes`, `dashboard/meeting-script`
- **Bug:** None of these check subscription status. `push/training` and `coach/session` DO check, but all read-only dashboard routes allow expired/canceled dealerships full access.
- **Impact:** Revenue leakage — dealerships with expired trials or canceled subscriptions can still access the full dashboard, reducing incentive to pay.
- **Fix:** Add `checkSubscriptionAccess(dealershipId)` to each dashboard route.

### H-011: Chain Step Recording Race Condition
- **File:** `src/lib/chains/lifecycle.ts` lines 155-189
- **Bug:** `recordChainStepResult` does a read-then-write (check if step exists → append to array → update). Between the read at line 159 and the write at line 180, a concurrent request could insert the same step, resulting in duplicate step results in the JSON array.
- **Impact:** Duplicate grading entries in the chain, corrupting completion logic and SMS summaries. Likely in high-concurrency scenarios (rapid SMS replies).
- **Fix:** Use a Supabase RPC function with `FOR UPDATE` lock:
```sql
CREATE FUNCTION record_chain_step(p_chain_id uuid, p_step int, p_result jsonb)
RETURNS boolean AS $$
  UPDATE scenario_chains
  SET step_results = step_results || p_result
  WHERE id = p_chain_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(step_results) elem
      WHERE (elem->>'step')::int = p_step
    );
  -- return whether chain is now complete
$$ LANGUAGE sql;
```

### H-012: JSON.parse Without Try-Catch in Manager Scenario Generation
- **File:** `src/lib/manager-create/generate.ts` line 104
- **Bug:** `JSON.parse(content)` is not wrapped in try-catch. OpenAI's `json_schema` mode is usually reliable, but edge cases (empty response, partial JSON, timeout) can cause parse failures that crash the calling code.
- **Impact:** Manager's TRAIN keyword fails silently when OpenAI returns malformed JSON. No fallback or error message sent to manager.
- **Fix:**
```typescript
try {
  return JSON.parse(content) as GeneratedScenario;
} catch (err) {
  console.error('[MANAGER-CREATE] JSON parse failed:', content?.slice(0, 200), err);
  throw new Error('Failed to parse generated scenario');
}
```

### H-013: Encourage Route — Silent SMS Failure
- **File:** `src/app/api/users/[id]/encourage/route.ts`
- **Bug:** If `sendSms()` throws (Sinch API down, rate limit), the outer catch returns 500. But no transcript record is created for the failed send, and the manager gets no specific feedback about WHY it failed.
- **Impact:** Manager sends encouragement → gets generic error → has no idea if the message was sent or not. No audit trail.
- **Fix:** Log failed attempt to transcript with `status: 'failed'` metadata.

---

## MEDIUM

### M-013: Coach Context Division by Zero
- **File:** `src/lib/coach/context.ts`
- **Bug:** `determineCoachTrend` computes `recent.reduce() / recent.length` without checking if `recent.length > 0`. If a user has fewer than 3 scores and the slice returns empty, division by zero produces `NaN`/`Infinity`.
- **Impact:** Coach receives `NaN` trend data, degrading coaching quality.
- **Fix:** Guard: `if (recent.length === 0) return 'insufficient_data';`

### M-014: Peer Challenge SMS Blind Truncation
- **File:** `src/lib/challenges/peer.ts` lines ~463-465
- **Bug:** SMS truncated at character 317 with `substring(0, 317) + '...'` — no word-boundary awareness. Can cut mid-word producing gibberish.
- **Impact:** Reps receive malformed challenge results like "Your strength: objec..."
- **Fix:** Truncate at last space before limit:
```typescript
if (sms.length > 320) {
  const cutpoint = sms.lastIndexOf(' ', 317);
  sms = sms.substring(0, cutpoint > 0 ? cutpoint : 317) + '...';
}
```

### M-015: Coaching Prompt Domain Key Unvalidated
- **File:** `src/lib/meeting-script/coaching-prompts.ts`
- **Bug:** `COACHING_PROMPTS[domain]` accessed without validating domain is a known key. Returns `null` silently on unknown domains with no logging.
- **Impact:** Managers receive empty coaching section in morning script with no error indication.
- **Fix:** Log warning for unknown domain before returning null.

### M-016: Consent SMS Batch — Promise.all Fails Entire Batch on Single Error
- **File:** `src/app/api/users/import/route.ts` lines 332-352
- **Bug:** `Promise.all()` in the consent SMS loop means if ONE SMS in a batch of 10 fails, the entire `Promise.all()` rejects. The try-catch around individual `sendSms` calls mitigates this, but if the try-catch itself has an unexpected error, the batch fails.
- **Impact:** Some imported users never receive consent SMS, with no indication in the response.
- **Fix:** Use `Promise.allSettled()` for guaranteed completion of all sends.

### M-017: Onboarding Brands Dual-Storage Inconsistency
- **File:** `src/app/api/onboarding/brands/route.ts`
- **Bug:** Tries `dealership_brands` table first, falls back to `dealerships.settings.brands`. Partial table insert → fallback overwrites → table has orphaned rows.
- **Impact:** Brands stored in two locations with no single source of truth. Read path may not match write path.
- **Fix:** Pick one storage location and use it exclusively.

### M-018: PWA Slug Not Validated Against Session Token
- **File:** `src/app/app/[slug]/layout.tsx`, `coach/page.tsx`, `coach/[id]/page.tsx`
- **Bug:** After B-002 fix, the auth endpoint validates dealership membership. However, the client-side layout stores the session from auth and doesn't re-validate if the user changes the URL slug in the browser after authentication.
- **Impact:** After authenticating for dealership-a, user changes URL to `/app/dealership-b/coach` — client-side session still valid, API calls go to dealership-b endpoints.
- **Fix:** Client-side slug check: compare `params.slug` against `session.dealershipSlug` on every navigation.

---

## LOW

### L-013: Coaching Modal Missing Keyboard Trap and Escape Handler
- **File:** `src/app/(dashboard)/dashboard/coaching/page.tsx`
- **Bug:** Modal doesn't trap focus, handle Escape key, or use `role="dialog"`.
- **Impact:** Accessibility non-compliance; keyboard-only users can't close modal.

### L-014: No Pagination on Dashboard Lists
- **Files:** `dashboard/page.tsx`, `dashboard/sessions/page.tsx`, `leaderboard/[slug]/page.tsx`
- **Bug:** All lists render without pagination or virtual scrolling. Large dealerships (100+ reps, 1000+ sessions) will cause DOM bloat.
- **Impact:** Performance degradation on mobile; slow initial render.

### L-015: Ask IQ Route Missing Rate Limiting
- **File:** `src/app/api/ask/route.ts`
- **Bug:** No rate limit on Ask IQ questions. Unlike `coach/session` (which has per-hour limit), ask is unbounded.
- **Impact:** Abuse vector — spam questions to inflate OpenAI costs.

### L-016: Password Reset Has No Client-Side Rate Limiting
- **File:** `src/app/(auth)/reset-password/page.tsx`
- **Bug:** No throttle on reset requests. User (or bot) can spam password reset emails.
- **Impact:** Email spam; potential for email provider rate limiting blocking legitimate resets.

### L-017: buildChainCompletionSMS Division by Zero on Empty Scores
- **File:** `src/lib/chains/lifecycle.ts` line 199
- **Bug:** `Object.values(r.scores).length` could be 0 if scores object is empty, causing division by zero in the percentage calculation.
- **Impact:** NaN in completion SMS. Unlikely in practice (grading always produces scores).

### L-018: Stripe Portal Route Missing Timeout
- **File:** `src/app/api/billing/portal/route.ts`
- **Bug:** No timeout on Stripe API call. If Stripe is slow, request hangs until Vercel kills it.
- **Impact:** User sees loading spinner indefinitely.

---

## PREVIOUSLY DEFERRED (Still Open from Audit #1)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| C-003 | CRITICAL | Service role in 15+ user-facing routes (no RLS) | Deferred — multi-sprint |
| H-004 | HIGH | Webhook SMS dedup cache memory leak | Deferred — low impact on Vercel |
| M-001 | MEDIUM | Webhook lock acquired too late | Open |
| M-002 | MEDIUM | PWA token no refresh mechanism | Open |
| M-003 | MEDIUM | Coach session rate limit in-memory | Open |
| M-006 | MEDIUM | Onboarding brands dual-schema (now M-017) | Open |
| M-007 | MEDIUM | Bearer token auth inconsistency | Open |
| M-009 | MEDIUM | Empty name edge cases in SMS | Open |
| M-010 | MEDIUM | Coaching modal accessibility (now L-013) | Open |
| M-011 | MEDIUM | Circular useEffect dependency | Open |
| M-012 | MEDIUM | Division by zero in coach context (now M-013) | Open |
| L-001–L-012 | LOW | Various | Open |

---

## RECOMMENDED FIX PRIORITY

| Priority | Items | Effort |
|----------|-------|--------|
| **Critical security** | C-006, C-007, C-008, C-009 | 2 hours |
| **High bugs** | H-009, H-010, H-011, H-012, H-013 | 4 hours |
| **Medium** | M-013 through M-018 | 3 hours |
| **Low** | L-013 through L-018 | 2 hours |
| **Deferred (multi-sprint)** | C-003 (RLS migration) | Multi-sprint |

---

## BUILD STATUS

```
tsc --noEmit: PASS
Prior Audit #1 fixes: ALL 16 VERIFIED APPLIED
```
