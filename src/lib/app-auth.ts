// Utility: Verify and decode HMAC-signed PWA session tokens.
// Extracted from app/api/app/auth/route.ts to avoid invalid Next.js route exports.

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify and decode HMAC-signed session token.
 * Returns user info if valid, null if signature fails or expired.
 */
export function verifyAppToken(token: string): {
  userId: string;
  dealershipId: string;
  firstName: string;
  language: string;
} | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { sig, ...payload } = decoded;

    // D2-M-002: Dedicated secret for coach tokens. No CRON_SECRET fallback.
    const secret = process.env.APP_TOKEN_SECRET;
    if (!secret) return null; // No secret configured = reject all tokens

    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    if (sig.length !== expected.length ||
        !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      console.warn('Invalid app token signature');
      return null;
    }

    // Check expiration — guard against missing/non-numeric expiresAt
    if (!payload.expiresAt || typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) {
      console.warn('App token expired or missing expiresAt');
      return null;
    }

    return {
      userId: payload.userId,
      dealershipId: payload.dealershipId,
      firstName: payload.firstName,
      language: payload.language,
    };
  } catch (err) {
    console.error('Failed to verify app token:', (err as Error).message ?? err);
    return null;
  }
}
