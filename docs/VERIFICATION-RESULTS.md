# Post-Remediation Verification
## Date: 2026-03-14

### 1. Build Gates
- **tsc:** PASS (zero errors)
- **lint:** PASS (zero warnings or errors)
- **vitest:** PASS (2 files, 17 tests)
- **build:** PASS (35 pages — 8 static, 27 dynamic)

### 2. Database (Supabase)

#### 2a. Policy count + new policies
**Total policy count:** 52 — PASS (expected 52)

**Specific table policies:**

| tablename | policyname | cmd | roles |
|---|---|---|---|
| chain_templates | chain_templates_select_authenticated | SELECT | {authenticated} |
| meeting_scripts | Managers see own meeting scripts | SELECT | {public} |
| meeting_scripts | meeting_scripts_select_manager | SELECT | {authenticated} |
| model_years | model_years_select_public | SELECT | {authenticated} |
| sms_transcript_log | sms_transcript_log_insert_authenticated | INSERT | {authenticated} |
| sms_transcript_log | transcript_select_manager | SELECT | {authenticated} |

- chain_templates: SELECT with `USING(true)` — PASS (global reference, no dealership_id)
- model_years: SELECT with `USING(true)` — PASS (global reference)
- meeting_scripts: manager SELECT scoped by `get_dealership_id()` — PASS (note: old `{public}` policy also present — cleanup candidate)
- sms_transcript_log: SELECT + INSERT — PASS
- billing_events: zero rows — PASS (service-role-only by design)

#### 2b. Phase 6 standardization — raw jwt references
**Result:** 4 rows returned — PASS WITH CAVEAT

All 4 use `current_setting('request.jwt.claims'...)` pattern (NOT raw `auth.jwt()->'dealership_id'`):
- red_flag_events: "Managers see own dealership red flags" (Phase 4.5B, pre-Phase 6)
- dealership_brands: 2 policies (Phase 4B, explicitly excluded from H-002 — already uses `current_setting()`)
- meeting_scripts: "Managers see own meeting scripts" (Phase 4.5B, pre-Phase 6)

The 4 actual Phase 6 tables (scenario_chains, daily_challenges, peer_challenges, custom_training_content) all use `get_dealership_id()` helpers — verified in the 52-policy table. The query false-positive matches `current_setting('request.jwt.claims'...)` because it contains the string "jwt".

#### 2c. FK indexes
**Result:** 8/8 — PASS

All 8 indexes present:
- idx_consent_records_added_by
- idx_conversation_sessions_prompt_version_id
- idx_daily_challenges_winner_user_id
- idx_peer_challenges_challenged_session_id
- idx_peer_challenges_challenger_session_id
- idx_peer_challenges_winner_id
- idx_scenario_chains_chain_template_id
- idx_training_results_prompt_version_id

#### 2d. record_chain_step RPC
**Result:** PASS
- routine_name: record_chain_step
- routine_type: FUNCTION
- security_type: DEFINER

#### 2e. manager_scenarios RLS
**Result:** RLS enabled (relrowsecurity = true), 0 policies.
Effectively service-role-only — all authenticated queries blocked. This is the expected state: manager_scenarios was found to have zero policies in production during Migration 4 investigation. The table is written by service role (manager-create flow) and read by service role (daily-training cron). No authenticated user-facing route queries it directly.

### 3. Service Role Migration Completeness

#### 3a. serviceClient in user-facing routes
**Hits (all justified):**

| File | Justification | Valid? |
|---|---|---|
| billing/checkout/route.ts | C-003: signup creates auth user + dealership before JWT exists | YES — bootstrap flow |
| coach/session/route.ts | C-003: PWA phone auth (HMAC token, not JWT). coach_sessions has manager SELECT policy (03/13 migration). Service role needed for INSERT. | YES — no JWT in PWA context |
| leaderboard/[slug]/route.ts | C-003: public endpoint, no JWT available | YES — unauthenticated |
| app/auth/route.ts | C-003: phone token auth, no JWT, creates session token for PWA | YES — auth bootstrap |
| users/route.ts | C-003: cross-tenant phone check + rollback DELETE | YES — tenant-scoped queries on RLS, only cross-tenant ops use service role |
| dashboard/meeting-script/route.ts | C-003: "Migrated from serviceClient to RLS-backed authenticated client" (comment only — no serviceClient import) | N/A — fully migrated |

**Issues:** 0

#### 3b. Three previously-blocked routes
All 3 routes import from `@/lib/service-db` (for `insertTranscriptLog` helper) but NO direct `serviceClient` or `createServiceClient` imports:
- `push/training/route.ts` — service-db import only (insertTranscriptLog accepts optional RLS client)
- `users/import/route.ts` — service-db imports (getDealershipName, insertTranscriptLog)
- `users/[id]/encourage/route.ts` — service-db import (insertTranscriptLog)

**Result:** PASS — H-004 migration complete. `insertTranscriptLog()` receives authenticated client from these routes.

#### 3c. C-003 comments on cron/app routes
**8 hits across 8 files:**
- challenge-results/route.ts: "Cron endpoint — service role required, no user JWT in cron context" — PASS
- daily-digest/route.ts: "Cron endpoint — service role required, no user JWT in cron context" — PASS
- dunning-check/route.ts: "Cron endpoint — service role required (via service-db), no user JWT in cron context" — PASS
- red-flag-check/route.ts: "Cron endpoint — service role required, no user JWT in cron context" — PASS
- sync-optouts/route.ts: "Cron endpoint — service role required, no user JWT in cron context" — PASS
- orphaned-sessions/route.ts: "C-003: Expire stale scenario chains" (inline comment) — PASS
- app/auth/route.ts: "Phone token auth — no JWT, creates session token for PWA" — PASS
- coach/session/route.ts: "serviceClient justified — coach_sessions has RLS with manager SELECT policy (03/13 migration)" — PASS (references 03/13 migration, not "deny-all RLS")

**Result:** 8/7 (exceeded — orphaned-sessions also has inline C-003) — PASS

### 4. Security Invariants

| Check | Result | Evidence |
|---|---|---|
| HMAC timing-safe (sinch-auth.ts) | PASS | `crypto.timingSafeEqual` at line 80 |
| Stripe signature (stripe webhook) | PASS | `verifyWebhookSignature()` wraps `stripe.webhooks.constructEvent()` (stripe.ts:126) |
| Opt-out fail-closed (sms.ts) | PASS | `isOptedOut()` returns true on all error paths (lines 51, 67, 73) |
| GSM-7 sanitization (sms.ts) | PASS | `sanitizeGsm7()` exported at line 19, called at line 98 |
| Advisory lock (sinch webhook) | PASS WITH CAVEAT | Comment documents `pg_try_advisory_xact_lock` at line 397 but actual lock implementation is in `record_chain_step` SQL RPC (SECURITY DEFINER function), not in TypeScript. The webhook route calls the RPC. |
| No "sales training" in SMS | PASS | `grep -rn "sales training" src/ --include="*.ts"` returns zero hits |
| Message cap enforcement | PASS | `recentSends` check at daily-training/route.ts:71-77, cap check at line 99 |

**Result:** 7/7 PASS

### 5. Documentation Verification

| Check | Result | Evidence |
|---|---|---|
| Ghost tables (NR-020) | PASS | NEEDS-REVIEW.md line 79: 7 tables documented with "keep for future features" |
| Env vars (.env.example) | PASS | ENABLE_SMS_SEND (line 25), APP_TOKEN_SECRET (line 28) |
| SESSION-STATE route + flags | PASS | "API Routes (32 total)" at line 1057, "Feature Flags" table at line 1082 (12 flags) |
| Durable queue (NR-021) | PASS | NEEDS-REVIEW.md line 84: processed_webhooks/sms_inbound_jobs deferral documented |

**Result:** 4/4 PASS

### 6. Production Endpoints

| Endpoint | Expected | Actual | Result |
|---|---|---|---|
| `GET /` (landing page) | 200 | 200 | PASS |
| `GET /api/leaderboard/demo-honda` | 200 | 200 | PASS |
| `GET /api/dashboard/team` | 401/403 | 401 | PASS |

**Result:** 3/3 PASS

### 7. Git State
- Working tree: **clean**
- Branch: **main**
- Up to date with origin/main
- Latest commits:
  - `11f0a57` fix: correct migrations applied to Supabase + post-migration verification
  - `d8d819b` fix: Audit 1 remediation — 4C/5H/12M findings resolved
  - `705dbd7` docs: add RLS policy inventory and H-011 verification to SESSION-STATE
  - `53b9d7f` docs: update SESSION-STATE with full remediation completion evidence
  - `0cd29ae` fix(RT-003,M-001): sanitize remaining PII in logs, fix advisory lock comment

**Result:** PASS

---

## Summary

| Category | Status |
|---|---|
| Build Gates | 4/4 PASS |
| Database (Supabase) | 5/5 PASS (2b has caveat — false positive on `current_setting` pattern) |
| Service Role | 3/3 PASS (0 issues) |
| Security | 7/7 PASS (advisory lock caveat — lives in SQL RPC not TS) |
| Documentation | 4/4 PASS |
| Production Endpoints | 3/3 PASS |
| Git | PASS |

### Overall: ALL PASS

### Caveats (non-blocking)
1. **2b false positive:** 4 pre-Phase-6 policies use `current_setting('request.jwt.claims'...)` which matches `%jwt%` in the query. These were explicitly excluded from H-002 scope. All actual Phase 6 policies use `get_dealership_id()` helpers.
2. **Advisory lock location:** The `pg_try_advisory_xact_lock` is implemented in the `record_chain_step` SQL RPC (SECURITY DEFINER), not directly in TypeScript. The webhook route calls the RPC. The TS comment at line 397 documents this.
3. **meeting_scripts duplicate policy:** Both "Managers see own meeting scripts" (`{public}`, old) and "meeting_scripts_select_manager" (`{authenticated}`, new) exist. Both enforce dealership isolation + manager role. Cleanup candidate for future pass.
4. **manager_scenarios:** RLS enabled, 0 policies = effectively service-role-only. Matches current usage pattern (service role writes/reads only). If future authenticated access is needed, policies must be added.
