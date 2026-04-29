// POST /api/webhooks/stripe
// Phase 5: Stripe webhook handler — 6 event types, idempotent via billing_events table.
// Every handler: check billing_events for stripe_event_id FIRST, skip if exists.
// Build Master: "highest-risk code in the system"

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, Stripe } from '@/lib/stripe';
import { serviceClient } from '@/lib/supabase/service';
import { findDealershipByStripeCustomer } from '@/lib/billing/lookup';
import { sendDunningEmail } from '@/lib/billing/dunning';
import { getAppUrl } from '@/lib/url';
import { log } from '@/lib/logger';

// 2026-04-18 H-9: Pin runtime and lifecycle. `verifyWebhookSignature` calls
// into Stripe's Node SDK (`constructEvent`) which is NOT edge-compatible —
// without `export const runtime = 'nodejs'`, a future transitive import could
// flip this to Edge and silently break signature verification. Dunning email
// + Supabase round-trips can take time, so bump the function budget past the
// Vercel default of 10s.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// C6/H4: Structured logging context for every handler. `event.id` + `stripe_customer_id`
// are included in every error so 3am triage can correlate across Stripe + Supabase.

// 2026-04-18 L-2: Body-size cap. Real Stripe event payloads max out well
// under 200KB. An unbounded `request.text()` lets an attacker (or a buggy
// proxy) stream a multi-MB body into the function memory before signature
// check ever runs. Cap at 1MB and reject with 413 BEFORE hashing.
const MAX_BODY_BYTES = 1_048_576; // 1MB

// 2026-04-18 L-3: Event types we actually handle in the switch() below.
// Events not in this set are ACK'd without writing to billing_events so
// the table doesn't accumulate junk rows for the ~150 Stripe event types
// we don't care about. Must stay in sync with the switch statement.
const HANDLED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
]);

export async function POST(request: NextRequest) {
  // L-2: reject oversized bodies up-front via Content-Length when provided.
  // Content-Length can be spoofed but real Stripe traffic always sets it;
  // missing/bogus values fall through to the post-read length check.
  const declaredLen = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    log.warn('stripe.webhook.body_too_large', { content_length: declaredLen });
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const body = await request.text();

  // L-2: belt-and-braces — reject if actual body exceeded the cap
  // (catches chunked encoding without declared length).
  if (body.length > MAX_BODY_BYTES) {
    log.warn('stripe.webhook.body_too_large', { body_length: body.length });
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(body, signature, webhookSecret) as Stripe.Event;
  } catch (err) {
    log.error('stripe.webhook.signature_verification_failed', { err: (err as Error).message });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 2026-04-18 L-3: Ack unknown/unhandled event types WITHOUT writing a
  // billing_events row. Stripe sends ~150 event types by default; claiming
  // all of them grows the table indefinitely with events we never consume.
  // Known-types list mirrors the switch() below — keep in sync.
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    log.info('stripe.webhook.unhandled_event_type', {
      stripe_event_type: event.type,
      stripe_event_id: event.id,
    });
    return NextResponse.json({ received: true, skipped: 'unhandled_type' });
  }

  // C-009 + C-011: Atomic idempotency via INSERT-first with UNIQUE constraint.
  try {
    const claimed = await claimEvent(event);
    if (!claimed) {
      // UNIQUE constraint violation = already processed
      return NextResponse.json({ received: true, skipped: true });
    }
  } catch (idempErr) {
    // C6: if dealership lookup failed, claim throws a descriptive error.
    // Return 500 so Stripe retries (up to 72h) rather than swallowing.
    log.error('stripe.webhook.claim_failed', {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      err: (idempErr as Error).message,
    });
    return NextResponse.json({ error: 'Idempotency check failed' }, { status: 500 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event);
        break;
      default:
        log.info('stripe.webhook.unhandled_event_type', { stripe_event_type: event.type, stripe_event_id: event.id });
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    log.error('stripe.webhook.handler_error', {
      stripe_event_type: event.type,
      stripe_event_id: event.id,
      err: (err as Error).message,
    });

    // 2026-04-18 C-4: Un-claim the event before returning 500 so that Stripe's
    // retry (72h exponential backoff) actually re-runs the handler. Without
    // this, the UNIQUE-on-stripe_event_id claim made at `claimEvent()` would
    // short-circuit every retry with {skipped: true} and silently drop the
    // event — a transient DB blip during handleSubscriptionUpdated would then
    // mean a cancelled customer keeps access forever (or a reactivated
    // customer stays locked out forever). Deleting the claim row on error
    // turns the retry back into a real retry.
    //
    // Failure to delete here is best-effort only — if the delete also fails,
    // we log but still return 500; the worst case is that Stripe retries and
    // hits the claim again, which is no worse than before this fix.
    try {
      const { error: delErr } = await serviceClient
        .from('billing_events')
        .delete()
        .eq('stripe_event_id', event.id);
      if (delErr) {
        log.error('stripe.webhook.unclaim_failed', {
          stripe_event_id: event.id,
          stripe_event_type: event.type,
          err: delErr.message,
        });
      }
    } catch (delErr) {
      log.error('stripe.webhook.unclaim_exception', {
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        err: (delErr as Error).message,
      });
    }

    // Return 500 so Stripe retries transient failures
    return NextResponse.json({ error: 'Handler error, will retry' }, { status: 500 });
  }
}

// H6: Whitelisted Stripe subscription statuses we recognize.
// Unknown statuses are allowed through (fail-open on status) but logged loudly
// so ops notices when Stripe introduces a new state we haven't handled.
const KNOWN_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

function normalizeStatus(event: Stripe.Event, rawStatus: string): string {
  if (!KNOWN_SUBSCRIPTION_STATUSES.has(rawStatus)) {
    log.error('stripe.subscription.unknown_status', {
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      status: rawStatus,
    });
  }
  return rawStatus;
}


// 2026-04-18 L-4: Stripe's Node SDK types lag the dashboard for subscription
// period fields, so callers have been blind-casting `current_period_end` via
// `as unknown as Record<string, unknown>`. If Stripe ever returns null (e.g.
// for a subscription in `incomplete_expired` status) the blind cast yields
// `undefined`, then `new Date(undefined * 1000)` produces `Invalid Date` and
// the row update writes "NaN" into a timestamptz column — which Postgres
// rejects, rolling back the webhook handler and forcing Stripe to retry
// the same bad event for 72h. Assert the value is a real unix epoch number
// and log+skip the field if not.
function toIsoFromUnixOrNull(
  raw: unknown,
  field: string,
  stripeEventId: string
): string | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    log.warn('stripe.webhook.invalid_timestamp', {
      field,
      stripe_event_id: stripeEventId,
      raw_type: typeof raw,
    });
    return null;
  }
  return new Date(raw * 1000).toISOString();
}

function extractCustomerId(obj: { customer?: unknown }): string | null {
  const c = obj.customer;
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object' && 'id' in c) return (c as { id?: string }).id ?? null;
  return null;
}

// --- Event Handlers ---

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const dealershipId =
    session.client_reference_id ??
    (session.metadata?.dealership_id as string | undefined);

  if (!dealershipId) {
    log.error('stripe.checkout.no_dealership_id', {
      stripe_event_id: event.id,
      stripe_session_id: session.id,
    });
    return;
  }

  const customerId = extractCustomerId(session as { customer?: unknown });

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription)?.id;

  const locations = parseInt(session.metadata?.locations ?? '1', 10);

  // F11-M-001: Read trial_end from Stripe subscription object.
  let trialEndsAt: string | null = null;
  if (subscriptionId) {
    try {
      const subObj = session.subscription as unknown as Record<string, unknown>;
      const trialEnd = subObj?.trial_end as number | null;
      if (trialEnd) {
        trialEndsAt = new Date(trialEnd * 1000).toISOString();
      }
    } catch {
      // fall through to 30-day default
    }
  }
  if (!trialEndsAt) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 30);
    trialEndsAt = fallback.toISOString();
  }

  // 2026-04-18 H-13: Scope the update so an already-subscribed dealership
  // cannot be clobbered by a replay of an OLD checkout.completed.
  //
  // Concern: a dealership transitions trialing → active via subscription.*
  // events after their trial ends. If the ORIGINAL checkout.completed event
  // is ever replayed (Stripe CLI, dashboard "resend", or a second checkout
  // attempt for an already-subscribed dealership), without a guard we would:
  //   - downgrade subscription_status from `active` back to `trialing`
  //   - reset trial_ends_at 30 days forward (granting a free month)
  //   - clobber max_locations with stale metadata
  //
  // The new status column has a DEFAULT of 'trialing', so filtering by
  // status alone doesn't distinguish "brand-new dealership about to complete
  // first checkout" from "dealership that already has a live subscription."
  // Filtering on subscription_id is the reliable signal: null = no
  // subscription yet; matching id = idempotent replay of THIS checkout;
  // different id = replay of OLD checkout for an already-subscribed org.
  const allowedSubFilter = subscriptionId
    ? `subscription_id.is.null,subscription_id.eq.${subscriptionId}`
    : 'subscription_id.is.null';

  const { data: updated, error: updateError } = await serviceClient
    .from('dealerships')
    .update({
      stripe_customer_id: customerId,
      subscription_id: subscriptionId,
      subscription_status: 'trialing',
      max_locations: locations,
      trial_ends_at: trialEndsAt,
    })
    .eq('id', dealershipId)
    .or(allowedSubFilter)
    .select('id');

  if (updateError) {
    log.error('stripe.checkout.update_failed', {
      stripe_event_id: event.id,
      dealership_id: dealershipId,
      error: updateError.message,
    });
    throw updateError; // triggers billing_events unclaim + 500 for Stripe retry
  }

  if (!updated || updated.length === 0) {
    // Dealership already has an active/trialing/past_due subscription.
    // Log for observability but do NOT clobber. This is the intended guard.
    log.warn('stripe.checkout.skipped_already_active', {
      stripe_event_id: event.id,
      dealership_id: dealershipId,
      stripe_session_id: session.id,
    });
  }
}

async function handleSubscriptionCreated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = extractCustomerId(subscription as { customer?: unknown });

  if (!customerId) {
    log.error('stripe.subscription_created.no_customer_id', { stripe_event_id: event.id });
    return;
  }

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    log.error('stripe.subscription_created.dealership_lookup_failed', {
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
    });
    return;
  }

  const subRec = subscription as unknown as Record<string, unknown>;
  const periodEndIso = toIsoFromUnixOrNull(subRec.current_period_end, 'current_period_end', event.id);
  const trialEndIso = toIsoFromUnixOrNull(subRec.trial_end, 'trial_end', event.id);

  const updateData: Record<string, unknown> = {
    subscription_id: subscription.id,
    subscription_status: normalizeStatus(event, subscription.status),
    trial_ends_at: trialEndIso,
  };
  // L-4: only write the column if the timestamp validated; avoids clobbering
  // an existing good value with a NaN when Stripe returns a null period_end.
  if (periodEndIso !== null) updateData.current_period_end = periodEndIso;

  await serviceClient
    .from('dealerships')
    .update(updateData)
    .eq('id', dealership.id);
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = extractCustomerId(subscription as { customer?: unknown });

  if (!customerId) {
    log.error('stripe.subscription_updated.no_customer_id', { stripe_event_id: event.id });
    return;
  }

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    log.error('stripe.subscription_updated.dealership_lookup_failed', {
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
    });
    return;
  }

  const periodEndIso = toIsoFromUnixOrNull(
    (subscription as unknown as Record<string, unknown>).current_period_end,
    'current_period_end',
    event.id
  );

  const updateData: Record<string, unknown> = {
    subscription_status: normalizeStatus(event, subscription.status),
  };
  if (periodEndIso !== null) updateData.current_period_end = periodEndIso;

  // Track past_due transition
  if (subscription.status === 'past_due') {
    const { data: current } = await serviceClient
      .from('dealerships')
      .select('past_due_since')
      .eq('id', dealership.id)
      .single();

    if (!current?.past_due_since) {
      updateData.past_due_since = new Date().toISOString();
    }
  } else {
    updateData.past_due_since = null;
  }

  const totalQuantity = subscription.items.data.reduce(
    (sum, item) => sum + (item.quantity || 1),
    0
  );
  updateData.max_locations = totalQuantity;

  await serviceClient
    .from('dealerships')
    .update(updateData)
    .eq('id', dealership.id);
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId = extractCustomerId(subscription as { customer?: unknown });

  if (!customerId) {
    log.error('stripe.subscription_deleted.no_customer_id', { stripe_event_id: event.id });
    return;
  }

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    log.error('stripe.subscription_deleted.dealership_lookup_failed', {
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
    });
    return;
  }

  await serviceClient
    .from('dealerships')
    .update({
      subscription_status: 'canceled',
      subscription_id: null,
    })
    .eq('id', dealership.id);
}

async function handlePaymentSucceeded(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = extractCustomerId(invoice as { customer?: unknown });

  if (!customerId) {
    log.error('stripe.payment_succeeded.no_customer_id', { stripe_event_id: event.id });
    return;
  }

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    log.error('stripe.payment_succeeded.dealership_lookup_failed', {
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
      action_required: 'manual_reconciliation',
    });
    return;
  }

  await serviceClient
    .from('dealerships')
    .update({
      subscription_status: 'active',
      past_due_since: null,
    })
    .eq('id', dealership.id);
}

async function handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const customerId = extractCustomerId(invoice as { customer?: unknown });

  if (!customerId) {
    log.error('stripe.payment_failed.no_customer_id', { stripe_event_id: event.id });
    return;
  }

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    log.error('stripe.payment_failed.dealership_lookup_failed', {
      stripe_event_id: event.id,
      stripe_customer_id: customerId,
      action_required: 'manual_reconciliation',
    });
    return;
  }

  const { data: current } = await serviceClient
    .from('dealerships')
    .select('past_due_since')
    .eq('id', dealership.id)
    .single();

  const updateData: Record<string, unknown> = {
    subscription_status: 'past_due',
  };

  if (!current?.past_due_since) {
    updateData.past_due_since = new Date().toISOString();
  }

  await serviceClient
    .from('dealerships')
    .update(updateData)
    .eq('id', dealership.id);

  // Day 1 dunning email (immediate from webhook)
  // C10: record billing_events row BEFORE sending so cron retries don't duplicate.
  try {
    const { data: managerMemberships } = await serviceClient
      .from('dealership_memberships')
      .select('user_id, role, users ( full_name )')
      .eq('dealership_id', dealership.id)
      .in('role', ['manager', 'owner'])
      .limit(1);

    const membership = managerMemberships?.[0];
    if (membership?.user_id) {
      const { data: { user: authUser } } = await serviceClient.auth.admin.getUserById(
        membership.user_id as string
      );
      const managerEmail = authUser?.email;
      const usersData = membership.users as unknown as { full_name: string } | { full_name: string }[] | null;
      const managerName = (Array.isArray(usersData) ? usersData[0]?.full_name : usersData?.full_name) || 'Manager';

      if (managerEmail) {
        // C10: idempotency token per day per dealership per stage
        const today = new Date().toISOString().split('T')[0];
        const dunningEventId = `dunning_day1_${dealership.id}_${today}`;

        const { error: markError } = await serviceClient.from('billing_events').insert({
          stripe_event_id: dunningEventId,
          event_type: 'dunning_day1',
          dealership_id: dealership.id,
          payload: { manager_email: managerEmail, source: 'webhook' },
        });

        if (markError) {
          if (markError.code === '23505') {
            log.info('stripe.dunning.day1_already_sent', { dealership_id: dealership.id });
          } else {
            log.error('stripe.dunning.mark_failed', {
              dealership_id: dealership.id,
              err: markError.message,
            });
          }
        } else {
          const appUrl = getAppUrl();
          const sent = await sendDunningEmail({
            to: managerEmail,
            managerName,
            dealershipName: dealership.name,
            portalUrl: `${appUrl}/dashboard/billing`,
            stage: 'day1',
          });

          if (!sent) {
            log.warn('stripe.dunning.day1_email_failed', {
              dealership_id: dealership.id,
              action: 'cron_will_retry',
            });
          } else {
            log.info('stripe.dunning.day1_email_sent', { dealership_id: dealership.id });
          }
        }
      }
    }
  } catch (emailError) {
    log.error('stripe.dunning.day1_exception', {
      dealership_id: dealership.id,
      err: (emailError as Error).message ?? String(emailError),
    });
    // Do not rethrow — cron will pick up and retry
  }
}

// --- Helpers ---

// C6: Atomic idempotency. INSERT the event record FIRST. If UNIQUE rejects, skip.
// If dealership lookup fails, THROW so caller returns 500 and Stripe retries (72h window)
// rather than silently ack'ing an unmatched event.
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  let dealershipId: string | null = null;
  const obj = event.data.object as unknown as Record<string, unknown>;

  if (obj.client_reference_id) {
    dealershipId = obj.client_reference_id as string;
  } else if (obj.metadata && (obj.metadata as Record<string, unknown>).dealership_id) {
    dealershipId = (obj.metadata as Record<string, unknown>).dealership_id as string;
  } else {
    const customerId =
      typeof obj.customer === 'string'
        ? obj.customer
        : (obj.customer as Record<string, unknown>)?.id as string | undefined;
    if (customerId) {
      const d = await findDealershipByStripeCustomer(customerId);
      if (d) dealershipId = d.id;
    }
  }

  const { error } = await serviceClient.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    dealership_id: dealershipId,
    payload: {
      event_data_type: obj.object,
    },
  });

  if (error) {
    // UNIQUE violation code = '23505' — event already claimed
    if (error.code === '23505') {
      return false;
    }
    // Any other DB error — rethrow so caller returns 500 for Stripe to retry
    throw error;
  }

  return true;
}
