// Opt-out sync cron — polls Sinch Consents API every 5 min
// Build Master: Phase 2A, 2E
// Sinch is authoritative for opt-out state. Local table is cache.

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getSinchAccessToken } from '@/lib/sinch-auth';
import { serviceClient } from '@/lib/supabase/service';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectId = process.env.SINCH_PROJECT_ID;
  const appId = process.env.SINCH_APP_ID;
  if (!projectId || !appId) {
    return NextResponse.json({ error: 'Sinch config missing' }, { status: 500 });
  }

  try {
    const token = await getSinchAccessToken();

    // Fetch opt-out list from Sinch Consents API
    const res = await fetch(
      `https://us.conversation.api.sinch.com/v1/projects/${projectId}/apps/${appId}/consents/OPT_OUT_LIST`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      const body = await res.text();
      console.error(`Sinch Consents API failed: ${res.status} ${body}`);
      return NextResponse.json({ error: 'Sinch API error', status: res.status });
    }

    const data = await res.json();
    const optOuts: Array<{ identity: string; channel: string }> = data.consents ?? [];

    // Filter to SMS only
    const smsOptOuts = optOuts
      .filter((c) => c.channel === 'SMS')
      .map((c) => c.identity);

    // Get all dealerships (we need to know which dealership each phone belongs to)
    // This is a lightweight sync — just upsert phones that Sinch says are opted out
    let synced = 0;

    for (const phone of smsOptOuts) {
      // Look up which dealership this phone belongs to
      const { data: user } = await serviceClient
        .from('users')
        .select('dealership_memberships(dealership_id)')
        .eq('phone', phone)
        .maybeSingle();

      if (!user?.dealership_memberships) continue;

      const memberships = user.dealership_memberships as Array<{ dealership_id: string }>;
      for (const m of memberships) {
        const { error } = await serviceClient
          .from('sms_opt_outs')
          .upsert(
            { phone, dealership_id: m.dealership_id, synced_from_sinch: true },
            { onConflict: 'phone,dealership_id' }
          );

        if (!error) synced++;
      }
    }

    // Also check: local opt-outs NOT in Sinch list → remove (re-subscribe)
    const { data: localOptOuts } = await serviceClient
      .from('sms_opt_outs')
      .select('phone, dealership_id')
      .eq('synced_from_sinch', true);

    // H-006 fix: Use Set for O(1) lookup instead of O(N) array.includes
    const smsOptOutSet = new Set(smsOptOuts);
    let resubscribed = 0;
    for (const local of localOptOuts ?? []) {
      if (!smsOptOutSet.has(local.phone)) {
        await serviceClient
          .from('sms_opt_outs')
          .delete()
          .eq('phone', local.phone)
          .eq('dealership_id', local.dealership_id);
        resubscribed++;
      }
    }

    return NextResponse.json({ synced, resubscribed, sinchOptOuts: smsOptOuts.length });
  } catch (err) {
    console.error('Opt-out sync error:', (err as Error).message ?? err);
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
