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

// 2026-04-29: pin Node runtime — cron-auth.ts + Stripe SDK both Node-only.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2026-04-29 C7: short-circuit if Stripe is not configured. The cron is
  // disabled in vercel.json until billing ships, but a manual cron-trigger
  // would otherwise 500 on `new Stripe(undefined!)`. Return 200 so the
  // caller knows the noop is intentional.
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { skipped: true, reason: 'STRIPE_SECRET_KEY not set; subscription-drift disabled' },
      { status: 200 }
    );
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
          log.error('subscription_drift.update_failed',