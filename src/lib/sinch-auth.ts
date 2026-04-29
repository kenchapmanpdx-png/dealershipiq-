// Sinch OAuth 2.0 + HMAC webhook verification
// Build Master: Phase 2A — OAuth token caching, HMAC-SHA256 verification
// Invariant: crypto.timingSafeEqual for all secret comparisons

import crypto from 'crypto';
import type { SinchOAuthToken } from '@/types/sinch';
import { log } from '@/lib/logger';

// --- OAuth 2.0 Token Management ---
//
// 2026-04-18 L-18 (TODO): `cachedToken` is module-scoped and therefore
// per-lambda. Every fresh Vercel instance makes its own OAuth round-trip
// on first send, and a cold-start spike against the Sinch auth endpoint
// could trip their rate limit. Upgrade path: move the token + expiry to
// Upstash (`sinch:oauth:token` with TTL = expires_in - 300s) so all
// instances share the same cache. Low priority — Sinch's documented rate
// limit on the auth endpoint is generous and cold-start SMS volume is
// bounded by subscription count.

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getSinchAccessToken(): Promise<string> {
  const now = Date.now();
  // Refresh 5 min before expiry
  if (cachedToken && cachedToken.expiresAt > now + 300_000) {
    return cachedToken.token;
  }

  const keyId = process.env.SINCH_KEY_ID;
  const keySecret = process.env.SINCH_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error('SINCH_KEY_ID and SINCH_KEY_SECRET must be set');
  }

  const res = await fetch('https://auth.sinch.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sinch OAuth failed: ${res.status} ${body}`);
  }

  const data: SinchOAuthToken = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return cachedToken.token;
}

// --- HMAC Webhook Verification ---
// Signed data format: ${rawBody}.${nonce}.${timestamp}
// Header: x-sinch-webhook-signature (Base64 HMAC-SHA256)

export function verifySinchWebhookSignature(
  rawBody: string,
  signature: string | null,
  nonce: string | null,
  timestamp: string | null
): boolean {
  const secret = process.env.SINCH_WEBHOOK_SECRET;
  if (!secret || !signature || !nonce || !timestamp) {
    return false;
  }

  // S12: Replay window tightened from 5 min → 60 s. Sinch delivers within
  // seconds; a 5-minute window gave attackers a wide reuse surface.
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 60) {
    return false;
  }

  const signedData = `${rawBody}.${nonce}.${timestamp}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedData)
    .digest('base64');

  // Constant-time comparison (Build Master invariant).
  //
  // 2026-04-18 L-22: Explicit 'base64' encoding on Buffer.from(). Both
  // `signature` (header value) and `expected` (.digest('base64')) are
  // base64-encoded strings — decoding them as base64 yields fixed-length
  // 32-byte buffers suitable for timingSafeEqual. The prior call used the
  // default utf-8 encoding, which happened to work because base64
  // characters are all single-byte ASCII, but the intent was unclear and
  // would quietly break if the header ever moved to hex encoding.
  let sigBuf: Buffer;
  let expBuf: Buffer;
  try {
    sigBuf = Buffer.from(signature, 'base64');
    expBuf = Buffer.from(expected, 'base64');
  } catch {
    return false;
  }
  if (sigBuf.length !== expBuf.length || sigBuf.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

// --- REST/XMS Webhook Authentication ---
//
// Sinch REST API (XMS) inbound webhooks do NOT carry HMAC headers, so we
// authenticate them with a shared secret. The S2 fix (2026-04-14) originally
// added this; M-18 (2026-04-18) split env-missing from token-mismatch logging;
// a regression between 2026-04-18 and 2026-04-28 removed both. This is the
// re-implementation.
//
// The secret may be delivered in any of (canonical first):
//   1. X-Sinch-Webhook-Token: <secret>         (canonical — set in Sinch UI)
//   2. Authorization: Bearer <secret>          (alt for proxies that strip)
//   3. ?secret=<value> query string            (fallback if header config blocked)
//
// FAIL-CLOSED: returns ok=false if the env var is unset OR if no matching
// credential is provided. Caller MUST still return 200 to Sinch — non-429
// 4xx responses permanently kill the callback.
//
// Constant-time SHA-256 comparison (matches cron-auth.ts pattern):
// hashing first defeats both timing attacks AND length-leak attacks.
//
// Operator setup (Vercel + Sinch dashboard):
//   1. SINCH_XMS_CALLBACK_TOKEN should already be set in Vercel (it was added
//      to bootcheck on 2026-04-14). Verify with: `vercel env ls`.
//      If missing: `openssl rand -hex 32` → set in preview + production.
//   2. In the Sinch dashboard, add header to the REST/XMS callback config:
//        X-Sinch-Webhook-Token: <value>
//      OR append `?secret=<value>` to the callback URL if Sinch's UI does
//      not allow custom headers in your plan.
export type RestWebhookAuthResult = {
  ok: boolean;
  reason?: 'env_missing' | 'no_credential' | 'mismatch';
};

export function verifySinchRestWebhookSecret(opts: {
  sinchTokenHeader: string | null;
  authorizationHeader: string | null;
  url: string;
}): RestWebhookAuthResult {
  const expected = process.env.SINCH_XMS_CALLBACK_TOKEN;
  if (!expected) {
    return { ok: false, reason: 'env_missing' };
  }

  // 1. X-Sinch-Webhook-Token (canonical)
  let provided: string | null = opts.sinchTokenHeader;
  // 2. Authorization: Bearer <secret>
  if (!provided) {
    const authHeader = opts.authorizationHeader;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      provided = authHeader.slice(7).trim();
    }
  }
  // 3. Query string ?secret=<value>
  if (!provided) {
    try {
      const url = new URL(opts.url);
      provided = url.searchParams.get('secret');
    } catch {
      // malformed URL — fall through to no_credential
    }
  }

  if (!provided) {
    return { ok: false, reason: 'no_credential' };
  }

  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  const providedHash = crypto.createHash('sha256').update(provided).digest();
  if (!crypto.timingSafeEqual(expectedHash, providedHash)) {
    return { ok: false, reason: 'mismatch' };
  }
  return { ok: true };
}

// --- Nonce Replay Protection ---
//
// S12: Best-effort nonce deduplication via Upstash. Returns true if the nonce
// has been seen before (reject the webhook) or false if this is the first time
// we've recorded it. Falls open (returns false) if Upstash is unavailable —
// the signature+timestamp check is the primary defense; nonce dedup is
// belt-and-braces against replay within the 60-second window.
//
// 2026-04-18 H-14: Emits structured events on every degraded path so a
// sustained Upstash outage is visible in logs. Previously this function was
// silent and a compromised HMAC signature could be replayed repeatedly
// during a Redis outage without leaving any trace. The signature +
// timestamp window are still the primary defenses; this is defense in depth.
//
// 2026-04-18 L-11: The `sinch.nonce_check_failed` event is the hook point
// for alerting — Vercel Log Drains should alert when event rate >5/min.
export async function isNonceReplayed(nonce: string): Promise<boolean> {
  if (!nonce) {
    log.warn('sinch.nonce_check_failed', { reason: 'empty_nonce' });
    return false;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    log.warn('sinch.nonce_check_failed', { reason: 'redis_missing' });
    return false;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({ url, token });
    const key = `sinch:nonce:${nonce}`;
    // SET key value NX EX 120 — only succeeds if the key doesn't exist.
    // TTL 120s > 60s replay window so recycled nonces are still caught.
    const result = await redis.set(key, '1', { nx: true, ex: 120 });
    if (result === null) {
      // null => key already existed => replay
      return true;
    }
    if (result !== 'OK') {
      // Unexpected response — treat as not-replayed (fail open) and log.
      log.warn('sinch.nonce_check_failed', { reason: 'unexpected_response', result: String(result) });
      return false;
    }
    return false;
  } catch (err) {
    log.error('sinch.nonce_check_failed', {
      reason: 'redis_error',
      error: (err as Error).message,
    });
    return false;
  }
}
