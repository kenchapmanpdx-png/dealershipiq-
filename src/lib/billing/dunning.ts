// Phase 5: Dunning sequence
// Day 1: webhook (immediate). Days 3/14/21/30: cron (piggyback on red-flag-check).
// Uses Resend for transactional email.

import { serviceClient } from '@/lib/supabase/service';
import { getAppUrl } from '@/lib/url';
import { daysSinceUTC } from './subscription';
import type { DunningStage, DunningTemplate } from '@/types/billing';

// --- C-002: Consolidated dunning stage helpers (moved from dead lib/dunning.ts) ---

export interface DunningStageInfo {
  stage: number;
  name: string;
  daysOverdue: number;
}

export function getDunningStage(pastDueSince: Date): DunningStageInfo {
  const now = new Date();
  const daysOverdue = Math.floor((now.getTime() - pastDueSince.getTime()) / (1000 * 60 * 60 * 24));

  let stage = 1;
  if (daysOverdue >= 3) stage = 2;
  if (daysOverdue >= 14) stage = 3;
  if (daysOverdue >= 21) stage = 4;
  if (daysOverdue >= 30) stage = 5;

  const names: Record<number, string> = {
    1: 'Initial Past Due',
    2: 'Day 3 Reminder',
    3: 'Day 14 Feature Restriction',
    4: 'Day 21 Suspension',
    5: 'Day 30 Cancellation',
  };

  return { stage, name: names[stage] ?? 'Unknown', daysOverdue };
}

export function shouldSuspend(stage: number): boolean {
  return stage >= 4; // Day 21+
}

export function shouldCancel(stage: number): boolean {
  return stage >= 5; // Day 30+
}

const DUNNING_TEMPLATES: Record<Exclude<DunningStage, 'none'>, DunningTemplate> = {
  day1: {
    subject: 'Action needed: Payment failed for DealershipIQ',
    body: `Hi {{manager_name}},

We weren't able to process your payment for {{dealership_name}}. This is usually a temporary issue with your card.

Please update your payment method to keep your team's training running:
{{portal_url}}

If you have questions, reply to this email.

— DealershipIQ`,
  },
  day3: {
    subject: 'Payment still pending — DealershipIQ',
    body: `Hi {{manager_name}},

Your payment for {{dealership_name}} is still pending. Your team's training will continue for now, but we need your payment method updated soon.

Update payment: {{portal_url}}

— DealershipIQ`,
  },
  day14: {
    subject: 'Training access at risk — DealershipIQ',
    body: `Hi {{manager_name}},

Your payment for {{dealership_name}} has been past due for 14 days. Training access will be suspended soon if payment isn't resolved.

Update payment now: {{portal_url}}

— DealershipIQ`,
  },
  day21: {
    subject: 'Final notice: Training will be suspended — DealershipIQ',
    body: `Hi {{manager_name}},

This is your final notice. Your {{dealership_name}} subscription will be canceled in 9 days if payment isn't resolved.

Your team will lose access to:
- Daily training sessions
- Coaching mode
- Performance analytics
- Knowledge gap tracking

Resolve now: {{portal_url}}

— DealershipIQ`,
  },
  day30_canceled: {
    subject: 'Subscription canceled — DealershipIQ',
    body: `Hi {{manager_name}},

Your {{dealership_name}} subscription has been canceled due to non-payment. Training has been paused for your team.

Want to reactivate? You can restart anytime:
{{portal_url}}

All your team data is preserved for 90 days.

— DealershipIQ`,
  },
};

/**
 * Send a dunning email via Resend.
 * Returns true if sent, false if skipped or failed.
 */
export async function sendDunningEmail(params: {
  to: string;
  managerName: string;
  dealershipName: string;
  portalUrl: string;
  stage: Exclude<DunningStage, 'none'>;
}): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('RESEND_API_KEY not set — skipping dunning email');
    return false;
  }

  const template = DUNNING_TEMPLATES[params.stage];
  const body = template.body
    .replace(/\{\{manager_name\}\}/g, params.managerName)
    .replace(/\{\{dealership_name\}\}/g, params.dealershipName)
    .replace(/\{\{portal_url\}\}/g, params.portalUrl);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: 'DealershipIQ <billing@dealershipiq.com>',
        to: params.to,
        subject: template.subject,
        text: body,
      }),
    });

    if (!res.ok) {
      console.error('Resend dunning email failed:', res.status, await res.text());
      return false;
    }

    return true;
  } catch (err) {
    console.error('Dunning email error:', (err as Error).message ?? err);
    return false;
  }
}

/**
 * Process dunning for all past_due dealerships.
 * Called from red-flag-check cron. Sends emails at Day 3, 14, 21, 30.
 * Day 1 is handled immediately by the webhook.
 */
export async function processDunning(): Promise<{
  processed: number;
  emails_sent: number;
  errors: number;
}> {
  let processed = 0;
  let emailsSent = 0;
  let errors = 0;

  const { data: pastDueDealerships, error } = await serviceClient
    .from('dealerships')
    .select('id, name, past_due_since, stripe_customer_id')
    .eq('subscription_status', 'past_due')
    .not('past_due_since', 'is', null);

  if (error || !pastDueDealerships) return { processed: 0, emails_sent: 0, errors: 0 };

  for (const dealership of pastDueDealerships) {
    processed++;
    const pastDueSince = dealership.past_due_since as string;
    const days = daysSinceUTC(pastDueSince);

    // Determine which stage to send (only send each stage once)
    let targetStage: Exclude<DunningStage, 'none'> | null = null;
    if (days >= 30) targetStage = 'day30_canceled';
    else if (days >= 21 && days < 30) targetStage = 'day21';
    else if (days >= 14 && days < 21) targetStage = 'day14';
    else if (days >= 3 && days < 14) targetStage = 'day3';

    if (!targetStage) continue;

    // Check if we already sent this stage
    const { data: existing } = await serviceClient
      .from('billing_events')
      .select('id')
      .eq('dealership_id', dealership.id as string)
      .eq('event_type', `dunning_${targetStage}`)
      .maybeSingle();

    if (existing) continue; // Already sent

    // Get manager email
    const { data: managers } = await serviceClient
      .from('users')
      .select('email, full_name')
      .eq('dealership_id', dealership.id as string)
      .in('role', ['manager', 'owner'])
      .limit(1);

    const manager = managers?.[0];
    if (!manager?.email) continue;

    // Build portal URL
    const appUrl = getAppUrl();
    const portalUrl = `${appUrl}/dashboard/billing`;

    try {
      const sent = await sendDunningEmail({
        to: manager.email as string,
        managerName: (manager.full_name as string) || 'Manager',
        dealershipName: dealership.name as string,
        portalUrl,
        stage: targetStage,
      });

      if (sent) emailsSent++;

      // Record the dunning event for deduplication
      await serviceClient.from('billing_events').insert({
        stripe_event_id: `dunning_${targetStage}_${dealership.id}_${new Date().toISOString().split('T')[0]}`,
        event_type: `dunning_${targetStage}`,
        dealership_id: dealership.id as string,
        payload: { days_past_due: days, manager_email: manager.email },
      });

      // Day 30: cancel the subscription
      if (targetStage === 'day30_canceled') {
        await serviceClient
          .from('dealerships')
          .update({ subscription_status: 'canceled' })
          .eq('id', dealership.id as string);
      }
    } catch (err) {
      console.error(`Dunning error for ${dealership.id}:`, (err as Error).message ?? err);
      errors++;
    }
  }

  return { processed, emails_sent: emailsSent, errors };
}
