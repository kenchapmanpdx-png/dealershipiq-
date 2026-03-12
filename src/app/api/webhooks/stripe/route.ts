// POST /api/webhooks/stripe
// Phase 5: Stripe webhook handler — 6 event types, idempotent via billing_events table.
// Every handler: check billing_events for stripe_event_id FIRST, skip if exists.
// Build Master: "highest-risk code in the system"

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature, Stripe } from '@/lib/stripe';
import { serviceClient } from '@/lib/supabase/service';
import { findDealershipByStripeCustomer } from '@/lib/billing/lookup';
import { sendDunningEmail } from '@/lib/billing/dunning';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(body, signature, webhookSecret) as Stripe.Event;
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency check: skip if already processed
  const { data: existing } = await serviceClient
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true, skipped: true });
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
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    // Record processed event
    await recordEvent(event);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Stripe webhook handler error for ${event.type}:`, err);
    await recordEvent(event, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }
}

// --- Event Handlers ---

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const dealershipId =
    session.client_reference_id ??
    (session.metadata?.dealership_id as string | undefined);

  if (!dealershipId) {
    console.error('checkout.session.completed: no dealership_id found');
    return;
  }

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : (session.customer as Stripe.Customer)?.id;

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription)?.id;

  const locations = parseInt(session.metadata?.locations ?? '1', 10);

  // Calculate trial end (30 days from now)
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  await serviceClient
    .from('dealerships')
    .update({
      stripe_customer_id: customerId,
      subscription_id: subscriptionId,
      subscription_status: 'trialing',
      max_locations: locations,
      trial_ends_at: trialEndsAt.toISOString(),
    })
    .eq('id', dealershipId);
}

async function handleSubscriptionCreated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer as Stripe.Customer)?.id;

  if (!customerId) return;

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    console.error(`subscription.created: no dealership for customer ${customerId}`);
    return;
  }

  const periodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number;
  const trialEnd = (subscription as unknown as Record<string, unknown>).trial_end as number | null;

  await serviceClient
    .from('dealerships')
    .update({
      subscription_id: subscription.id,
      subscription_status: subscription.status,
      current_period_end: new Date(periodEnd * 1000).toISOString(),
      trial_ends_at: trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
    })
    .eq('id', dealership.id);
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer as Stripe.Customer)?.id;

  if (!customerId) return;

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) {
    console.error(`subscription.updated: no dealership for customer ${customerId}`);
    return;
  }

  const periodEnd = (subscription as unknown as Record<string, unknown>).current_period_end as number;

  const updateData: Record<string, unknown> = {
    subscription_status: subscription.status,
    current_period_end: new Date(periodEnd * 1000).toISOString(),
  };

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

  // Update quantity if changed
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
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer as Stripe.Customer)?.id;

  if (!customerId) return;

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) return;

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
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer)?.id;

  if (!customerId) return;

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) return;

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
  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer)?.id;

  if (!customerId) return;

  const dealership = await findDealershipByStripeCustomer(customerId);
  if (!dealership) return;

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
  try {
    const { data: managers } = await serviceClient
      .from('users')
      .select('email, full_name')
      .eq('dealership_id', dealership.id)
      .in('role', ['manager', 'owner'])
      .limit(1);

    const manager = managers?.[0];
    if (manager?.email) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dealershipiq-wua7.vercel.app';
      await sendDunningEmail({
        to: manager.email as string,
        managerName: (manager.full_name as string) || 'Manager',
        dealershipName: dealership.name,
        portalUrl: `${appUrl}/dashboard/billing`,
        stage: 'day1',
      });
    }
  } catch (err) {
    console.error('Day 1 dunning email error:', err);
  }
}

// --- Helpers ---

async function recordEvent(event: Stripe.Event, error?: unknown) {
  try {
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

    await serviceClient.from('billing_events').insert({
      stripe_event_id: event.id,
      event_type: event.type,
      dealership_id: dealershipId,
      payload: {
        ...(error ? { error: String(error) } : {}),
        event_data_type: obj.object,
      },
    });
  } catch (err) {
    console.error('Failed to record billing event:', err);
  }
}
