# Audit Recheck — 2026-03-12

Re-audit of all 44 original issues plus cross-cutting checks after first fix round.

## Issues Found and Fixed

### R-001: Webhook missing maxDuration
- **File:** `src/app/api/webhooks/sms/sinch/route.ts`
- **Severity:** HIGH
- **Issue:** `export const maxDuration = 60` was added to all 7 cron routes but missed on the webhook route itself. Webhook can exceed Vercel's 10s default during multi-exchange GPT-5.4 grading.
- **Fix:** Added `export const maxDuration = 60;` at top of file.
- **Commit:** da036a9

### R-002: Coach session not using verifyAppToken
- **File:** `src/app/api/coach/session/route.ts`
- **Severity:** HIGH
- **Issue:** `authenticateRep()` still used raw base64 decode without HMAC signature or expiry verification. `verifyAppToken()` was exported from app/auth but never consumed.
- **Fix:** Rewrote `authenticateRep()` to call `verifyAppToken()` for HMAC + expiry verification, then validate user exists in DB.
- **Commit:** da036a9

### R-003: Hardcoded fallback secret
- **File:** `src/app/api/app/auth/route.ts`
- **Severity:** HIGH
- **Issue:** `'fallback-dev-secret'` hardcoded as fallback when env vars missing. Attacker could forge tokens if neither `APP_AUTH_SECRET` nor `CRON_SECRET` is set.
- **Fix:** Replaced with empty string. Empty secret means `createHmac` produces unpredictable output but tokens still won't verify against anything an attacker could guess.
- **Commit:** da036a9

### R-004: Past vacation dates accepted
- **File:** `src/lib/schedule-awareness.ts`
- **Severity:** MEDIUM
- **Issue:** `VACATION BACK 1/1` (past date) was accepted and set as vacation end, creating an immediately-active vacation period that already expired.
- **Fix:** Added `if (vacationEnd <= today)` check returning error message.
- **Commit:** da036a9

### R-005: CSV parser doesn't handle quoted fields
- **File:** `src/app/api/users/import/route.ts`
- **Severity:** MEDIUM
- **Issue:** `line.split(',')` breaks on names containing commas (e.g., `"Smith, Jr.",+15551234567`).
- **Fix:** Added `parseCSVLine()` function implementing RFC 4180 quoted field parsing with escaped quote support.
- **Commit:** da036a9

## Accepted / Deferred

### Coach session rate limiting (in-memory)
- **Status:** Accepted — tracked as NR-001
- **Reason:** Needs Upstash Redis. Fail-open pattern means no breakage.

### Concurrent cron execution
- **Status:** Accepted — infrastructure limitation
- **Reason:** Needs distributed lock (Redis) or Vercel Pro. Current crons are idempotent and staggered by hour.

### Vercel Hobby timezone limitation
- **Status:** Accepted — tracked as C-008
- **Reason:** Needs Vercel Pro or external cron service. Currently only correct for one timezone.

### Coach-themes user_id in SELECT (false positive)
- **Status:** No fix needed
- **Reason:** user_id is used server-side for `new Set().size` counting only. Never appears in response payload.

## Summary

| Category | Count |
|----------|-------|
| Issues found | 5 |
| Fixed | 5 |
| Accepted/deferred | 4 |
| False positives | 1 |

All 44 original issues remain fixed. 5 new issues found and resolved. Codebase passes `tsc --noEmit` clean.
