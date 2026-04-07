# DealershipIQ Full Codebase Review

**Date:** 2026-04-06
**Scope:** Every file in `src/`, root config, types, tests
**Files reviewed:** ~100 source files across API routes, libraries, frontend, config

---

## Critical Issues (Fix Now)

| # | File | Category | Description |
|---|------|----------|-------------|
| C1 | `api/billing/checkout/route.ts` | Correctness | Signup rollback has no error handling around individual deletes (lines 166-170). Five sequential `await serviceClient.from(...).delete()` calls with no try-catch. If ANY delete throws (e.g., feature_flags delete fails), all subsequent deletes are skipped — users, auth user, and dealership are orphaned. Each delete should be wrapped independently. |
| C2 | `api/billing/checkout/route.ts` | Security | **No rate limiting on public signup endpoint.** `/api/billing/checkout` is not in PROTECTED_API_ROUTES (no middleware auth — by design, since no JWT exists yet). But there's no rate limiting either. An attacker can spam POST requests to create unlimited Supabase auth users, dealerships, and feature flag rows. Needs Upstash rate limit or similar. |
| C3 | `api/users/import/route.ts` | Correctness | CSV parser doesn't handle edge cases: trailing quotes, unclosed quotes, embedded commas inside unquoted fields. Malformed CSV silently produces wrong field extraction. |
| C4 | `lib/vehicle-data.ts` | Correctness | `getRandomTrim()` silently falls back to querying ALL trims when dealership has no brands configured, despite comment saying "Do NOT fall back." Sends wrong vehicle data to training scenarios. |
| C5 | `app/[slug]/layout.tsx` | Security | Client-side base64 cookie decoding (`JSON.parse(atob(token))`) without server-side validation. Token expiration checked client-side only — attacker can modify cookie to extend expiration. |
| C6 | `next.config.mjs` | Config | Completely empty. No security headers, CSP, image optimization, or redirect rules. `vercel.json` has some headers but no Content-Security-Policy. |

---

## High Severity

| # | File | Category | Description |
|---|------|----------|-------------|
| H1 | `webhooks/sms/sinch/route.ts` | Security | REST API inbound messages (`mo_text` type) accepted without Sinch webhook signature verification. Attacker can forge SMS messages by calling endpoint directly. Idempotency check helps but doesn't fully prevent replay. |
| H2 | `api/cron/daily-training/route.ts` | Correctness | Dedup check looks at past hour only. If cron is manually retried or delayed past the hourly window, duplicate training sent to all users. Should be per-user/day, not per-dealership/hour. |
| H3 | `api/cron/daily-training/route.ts` | Performance | Sequential user loop with 50ms delays. 500 users = 25s of delay alone. Function `maxDuration` is 60s. Will timeout at scale. |
| H4 | `lib/service-db.ts` | Correctness | `insertTranscriptLog` accepts `metadata` parameter (line 202) but NEVER inserts it into the database (lines 207-215). The encourage route passes `metadata: { type: 'encouragement', status: 'failed', error: ... }` — error context for failed SMS sends is silently dropped. Audit trail incomplete. |
| H5 | `lib/coach/context.ts` | Performance | `getDomainScores()` (line 104) loops through 4 scoring dimensions calling `getRecentScoreTrend` sequentially. Combined with `getCompletionRate30d` doing 2 more queries (lines 193-206), this is 6 sequential DB calls that could be parallelized. On slow connections, coach mode startup is unnecessarily slow. |
| H6 | `lib/service-db.ts` | Performance | `getRedFlagUsers()` has unguarded nested loop: 5 separate DB calls per user. 100 employees = 500+ sequential queries. Will timeout. Same pattern in `getDailyDigestStats()`. |
| H7 | `lib/adaptive-weighting.ts` | Correctness | K-consecutive-passes decay feature acknowledged in TODO but not implemented. Domain weights diverge from actual competency over time. Undermines training priority logic. |
| H8 | `(auth)/reset-password/page.tsx` | Security | `window.location.origin` used for password reset redirect (line ~22). Should use `NEXT_PUBLIC_BASE_URL` env var. Manipulable in certain browser contexts. |
| H9 | `privacy/page.tsx`, `terms/page.tsx` | Compliance | Legal documents reference "Vata Salon" instead of "DealershipIQ." Address hardcoded. Legal docs hardcoded in component — impossible to update without code deployment. |
| H10 | `middleware.ts` | Security | JWT secret existence checked but no fail-loud if `SUPABASE_JWT_SECRET` is missing in production. Silent fallback could disable auth entirely. |
| H11 | `webhooks/stripe/route.ts` | Correctness | Idempotency: if event processing succeeds but `recordEvent` call fails, webhook returns 200 before recording. Event could be processed twice on retry. |

---

## Medium Severity

| # | File | Category | Description |
|---|------|----------|-------------|
| M1 | `lib/service-db.ts` (line ~1649) | Security | SQL injection via ilike fuzzy match. `stripped.slice(0, 60)` interpolated into ilike pattern without escaping `%` and `_` wildcards. Low real-world risk but should sanitize. |
| M2 | `lib/service-db.ts` (line ~1644) | Correctness | `if (error \|\| !data)` conflates DB error with no-match. Network error silently falls through to fuzzy match instead of logging. |
| M3 | `lib/openai.ts` (line ~658) | Correctness | Fragile regex strips rationale instruction for mini model: `.replace(/- rationale:[^\n]*\n/, '')`. Reformatting the prompt breaks this silently. |
| M4 | `lib/openai.ts` (line ~694) | Maintainability | `feedback` field overwritten with assembled SMS. Raw AI feedback lost. When `word_tracks`/`example_response` columns are added to training_results, also preserve raw feedback. |
| M5 | `lib/openai.ts` (line ~118) | Maintainability | Safety net math hardcodes separator lengths (`- 16`). Changing " Tracks: " or ". Try: " later breaks the safety net silently. Make separators constants. |
| M6 | `lib/quiet-hours.ts` | Correctness | `nextSendWindow()` uses raw millisecond math for hour deltas. DST transitions (spring forward/back) cause ±1 hour error. Need timezone-aware Date arithmetic. |
| M7 | `lib/training-content.ts` | Correctness | `selectTrainingContent()` doesn't validate that domain from `selectTrainingDomain()` exists in `DOMAIN_PROMPTS`. Invalid domain → empty prompt sent to AI. |
| M8 | `lib/sms.ts` (line ~197) | Correctness | `detectKeyword()` natural language opt-out detection bypassed if message > 60 chars. Legitimate opt-out requests ignored if verbose. |
| M9 | `api/ask/route.ts` | Maintainability | In-memory rate limit `askRateMap` grows unbounded. No TTL or cleanup. Will leak memory over time. |
| M10 | `api/admin/costs/route.ts` | Security | Email allowlist hardcoded as `'kenchapmanpdx@gmail.com'`. Should be env var. |
| M11 | `api/coach/context/route.ts` | Security | `timingSafeEqual` preceded by length comparison. Length mismatch leaks timing info, negating the safe comparison. |
| M12 | `api/cron/orphaned-sessions/route.ts` | Correctness | Chain expiry: if user is scheduled off for a week, chain stays "active" indefinitely — missed-day counter paused until return. |
| M13 | `api/cron/red-flag-check/route.ts` | Correctness | Duplicate flag insertion possible if cron runs multiple times within 6 hours. Check should be more granular (per signal_type + timestamp window). |
| M14 | `api/cron/sync-optouts/route.ts` | Correctness | If a phone belongs to multiple dealerships, opt-out syncs to all. Creates cross-dealership opt-out coupling. May not be intended. |
| M15 | `api/onboarding/employees/route.ts` | Correctness | Manual role check (H-001) but RLS INSERT permission not verified. Defense-in-depth gap. |
| M16 | `lib/chains/branching.ts` | Correctness | Branch rule regex fragile. Extra spaces or non-standard formatting → silent default branch selection. Should validate at chain creation time. |
| M17 | `lib/chains/templates.ts` | Correctness | No tie-breaker when multiple templates match. Returns first by insertion order. Should ORDER BY review_count or updated_at. |
| M18 | `lib/challenges/peer.ts` | Correctness | `findChallengeTarget()` uses ilike on name. "Josh" matches both "Josh" and "Joshua." Should require exact match or add limit + disambiguation. |
| M19 | `lib/auth/phone-lookup.ts` | Security | `lookupByPhone()` doesn't validate phone format before DB query. Should normalize first. |
| M20 | `lib/auth/phone-lookup.ts` | Correctness | `resolveDealership()` returns first membership without checking `is_primary`. Multi-location reps may get training for wrong dealership. |
| M21 | `lib/billing/subscription.ts` | Maintainability | Dunning thresholds (3, 14, 21, 30 days) hardcoded. Should be configurable via feature_flags or config table. |
| M22 | `lib/rate-limit.ts` | Maintainability | Dynamic `require()` of @upstash/ratelimit. Missing package → all rate limiting silently becomes no-op. Should validate at startup. |
| M23 | `lib/meeting-script/assemble.ts` | Correctness | `buildMeetingSMS()` truncates but doesn't sanitize non-ASCII from name fields. Non-GSM-7 chars survive truncation → UCS-2 encoding → 3x SMS cost. |
| M24 | `vercel.json` | Config | No Content-Security-Policy header. XSS and script injection unmitigated. |
| M25 | `(marketing)/page.tsx`, `robots.ts` | Config | URLs hardcoded as `dealershipiq-wua7.vercel.app` instead of `NEXT_PUBLIC_BASE_URL`. 3 instances. |
| M26 | `webhooks/stripe/route.ts` | Correctness | `handleCheckoutCompleted` extracts `trial_end` via unsafe type casting. Missing expansion → silent 30-day default without warning. |
| M27 | `lib/service-db.ts` | Correctness | `getUserStreak()` counts weekday-only sessions without timezone awareness. Sessions at 11:59 PM UTC could report incorrect streak for UTC-7 dealerships. |
| M28 | `lib/manager-create/generate.ts` | Performance | `generateScenarioFromManager()` doesn't validate/truncate manager input before sending to OpenAI. 10KB paste → wasted tokens. |

---

## Low Severity

| # | File | Category | Description |
|---|------|----------|-------------|
| L1 | `route.ts` (webhook, lines ~1138-1147) | Performance | Three sequential feature flag DB calls could be parallelized with `Promise.all`. Easy win. |
| L2 | `lib/sinch-auth.ts` | Performance | OAuth token cache is in-memory per instance. Multiple Vercel instances maintain separate caches → redundant OAuth calls. |
| L3 | `lib/quiet-hours.ts` | Correctness | `getLocalDateString()` uses `'sv-SE'` locale for YYYY-MM-DD. Works but fragile. Use `toISOString().split('T')[0]`. |
| L4 | `lib/schedule-awareness.ts` | Correctness | Missing schedule record → returns false (not scheduled off). Could push training on actual days off if schedule hasn't been created. |
| L5 | `api/dashboard/team/route.ts` | Performance | No limit on training_results fetch. 10K+ results per user all fetched and computed in-memory. |
| L6 | `api/leaderboard/[slug]/route.ts` | Performance | All users + all training results fetched without pagination. |
| L7 | `api/billing/portal/route.ts` | Maintainability | Timeout error compared by message string. Should use custom error type. |
| L8 | `(dashboard)/dashboard/onboarding/page.tsx` | Maintainability | BRAND_OPTIONS hardcoded as static array. Adding brands requires code deployment. |
| L9 | `(dashboard)/dashboard/team/page.tsx` | Maintainability | Uses browser `alert()` for user feedback instead of toast. |
| L10 | `types/supabase.ts` | Maintainability | Comment claims types are auto-generated but file is 1024 lines of manual types. Should use `supabase gen types typescript`. |
| L11 | `lib/supabase/service.ts` | Maintainability | Service client creation hidden behind Proxy. Key rotation requires server restart — undocumented. |
| L12 | `webhooks/sms/sinch/route.ts` | Performance | NOW keyword handler loops through users sequentially with 50ms delays. Slow at 100+ users. |

---

## Summary by Category

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Security | 2 | 3 | 5 | 1 |
| Correctness | 3 | 5 | 15 | 2 |
| Performance | 0 | 2 | 2 | 4 |
| Maintainability | 0 | 0 | 5 | 5 |
| Config | 1 | 0 | 2 | 0 |
| Compliance | 0 | 1 | 0 | 0 |
| **Total** | **6** | **11** | **29** | **12** |

---

## Verification Pass — Corrections

Findings below were reported by the initial sweep but verified as **false positives** after reading the actual code:

| Original # | Claimed Issue | Actual Code | Verdict |
|------------|--------------|-------------|---------|
| ~~C2 (old)~~ | `insertTranscriptLog` called with extra `supabase` parameter — "runtime crash" | Function signature at line 203 has optional second parameter: `client?: { from: ... }`. Push-training and encourage routes correctly pass the RLS client. Working as designed. | **FALSE POSITIVE — removed** |
| ~~H4 (old)~~ | `closeStaleSessionsForUser` called without `dealershipId` — "cross-tenant leak" | Line 110: `await closeStaleSessionsForUser(userId, dealershipId)` — dealershipId IS passed. Function filters by it at line 584-585. | **FALSE POSITIVE — replaced** |
| ~~H5 (old)~~ | daily-digest calls `closeStaleSessionsForUser` without dealershipId | Grep returned zero matches — daily-digest does NOT call this function at all. | **FALSE POSITIVE — replaced** |
| ~~coach/context~~ | `getRecentGaps()` undefined — "runtime error" | `getRecentGaps` is defined at line 142 in the same file (local async function). | **FALSE POSITIVE — not included** |

---

## Recommended Fix Priority

### Immediate (before next feature)
1. **C2** — Rate-limit the public signup endpoint (`/api/billing/checkout`). No auth by design, but no rate limiting either. Add Upstash or similar.
2. **C1** — Wrap each signup rollback delete in its own try-catch so one failure doesn't orphan remaining records.
3. **H1** — Sinch webhook signature verification for REST API inbound messages.
4. **H4** — Insert `metadata` column into `sms_transcript_log` table and add it to the insert in `insertTranscriptLog`. Error context is being silently dropped.

### This sprint
5. **C4** — Vehicle data silent fallback. Add explicit throw/null return.
6. **M1** — ilike wildcard escape in scenario bank lookup.
7. **M7** — Domain validation in `selectTrainingContent`.
8. **H2** — Daily training dedup window (per-user/day).
9. **C5/H10** — Server-side token validation + JWT secret fail-loud.
10. **C6/M24** — Add CSP header and basic security headers to next.config.

### Next sprint
11. **H6** — Batch N+1 queries in getRedFlagUsers/getDailyDigestStats.
12. **H3** — Parallelize daily-training user loop (replace sequential + delay).
13. **M6** — DST-safe quiet hours calculation.
14. **M8** — Natural language opt-out detection length bypass.
15. **H9** — Fix legal documents (company name, externalize to CMS).

### Backlog
16. **H7** — Implement K-consecutive-passes decay in adaptive weighting.
17. **M10** — Move admin email allowlist to env var.
18. **M25** — Replace hardcoded URLs with NEXT_PUBLIC_BASE_URL.
19. **M21** — Make dunning thresholds configurable.
20. All low-severity items.
