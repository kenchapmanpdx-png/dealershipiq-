// GET /api/dashboard/meeting-script
// Returns today's morning meeting script for the manager's dealership.
// Falls back to yesterday's script if today's hasn't generated yet.
// Auth: Manager role via Supabase JWT (cookie-based).
// Phase 4.5B
// C-003: Migrated from serviceClient to RLS-backed authenticated client.

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { requireAuth } from '@/lib/auth-helpers';
import { apiError, apiSuccess } from '@/lib/api-helpers';
import type { MeetingScriptResponse, MeetingScriptFullScript } from '@/types/meeting-script';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const auth = await requireAuth(supabase, ['manager', 'owner']);
    if (auth instanceof NextResponse) return auth;
    const { dealershipId } = auth;

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return apiError(`Subscription required: ${subCheck.reason}`, 403);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // C-003: RLS policy on meeting_scripts auto-filters by dealership_id from JWT
    const { data: todayScript } = await supabase
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('script_date', todayStr)
      .maybeSingle();

    if (todayScript) {
      const response: MeetingScriptResponse = {
        data: todayScript.full_script as MeetingScriptFullScript,
        is_yesterday: false,
        script_date: todayScript.script_date as string,
      };
      return apiSuccess(response);
    }

    // Fallback: yesterday's script
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: yesterdayScript } = await supabase
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('script_date', yesterdayStr)
      .maybeSingle();

    if (yesterdayScript) {
      const response: MeetingScriptResponse = {
        data: yesterdayScript.full_script as MeetingScriptFullScript,
        is_yesterday: true,
        script_date: yesterdayScript.script_date as string,
      };
      return apiSuccess(response);
    }

    // No script at all
    const response: MeetingScriptResponse = {
      data: null,
      is_yesterday: false,
      script_date: todayStr,
    };
    return apiSuccess(response);
  } catch (err) {
    console.error('Meeting script API error:', (err as Error).message ?? err);
    return apiError('Internal error', 500);
  }
}
