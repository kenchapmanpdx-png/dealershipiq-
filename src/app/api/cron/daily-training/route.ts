// Daily training cron — runs every hour (0 * * * *), Vercel Pro
// Each invocation: find dealerships where current local hour = configured training hour
// Training runs Monday-Friday ONLY. No weekends.
// Phase 6 content priority: Manager Quick-Create > Peer Challenge > Chain Step > Daily Challenge > Adaptive
// v7: Replaced 3-question hardcoded fallback with 30-scenario brand-agnostic pool

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
  getActiveSession,
  getOutboundCountToday,
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

// =============================================================================
// SCENARIO FALLBACK POOL (v7)
// 30 brand-agnostic scenarios — replaces the old 3-question hardcoded fallback.
// When vehicle_data_enabled is on, the training-content pipeline injects real specs.
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

function getTrainingQuestion(mode: string): string {
  const pool = SCENARIO_POOL[mode] ?? SCENARIO_POOL.roleplay;
  return pool[Math.floor(Math.random() * pool.length)];
}

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

    const eligible = await getEligibleUsers(dealership.id, dealership.timezone);
    let sent = 0;
    let skipped = 0;
    let errors = 0;
    const contentTypes: Record<string, number> = {};

    for (const user of eligible) {
      try {
        // X-001: Skip if user already has an active session (e.g. from ACCEPT)
        const existingSession = await getActiveSession(user.id, dealership.id);
        if (existingSession) {
          skipped++;
          continue;
        }

        // H2: Per-user/day dedup — skip if we already sent training to this user today
        // (catches edge cases where dealership-level dedup passes but user already trained)
        const outboundToday = await getOutboundCountToday(user.id, dealership.timezone);
        if (outboundToday > 0) {
          skipped++;
          continue;
        }

        // Phase 4C: Check if user is scheduled off
        const scheduledOff = await isScheduledOff(user.id, dealership.id, new Date(), dealership.timezone ?? 'America/New_York');
        if (scheduledOff) {
          skipped++;
          continue;
        }

        // H-002: Message cap (3/day) already covered by H2 dedup above (outboundToday > 0)
        // The 3/day cap matters for trainee mode (push-training), not daily cron.

        // Phase 6: Content priority system
        const content = await selectContent(user.id, dealership.id, dealership.timezone ?? 'America/New_York');
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
          // X-003: Atomic CAS — skip if NOW handler already pushed this scenario
          if (content.sourceId) {
            const claimed = await markScenarioPushed(content.sourceId);
            if (!claimed) {
              skipped++;
              continue;
            }
          }
          question = content.scenarioText;
          mode = 'roleplay';
          trainingDomain = content.taxonomyDomain;
        } else if (content.type === 'peer_challenge' && content.scenarioText) {
          // Priority 2: Peer challenge — already active, skip cron send (handled by webhook)
          skipped++;
          continue;
        } else if (content.type === 'chain_step') {
          // Priority 3: Scenario chain continuation
          try {
            const activeChain = await getActiveChain(user.id, dealership.id);
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
                mode = selectTrainingMode();
                question = getTrainingQuestion(mode);
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
                  mode = selectTrainingMode();
                  question = getTrainingQuestion(mode);
                }
              } else {
                mode = selectTrainingMode();
                question = getTrainingQuestion(mode);
              }
            }
          } catch (chainErr) {
            console.error(`Chain error for ${user.id}:`, (chainErr as Error).message ?? chainErr);
            mode = selectTrainingMode();
            question = getTrainingQuestion(mode);
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
        console.error(`Failed to send training to ${user.id}:`, (err as Error).message ?? err);
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

function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || '';
}