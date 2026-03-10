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

    const { url } = await createBillingPortalSession((dealership as Record<string, unknown>).stripe_customer_id as string);

    return Response.json({ portalUrl: url });
  } catch (error) {
    console.error('Portal error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
