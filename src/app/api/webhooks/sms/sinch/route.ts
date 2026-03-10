// Sinch Conversation API webhook handler
// Build Master: Phase 2A, 2B, 2C, 2D, 2E
// CRITICAL: Always return 200 OK. Never return 4xx — Sinch permanently
// kills callbacks on non-429 4xx responses.
// Processing runs synchronously before returning 200 (Vercel Hobby plan
// does not support @vercel/functions waitUntil).

import { NextRequest, NextResponse } from 'next/server';
import { verifySinchWebhookSignature } from '@/lib/sinch-auth';
import { sendSms, detectKeyword, helpResponse } from '@/lib/sms';
import { gradeResponse, ERROR_SMS } from '@/lib/openai';
import { assertTransition } from '@/lib/state-machine';
import {
  getUserByPhone,
  getActiveSession,
  updateSessionStatus,
  insertTranscriptLog,
  checkOptOut,
  insertTrainingResult,
} from '@/lib/service-db';
import type { SinchInboundMessage, SinchDeliveryReport } from '@/types/sinch';

// Idempotency: track processed message IDs (in-memory for now, Redis in Phase 2F)
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

export async function POST(request: NextRequest) {
  // Read raw body for HMAC verification
  const rawBody = await request.text();

  // Verify HMAC signature
  const signature = request.headers.get('x-sinch-webhook-signature');
  const nonce = request.headers.get('x-sinch-webhook-signature-nonce');
  const timestamp = request.headers.get('x-sinch-webhook-signature-timestamp');

  if (!verifySinchWebhookSignature(rawBody, signature, nonce, timestamp)) {
    console.error('Sinch webhook HMAC verification failed');
    return NextResponse.json({ status: 'ok' });
  }

  let payload: SinchInboundMessage | SinchDeliveryReport;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status: 'ok' });
  }

  // Process synchronously, then return 200.
  // Wrapped in try/catch so we ALWAYS return 200 regardless of errors.
  try {
    if ('message_delivery_report' in payload) {
      await handleDeliveryReport(payload as SinchDeliveryReport);
    } else if ('message' in payload) {
      await handleInboundMessage(payload as SinchInboundMessage);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  return NextResponse.json({ status: 'ok' });
}

// --- Delivery Report Handler ---
async function handleDeliveryReport(report: SinchDeliveryReport) {
  const { status, channel_identity, message_id } = report.message_delivery_report;
  // Only log DELIVERED or FAILED (Build Master: no intermediate states for SMS)
  if (status !== 'DELIVERED' && status !== 'FAILED') return;

  const phone = channel_identity.identity;
  const user = await getUserByPhone(phone);
  if (!user) return;

  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'outbound',
    messageBody: `[DELIVERY_REPORT: ${status}]`,
    sinchMessageId: message_id,
    metadata: { status, reportTime: report.event_time },
  });
}

// --- Inbound Message Handler ---
async function handleInboundMessage(payload: SinchInboundMessage) {
  const messageId = payload.message.id;

  // Idempotency check
  if (processedMessages.has(messageId)) return;
  processedMessages.add(messageId);
  if (processedMessages.size > MAX_PROCESSED_CACHE) {
    // Evict oldest entries (simple approach — Redis in Phase 2F replaces this)
    const entries = Array.from(processedMessages);
    for (let i = 0; i < 1000; i++) processedMessages.delete(entries[i]);
  }

  const phone = payload.message.channel_identity.identity;
  const text = payload.message.contact_message?.text_message?.text ?? '';

  if (!text.trim()) return;

  // Look up user by phone
  const user = await getUserByPhone(phone);
  if (!user) {
    // Unknown phone — log and ignore
    console.warn(`Inbound SMS from unknown phone: ${phone.slice(0, 6)}****`);
    return;
  }

  // Log inbound message
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'inbound',
    messageBody: text,
    sinchMessageId: messageId,
  });

  // Check opt-out status
  const isOptedOut = await checkOptOut(phone, user.dealershipId);
  if (isOptedOut) return;

  // --- Keyword Detection (before routing to state machine) ---
  const keyword = detectKeyword(text);

  if (keyword === 'help') {
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

  if (keyword === 'opt_out') {
    // Natural language opt-out — register locally and via Sinch
    // Sinch exact-match keywords (STOP etc) never reach us
    await handleNaturalOptOut(user, phone);
    return;
  }

  if (keyword === 'start') {
    await handleResubscribe(user, phone);
    return;
  }

  // --- Advisory Lock (prevent concurrent processing for same user) ---
  // Build Master 2B: try_lock_user advisory lock — if false, drop
  const { tryLockUser } = await import('@/lib/service-db');
  const locked = await tryLockUser(phone);
  if (!locked) {
    // Another worker is processing this user — drop
    return;
  }

  // --- Route to State Machine ---
  try {
    const session = await getActiveSession(user.id, user.dealershipId);

    if (!session) {
      // No active session — this is an unsolicited message
      // Could be after-hours reply or stale conversation
      return;
    }

    // Reject if session is in grading state
    if (session.status === 'grading') {
      await sendSms(phone, "Still processing your last response — hang tight!");
      return;
    }

    if (session.status !== 'active') {
      return; // Not expecting a response
    }

    // Transition: active → grading
    assertTransition(session.status, 'grading');
    await updateSessionStatus(session.id, 'grading');

    // --- AI Grading ---
    try {
      const result = await gradeResponse({
        scenario: session.questionText,
        employeeResponse: text,
        mode: session.mode as 'roleplay' | 'quiz' | 'objection',
        promptVersionId: session.promptVersionId ?? undefined,
      });

      // Store grading result
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
        promptVersionId: result.promptVersionId,
      });

      // Send feedback SMS
      await sendSms(phone, result.feedback);
      await insertTranscriptLog({
        userId: user.id,
        dealershipId: user.dealershipId,
        phone,
        direction: 'outbound',
        messageBody: result.feedback,
        sessionId: session.id,
      });

      // Transition: grading → completed
      assertTransition('grading', 'completed');
      await updateSessionStatus(session.id, 'completed');
    } catch (gradingErr) {
      console.error('AI grading failed:', gradingErr);

      // Transition: grading → error
      await updateSessionStatus(session.id, 'error');

      // Send error SMS (no dead ends)
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
  } catch (err) {
    console.error('State machine error:', err);
  }
}

// --- Natural language opt-out handler ---
async function handleNaturalOptOut(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string
) {
  const { registerOptOut } = await import('@/lib/service-db');
  await registerOptOut(phone, user.dealershipId);

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

  const welcomeMsg = `Welcome back to DealershipIQ training at ${user.dealershipName}! You'll receive daily training questions. Reply STOP to opt out.`;
  await sendSms(phone, welcomeMsg);
  await insertTranscriptLog({
    userId: user.id,
    dealershipId: user.dealershipId,
    phone,
    direction: 'outbound',
    messageBody: welcomeMsg,
  });
}
