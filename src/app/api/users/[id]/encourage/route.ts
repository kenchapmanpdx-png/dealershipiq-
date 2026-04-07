// User Management: Send encouragement SMS
// PUT /api/users/[id]/encourage
// Auth: manager+ role required
// Sends encouragement SMS via Sinch, logs to sms_transcript_log
// C-003: Migrated — All operations via RLS client. insertTranscriptLog via RLS client (H-004 INSERT policy added 03/14).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendSms } from '@/lib/sms';
import { insertTranscriptLog } from '@/lib/service-db';

interface EncourageRequest {
  message?: string;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dealershipId = user.app_metadata?.dealership_id as string | undefined;
    if (!dealershipId) {
      return NextResponse.json({ error: 'No dealership' }, { status: 403 });
    }

    const userRole = user.app_metadata?.user_role as string | undefined;
    if (userRole !== 'manager' && userRole !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json() as EncourageRequest;

    // C-003: RLS-backed + explicit dealership_id filter for defense-in-depth.
    // Ensures target user belongs to the calling manager's dealership.
    const { data: targetUser, error: userError } = await supabase
      .from('users')
      .select(`
        id,
        phone,
        full_name,
        dealership_memberships!inner (
          dealership_id
        )
      `)
      .eq('id', id)
      .eq('dealership_memberships.dealership_id', dealershipId)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Default encouragement message
    const defaultMessage = `Great effort on your training today! Keep up the momentum. You're making progress!`;
    const messageText = (body.message ?? defaultMessage).trim();

    if (!messageText || messageText.length === 0) {
      return NextResponse.json(
        { error: 'Message cannot be empty' },
        { status: 400 }
      );
    }

    if (messageText.length > 160) {
      return NextResponse.json(
        { error: 'Message must be 160 characters or less' },
        { status: 400 }
      );
    }

    // H-013: Send SMS with explicit error handling and audit trail for failures
    let smsResponse;
    try {
      smsResponse = await sendSms(targetUser.phone, messageText);
    } catch (smsErr) {
      console.error(`Encourage SMS failed for user ${id}:`, (smsErr as Error).message ?? smsErr);
      // Log failed attempt for audit trail
      try {
        await insertTranscriptLog({
          userId: targetUser.id,
          dealershipId,
          direction: 'outbound',
          messageBody: messageText,
          sinchMessageId: 'failed',
          phone: targetUser.phone,
          metadata: { type: 'encouragement', status: 'failed', error: String(smsErr) },
        }, supabase);
      } catch { /* best-effort logging */ }
      return NextResponse.json(
        { error: 'SMS delivery failed. The message was not sent.' },
        { status: 502 }
      );
    }

    // Log successful send to transcript
    await insertTranscriptLog({
      userId: targetUser.id,
      dealershipId,
      direction: 'outbound',
      messageBody: messageText,
      sinchMessageId: smsResponse.message_id,
      phone: targetUser.phone,
      metadata: { type: 'encouragement' },
    }, supabase);

    return NextResponse.json({
      success: true,
      message_id: smsResponse.message_id,
      recipient: targetUser.phone,
    });
  } catch (err) {
    console.error('PUT /api/users/[id]/encourage error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Failed to send encouragement message' },
      { status: 500 }
    );
  }
}
