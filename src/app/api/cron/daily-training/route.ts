// Daily training cron — hourly Vercel cron (0 * * * *)
// Build Master: Phase 2A.2 + Phase 4A (Persona Moods + Engagement) + Phase 5 (subscription gating) + Phase 6 (content priority)
// Each invocation: find dealerships where current local hour = configured training hour
// Training runs Monday-Friday ONLY. No weekends.
// Phase 6 content priority: Manager Quick-Create > Peer Challenge > Chain Step > Daily Challenge > Adaptive
//
// H-007 TIMEZONE LIMITATION: Vercel Hobby plan (free) only allows one cron job per interval.
// This cron fires at 0 13 UTC (1pm UTC = 6am Pacific).
// getDealershipsReadyForTraining() filters by local_hour to cover all timezones, but misses dealerships
// that should train at hours other than when this cron fires.
// SOLUTION: Upgrade to Vercel Pro ($20/mo) for hourly cron flexibility (allows multiple cron rules).

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { isWithinSendWindow, isWeekday } from '@/lib/quiet-hours';
import { sendSms } from '@/lib/sms';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { selectContent } from '@/lib/training/content-priority';
import { markScenarioPushed } from '@/lib/manager-create/generate';
import { continueChain, startChain, getActiveChain } from '@/lib/chains/lifecycle';
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
  getEmployeePriorityVector,
} from '@/lib/service-db';
import {
  selectPersonaMood,
  buildPersonaContext,
  getStreakMilestone,
} from '@/lib/persona-moods';
import {
  selectTrainingDomain,
} from '@/lib/adaptive-weighting';
import {
  isScheduledOff,
} from '@/lib/schedule-awareness';
import { serviceClient } from '@/lib/supabase/service';
import type { PersonaMood } from '@/lib/persona-moods';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dealerships = await getDealershipsReadyForTraining();

  const results: Array<{ dealershipId: string; sent: number; skipped: number; errors: number; contentTypes: Record<string, number> }> = [];

  for (const dealership of dealerships) {
    // Phase 5: Skip dealerships without active subscription
    const subCheck = await checkSubscriptionAccess(dealership.id);
    if (!subCheck.allowed) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0, contentTypes: {} });
      continue;
    }

    if (!isWeekday(dealership.timezone)) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0, contentTypes: {} });
      continue;
    }

    if (!isWithinSendWindow(dealership.timezone)) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0, contentTypes: {} });
      continue;
    }

    // M-007: Dedup check — skip if cron already processed this dealership recently
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentSends } = await serviceClient
      .from('sms_transcript_log')
      .select('id', { count: 'exact', head: true })
      .eq('dealership_id', dealership.id)
      .eq('direction', 'outbound')
      .gte('created_at', oneHourAgo);
    if ((recentSends ?? 0) > 0) {
      results.push({ dealershipId: dealership.id, sent: 0, skipped: 0, errors: 0, contentTypes: {} });
      continue;
    }

    const personaMoodsEnabled = await isFeatureEnabled(dealership.id, 'persona_moods_enabled');

    const eligible = await getEligibleUsers(dealership.id);
    let sent = 0;
    let skipped = 0;
    let errors = 0;
    const contentTypes: Record<string, number> = {};

    for (const user of eligible) {
      try {
        // Phase 4C: Check if user is scheduled off
        const scheduledOff = await isScheduledOff(user.id, dealership.id, new Date());
        if (scheduledOff) {
          skipped++;
          continue;
        }

        // H-002: Check message cap (3/day)
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
        const { count: outboundCount } = await serviceClient
          .from('sms_transcript_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('direction', 'outbound')
          .gte('created_at', todayStart);
        if ((outboundCount ?? 0) >= 3) {
          skipped++;
          continue;
        }

        // Phase 6: Content priority system
        const content = await selectContent(user.id, dealership.id);
        contentTypes[content.type] = (contentTypes[content.type] ?? 0) + 1;

        const firstName = extractFirstName(user.full_name);
        let question: string;
        let mode: string;
        let trainingDomain: string | undefined;
        let personaMood: PersonaMood | null = null;
        let challengeId: string | undefined;
        let chainId: string | undefined;
        let chainStep: number | undefined;

        if (content.type === 'manager_scenario' && content.scenarioText) {
          // Priority 1: Manager Quick-Create
          question = content.scenarioText;
          mode = 'roleplay';
          trainingDomain = content.taxonomyDomain;
          // M-009: Mark scenario as pushed immediately to prevent NOW from pushing same scenario
          if (content.sourceId) {
            await markScenarioPushed(content.sourceId);
          }
        } else if (content.type === 'peer_challenge' && content.scenarioText) {
          // Priority 2: Peer challenge — already active, skip cron send (handled by webhook)
          skipped++;
          continue;
        } else if (content.type === 'chain_step') {
          // Priority 3: Scenario chain continuation
          try {
            const activeChain = await getActiveChain(user.id);
            if (activeChain) {
              const chainResult = await continueChain(activeChain);
              if (chainResult) {
                question = chainResult.scenarioText;
                mode = 'roleplay';
                trainingDomain = chainResult.taxonomyDomain;
                chainId = activeChain.id;
                chainStep = activeChain.currentStep + 1;
              } else {
                // Chain complete or error — fall through to adaptive
                question = getTrainingQuestion(selectTrainingMode());
                mode = selectTrainingMode();
                try {
                  trainingDomain = await selectTrainingDomain(user.id, dealership.id);
                } catch { /* fallback */ }
              }
            } else {
              // No active chain — try to start one
              const chainsEnabled = await isFeatureEnabled(dealership.id, 'scenario_chains_enabled');
              if (chainsEnabled) {
                const tenureWeeks = await getUserTenureWeeks(user.id);
                const vector = await getEmployeePriorityVector(user.id, dealership.id);
                const weakest = vector
                  ? Object.entries(vector).sort(([, a], [, b]) => (b as number) - (a as number)).map(([k]) => k).slice(0, 2)
                  : ['objection_handling'];
                const chainStart = await startChain(user.id, dealership.id, weakest, tenureWeeks);
                if (chainStart) {
                  question = chainStart.scenarioText;
                  mode = 'roleplay';
                  trainingDomain = chainStart.taxonomyDomain;
                  chainId = chainStart.chainId;
                  chainStep = 1;
                } else {
                  // No templates available — fall through
                  question = getTrainingQuestion(selectTrainingMode());
                  mode = selectTrainingMode();
                }
              } else {
                question = getTrainingQuestion(selectTrainingMode());
                mode = selectTrainingMode();
              }
            }
          } catch (chainErr) {
            console.error(`Chain error for ${user.id}:`, chainErr);
            question = getTrainingQuestion(selectTrainingMode());
            mode = selectTrainingMode();
          }
        } else if (content.type === 'daily_challenge' && content.scenarioText) {
          // Priority 4: Daily challenge
          question = content.scenarioText;
          mode = 'roleplay';
          trainingDomain = content.taxonomyDomain;
          personaMood = content.personaMood as PersonaMood | null;
          challengeId = content.challengeId;
        } else {
          // Priority 5: Adaptive-weighted standalone scenario
          mode = selectTrainingMode();
          try {
            trainingDomain = await selectTrainingDomain(user.id, dealership.id);
          } catch {
            // Graceful degradation
          }

          // Persona mood selection
          if (personaMoodsEnabled) {
            try {
              const tenureWeeks = await getUserTenureWeeks(user.id);
              const moodSelection = selectPersonaMood(tenureWeeks);
              personaMood = moodSelection.mood;
            } catch { /* fallback */ }
          }

          const baseQuestion = getTrainingQuestion(mode);
          const personaContext = buildPersonaContext(personaMood, '');
          question = baseQuestion + personaContext;
        }

        // Streak milestone prefix
        let streakPrefix = '';
        try {
          const streak = await getUserStreak(user.id, dealership.id);
          const milestone = getStreakMilestone(streak);
          if (milestone) streakPrefix = milestone + ' ';
        } catch { /* skip */ }

        // Build final SMS
        const greeting = firstName ? `Hey ${firstName}, ` : '';
        const fullQuestion = `${streakPrefix}${greeting}${question}`;

        // Create session
        const session = await createConversationSession({
          userId: user.id,
          dealershipId: dealership.id,
          mode,
          questionText: fullQuestion,
          personaMood,
          trainingDomain,
          challengeId,
          scenarioChainId: chainId,
          chainStep,
        });

        // Send SMS
        const sinchResponse = await sendSms(user.phone, fullQuestion);

        await updateSessionStatus(session.id, 'active');

        await insertTranscriptLog({
          userId: user.id,
          dealershipId: dealership.id,
          direction: 'outbound',
          messageBody: fullQuestion,
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
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error(`Failed to send training to ${user.id}:`, err);
        errors++;
      }
    }

    results.push({ dealershipId: dealership.id, sent, skipped, errors, contentTypes });
  }

  return NextResponse.json({
    dealerships: dealerships.length,
    results,
  });
}

// --- Training mode rotation ---
const MODES = ['roleplay', 'quiz', 'objection'] as const;

function selectTrainingMode(): string {
  const now = new Date();
  const dayOfYear = Math.floor(
    (Date.now() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000
  );
  const weekdayCount = Math.floor(dayOfYear * 5 / 7);
  return MODES[weekdayCount % MODES.length];
}

function getTrainingQuestion(mode: string): string {
  const questions: Record<string, string> = {
    roleplay: `I found this exact car listed for $2,000 less across town. Can you match that price or should I just go there?`,
    quiz: `Quick -- what are the top 3 safety features on our best-selling SUV? Name them like you're talking to a customer.`,
    objection: `I really like it, but I need to think about it and talk to my spouse first. Can you hold it for me?`,
  };
  return questions[mode] ?? questions.roleplay;
}

function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
}
