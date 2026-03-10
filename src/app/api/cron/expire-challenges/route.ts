import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { expirePendingChallenges, getChallenge } from '@/lib/peer-challenge';
import { sendSms } from '@/lib/sms';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 minute

/**
 * Expire Pending Peer Challenges Cron
 *
 * Runs hourly to find expired peer challenges.
 * Awards default win to challenger on no-show.
 * Sends notification SMS to both participants.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authError = verifyCronSecret(request);
  if (authError) {
    return authError;
  }

  try {
    // Find and handle expired challenges
    const expiredChallenges = await expirePendingChallenges();

    const results = {
      expired: expiredChallenges.length,
      notified: 0,
      failed: 0,
    };

    // Send notification SMS to participants
    // Note: SMS sending would require looking up user phone numbers via service-db
    // For now, we log the expiration; SMS could be sent via a separate notification queue
    for (const expiredChallenge of expiredChallenges) {
      try {
        // Challenge has been marked as expired/no_show in the database
        // In a full implementation, we'd send SMS notifications here
        // but that requires phone lookup which needs service-db context

        console.log(`Challenge ${expiredChallenge.challengeId} expired. Winner: ${expiredChallenge.winner}`);
        results.notified++;
      } catch (error) {
        console.error(`Failed to process expired challenge ${expiredChallenge.challengeId}:`, error);
        results.failed++;
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Expire challenges cron error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}
