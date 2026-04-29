// Phase 5: Dunning sequence
// Day 1: webhook (immediate). Days 3/14/21/30: cron (piggyback on red-flag-check).
// Uses Resend for transactional email.

import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';
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
    log.error('billing.dunning.env_missing', { env: 'RESEND_API_KEY', stage: params.stage });
    return false;
  }

  const template = DUNNING_TEMPLATES[params.stage];

  // S8: one-pass tokenized substitution. Chained .replace() calls allowed a
  // nested-placeholder injection: a dealership name containing `{{portal_url}}`
  // would get further-substituted on a later pass. Single-pass replace visits
  // each placeholder exactly once; attacker-controlled values cannot reach a
  // later substitution.
  const vars: Record<string, string> = {
    manager_name: params.managerName,
    dealership_name: params.dealershipName,
    portal_url: params.portalUrl,
  };
  const body = template.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');
  const subject = template.subject.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? '');

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
        subject,
        text: body,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      log.error('billing.dunning.resend_failed', {
        stage: params.stage,
        status: res.status,
        body: errBody.slice(0, 500),
      });
      return false;
    }

    return true;
  } catch (err) {
    log.error('billing.dunning.resend_exception', {
      stage: params.stage,
      error: (err as Error).message ?? String(err),
    });
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

    // F11-C-001b: Query dealership_memberships (not users) for manager role + name.
    // Email comes from auth.users via admin API.
    const { data: managerMemberships } = await serviceClient
      .from('dealership_memberships')
      .select('user_id, role, users ( full_name )')
      .eq('dealership_id', dealership.id as string)
      .in('role', ['manager', 'owner'])
      .limit(1);

    const membership = managerMemberships?.[0];
    if (!membership?.user_id) continue;

    // Get email from auth.users
    const { data: { user: authUser } } = await serviceClient.auth.admin.getUserById(
      membership.user_id as string
    );
    const managerEmail = authUser?.email;
    if (!managerEmail) continue;

    const usersData = membership.users as unknown as { full_name: string } | { full_name: string }[] | null;
    const managerName = (Array.isArray(usersData) ? usersData[0]?.full_name : usersData?.full_name) || 'Manager';

    // Build portal URL
    const appUrl = getAppUrl();
    const portalUrl = `${appUrl}/dashboard/billing`;

    try {
      // C10: Record the billing_event FIRST. If the row insert succeeds we know
      // (via UNIQUE constraint on stripe_event_id) that no prior cron run sent
      // this stage. If the email send then fails, the event still exists — the
      // next cron run sees it and skips. This swaps "email-twice on retry" for
      // "email-zero-times on a hard send failure", which a support ticket can
      // recover from; email-twice is harder to recover from.
      const eventKey = `dunning_${targetStage}_${dealership.id}_${new Date().toISOString().split('T')[0]}`;
      const { error: insertErr } = await serviceClient.from('billing_events').insert({
        stripe_event_id: eventKey,
        event_type: `dunning_${targetStage}`,
        dealership_id: dealership.id as string,
        payload: { days_past_due: days, manager_email: managerEmail },
      });

      if (insertErr) {
        // 23505 = UNIQUE → another cron run already claimed this; skip silently
        if ((insertErr as { code?: string }).code === '23505') {
          continue;
        }
        throw insertErr;
      }

      const sent = await sendDunningEmail({
        to: managerEmail,
        managerName,
        dealershipName: dealership.name as string,
        portalUrl,
        stage: targetStage,
      });

      if (sent) {
        emailsSent++;
        log.info('billing.dunning.email_sent', {
          dealership_id: dealership.id as string,
          stage: targetStage,
          days_past_due: days,
        });
      } else {
        // Event is recorded but email provider failed. We do NOT delete the event --
        // that would reopen the duplicate-send race. Support handles manually.
        // M-9 (2026-04-18): loud structured log for support dashboard alerting.
        log.error('billing.dunning.event_recorded_but_email_failed', {
          dealership_id: dealership.id as string,
          stage: targetStage,
          days_past_due: days,
          action_required: 'manual_follow_up',
        });
      }

      // Day 30: cancel the subscription
      if (targetStage === 'day30_canceled') {
        await serviceClient
          .from('dealerships')
          .update({ subscription_status: 'canceled' })
          .eq('id', dealership.id as string);
      }
    } catch (err) {
      log.error('billing.dunning.stage_failed', {
        dealership_id: dealership.id as string,
        stage: targetStage,
        error: (err as Error).message ?? String(err),
      });
      errors++;
    }
  }

  return { processed, emails_sent: emailsSent, errors };
}
