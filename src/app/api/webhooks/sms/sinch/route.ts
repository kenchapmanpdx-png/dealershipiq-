// Sinch Conversation API webhook handler
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

export const maxDuration = 300;

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
  createConversationSession,
} from '@/lib/service-db';
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
import type { SinchInboundMessage, SinchDeliveryReport } from '@/types/sinch';
import type { StepResult } from '@/types/chains';

// Idempotency: track processed message IDs (in-memory fast-path, DB-backed for persistence)
// C-002 audit fix: use database as source of truth, in-memory Set as cache
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

  // Idempotency check (C-002 audit fix: database-backed with in-memory cache)
  // Fast-path: check in-memory Set first
  if (processedMessages.has(messageId)) return;

  // Database-level check: query sms_transcript_log for this sinch_message_id
  const { serviceClient } = await import('@/lib/supabase/service');
  const { data: existing } = await serviceClient
    .from('sms_transcript_log')
    .select('id')
    .eq('sinch_message_id', messageId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Message already processed, return early
    return;
  }

  // Mark as processed in both caches
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

  const trimmedText = text.trim();
  const trimmedUpper = trimmedText.toUpperCase();

  // ==========================================================================
  // KEYWORD PRIORITY ORDER (C-004 audit fix)
  // ==========================================================================
  // 1. STOP/END/UNSUBSCRIBE/CANCEL/QUIT (opt-out) — intercepted by Sinch
  // 2. HELP — CTIA compliance
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
  // 14. Everything else → state machine
  // ==========================================================================

  // Check opt-out status (DB-level opt-out)
  const isOptedOut = await checkOptOut(phone, user.dealershipId);
  if (isOptedOut) return;

  // Check for active session (for keyword detection context)
  const activeSession = await getActiveSession(user.id, user.dealershipId);
  const hasActiveSession = !!activeSession && activeSession.status === 'active';

  // 2. HELP keyword (CTIA compliant)
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
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.VERCEL_URL ?? '';
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
      console.error('Schedule update failed:', scheduleErr);
      await sendSms(phone, 'Could not update schedule. Please try again.');
    }
    return;
  }

  // --- Advisory Lock (M-005 audit fix: acquire BEFORE Phase 6 keywords) ---
  const { tryLockUser } = await import('@/lib/service-db');
  const locked = await tryLockUser(phone);
  if (!locked) return;

  try {
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
      await handleFinalExchange(session, user, phone, text, mode);
    } else {
      await handleMidExchange(session, user, phone, text, mode, stepIndex);
    }
  } catch (err) {
    console.error('State machine error:', err);
  }
  // Note (H-012): Advisory lock is transaction-scoped and auto-released by connection pool
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
    console.error('TRAIN: scenario generation failed:', err);
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
    await markScenarioPushedNow(pending.id);

    // Push scenario to all eligible reps now
    const { getEligibleUsers } = await import('@/lib/service-db');
    const eligible = await getEligibleUsers(user.dealershipId);
    let pushed = 0;

    for (const rep of eligible) {
      try {
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
        await updateSessionStatus(session.id, 'active');
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
        console.error(`NOW push failed for ${rep.id}:`, repErr);
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
    console.error('NOW push failed:', err);
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
      const { serviceClient: sc } = await import('@/lib/supabase/service');
      const { data: targetUser } = await sc.from('users').select('phone').eq('id', target.id).single();
      if (targetUser?.phone) {
        const notifyMsg = `${challengerFirst} challenged you! Reply ACCEPT to compete or PASS to skip.`;
        await sendSms(targetUser.phone as string, notifyMsg);
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
    console.error('CHALLENGE handler error:', err);
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
    const { serviceClient: sc } = await import('@/lib/supabase/service');
    const { data: targetUser } = await sc.from('users').select('phone').eq('id', selected.user_id).single();
    if (targetUser?.phone) {
      const challengerFirst = user.fullName ? user.fullName.split(/\s+/)[0] : 'Someone';
      const notifyMsg = `${challengerFirst} challenged you! Reply ACCEPT to compete or PASS to skip.`;
      await sendSms(targetUser.phone as string, notifyMsg);
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
    console.error('Disambiguation resolve error:', err);
    await sendSms(phone, 'Something went wrong. Try CHALLENGE again.');
    return true;
  }
}

// --- ACCEPT keyword handler ---
async function handleAcceptKeyword(
  user: { id: string; dealershipId: string; fullName: string },
  phone: string
): Promise<boolean> {
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
    const { serviceClient: sc } = await import('@/lib/supabase/service');
    await sc.from('peer_challenges').update({
      challenger_session_id: challengerSession.id,
      challenged_session_id: challengedSession.id,
    }).eq('id', pendingChallenge.id);

    await updateSessionStatus(challengerSession.id, 'active');
    await updateSessionStatus(challengedSession.id, 'active');

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
    console.error('ACCEPT handler error:', err);
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
    const { serviceClient: sc } = await import('@/lib/supabase/service');
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
    console.error('PASS handler error:', err);
    return true;
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
  await updateSessionStatus(session.id, 'grading');

  try {
    const history = await getSessionTranscript(session.id);

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
          session.trainingDomain as Parameters<typeof updatePriorityVectorAfterGrading>[2],
          averageScore
        );
      } catch (weightErr) {
        console.error('Priority vector update failed:', weightErr);
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
          const { getActiveChain } = await import('@/lib/chains/lifecycle');
          const { serviceClient: sc } = await import('@/lib/supabase/service');
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
        console.error('Chain step recording failed:', chainErr);
      }
    }

    // --- Phase 6D: Peer challenge completion check ---
    if (session.challengeId) {
      // Note: session.challengeId here is used for daily challenges AND peer challenges.
      // For peer challenges, we look up whether this session is linked to a peer_challenge row.
      try {
        const { serviceClient: sc } = await import('@/lib/supabase/service');
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
        console.error('Peer challenge completion check failed:', peerErr);
      }
    }
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

    await updateSessionStep(session.id, stepIndex + 1);
  } catch (err) {
    console.error('Follow-up generation failed:', err);
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
    const { serviceClient: sc } = await import('@/lib/supabase/service');
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
