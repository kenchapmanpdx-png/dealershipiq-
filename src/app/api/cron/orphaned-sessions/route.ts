// Orphaned session detector — finds sessions stuck in active/grading > 2 hours
// Build Master: Phase 2G + Phase 6D (peer challenge expiry)
// Marks abandoned, alerts manager

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getOrphanedSessions, updateSessionStatus } from '@/lib/service-db';
import { expirePeerChallenges } from '@/lib/challenges/peer';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // --- Orphaned sessions ---
  const orphaned = await getOrphanedSessions(2);
  let cleaned = 0;

  for (const session of orphaned) {
    try {
      await updateSessionStatus(session.id, 'abandoned');
      cleaned++;
      console.warn(
        `Orphaned session ${session.id} (${session.status}) for user ${session.user_id} — marked abandoned`
      );
    } catch (err) {
      console.error(`Failed to clean orphaned session ${session.id}:`, err);
    }
  }

  // --- Phase 6D: Expire peer challenges ---
  let peerExpiry = { expired: 0, defaultWins: 0 };
  try {
    peerExpiry = await expirePeerChallenges();
  } catch (err) {
    console.error('Peer challenge expiry error:', err);
  }

  return NextResponse.json({
    found: orphaned.length,
    cleaned,
    peerChallenges: peerExpiry,
  });
}
