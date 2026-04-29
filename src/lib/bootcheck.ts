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

interface OptionalDep {
  name: string;
  purpose: string;
}

// MUST be set in production. Missing any of these is an immediate abort.
const REQUIRED_ENV_PROD: RequiredEnv[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', purpose: 'Supabase client' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', purpose: 'Supabase anon access' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', purpose: 'Supabase server-side RLS bypass for crons/webhooks' },
  { name: 'SUPABASE_JWT_SECRET', purpose: 'Middleware JWT verification' },
  { name: 'STRIPE_SECRET_KEY', purpose: 'Stripe billing ops' },
  { name: 'STRIPE_WEBHOOK_SECRET', purpose: 'Stripe webhook HMAC verification' },
  { name: 'STRIPE_PRICE_ID', purpose: 'Stripe subscription price' },
  { name: 'SINCH_PROJECT_ID', purpose: 'Sinch Conversation API' },
  { name: 'SINCH_APP_ID', purpose: 'Sinch Conversation API' },
  { name: 'SINCH_KEY_ID', purpose: 'Sinch API auth' },
  { name: 'SINCH_KEY_SECRET', purpose: 'Sinch API auth' },
  { name: 'SINCH_WEBHOOK_SECRET', purpose: 'Sinch webhook HMAC verification' },
  { name: 'SINCH_PHONE_NUMBER', purpose: 'Outbound SMS sender' },
  { name: 'SINCH_SERVICE_PLAN_ID', purpose: 'Sinch XMS (SMS REST API)' },
  { name: 'SINCH_API_TOKEN', purpose: 'Sinch XMS auth' },
  { name: 'SINCH_XMS_CALLBACK_TOKEN', purpose: 'Sinch XMS webhook shared-secret auth (S2)' },
  { name: 'OPENAI_API_KEY', purpose: 'OpenAI grading + follow-up generation' },
  { name: 'CRON_SECRET', purpose: 'Cron endpoint authentication' },
  { name: 'APP_TOKEN_SECRET', purpose: 'PWA session token signing' },
  { name: 'UPSTASH_REDIS_REST_URL', purpose: 'Rate limiter (fail-closes if absent in prod)' },
  { name: 'UPSTASH_REDIS_REST_TOKEN', purpose: 'Rate limiter' },
  // One of these must be set; checked separately below.
];

// Must be requireable from node_modules in production.
const REQUIRED_DEPS_PROD: OptionalDep[] = [
  { name: '@upstash/redis', purpose: 'Rate limiting + circuit breaker' },
  { name: '@upstash/ratelimit', purpose: 'Rate limiting' },
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

  const missingDeps: string[] = [];
  for (const { name } of REQUIRED_DEPS_PROD) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require.resolve(name);
    } catch {
      missingDeps.push(name);
    }
  }

  if (missing.length > 0 || missingDeps.length > 0) {
    const detail = [
      missing.length > 0 ? `env: ${missing.join(', ')}` : '',
      missingDeps.length > 0 ? `deps: ${missingDeps.join(', ')}` : '',
    ].filter(Boolean).join(' | ');
    log.error('bootcheck.failed', { missing_env: missing, missing_deps: missingDeps });
    throw new Error(`bootcheck: production requires ${detail}. Refusing to start.`);
  }

  log.info('bootcheck.ok', {
    env_count: REQUIRED_ENV_PROD.length,
    dep_count: REQUIRED_DEPS_PROD.length,
  });
}
