// Internal Sinch processor — passthrough worker that the public
// /api/webhooks/sms/sinch route dispatches to, then turns around and
// re-invokes the webhook in "internal" mode (x-internal-worker header)
// so the webhook can process the payload with its existing handlers.
//
// 2026-04-18 H-1: this route exists to split one Vercel invocation into
// two — the Sinch-facing one answers fast, this one does the slow work.
// Why two hops (Sinch → webhook → internal → webhook) instead of one?
// Next.js App Router rejects non-HTTP-method exports from route.ts files,
// so we can't export the handlers from the webhook file and import them
// here. A bounce back to the webhook with a special auth header keeps
// the implementation in a single place.
//
// Auth:
//   * This route validates x-worker-secret.
//   * The webhook re-entry validates x-worker-secret AND treats a matching
//     x-internal-worker: 1 header as proof that Sinch auth was already
//     verified on the first hop.

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { log } from '@/lib/logger';
import { getAppUrl } from '@/lib/url';

export const maxDuration = 300;
export const runtime = 'nodejs';

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Re-invoke the webhook in "internal" mode. The webhook will see the
// x-internal-worker header + matching secret, skip Sinch HMAC/XMS
// verification, and run handleInboundMessage/handleDeliveryReport
// inline with this lambda's 300 s maxDuration budget.
//
// 2026-07-02 AUDIT C2: runs under waitUntil AFTER this route has already
// returned 202 to the dispatching webhook. By the time this executes, the
// public webhook has answered Sinch with 200 — there is no upstream retry
// left. So this is the last line of defense: bounded retry + loud logging.
async function processReentry(rawBody: string, workerSecret: string): Promise<void> {
  const webhookUrl = `${getAppUrl()}/api/webhooks/sms/sinch`;
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-worker': '1',
          'x-worker-secret': workerSecret,
        },
        body: rawBody,
      });
      if (response.ok) return;
      log.error('sinch.worker.reentry_failed', {
        status: response.status,
        attempt,
        final: attempt === MAX_ATTEMPTS,
      });
    } catch (err) {
      log.error('sinch.worker.reentry_threw', {
        err: (err as Error).message ?? String(err),
        attempt,
        final: attempt === MAX_ATTEMPTS,
      });
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  // Both attempts failed. Message is NOT lost from the system: the inbound
  // row/session state is whatever handleInboundMessage left (or never
  // started), and the orphaned-sessions + grading-recovery crons sweep
  // stuck sessions. But the rep gets no immediate reply — page-worthy.
  log.error('sinch.worker.reentry_exhausted', { body_len: rawBody.length });
}

export async function POST(request: NextRequest) {
  const provided = request.headers.get('x-worker-secret');
  const expected = process.env.INTERNAL_WORKER_SECRET;

  if (!expected) {
    log.error('sinch.worker.misconfigured', { reason: 'INTERNAL_WORKER_SECRET unset' });
    return NextResponse.json({ error: 'worker unconfigured' }, { status: 500 });
  }
  if (!provided || !timingSafeStringEqual(provided, expected)) {
    log.warn('sinch.worker.auth_failed', {});
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rawBody = await request.text();

  // 2026-07-02 AUDIT C2: answer 202 immediately so the dispatching webhook
  // (which now AWAITS this response) can 200 Sinch within its 15 s window.
  // waitUntil keeps this lambda alive until processReentry settles — this is
  // the mechanism that makes fire-and-forget safe on Vercel; a bare promise
  // would be frozen along with the lambda the moment the 202 is returned.
  waitUntil(processReentry(rawBody, expected));
  return NextResponse.json({ status: 'accepted' }, { status: 202 });
}
