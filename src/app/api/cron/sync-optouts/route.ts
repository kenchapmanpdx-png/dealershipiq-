// Opt-out sync cron — polls Sinch Consents API every 5 min
// Build Master: Phase 2A, 2E
// Sinch is authoritative for opt-out state. Local table is cache.
// C-003: Cron endpoint — service role required, no user JWT in cron context

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { createBudget } from '@/lib/cron-budget';
import { getSinchAccessToken } from '@/lib/sinch-auth';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

// H19: Sinch Consents API paginates. Previously we only read page 1, so any
// phone past page 1 was treated as "not opted out" and re-subscribed on the
// next sync. Fetch all pages before diffing.
async function fetchAllSinchOptOuts(
  projectId: string,
  appId: string,
  token: string
): Promise<Array<{ identity: string; channel: string }>> {
  const all: Array<{ identity: string; channel: string }> = [];
  let pageToken: string | undefined = undefined;
  const maxPages = 50; // safety ceiling; 50 * default page = plenty
  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    if (pageToken) params.set('page_token', pageToken);
    const url =
      `https://us.conversation.api.sinch.com/v1/projects/${projectId}/apps/${appId}/consents/OPT_OUT_LIST` +
      (params.toString() ? `?${params.toString()}` : '');

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.text();
      log.error('sinch.consents.http_error', { status: res.status, body: body.slice(0, 300), page });
      throw new Error(`Sinch Consents API ${res.status}`);
    }
    const data = await res.json();
    const batch: Array<{ identity: string; channel: string }> = data.consents ?? [];
    all.push(...batch);

    pageToken = data.next_page_token || data.nextPageToken;
    if (!pageToken) break;
  }
  return all;
}

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

    // H19: fetch EVERY page so diff against local cache is correct.
    const optOuts = await fetchAllSinchOptOuts(projectId, appId, token);

    // Filter to SMS only
    const smsOptOuts = optOuts
      .filter((c) => c.channel === 'SMS')
      .map((c) => c.identity);

    // Get all dealerships (we need to know which dealership each phone belongs to)
    // This is a lightweight sync — just upsert phones that Sinch says are opted out
    let synced = 0;

    // 2026-04-29 H5: Budget guard. The existing N+1 inside batches (serial
    // upsert per membership) is OK at our scale today, but at 100k+ opt-outs
    // it'll bust maxDuration. createBudget bails gracefully so the next run
    // can resume from where we stopped.
    const budget = createBudget({ cronName: 'sync-optouts', maxMs: 55_000, safetyBufferMs: 10_000 });

    // Process opt-outs in batches of 100 to avoid N+1 query pattern
    const batchSize = 100;
    for (let i = 0; i < smsOptOuts.length; i += batchSize) {
      if (budget.shouldStop()) break;
      const batch = smsOptOuts.slice(i, i + batchSize);

      // Fetch all users for this batch in a single query
      const { data: users } = await serviceClient
        .from('users')
        .select('phone, dealership_memberships(dealership_id)')
        .in('phone', batch);

      if (!users || users.length === 0) continue;

      // Process results in memory
      for (const user of users) {
        if (!user?.dealership_memberships) continue;

        const memberships = user.dealership_memberships as Array<{ dealership_id: string }>;
        for (const m of memberships) {
          const { error } = await serviceClient
            .from('sms_opt_outs')
            .upsert(
              { phone: user.phone, dealership_id: m.dealership_id, synced_from_sinch: true },
              { onConflict: 'phone,dealership_id' }
            );

          if (!error) synced++;
        }
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
