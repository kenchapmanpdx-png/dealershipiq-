// Sinch OAuth 2.0 + HMAC webhook verification
// Build Master: Phase 2A — OAuth token caching, HMAC-SHA256 verification
// Invariant: crypto.timingSafeEqual for all secret comparisons

import crypto from 'crypto';
import type { SinchOAuthToken } from '@/types/sinch';

// --- OAuth 2.0 Token Management ---

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

  // Reject timestamps older than 5 minutes (replay protection)
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    return false;
  }

  const signedData = `${rawBody}.${nonce}.${timestamp}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedData)
    .digest('base64');

  // Constant-time comparison (Build Master invariant)
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
