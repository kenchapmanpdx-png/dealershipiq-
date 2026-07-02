// Daily challenge EOD results cron — hourly, fires at 5pm local
// Ranks all challenge responses, texts results to participants
// Phase 6B
// C-003: Cron endpoint — service role required, no user JWT in cron context
//
// 2026-07-02 AUDIT: this route was DESIGNED hourly (localHour === 17 gate)
// but vercel.json scheduled it once daily at 22:00 UTC. 22:00 UTC is 5pm
// only in EST (winter Eastern) — during DST no US timezone matched, so
// results never sent all summer. vercel.json now schedules `0 * * * *`.
//
// Same fix: challenge_date is the UTC date at local-morning creation
// (== the dealership's local date). At 5pm Pacific the UTC date has already
// rolled over, so a `challenge_date = todayUTC` lookup can never match
// Pacific/Mountain-winter challenges. We now fetch both candidate dates and
// match each challenge against its dealership's LOCAL date.

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
import { serviceClient } from '@/lib/supabase/service';
import { insertTranscriptLog, getOutboundCountToday } from '@/lib/service-db';
import { rankChallengeResponses, buildResultsSMS } from '@/lib/challenges/daily';
import { createBudget } from '@/lib/cron-budget';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2026-07-02 AUDIT H2: budget guard. Reruns are safe — the status='active'
  // filter excludes already-completed challenges, so an hourly rerun never
  // re-sends results.
  const budget = createBudget({ maxMs: 55_000, cronName: 'challenge-results' });

  const now = new Date();
  const todayUtc = now.toISOString().split('T')[0];
  const yesterdayUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // Get all active challenges for either candidate date; local-date match below.
  const { data: challenges } = await serviceClient
    .from('daily_challenges')
    .select('id, dealership_id, challenge_date')
    .in('challenge_date', [todayUtc, yesterdayUtc])
    .eq('status', 'active');

  if (!challenges || challenges.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results: Array<{ dealershipId: string; participationCount: number; resultsSent: number }> = [];

  for (const challenge of challenges) {
    if (budget.shouldStop()) break;
    const dealershipId = challenge.dealership_id as string;
    const challengeId = challenge.id as string;

    // Check if it's 5pm local for this dealership
    const { data: dealership } = await serviceClient
      .from('dealerships')
      .select('timezone')
      .eq('id', dealershipId)
      .single();

    if (!dealership?.timezone) continue;

    try {
      const tz = dealership.timezone as string;
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          hour12: false,
          timeZone: tz,
        }).format(now)
      );

      if (localHour !== 17) continue;

      // en-CA locale formats as YYYY-MM-DD — comparable to challenge_date.
      const localDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);

      if ((challenge.challenge_date as string) !== localDate) continue;
    } catch (err) {
      console.warn(
        `Failed to determine local hour for dealership ${dealershipId}:`,
        (err as Error).message ?? err
      );
      continue;
    }

    // Rank responses
    const { results: challengeResults, participationCount } = await rankChallengeResponses(challengeId, dealershipId);

    // Update challenge
    if (participationCount === 0) {
      await serviceClient
        .from('daily_challenges')
        .update({ status: 'no_responses', participation_count: 0 })
        .eq('id', challengeId);

      results.push({ dealershipId, participationCount: 0, resultsSent: 0 });
      continue;
    }

    await serviceClient
      .from('daily_challenges')
      .update({
        results: challengeResults,
        winner_user_id: challengeResults[0]?.user_id ?? null,
        participation_count: participationCount,
        status: 'completed',
      })
      .eq('id', challengeId);

    // Send results SMS to all participants
    const resultsSMS = buildResultsSMS(challengeResults);
    if (!resultsSMS) {
      results.push({ dealershipId, participationCount, resultsSent: 0 });
      continue;
    }

    // Get phones for participants
    const participantIds = challengeResults.map(r => r.user_id);
    const { data: participants } = await serviceClient
      .from('users')
      .select('id, phone')
      .in('id', participantIds);

    let resultsSent = 0;
    for (const p of participants ?? []) {
      if (budget.shouldStop()) break;
      try {
        // X-009: Check message cap before sending results
        const outbound = await getOutboundCountToday(p.id as string, dealership?.timezone as string);
        if (outbound >= 3) continue;

        await sendSms(p.phone as string, resultsSMS);
        await insertTranscriptLog({
          userId: p.id as string,
          dealershipId,
          phone: p.phone as string,
          direction: 'outbound',
          messageBody: resultsSMS,
          metadata: { type: 'challenge_results' },
        });
        resultsSent++;
        await new Promise(r => setTimeout(r, 50));
      } catch (err) {
        console.error(`Failed to send challenge results to ${p.id}:`, (err as Error).message ?? err);
      }
    }

    results.push({ dealershipId, participationCount, resultsSent });
    budget.markProcessed();
  }

  return NextResponse.json({ candidates: challenges.length, results, ...budget.report() });
}
