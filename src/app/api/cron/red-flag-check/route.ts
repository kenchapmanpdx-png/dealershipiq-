// Red flag detection cron — identifies at-risk reps
// Runs every 6 hours
// Build Master: Phase 3, Phase 4.5B (persists to red_flag_events for morning script), Phase 5 (dunning)
// Detects: no response >3 days, completion rate <30%, score decline >40%, gone dark
// C-003: Cron endpoint — service role required, no user JWT in cron context

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { sendSms } from '@/lib/sms';
// H17: processDunning moved to dedicated `dunning-check` cron to avoid
// duplicate-email races when this cron and the dedicated one overlap.
import {
  getRedFlagUsers,
  getManagersForDealership,
  insertTranscriptLog,
} from '@/lib/service-db';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Run for all dealerships (not timezone-gated — this runs every 6h globally).
  //
  // 2026-04-18 L-13 (TODO): At >~500 dealerships this serial loop will hit
  // `maxDuration = 60s`. Upgrade path: paginate by `id > cursor` and fan
  // each page out to an internal worker queue (or a second cron pass)
  // instead of processing everything inline. Also filter to
  // `subscription_status IN ('active','trialing')` so dunning'd or canceled
  // dealerships don't eat the per-run budget.
  const { data: dealerships, error } = await (
    await import('@/lib/supabase/service')
  ).serviceClient
    .from('dealerships')
    .select('id, name');

  if (error) {
    console.error('Failed to fetch dealerships:', (error as Error).message ?? error);
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

      // Phase 4.5B: Persist findings to red_flag_events for morning script consumption
      // H-007 fix: Check for existing event today before inserting (prevent duplicates from 4x/day runs)
      if (flaggedList.length > 0) {
        const { serviceClient } = await import('@/lib/supabase/service');
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);

        for (const flaggedUser of flaggedList) {
          for (const flag of flaggedUser.flags) {
            try {
              // Check if this exact flag was already recorded today
              const { data: existing } = await serviceClient
                .from('red_flag_events')
                .select('id')
                .eq('user_id', flaggedUser.id)
                .eq('dealership_id', dealership.id)
                .eq('signal_type', flag)
                .gte('created_at', todayStart.toISOString())
                .maybeSingle();

              if (!existing) {
                await serviceClient.from('red_flag_events').insert({
                  dealership_id: dealership.id,
                  user_id: flaggedUser.id,
                  signal_type: flag,
                  details: {},
                });
              }
            } catch (err) {
              console.warn(
                `Failed to insert red_flag_event for user ${flaggedUser.id}, dealership ${dealership.id}:`,
                (err as Error).message ?? err
              );
              // Non-critical — continue with SMS alerts
            }
          }
        }
      }

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

  // H17: Dunning is now processed exclusively by /api/cron/dunning-check.
  // This cron is read-only for red flags; removing dunning here eliminates
  // the duplicate-email race when both crons ran on overlapping data.

  return NextResponse.json({
    dealerships: dealerships?.length ?? 0,
    results,
    dunning_note: 'handled_by_dunning_check_cron',
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
  const suffix = remaining > 0 ? ` +${rem