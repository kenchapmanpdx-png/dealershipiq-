// Rate limiting — Upstash Redis + @upstash/ratelimit
// Build Master: Phase 2F
// Limits: AI grading per tenant, SMS sends global, signup per IP
// Requires: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//
// Behavior:
//   - If Redis is configured and reachable → normal rate limiting.
//   - If Redis is unreachable or missing in PRODUCTION → fail CLOSED (returns success:false).
//     Callers must handle {success:false} by rejecting with 503.
//   - If missing outside production → fail OPEN with a warn log (dev convenience).
//
// Env override: RATE_LIMIT_FAIL_OPEN=true forces fail-open even in prod (emergency escape hatch).

import { log } from '@/lib/logger';

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  bypass_reason?: 'redis_missing' | 'redis_error' | 'forced_open' | 'ok';
}

const PASS_THROUGH: RateLimitResult = { success: true, remaining: 999, reset: 0, bypass_reason: 'forced_open' };
const FAIL_CLOSED: RateLimitResult = { success: false, remaining: 0, reset: 0, bypass_reason: 'redis_missing' };

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

function forcedOpen(): boolean {
  return process.env.RATE_LIMIT_FAIL_OPEN === 'true';
}

// Return the appropriate bypass result based on environment.
function bypassResult(limiter: string, reason: 'redis_missing' | 'redis_error'): RateLimitResult {
  if (isProd() && !forcedOpen()) {
    log.error('rate_limit.fail_closed', { limiter, reason });
    return { ...FAIL_CLOSED, bypass_reason: reason };
  }
  // Dev or emergency override
  log.warn('rate_limit.bypass', { limiter, reason, env: process.env.NODE_ENV, forced_open: forcedOpen() });
  return { ...PASS_THROUGH, bypass_reason: reason };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _redis: any = null;
let _initialized = false;

async function getRedis() {
  if (_initialized) return _redis;
  _initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch (err) {
    log.error('rate_limit.redis_init_failed', { err: (err as Error).message });
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRatelimit(): Promise<any> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@upstash/ratelimit');
  } catch {
    return null;
  }
}

// 2026-04-18 H-2: Per-phone inbound SMS rate limit. Sits in front of the AI
// grader so a single malicious or misconfigured phone can't drive
// 100/min × $0.03 = $3/min ≈ $180/hour of OpenAI cost through one
// dealership's quota. Tuned conservatively: 10 inbound / 60s is ~4x a
// fast human texter but well below automation. Keyed on E.164 phone,
// so an attacker controlling multiple numbers is still capped per-number.
export async function checkInboundPhoneLimit(phone: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('inbound-phone', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(10, '60 s'),
      prefix: 'rl:in:',
    });
    const result = await limiter.limit(phone);
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'inbound-phone', err: (err as Error).message });
    return bypassResult('inbound-phone', 'redis_error');
  }
}

// AI grading: 100 requests per minute per dealership
export async function checkAiGradingLimit(dealershipId: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('ai-grading', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(100, '60 s'),
      prefix: 'rl:ai:',
    });
    const result = await limiter.limit(dealershipId);
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'ai-grading', err: (err as Error).message });
    return bypassResult('ai-grading', 'redis_error');
  }
}

// SMS sends: 15 per second global (under Sinch 20/sec default)
export async function checkSmsSendLimit(): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('sms-send', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(15, '1 s'),
      prefix: 'rl:sms:',
    });
    const result = await limiter.limit('global');
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'sms-send', err: (err as Error).message });
    return bypassResult('sms-send', 'redis_error');
  }
}

// S6: PWA auth attempts — 5 per phone per 15 minutes.
// Previously lived in an in-memory Map in app/auth/route.ts — per-Vercel-instance,
// trivially bypassed by autoscaling. Moved here to Upstash so the limit is global.
export async function checkAuthAttemptLimit(phone: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('auth-attempt', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(5, '900 s'),
      prefix: 'rl:auth:',
    });
    const result = await limiter.limit(phone);
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'auth-attempt', err: (err as Error).message });
    return bypassResult('auth-attempt', 'redis_error');
  }
}

// 2026-04-18 H-15: Ask IQ — 60 questions per hour per user, global across
// serverless instances. Replaces the in-memory Map-based limiter previously
// in /api/ask/route.ts, which enforced `60/hr * N instances` since every
// Vercel cold-start had its own Map. Keyed on userId so a high-volume rep
// can't drain AI quota for their teammates.
export async function checkAskLimit(userId: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('ask', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(60, '3600 s'),
      prefix: 'rl:ask:',
    });
    const result = await limiter.limit(userId);
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'ask', err: (err as Error).message });
    return bypassResult('ask', 'redis_error');
  }
}

// Signup: 5 requests per hour per IP
export async function checkSignupLimit(ip: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) {
    return bypassResult('signup', 'redis_missing');
  }

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(5, '3600 s'),
      prefix: 'rl:signup:',
    });
    const result = await limiter.limit(ip);
    return { success: result.success, remaining: result.remaining, reset: result.reset, bypass_reason: 'ok' };
  } catch (err) {
    log.error('rate_limit.check_failed', { limiter: 'signup', err: (err as Error).message });
    return bypassResult('signup', 'redis_error');
  }
}

// Circuit breaker: track AI failures per 5-min window
// Open after 3 failures → 5-min cooldown
// Fails OPEN (allow) when Redis missing — single-instance resilience
export async function checkCircuitBreaker(): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true;

  try {
    const count = await redis.get('cb:ai:failures');
    return (parseInt(count as string, 10) || 0) < 3;
  } catch {
    return true;
  }
}

export async function recordCircuitBreakerFailure(): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;

  try {
    await redis.incr('cb:ai:failures');
    await redis.expire('cb:ai:failures', 300);
  } catch {
    // best effort
  }
}
