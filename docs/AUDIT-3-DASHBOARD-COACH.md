# Audit 3: Dashboard + Coach Mode Flows

**Repo:** `dealershipiq` (main, production)
**Date:** 2026-03-15
**Auditor:** Automated (Claude)
**Scope:** Document-only trace of 4 flows. No fixes applied.
**Prerequisite:** AUDIT-1-INFRASTRUCTURE.md, AUDIT-2-CORE-FLOWS.md

---

## Summary

| Category | Critical | High | Medium | Low | Info |
|----------|----------|------|--------|-----|------|
| Flow 1: Manager Dashboard | 0 | 1 | 2 | 2 | 1 |
| Flow 2: Coach Mode | 0 | 1 | 2 | 1 | 2 |
| Flow 3: Public Leaderboard | 0 | 1 | 1 | 0 | 1 |
| Flow 4: User Management | 0 | 0 | 1 | 2 | 1 |
| Cross-Flow | 0 | 1 | 0 | 1 | 0 |
| **Total** | **0** | **4** | **6** | **6** | **5** |

---

## Flow 1: Manager Dashboard — Auth → Data Fetch → Display

### Trace

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | (dashboard)/layout.tsx:14 | `createServerSupabaseClient()` — cookie-based auth | YES |
| 2 | layout.tsx:15 | `supabase.auth.getUser()` — validate JWT | YES |
| 3 | layout.tsx:17-18 | No user → redirect `/login` | YES |
| 4 | layout.tsx:21-24 | Extract `dealership_id` from `app_metadata` → redirect if missing | YES |
| 5 | layout.tsx:26-29 | Role check: `manager` or `owner` only → redirect otherwise | YES |
| 6 | layout.tsx:32-38 | Fetch dealership memberships for switcher (RLS-backed) | YES |
| 7 | layout.tsx:70-84 | Dealership switcher dropdown (multi-dealership support) | YES — see D1-M-001 |
| 8 | dashboard/page.tsx:46 | Fetch `/api/dashboard/team` — team stats | YES |
| 9 | dashboard/page.tsx:69 | Fetch `/api/dashboard/sessions?days=1` — activity feed | YES |
| 10 | dashboard/page.tsx:100 | Fetch `/api/dashboard/coach-themes` — non-blocking | YES |
| 11 | dashboard/page.tsx:121-122 | 60-second polling interval | YES — see D1-L-001 |
| 12 | api/dashboard/team/route.ts:21-22 | `createServerSupabaseClient()` + `getUser()` | YES |
| 13 | team/route.ts:28-36 | Dealership ID + role check (manager/owner) | YES |
| 14 | team/route.ts:39 | `checkSubscriptionAccess(dealershipId)` — subscription gate | YES |
| 15 | team/route.ts:45-64 | Query users + training_results via RLS client (`.eq('dealership_memberships.dealership_id', dealershipId)`) | YES |
| 16 | team/route.ts:75-98 | Transform: calculate avg score, last training date per user | YES — see D1-H-001 |
| 17 | api/dashboard/sessions/route.ts:49-52 | Parse `days` param, validate 1–365 | YES |
| 18 | sessions/route.ts:66-83 | Query `training_results` with dealership_id filter + date cutoff | YES |
| 19 | api/dashboard/coaching-queue/route.ts:54-71 | Query training_results, last 7 days | YES |
| 20 | coaching-queue/route.ts:81-114 | Filter: any score < 3 OR all scores = 5 | YES |
| 21 | api/dashboard/gaps/route.ts:51-67 | Query askiq_queries, confidence < 0.7, last 30 days, limit 100 | YES |
| 22 | api/dashboard/coach-themes/route.ts:40-43 | Query coach_sessions via RLS (C-003 compliant) | YES |
| 23 | coach-themes/route.ts:56-69 | Privacy gate: >= 3 unique users required | YES |
| 24 | coach-themes/route.ts:72-94 | Aggregate topics + sentiment, never expose user_id | YES |
| 25 | api/dashboard/meeting-script/route.ts:38-42 | Query meeting_scripts for today via RLS | YES |
| 26 | meeting-script/route.ts:54-59 | Fallback to yesterday's script | YES |

### Auth Pattern Verification

All 6 dashboard API routes follow identical auth pattern:
1. `createServerSupabaseClient()` — cookie-based, RLS-enforced
2. `supabase.auth.getUser()` — validates JWT
3. Extract `dealership_id` from `app_metadata` (server-set, not user-editable)
4. Role check: `manager` or `owner`
5. `checkSubscriptionAccess()` — subscription gate
6. RLS-backed queries — `dealership_id` auto-scoped

**Verdict:** Auth pattern is consistent and correct across all routes.

### Findings

#### D1-H-001 — Team API fetches ALL training_results per user (unbounded)
- **Severity:** HIGH
- **File:** `api/dashboard/team/route.ts:45-64`
- **Issue:** The team query joins `training_results` without any date filter or limit. For a salesperson with 1+ year of daily training (365+ results), this pulls all rows to compute `average_score` and `last_training_at`. With 20 reps × 365 results = 7,300 rows loaded into memory per API call.
- **Impact:** Slow dashboard load for mature dealerships. Vercel function memory/timeout risk.
- **Recommendation:** Add `.gte('training_results.created_at', ninetyDaysAgo)` or compute aggregates server-side via a Postgres view/function. Alternatively, maintain a `users.average_score` materialized column updated by a trigger.

#### D1-M-001 — Dealership switcher uses client-side navigation, no server-side validation
- **Severity:** MEDIUM
- **File:** `(dashboard)/layout.tsx:70-84`
- **Issue:** The dealership switcher uses `window.location.href = /dashboard?dealership=${e.target.value}` but the dashboard pages don't read this query param. The switcher is dead code — it navigates but the `?dealership=` param is never consumed. All API calls use JWT's `dealership_id`, not a query param.
- **Impact:** Multi-dealership managers cannot switch between dealerships. UI is misleading.
- **Recommendation:** Either implement dealership switching (update JWT claims or use a session cookie) or remove the switcher until implemented.

#### D1-M-002 — Dashboard layout uses `window` in server component
- **Severity:** MEDIUM
- **File:** `(dashboard)/layout.tsx:74`
- **Issue:** `window.location.href` in the onChange handler of the select element. This file is a server component (no `'use client'` directive). The `onChange` handler references `window`, which doesn't exist during SSR. The select element renders fine as HTML, but the onChange handler will fail if Next.js attempts to hydrate it.
- **Impact:** The dealership switcher doesn't work. It either throws a hydration error or never fires. Since the switcher is already dead code (D1-M-001), this has no user-visible impact, but it's a code quality issue.
- **Recommendation:** Either add `'use client'` and make the switcher functional, or remove it entirely.

#### D1-L-001 — Dashboard overview polls every 60 seconds regardless of tab visibility
- **Severity:** LOW
- **File:** `dashboard/page.tsx:121-122`
- **Issue:** `setInterval(fetchData, 60000)` runs even when the tab is backgrounded. Each poll hits 2-3 API routes (team + sessions + coach-themes).
- **Impact:** Unnecessary Vercel invocations and Supabase queries when manager isn't looking at the dashboard.
- **Recommendation:** Add `document.visibilityState` check or use `requestIdleCallback` to pause polling when tab is hidden.

#### D1-L-002 — Average score calculation uses 0–5 scale internally but displays as percentage
- **Severity:** LOW
- **File:** `dashboard/page.tsx:63-66` vs `team/page.tsx:249`
- **Issue:** The dashboard overview calculates `avgScore` on a 0–5 scale then multiplies by 100 to display as percentage. The team page displays `(member.average_score * 100).toFixed(0)%`. But `average_score` from the API is already on a 0–5 scale (e.g., `3.5`), so `3.5 * 100 = 350%`.
- **Impact:** Team page shows inflated scores. A 3.5/5 average displays as "350%". Dashboard overview shows correct values because it uses its own calculation.
- **Recommendation:** Fix team page to display `(member.average_score / 5 * 100).toFixed(0)%` or display raw score as `3.5/5`.

#### D1-I-001 — Coaching queue does server-side fetch then client-side filter
- **Severity:** INFO
- **File:** `api/dashboard/coaching-queue/route.ts:54-114`
- **Issue:** Fetches ALL training_results from past 7 days, then filters in JavaScript for scores < 3 or = 5/5/5/5. This could be done more efficiently with a Postgres query using `OR` filters.
- **Impact:** None for typical dealership sizes (< 100 results/week). Would matter at scale.

---

## Flow 2: Coach Mode — Rep Auth → Door Selection → AI Chat → Classification

### Trace

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | api/coach/session/route.ts:32 | `authenticateRep(request)` — phone-based HMAC token | YES |
| 2 | route.ts:576-607 | Extract `diq_session` from cookie or `x-diq-session` header | YES |
| 3 | route.ts:588 | `verifyAppToken(token)` — HMAC-SHA256 + expiry check | YES |
| 4 | app-auth.ts:20-21 | `timingSafeEqual` for HMAC comparison | YES |
| 5 | app-auth.ts:35-38 | Token expiry check via `payload.expiresAt` | YES |
| 6 | route.ts:594-599 | Verify user still exists in DB (`.eq('id', userId).eq('dealership_id', dealershipId)`) | YES — see D2-M-001 |
| 7 | route.ts:42-48 | `checkSubscriptionAccess(dealershipId)` | YES |
| 8 | route.ts:51-57 | Feature flag check: `coach_mode_enabled` | YES |
| 9 | route.ts:61-67 | Rate limit check: 30 messages/hour | YES |
| 10 | route.ts:613-640 | Rate limit: DB-backed, counts user messages across coach_sessions in last hour | YES |
| 11 | route.ts:141 | Door validation: `tactical`, `debrief`, `career` only | YES |
| 12 | route.ts:149 | `buildRepContext(userId, dealershipId)` — parallel data fetches | YES |
| 13 | coach/context.ts:25-51 | 8 parallel fetches: user, dealership, tenure, streak, priority, gaps, prev sessions, domain scores | YES |
| 14 | coach/prompts.ts:79-86 | `sanitizePromptInput()` — strip `<>`, newlines, injection keywords | YES |
| 15 | coach/prompts.ts:88-127 | `buildCoachSystemPrompt()` — door + context + style adaptation | YES |
| 16 | route.ts:173-186 | GPT-4o response generation with compaction | YES |
| 17 | coach/compaction.ts:29-43 | Compaction threshold: 10 messages → summarize first 8, keep last 4 | YES |
| 18 | compaction.ts:67-103 | GPT-4o-mini synopsis with template fallback | YES |
| 19 | route.ts:403-422 | GPT-4o call with 30s timeout, tool_choice: auto, classify_exchange tool | YES |
| 20 | route.ts:440-451 | Parse classify_exchange tool call for sentiment + topic | YES |
| 21 | route.ts:334-348 | Update session: messages, sentiment_trend, session_topic, coaching_style | YES |
| 22 | route.ts:476-498 | Session close: set ended_at, classify topic via GPT-4o-mini | YES |
| 23 | route.ts:550-572 | Stale session cleanup: close sessions older than 24 hours | YES |
| 24 | route.ts:280-297 | Exchange limit: 10 user messages max → auto-close | YES |

### Coach Mode Auth Pattern

- **Not Supabase JWT-based.** Uses custom HMAC-signed token (`diq_session` cookie).
- Token contains `userId`, `dealershipId`, `firstName`, `language`, and expiry.
- Signed with `APP_AUTH_SECRET` (fallback: `CRON_SECRET`).
- `timingSafeEqual` for constant-time comparison.
- After token verification, confirms user exists in DB.
- All DB operations use `serviceClient` (bypasses RLS) — justified because employees don't have Supabase Auth accounts.

### Findings

#### D2-H-001 — Coach session DB writes lack dealership_id ownership check
- **Severity:** HIGH
- **File:** `api/coach/session/route.ts:230-235, 345-348`
- **Issue:** `continueSession()` loads a session with `.eq('id', sessionId).eq('user_id', userId)` but does NOT check `dealership_id`. The update at line 345 also has no dealership_id filter. If a user has tokens for two different dealerships (e.g., they moved between dealerships), they could potentially continue a session from their old dealership.
- **Impact:** Low practical risk since tokens expire, but violates the principle of dealership-scoped data isolation. The `startNewSession()` correctly sets `dealership_id` on insert, so the gap is only on reads/updates.
- **Recommendation:** Add `.eq('dealership_id', dealershipId)` to the session SELECT in `continueSession()` and to the UPDATE calls.

#### D2-M-001 — authenticateRep verifies user by `users.dealership_id` which may not exist
- **Severity:** MEDIUM
- **File:** `api/coach/session/route.ts:595-601`
- **Issue:** The auth helper queries `users` with `.eq('dealership_id', dealershipId)` but `users` table does not have a `dealership_id` column — memberships are stored in `dealership_memberships`. This query likely returns null for all users, meaning auth always fails, OR the column exists as a convenience field.
- **Impact:** If `users` table lacks `dealership_id`, Coach Mode is broken for all reps. If it exists, this is just a documentation concern.
- **Recommendation:** Verify schema. If `dealership_id` is not on `users`, fix to query `dealership_memberships` instead: `.from('dealership_memberships').select('user_id').eq('user_id', userId).eq('dealership_id', dealershipId)`.

#### D2-M-002 — APP_AUTH_SECRET falls back to CRON_SECRET
- **Severity:** MEDIUM
- **File:** `app-auth.ts:21`
- **Issue:** `const secret = process.env.APP_AUTH_SECRET || process.env.CRON_SECRET`. If `APP_AUTH_SECRET` is not set, the coach session tokens are signed with `CRON_SECRET`. This means anyone who discovers `CRON_SECRET` (e.g., leaked in logs, exposed via header) can forge coach session tokens for any user.
- **Impact:** Single shared secret for two different purposes reduces defense in depth. If `APP_AUTH_SECRET` is set in production, this is moot.
- **Recommendation:** Verify `APP_AUTH_SECRET` is set in Vercel env vars. If not, add it. Remove the CRON_SECRET fallback.

#### D2-L-001 — In-memory rate limit comment is stale (DB-backed now)
- **Severity:** LOW
- **File:** `api/coach/session/route.ts:59-60`
- **Issue:** Comment says "M-021: In-memory rate limit — resets on cold start, not shared across Vercel instances. TODO: Replace with Upstash Redis for production." But the actual `checkRateLimit()` at line 613 is already DB-backed (queries coach_sessions). The TODO is outdated.
- **Recommendation:** Update comment to reflect current DB-backed implementation.

#### D2-I-001 — Coach prompts include comprehensive safety rails
- **Severity:** INFO
- **File:** `coach/prompts.ts:7-18`
- **Issue:** None. Documenting that the coach prompt includes: AI disclosure rule, privacy assurance, no pricing advice, no undermining managers, mental health crisis redirect (988 Lifeline), no hollow cheerleading, concise responses, no emoji.
- **Verdict:** Well-designed safety rails.

#### D2-I-002 — Prompt injection sanitization present
- **Severity:** INFO
- **File:** `coach/prompts.ts:79-86`
- **Issue:** None. `sanitizePromptInput()` strips `<>`, newlines, and keywords like `system:`, `instruction:`, `ignore`, `override`. Applied to all user-sourced context fields before system prompt injection.
- **Verdict:** Good defense-in-depth against prompt injection via stored training data.

---

## Flow 3: Public Leaderboard — Slug Resolution → Aggregation → Display

### Trace

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | leaderboard/[slug]/page.tsx:27-31 | SSR page: `serviceClient` query dealerships by `.eq('name', decodeURIComponent(slug))` | YES — see D3-H-001 |
| 2 | page.tsx:38-49 | Query ALL training_results for dealership (no date filter, no limit) | YES — see D3-M-001 |
| 3 | page.tsx:57-86 | Client-side aggregation: group by user_id, compute avg score | YES |
| 4 | page.tsx:89-103 | Sort descending, assign ranks | YES |
| 5 | api/leaderboard/[slug]/route.ts:42-46 | API route: query by `.eq('slug', slug)` | YES |
| 6 | api/route.ts:60-78 | API: query users via dealership_memberships, active only | YES |
| 7 | api/route.ts:89-116 | API: same aggregation pattern, no date filter | YES |

### Leaderboard Architecture Note

Two implementations exist: SSR page (page.tsx) and API route. The SSR page queries by `name` (decoded slug), while the API queries by `slug` column. These resolve differently — a dealership with name "Demo Honda" and slug "demo-honda" would only match the API route.

### Findings

#### D3-H-001 — Public leaderboard page queries by dealership name, not slug
- **Severity:** HIGH
- **File:** `leaderboard/[slug]/page.tsx:27-31`
- **Issue:** The SSR leaderboard page uses `.eq('name', decodeURIComponent(slug))` to find the dealership. The URL path uses a slug parameter (e.g., `/leaderboard/demo-honda`), but the query matches against the `name` column (e.g., "Demo Honda"). The `decodeURIComponent` converts `demo-honda` → `demo-honda`, which won't match `Demo Honda`.
- **Impact:** SSR leaderboard page returns 404 for all dealerships unless the URL exactly matches the dealership name (with spaces encoded as `%20`). The API route at `/api/leaderboard/[slug]` correctly uses `.eq('slug', slug)`, so any client-side rendered leaderboard using the API works.
- **Recommendation:** Change page.tsx query from `.eq('name', ...)` to `.eq('slug', slug)` to match the API route behavior.

#### D3-M-001 — Leaderboard fetches ALL training results (no date bound, no pagination)
- **Severity:** MEDIUM
- **File:** `leaderboard/[slug]/page.tsx:38-49`, `api/leaderboard/[slug]/route.ts:60-78`
- **Issue:** Both the SSR page and API route fetch all training_results for a dealership with no date filter and no `.limit()`. Same issue as D1-H-001 but with public access — no rate limiting, no auth required.
- **Impact:** Potential DoS vector. An attacker could repeatedly hit the leaderboard endpoint to trigger expensive full-table scans. For a dealership with 50 reps × 1 year of daily training = 18,250 rows loaded per request.
- **Recommendation:** Add a reasonable date window (e.g., last 90 days) for score calculation. Add response caching (e.g., Vercel edge cache with 5-minute TTL). Consider rate limiting the public endpoint.

#### D3-I-001 — Public leaderboard exposes user_id in API response
- **Severity:** INFO
- **File:** `api/leaderboard/[slug]/route.ts:119-129`
- **Issue:** The API response includes `user_id` (Supabase UUID) in each leaderboard entry. The SSR page also maps `userId` into entries (page.tsx:101). These UUIDs are internal identifiers.
- **Impact:** Low — UUIDs are opaque and not directly exploitable, but exposing them in a public endpoint is unnecessary. No PII risk, but leaks internal ID format.
- **Recommendation:** Remove `user_id` from public leaderboard responses. Use ordinal position (rank) as the unique identifier.

---

## Flow 4: User Management — CRUD → Permissions → SMS

### Trace: Add Employee (POST /api/users)

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | api/users/route.ts:43-44 | `createServerSupabaseClient()` + `getUser()` | YES |
| 2 | route.ts:50-58 | Dealership ID + role check | YES |
| 3 | route.ts:63-68 | Validate required fields: `full_name`, `phone` | YES |
| 4 | route.ts:71-76 | Validate E.164 phone format | YES |
| 5 | route.ts:78 | Normalize phone to `+1XXXXXXXXXX` | YES |
| 6 | route.ts:81-85 | Cross-tenant duplicate check via `serviceClient` | YES |
| 7 | route.ts:99-103 | Dealership-scoped opt-out check via RLS client | YES |
| 8 | route.ts:117-133 | Insert user via RLS client | YES |
| 9 | route.ts:137-144 | Insert dealership membership via RLS client | YES |
| 10 | route.ts:148-149 | Membership failure → rollback user creation via `serviceClient.delete()` | YES |
| 11 | route.ts:157-172 | Send consent SMS (non-blocking, failure doesn't fail the add) | YES |
| 12 | route.ts:161-168 | Log consent SMS to transcript | YES |

### Trace: Deactivate Employee (DELETE /api/users/[id])

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | api/users/[id]/route.ts:15-29 | Auth + role check (standard pattern) | YES |
| 2 | route.ts:35-39 | Verify membership exists in manager's dealership via RLS | YES |
| 3 | route.ts:53-56 | Soft-delete: set `status: 'deactivated'` | YES |

### Trace: Send Encouragement (PUT /api/users/[id]/encourage)

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | encourage/route.ts:22-38 | Auth + role check | YES |
| 2 | route.ts:44-56 | Load target user via RLS (auto-filtered to manager's dealership) | YES |
| 3 | route.ts:66-79 | Message validation: non-empty, <= 160 chars | YES |
| 4 | route.ts:83-103 | SMS send with explicit error handling + failed-attempt audit logging | YES |
| 5 | route.ts:107-115 | Log successful send to transcript | YES |

### Trace: CSV Import (POST /api/users/import)

| Step | File:Line | Function/Action | Verified |
|------|-----------|-----------------|----------|
| 1 | import/route.ts:114-116 | Content-Length check: 5MB max | YES |
| 2 | import/route.ts:139-141 | Post-read body size check (Content-Length spoofing defense) | YES |
| 3 | import/route.ts:119-134 | Auth + role check | YES |
| 4 | import/route.ts:152-160 | Parse CSV with RFC 4180 support | YES |
| 5 | import/route.ts:103-107 | `sanitizeCsvField()` — strip formula injection chars (`=`, `+`, `-`, `@`) | YES |
| 6 | import/route.ts:170-176 | 500-row cap (F3-M-001 remediation) | YES |
| 7 | import/route.ts:179-195 | Batch load existing phones + opt-outs via RLS | YES |
| 8 | import/route.ts:216-341 | Per-row processing: validate, dedup, insert user + membership | YES |
| 9 | import/route.ts:347-378 | Batch consent SMS: 10/batch, 1s delay, `Promise.allSettled` | YES |

### Findings

#### D4-M-001 — CSV import sends text body but client sends FormData
- **Severity:** MEDIUM
- **File:** `import/route.ts:137` vs `team/page.tsx:84-88`
- **Issue:** The import API reads the body as `await request.text()` (line 137), expecting raw CSV text. But the team page constructs a `FormData` with `formData.append('file', file)` and sends it via `fetch('/api/users/import', { method: 'POST', body: formData })`. A FormData body is multipart-encoded, not raw CSV text. The `request.text()` call will return the multipart boundary + encoded content, not pure CSV.
- **Impact:** CSV import from the dashboard UI is likely broken. Would only work if called programmatically with a raw text body.
- **Recommendation:** Either change the API to parse FormData (`request.formData()` → extract file → `.text()`), or change the client to send raw CSV text via `fetch(..., { body: csvFileContent })`.

#### D4-L-001 — Add employee rollback deletes via serviceClient (bypasses RLS)
- **Severity:** LOW
- **File:** `api/users/route.ts:148-149`
- **Issue:** When membership insertion fails, user creation is rolled back with `serviceClient.from('users').delete().eq('id', newUser.id)`. This uses the service role client, bypassing RLS. The insert was done via the RLS client, but the rollback uses service role.
- **Impact:** Functional correctness — the rollback works. The inconsistency is that a manager could trigger a delete (via service role) on a user record that RLS might otherwise protect. Since the user was just created by this same request and has no other data yet, risk is minimal.
- **Recommendation:** Acceptable for now. Could use RLS client for the rollback as well.

#### D4-L-002 — Team page `alert()` for error handling
- **Severity:** LOW
- **File:** `team/page.tsx:71, 75, 98, 101`
- **Issue:** Uses `alert('Failed to add team member')` and `alert('Import failed')` for error feedback. `alert()` blocks the UI thread and is not user-friendly.
- **Impact:** Poor UX, no error details shown, no retry guidance.
- **Recommendation:** Replace with inline error messages or toast notifications.

#### D4-I-001 — CSV import has good defense-in-depth
- **Severity:** INFO
- **Issue:** None. Documenting that CSV import includes: Content-Length pre-check, post-read body size check (anti-spoofing), RFC 4180 parsing, formula injection sanitization (S-014), 500-row cap, per-row validation, dedup within batch, opt-out check, batched SMS with rate limiting, `Promise.allSettled` for resilience.
- **Verdict:** Well-hardened import pipeline.

---

## Cross-Flow Findings

#### CF-H-001 — Dashboard layout is a server component with client-side code
- **Severity:** HIGH
- **File:** `(dashboard)/layout.tsx`
- **Issue:** The dashboard layout is a server component (no `'use client'` directive). It contains an `onChange` handler on the select element (line 72-74) that references `window.location.href`. React server components cannot have event handlers — they render static HTML. This means:
  1. The select element renders as HTML but the onChange never fires
  2. If Next.js hydrates this as a server component, the `window` reference would error
  3. The Billing nav link conditional `(userRole === 'owner')` at line 61 would also fail because server components can't access client-side state changes
- **Impact:** The dealership switcher is non-functional. This overlaps with D1-M-001 and D1-M-002 — all three point to the same root cause.
- **Recommendation:** Convert the nav bar to a client component (either the whole layout or extract a `<NavBar>` client component). Pass `dealershipList`, `dealershipId`, `userRole`, and `userName` as props. Keep the auth check in the server component parent.

#### CF-L-001 — Subscription check uses serviceClient in a module called from every route
- **Severity:** LOW
- **File:** `lib/billing/subscription.ts:24`
- **Issue:** `checkSubscriptionAccess()` always uses `serviceClient` regardless of whether the caller has an RLS-enforced client. Dashboard API routes have the authenticated client available but pass `dealershipId` to this function which queries dealerships via service role.
- **Impact:** Functional — works correctly. But it means the subscription status of any dealership can be queried by anyone who can call this function, regardless of RLS. Since the function is only called from authenticated routes that already validated the dealership_id, this is defense-in-depth concern only.
- **Recommendation:** Acceptable for pilot. Future: accept an optional supabase client parameter (like `insertTranscriptLog` does) to allow RLS-enforced checks.

---

## Verification Checklist

| Check | Result |
|-------|--------|
| All dashboard API routes verify auth (JWT) | YES — 6/6 routes |
| All dashboard API routes check subscription | YES — 6/6 routes |
| All dashboard API routes check role (manager/owner) | YES — 6/6 routes |
| Dashboard data scoped by dealership_id | YES — via RLS + explicit filter |
| Coach Mode auth uses timing-safe comparison | YES — `timingSafeEqual` |
| Coach Mode rate limited | YES — 30 msg/hr DB-backed |
| Coach prompts sanitize user input | YES — `sanitizePromptInput()` |
| Coach prompts include safety rails | YES — 9 rules in preamble |
| Public leaderboard exposes no PII | YES — name + score only (user_id is info-level concern) |
| CSV import sanitizes formula injection | YES — `sanitizeCsvField()` |
| CSV import has size limits | YES — 5MB + 500 rows |
| Encouragement SMS audit-logged | YES — success + failure paths |
| User deactivation is soft-delete | YES — sets status, no hard delete |
