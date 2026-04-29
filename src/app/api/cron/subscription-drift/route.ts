// H5: Subscription drift-check cron.
// Stripe is the source of truth. Supabase mirrors `subscription_status` for
// fast authz checks, but webhooks can be delayed or dropped. This cron pulls
// active + past_due dealerships every 12h, queries Stripe, and corrects drift.
//
// Recommended schedule: every 12h via vercel.json.

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { serviceClient } from '@/lib/supabase/service';
import { getSubscriptionStatus } from '@/lib/stripe';
import { createBudget } from '@/lib/cron-budget';
import { log } from '@/lib/logger';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const budget = createBudget({ cronName: 'subscription-drift', maxMs: 55_000, safetyBufferMs: 10_000 });

  const { data: dealerships, error } = await serviceClient
    .from('dealerships')
    .select('id, name, stripe_customer_id, subscription_status, past_due_since')
    .not('stripe_customer_id', 'is', null);

  if (error) {
    log.error('subscription_drift.select_failed', { err: error.message });
    return NextResponse.json({ error: 'Select failed' }, { status: 500 });
  }

  let drifts = 0;
  let corrected = 0;
  let errors = 0;

  for (const d of dealerships ?? []) {
    if (budget.shouldStop()) break;

    const customerId = d.stripe_customer_id as string;
    try {
      const stripeSub = await getSubscriptionStatus(customerId);
      if (!stripeSub) continue;

      const localStatus = d.subscription_status as string | null;
      const stripeStatus = stripeSub.status;

      if (stripeStatus !== localStatus) {
        drifts++;
        log.warn('subscription_drift.detected', {
          dealership_id: d.id,
          dealership_name: d.name,
          stripe_customer_id: customerId,
          stripe_status: stripeStatus,
          local_status: localStatus,
        });

        const updates: Record<string, unknown> = { subscription_status: stripeStatus };
        if (stripeStatus === 'active' || stripeStatus === 'trialing') {
          updates.past_due_since = null;
        } else if (stripeStatus === 'past_due' && !d.past_due_since) {
          updates.past_due_since = new Date().toISOString();
        }

        const { error: upErr } = await serviceClient
          .from('dealerships')
          .update(updates)
          .eq('id', d.id);

        if (upErr) {
          log.error('subscription_drift.update_failed', {
            dealership_id: d.id,
            err: upErr.message,
          });
          errors++;
        } else {
          corrected++;
        }
      }
    } catch (err) {
      errors++;
      log.error('subscription_drift.stripe_call_failed', {
        dealership_id: d.id,
        stripe_customer_id: customerId,
        err: (err as Error).message,
      });
    }
    budget.markProcessed();
  }

  return NextResponse.json({
    candidates: dealerships?.length ?? 0,
    drifts,
    corrected,
    errors,
    budget: budget.report(),
  });
}
