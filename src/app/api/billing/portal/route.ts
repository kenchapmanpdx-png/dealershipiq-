import { createBillingPortalSession } from '@/lib/stripe';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(_request: Request) {
  try {
    // Get session
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get dealership_id from auth metadata
    const dealership_id = user.app_metadata?.dealership_id;
    if (!dealership_id) {
      return Response.json({ error: 'No dealership associated' }, { status: 400 });
    }

    // Get customer ID from database
    const { data: dealership, error: dealershipError } = await supabase
      .from('dealerships')
      .select('stripe_customer_id')
      .eq('id', dealership_id)
      .single();

    if (dealershipError || !(dealership as Record<string, unknown>)?.stripe_customer_id) {
      return Response.json({ error: 'No billing information found' }, { status: 404 });
    }

    // L-018: Timeout protection for Stripe API call
    const portalPromise = createBillingPortalSession((dealership as Record<string, unknown>).stripe_customer_id as string);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Stripe portal request timed out')), 10000)
    );
    const { url } = await Promise.race([portalPromise, timeoutPromise]);

    // L-021: Validate Stripe portal URL before returning
    if (!url || !url.startsWith('https://billing.stripe.com/')) {
      console.error('Unexpected Stripe portal URL:', url?.slice(0, 50));
      return Response.json({ error: 'Invalid billing portal URL' }, { status: 502 });
    }

    return Response.json({ portalUrl: url });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = errMsg.includes('timed out');
    console.error('Portal error:', errMsg);
    return Response.json(
      { error: isTimeout ? 'Billing portal temporarily unavailable' : 'Internal server error' },
      { status: isTimeout ? 504 : 500 }
    );
  }
}
