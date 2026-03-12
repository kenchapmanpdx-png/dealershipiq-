import { getPastDueDealerships, updateDealershipBilling } from '@/lib/service-db';
import { getDunningStage, shouldCancel, shouldSuspend } from '@/lib/dunning';

export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify CRON_SECRET
  const authHeader = request.headers.get('authorization');
  const expectedSecret = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
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

    return Response.json({
      success: true,
      processedCount: dealerships.length,
    });
  } catch (error) {
    console.error('Dunning check error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
