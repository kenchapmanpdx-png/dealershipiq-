// C3: Grading-recovery cron.
// Any conversation_session stuck in status='grading' with grading_started_at
// older than GRADING_TIMEOUT_MIN is considered orphaned (webhook died before
// OpenAI returned) and is reset to 'active'. Next inbound SMS from the user
// will then succeed instead of hitting the "Still processing..." dead-end.
//
// Recommended schedule: every 5 minutes.
//   { "path": "/api/cron/grading-recovery", "schedule": "*/5 * * * *" }

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';

export const maxDuration = 60;

const GRADING_TIMEOUT_MIN = parseInt(process.env.GRADING_TIMEOUT_MIN || '3', 10);

export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - GRADING_TIMEOUT_MIN * 60_000).toISOString();

  const { data: stuck, error: selectErr } = await serviceClient
    .from('conversation_sessions')
    .select('id, dealership_id, user_id, grading_started_at')
    .eq('status', 'grading')
    .lt('grading_started_at', cutoff)
    .limit(200);

  if (selectErr) {
    log.error('grading_recovery.select_failed', { err: selectErr.message });
    return NextResponse.json({ error: 'Select failed' }, { status: 500 });
  }

  let reset = 0;
  const ids: string[] = [];

  for (const row of stuck ?? []) {
    // Atomic: only reset if still in grading state (handles race with webhook
    // finishing normally at the same moment as this cron).
    const { data: updated, error: upErr } = await serviceClient
      .from('conversation_sessions')
      .update({
        status: 'active',
        grading_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'grading')
      .select('id');

    if (upErr) {
      log.error('grading_recovery.update_failed', { session_id: row.id, err: upErr.message });
      continue;
    }
    if (Array.isArray(updated) && updated.length > 0) {
      reset++;
      ids.push(row.id as string);
      log.warn('grading_recovery.session_reset', {
        session_id: row.id,
        dealership_id: row.dealership_id,
        user_id: row.user_id,
        grading_started_at: row.grading_started_at,
      });
    }
  }

  return NextResponse.json({
    cutoff,
    candidates: stuck?.length ?? 0,
    reset,
    session_ids: ids,
  });
}
