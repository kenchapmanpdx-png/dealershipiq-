// Sinch Conversation API webhook handler
// Build Master: Phase 2A, 2B, 2C, 2D, 2E
// CRITICAL: Always return 200 OK. Never return 4xx — Sinch permanently
// kills callbacks on non-429 4xx responses.
// Processing runs synchronously before returning 200 (Vercel Hobby plan
// does not support @vercel/functions waitUntil).
//
// Multi-exchange flow (3 exchanges per session):
//   step 0,1: Generate AI follow-up, keep session active
//   step 2:   Final grade, Never Naked feedback, complete session

import { NextRequest, NextResponse } from 'next/server';
import { verifySinchWebhookSignature } from '@/lib/sinch-auth';
import { sendSms, detectKeyword, helpResponse } from '@/lib/sms';
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
  getEmployeePriorityVector,
} from '@/lib/service-db';
import {
  parseScheduleKeyword,
  updateEmployeeSchedule,
} from '@/lib/schedule-awareness';
import {
  updatePriorityVectorAfterGrading,
} from '@/lib/adaptive-weighting';
import type { SinchInboundMessage, SinchDeliveryReport } from '@/types/sinch';

// Idempotency: track processed message IDs (in-memory for now, Redis in Phase 2F)
const processedMessages = new Set<string>();
const MAX_PROCESSED_CACHE = 10_000;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

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
    const entries = Array.from(processedMessages);
    for (let i = 0; i < 1000; i++) processedMessages.delete(entries[i]);
  }

  const phone = payload.message.channel_identity.identity;
  const text = payload.message.contact_message?.text_message?.text ?? '';

  if (!text.trim()) return;

  const user = await getUserByPhone(phone);
  if (!user) {
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

  // --- Pending consent flow (double opt-in before any training) ---
  if (user.status === 'pending_consent') {
    await handlePendingConsent(user, phone, text);
    return;
  }

  // Check opt-out status
  const isOptedOut = await checkOptOut(phone, user.dealershipId);
  if (isOptedOut) return;

  // --- Schedule Keyword Detection (before other keywords) ---
  const scheduleResult = parseScheduleKeyword(text);
  if (scheduleResult.success) {
    // Update schedule and send confirmation
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
      console.error('Schedule update failed:', scheduleErr);
      await sendSms(phone, 'Could not update schedule. Please try again.');
    }
    return;
  }

  // --- DETAILS Keyword Detection (morning meeting script, managers only) ---
  if (text.trim().toLowerCase() === 'details') {
    await handleDetailsKeyword(user, phone);
    return;
  }

  // --- COACH Keyword Detection (same priority as STOP/HELP) ---
  if (text.trim().toLowerCase() === 'coach') {
    const coachEnabled = await isFeatureEnabled(user.dealershipId, 'coach_mode_enabled');
    if (!coachEnabled) {
      await sendSms(phone, "Coach Mode isn't available yet. Stay tuned!");
    } else {
      // Build coach URL from dealership slug
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dealershipiq-wua7.vercel.app';
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
    await handleNaturalOptOut(user, phone);
    return;
  }

  if (keyword === 'start') {
    await handleResubscribe(user, phone);
    return;
  }

  // --- Advisory Lock ---
  const { tryLockUser } = await import('@/lib/service-db');
  const locked = await tryLockUser(phone);
  if (!locked) return;

  // --- Route to State Machine ---
  try {
    const session = await getActiveSession(user.id, user.dealershipId);

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
      await sendSms(phone, "Still processing your last response — hang tight!");
      return;
    }

    if (session.status !== 'active') {
      return;
    }

    // --- Multi-Exchange Logic ---
    const mode = session.mode as 'roleplay' | 'quiz' | 'objection';
    const stepIndex = session.stepIndex;

    if (isFinalExchange(stepIndex)) {
      // FINAL EXCHANGE — grade all exchanges
      await handleFinalExchange(session, user, phone, text, mode);
    } else {
      // MID-EXCHANGE — generate follow-up, keep session active
      await handleMidExchange(session, user, phone, text, mode, stepIndex);
    }
  } catch (err) {
    console.error('State machine error:', err);
  }
}

// --- Final exchange: grade everything, send Never Naked feedback ---
async function handleFinalExchange(
  session: { id: string; status: string; questionText: string; mode: string; promptVersionId: string | null; personaMood?: string | null; trainingDomain?: string | null },
  user: { id: string; dealershipId: string },
  phone: string,
  text: string,
  mode: 'roleplay' | 'quiz' | 'objection'
) {
  assertTransition(session.status as 'active', 'grading');
  await updateSessionStatus(session.id, 'grading');

  try {
    // Get full conversation history for grading context
    const history = await getSessionTranscript(session.id);

    // Phase 4A: Check behavioral scoring feature flags
    const scoreBehavioralUrgency = await isFeatureEnabled(user.dealershipId, 'behavioral_scoring_urgency');
    const scoreBehavioralCompetitive = await isFeatureEnabled(user.dealershipId, 'behavioral_scoring_competitive');

    const result = await gradeResponse({
      scenario: session.questionText,
      employeeResponse: text,
      mode,
      promptVersionId: session.promptVersionId ?? undefined,
      conversationHistory: history,
      personaMood: session.personaMood,
      scoreBehavioralUrgency,
      scoreBehavioralCompetitive,
    });

    const averageScore = (
      result.product_accuracy +
      result.tone_rapport +
      result.addressed_concern +
      result.close_attempt
    ) / 4;

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
      urgencyCreation: result.urgency_creation ?? null,
      competitivePositioning: result.competitive_positioning ?? null,
      trainingDomain: session.trainingDomain ?? undefined,
    });

    // Phase 4D: Update priority vector if domain tracked
    if (session.trainingDomain) {
      try {
        await updatePriorityVectorAfterGrading(
          user.id,
          user.dealershipId,
          session.trainingDomain as any,
          averageScore
        );
      } catch (weightErr) {
        console.error('Priority vector update failed:', weightErr);
        // Non-blocking — continue with SMS
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
    await updateSessionStatus(session.id, 'completed');
  } catch (gradingErr) {
    console.error('AI grading failed:', gradingErr);
    await updateSessionStatus(session.id, 'error');

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
    const history = await getSessionTranscript(session.id);

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
      // Small delay so messages arrive in order
      await new Promise((r) => setTimeout(r, 500));
    }

    // Send customer follow-up
    await sendSms(phone, followUp.customerMessage);
    await insertTranscriptLog({
      userId: user.id,
      dealershipId: user.dealershipId,
      phone,
      direction: 'outbound',
      messageBody: followUp.customerMessage,
      sessionId: session.id,
    });

    // Advance step — session stays active
    await updateSessionStep(session.id, stepIndex + 1);
  } catch (err) {
    console.error('Follow-up generation failed:', err);

    // Fallback: skip to final grade on error
    await updateSessionStatus(session.id, 'error');
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
    // User consented — activate them
    await updateUserStatus(user.id, 'active');
    await insertConsentRecord({
      userId: user.id,
      dealershipId: user.dealershipId,
      consentType: 'opt_in',
      channel: 'sms',
      consentSource: 'keyword_consent',
    });

    const welcomeMsg = `Welcome to DealershipIQ training at ${user.dealershipName}! You'll receive daily practice questions. Reply STOP anytime to opt out. Msg&data rates apply.`;
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
    // User declined — mark inactive, register opt-out
    await updateUserStatus(user.id, 'inactive');
    const { registerOptOut } = await import('@/lib/service-db');
    await registerOptOut(phone, user.dealershipId);

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

  // Unrecognized reply — remind them
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

// --- DETAILS keyword handler (morning meeting script, managers only) ---
async function handleDetailsKeyword(
  user: { id: string; dealershipId: string; dealershipName: string },
  phone: string
) {
  try {
    // Check if user is a manager/owner
    const { serviceClient: sc } = await import('@/lib/supabase/service');
    const { data: membership } = await sc
      .from('dealership_memberships')
      .select('role')
      .eq('user_id', user.id)
      .eq('dealership_id', user.dealershipId)
      .maybeSingle();

    const role = (membership?.role as string) ?? '';
    if (!['owner', 'manager'].includes(role)) {
      // Not a manager — ignore DETAILS keyword, don't send error
      return;
    }

    // Look up today's meeting script
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: script } = await sc
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('dealership_id', user.dealershipId)
      .eq('script_date', todayStr)
      .maybeSingle();

    if (!script) {
      const msg =
        "Your morning intel isn't ready yet. Check your dashboard after 7 AM.";
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

    // Format expanded DETAILS response
    const { formatDetailsResponse } = await import(
      '@/lib/meeting-script/assemble'
    );
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
    // DETAILS does not count toward 3-message daily cap — it's a system response
  } catch (err) {
    console.error('DETAILS keyword handler error:', err);
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
