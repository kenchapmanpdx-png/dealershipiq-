// C-003: Cron endpoint — service role required (via service-db), no user JWT in cron context
import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getPastDueDealerships, updateDealershipBilling } from '@/lib/service-db';
import { getDunningStage, shouldCancel, shouldSuspend } from '@/lib/billing/dunning';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // C-001 fix: Use timing-safe comparison via verifyCronSecret
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const dealerships = await getPastDueDealerships();

    for (const dealership of dealerships) {
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

    return NextResponse.json({
      success: true,
      processedCount: dealerships.length,
    });
  } catch (error) {
    console.error('Dunning check error:', (error as Error).message ?? error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
