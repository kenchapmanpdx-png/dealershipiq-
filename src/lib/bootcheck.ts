// Startup environment validation.
// S1/S11/S15/Cluster B: assert every required env var and optional-but-
// critical dependency is present at module load. If anything is missing,
// throw so the Vercel deploy health check fails and bad configuration
// never serves traffic.
//
// Imported from src/instrumentation.ts so Next.js runs it once per server
// boot. Idempotent — calling multiple times is safe.

import { log } from '@/lib/logger';

interface RequiredEnv {
  name: string;
  purpose: string;
}

// MUST be set in production. Missing any of these is an immediate abort.
//
// 2026-04-29: Split into REQUIRED (features actively serving users) and
// OPTIONAL_FUTURE (features wired in code but not yet deployed/configured).
// REQUIRED missing → throw, deploy aborts.
// OPTIONAL_FUTURE missing → loud warning log, deploy continues.
//
// Why split: the original list lumped Stripe billing + Upstash rate
// limiting into REQUIRED before either was actually configured on the
// project, which crashed Edge middleware boot and 500'd every request.
// When a feature's env vars are configured + the feature ships, move
// the entry from OPTIONAL_FUTURE → REQUIRED. The warning log makes
// "we forgot to set the env var" still surface in observability.
const REQUIRED_ENV_PROD: RequiredEnv[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', purpose: 'Supabase client' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', purpose: 'Supabase anon access' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', purpose: 'Supabase server-side RLS bypass for crons/webhooks' },
  { name: 'SUPABASE_JWT_SECRET', purpose: 'Middleware JWT verification' },
  { name: 'SINCH_PROJECT_ID', purpose: 'Sinch Conversation API' },
  { name: 'SINCH_APP_ID', purpose: 'Sinch Conversation API' },
  { name: 'SINCH_KEY_ID', purpose: 'Sinch API auth' },
  { name: 'SINCH_KEY_SECRET', purpose: 'Sinch API auth' },
  { name: 'SINCH_WEBHOOK_SECRET', purpose: 'Sinch webhook HMAC verification' },
  { name: 'SINCH_PHONE_NUMBER', purpose: 'Outbound SMS sender' },
  { name: 'SINCH_SERVICE_PLAN_ID', purpose: 'Sinch XMS (SMS REST API)' },
  { name: 'SINCH_API_TOKEN', purpose: 'Sinch XMS auth' },
  { name: 'OPENAI_API_KEY', purpose: 'OpenAI grading + follow-up generation' },
  { name: 'CRON_SECRET', purpose: 'Cron endpoint authentication' },
  // One of NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL / VERCEL_URL must be
  // set; checked separately below.
];

// Future features wired in code but not yet shipped/configured. Missing
// these logs a warning but does NOT abort the deploy. When the feature
// goes live, move the entry into REQUIRED_ENV_PROD above.
const OPTIONAL_FUTURE_ENV_PROD: RequiredEnv[] = [
  { name: 'STRIPE_SECRET_KEY', purpose: 'Stripe billing ops (not yet configured)' },
  { name: 'STRIPE_WEBHOOK_SECRET', purpose: 'Stripe webhook HMAC verification (not yet configured)' },
  { name: 'STRIPE_PRICE_ID', purpose: 'Stripe subscription price (not yet configured)' },
  { name: 'SINCH_XMS_CALLBACK_TOKEN', purpose: 'Sinch XMS webhook shared-secret auth (HMAC Conversation API path is what is currently wired)' },
  { name: 'APP_TOKEN_SECRET', purpose: 'PWA session token signing (PWA login not in critical path yet)' },
  { name: 'UPSTASH_REDIS_REST_URL', purpose: 'Rate limiter (rate limiting not yet enforced in prod)' },
  { name: 'UPSTASH_REDIS_REST_TOKEN', purpose: 'Rate limiter (rate limiting not yet enforced in prod)' },
  { name: 'INTERNAL_WORKER_SECRET', purpose: 'Off-thread Sinch worker auth (route exists at /api/internal/sinch-process but webhook does not yet dispatch to it)' },
];

let _hasRun = false;

export function validateBootEnvironment(): void {
  if (_hasRun) return;
  _hasRun = true;

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    log.info('bootcheck.skipped_non_prod', { env: process.env.NODE_ENV });
    return;
  }

  const missing: string[] = [];
  for (const { name } of REQUIRED_ENV_PROD) {
    if (!process.env[name]) missing.push(name);
  }

  // One of the base-URL variants must exist (getAppUrl enforces at call site too).
  if (!process.env.NEXT_PUBLIC_BASE_URL &&
      !process.env.NEXT_PUBLIC_APP_URL &&
      !process.env.VERCEL_URL) {
    missing.push('NEXT_PUBLIC_BASE_URL (or NEXT_PUBLIC_APP_URL or VERCEL_URL)');
  }

  // Future-feature env vars: missing → warn, do NOT abort.
  const missingFuture: string[] = [];
  for (const { name } of OPTIONAL_FUTURE_ENV_PROD) {
    if (!process.env[name]) missingFuture.push(name);
  }
  if (missingFuture.length > 0) {
    log.warn('bootcheck.future_env_unset', {
      missing_env: missingFuture,
      note: 'These vars are for features wired in code but not yet configured. Set them when the feature ships.',
    });
  }

  // 2026-04-29: Removed REQUIRED_DEPS_PROD `require.resolve` check.
  // Next.js bundles each lambda with only the modules statically imported
  // by that route, so `require.resolve('@upstash/redis')` throws in any
  // lambda that does not directly import it — a false-positive that 500'd
  // every dynamic request via the instrumentation hook. If a package is
  // genuinely missing, the actual code that imports it will fail at the
  // call site; that's a more honest signal than this defense-in-depth
  // check ever was.

  if (missing.length > 0) {
    log.error('bootcheck.failed', { missing_env: missing });
    throw new Error(`bootcheck: production requires env: ${missing.join(', ')}. Refusing to start.`);
  }

  log.info('bootcheck.ok', {
    required_env_count: REQUIRED_ENV_PROD.length,
    optional_future_env_count: OPTIONAL_FUTURE_ENV_PROD.length,
    optional_future_missing: missingFuture.length,
    runtime: process.env.NEXT_RUNTIME ?? 'unknown',
  });
}
