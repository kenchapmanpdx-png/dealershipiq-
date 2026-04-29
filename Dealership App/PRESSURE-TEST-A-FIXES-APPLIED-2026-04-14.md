# Pressure Test A — Security Fixes Applied

Date: 2026-04-14
Verification: `npx tsc --noEmit` exit 0, `npm run lint` clean.

All 5 🔴 CRITICAL and 10 🟠 HIGH findings from the security audit are resolved or mitigated. S13 flagged for manual verification (it's [inferred] — requires checking scenario_bank RLS policies in production).

| ID | Finding | Change | Files |
|---|---|---|---|
| S1 | Upstash deps in package.json but not in lockfile/node_modules | Pinned `@upstash/ratelimit@2.0.5` + `@upstash/redis@1.34.3` (dropped `^`). New `src/lib/bootcheck.ts` asserts every required env var + `require.resolve`s the Upstash packages in production. Invoked from `instrumentation.ts` — throws on missing config so Vercel's deploy health check surfaces the failure before serving traffic. | `package.json`, `src/lib/bootcheck.ts` (new), `src/instrumentation.ts` |
| S2 | Sinch XMS webhook had no signature — accepted any POST matching the `to` number | REST-path now requires `X-Sinch-Webhook-Token` header matching `SINCH_XMS_CALLBACK_TOKEN` env var (timing-safe compare). Configure the Sinch dashboard to include this header on REST callbacks. Both checks must pass: `to` match AND token match. | `src/app/api/webhooks/sms/sinch/route.ts`, `.env.example`, `src/lib/bootcheck.ts` |
| S3 | Last-4 digit comparison used `String.endsWith` (timing-leaky) | Switched to `crypto.timingSafeEqual` via new `constantTimeEqualLast4` helper. Enforces length=4 on both sides before comparing. | `src/app/api/app/auth/route.ts` |
| S4 | Account deletion was soft-delete only — PII persisted forever | New migration `20260414000002_erase_user_rpc.sql` adds `erase_user_everywhere(user_id uuid)` RPC. Cascades `training_results`, `conversation_sessions`, `challenge_results`, `coach_sessions`, `sms_delivery_log`; anonymizes `sms_transcript_log`; deletes `sms_opt_outs` + `dealership_memberships`; anonymizes `users`. `DELETE /api/users/[id]?mode=erase` (owner-only) calls the RPC + `auth.admin.deleteUser`. Default mode remains `deactivate` for backward compat. | `supabase/migrations/20260414000002_erase_user_rpc.sql`, `src/app/api/users/[id]/route.ts` |
| S5 | Open redirect: `startsWith('//')` missed `\\attacker.com` and `%2F%2Fattacker.com` | Replaced with `new URL(rawNext, origin)` + origin comparison. Any off-origin URL falls back to `/dashboard`. | `src/app/api/auth/callback/route.ts` |
| S6 | In-memory auth-attempts limiter was per-Vercel-instance | Added `checkAuthAttemptLimit(phone)` in `rate-limit.ts` (Upstash sliding window, 5 per 15 min). PWA auth route calls Upstash check first, then the in-memory limiter as secondary. | `src/lib/rate-limit.ts`, `src/app/api/app/auth/route.ts` |
| S7 | CSP allowed `'unsafe-eval'` | Removed `'unsafe-eval'` from `script-src`. `'unsafe-inline'` retained for Next.js runtime; should move to nonces in a follow-on. | `vercel.json` |
| S8 | Email template chained `.replace` allowed nested placeholder injection | Single-pass regex tokenizer: `.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')`. Subject line also tokenized. Attacker-controlled `dealership_name` containing `{{portal_url}}` no longer substitutes on a later pass. | `src/lib/billing/dunning.ts` |
| S9 | Stripe portal URL validated via `startsWith` prefix | Parse with `new URL()`; compare `protocol === 'https:'` AND `hostname === 'billing.stripe.com'`. | `src/app/api/billing/portal/route.ts` |
| L13 (bonus) | Stripe checkout URL similarly unvalidated | Same pattern applied to checkout URL (`hostname === 'checkout.stripe.com'`). | `src/app/api/billing/checkout/route.ts` |
| S10 | `ENABLE_SMS_SEND` default-open (`!== 'false'`) | Flipped to allow-list (`!== 'true'` blocks). Missing/typo'd env now fails SAFE. `.env.example` updated to document. | `src/lib/sms.ts`, `.env.example` |
| S11 | `getAppUrl` returned a hardcoded Vercel preview as ultimate fallback | Throws if none of `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, or `VERCEL_URL` are set. Bootcheck asserts the same requirement at deploy time. | `src/lib/url.ts`, `src/lib/bootcheck.ts` |
| S12 | Sinch replay window was 5 min; no nonce dedup | Tightened to 60 s. New `isNonceReplayed(nonce)` function: Upstash `SET NX EX 600`; returns true on replay. Webhook rejects replayed nonces. Falls open if Upstash unavailable (signature+timestamp is primary). | `src/lib/sinch-auth.ts`, `src/app/api/webhooks/sms/sinch/route.ts` |
| S13 | scenario_bank prompt-injection risk (only if non-admins can write) | NOT shipped — flagged `[inferred]`. Requires manually verifying scenario_bank RLS policy restricts INSERT/UPDATE to admin role. See "Follow-up verification" below. | n/a |
| S14 | Rollback error leaked DB error strings to client via `dealershipId.slice(0,8)` reference | Generate `crypto.randomUUID()` incident ID; log full errors under that ID server-side; return only the UUID to the client. No raw `Error.message` crosses the boundary. | `src/app/api/billing/checkout/route.ts` |
| S15 | Middleware JWT secret absence logged-and-returned-null | Module-level assertion: `if (NODE_ENV === 'production' && !SUPABASE_JWT_SECRET) throw`. Deploy fails instead of silently 401'ing every request. Dev behavior unchanged. | `src/middleware.ts` |

## New files
- `src/lib/bootcheck.ts` — runtime env + dependency validator invoked from `instrumentation.ts`. Kills the silent-degradation class (Cluster B from the audit).
- `supabase/migrations/20260414000002_erase_user_rpc.sql` — GDPR erasure RPC.

## New env vars required

| Var | Purpose | Notes |
|---|---|---|
| `SINCH_XMS_CALLBACK_TOKEN` | S2: shared-secret on REST webhook header | `openssl rand -hex 32`. Configure the Sinch dashboard to send `X-Sinch-Webhook-Token: <value>` on every REST callback. |

## Env vars the bootcheck now enforces

Every item listed in `src/lib/bootcheck.ts` `REQUIRED_ENV_PROD`: all Supabase, Stripe, Sinch, OpenAI, Upstash, CRON_SECRET, APP_TOKEN_SECRET, plus `SINCH_XMS_CALLBACK_TOKEN` and one of `NEXT_PUBLIC_BASE_URL`/`NEXT_PUBLIC_APP_URL`/`VERCEL_URL`. Prod deploy aborts if any are missing.

## Behavior changes worth communicating

- **Every outbound SMS now requires `ENABLE_SMS_SEND=true` explicitly.** Any other value (missing, empty, `"false"`, `"yes"`, `"1"`) blocks sending. Safer default but a breaking change if staging was relying on the prior default-open behavior.
- **Production deploy aborts** if any critical env var or runtime dependency is missing. Run `npm install` before deploying; set all env vars in Vercel project settings. Check the bootcheck output on first deploy — it will list anything missing.
- **Admin owner role required to erase user data.** Managers can still `deactivate` (soft-delete); only `owner` role can call `?mode=erase`. Document in your internal ops runbook.
- **Old/stale `auth_callback?next=...` links that depended on weird bypasses will now redirect to `/dashboard`.** If any legitimate external redirect target exists, add it to an allow-list (not present in current codebase).
- **Sinch callback config change needed.** Add `X-Sinch-Webhook-Token` header in the Sinch dashboard for the XMS (REST) callback URL. Without this, REST-format inbound SMS will be rejected.

## DB hygiene to run after deploy

Migration `20260414000001_grading_recovery.sql` (from Part B) and `20260414000002_erase_user_rpc.sql` (this pass) both need `supabase db push` or equivalent.

## Follow-up verification (S13)

`scenario_bank` table powers grading prompts and can bias scores if non-admins can write to it. Verify via:

```sql
-- Confirm RLS is enabled
SELECT relname, relrowsecurity
  FROM pg_class
  WHERE relname = 'scenario_bank';

-- List INSERT / UPDATE policies
SELECT policyname, permissive, cmd, qual, with_check
  FROM pg_policies
  WHERE tablename = 'scenario_bank'
    AND cmd IN ('INSERT', 'UPDATE');
```

Expected: both policies should require `user_role = 'owner'` (or equivalent admin claim). If any policy allows `authenticated` without role restriction, that's a confirmed CRITICAL — restrict via:

```sql
DROP POLICY IF EXISTS scenario_bank_insert_anyone ON scenario_bank;
CREATE POLICY scenario_bank_insert_admin ON scenario_bank
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt()->'app_metadata'->>'user_role' = 'owner');
```

## Items I intentionally did NOT ship this pass

- **Nonce scheme for Cluster C (URL validation helper)** — did the spot fixes (S5, S9, L13) but did not extract a shared `validate-url.ts`. Follow-up refactor.
- **SOC 2 / SBOM / SLSA / CI/CD hardening** — all Fix-at-Scale; not actionable from source alone.
- **Moving `'unsafe-inline'` off the CSP script directive** — requires wiring Next.js nonces in middleware. A 20-minute follow-up once `'unsafe-eval'` removal is verified not to break Stripe.js.
- **Separate compliance audit for the rest of Category 10** — left intact; cap severity of pure-retention items at HIGH per the prompt-feedback rubric.

## Typecheck / lint status

```
$ npx tsc --noEmit ; echo $?
0
$ npm run lint
✔ No ESLint warnings or errors
```

## Suggested next verification steps

- Integration test: fire two concurrent Sinch webhook requests with the same nonce; verify the second is rejected.
- Integration test: deploy with `SUPABASE_JWT_SECRET` unset; confirm the deploy fails rather than silently 401'ing users.
- Manual test: hit `/api/auth/callback?next=/\\attacker.com` in prod; confirm it redirects to `/dashboard`.
- Manual test: owner runs `DELETE /api/users/[id]?mode=erase`; verify `SELECT` on training_results, transcript_log, sms_opt_outs for that user returns empty / anonymized.
- Manual test: post an XMS-format webhook without `X-Sinch-Webhook-Token`; confirm 200 OK with no side effects.
