// Orphaned session detector — finds sessions stuck in active/grading > 2 hours
// Build Master: Phase 2G + Phase 6D (peer challenge expiry)
// Marks abandoned, alerts manager

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getOrphanedSessions, updateSessionStatus } from '@/lib/service-db';
import { expirePeerChallenges } from '@/lib/challenges/peer';
import { incrementMissedDay } from '@/lib/chains/lifecycle';
import { isScheduledOff } from '@/lib/schedule-awareness';
import { serviceClient } from '@/lib/supabase/service';
import { createBudget } from '@/lib/cron-budget';

// 2026-04-29: pin Node runtime — cron-auth.ts imports `crypto` (Node-only).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2026-07-02 AUDIT H2: budget guard — this route runs three unbounded
  // loops (orphans, stale chains, peer expiry). Without a guard, Vercel
  // hard-kills at maxDuration=60 mid-loop; with it, we stop gracefully and
  // the every-2h rerun picks up the remainder (all operations idempotent).
  const budget = createBudget({ maxMs: 55_000, cronName: 'orphaned-sessions' });

  // --- Orphaned sessions ---
  const orphaned = await getOrphanedSessions(2);
  let cleaned = 0;

  for (const session of orphaned) {
    if (budget.shouldStop()) break;
    try {
      await updateSessionStatus(session.id, session.dealership_id as string, 'abandoned');
      cleaned++;
      budget.markProcessed();
      console.warn(
        `Orphaned session ${session.id} (${session.status}) for user ${session.user_id} — marked abandoned`
      );
    } catch (err) {
      console.error(`Failed to clean orphaned session ${session.id}:`, (err as Error).message ?? err);
    }
  }

  // --- C-003: Expire stale scenario chains ---
  let chainsExpired = 0;
  try {
    // Query scenario_chains where status = 'active' and last_step_at < (now - 1 business day)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: staleChains } = await serviceClient
      .from('scenario_chains')
      .select('id, user_id, dealership_id, status')
      .eq('status', 'active')
      .lt('last_step_at', oneDayAgo);

    if (staleChains) {
      for (const chain of staleChains) {
        if (budget.shouldStop()) break;
        try {
          // F13-M-001: Look up dealership timezone for schedule check
          const { data: dealershipData } = await serviceClient
            .from('dealerships')
            .select('timezone')
            .eq('id', chain.dealership_id as string)
            .single();
          const chainTz = (dealershipData?.timezone as string) || 'America/New_York';

          const scheduledOff = await isScheduledOff(
            chain.user_id as string,
            chain.dealership_id as string,
            new Date(),
            chainTz
          );

          // If NOT scheduled off, increment missed day counter
          if (!scheduledOff) {
            const expired = await incrementMissedDay(chain.id as string);
            if (expired) chainsExpired++;
          }
        } catch (err) {
          console.error(`Failed to process chain ${chain.id}:`, (err as Error).message ?? err);
        }
      }
    }
  } catch (err) {
    console.error('Scenario chain expiry error:', (err as Error).message ?? err);
  }

  // --- Phase 6D: Expire peer challenges ---
  let peerExpiry = { expired: 0, defaultWins: 0 };
  if (!budget.shouldStop()) {
    try {
      peerExpiry = await expirePeerChallenges();
    } catch (err) {
      console.error('Peer challenge expiry error:', (err as Error).message ?? err);
    }
  }

  return NextResponse.json({
    found: orphaned.length,
    cleaned,
    chainsExpired,
    peerChallenges: peerExpiry,
    ...budget.report(),
  });
}
