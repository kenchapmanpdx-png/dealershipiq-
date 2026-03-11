// Daily training cron — hourly Vercel cron (0 * * * *)
// Build Master: Phase 2A.2 + Phase 4A (Persona Moods + Engagement)
// Each invocation: find dealerships where current local hour = configured training hour
// Training runs Monday-Friday ONLY. No weekends.
// Stagger sends 5-15 min per dealership to avoid carrier rate limits

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { isWithinSendWindow, isWeekday } from '@/lib/quiet-hours';
import { sendSms } from '@/lib/sms';
import {
  getDealershipsReadyForTraining,
  getEligibleUsers,
  createConversationSession,
  updateSessionStatus,
  insertTranscriptLog,
  insertDeliveryLog,
  isFeatureEnabled,
  getUserTenureWeeks,
  getUserStreak,
} from '@/lib/service-db';
import {
  selectPersonaMood,
  buildPersonaContext,
  getStreakMilestone,
} from '@/lib/persona-moods';
import type { PersonaMood } from '@/lib/persona-moods';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find dealerships where current local hour = their configured training_send_hour
  const dealerships = await getDealershipsReadyForTraining();

  const results: Array<{ dealershipId: string; sent: number; skipped: number; errors: number }> = [];

  for (const dealership of dealerships) {
    // Skip weekends — training is Mon-Fri only
    if (!isWeekday(dealership.timezone)) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    // Double-check send window (handles edge cases around DST transitions)
    if (!isWithinSendWindow(dealership.timezone)) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0 });
      continue;
    }

    // Phase 4A: Check feature flags for this dealership
    const personaMoodsEnabled = await isFeatureEnabled(dealership.id, 'persona_moods_enabled');

    const eligible = await getEligibleUsers(dealership.id);
    let sent = 0;
    const skipped = 0;
    let errors = 0;

    for (const user of eligible) {
      try {
        const mode = selectTrainingMode();
        const firstName = extractFirstName(user.full_name);

        // Phase 4A: Persona mood selection (tenure-based)
        let personaMood: PersonaMood | null = null;
        let moodSetupHint = '';

        if (personaMoodsEnabled) {
          try {
            const tenureWeeks = await getUserTenureWeeks(user.id);
            const moodSelection = selectPersonaMood(tenureWeeks);
            personaMood = moodSelection.mood;
            moodSetupHint = moodSelection.setupHint;
          } catch (moodErr) {
            console.error(`Persona mood selection failed for ${user.id}:`, moodErr);
            // Fall through without mood — graceful degradation
          }
        }

        // Phase 4A: Streak milestone
        let streakPrefix = '';
        try {
          const streak = await getUserStreak(user.id, dealership.id);
          const milestone = getStreakMilestone(streak);
          if (milestone) {
            streakPrefix = milestone + ' ';
          }
        } catch {
          // Non-critical — skip streak
        }

        // Build the training question with persona context
        const baseQuestion = getTrainingQuestion(mode);
        const personaContext = buildPersonaContext(personaMood, moodSetupHint);

        // Build the full SMS message
        // Format: "[streak] Hey {first_name}, [question][persona_context]"
        const greeting = firstName ? `Hey ${firstName}, ` : '';
        const question = `${streakPrefix}${greeting}${baseQuestion}${personaContext}`;

        // Create session in pending state
        const session = await createConversationSession({
          userId: user.id,
          dealershipId: dealership.id,
          mode,
          questionText: question,
          personaMood,
        });

        // Send SMS
        const sinchResponse = await sendSms(user.phone, question);

        // Transition: pending → active
        await updateSessionStatus(session.id, 'active');

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
// Weekday-based rotation (skips weekends)
const MODES = ['roleplay', 'quiz', 'objection'] as const;

function selectTrainingMode(): string {
  // Weekday-based rotation: count weekdays since epoch
  const now = new Date();
  const dayOfYear = Math.floor(
    (Date.now() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  // Approximate weekday count (close enough for rotation)
  const weekdayCount = Math.floor(dayOfYear * 5 / 7);
  return MODES[weekdayCount % MODES.length];
}

function getTrainingQuestion(mode: string): string {
  // TODO: Replace with prompt_versions table lookup + priority vector selection
  // Questions are written as if the customer is talking directly to the salesperson.
  // No meta-framing, no labels, no "How would you respond?" — just the customer's words.
  const questions: Record<string, string> = {
    roleplay: `I found this exact car listed for $2,000 less across town. Can you match that price or should I just go there?`,
    quiz: `Quick — what are the top 3 safety features on our best-selling SUV? Name them like you're talking to a customer.`,
    objection: `I really like it, but I need to think about it and talk to my spouse first. Can you hold it for me?`,
  };
  return questions[mode] ?? questions.roleplay;
}

/**
 * Extract first name from full name. Returns empty string if no name available.
 */
function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
}
