// GET /api/admin/costs
// Phase 5: Ken-only cost tracking endpoint
// Returns per-dealership SMS count and estimated OpenAI token usage

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

const ADMIN_EMAIL = 'kenchapmanpdx@gmail.com';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const period = request.nextUrl.searchParams.get('period') || '7d';
  const days = period === '30d' ? 30 : period === '24h' ? 1 : 7;
  const since = new Date();
  since.setDate(since.getDate() - days);

  // SMS counts per dealership
  const { data: smsCounts } = await serviceClient
    .from('transcript_logs')
    .select('dealership_id, id')
    .eq('direction', 'outbound')
    .gte('created_at', since.toISOString());

  // Session counts per dealership (proxy for OpenAI usage)
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

  for (const log of smsCounts ?? []) {
    const did = log.dealership_id as string;
    const entry = costMap.get(did) || { sms: 0, exchanges: 0 };
    entry.sms++;
    costMap.set(did, entry);
  }

  for (const session of sessions ?? []) {
    const did = session.dealership_id as string;
    const entry = costMap.get(did) || { sms: 0, exchanges: 0 };
    entry.exchanges += (session.exchange_count as number) || 1;
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
