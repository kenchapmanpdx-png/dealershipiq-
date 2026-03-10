// Manager daily digest cron — sends digest SMS to managers
// Runs at 8 AM local time in each dealership's timezone
// Build Master: Phase 3

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
import {
  getDealershipsByTimezoneHour,
  getManagersForDealership,
  getDailyDigestStats,
  insertTranscriptLog,
} from '@/lib/service-db';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find dealerships where current local hour = 8 AM (digest time)
  const dealerships = await getDealershipsByTimezoneHour(8);

  const results: Array<{
    dealershipId: string;
    dealershipName: string;
    managersNotified: number;
    errors: number;
  }> = [];

  for (const dealership of dealerships) {
    let managersNotified = 0;
    let errors = 0;

    try {
      // Get managers for this dealership
      const managers = await getManagersForDealership(dealership.id);

      if (managers.length === 0) {
        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          managersNotified: 0,
          errors: 0,
        });
        continue;
      }

      // Get yesterday's stats
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDateStr = yesterday.toISOString().split('T')[0];

      const stats = await getDailyDigestStats(dealership.id, yesterdayDateStr);

      // Format digest message
      const digestMessage = formatDigestMessage(
        dealership.name,
        stats
      );

      // Send to each manager
      for (const manager of managers) {
        try {
          const smsResponse = await sendSms(manager.phone, digestMessage);

          // Log outbound
          await insertTranscriptLog({
            userId: manager.id,
            dealershipId: dealership.id,
            direction: 'outbound',
            messageBody: digestMessage,
            sinchMessageId: smsResponse.message_id,
            phone: manager.phone,
          });

          managersNotified++;

          // Stagger sends (50ms between = 20/sec)
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
      });
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
      });
    }
  }

  return NextResponse.json({
    dealerships: dealerships.length,
    results,
  });
}

interface DigestStats {
  completionRate: number;
  totalSessions: number;
  completedSessions: number;
  topPerformer: { fullName: string; score: number } | null;
  lowestPerformer: { fullName: string; score: number } | null;
  avgScores: Record<string, number>;
}

function formatDigestMessage(dealershipName: string, stats: DigestStats): string {
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

  const avgAccuracy = Math.round((stats.avgScores.product_accuracy ?? 0) * 10) / 10;
  const avgTone = Math.round((stats.avgScores.tone_rapport ?? 0) * 10) / 10;

  lines.push(
    `Avg Accuracy: ${avgAccuracy}, Rapport: ${avgTone}`
  );

  // Keep under 160 chars (GSM-7 single SMS)
  let message = lines.join(' | ');
  if (message.length > 160) {
    message = lines.slice(0, -1).join(' | ');
    if (message.length > 160) {
      message = `${dealershipName}: ${stats.completedSessions}/${stats.totalSessions} completed. Top: ${stats.topPerformer?.fullName ?? 'N/A'}`;
    }
  }

  return message;
}
