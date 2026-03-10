// User Management: Send encouragement SMS
// PUT /api/users/[id]/encourage
// Auth: manager+ role required
// Sends encouragement SMS via Sinch, logs to sms_transcript_log

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
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

    // Get user and verify ownership
    const { data: targetUser, error: userError } = await serviceClient
      .from('users')
      .select(`
        id,
        phone,
        full_name,
        dealership_memberships (
          dealership_id
        )
      `)
      .eq('id', id)
      .single();

    if (userError || !targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Verify user belongs to this dealership
    const memberships = (targetUser.dealership_memberships ?? []) as Array<Record<string, unknown>>;
    if (!memberships.some((m: Record<string, unknown>) => m.dealership_id === dealershipId)) {
      return NextResponse.json(
        { error: 'User not in your dealership' },
        { status: 403 }
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

    // Send SMS
    const smsResponse = await sendSms(targetUser.phone, messageText);

    // Log to transcript
    await insertTranscriptLog({
      userId: targetUser.id,
      dealershipId,
      direction: 'outbound',
      messageBody: messageText,
      sinchMessageId: smsResponse.message_id,
    });

    return NextResponse.json({
      success: true,
      message_id: smsResponse.message_id,
      recipient: targetUser.phone,
    });
  } catch (err) {
    console.error('PUT /api/users/[id]/encourage error:', err);
    return NextResponse.json(
      { error: 'Failed to send encouragement message' },
      { status: 500 }
    );
  }
}
