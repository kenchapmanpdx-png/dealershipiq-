# Full Code Audit #4 — 2026-03-13

Branch: `audit/v4-fresh-pass` (merged batch1 + batch2 + batch3 fixes)

## Methodology

6-agent parallel audit covering:
1. serviceClient inventory (all user-facing routes)
2. PII in logs (all console statements)
3. SMS strings + feature flags
4. Webhook security + opt-out + advisory lock + rate limiting
5. RLS policies + auth patterns + Stripe idempotency
6. Error handling + edge cases + race conditions

## Prior Fixes Verified Holding

| Area | Status |
|------|--------|
| Sinch HMAC (timing-safe) | PASS |
| Stripe signature (raw body) | PASS |
| Opt-out fail-closed in sendSms() | PASS |
| Advisory lock covers state-modifying ops | PASS |
| Rate limit bypass logging (ERROR, throttled) | PASS |
| Feature flags on all 8 features | PASS |
| Persona moods all tiers | PASS |
| Stripe checkout idempotency key | PASS |
| serviceClient migration complete | PASS — all remaining justified |
| No "sales training" in SMS strings | PASS — only in marketing pages |
| All auth from app_metadata (not user_metadata) | PASS |

## New Findings

### CRITICAL

| ID | File | Issue |
|----|------|-------|
| V4-C-001 | webhooks/sms/sinch/route.ts:1173 | Welcome SMS exceeds 160 chars with 50-char dealership name (~180 chars) |
| V4-C-002 | webhooks/sms/sinch/route.ts:1306 | Welcome-back SMS exceeds 160 chars (~165 chars) |

### HIGH

| ID | File | Issue |
|----|------|-------|
| V4-H-001 | dashboard/coach-themes/route.ts:85 | Division by zero: `count / allSessions.length` when no sessions |
| V4-H-002 | meeting-script/benchmark.ts:84 | Division by zero: `sum / count` when count=0 |
| V4-H-003 | meeting-script/queries.ts:249,306 | Division by zero: `sum / count` in getCoachingFocus (2 locations) |
| V4-H-004 | leaderboard/[slug]/route.ts:100 | Math.max() on empty array returns -Infinity → invalid date |

### MEDIUM

| ID | File | Issue |
|----|------|-------|
| V4-M-001 | Multiple (30+ locations) | Error objects logged unfiltered — Supabase errors may contain column values |
| V4-M-002 | meeting-script/queries.ts:362 | Nested object access without optional chaining (competitive data) |
| V4-M-003 | users/import/route.ts:114 | Content-Length header can be spoofed — no post-read body size check |
| V4-M-004 | users/import/route.ts:314 | Generic catch swallows error without logging |
| V4-M-005 | onboarding/brands/route.ts:34 | No validation on brand string length/content |
| V4-M-006 | billing/checkout, admin/costs | Missing C-003 justification comments |

### LOW

| ID | File | Issue |
|----|------|-------|
| V4-L-001 | Phase 6 RLS policies | Direct JWT extraction instead of helper function (consistency) |
| V4-L-002 | meeting_scripts/red_flag_events RLS | Non-standard current_setting() extraction (consistency) |
| V4-L-003 | No vitest configuration | Task brief requires vitest run but no test infrastructure exists |

## Batch Plan

### Batch 3: SMS + Security (Red Team V2)
- V4-C-001, V4-C-002: Truncate welcome/welcome-back SMS to ≤160 chars
- sms.ts: Add hard enforcement (truncate with ellipsis if >160 after sanitization)

### Batch 2: Robustness
- V4-H-001 through V4-H-004: Division by zero guards
- V4-M-002: Optional chaining on nested objects
- V4-M-003: Post-read body size enforcement
- V4-M-004: Error logging in import catch block
- V4-M-005: Brand string validation
- V4-M-006: C-003 comments

### Batch 1: Deferred / Documentation
- V4-M-001: Error object sanitization (log .message only) — 43 files, 62 locations FIXED
- V4-L-001, V4-L-002: DEFERRED — RLS policy consistency requires SQL migration
- V4-L-003: DEFERRED — vitest setup is Ken action item (no test infrastructure exists)

## Resolution Status

| ID | Status | Branch |
|----|--------|--------|
| V4-C-001 | FIXED | fix/audit-v4-batch3 |
| V4-C-002 | FIXED | fix/audit-v4-batch3 |
| V4-H-001 | FIXED | fix/audit-v4-batch2 |
| V4-H-002 | FIXED | fix/audit-v4-batch2 |
| V4-H-003 | FIXED | fix/audit-v4-batch2 |
| V4-H-004 | DOCUMENTED (already guarded) | fix/audit-v4-batch2 |
| V4-M-001 | FIXED (43 files) | fix/audit-v4-batch1 |
| V4-M-002 | FIXED | fix/audit-v4-batch2 |
| V4-M-003 | FIXED | fix/audit-v4-batch2 |
| V4-M-004 | FIXED | fix/audit-v4-batch2 |
| V4-M-005 | FIXED | fix/audit-v4-batch2 |
| V4-M-006 | FIXED | fix/audit-v4-batch2 |
| V4-L-001 | DEFERRED (SQL migration) | — |
| V4-L-002 | DEFERRED (SQL migration) | — |
| V4-L-003 | DEFERRED (Ken action) | — |
