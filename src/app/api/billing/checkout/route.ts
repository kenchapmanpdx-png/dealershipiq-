// POST /api/billing/checkout
// Phase 5: Self-service signup flow.
// C-003: serviceClient justified — signup creates new auth user + dealership before JWT exists.
//        admin.createUser, admin.updateUserById, admin.deleteUser, and initial row inserts
//        all require service_role because there is no authenticated session yet.
// 1. Create Supabase Auth user (email + password)
// 2. Create dealership row
// 3. Create dealership_membership
// 4. Set user app_metadata (dealership_id, user_role)
// 5. Redirect to Stripe Checkout with client_reference_id = dealership_id

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { serviceClient } from '@/lib/supabase/service';
import { createCheckoutSession } from '@/lib/stripe';
import { checkSignupLimit } from '@/lib/rate-limit';
import { requireJsonContentType } from '@/lib/api-helpers';
import type { CheckoutRequest } from '@/types/billing';

export async function POST(request: NextRequest) {
  try {
    // L-14: content-type gate
    const ctErr = requireJsonContentType(request);
    if (ctErr) return ctErr;

    // 2026-04-29 H3: Short-circuit if Stripe is not configured. Without
    // this, signup creates auth user + dealership rows + feature flags, then
    // fails on createCheckoutSession() and triggers the rollback flow. That
    // wastes Supabase Auth quota and risks orphaned rows when rollback hits
    // a transient Supabase error. Fail fast with a 503 instead.
    if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
      return NextResponse.json(
        { error: 'Signup is temporarily unavailable. Billing is being configured. Please try again later.' },
        { status: 503 }
      );
    }

    // C2-FIX: Rate limit public signup endpoint (5/hour per IP)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? request.headers.get('x-real-ip')
      ?? 'unknown';
    const rateLimitResult = await checkSignupLimit(ip);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // S-009: Reject oversized JSON payloads
    const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
    if (contentLength > 10_000) {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    }

    const body: CheckoutRequest = await request.json();
    const { dealershipName, email, password, managerName, locations, timezone } = body;

    if (!dealershipName || !email || !password || !managerName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const locationCount = Math.max(1, Math.min(100, locations || 1));
    const tz = timezone || 'America/New_York';

    // 1. Create Supabase Auth user
    const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      // C-007: user_metadata used ONLY for display name (profile UI).
      // Auth decisions use app_metadata set below (line ~113). Never trust user_metadata for auth.
      user_metadata: {
        full_name: managerName,
      },
    });

    if (authError) {
      if (authError.message?.includes('already') || authError.message?.includes('duplicate')) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please log in instead.' },
          { status: 409 }
        );
      }
      console.error('Auth user creation failed:', (authError as Error).message ?? authError);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    const userId = authData.user.id;

    // 2. Create dealership row
    const slug = dealershipName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 50);

    const { data: dealership, error: dealershipError } = await serviceClient
      .from('dealerships')
      .insert({
        name: dealershipName,
        slug: `${slug}-${Date.now().toString(36)}`,
        timezone: tz,
        subscription_status: 'incomplete',
        max_locations: locationCount,
        settings: {},
      })
      .select('id')
      .single();

    if (dealershipError || !dealership) {
      console.error('Dealership creation failed:', (dealershipError as Error).message ?? dealershipError);
      await serviceClient.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: 'Failed to create dealership' }, { status: 500 });
    }

    const dealershipId = dealership.id as string;

    try {
      // 3. Create user row — F12-C-001: users table has only: id, full_name, phone, status,
      //    language, last_active_dealership_id, auth_id. No email/role/dealership_id columns.
      //    Role + dealership association go in dealership_memberships. Email lives in auth.users.
      const { error: userError } = await serviceClient.from('users').insert({
        id: userId,
        auth_id: userId,
        full_name: managerName,
        phone: '',
        status: 'active',
        last_active_dealership_id: dealershipId,
      });

      if (userError) throw userError;

      // 4. Create dealership_membership (role lives here, not on users)
      const { error: membershipError } = await serviceClient.from('dealership_memberships').insert({
        user_id: userId,
        dealership_id: dealershipId,
        role: 'owner',
      });

      if (membershipError) throw membershipError;

      // 5. Set user app_metadata
      const { error: metadataError } = await serviceClient.auth.admin.updateUserById(userId, {
        app_metadata: {
          dealership_id: dealershipId,
          user_role: 'owner',
        },
      });

      if (metadataError) throw metadataError;

      // 6. Default feature flags (RT-006: all features gated)
      const defaultFlags = [
        { flag_name: 'morning_script_enabled', enabled: false },
        { flag_name: 'coach_mode_enabled', enabled: false },
        { flag_name: 'persona_moods_enabled', enabled: true },
        { flag_name: 'billing_enabled', enabled: true },
        { flag_name: 'ask_iq_enabled', enabled: true },
        { flag_name: 'push_training_enabled', enabled: true },
        { flag_name: 'scenario_chains_enabled', enabled: true },
        { flag_name: 'peer_challenge_enabled', enabled: true },
        { flag_name: 'daily_challenge_enabled', enabled: true },
        { flag_name: 'manager_quick_create_enabled', enabled: true },
        { flag_name: 'behavioral_scoring_urgency', enabled: false },
        { flag_name: 'behavioral_scoring_competitive', enabled: false },
        { flag_name: 'vehicle_data_enabled', enabled: false },
      ];
      for (const flag of defaultFlags) {
        const { error: flagError } = await serviceClient.from('feature_flags').insert({
          dealership_id: dealershipId,
          ...flag,
          config: {},
        });

        if (flagError) throw flagError;
      }

      // 7. Create Stripe checkout session
      const { url } = await createCheckoutSession({
        dealershipId,
        email,
        locations: locationCount,
      });

      if (!url) {
        throw new Error('Failed to create checkout session');
      }

      // L13: parse + validate Stripe checkout hostname (paired with S9 fix).
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.hostname !== 'checkout.stripe.com') {
          throw new Error(`Unexpected checkout host: ${parsed.hostname}`);
        }
      } catch (e) {
        console.error('[CHECKOUT] Invalid Stripe checkout URL:', (e as Error).message);
        throw new Error('Invalid checkout URL from Stripe');
      }

      return NextResponse.json({ checkoutUrl: url });
    } catch (operationError) {
      // H8: Reverse-FK rollback order. If ANY step fails, record it and surface
      // a clear error to the caller so they can open a support ticket rather
      // than silently ending up in a half-created state they can't self-recover.
      console.error('Signup flow failed, rolling back:', (operationError as Error).message ?? operationError);
      const rollbackErrors: string[] = [];
      // 2026-04-18 L-8 (TODO): Each `step` runs exactly once. Transient
      // Supabase network errors during rollback leave orphaned rows that an
      // operator must manually clean up via the incident ID log. Upgrade
      // path: wrap fn() in a 2-attempt exponential backoff (100ms, 500ms)
      // before giving up. Low priority — orphaned rows are harmless
      // (FK-clean, subscription_status='incomplete') and the incident log
      // already surfaces them for manual cleanup.
      const step = async (label: string, fn: () => PromiseLike<unknown>) => {
        try { await fn(); } catch (e) { rollbackErrors.push(`${label}: ${(e as Error).message}`); }
      };
      // Order matters: delete children before parents so FK constraints don't block.
      await step('feature_flags', async () => { await serviceClient.from('feature_flags').delete().eq('dealership_id', dealershipId); });
      await step('dealership_memberships', async () => { await serviceClient.from('dealership_memberships').delete().eq('dealership_id', dealershipId); });
      await step('users', async () => { await serviceClient.from('users').delete().eq('id', userId); });
      await step('auth_user', async () => { await serviceClient.auth.admin.deleteUser(userId); });
      await step('dealerships', async () => { await serviceClient.from('dealerships').delete().eq('id', dealershipId); });

      if (rollbackErrors.length > 0) {
        // S14: log full details under an opaque incident ID; return only the ID
        // to the client so raw DB error messages can't be mined from the
        // public response surface.
        const incidentId = crypto.randomUUID();
        console.error('[CHECKOUT_ROLLBACK_INCOMPLETE]', {
          incident_id: incidentId,
          dealership_id: dealershipId,
          user_id: userId,
          errors: rollbackErrors,
        });
        return NextResponse.json(
          { error: 'Signup failed. Please contact support with reference: ' + incidentId },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: 'Signup failed. Please try again.' },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error('POST /api/billing/checkout error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
