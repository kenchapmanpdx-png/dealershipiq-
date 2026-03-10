// Cron endpoint security
// Build Master: Phase 2A.2 — verify CRON_SECRET Bearer token
// Invariant: crypto.timingSafeEqual for constant-time comparison

import crypto from 'crypto';
import { NextRequest } from 'next/server';

export function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);

  if (tokenBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(tokenBuf, secretBuf);
}
