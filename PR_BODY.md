Restructures ~2 weeks of accumulated pressure-test fixes into 16 atomic, layered commits ordered by dependency (foundation → security → integrations → cron → dashboard → marketing → docs/migrations). No behavior changes vs. tip of branch — pure history cleanup for reviewability.

## Migrations

Both migrations in this branch (`20260414000001_grading_recovery`, `20260414000002_erase_user_rpc`) are **already applied to prod Supabase** (applied 2026-04-16 via prior session). Schema state verified 2026-04-29 — matches code expectations exactly. No DB action needed at merge.

Verification queries confirmed:
- `conversation_sessions.grading_started_at` column: `TIMESTAMPTZ`, nullable ✓
- Partial index on `grading_started_at` WHERE NOT NULL ✓
- Function `erase_user_everywhere(uuid) → jsonb` with `SECURITY DEFINER` and `search_path=public` ✓
- EXECUTE granted only to `service_role` (revoked from PUBLIC, anon, authenticated) ✓

## Verification

- `npm run build` clean (49 routes, all pre-existing warnings only)
- Schema verified: column, partial index, function signature, security_definer flag, search_path, and grants all match migration spec
- `git status` clean before merge

## Risk

Low. Code paths unchanged from current `untangle-2026-04-28` HEAD which has been on Vercel preview deploys throughout development. Merge to main triggers a prod deploy from already-tested code.

## Smoke test plan post-merge

1. Verify Vercel main deploy turns green
2. Send live SMS to grader number — confirm v7 weighted scoring + follow-up prompt + SMS format
3. Hit `/api/cron/grading-recovery` manually with cron secret — confirm 200 + cutoff + 0 reset (no stuck sessions expected)
