// GET /api/admin/costs
// Phase 5: Ken-only cost tracking endpoint
// Returns per-dealership SMS count and estimated OpenAI token usage
// C-003: serviceClient justified — cross-tenant admin query. Auth gated by email allowlist.
//
// 2026-04-18 M-10: Email-only gate was a single phish away from full cross-tenant
// data leakage (SMS volumes, Stripe status, per-dealership spend). Layered defense:
//   1. ADMIN_EMAIL must match.
//   2. The session must be at AAL2 (Supabase MFA / TOTP verified in this session).
//   3. `app_metadata.admin_approved: true` must be present — set out-of-band by
//      the Supabase service role, NOT editable by the user themselves. A stolen
//      password + stolen TOTP seed still fails without this claim.
// All three must pass. Failures log to `admin.costs.auth_failed` for alerting.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';

// M10-FIX: Admin email from env var. No fallback — must be explicitly configured.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

export async function GET(request: NextRequest) {
  // Security: ADMIN_EMAIL must be explicitly configured in environment
  if (!ADMIN_EMAIL) {
    log.error('admin.costs.env_missing', { var: 'ADMIN_EMAIL' });
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Layer 1: email allowlist
  if (user.email !== ADMIN_EMAIL) {
    log.warn('admin.costs.auth_failed', { reason: 'email_mismatch', user_id: user.id });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Layer 2: require Supabase MFA at AAL2 for this session. Without MFA
  // enrollment + a recent TOTP challenge, this returns aal1 and we reject.
  // Admin must enroll a TOTP factor via Supabase Auth and verify on each session.
  try {
    const { data: aal, error: aalErr } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalErr) {
      log.error('admin.costs.aal_lookup_failed', {
        user_id: user.id,
        error: aalErr.message,
      });
      return NextResponse.json({ error: 'MFA check failed' }, { status: 500 });
    }
    if (aal?.currentLevel !== 'aal2') {
      log.warn('admin.costs.auth_failed', {
        reason: 'mfa_required',
        user_id: user.id,
        current_level: aal?.currentLevel,
      });
      return NextResponse.json(
        { error: 'MFA required', required_level: 'aal2' },
        { status: 403 }
      );
    }
  } catch (err) {
    log.error('admin.costs.aal_exception', {
      user_id: user.id,
      error: (err as Error).message ?? String(err),
    });
    return NextResponse.json({ error: 'MFA check failed' }, { status: 500 });
  }

  // Layer 3: `admin_approved` claim in app_metadata (service-role-only writable).
  // Prevents a hijacked account — even with MFA — from reading cross-tenant data
  // unless this claim was explicitly granted in Supabase Auth admin API.
  const adminApproved = user.app_metadata?.admin_approved === true;
  if (!adminApproved) {
    log.warn('admin.costs.auth_failed', {
      reason: 'admin_claim_missing',
      user_id: user.id,
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const period = request.nextUrl.searchParams.get('period') || '7d';
  const days = period === '30d' ? 30 : period === '24h' ? 1 : 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // 2026-04-18 H-8: Table name was `transcript_logs` (wrong — returned {}
  // silently against PostgREST). Canonical name is `sms_transcript_log`
  // (singular) — see src/lib/service-db.ts and every other caller in the
  // codebase. The old name meant this endpoint always under-reported SMS
  // counts as zero, so every billing/cost review was incorrect.
  const { data: smsCounts, error: smsCountsError } = await serviceClient
    .from('sms_transcript_log')
    .select('dealership_id, id')
    .eq('direction', 'outbound')
    .gte('created_at', since.toISOString());

  if (smsCountsError) {
    log.error('admin.costs.sms_query_failed', { error: smsCountsError.message });
    return NextResponse.json({ error: 'Failed to load cost data' }, { status: 500 });
  }

  // Session counts per dealership (proxy for OpenAI usage).
  //
  // 2026-04-18 L-6 (TODO): For scale, replace this Map-based aggregation with
  // a Postgres RPC that does `SELECT dealership_id, SUM(exchange_count) ...
  // GROUP BY dealership_id` inside the database. At >100k sessions/window,
  // pulling every row over the wire becomes the bottleneck.
  const { data: sessions } = await serviceClient
    .from('conversation_sessions')
    .select('dealership_id, id, exchange_count')
    .gte('created_at', since.toISOString());

  // Get dealership names
  const { data: dealerships } = await serviceClient
    .from('dealerships')
    .select('id, name, is_pilot, subscription_status');

  const dealershipMap = new Map(
    (dealerships ?? []).map((d) => [d.id as string, d])
  );

  // Aggregate
  const costMap = new Map<string, { sms: number; exchanges: number }>();

  for (const row of smsCounts ?? []) {
    const did = row.dealership_id as string;
    const entry = costMap.get(did) || { sms: 0, exchanges: 0 };
    entry.sms++;
    costMap.set(did, entry);
  }

  for (const session of sessions ?? []) {
    const did = session.dealership_id as string;
    const entry = costMap.get(did) || { sms: 0, exchanges: 0 };
    // 2026-04-18 L-7: Pending sessions (exchange_count = 0 or null) should
    // NOT be counted as one billable exchange. The prior `|| 1` fallback
    // silently inflated the cost estimate by one OpenAI call per pending
    // session — materially wrong on a dashboard that drives pricing
    // decisions. A pending session that hasn't started exchanges has cost
    // us nothing yet; when it transitions to `active` the exchange_count
    // will be written and counted on the next refresh.
    const count = session.exchange_count;
    entry.exchanges += typeof count === 'number' && count > 0 ? count : 0;
    costMap.set(did, entry);
  }

  // Estimate costs
  // SMS: ~$0.01/segment outbound via Sinch
  // OpenAI: ~$0.03/exchange (GPT-5.4 ~1K tokens in + 500 out per exchange)
  const SMS_COST = 0.01;
  const EXCHANGE_COST = 0.03;

  const results = Array.from(costMap.entries()).map(([did, counts]) => {
    const d = dealershipMap.get(did);
    return {
      dealership_id: did,
      dealership_name: (d?.name as string) ?? 'Unknown',
      is_pilot: (d?.is_pilot as boolean) ?? false,
      subscription_status: (d?.subscription_status as string) ?? 'unknown',
      sms_count: counts.sms,
      exchange_count: counts.exchanges,
      estimated_sms_cost: Math.round(counts.sms * SMS_COST * 100) / 100,
      estimated_ai_cost: Math.round(counts.exchanges * EXCHANGE_COST * 100) / 100,
      estimated_total: Math.round((counts.sms * SMS_COST + counts.exchanges * EXCHANGE_COST) * 100) / 100,
    };
  });

  results.sort((a, b) => b.estimated_total - a.estimated_total);

  const totals = results.reduce(
    (acc, r) => ({
      sms: acc.sms + r.sms_count,
      exchanges: acc.exchanges + r.exchange_count,
      cost: acc.cost + r.estimated_total,
    }),
    { sms: 0, exchanges: 0, cost: 0 }
  );

  return NextResponse.json({
    period,
    days,
    dealerships: results,
    totals: {
      sms_count: totals.sms,
      exchange_count: totals.exchanges,
      estimated_total: Math.round(totals.cost * 100) / 100,
    },
  });
}
