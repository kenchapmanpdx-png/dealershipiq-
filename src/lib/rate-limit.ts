// Rate limiting — Upstash Redis + @upstash/ratelimit
// Build Master: Phase 2F
// Limits: AI grading per tenant, SMS sends global
// Requires: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//
// NOTE: Install @upstash/ratelimit and @upstash/redis when credentials are provided.
// Until then, all limiters pass through (no-op).

interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

const PASS_THROUGH: RateLimitResult = { success: true, remaining: 999, reset: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _redis: any = null;
let _initialized = false;

async function getRedis() {
  if (_initialized) return _redis;
  _initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('Rate limiting disabled: UPSTASH_REDIS_REST_URL/TOKEN not set');
    return null;
  }

  try {
    // Dynamic require — only loads if package installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    console.warn('Rate limiting disabled: @upstash/redis not installed');
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

// AI grading: 100 requests per minute per dealership
export async function checkAiGradingLimit(dealershipId: string): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) return PASS_THROUGH;

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(100, '60 s'),
      prefix: 'rl:ai:',
    });
    const result = await limiter.limit(dealershipId);
    return { success: result.success, remaining: result.remaining, reset: result.reset };
  } catch (err) {
    console.error('Rate limit check failed:', err);
    return PASS_THROUGH;
  }
}

// SMS sends: 15 per second global (under Sinch 20/sec default)
export async function checkSmsSendLimit(): Promise<RateLimitResult> {
  const redis = await getRedis();
  const mod = await getRatelimit();
  if (!redis || !mod) return PASS_THROUGH;

  try {
    const limiter = new mod.Ratelimit({
      redis,
      limiter: mod.Ratelimit.slidingWindow(15, '1 s'),
      prefix: 'rl:sms:',
    });
    const result = await limiter.limit('global');
    return { success: result.success, remaining: result.remaining, reset: result.reset };
  } catch (err) {
    console.error('SMS rate limit check failed:', err);
    return PASS_THROUGH;
  }
}

// Circuit breaker: track AI failures per 5-min window
// Open after 3 failures → 5-min cooldown
export async function checkCircuitBreaker(): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true; // circuit closed (allow)

  try {
    const count = await redis.get('cb:ai:failures');
    return (parseInt(count as string, 10) || 0) < 3;
  } catch {
    return true; // fail open
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
