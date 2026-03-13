// GET /api/dashboard/meeting-script
// Returns today's morning meeting script for the manager's dealership.
// Falls back to yesterday's script if today's hasn't generated yet.
// Auth: Manager role via Supabase JWT.
// Phase 4.5B

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serviceClient } from '@/lib/supabase/service';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import type { MeetingScriptResponse, MeetingScriptFullScript } from '@/types/meeting-script';

export async function GET(request: NextRequest) {
  // Authenticate via Supabase JWT
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // C-007: Only trust app_metadata (server-set). user_metadata is client-editable.
    const dealershipId = user.app_metadata?.dealership_id as string | undefined;

    if (!dealershipId) {
      return NextResponse.json({ error: 'No dealership' }, { status: 403 });
    }

    // H-010: Subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json({ error: 'Subscription required', reason: subCheck.reason }, { status: 403 });
    }

    const todayStr = new Date().toISOString().split('T')[0];

    // Try today's script
    const { data: todayScript } = await serviceClient
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('dealership_id', dealershipId)
      .eq('script_date', todayStr)
      .maybeSingle();

    if (todayScript) {
      const response: MeetingScriptResponse = {
        data: todayScript.full_script as MeetingScriptFullScript,
        is_yesterday: false,
        script_date: todayScript.script_date as string,
      };
      return NextResponse.json(response);
    }

    // Fallback: yesterday's script
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const { data: yesterdayScript } = await serviceClient
      .from('meeting_scripts')
      .select('full_script, script_date')
      .eq('dealership_id', dealershipId)
      .eq('script_date', yesterdayStr)
      .maybeSingle();

    if (yesterdayScript) {
      const response: MeetingScriptResponse = {
        data: yesterdayScript.full_script as MeetingScriptFullScript,
        is_yesterday: true,
        script_date: yesterdayScript.script_date as string,
      };
      return NextResponse.json(response);
    }

    // No script at all
    const response: MeetingScriptResponse = {
      data: null,
      is_yesterday: false,
      script_date: todayStr,
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error('Meeting script API error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
