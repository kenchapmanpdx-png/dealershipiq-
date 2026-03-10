// Red flag detection cron — identifies at-risk reps
// Runs every 6 hours
// Build Master: Phase 3
// Detects: no response >3 days, completion rate <30%, score decline >40%, gone dark

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
import {
  getRedFlagUsers,
  getManagersForDealership,
  insertTranscriptLog,
} from '@/lib/service-db';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Run for all dealerships (not timezone-gated — this runs every 6h globally)
  const { data: dealerships, error } = await (
    await import('@/lib/supabase/service')
  ).serviceClient
    .from('dealerships')
    .select('id, name');

  if (error) {
    console.error('Failed to fetch dealerships:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dealerships' },
      { status: 500 }
    );
  }

  const results: Array<{
    dealershipId: string;
    dealershipName: string;
    flaggedUsers: number;
    alertsSent: number;
    errors: number;
  }> = [];

  for (const dealership of dealerships ?? []) {
    let flaggedUsers = 0;
    let alertsSent = 0;
    let errors = 0;

    try {
      // Get red flag users for this dealership
      const flaggedList = await getRedFlagUsers(dealership.id);
      flaggedUsers = flaggedList.length;

      if (flaggedList.length === 0) {
        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          flaggedUsers: 0,
          alertsSent: 0,
          errors: 0,
        });
        continue;
      }

      // Get managers for this dealership
      const managers = await getManagersForDealership(dealership.id);

      if (managers.length === 0) {
        results.push({
          dealershipId: dealership.id,
          dealershipName: dealership.name,
          flaggedUsers,
          alertsSent: 0,
          errors: 0,
        });
        continue;
      }

      // Alert each manager about flagged reps
      for (const manager of managers) {
        try {
          const alertMessage = formatAlertMessage(
            dealership.name,
            flaggedList
          );

          const smsResponse = await sendSms(manager.phone, alertMessage);

          await insertTranscriptLog({
            userId: manager.id,
            dealershipId: dealership.id,
            direction: 'outbound',
            messageBody: alertMessage,
            sinchMessageId: smsResponse.message_id,
            phone: manager.phone,
            metadata: {
              alert_type: 'red_flag',
              flagged_count: flaggedList.length,
            },
          });

          alertsSent++;

          // Stagger
          await new Promise((r) => setTimeout(r, 50));
        } catch (err) {
          console.error(
            `Failed to send alert to manager ${manager.id}:`,
            err
          );
          errors++;
        }
      }

      results.push({
        dealershipId: dealership.id,
        dealershipName: dealership.name,
        flaggedUsers,
        alertsSent,
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
        flaggedUsers: 0,
        alertsSent: 0,
        errors: 1,
      });
    }
  }

  return NextResponse.json({
    dealerships: dealerships?.length ?? 0,
    results,
  });
}

interface FlaggedUser {
  id: string;
  fullName: string;
  phone: string;
  flags: string[];
}

function formatAlertMessage(dealershipName: string, flaggedUsers: FlaggedUser[]): string {
  if (flaggedUsers.length === 1) {
    const user = flaggedUsers[0];
    const reasons = user.flags.join(', ');
    return `${dealershipName}: ${user.fullName} needs attention (${reasons}). Check dashboard for details.`;
  }

  const names = flaggedUsers.slice(0, 2).map((u) => u.fullName);
  const remaining = flaggedUsers.length - 2;
  const suffix = remaining > 0 ? ` +${remaining} more` : '';

  return `${dealershipName}: ${names.join(', ')}${suffix} flagged. Review dashboard.`;
}
