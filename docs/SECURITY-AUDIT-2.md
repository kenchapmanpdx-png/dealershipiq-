# Security Audit #2 — 2026-03-12

Post-hardening re-scan. All source files reviewed. Previous fixes (S-001 through S-028) verified holding.

## NEW FINDINGS

### CRITICAL

#### SA2-001: MeetingScript.tsx still parses auth token from document.cookie
- **File:** `src/components/dashboard/MeetingScript.tsx:17`
- **Code:** `Authorization: \`Bearer ${document.cookie.split('sb-')[1]?.split('=')[1] ?? ''}\``
- **Issue:** Same pattern as S-003 (fixed on dashboard/page.tsx) but missed on this component. Exposes Supabase auth token to XSS. Fragile string parsing.
- **Fix:** Remove manual cookie parsing. Use cookie-based auth (browser sends cookies automatically on same-origin fetch).

#### SA2-002: Onboarding employees endpoint inserts nonexistent columns — completely broken
- **File:** `src/app/api/onboarding/employees/route.ts:54-60`
- **Code:** Inserts `email`, `role`, `dealership_id` into `users` table — none of these columns exist.
- **Schema:** `users` has: id, auth_id, phone, full_name, language, status, last_active_dealership_id, created_at, updated_at, trainee_start_date
- **Impact:** Every employee import silently fails. Silent `catch` masks the error. Onboarding wizard reports success with `imported: 0`.
- **Fix:** Rewrite to match actual schema (use `last_active_dealership_id`, create `dealership_memberships` row for role, skip `email`). Use same pattern as `POST /api/users`.

#### SA2-003: Auth callback open redirect
- **File:** `src/app/api/auth/callback/route.ts:11,17`
- **Code:** `const next = searchParams.get('next') ?? '/dashboard'` → `NextResponse.redirect(\`${origin}${next}\`)`
- **Issue:** Attacker crafts `?next=//evil.com` or `?next=/\evil.com`. User redirected post-login.
- **Fix:** Validate `next` starts with `/` and does not contain `//`. Whitelist allowed paths or strip protocol.

### HIGH

#### SA2-004: Onboarding endpoints missing role authorization
- **Files:** `src/app/api/onboarding/brands/route.ts`, `src/app/api/onboarding/employees/route.ts`
- **Issue:** Both check auth (user exists + has dealership_id) but do NOT verify manager/owner role. Any authenticated salesperson can set dealership brands or import employees.
- **Fix:** Add role check from `user.app_metadata.role` — require `manager` or `owner`.

#### SA2-005: Phone number exposed in encourage API response
- **File:** `src/app/api/users/[id]/encourage/route.ts:106`
- **Code:** `recipient: targetUser.phone` in JSON response body.
- **Issue:** Plaintext phone returned to client. S-004 stripped phone from leaderboard but this endpoint still exposes it.
- **Fix:** Remove `recipient` field or mask to last 4 digits.

#### SA2-006: Leaderboard exposes user_id enabling enumeration
- **File:** `src/app/api/leaderboard/[slug]/route.ts:120`
- **Issue:** Public endpoint (no auth) returns `user_id` UUID for every user. Combined with predictable slugs, allows enumeration of all users across all dealerships.
- **Fix:** Remove `user_id` from public response. Use rank + name only.

#### SA2-007: TCPA opt-out check fails open
- **File:** `src/lib/sms.ts:49,64`
- **Issue:** `isOptedOut()` returns `false` on database error. If Supabase is down, SMS sent to opted-out users.
- **Impact:** TCPA compliance violation. Potential legal liability.
- **Fix:** Return `true` (block send) on database error. Fail-closed for compliance.

### MEDIUM

#### SA2-008: Brand names not sanitized before database insert
- **File:** `src/app/api/onboarding/brands/route.ts:29-32`
- **Issue:** Brand names from client inserted directly. No length limit, type validation, or XSS sanitization.
- **Fix:** Validate as non-empty string, max 100 chars, trim whitespace.

#### SA2-009: Onboarding brands overwrites entire settings object
- **File:** `src/app/api/onboarding/brands/route.ts:43`
- **Code:** `.update({ settings: { brands } })` — replaces ALL dealership settings with just `{ brands }`.
- **Issue:** If dealership has other settings (timezone, feature flags), they're destroyed on fallback path.
- **Fix:** Use JSONB merge: `.update({ settings: existingSettings ? { ...existingSettings, brands } : { brands } })` or use `settings || jsonb_build_object('brands', $1)`.

#### SA2-010: No pagination on public leaderboard
- **File:** `src/app/api/leaderboard/[slug]/route.ts`
- **Issue:** Returns all active users. Dealership with 10k+ users = expensive query, large response.
- **Fix:** Add `.limit(100)` or pagination parameters.

#### SA2-011: Password minLength inconsistency
- **Files:** `src/app/(auth)/login/page.tsx:76` (minLength=12), `src/app/(marketing)/signup/page.tsx:146` (minLength=8)
- **Issue:** Signup allows 8-char passwords but login form requires 12. Users who sign up with 8-11 chars can't log in via the form.
- **Fix:** Align to 8 or 12 in both places.

#### SA2-012: Dashboard endpoints missing pagination
- **Files:** coaching-queue, gaps, sessions, team routes
- **Issue:** No pagination. Large dealerships produce unbounded result sets.
- **Fix:** Add `limit` + `offset` query parameters, default to 50-100 rows.

#### SA2-013: Error details logged to console across multiple routes
- **Files:** Multiple API routes use `console.error('route error:', err)` with full error objects.
- **Issue:** Stack traces, DB error messages, and API responses logged. If log aggregator is compromised, internals exposed.
- **Fix:** Log error.message only, not full error objects. Use structured logging with redaction.

#### SA2-014: Meeting-script endpoint missing role check
- **File:** `src/app/api/dashboard/meeting-script/route.ts`
- **Issue:** Any authenticated user with a dealership can fetch the meeting script. Should be manager/owner only.
- **Fix:** Add role validation.

### LOW

#### SA2-015: Sinch webhook returns 200 on signature verification failure
- **File:** `src/app/api/webhooks/sms/sinch/route.ts`
- **Issue:** Returns 200 OK even when HMAC fails (to prevent Sinch from disabling the webhook). Attacker payloads are silently dropped (correct) but no alerting.
- **Fix:** Log signature failures with high severity for monitoring. Add alert threshold.

#### SA2-016: PWA session cookie not HttpOnly
- **File:** `src/app/app/[slug]/layout.tsx:84`
- **Issue:** `document.cookie = \`diq_session=...\`` — JavaScript-set cookies can't be HttpOnly. Cookie accessible to XSS.
- **Fix:** Set cookie from server-side (API response Set-Cookie header) with HttpOnly flag.

#### SA2-017: No request size limit on onboarding/employees
- **File:** `src/app/api/onboarding/employees/route.ts`
- **Issue:** No content-length check. Import endpoint (already broken per SA2-002) accepts unlimited payload.
- **Fix:** Add size limit (same pattern as S-009 on /api/users/import).

## PREVIOUSLY FIXED — VERIFIED HOLDING

All 15 fixes from commit c28e899 verified present and correct:
- S-001 fail-closed auth ✓
- S-002 rate limiting ✓
- S-003 cookie parsing removed from dashboard/page.tsx ✓
- S-004 phone stripped from leaderboard ✓
- S-005 RLS WITH CHECK ✓
- S-006 TCPA opt-out check ✓
- S-007 prompt sanitization ✓
- S-008 TRAIN input sanitization ✓
- S-009 payload size limits ✓
- S-012 Stripe IDs stripped ✓
- S-013 security headers ✓
- S-014 CSV formula injection ✓
- S-017 timing-safe admin key ✓
- S-023 .gitignore env files ✓
- S-028 hardcoded URL removed ✓

## STILL DEFERRED

- Redis-backed rate limiting (S-010, S-011, S-021) — needs Upstash
- CSRF protection — Next.js + SameSite cookies provide partial mitigation; full CSRF tokens deferred
- Audit logging — no centralized audit trail yet (needs Sentry/Axiom)

## SUMMARY

| Severity | Count | Fixable Now |
|----------|-------|-------------|
| CRITICAL | 3 | 3 |
| HIGH | 4 | 4 |
| MEDIUM | 7 | 7 |
| LOW | 3 | 3 |
| **Total** | **17** | **17** |
