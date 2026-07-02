// C-003: Cron endpoint — service role required (via service-db), no user JWT in cron context
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getPastDueDealerships, updateDealershipBilling } from '@/lib/service-db';
import { getDunningStage, shouldCancel, shouldSuspend, processDunning } from '@/lib/billing/dunning';
import { createBudget } from '@/lib/cron-budget';
import { log } from '@/lib/logger';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // C-001 fix: Use timing-safe comparison via verifyCronSecret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2026-07-02 AUDIT H2: budget guard. Suspension/cancellation updates are
    // idempotent (same status re-applied on the daily rerun), so a graceful
    // stop is always safe; a hard kill mid-processDunning was not observable.
    const budget = createBudget({ maxMs: 55_000, cronName: 'dunning-check' });

    const dealerships = await getPastDueDealerships();

    for (const dealership of dealerships) {
      if (budget.shouldStop()) break;
      const pastDueSince = new Date(dealership.pastDueSince);
      const stage = getDunningStage(pastDueSince);

      // Log dunning stage
      console.log(
        `[DUNNING] ${dealership.name} (${dealership.id}): Stage ${stage.stage} - ${stage.name} (${stage.daysOverdue} days overdue)`
      );

      // Handle cancellation (day 30+)
      if (shouldCancel(stage.stage)) {
        console.log(
          `[DUNNING] Canceling subscription for ${dealership.name} - ${stage.daysOverdue} days past due`
        );
        await updateDealershipBilling(dealership.id, {
          subscriptionStatus: 'canceled',
        });
      }
      // Handle suspension (day 21+)
      else if (shouldSuspend(stage.stage)) {
        console.log(
          `[DUNNING] Suspending platform for ${dealership.name} - ${stage.daysOverdue} days past due`
        );
        await updateDealershipBilling(dealership.id, {
          subscriptionStatus: 'suspended',
        });
      }
    }

    // H17: also process dunning emails here (moved from red-flag-check).
    // processDunning is now idempotent via billing_events UNIQUE constraint (C10).
    let dunningResults: { processed: number; emails_sent: number; errors: number } = {
      processed: 0, emails_sent: 0, errors: 0,
    };
    if (!budget.shouldStop()) {
      try {
        dunningResults = await processDunning();
      } catch (err) {
        log.error('dunning_check.processDunning_failed', { err: (err as Error).message });
      }
    }

    return NextResponse.json({
      success: true,
      processedCount: dealerships.length,
      dunning: dunningResults,
      ...budget.report(),
    });
  } catch (error) {
    log.error('dunning_check.fatal', { err: (error as Error).message ?? String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
