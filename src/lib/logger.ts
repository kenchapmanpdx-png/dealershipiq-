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
// recognizable PII patterns (UUIDs, E.164 phones, email) is hashed with a
// non-reversible sha256 prefix so logs can still be correlated (same value
// -> same hash) but the raw PII never lands in Sentry / Axiom / Vercel
// log drains. Keys whose name ends in `_last4` are whitelisted (known-safe
// tokenized form) and passed through verbatim.
//
// Dev/test envs bypass scrubbing so developers see real values.

import crypto from 'crypto';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const IS_PROD = process.env.NODE_ENV === 'production';

// Patterns recognized as PII. Hashed before logging.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const E164_RE = /^\+?\d{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashValue(v: string): string {
  // Prefix with `h:` so grep can tell at a glance a value is hashed.
  // Salt-free intentionally -- deterministic hashes so "same user across
  // events" correlates cleanly in log search.
  return 'h:' + crypto.createHash('sha256').update(v).digest('hex').slice(0, 16);
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
