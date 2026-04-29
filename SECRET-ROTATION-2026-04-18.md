# Secret Rotation Runbook — 2026-04-18 (C-5)

## Secrets to rotate

Both of these were found with low-entropy values in `.env.local`:

- `ADMIN_API_KEY` — currently `diq_admin_2024_xK9mP3nQ7v` (human-guessable)
- `CRON_SECRET` — currently `dealershipiq-cron-secret-2024` (human-guessable)

Timing-safe comparison is useless if the secret itself is a guessable dictionary phrase.

## Replacement values

Two freshly generated 64-char hex strings. Do NOT commit this file if you paste real values here — these are placeholders. Re-run the command on your workstation to regenerate before using:

```
# ADMIN_API_KEY  (run once, paste result into Vercel + .env.local)
openssl rand -hex 32

# CRON_SECRET  (run once, paste result into Vercel + .env.local)
openssl rand -hex 32
```

Each command prints a 64-char hex string (256 bits of entropy). Example format only:
`ADMIN_API_KEY = 7a3f...c1e9` (64 hex chars)
`CRON_SECRET   = 5b92...a0d4` (64 hex chars)

## Rotation steps

1. Generate both values locally:
   ```
   cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
   openssl rand -hex 32     # copy result for ADMIN_API_KEY
   openssl rand -hex 32     # copy result for CRON_SECRET
   ```

2. Update Vercel production env:
   - https://vercel.com/<team>/dealershipiq-wua7/settings/environment-variables
   - Edit `ADMIN_API_KEY` — paste new value — Save for Production (and Preview if used).
   - Edit `CRON_SECRET` — paste new value — Save for Production (and Preview if used).

3. Update Vercel cron-job secret (if configured in vercel.json or the Cron UI):
   - https://vercel.com/<team>/dealershipiq-wua7/settings/crons
   - Confirm each cron hits `/api/cron/*` with `Authorization: Bearer $CRON_SECRET`.

4. Update `.env.local` on this workstation:
   ```
   ADMIN_API_KEY="<new-64-hex-value>"
   CRON_SECRET="<new-64-hex-value>"
   ```

5. Redeploy production:
   ```
   cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
   npx vercel --prod
   ```

6. Verify cron still works after deploy (crons run hourly — check next run):
   - https://vercel.com/<team>/dealershipiq-wua7/deployments/<sha>/crons
   - Any 401 = the cron-job secret in Vercel doesn't match `CRON_SECRET` env.

## Verify the old value was never committed to git

Run locally (these scan ALL branches and reflogs, including deleted branches):

```
cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
git log --all --full-history --source -- .env.local
git log -p --all -S"diq_admin_2024_xK9mP3nQ7v"
git log -p --all -S"dealershipiq-cron-secret-2024"
```

Expected: empty output for all three. If ANY hit returns results:
- Treat the old secret as compromised (already rotated above, good).
- Use BFG or `git filter-repo` to purge it from history.
- Force-push the cleaned refs to GitHub.
- If the repo is public, also rotate every other secret in that env just in case.

## Verify `.gitignore` covers `.env.local`

```
cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
git check-ignore -v .env.local
```

Expected: `.gitignore:<line>:.env*    .env.local`

## Post-rotation smoke test

After redeploy:
1. Open https://dealershipiq-wua7.vercel.app/dashboard — should load (not the rotated key path).
2. Wait for the next hourly cron (or manually trigger one from Vercel Crons UI) — confirm it returns 200, not 401.
3. Tail Vercel logs for `cron.auth.failed` or `admin.auth.failed` events in the first hour — those would indicate a stale caller still using the old secret.

---

# H-10: Retire stale SUPABASE_SERVICE_KEY + deprecated project

Separate but adjacent cleanup. `.env.local` contained (per security review):

```
SUPABASE_SERVICE_KEY=eyJ...ref:"hbhcwbqxiumfauidtnbz"...
```

This variable name is NOT read by the Next.js app (which uses `SUPABASE_SERVICE_ROLE_KEY` against project `nnelylyialhnyytfeoom`). The stale entry is service-role auth for a deprecated project. If that project still exists, the key still works.

## Steps

1. Remove the line from `.env.local`:
   ```
   # Open .env.local and DELETE any line starting with:
   SUPABASE_SERVICE_KEY=
   ```
   Keep `SUPABASE_SERVICE_ROLE_KEY=` (the canonical one pointing at `nnelylyialhnyytfeoom`) — that is still required.

2. Confirm Vercel doesn't have `SUPABASE_SERVICE_KEY` set:
   - https://vercel.com/<team>/dealershipiq-wua7/settings/environment-variables
   - If present, delete it from Production, Preview, and Development.

3. Log into Supabase and verify the deprecated projects are shut down:
   - https://supabase.com/dashboard/projects
   - Look for `hbhcwbqxiumfauidtnbz` and `bjcqstoekfdxsosssgbl` (per `docs/DECISIONS.md`).
   - If either still exists: pause/delete it. If you cannot delete (maybe billing holds), at minimum rotate its service-role JWT in Supabase → Settings → API so the key leaked in `.env.local` is dead.

4. The Python scripts under `scripts/` have been updated to read `SUPABASE_SERVICE_ROLE_KEY` (H-10 commit). Make sure any shell rc that exports `SUPABASE_SERVICE_KEY=` for those scripts is updated as well:
   ```
   grep -r "SUPABASE_SERVICE_KEY" ~/.bashrc ~/.zshrc ~/.profile 2>/dev/null
   ```
   Expected: no results. If any match, rename the var and restart your shell.

5. Verify the deprecated key is not in git history:
   ```
   cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
   git log -p --all -S"hbhcwbqxiumfauidtnbz"
   git log -p --all -S"SUPABASE_SERVICE_KEY"
   ```
   First command should return empty. Second may return this runbook + the scripts' old lines — those are safe (names, not the secret). If you see a leaked JWT, treat as compromised.
