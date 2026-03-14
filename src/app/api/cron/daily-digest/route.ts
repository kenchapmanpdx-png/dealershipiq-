// Manager daily digest / morning meeting script cron — runs every hour (0 * * * *), Vercel Pro
// Fires where local_hour = 7 (brief arrives before 8am meeting).
// Phase 4.5B: morning_script_enabled → morning meeting script format.
//             morning_script_enabled = false → old-style daily digest (backward compatible).

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { getLocalYesterdayString, isLocalMonday } from '@/lib/quiet-hours';
import {
  getDealershipsByTimezoneHour,
  getManagersForDealership,
  getDailyDigestStats,
  insertTranscriptLog,
  isFeatureEnabled,
} from '@/lib/service-db';
import { serviceClient } from '@/lib/supabase/service';
import {
  getShoutout,
  getTeamGap,
  getCoachingFocus,
  getAtRiskReps,
  getTeamNumbers,
} from '@/lib/meeting-script/queries';
import { getBenchmark } from '@/lib/meeting-script/benchmark';
import { buildMeetingSMS, buildFullScript } from '@/lib/meeting-script/assemble';
import type { MeetingScriptData } from '@/types/meeting-script';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Changed from hour 8 → 7: brief arrives 1 hour before the typical 8am meeting
  const dealerships = await getDealershipsByTimezoneHour(7);

  const results: Array<{
    dealershipId: string;
    dealershipName: string;
    managersNotified: number;
    errors: number;
    format: 'morning_script' | 'legacy_digest';
  }> = [];

  for (const dealership of dealerships) {
    let managersNotified = 0;
    let errors = 0;

    try {
      // Phase 5: Skip dealerships without active subscription
      const subCheck = await checkSubscriptionAccess(dealership.id);
      if (!subCheck.allowed) {
        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          managersNotified: 0,
          errors: 0,
          format: 'legacy_digest',
        });
        continue;
      }

      const managers = await getManagersForDealership(dealership.id);

      if (managers.length === 0) {
        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          managersNotified: 0,
          errors: 0,
          format: 'legacy_digest',
        });
        continue;
      }

      // Check morning_script_enabled feature flag
      const morningScriptEnabled = await isFeatureEnabled(
        dealership.id,
        'morning_script_enabled'
      );

      if (morningScriptEnabled) {
        // --- Morning Meeting Script (Phase 4.5B) ---
        const { sent, errs } = await generateAndSendMorningScript(
          dealership.id,
          dealership.name,
          managers
        );
        managersNotified = sent;
        errors = errs;

        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          managersNotified,
          errors,
          format: 'morning_script',
        });
      } else {
        // --- Legacy Daily Digest (backward compatible) ---
        // C-004 fix: Use dealership local timezone for "yesterday"
        const yesterdayDateStr = getLocalYesterdayString(dealership.timezone ?? 'America/New_York');

        const stats = await getDailyDigestStats(
          dealership.id,
          yesterdayDateStr
        );
        const digestMessage = formatDigestMessage(dealership.name, stats);

        for (const manager of managers) {
          try {
            const smsResponse = await sendSms(manager.phone, digestMessage);
            await insertTranscriptLog({
              userId: manager.id,
              dealershipId: dealership.id,
              direction: 'outbound',
              messageBody: digestMessage,
              sinchMessageId: smsResponse.message_id,
              phone: manager.phone,
            });
            managersNotified++;
            await new Promise((r) => setTimeout(r, 50));
          } catch (err) {
            console.error(
              `Failed to send digest to manager ${manager.id}:`,
              err
            );
            errors++;
          }
        }

        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          managersNotified,
          errors,
          format: 'legacy_digest',
        });
      }
    } catch (err) {
      console.error(
        `Error processing dealership ${dealership.id}:`,
        err
      );
      results.push({
        dealershipId: dealership.id,
        dealershipName: dealership.name,
        managersNotified: 0,
        errors: 1,
        format: 'legacy_digest',
      });
    }
  }

  // --- Weekly Micro-Insight (Monday only) ---
  let microInsightsSent = 0;

  // C-004 fix: Check Monday per-dealership in local timezone (not global UTC)
  for (const dealership of dealerships) {
    const isMondayLocal = isLocalMonday(dealership.timezone ?? 'America/New_York');
    if (!isMondayLocal) continue;

    // Micro-insight processing for this dealership only
    try {
      const coachEnabled = await isFeatureEnabled(dealership.id, 'coach_mode_enabled');
      if (!coachEnabled) continue;

      const { data: coachUsers } = await serviceClient
        .from('coach_sessions')
        .select('user_id')
        .eq('dealership_id', dealership.id);

      const userIdSet = new Set((coachUsers ?? []).map((u) => u.user_id as string));
      const uniqueUserIds: string[] = [];
      userIdSet.forEach((id) => uniqueUserIds.push(id));

      for (const userId of uniqueUserIds) {
        try {
          const insight = await findPositiveInsight(userId, dealership.id);
          if (!insight) continue;

          const { data: user } = await serviceClient
            .from('users')
            .select('phone')
            .eq('id', userId)
            .single();

          if (!user?.phone) continue;

          await closeStaleCoachSessions(userId);

          const msg = `Quick note from your Coach: ${insight}. Reply COACH anytime.`;
          await sendSms(user.phone as string, msg);
          await insertTranscriptLog({
            userId,
            dealershipId: dealership.id,
            phone: user.phone as string,
            direction: 'outbound',
            messageBody: msg,
          });
          microInsightsSent++;
        } catch (err) {
          console.error(`Micro-insight error for user ${userId}:`, err);
        }
      }
    } catch (err) {
      console.error(`Micro-insight error for dealership ${dealership.id}:`, err);
    }
  }

  return NextResponse.json({
    dealerships: dealerships.length,
    results,
    microInsightsSent,
  });
}

// --- Morning Meeting Script Generation ---

interface ManagerUser {
  id: string;
  full_name: string;
  phone: string;
  role: string;
}

async function generateAndSendMorningScript(
  dealershipId: string,
  dealershipName: string,
  managers: ManagerUser[]
): Promise<{ sent: number; errs: number }> {
  let sent = 0;
  let errs = 0;

  try {
    // Run all 6 data queries in parallel
    const [shoutout, gap, coachingFocus, atRisk, numbers, benchmark] =
      await Promise.all([
        getShoutout(dealershipId),
        getTeamGap(dealershipId),
        getCoachingFocus(dealershipId),
        getAtRiskReps(dealershipId),
        getTeamNumbers(dealershipId),
        getBenchmark(dealershipId),
      ]);

    const scriptData: MeetingScriptData = {
      dealershipName,
      shoutout,
      gap,
      coachingFocus: coachingFocus,
      atRisk,
      numbers,
      benchmark,
    };

    // Check if there is any data at all (new dealership edge case)
    const hasData =
      shoutout ||
      gap ||
      coachingFocus ||
      atRisk.length > 0 ||
      numbers.completion_rate > 0;

    let smsText: string;
    let fullScript;

    if (!hasData) {
      // New dealership with no training data
      smsText = `Morning Intel - ${dealershipName}. No training data yet. Get your team started today!`;
      fullScript = buildFullScript(scriptData);
    } else {
      smsText = buildMeetingSMS(scriptData);
      fullScript = buildFullScript(scriptData);
    }

    // UPSERT into meeting_scripts
    const todayStr = new Date().toISOString().split('T')[0];

    await serviceClient.from('meeting_scripts').upsert(
      {
        dealership_id: dealershipId,
        script_date: todayStr,
        sms_text: smsText,
        full_script: fullScript,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'dealership_id,script_date' }
    );

    // Send SMS to managers
    for (const manager of managers) {
      try {
        const smsResponse = await sendSms(manager.phone, smsText);
        await insertTranscriptLog({
          userId: manager.id,
          dealershipId,
          direction: 'outbound',
          messageBody: smsText,
          sinchMessageId: smsResponse.message_id,
          phone: manager.phone,
          metadata: { type: 'morning_script' },
        });
        sent++;
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error(
          `Failed to send morning script to manager ${manager.id}:`,
          err
        );
        errs++;
      }
    }
  } catch (err) {
    console.error(`Morning script generation failed for ${dealershipId}:`, err);
    errs++;
  }

  return { sent, errs };
}

// --- Legacy Digest Formatter (backward compatible) ---

interface DigestStats {
  completionRate: number;
  totalSessions: number;
  completedSessions: number;
  topPerformer: { fullName: string; score: number } | null;
  lowestPerformer: { fullName: string; score: number } | null;
  avgScores: Record<string, number>;
}

function formatDigestMessage(
  dealershipName: string,
  stats: DigestStats
): string {
  const lines: string[] = [
    `${dealershipName} Daily Digest`,
    `Completion: ${Math.round(stats.completionRate * 100)}% (${stats.completedSessions}/${stats.totalSessions})`,
  ];

  if (stats.topPerformer) {
    lines.push(
      `Top: ${stats.topPerformer.fullName} (${Math.round(stats.topPerformer.score * 10) / 10})`
    );
  }

  if (stats.lowestPerformer) {
    lines.push(
      `Needs support: ${stats.lowestPerformer.fullName} (${Math.round(stats.lowestPerformer.score * 10) / 10})`
    );
  }

  const avgAccuracy =
    Math.round((stats.avgScores.product_accuracy ?? 0) * 10) / 10;
  const avgTone =
    Math.round((stats.avgScores.tone_rapport ?? 0) * 10) / 10;

  lines.push(`Avg Accuracy: ${avgAccuracy}, Rapport: ${avgTone}`);

  let message = lines.join(' | ');
  if (message.length > 160) {
    message = lines.slice(0, -1).join(' | ');
    if (message.length > 160) {
      message = `${dealershipName}: ${stats.completedSessions}/${stats.totalSessions} completed. Top: ${stats.topPerformer?.fullName ?? 'N/A'}`;
    }
  }

  return message;
}

// --- Weekly Micro-Insight helpers ---

const DOMAIN_LABELS: Record<string, string> = {
  objection_handling: 'objection handling',
  product_knowledge: 'product knowledge',
  closing_technique: 'closing',
  competitive_positioning: 'competitive positioning',
  financing: 'financing',
};

async function findPositiveInsight(
  userId: string,
  dealershipId: string
): Promise<string | null> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  try {
    const { data: recentResults } = await serviceClient
      .from('training_results')
      .select(
        'training_domain, product_accuracy, tone_rapport, addressed_concern, close_attempt'
      )
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!recentResults || recentResults.length === 0) return null;

    const { data: olderResults } = await serviceClient
      .from('training_results')
      .select(
        'training_domain, product_accuracy, tone_rapport, addressed_concern, close_attempt'
      )
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .gte('created_at', fourteenDaysAgo.toISOString())
      .lt('created_at', sevenDaysAgo.toISOString());

    const domainScores: Record<
      string,
      { recent: number[]; older: number[] }
    > = {};

    for (const r of recentResults) {
      const domain = (r.training_domain as string) ?? 'general';
      if (!domainScores[domain])
        domainScores[domain] = { recent: [], older: [] };
      const avg =
        ((r.product_accuracy as number) +
          (r.tone_rapport as number) +
          (r.addressed_concern as number) +
          (r.close_attempt as number)) /
        4;
      domainScores[domain].recent.push(avg);
    }

    for (const r of olderResults ?? []) {
      const domain = (r.training_domain as string) ?? 'general';
      if (!domainScores[domain])
        domainScores[domain] = { recent: [], older: [] };
      const avg =
        ((r.product_accuracy as number) +
          (r.tone_rapport as number) +
          (r.addressed_concern as number) +
          (r.close_attempt as number)) /
        4;
      domainScores[domain].older.push(avg);
    }

    let bestDomain: string | null = null;
    let bestImprovement = 0;

    for (const [domain, scores] of Object.entries(domainScores)) {
      if (scores.recent.length === 0 || scores.older.length === 0) continue;
      const recentAvg =
        scores.recent.reduce((s, v) => s + v, 0) / scores.recent.length;
      const olderAvg =
        scores.older.reduce((s, v) => s + v, 0) / scores.older.length;
      if (olderAvg === 0) continue;
      const pctChange = ((recentAvg - olderAvg) / olderAvg) * 100;
      if (pctChange > 20 && pctChange > bestImprovement) {
        bestImprovement = pctChange;
        bestDomain = domain;
      }
    }

    if (bestDomain) {
      const label = DOMAIN_LABELS[bestDomain] ?? bestDomain;
      return `Your ${label} scores jumped ${Math.round(bestImprovement)}% this week. Whatever you're doing differently, keep going`;
    }

    const allScores = recentResults.map(
      (r) =>
        ((r.product_accuracy as number) +
          (r.tone_rapport as number) +
          (r.addressed_concern as number) +
          (r.close_attempt as number)) /
        4
    );
    const bestScore = Math.max(...allScores);
    if (bestScore >= 4.0) {
      return `You hit a ${bestScore.toFixed(1)}/5 this week — strong work on the floor`;
    }

    return null;
  } catch {
    return null;
  }
}

async function closeStaleCoachSessions(userId: string): Promise<void> {
  try {
    const { data: staleSessions } = await serviceClient
      .from('coach_sessions')
      .select('id')
      .eq('user_id', userId)
      .is('ended_at', null);

    for (const session of staleSessions ?? []) {
      await serviceClient
        .from('coach_sessions')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', session.id as string);
    }
  } catch {
    // Non-critical
  }
}
