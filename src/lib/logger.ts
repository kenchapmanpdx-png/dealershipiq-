// Structured JSON logger — emits one JSON line per event for easy grep/alerting.
// Pairs with Sentry: callers that want Sentry capture import @sentry/nextjs separately.
//
// Usage:
//   import { log } from '@/lib/logger';
//   log.error('webhook.stripe.dropped', { stripe_event_id: id, stripe_customer_id: cid });
//   log.warn('cron.daily_training.partial', { processed, remaining });
//   log.info('billing.dunning.email_sent', { dealership_id, stage });
//
// 2026-04-18 M-7: PII scrubber. In production, any value matching
// recognizable PII patterns (UUIDs, E.164 phones, email) is hashed
// before logging so logs still correlate (same value -> same hash) but
// the raw PII never lands in Sentry / Axiom / Vercel log drains. Keys
// whose name ends in `_last4` are whitelisted (known-safe tokenized
// form) and passed through verbatim.
//
// 2026-04-28: switched from Node `crypto.createHash('sha256')` to a
// pure-JS deterministic hash (cyrb53) so this module compiles in BOTH
// Node and Edge runtimes. instrumentation.ts imports bootcheck (which
// imports this logger) on Edge boot to fail-fast on missing env, and
// Edge cannot resolve Node's `crypto` module. The previous SHA-256 was
// already truncated to 64 bits so it offered no real cryptographic
// guarantee — cyrb53 produces equivalent collision resistance without
// the runtime dependency. Hash is for log correlation/obfuscation only,
// not security.
//
// Dev/test envs bypass scrubbing so developers see real values.

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === 'production';

// Patterns recognized as PII. Hashed before logging.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_RE = /^\+?\d{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// cyrb53 — fast, deterministic, non-cryptographic 64-bit hash.
// Edge-runtime safe (pure JS, no Node crypto). Returns 16-char hex.
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hi = (h2 >>> 0).toString(16).padStart(8, '0');
  const lo = (h1 >>> 0).toString(16).padStart(8, '0');
  return hi + lo;
}

function hashValue(v: string): string {
  // Prefix with `h:` so grep can tell at a glance a value is hashed.
  // Salt-free intentionally -- deterministic hashes so "same user across
  // events" correlates cleanly in log search.
  return 'h:' + cyrb53(v);
}

function scrubValue(key: string, value: unknown): unknown {
  if (!IS_PROD) return value;
  // Whitelisted: anything ending _last4 is already tokenized.
  if (typeof key === 'string' && key.endsWith('_last4')) return value;

  if (typeof value === 'string') {
    if (UUID_RE.test(value) || E164_RE.test(value) || EMAIL_RE.test(value)) {
      return hashValue(value);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => scrubValue(`${key}[${i}]`, v));
  }
  if (value && typeof value === 'object') {
    const out: LogContext = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubValue(k, v);
    }
    return out;
  }
  return value;
}

function scrubContext(ctx: LogContext): LogContext {
  if (!IS_PROD) return ctx;
  const out: LogContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = scrubValue(k, v);
  }
  return out;
}

function emit(level: LogLevel, event: string, ctx: LogContext = {}): void {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    ...scrubContext(ctx),
  };
  const line = safeStringify(record);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return value;
    });
  } catch {
    return JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'logger.serialize_failed' });
  }
}

export const log = {
  debug: (event: string, ctx?: LogContext) => emit('debug', event, ctx),
  info: (event: string, ctx?: LogContext) => emit('info', event, ctx),
  warn: (event: string, ctx?: LogContext) => emit('warn', event, ctx),
  error: (event: string, ctx?: LogContext) => emit('error', event, ctx),
};
