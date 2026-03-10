// Daily training cron — hourly Vercel cron (0 * * * *)
// Build Master: Phase 2A.2
// Each invocation: find dealerships where current local hour = training hour (default 9 AM)
// Stagger sends 5-15 min per dealership to avoid carrier rate limits

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { isWithinQuietHours } from '@/lib/quiet-hours';
import { sendSms } from '@/lib/sms';
import {
  getDealershipsByTimezoneHour,
  getEligibleUsers,
  createConversationSession,
  updateSessionStatus,
  insertTranscriptLog,
  insertDeliveryLog,
} from '@/lib/service-db';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find dealerships where current local hour = 9 AM (training hour)
  const dealerships = await getDealershipsByTimezoneHour(9);

  const results: Array<{ dealershipId: string; sent: number; skipped: number; errors: number }> = [];

  for (const dealership of dealerships) {
    // Double-check quiet hours (handles edge cases around DST transitions)
    if (!isWithinQuietHours(dealership.timezone)) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    const eligible = await getEligibleUsers(dealership.id);
    let sent = 0;
    const skipped = 0;
    let errors = 0;

    for (const user of eligible) {
      try {
        // TODO: Select training question based on mode rotation + priority vectors
        // For now, use a placeholder question
        const mode = selectTrainingMode();
        const question = getTrainingQuestion(mode, dealership.name);

        // Create session in pending state
        const session = await createConversationSession({
          userId: user.id,
          dealershipId: dealership.id,
          mode,
          questionText: question,
        });

        // Send SMS
        const sinchResponse = await sendSms(user.phone, question);

        // Transition: pending → active
        await updateSessionStatus(session.id, 'active');

        // Log outbound
        await insertTranscriptLog({
          userId: user.id,
          dealershipId: dealership.id,
          direction: 'outbound',
          messageBody: question,
          sinchMessageId: sinchResponse.message_id,
          phone: user.phone,
          sessionId: session.id,
        });

        await insertDeliveryLog({
          dealershipId: dealership.id,
          userId: user.id,
          phone: user.phone,
          sinchMessageId: sinchResponse.message_id,
          status: 'sent',
          sessionId: session.id,
        });

        sent++;

        // Stagger: 50ms between sends (20/sec = Sinch default limit)
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error(`Failed to send training to ${user.id}:`, err);
        errors++;
      }
    }

    results.push({ dealershipId: dealership.id, sent, skipped, errors });
  }

  return NextResponse.json({
    dealerships: dealerships.length,
    results,
  });
}

// --- Training mode rotation ---
// Build Master: Roleplay → Quiz → Objection → Roleplay
const MODES = ['roleplay', 'quiz', 'objection'] as const;

function selectTrainingMode(): string {
  // Simple round-robin based on day of year
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000
  );
  return MODES[dayOfYear % MODES.length];
}

function getTrainingQuestion(mode: string, dealershipName: string): string {
  // TODO: Replace with prompt_versions table lookup + priority vector selection
  // These are placeholder questions for initial testing
  const questions: Record<string, string> = {
    roleplay: `[${dealershipName} Training] A customer says: "I found this car $2,000 cheaper at another dealership." How would you respond?`,
    quiz: `[${dealershipName} Training] Quick quiz: What are the top 3 features you should highlight when presenting the safety package on our best-selling SUV?`,
    objection: `[${dealershipName} Training] The customer says: "I need to think about it and talk to my spouse." What's your best response?`,
  };
  return questions[mode] ?? questions.roleplay;
}
