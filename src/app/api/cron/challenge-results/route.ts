// Daily challenge EOD results cron — hourly, fires at 5pm local
// Ranks all challenge responses, texts results to participants
// Phase 6B
// C-003: Cron endpoint — service role required, no user JWT in cron context
//
// H-007 TIMEZONE LIMITATION: Vercel Hobby plan (free) only allows one cron job per interval.
// This cron fires once hourly and checks if local_hour === 17 (5pm) for each dealership.
// Works correctly for dealerships configured to publish results at 5pm, but misses other time preferences.
// SOLUTION: Upgrade to Vercel Pro ($20/mo) for hourly cron flexibility.

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
import { serviceClient } from '@/lib/supabase/service';
import { insertTranscriptLog, getOutboundCountToday } from '@/lib/service-db';
import { rankChallengeResponses, buildResultsSMS } from '@/lib/challenges/daily';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const todayStr = new Date().toISOString().split('T')[0];

  // Get all dealerships with active challenges today
  const { data: challenges } = await serviceClient
    .from('daily_challenges')
    .select('id, dealership_id')
    .eq('challenge_date', todayStr)
    .eq('status', 'active');

  if (!challenges || challenges.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  const results: Array<{ dealershipId: string; participationCount: number; resultsSent: number }> = [];

  for (const challenge of challenges) {
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
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          hour12: false,
          timeZone: dealership.timezone as string,
        }).format(new Date())
      );

      if (localHour !== 17) continue;
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

    results.push({ dealershipId, parti