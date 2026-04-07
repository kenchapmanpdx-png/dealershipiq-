# DealershipIQ Session Handoff — 2026-04-07

## What Was Done This Session

### Code Review Fixes (Commit b86d525)
- CSP + HSTS security headers in vercel.json
- `poweredByHeader: false` + `reactStrictMode: true` in next.config.mjs
- RFC 4180 CSV parser fix (rejoinQuotedLines for multi-line quoted fields)
- Server-side PWA token verification (/api/app/verify replaces client-side atob)
- DST-safe getLocalYesterdayString in quiet-hours.ts
- GSM-7 sanitization on meeting SMS output
- Per-user/day dedup in daily-training cron

### Timezone Bug Fix (Commit 027cb37)
- getOutboundCountToday and getEligibleUsers in service-db.ts
- Fixed UTC midnight vs local midnight — now uses Intl.DateTimeFormat to compute correct UTC offset
- Same fix applied in sinch webhook route

### Sentry Integration (Commit 86cf76b)
- Installed @sentry/nextjs ^10.47.0
- Created sentry.server.config.ts, sentry.edge.config.ts
- Created src/instrumentation.ts (server/edge init + onRequestError)
- Created src/app/global-error.tsx (React error boundary → Sentry)
- Wrapped next.config.mjs with withSentryConfig
- CSP updated: added sentry-cdn.com (script-src), *.ingest.us.sentry.io (connect-src), blob: (worker-src)
- Tunnel route /monitoring to bypass ad-blockers
- Source map upload enabled (hideSourceMaps: true, widenClientFileUpload: true)

### Sentry Deprecation Fixes (Commit after 86cf76b)
- Replaced disableLogger with webpack.treeshake.removeDebugLogging
- Moved client config from sentry.client.config.ts → src/instrumentation-client.ts (Turbopack compat)

### Sentry Project + Env Vars
- Created Sentry project: dealershipiq-nextjs (org: dealershipiq)
- Added NEXT_PUBLIC_SENTRY_DSN to Vercel (All Environments)
- Added SENTRY_AUTH_TOKEN to Vercel (All Environments)
- Verified source maps uploaded successfully (192 files, 0.5s)

## Uncommitted Change on Disk
- `src/instrumentation-client.ts` — added `export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;` (clears last build warning)

### Push command:
```powershell
cd C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
git add src/instrumentation-client.ts
git commit -m "feat: add router transition hook for Sentry navigation tracing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
git push
```

## Sentry Configuration Reference
- Org: dealershipiq
- Project: dealershipiq-nextjs
- Dashboard: https://dealershipiq.sentry.io/issues/
- DSN: https://afd2adb1ffad490ede25038b88c0598d@o4511173608800256.ingest.us.sentry.io/4511175289733120
- Client config: src/instrumentation-client.ts
- Server config: sentry.server.config.ts (project root)
- Edge config: sentry.edge.config.ts (project root)
- Tunnel route: /monitoring
- Sample rates: 10% traces (prod), 5% replay baseline, 100% replay on error

## Vercel Environment Variables (as of this session)
- NEXT_PUBLIC_SENTRY_DSN ✅
- SENTRY_AUTH_TOKEN ✅
- NEXT_PUBLIC_SUPABASE_URL ✅
- NEXT_PUBLIC_SUPABASE_ANON_KEY ✅
- SUPABASE_SERVICE_ROLE_KEY ✅
- OPENAI_API_KEY ✅
- SINCH_PROJECT_ID ✅
- SINCH_APP_ID ✅
- SINCH_API_TOKEN ✅
- SINCH_SERVICE_PLAN_ID ✅
- SINCH_PHONE_NUMBER ✅
- SINCH_WEBHOOK_SECRET ✅

## Pending / Next Steps (Prioritized)

### 1. Testing Strategy (High Priority)
- Only 17 tests exist (smoke + tenant isolation)
- Zero coverage on core flows: SMS webhook, AI grading, daily-training cron, CSV import
- Recommend: integration tests for sinch webhook → grading → response flow

### 2. Next.js 14→16 Upgrade (Medium Priority)
- 4 npm audit vulnerabilities require this major version bump
- Breaking change risk — needs dedicated session
- Vulnerabilities are in dev tooling, not production-facing

### 3. CSP Nonce Migration (Low Priority)
- Currently using unsafe-inline/unsafe-eval for Next.js hydration
- Future hardening: replace with nonce-based CSP
- Requires middleware changes + _document.tsx nonce injection

## Key Gotchas for Next Session
- **OneDrive git locking**: If git errors with "Unable to create index.lock", run `del .git\index.lock` in PowerShell
- **Sandbox npm limitation**: Cannot run npm install from sandbox — user must run locally
- **Ken is non-technical**: Provide exact copy-paste PowerShell commands. Use Chrome MCP for web UI tasks when possible.
- **Repo path**: C:\Users\kenny\OneDrive\Apps\DealerIQ\Github\dealershipiq
