// Sinch SMS webhook handler
// Supports BOTH:
//   1. Sinch REST API (XMS) inbound format  (type: "mo_text")
//   2. Sinch Conversation API inbound format (message.contact_message)
//
// Build Master: Phase 2A-2E + Phase 6 (Manager Quick-Create, Peer Challenge, Chain hooks)
// CRITICAL: Always return 200 OK. Never return 4xx — Sinch permanently
// kills callbacks on non-429 4xx responses.
// Processing runs synchronously before returning 200.
//
// Multi-exchange flow (3 exchanges per session):
//   step 0,1: Generate AI follow-up, keep session active
//   step 2:   Final grade, Never Naked feedback, complete session
//
// Phase 6 keywords (checked before state machine):
//   TRAIN: <text>  — Manager creates training scenario (manager/owner only)
//   NOW             — Manager confirms immediate push of pending scenario
//   CHALLENGE <name>— Start peer challenge
//   ACCEPT / PASS   — Accept or decline pending peer challenge
//   1/2/3           — Disambiguation number reply for peer challenge
//
// v7: GO keyword rewritten to use full training content pipeline
//     (adaptive weighting, vehicle data, persona moods, 30-scenario fallback pool)

// 2026-04-29: pin Node runtime — uses crypto.timingSafeEqual for the
// internal-worker bypass header check, plus indirect Node-only imports.
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { log } from '@/lib/logger';
import { verifySinchWebhookSignature, verifySinchRestWebhookSecret } from '@/lib/sinch-auth';
import { getAppUrl } from '@/lib/url';
import { sendSms, detectKeyword, helpResponse, isValidE164 } from '@/lib/sms';
import { gradeResponse, generateFollowUp, ERROR_SMS } from '@/lib/openai';
import { assertTransition, isFinalExchange } from '@/lib/state-machine';
import {
  getUserByPhone,
  getActiveSession,
  updateSessionStatus,
  updateSessionStep,
  insertTranscriptLog,
  checkOptOut,
  insertTrainingResult,
  getSessionTranscript,
  insertConsentRecord,
  updateUserStatus,
  isFeatureEnabled,
  createConversationSession,
  getScenarioBankEntry,
} from '@/lib/service-db';
import { serviceClient } from '@/lib/supabase/service';
import {
  parseScheduleKeyword,
  updateEmployeeSchedule,
} from '@/lib/schedule-awareness';
import {
  updatePriorityVectorAfterGrading,
} from '@/lib/adaptive-weighting';
import {
  generateScenarioFromManager,
  storeManagerScenario,
  getPendingNowConfirmation,
  markScenarioPushedNow,
  clearNowConfirmation,
} from '@/lib/manager-create/generate';
import {
  parseChallengeKeyword,
  findChallengeTarget,
  checkChallengeAvailability,
  createPeerChallenge,
  createDisambiguationChallenge,
  getPendingDisambiguation,
  resolveDisambiguation,
  getPendingChallengeForUser,
  acceptChallenge,
  declineChallenge,
  checkAndCompleteChallenge,
  buildPeerResultsSMS,
} from '@/lib/challenges/peer';
import {
  recordChainStepResult,
  buildChainCompletionSMS,
} from '@/lib/chains/lifecycle';
import { selectTrainingContent } from '@/lib/training-content';
import type { SinchInboundMessage, SinchDeliveryReport } from '@/types/sinch';
import type { StepResult } from '@/types/chains';
// 2026-04-29 C1: timing-safe string comparison for the internal-worker
// bypass header. Buffer.from + crypto.timingSafeEqual prevents timing-side-
// channel leaks of the secret length.
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// =============================================================================
// SCENARIO FALLBACK POOL (v7)
// 30 brand-agnostic scenarios — used when training content pipeline fails.
// When vehicle_data_enabled is on, the pipeline injects real specs automatically.
// =============================================================================
const SCENARIO_POOL: Record<string, string[]> = {
  roleplay: [
    "I found this same car listed for $2,000 less at the dealership across town. Why should I buy it here?",
    "I'm interested, but I just started looking today. I'm not buying anything for at least a month.",
    "My lease is up in 60 days. I want to know my options but I'm not in a rush.",
    "I love the car but my credit isn't great. What kind of rate am I looking at realistically?",
    "We drove this and the competitor last weekend. Honestly, the other one felt better. Change my mind.",
    "I'm buying for my teenage daughter. Safety is everything. Walk me through what makes this safe.",
    "My trade-in is worth $18K according to KBB. What are you going to give me?",
    "I want to buy today but I need to be at $400/month max. Can you make that work?",
    "I submitted a lead online three days ago and nobody called me back. Now I'm here. Impress me.",
    "I'm a repeat customer — bought my last two cars here. What kind of loyalty pricing can I get?",
  ],
  quiz: [
    "A customer asks: what's the difference between AWD and 4WD? Explain it so they actually understand.",
    "Name three features on your lot's best-selling vehicle that most customers don't know about.",
    "A customer says 'I heard EVs cost a fortune to maintain.' How do you respond with facts?",
    "What's the difference between MSRP, invoice price, and out-the-door price? Explain like I'm a first-time buyer.",
    "A customer asks about your CPO program. What's covered, what's not, and why should they care?",
    "What does gap insurance actually protect against? When would you recommend it and when would you skip it?",
    "Walk me through how a trade-in affects monthly payment. Use real numbers.",
    "A customer asks: 'Why is this one $5K more than the base model?' Sell the upgrade without sounding pushy.",
    "What's the towing capacity and payload matter for someone who hauls a boat on weekends?",
    "A first-time buyer asks about financing. Explain APR, term length, and total cost in plain English.",
  ],
  objection: [
    "I really like it, but I need to think about it and talk to my spouse first. Can you hold it for me?",
    "Your online price said $32K but now you're telling me the out-the-door is $37K. What's going on?",
    "I can get 1.9% APR at my credit union. Why would I finance through you?",
    "I'm not trading in my car. I'll sell it private party and get more for it.",
    "The reviews online say this model has transmission problems. Should I be worried?",
    "I want to buy but I'm waiting for the year-end deals. Can you match those prices now?",
    "My friend just bought the same car and says he got it for $3K less. Can you beat that?",
    "I don't want any add-ons, no extended warranty, no paint protection, nothing. Just the car.",
    "I like it but I'm upside down on my current loan by about $4,000. How do we handle that?",
    "Honestly, I came in for the sedan but now I'm thinking the SUV makes more sense. Help me decide.",
  ],
};

function getRandomScenario(mode: string): string {
  const pool = SCENARIO_POOL[mode] ?? SCENARIO_POOL.roleplay;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Idempotency: track processed message IDs (in-memory fast-path, DB-backed for persistence)
// C-002 audit fix: use database as source of truth, in-memory Set as cache
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // ─────────────────────────────────────────────────────────────────────
  // 2026-04-29 C1: Internal-worker bypass.
  // /api/internal/sinch-process re-invokes us with `x-internal-worker: 1`
  // + `x-worker-secret` after the public hop has already verified Sinch
  // auth. We trust that prior verification and skip the Sinch HMAC/XMS
  // checks below — we'd otherwise reject our own retry because internal
  // calls don't carry Sinch's signature headers.
  //
  // Fail-closed if the env var is missing in production: drop the request
  // silently (no 4xx — Sinch kills callbacks on persistent 4xx).
  // ─────────────────────────────────────────────────────────────────────
  const internalWorkerHeader = request.headers.get('x-internal-worker');
  const isInternalWorker = internalWorkerHeader === '1';
  if (isInternalWorker) {
    const expected = process.env.INTERNAL_WORKER_SECRET;
    if (!expected) {
      log.error('sinch.webhook.internal_worker_misconfigured', { env: 'INTERNAL_WORKER_SECRET' });
      return NextResponse.json({ status: 'ok' });
    }
    const provided = request.headers.get('x-worker-secret') ?? '';
    if (!timingSafeStringEqual(provided, expected)) {
      log.warn('sinch.webhook.internal_worker_auth_failed', {});
      return NextResponse.json({ status: 'ok' });
    }
    // Auth verified upstream — fall through to message routing without
    // re-running Sinch HMAC/XMS verification.
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    log.warn('sinch.webhook.json_parse_failed', { body_len: rawBody.length });
    return NextResponse.json({ status: 'ok' });
  }

  const parsed = payload as Record<string, unknown>;

  // =========================================================================
  // AUTH VERIFICATION — runs BEFORE any message processing
  // (skipped if internal-worker bypass authenticated above)
  // =========================================================================
  // Conversation API: HMAC signature headers present → verify them
  // REST API (XMS): No HMAC headers → validate `to` matches our number + E.164 phone
  const signature = request.headers.get('x-sinch-webhook-signature');
  const nonce = request.headers.get('x-sinch-webhook-signature-nonce');
  const timestamp = request.headers.get('x-sinch-webhook-signature-timestamp');
  const hasHmacHeaders = !!(signature && nonce && timestamp);

  const isRestApi = parsed.type === 'mo_text' || parsed.type === 'mo_binary'
    || parsed.type === 'recipient_delivery_report_sms' || parsed.type === 'delivery_report_sms';

  if (isInternalWorker) {
    // Auth already verified at top of handler — fall through to routing.
  } else if (hasHmacHeaders) {
    // Conversation API path: verify HMAC signature
    if (!verifySinchWebhookSignature(rawBody, signature, nonce, timestamp)) {
      log.error('sinch.webhook.hmac_verify_failed', {});
      return NextResponse.json({ status: 'ok' });
    }
  } else if (isRestApi) {
    // REST API (XMS) path: shared-secret auth + `to`-number sanity check.
    //
    // 2026-04-28 SECURITY (re-applies S2 + M-18, regressed since 2026-04-18):
    // Sinch REST/XMS webhooks carry no HMAC headers, so a `to`-number check
    // alone is NOT authentication (the toll-free number is public). Anyone
    // who discovered the webhook URL could forge inbound SMS payloads.
    // We require SINCH_XMS_CALLBACK_TOKEN in one of:
    //   - X-Sinch-Webhook-Token: <secret>      (canonical)
    //   - Authorization: Bearer <secret>       (alt)
    //   - ?secret=<value> query string         (fallback)
    //
    // FAIL-CLOSED on all auth failures. Always return 200 to Sinch — non-429
    // 4xx responses permanently kill callbacks.
    const restAuth = verifySinchRestWebhookSecret({
      sinchTokenHeader: request.headers.get('x-sinch-webhook-token'),
      authorizationHeader: request.headers.get('authorization'),
      url: request.url,
    });
    if (!restAuth.ok) {
      // M-18 (2026-04-18): split env-missing from token-missing/mismatch so
      // Sentry surfaces missing config as a loud ERROR (page-worthy) rather
      // than burying it in the same warn used for spoof attempts.
      if (restAuth.reason === 'env_missing') {
        log.error('sinch.webhook.env_missing', { env: 'SINCH_XMS_CALLBACK_TOKEN' });
      } else if (restAuth.reason === 'no_credential') {
        log.warn('sinch.webhook.rest_token_missing', {});
      } else {
        log.warn('sinch.webhook.rest_token_mismatch', {});
      }
      return NextResponse.json({ status: 'ok' });
    }

    // Belt-and-braces: also validate `to` matches our configured number.
    // M-18 (2026-04-18): split the "env missing" path from the "mismatch" path
    // so Sentry surfaces missing config as a loud error (page-worthy) rather
    // than silently returning 200 under the same mismatch log, which looks
    // like a spoof attempt. Missing SINCH_PHONE_NUMBER means NO REST webhook
    // can authenticate — it is a deploy/config regression, not an attack.
    const rawEnv = process.env.SINCH_PHONE_NUMBER;
    if (!rawEnv) {
      log.error('sinch.webhook.env_missing', { env: 'SINCH_PHONE_NUMBER' });
      return NextResponse.json({ status: 'ok' });
    }
    const toNumber = parsed.to as string | undefined;
    const ourNumber = rawEnv.replace(/^\+/, '');
    if (!toNumber || toNumber.replace(/^\+/, '') !== ourNumber) {
      log.warn('sinch.webhook.to_mismatch', {
        to_last4: (toNumber ?? '').slice(-4),
        expected_last4: ourNumber.slice(-4),
      });
      return NextResponse.json({ status: 'ok' });
    }
  } else {
    // Unknown format with no HMAC headers — reject
    log.warn('sinch.webhook.unknown_format', { type: (parsed.type as string) ?? 'unknown' });
    return NextResponse.json({ status: 'ok' });
  }

  // =========================================================================
  // MESSAGE ROUTING — auth verified above
  // =========================================================================
  //
  // 2026-04-29 C3: Optional off-thread dispatch.
  // External Sinch traffic only (skip if we're already the internal worker).
  // Gated on INTERNAL_WORKER_SECRET + SINCH_OFF_THREAD_ENABLED=true so flipping
  // architectures requires an explicit env-var change, not a code deploy.
  //
  // Sinch retries at 15s if we don't 200 in time. handleInboundMessage runs
  // OpenAI grading which can take 30s+. Dispatching off-thread to
  // /api/internal/sinch-process (300s budget) eliminates the retry-storm risk.
  //
  // Fire-and-forget: we don't await the dispatch; the internal route runs
  // independently. If the dispatch fetch errors before lambda death, we log
  // and Sinch will retry (idempotency in handleInboundMessage handles dupes).
  if (
    !isInternalWorker
    && process.env.SINCH_OFF_THREAD_ENABLED === 'true'
    && process.env.INTERNAL_WORKER_SECRET
  ) {
    const workerSecret = process.env.INTERNAL_WORKER_SECRET;
    const internalUrl = `${getAppUrl()}/api/internal/sinch-process`;
    void fetch(internalUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': workerSecret,
      },
      body: rawBody,
    }).catch((err: unknown) => {
      log.error('sinch.webhook.off_thread_dispatch_failed', {
        err: (err as Error).message ?? String(err),
      });
    });
    return NextResponse.json({ status: 'ok' });
  }

  // --- REST API (XMS) inbound format ---
  // Sinch REST API sends { type: "mo_text", id, from, to, body, ... }
  if (parsed.type === 'mo_text' || parsed.type === 'mo_binary') {
    console.log('[webhook] REST API inbound detected');
    const fromPhone = parsed.from as string;
    // M-14 (2026-04-18): normalize formatted phones (e.g. "(503) 555-0123",
    // "503-555-0123", "+1 503 555 0123") into E.164. Sinch REST API has been
    // observed delivering "from" values in carrier-local formats that fail
    // the naive `+` prefix check below and get dropped silently.
    const { tryNormalizePhone } = await import('@/lib/phone');
    const phone = tryNormalizePhone(fromPhone) ?? '';
    const messageId = parsed.id as string;
    const body = (parsed.body as string) ?? '';

    // Validate E.164 phone format
    if (!phone || !isValidE164(phone)) {
      console.warn(`[SECURITY] Invalid E.164 phone in REST API webhook: ***${(fromPhone ?? '').slice(-4)}`);
      return NextResponse.json({ status: 'ok' });
    }

    // Wrap in Conversation API shape so existing handler works unchanged
    const normalized: SinchInboundMessage = {
      app_id: process.env.SINCH_APP_ID ?? '',
      accepted_time: new Date().toISOString(),
      event_time: new Date().toISOString(),
      project_id: process.env.SINCH_PROJECT_ID ?? '',
      message: {
        id: messageId,
        direction: 'TO_APP',
        channel_identity: {
          channel: 'SMS',
          identity: phone,
          app_id: process.env.SINCH_APP_ID ?? '',
        },
        contact_message: {
          text_message: { text: body },
        },
      },
    } as SinchInboundMessage;

    try {
      await handleInboundMessage(normalized);
    } catch (err) {
      console.error('REST API webhook processing error:', (err as Error).message ?? err);
    }
    return NextResponse.json({ status: 'ok' });
  }

  // --- REST API delivery report format ---
  if (parsed.type === 'recipient_delivery_report_sms' || parsed.type === 'delivery_report_sms') {
    console.log('[webhook] REST API delivery report - skipping');
    return NextResponse.json({ status: 'ok' });
  }

  // --- Conversation API inbound message format ---
  // Detected by presence of message.contact_message (inbound from user)
  const convMessage = (parsed as Record<string, unknown>).message as Record<string, unknown> | undefined;
  if (convMessage?.contact_message) {
    console.log('[webhook] Conversation API inbound detected');
    // Normalize phone number: ConvAPI sends without +, DB stores with +
    const chanId = (convMessage.channel_identity as Record<string, unknown> | undefined);
    if (chanId?.identity) {
      const rawPhone = chanId.identity as string;
      const normalizedPhone = rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`;
      // Validate E.164 phone format
      if (!isValidE164(normalizedPhone)) {
        console.warn(`[SECURITY] Invalid E.164 phone in ConvAPI webhook: ***${normalizedPhone.slice(-4)}`);
        return NextResponse.json({ status: 'ok' });
      }
      chanId.identity = normalizedPhone;
    }
    try {
      await handleInboundMessage(payload as unknown as SinchInboundMessage);
    } catch (err) {
      console.error('ConvAPI webhook processing error:', (err as Error).message ?? err);
    }
    return NextResponse.json({ status: 'ok' });
  }

  // --- Conversation API delivery report format ---
  if ((parsed as Record<string, unknown>).message_delivery_report) {
    console.log('[webhook] Conversation API delivery report');
    try {
      await handleDeliveryReport(payload as unknown as SinchDeliveryReport);
    } catch (err) {
      console.error('ConvAPI delivery report error:', (err as Error).message ?? err);
    }
    return NextResponse.json({ status: 'ok' });
  }

  // If we reach here with valid HMAC, it's an unrecognized format
  console.warn('[webhook] Unrecognized webhook payload format (HMAC valid)');
  return NextResponse.json({ status: 'ok' });
}

// --- Delivery Report Handler ---
async function handleDeliveryReport(report: SinchDeliveryReport) {
  const { status, channel_identity, message_id } = report.message_delivery_report;
  if (status !== 'DELIVERED' && status !== 'FAILED') return;

  const phone = channel_identity.identity;
  const user = await getUserByPhone(phone);
  if (!user) return;

  // F1-M-001: Use 'delivery_report' direction to avoid inflating outbound message cap counts
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'delivery_report',
    messageBody: `[DELIVERY_REPORT: ${status}]`,
    sinchMessageId: message_id,
    metadata: { status, reportTime: report.event_time },
  });
}

// --- Inbound Message Handler ---
async function handleInboundMessage(payload: SinchInboundMessage) {
  const messageId = payload.message.id;

  // Idempotency fast-path: in-memory cache (no DB round-trip for known duplicates)
  if (processedMessages.has(messageId)) return;

  const phone = payload.message.channel_identity.identity;
  const text = payload.message.contact_message?.text_message?.text ?? '';

  if (!text.trim()) return;

  const user = await getUserByPhone(phone);
  if (!user) {
    console.warn(`Inbound SMS from unknown phone: ***${phone.slice(-4)}`);
    return;
  }

  // HELP keyword is read-only (just sends a response) — no lock or idempotency needed
  const trimmedText = text.trim();
  const trimmedUpper = trimmedText.toUpperCase();

  if (trimmedUpper === 'HELP' || trimmedUpper === 'INFO' || trimmedUpper === 'AYUDA') {
    const helpMsg = helpResponse(user.dealershipName);
    await sendSms(phone, helpMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: helpMsg,
    });
    return;
  }

  // --- Advisory Lock: acquired BEFORE idempotency check (C-002 fix) ---
  // This ensures the idempotency check + processing is atomic per-user.
  // Without this ordering, two concurrent webhooks for the same message
  // could both pass the DB check before either inserts.
  const { tryLockUser, unlockUser } = await import('@/lib/service-db');
  const locked = await tryLockUser(phone);
  if (!locked) return;

  try {
    // Idempotency check (C-002 audit fix: database-backed, inside advisory lock)
    // DB UNIQUE constraint on sinch_message_id is the ultimate safety net,
    // but checking first avoids wasted processing.
    const { data: existing } = await serviceClient
      .from('sms_transcript_log')
      .select('id')
      .eq('sinch_message_id', messageId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Message already processed — add to cache and return
      processedMessages.add(messageId);
      return;
    }

    // M-020: Mark as processed with hard cap enforcement (evict oldest half when full)
    processedMessages.add(messageId);
    if (processedMessages.size > MAX_PROCESSED_CACHE) {
      const entries = Array.from(processedMessages);
      const evictCount = Math.floor(entries.length / 2);
      for (let i = 0; i < evictCount; i++) processedMessages.delete(entries[i]);
    }

    // Look up active session BEFORE logging inbound, so we can tag the transcript row
    const activeSession = await getActiveSession(user.id, user.dealershipId);
    const hasActiveSession = !!activeSession && activeSession.status === 'active';

    // Log inbound message with session_id (UNIQUE constraint on sinch_message_id catches any remaining races)
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'inbound',
      messageBody: text,
      sinchMessageId: messageId,
      sessionId: activeSession?.id,
    });

    // ==========================================================================
    // KEYWORD PRIORITY ORDER (C-004 audit fix)
    // ==========================================================================
    // 1. STOP/END/UNSUBSCRIBE/CANCEL/QUIT (opt-out) — intercepted by Sinch
    // 2. HELP — CTIA compliance (handled above, outside lock)
    // 3. PARAR/CANCELAR — Spanish opt-out
    // 4. START — re-subscribe
    // 5. Consent handling (YES/NO for pending_consent users)
    // 6. COACH
    // 7. DETAILS (manager only)
    // 8. OFF/VACATION (schedule)
    // 9. TRAIN: (manager only)
    // 10. NOW (manager only)
    // 11. CHALLENGE
    // 12. ACCEPT/PASS
    // 13. Disambiguation numbers
    // 14. GO — on-demand training session
    // 15. Everything else → state machine
    // ==========================================================================

    // Check opt-out status (DB-level opt-out)
    const isOptedOut = await checkOptOut(phone, user.dealershipId);
    if (isOptedOut) return;

    // 3. PARAR/CANCELAR (Spanish opt-out)
    if (trimmedUpper === 'PARAR' || trimmedUpper === 'CANCELAR') {
      await handleNaturalOptOut(user, phone);
      return;
    }

    // 4. START — re-subscribe (exact match)
    if (trimmedUpper === 'START' || trimmedUpper === 'YES' || trimmedUpper === 'UNSTOP') {
      await handleResubscribe(user, phone);
      return;
    }

    // 5. Consent handling for pending_consent users
    if (user.status === 'pending_consent') {
      await handlePendingConsent(user, phone, text);
      return;
    }

    // 6. COACH keyword
    if (trimmedUpper === 'COACH') {
      const coachEnabled = await isFeatureEnabled(user.dealershipId, 'coach_mode_enabled');
      if (!coachEnabled) {
        await sendSms(phone, "Coach Mode isn't available yet. Stay tuned!");
      } else {
        const baseUrl = getAppUrl();
        const slug = user.dealershipId;
        await sendSms(
          phone,
          `DealershipIQ Coach is ready. Tap to start: ${baseUrl}/app/${slug}/coach`
        );
      }
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: 'COACH keyword response',
      });
      return;
    }

    // 7. DETAILS keyword (manager only — morning meeting script)
    if (trimmedUpper === 'DETAILS') {
      await handleDetailsKeyword(user, phone);
      return;
    }

    // 8. OFF/VACATION (schedule keywords)
    const scheduleResult = parseScheduleKeyword(text);
    if (scheduleResult.success) {
      try {
        await updateEmployeeSchedule(user.id, user.dealershipId, scheduleResult.data ?? {});
        await sendSms(phone, scheduleResult.message ?? 'Schedule updated.');
        await insertTranscriptLog({
          userId: user.id,
          dealershipId: user.dealershipId,
          phone,
          direction: 'outbound',
          messageBody: scheduleResult.message ?? 'Schedule updated.',
        });
      } catch (scheduleErr) {
        console.error('Schedule update failed:', (scheduleErr as Error).message ?? scheduleErr);
        await sendSms(phone, 'Could not update schedule. Please try again.');
      }
      return;
    }
    // 9. TRAIN: keyword (manager/owner only)
    if (trimmedUpper.startsWith('TRAIN:')) {
      await handleTrainKeyword(user, phone, trimmedText);
      return;
    }

    // 10. NOW keyword (manager/owner pending confirmation)
    if (trimmedUpper === 'NOW') {
      const handled = await handleNowKeyword(user, phone);
      if (handled) return;
      // If no pending scenario and user is manager/owner, send feedback
      if (['manager', 'owner'].includes(user.role)) {
        await sendSms(phone, 'No pending scenario to push. Use TRAIN: to create one first.');
        await insertTranscriptLog({
          userId: user.id,
          dealershipId: user.dealershipId,
          phone,
          direction: 'outbound',
          messageBody: 'NOW with no pending scenario.',
        });
        return;
      }
      // If not a manager, fall through to state machine
    }

    // 11. CHALLENGE keyword
    const challengeName = parseChallengeKeyword(trimmedText);
    if (challengeName) {
      await handleChallengeKeyword(user, phone, challengeName);
      return;
    }

    // 12. ACCEPT / PASS keywords (peer challenge)
    if (trimmedUpper === 'ACCEPT') {
      const handled = await handleAcceptKeyword(user, phone);
      if (handled) return;
    }
    if (trimmedUpper === 'PASS') {
      const handled = await handlePassKeyword(user, phone);
      if (handled) return;
    }

    // 13. Disambiguation number reply (1-9)
    if (/^[1-9]$/.test(trimmedText)) {
      const handled = await handleDisambiguationReply(user, phone, parseInt(trimmedText, 10));
      if (handled) return;
    }

    // 14. GO keyword — trigger a new training session on demand (v7: full content pipeline)
    if (trimmedUpper === 'GO') {
      await handleGoKeyword(user, phone);
      return;
    }


    // Natural language keyword detection (only for non-training contexts)
    // This must happen AFTER all phase 6 keywords to avoid interference
    const keyword = detectKeyword(text, hasActiveSession);
    if (keyword === 'opt_out') {
      await handleNaturalOptOut(user, phone);
      return;
    }
    if (keyword === 'start') {
      await handleResubscribe(user, phone);
      return;
    }

    // --- Route to State Machine ---
    const session = activeSession;

    if (!session) {
      await sendSms(phone, "No active training session right now. Your next question will arrive at the scheduled time!");
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: 'No active training session right now. Your next question will arrive at the scheduled time!',
      });
      return;
    }

    if (session.status === 'grading') {
      await sendSms(phone, "Still processing your last response - hang tight!");
      return;
    }

    if (session.status !== 'active') {
      return;
    }

    // --- Multi-Exchange Logic ---
    const mode = session.mode as 'roleplay' | 'quiz' | 'objection';
    const stepIndex = session.stepIndex;

    if (isFinalExchange(stepIndex)) {
      await handleFinalExchange(session, user, phone, text, mode);
    } else {
      await handleMidExchange(session, user, phone, text, mode, stepIndex);
    }
  } catch (err) {
    console.error('State machine error:', (err as Error).message ?? err);
  } finally {
    // F1-H-001: Explicitly release session-scoped advisory lock after all processing.
    await unlockUser(phone);
  }
}

// =============================================================================
// Phase 6 Keyword Handlers
// =============================================================================

// --- TRAIN: keyword handler (manager creates scenario) ---
async function handleTrainKeyword(
  user: { id: string; dealershipId: string; dealershipName: string; role: string },
  phone: string,
  text: string
) {
  // Manager/owner check (H-004 audit fix)
  if (!['manager', 'owner'].includes(user.role)) {
    await sendSms(phone, 'TRAIN: is available for managers only.');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'TRAIN: denied — non-manager user.',
    });
    return;
  }

  const featureEnabled = await isFeatureEnabled(user.dealershipId, 'manager_quick_create_enabled');
  if (!featureEnabled) {
    await sendSms(phone, 'Quick-Create is not enabled for your dealership yet.');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'Quick-Create is not enabled for your dealership yet.',
    });
    return;
  }

  // Clear any existing pending NOW confirmation
  const existingPending = await getPendingNowConfirmation(user.id);
  if (existingPending) {
    await clearNowConfirmation(existingPending.id);
  }

  // Strip TRAIN: prefix + sanitize (S-008: prompt injection defense)
  let managerInput = text.replace(/^TRAIN:\s*/i, '').trim();
  managerInput = managerInput
    .replace(/system:|instruction:|ignore |override |assistant:/gi, '')
    .slice(0, 500);
  if (managerInput.length < 5) {
    await sendSms(phone, 'Describe the situation after TRAIN: (e.g., "TRAIN: customer wants to trade in a 2019 Civic with high mileage")');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'TRAIN: input too short — prompted for more detail.',
    });
    return;
  }

  try {
    // Generate scenario via GPT
    const scenario = await generateScenarioFromManager(managerInput);

    // Store with NOW confirmation pending
    const scenarioId = await storeManagerScenario({
      dealershipId: user.dealershipId,
      createdBy: user.id,
      managerInput,
      scenario,
    });

    // Confirm to manager with preview
    const preview = `Got it. Here's what your team will see:\n\n"${scenario.scenario_text.slice(0, 200)}"\n\nReply NOW to push it to your team immediately, or it'll go out at the next training time.`;
    await sendSms(phone, preview);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: preview,
      metadata: { type: 'manager_scenario_preview', scenarioId },
    });
  } catch (err) {
    console.error('TRAIN: scenario generation failed:', (err as Error).message ?? err);
    await sendSms(phone, 'Could not generate that scenario. Try again with a clearer description.');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'TRAIN: generation error.',
    });
  }
}

// --- NOW keyword handler (manager confirms immediate push) ---
async function handleNowKeyword(
  user: { id: string; dealershipId: string; role: string },
  phone: string
): Promise<boolean> {
  if (!['manager', 'owner'].includes(user.role)) return false;

  const pending = await getPendingNowConfirmation(user.id);
  if (!pending) return false;

  try {
    // X-003: Atomic CAS — skip if training cron already pushed this scenario
    const claimed = await markScenarioPushedNow(pending.id);
    if (!claimed) {
      await sendSms(phone, 'That scenario was already sent by the training system.');
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: 'NOW: scenario already pushed.',
      });
      return true;
    }

    // Push scenario to all eligible reps now
    const { getEligibleUsers, getOutboundCountToday } = await import('@/lib/service-db');
    // Look up dealership timezone for cap check + eligible user filtering
    const scTz = serviceClient;
    const { data: dlrData } = await scTz.from('dealerships').select('timezone').eq('id', user.dealershipId).single();
    const dlrTimezone = (dlrData?.timezone as string) || 'America/New_York';
    const eligible = await getEligibleUsers(user.dealershipId, dlrTimezone);
    let pushed = 0;

    for (const rep of eligible) {
      try {
        // X-009: Check message cap before pushing to each rep
        const outboundCount = await getOutboundCountToday(rep.id, dlrTimezone);
        if (outboundCount >= 3) continue;

        // Create session for each rep
        const session = await createConversationSession({
          userId: rep.id,
          dealershipId: user.dealershipId,
          mode: 'roleplay',
          questionText: pending.scenarioText,
        });

        const firstName = rep.full_name ? rep.full_name.split(/\s+/)[0] : '';
        const greeting = firstName ? `Hey ${firstName}, ` : '';
        const fullMsg = `${greeting}${pending.scenarioText}`;

        const smsRes = await sendSms(rep.phone, fullMsg);
        await updateSessionStatus(session.id, user.dealershipId, 'active');
        await insertTranscriptLog({
          userId: rep.id,
          dealershipId: user.dealershipId,
          phone: rep.phone,
          direction: 'outbound',
          messageBody: fullMsg,
          sinchMessageId: smsRes.message_id,
          sessionId: session.id,
        });
        pushed++;
        await new Promise(r => setTimeout(r, 50));
      } catch (repErr) {
        console.error(`NOW push failed for ${rep.id}:`, (repErr as Error).message ?? repErr);
      }
    }

    await sendSms(phone, `Sent to ${pushed} rep${pushed !== 1 ? 's' : ''}. Responses will be graded automatically.`);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: `NOW confirmed — pushed to ${pushed} reps.`,
    });
    return true;
  } catch (err) {
    console.error('NOW push failed:', (err as Error).message ?? err);
    await sendSms(phone, 'Something went wrong pushing that scenario. Try again.');
    return true;
  }
}

// --- CHALLENGE keyword handler ---
async function handleChallengeKeyword(
  user: { id: string; dealershipId: string; fullName: string },
  phone: string,
  targetName: string
) {
  const featureEnabled = await isFeatureEnabled(user.dealershipId, 'peer_challenge_enabled');
  if (!featureEnabled) {
    await sendSms(phone, 'Peer challenges are not enabled yet. Stay tuned!');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'Peer challenge not enabled.',
    });
    return;
  }

  try {
    const { users } = await findChallengeTarget(targetName, user.dealershipId, user.id);

    if (users.length === 0) {
      await sendSms(phone, `No one named "${targetName}" found on your team. Check spelling and try again.`);
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: `CHALLENGE: no match for "${targetName}".`,
      });
      return;
    }

    if (users.length === 1) {
      // Single match — check availability and create
      const target = users[0];
      const unavailableReason = await checkChallengeAvailability(target.id, user.id, user.dealershipId);
      if (unavailableReason) {
        await sendSms(phone, `Can't challenge ${target.fullName.split(/\s+/)[0]}: ${unavailableReason}`);
        await insertTranscriptLog({
          userId: user.id,
          dealershipId: user.dealershipId,
          phone,
          direction: 'outbound',
          messageBody: `CHALLENGE: unavailable — ${unavailableReason}`,
        });
        return;
      }

      const challengeId = await createPeerChallenge(user.id, target.id, user.dealershipId);

      // Notify challenger
      await sendSms(phone, `Challenge sent to ${target.fullName.split(/\s+/)[0]}. They have 4 hours to accept.`);
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: `CHALLENGE: sent to ${target.fullName.split(/\s+/)[0]}.`,
        metadata: { type: 'peer_challenge_created', challengeId },
      });

      // Notify challenged
      const challengerFirst = user.fullName ? user.fullName.split(/\s+/)[0] : 'Someone';
      const sc = serviceClient;
      const { data: targetUser } = await sc.from('users').select('phone').eq('id', target.id).single();
      if (targetUser?.phone) {
        const notifyMsg = `${challengerFirst} challenged you! Reply ACCEPT to compete or PASS to skip.`;
        try {
          // M-3: proactive ping -- must respect recipient quiet hours.
          await sendSms(targetUser.phone as string, notifyMsg, undefined, { proactive: true });
        } catch (err) {
          const { SmsQuietHoursError } = await import('@/lib/sms');
          if (err instanceof SmsQuietHoursError) {
            log.info('sinch.peer_challenge.quiet_hours_deferred', {
              challenger_user_id: user.id,
              target_user_id: target.id,
            });
            return;
          }
          throw err;
        }
        await insertTranscriptLog({
          userId: target.id,
          dealershipId: user.dealershipId,
          phone: targetUser.phone as string,
          direction: 'outbound',
          messageBody: notifyMsg,
          metadata: { type: 'peer_challenge_notification', challengeId },
        });
      }
      return;
    }

    // Multiple matches — disambiguate
    const options = users.slice(0, 4).map((u, i) => ({
      option: i + 1,
      user_id: u.id,
      display: u.fullName,
    }));

    await createDisambiguationChallenge(user.id, user.dealershipId, options);

    const optionLines = options.map(o => `${o.option}. ${o.display}`).join('\n');
    const disambMsg = `Which one?\n${optionLines}\nReply with the number.`;
    await sendSms(phone, disambMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: disambMsg,
    });
  } catch (err) {
    console.error('CHALLENGE handler error:', (err as Error).message ?? err);
    await sendSms(phone, 'Something went wrong. Try again.');
  }
}

// --- Disambiguation number reply handler ---
async function handleDisambiguationReply(
  user: { id: string; dealershipId: string; fullName: string },
  phone: string,
  number: number
): Promise<boolean> {
  const pending = await getPendingDisambiguation(user.id);
  if (!pending) return false;

  const selected = pending.options.find(o => o.option === number);
  if (!selected) {
    await sendSms(phone, `Invalid choice. Reply with a number 1-${pending.options.length}.`);
    return true;
  }

  try {
    // Check availability
    const unavailableReason = await checkChallengeAvailability(selected.user_id, user.id, user.dealershipId);
    if (unavailableReason) {
      await sendSms(phone, `Can't challenge ${selected.display.split(/\s+/)[0]}: ${unavailableReason}`);
      return true;
    }

    await resolveDisambiguation(pending.id, selected.user_id);

    // Notify challenger
    await sendSms(phone, `Challenge sent to ${selected.display.split(/\s+/)[0]}. They have 4 hours to accept.`);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: `CHALLENGE disambiguated: sent to ${selected.display.split(/\s+/)[0]}.`,
    });

    // Notify challenged
    const sc = serviceClient;
    const { data: targetUser } = await sc.from('users').select('phone').eq('id', selected.user_id).single();
    if (targetUser?.phone) {
      const challengerFirst = user.fullName ? user.fullName.split(/\s+/)[0] : 'Someone';
      const notifyMsg = `${challengerFirst} challenged you! Reply ACCEPT to compete or PASS to skip.`;
      try {
        // M-3: proactive ping -- must respect recipient quiet hours.
        await sendSms(targetUser.phone as string, notifyMsg, undefined, { proactive: true });
      } catch (err) {
        const { SmsQuietHoursError } = await import('@/lib/sms');
        if (err instanceof SmsQuietHoursError) {
          log.info('sinch.peer_challenge.quiet_hours_deferred', {
            challenger_user_id: user.id,
            target_user_id: selected.user_id,
          });
          return true;
        }
        throw err;
      }
      await insertTranscriptLog({
        userId: selected.user_id,
        dealershipId: user.dealershipId,
        phone: targetUser.phone as string,
        direction: 'outbound',
        messageBody: notifyMsg,
        metadata: { type: 'peer_challenge_notification', challengeId: pending.id },
      });
    }
    return true;
  } catch (err) {
    console.error('Disambiguation resolve error:', (err as Error).message ?? err);
    await sendSms(phone, 'Something went wrong. Try CHALLENGE again.');
    return true;
  }
}

// --- ACCEPT keyword handler ---
async function handleAcceptKeyword(
  user: { id: string; dealershipId: string; fullName: string },
  phone: string
): Promise<boolean> {
  // X-011: Check feature flag — challenge may have been disabled after initial CHALLENGE keyword
  const peerEnabled = await isFeatureEnabled(user.dealershipId, 'peer_challenge_enabled');
  if (!peerEnabled) {
    await sendSms(phone, 'Peer challenges are not currently enabled.');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'ACCEPT: peer challenges disabled.',
    });
    return true;
  }

  const pendingChallenge = await getPendingChallengeForUser(user.id);
  if (!pendingChallenge) return false;

  try {
    const { scenarioText, taxonomyDomain } = await acceptChallenge(
      pendingChallenge.id,
      pendingChallenge.challengerId,
      user.id,
      user.dealershipId
    );

    // Create sessions for both challenger and challenged
    const challengerSession = await createConversationSession({
      userId: pendingChallenge.challengerId,
      dealershipId: user.dealershipId,
      mode: 'roleplay',
      questionText: scenarioText,
      trainingDomain: taxonomyDomain,
    });

    const challengedSession = await createConversationSession({
      userId: user.id,
      dealershipId: user.dealershipId,
      mode: 'roleplay',
      questionText: scenarioText,
      trainingDomain: taxonomyDomain,
    });

    // Update peer challenge with session IDs
    const sc = serviceClient;
    await sc.from('peer_challenges').update({
      challenger_session_id: challengerSession.id,
      challenged_session_id: challengedSession.id,
    }).eq('id', pendingChallenge.id);

    await updateSessionStatus(challengerSession.id, user.dealershipId, 'active');
    await updateSessionStatus(challengedSession.id, user.dealershipId, 'active');

    // Send scenario to both
    const challengedFirst = user.fullName ? user.fullName.split(/\s+/)[0] : 'your opponent';

    // Notify challenger
    const { data: challengerUser } = await sc.from('users').select('phone, full_name').eq('id', pendingChallenge.challengerId).single();
    if (challengerUser?.phone) {
      const challengerFirst = challengerUser.full_name ? (challengerUser.full_name as string).split(/\s+/)[0] : '';
      const challengerGreeting = challengerFirst ? `${challengerFirst}, ` : '';
      const challengerMsg = `${challengerGreeting}${challengedFirst} accepted! Here's your challenge:\n\n${scenarioText}`;
      await sendSms(challengerUser.phone as string, challengerMsg);
      await insertTranscriptLog({
        userId: pendingChallenge.challengerId,
        dealershipId: user.dealershipId,
        phone: challengerUser.phone as string,
        direction: 'outbound',
        messageBody: challengerMsg,
        sessionId: challengerSession.id,
      });
    }

    // Send to challenged (current user)
    const userFirst = user.fullName ? user.fullName.split(/\s+/)[0] : '';
    const userGreeting = userFirst ? `${userFirst}, ` : '';
    const challengedMsg = `${userGreeting}challenge accepted! Here's your scenario:\n\n${scenarioText}`;
    await sendSms(phone, challengedMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: challengedMsg,
      sessionId: challengedSession.id,
    });

    return true;
  } catch (err) {
    console.error('ACCEPT handler error:', (err as Error).message ?? err);
    await sendSms(phone, 'Something went wrong accepting the challenge. Try again.');
    return true;
  }
}

// --- PASS keyword handler ---
async function handlePassKeyword(
  user: { id: string; dealershipId: string },
  phone: string
): Promise<boolean> {
  const pendingChallenge = await getPendingChallengeForUser(user.id);
  if (!pendingChallenge) return false;

  try {
    await declineChallenge(pendingChallenge.id);

    await sendSms(phone, 'No worries. Challenge declined.');
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: 'Peer challenge declined.',
    });

    // Notify challenger
    const sc = serviceClient;
    const { data: challengerUser } = await sc.from('users').select('phone, full_name').eq('id', pendingChallenge.challengerId).single();
    const { data: declinedUser } = await sc.from('users').select('full_name').eq('id', user.id).single();
    const declinedFirst = declinedUser?.full_name ? (declinedUser.full_name as string).split(/\s+/)[0] : 'Your opponent';

    if (challengerUser?.phone) {
      const notifyMsg = `${declinedFirst} passed on the challenge. Try someone else!`;
      await sendSms(challengerUser.phone as string, notifyMsg);
      await insertTranscriptLog({
        userId: pendingChallenge.challengerId,
        dealershipId: user.dealershipId,
        phone: challengerUser.phone as string,
        direction: 'outbound',
        messageBody: notifyMsg,
      });
    }

    return true;
  } catch (err) {
    console.error('PASS handler error:', (err as Error).message ?? err);
    return true;
  }
}

// =============================================================================
// GO keyword: trigger a new training session on demand (v7.1)
// Uses content pipeline for domain/mode/mood SELECTION, but sends a scenario
// from the 30-question pool as the SMS. formatTrainingQuestion() output is the
// AI system prompt — never send that to the rep.
// =============================================================================
async function handleGoKeyword(
  user: { id: string; dealershipId: string; dealershipName: string; fullName: string },
  phone: string
) {
  try {
    const existingSession = await getActiveSession(user.id, user.dealershipId);
    if (existingSession) {
      const msg = 'You already have a session in progress. Finish it first!';
      await sendSms(phone, msg);
      await insertTranscriptLog({ userId: user.id, dealershipId: user.dealershipId, phone, direction: 'outbound', messageBody: msg });
      return;
    }

    // v7.1: Use content pipeline for domain/mode/mood selection only.
    // The actual SMS text comes from the scenario pool (customer-facing language).
    let mode: string;
    let trainingDomain: string | undefined;
    let personaMoodValue: string | null = null;

    try {
      const content = await selectTrainingContent(user.id, user.dealershipId);
      mode = content.mode;
      trainingDomain = content.domain;
      personaMoodValue = content.mood?.name ?? null;
    } catch (contentErr) {
      console.error('GO: training content pipeline failed, using random mode:', (contentErr as Error).message ?? contentErr);
      const modes = ['roleplay', 'quiz', 'objection'] as const;
      mode = modes[Math.floor(Math.random() * modes.length)];
    }

    // Always pick from the scenario pool — these are written as customer dialogue
    const question = getRandomScenario(mode);

    const firstName = user.fullName ? user.fullName.trim().split(/\s+/)[0] : '';
    const greeting = firstName ? `Hey ${firstName}, ` : '';
    const fullQuestion = `${greeting}${question}`;

    const session = await createConversationSession({
      userId: user.id,
      dealershipId: user.dealershipId,
      mode,
      questionText: fullQuestion,
      trainingDomain,
      personaMood: personaMoodValue,
    });
    await updateSessionStatus(session.id, user.dealershipId, 'active');

    const sinchResponse = await sendSms(phone, fullQuestion);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: fullQuestion,
      sinchMessageId: sinchResponse.message_id,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('GO keyword handler error:', (err as Error).message ?? err);
    await sendSms(phone, 'Something went wrong starting a session. Try again in a minute.');
  }
}

// =============================================================================
// Final exchange: grade everything, send Never Naked feedback
// Phase 6: post-grading hooks for chains + peer challenges
// =============================================================================
async function handleFinalExchange(
  session: {
    id: string;
    status: string;
    questionText: string;
    mode: string;
    promptVersionId: string | null;
    personaMood?: string | null;
    trainingDomain?: string | null;
    challengeId?: string | null;
    scenarioChainId?: string | null;
    chainStep?: number | null;
  },
  user: { id: string; dealershipId: string },
  phone: string,
  text: string,
  mode: 'roleplay' | 'quiz' | 'objection'
) {
  assertTransition(session.status as 'active', 'grading');
  await updateSessionStatus(session.id, user.dealershipId, 'grading');

  try {
    const history = await getSessionTranscript(session.id, user.dealershipId);

    const scoreBehavioralUrgency = await isFeatureEnabled(user.dealershipId, 'behavioral_scoring_urgency');
    const scoreBehavioralCompetitive = await isFeatureEnabled(user.dealershipId, 'behavioral_scoring_competitive');

    // v7: Look up scenario bank data if feature flag is ON
    let techniqueTag: string | undefined;
    let eliteDialogue: string | undefined;
    let failSignals: string | undefined;
    let scenarioDomain: string | undefined;
    let weightClass: string | undefined;

    const v7Enabled = await isFeatureEnabled(user.dealershipId, 'grader_v7_enabled');
    if (v7Enabled) {
      try {
        const scenarioData = await getScenarioBankEntry(session.questionText);
        if (scenarioData) {
          techniqueTag = scenarioData.techniqueTag;
          eliteDialogue = scenarioData.eliteDialogue;
          failSignals = scenarioData.failSignals;
          scenarioDomain = scenarioData.domain;
          weightClass = scenarioData.weightClass;
        }
      } catch (lookupErr) {
        console.error('Scenario bank lookup failed:', (lookupErr as Error).message ?? lookupErr);
        // Fall through to v6 grading — techniqueTag stays undefined
      }
    }

    const result = await gradeResponse({
      scenario: session.questionText,
      employeeResponse: text,
      mode,
      promptVersionId: session.promptVersionId ?? undefined,
      conversationHistory: history,
      personaMood: session.personaMood,
      scoreBehavioralUrgency,
      scoreBehavioralCompetitive,
      techniqueTag,
      eliteDialogue,
      failSignals,
      scenarioDomain,
      weightClass,
    });

    const averageScore = (
      result.product_accuracy +
      result.tone_rapport +
      result.addressed_concern +
      result.close_attempt
    ) / 4;

    // Extract v7 weighted scoring fields (present when v7 path ran)
    const v7Result = result as typeof result & { weightClass?: string; rawTotal?: number; weightedTotal?: number };

    await insertTrainingResult({
      userId: user.id,
      dealershipId: user.dealershipId,
      sessionId: session.id,
      mode: session.mode,
      productAccuracy: result.product_accuracy,
      toneRapport: result.tone_rapport,
      addressedConcern: result.addressed_concern,
      closeAttempt: result.close_attempt,
      feedback: result.feedback,
      model: result.model,
      promptVersionId: undefined,
      urgencyCreation: result.urgency_creation ?? null,
      competitivePositioning: result.competitive_positioning ?? null,
      trainingDomain: session.trainingDomain ?? undefined,
      weightClass: v7Result.weightClass,
      rawTotal: v7Result.rawTotal,
      weightedTotal: v7Result.weightedTotal,
    });

    // Phase 4D: Update priority vector if domain tracked
    if (session.trainingDomain) {
      try {
        await updatePriorityVectorAfterGrading(
          user.id,
          user.dealershipId,
          session.trainingDomain as Parameters<typeof updatePriorityVectorAfterGrading>[2],
          averageScore
        );
      } catch (weightErr) {
        console.error('Priority vector update failed:', (weightErr as Error).message ?? weightErr);
      }
    }

    // Grading feedback is EXEMPT from quiet hours — send immediately
    await sendSms(phone, result.feedback);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: result.feedback,
      sessionId: session.id,
    });

    assertTransition('grading', 'completed');
    await updateSessionStatus(session.id, user.dealershipId, 'completed');

    // --- Phase 6C: Chain step recording ---
    if (session.scenarioChainId) {
      try {
        const stepResult: StepResult = {
          step: session.chainStep ?? 1,
          scores: {
            product_accuracy: result.product_accuracy,
            tone_rapport: result.tone_rapport,
            addressed_concern: result.addressed_concern,
            close_attempt: result.close_attempt,
          },
          feedback: result.feedback,
          completed_at: new Date().toISOString(),
        };
        const chainComplete = await recordChainStepResult(session.scenarioChainId, stepResult);
        if (chainComplete) {
          // Load chain context for completion SMS
          const sc = serviceClient;
          const { data: chainRow } = await sc
            .from('scenario_chains')
            .select('chain_context, step_results')
            .eq('id', session.scenarioChainId)
            .single();

          if (chainRow) {
            const ctx = chainRow.chain_context as { customer_name?: string };
            const completionMsg = buildChainCompletionSMS(
              ctx.customer_name ?? 'The customer',
              chainRow.step_results as StepResult[]
            );
            await new Promise(r => setTimeout(r, 1000));
            await sendSms(phone, completionMsg);
            await insertTranscriptLog({
              userId: user.id,
              dealershipId: user.dealershipId,
              phone,
              direction: 'outbound',
              messageBody: completionMsg,
            });
          }
        }
      } catch (chainErr) {
        console.error('Chain step recording failed:', (chainErr as Error).message ?? chainErr);
      }
    }

    // --- Phase 6D: Peer challenge completion check ---
    if (session.challengeId) {
      // Note: session.challengeId here is used for daily challenges AND peer challenges.
      // For peer challenges, we look up whether this session is linked to a peer_challenge row.
      try {
        const sc = serviceClient;
        const { data: peerChallenge } = await sc
          .from('peer_challenges')
          .select('id, challenger_id, challenged_id, status')
          .eq('status', 'active')
          .or(`challenger_session_id.eq.${session.id},challenged_session_id.eq.${session.id}`)
          .maybeSingle();

        if (peerChallenge) {
          const peerResult = await checkAndCompleteChallenge(peerChallenge.id);
          if (peerResult?.complete) {
            // Send results to both
            const { data: users } = await sc
              .from('users')
              .select('id, phone, full_name')
              .in('id', [peerChallenge.challenger_id as string, peerChallenge.challenged_id as string]);

            const userMap: Record<string, { phone: string; firstName: string }> = {};
            for (const u of users ?? []) {
              userMap[u.id as string] = {
                phone: u.phone as string,
                firstName: (u.full_name as string)?.split(/\s+/)[0] ?? 'Unknown',
              };
            }

            const challengerId = peerChallenge.challenger_id as string;
            const challengedId = peerChallenge.challenged_id as string;

            // Send to challenger
            if (userMap[challengerId]) {
              const msg = buildPeerResultsSMS(
                peerResult.challengerScore ?? 0,
                peerResult.challengedScore ?? 0,
                userMap[challengedId]?.firstName ?? 'opponent',
                peerResult.winnerId === challengerId,
                'tone_rapport', // simplified — could extract from actual scores
                'close_attempt'
              );
              await sendSms(userMap[challengerId].phone, msg);
              await insertTranscriptLog({
                userId: challengerId,
                dealershipId: user.dealershipId,
                phone: userMap[challengerId].phone,
                direction: 'outbound',
                messageBody: msg,
              });
            }

            // Send to challenged
            if (userMap[challengedId]) {
              const msg = buildPeerResultsSMS(
                peerResult.challengedScore ?? 0,
                peerResult.challengerScore ?? 0,
                userMap[challengerId]?.firstName ?? 'opponent',
                peerResult.winnerId === challengedId,
                'tone_rapport',
                'close_attempt'
              );
              await sendSms(userMap[challengedId].phone, msg);
              await insertTranscriptLog({
                userId: challengedId,
                dealershipId: user.dealershipId,
                phone: userMap[challengedId].phone,
                direction: 'outbound',
                messageBody: msg,
              });
            }
          }
        }
      } catch (peerErr) {
        console.error('Peer challenge completion check failed:', (peerErr as Error).message ?? peerErr);
      }
    }
  } catch (gradingErr) {
    console.error('AI grading failed:', (gradingErr as Error).message ?? gradingErr);
    await updateSessionStatus(session.id, user.dealershipId, 'error');

    const errorMsg = ERROR_SMS.ai_timeout;
    await sendSms(phone, errorMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: errorMsg,
      sessionId: session.id,
    });
  }
}

// --- Mid-exchange: generate AI follow-up, advance step, keep active ---
async function handleMidExchange(
  session: { id: string; status: string; questionText: string; mode: string; personaMood?: string | null },
  user: { id: string; dealershipId: string },
  phone: string,
  text: string,
  mode: 'roleplay' | 'quiz' | 'objection',
  stepIndex: number
) {
  try {
    const history = await getSessionTranscript(session.id, user.dealershipId);

    const followUp = await generateFollowUp({
      scenario: session.questionText,
      mode,
      conversationHistory: history,
      currentResponse: text,
      stepIndex,
      personaMood: session.personaMood,
    });

    // For objection mode: send coaching first, then customer follow-up
    if (mode === 'objection' && followUp.coaching) {
      const coachingMsg = followUp.coaching;
      await sendSms(phone, coachingMsg);
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: coachingMsg,
        sessionId: session.id,
      });
      await new Promise((r) => setTimeout(r, 500));
    }

    await sendSms(phone, followUp.customerMessage);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: followUp.customerMessage,
      sessionId: session.id,
    });

    await updateSessionStep(session.id, user.dealershipId, stepIndex + 1);
  } catch (err) {
    console.error('Follow-up generation failed:', (err as Error).message ?? err);
    await updateSessionStatus(session.id, user.dealershipId, 'error');
    const errorMsg = ERROR_SMS.ai_timeout;
    await sendSms(phone, errorMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: errorMsg,
      sessionId: session.id,
    });
  }
}

// --- Pending consent handler (double opt-in) ---
async function handlePendingConsent(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string,
  text: string
) {
  const trimmed = text.trim().toLowerCase();

  if (['yes', 'start', 'y', 'unstop'].includes(trimmed)) {
    await updateUserStatus(user.id, 'active');
    await insertConsentRecord({
      userId: user.id,
      dealershipId: user.dealershipId,
      consentType: 'opt_in',
      channel: 'sms',
      consentSource: 'keyword_consent',
    });

    // V4-C-001: Truncate dealership name to keep <=160 chars. Template = ~130 chars without name.
    const dName = (user.dealershipName ?? '').slice(0, 30);
    const welcomeMsg = `Welcome to DealershipIQ at ${dName}! Daily practice questions via text. Reply STOP anytime to opt out. Msg&data rates apply.`;
    await sendSms(phone, welcomeMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: welcomeMsg,
    });
    return;
  }

  if (['stop', 'no', 'cancel', 'n'].includes(trimmed)) {
    await updateUserStatus(user.id, 'inactive');
    const { registerOptOut } = await import('@/lib/service-db');
    await registerOptOut(phone, user.dealershipId);
    // X-007: Cancel active chains/challenges on consent decline
    await cancelUserActiveState(user.id, user.dealershipId);

    const declineMsg = 'You have opted out of DealershipIQ training. No messages will be sent. Reply START if you change your mind.';
    await sendSms(phone, declineMsg);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: declineMsg,
    });
    return;
  }

  const reminderMsg = 'Please reply YES to start receiving DealershipIQ training, or STOP to decline.';
  await sendSms(phone, reminderMsg);
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'outbound',
    messageBody: reminderMsg,
  });
}

// --- Natural language opt-out handler ---
async function handleNaturalOptOut(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string
) {
  const { registerOptOut } = await import('@/lib/service-db');
  await registerOptOut(phone, user.dealershipId);

  // X-007: Cancel active chains and pending peer challenges on opt-out
  await cancelUserActiveState(user.id, user.dealershipId);

  const confirmMsg = 'You have been unsubscribed from DealershipIQ training messages. Reply START to re-subscribe.';
  await sendSms(phone, confirmMsg);
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'outbound',
    messageBody: confirmMsg,
  });
}

// X-007: Helper to cancel chains + peer challenges when user opts out.
// M-4 (2026-04-18): dealership_id added so cancellation is tenant-scoped.
// Also: capture per-table failures and emit a single structured error log
// instead of swallowing the first thrown error.
async function cancelUserActiveState(userId: string, dealershipId: string) {
  const sc = serviceClient;
  const failures: Array<{ table: string; op: string; error: string }> = [];

  try {
    const { error } = await sc
      .from('scenario_chains')
      .update({ status: 'canceled', completed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .eq('status', 'active');
    if (error) failures.push({ table: 'scenario_chains', op: 'cancel', error: error.message });
  } catch (err) {
    failures.push({ table: 'scenario_chains', op: 'cancel', error: (err as Error).message ?? String(err) });
  }

  try {
    const { error } = await sc
      .from('peer_challenges')
      .update({ status: 'canceled' })
      .eq('challenged_id', userId)
      .eq('dealership_id', dealershipId)
      .in('status', ['pending', 'active']);
    if (error) failures.push({ table: 'peer_challenges', op: 'cancel_challenged', error: error.message });
  } catch (err) {
    failures.push({ table: 'peer_challenges', op: 'cancel_challenged', error: (err as Error).message ?? String(err) });
  }

  try {
    const { error } = await sc
      .from('peer_challenges')
      .update({ status: 'canceled' })
      .eq('challenger_id', userId)
      .eq('dealership_id', dealershipId)
      .in('status', ['pending', 'active']);
    if (error) failures.push({ table: 'peer_challenges', op: 'cancel_challenger', error: error.message });
  } catch (err) {
    failures.push({ table: 'peer_challenges', op: 'cancel_challenger', error: (err as Error).message ?? String(err) });
  }

  if (failures.length > 0) {
    log.error('sinch.opt_out.cancel_failed', {
      user_id: userId,
      dealership_id: dealershipId,
      failures,
    });
  }
}

// --- DETAILS keyword handler (morning meeting script, managers only) ---
async function handleDetailsKeyword(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string
) {
  try {
    const sc = serviceClient;
    const { data: membership } = await sc
      .from('dealership_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('dealership_id', user.dealershipId)
      .maybeSingle();

    const role = (membership?.role as string) ?? '';
    if (!['owner', 'manager'].includes(role)) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const { data: script } = await sc
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('dealership_id', user.dealershipId)
      .eq('script_date', todayStr)
      .maybeSingle();

    if (!script) {
      const msg = "Your morning intel isn't ready yet. Check your dashboard after 7 AM.";
      await sendSms(phone, msg);
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: msg,
      });
      return;
    }

    const { formatDetailsResponse } = await import('@/lib/meeting-script/assemble');
    const detailsText = formatDetailsResponse(
      user.dealershipName,
      script.full_script as Parameters<typeof formatDetailsResponse>[1],
      script.script_date as string
    );

    await sendSms(phone, detailsText);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: detailsText,
      metadata: { type: 'morning_script_details' },
    });
  } catch (err) {
    console.error('DETAILS keyword handler error:', (err as Error).message ?? err);
  }
}

// --- Re-subscribe handler ---
async function handleResubscribe(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string
) {
  const { removeOptOut, insertConsentRecord } = await import('@/lib/service-db');
  await removeOptOut(phone, user.dealershipId);
  await insertConsentRecord({
    userId: user.id,
    dealershipId: user.dealershipId,
    consentType: 'opt_in',
    channel: 'sms',
    consentSource: 'keyword_start',
  });

  // V4-C-002: Truncate dealership name to keep <=160 chars.
  const reName = (user.dealershipName ?? '').slice(0, 30);
  const welcomeMsg = `Welcome back to DealershipIQ at ${reName}! Daily training questions via text. Reply STOP to opt out.`;
  await sendSms(phone, welcomeMsg);
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'outbound',
    messageBody: welcomeMsg,
  });
}