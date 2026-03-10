import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getDealershipsByTimezoneHour } from '@/lib/service-db';
import {
  createDailyChallenge,
  generateChallengeScenario,
  getChallengeResults,
  getTopPerformers,
  formatTopPerformersMessage,
} from '@/lib/daily-challenge';
import { getDailyChallengeByChallengeDate } from '@/lib/service-db';
import { sendSms } from '@/lib/sms';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes

/**
 * Daily Challenge Cron
 *
 * Runs hourly. Each invocation checks all dealership timezones.
 *
 * Morning run (9 AM local): Creates today's challenge + sends to all eligible employees
 * Evening run (8 PM local): Grades responses + texts top 3 performers
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const currentHour = now.getUTCHours();
    const todayDate = now.toISOString().split('T')[0];

    // Get dealerships in timezone windows
    // Morning: 9 AM local = varies by timezone offset
    // Evening: 8 PM local = varies by timezone offset

    const dealershipsByHour = await getDealershipsByTimezoneHour(currentHour);

    const results = {
      morning: {
        created: 0,
        sent: 0,
        failed: 0,
      },
      evening: {
        graded: 0,
        messagesent: 0,
        failed: 0,
      },
    };

    for (const dealership of dealershipsByHour) {
      try {
        // Determine if this is morning (9 AM) or evening (8 PM)
        // Based on dealership timezone and current UTC time
        const dealershipHour = getLocalHourForDealership(now, dealership.timezone);
        const isMorning = dealershipHour === 9;
        const isEvening = dealershipHour === 20;

        if (isMorning) {
          // Morning: Create challenge and send to team
          await handleMorningChallenge(dealership, todayDate, results);
        } else if (isEvening) {
          // Evening: Grade responses and send top 3
          await handleEveningChallenge(dealership, todayDate, results);
        }
      } catch (error) {
        console.error(
          `Error processing daily challenge for dealership ${dealership.id}:`,
          error
        );
        results.morning.failed++;
        results.evening.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: now.toISOString(),
      results,
    });
  } catch (error) {
    console.error('Daily challenge cron error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function handleMorningChallenge(
  dealership: Record<string, unknown>,
  todayDate: string,
  results: Record<string, unknown>
): Promise<void> {
  // Check if challenge already exists for today
  const existing = await getDailyChallengeByChallengeDate(dealership.id as string, todayDate);

  if (!existing) {
    // Create new challenge
    const scenario = await generateChallengeScenario(dealership.id as string);
    await createDailyChallenge(dealership.id as string, scenario);
  }

  // Get eligible users for this dealership
  const { getEligibleUsersForChallenge } = await import('@/lib/service-db');
  const eligibleUsers = await getEligibleUsersForChallenge(dealership.id as string);

  // Send challenge to each employee
  for (const user of eligibleUsers) {
    try {
      const message = `🏆 Daily Challenge from ${dealership.name}

Check your skills against your team!

[Challenge text sent separately due to SMS length limits]

Reply with your answer and earn points on today's leaderboard.`;

      await sendSms(user.phone as string, message);
      (results.morning as Record<string, number>).sent++;
    } catch (error) {
      console.error(`Failed to send challenge SMS to ${user.phone}:`, error);
      (results.morning as Record<string, number>).failed++;
    }
  }

  (results.morning as Record<string, number>).created++;
}

async function handleEveningChallenge(
  dealership: Record<string, unknown>,
  todayDate: string,
  results: Record<string, unknown>
): Promise<void> {
  // Get today's challenge
  const challenge = await getDailyChallengeByChallengeDate(dealership.id as string, todayDate);

  if (!challenge) {
    // No challenge today, skip
    return;
  }

  // Get results and top performers
  const allResults = await getChallengeResults(challenge.id as string);
  const topThree = await getTopPerformers(challenge.id as string, 3);

  if (topThree.length === 0) {
    // No submissions, skip
    return;
  }

  // Get eligible users to send top 3 message to everyone
  const { getEligibleUsersForChallenge } = await import('@/lib/service-db');
  const eligibleUsers = await getEligibleUsersForChallenge(dealership.id as string);

  const leaderboardMessage = formatTopPerformersMessage(dealership.name as string, topThree, todayDate);

  // Send to all team members
  for (const user of eligibleUsers) {
    try {
      await sendSms(user.phone as string, leaderboardMessage);
      (results.evening as Record<string, number>).messagesent++;
    } catch (error) {
      console.error(
        `Failed to send evening leaderboard message to ${user.phone}:`,
        error
      );
      (results.evening as Record<string, number>).failed++;
    }
  }

  (results.evening as Record<string, number>).graded = allResults.length;
}

/**
 * Get local hour for a dealership given UTC time and timezone
 * Simplified: assumes timezone is IANA string like "America/New_York"
 */
function getLocalHourForDealership(utcDate: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      hour12: false,
      timeZone: timezone,
    });

    const parts = formatter.formatToParts(utcDate);
    const hour = parts.find((p) => p.type === 'hour');

    return hour ? parseInt(hour.value, 10) : utcDate.getUTCHours();
  } catch {
    return utcDate.getUTCHours();
  }
}
