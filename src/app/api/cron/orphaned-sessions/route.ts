// Orphaned session detector — finds sessions stuck in active/grading > 2 hours
// Build Master: Phase 2G
// Marks abandoned, alerts manager

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { getOrphanedSessions, updateSessionStatus } from '@/lib/service-db';

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orphaned = await getOrphanedSessions(2);
  let cleaned = 0;

  for (const session of orphaned) {
    try {
      await updateSessionStatus(session.id, 'abandoned');
      cleaned++;
      // TODO: Alert manager via dashboard notification
      console.warn(
        `Orphaned session ${session.id} (${session.status}) for user ${session.user_id} — marked abandoned`
      );
    } catch (err) {
      console.error(`Failed to clean orphaned session ${session.id}:`, err);
    }
  }

  return NextResponse.json({ found: orphaned.length, cleaned });
}
