// C3: Grading-recovery cron.
// Any conversation_session stuck in status='grading' with grading_started_at
// older than GRADING_TIMEOUT_MIN is considered orphaned (webhook died before
// OpenAI returned) and is reset to 'active'. Next inbound SMS from the user
// will then succeed instead of hitting the "Still processing..." dead-end.
//
// 2026-07-02 AUDIT H5: also rescues status='error' sessions (grading threw —
// OpenAI failure, etc). Previously these dead-ended: the rep was told "we'll
// get your score to you soon" but nothing ever re-graded; the orphan sweeper
// just abandoned them after 2h. Resetting error → active gives the rep's
// next inbound text a live session to grade against, same as the 'grading'
// rescue. Filter uses updated_at (error rows have grading_started_at cleared).
//
// Recommended schedule: every 5 minutes.
//   { "path": "/api/cron/grading-recovery", "schedule": "*/5 * * * *" }

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron-auth';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';
import { sendSms } from '@/lib/sms';

// 2026-07-03: sent to the user when we rescue their stuck-in-grading session.
// Without this nudge the reset was invisible -- the user answered the final
// question, got silence, and the app appeared frozen even though their next
// text would have worked. <160 chars, GSM-7 safe.
const RECOVERY_NUDGE_SMS =
  "Sorry about that - grading your answer hit a snag on our end. Text your answer one more time and I'll get your score right over.";

// 2026-04-29: pin to Node runtime. cron-auth.ts imports `crypto` (Node-only).
// Without this directive Vercel can occasionally auto-detect Edge for routes
// lacking Node-specific imports at the top level, which would crash at
// module load when crypto resolves.
export const runtime = 'nodejs';
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

      // 2026-07-03: nudge the user so the rescue is visible. Best-effort --
      // a failed nudge must never block the reset (which already happened).
      try {
        const { data: userRow } = await serviceClient
          .from('users')
          .select('phone')
          .eq('id', row.user_id)
          .single();
        if (userRow?.phone) {
          await sendSms(userRow.phone as string, RECOVERY_NUDGE_SMS);
          log.info('grading_recovery.nudge_sent', { session_id: row.id, user_id: row.user_id });
        }
      } catch (nudgeErr) {
        log.warn('grading_recovery.nudge_failed', {
          session_id: row.id,
          err: (nudgeErr as Error).message ?? String(nudgeErr),
        });
      }
    }
  }

  // H5 (2026-07-02): rescue 'error' sessions the same way. Uses updated_at
  // because updateSessionStatus clears grading_started_at on 'error'.
  // Window: older than the grading timeout (avoid racing the webhook's own
  // error handler) but younger than 2h (past that, orphaned-sessions owns
  // the abandon; don't resurrect what it's about to sweep).
  const errorCutoffNewest = cutoff; // > GRADING_TIMEOUT_MIN old
  const errorCutoffOldest = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  const { data: errored, error: errSelectErr } = await serviceClient
    .from('conversation_sessions')
    .select('id, dealership_id, user_id, updated_at')
    .eq('status', 'error')
    .lt('updated_at', errorCutoffNewest)
    .gt('updated_at', errorCutoffOldest)
    .limit(200);

  let errorReset = 0;
  if (errSelectErr) {
    log.error('grading_recovery.error_select_failed', { err: errSelectErr.message });
  } else {
    for (const row of errored ?? []) {
      const { data: updated, error: upErr } = await serviceClient
        .from('conversation_sessions')
        .update({
          status: 'active',
          grading_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'error')
        .select('id');

      if (upErr) {
        log.error('grading_recovery.error_update_failed', { session_id: row.id, err: upErr.message });
        continue;
      }
      if (Array.isArray(updated) && updated.length > 0) {
        errorReset++;
        ids.push(row.id as string);
        log.warn('grading_recovery.error_session_reset', {
          session_id: row.id,
          dealership_id: row.dealership_id,
          user_id: row.user_id,
        });
      }
    }
  }

  return NextResponse.json({
    cutoff,
    candidates: (stuck?.length ?? 0) + (errored?.length ?? 0),
    reset,
    error_reset: errorReset,
    session_ids: ids,
  });
}
