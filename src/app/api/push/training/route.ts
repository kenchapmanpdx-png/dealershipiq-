// Training Management: Push ad-hoc training session
// POST /api/push/training
// Body: { user_ids: string[]; mode?: 'roleplay' | 'quiz' | 'objection'; custom_question?: string }
// Auth: manager+ role required
// Creates session + sends SMS to specified users
// Phase 5: subscription gating
// C-003: Users SELECT migrated to RLS. Service-db functions stay on serviceClient (no INSERT policies).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { checkSubscriptionAccess } from '@/lib/billing/subscription';
import { sendSms } from '@/lib/sms';
import {
  createConversationSession,
  updateSessionStatus,
  insertTranscriptLog,
  insertDeliveryLog,
  isFeatureEnabled,
} from '@/lib/service-db';

interface PushTrainingRequest {
  user_ids: string[];
  mode?: 'roleplay' | 'quiz' | 'objection';
  custom_question?: string;
}

interface PushResult {
  sent: number;
  failed: number;
  users: Array<{
    user_id: string;
    status: 'sent' | 'failed';
    error?: string;
  }>;
}

const DEFAULT_QUESTIONS: Record<string, string> = {
  roleplay: `[Ad-Hoc Training] A customer says: "I found this car $2,000 cheaper at another dealership." How would you respond?`,
  quiz: `[Ad-Hoc Training] Quick quiz: What are the top 3 features you should highlight when presenting the safety package?`,
  objection: `[Ad-Hoc Training] The customer says: "I need to think about it and talk to my spouse." What's your best response?`,
};

export async function POST(request: NextRequest) {
  try {
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

    // RT-006: Feature flag gate
    const pushEnabled = await isFeatureEnabled(dealershipId, 'push_training_enabled');
    if (!pushEnabled) {
      return NextResponse.json(
        { error: 'Push training is not enabled for your dealership' },
        { status: 403 }
      );
    }

    // Phase 5: subscription gating
    const subCheck = await checkSubscriptionAccess(dealershipId);
    if (!subCheck.allowed) {
      return NextResponse.json(
        { error: 'Subscription inactive. Please update billing to send training.' },
        { status: 403 }
      );
    }

    const body = await request.json() as PushTrainingRequest;

    // Validate input
    if (!body.user_ids || !Array.isArray(body.user_ids) || body.user_ids.length === 0) {
      return NextResponse.json(
        { error: 'user_ids must be a non-empty array' },
        { status: 400 }
      );
    }

    const mode = body.mode ?? 'roleplay';
    if (!['roleplay', 'quiz', 'objection'].includes(mode)) {
      return NextResponse.json(
        { error: 'mode must be roleplay, quiz, or objection' },
        { status: 400 }
      );
    }

    // Question: custom > default for mode
    const questionText = body.custom_question ?? DEFAULT_QUESTIONS[mode];
    if (!questionText || questionText.trim().length === 0) {
      return NextResponse.json(
        { error: 'No question provided' },
        { status: 400 }
      );
    }

    // C-003: RLS-backed — users + memberships SELECT policies auto-filter by dealership from JWT.
    // Using !inner ensures only users with membership in THIS dealership are returned.
    const { data: targetUsers, error: usersError } = await supabase
      .from('users')
      .select(`
        id,
        phone,
        full_name,
        status,
        dealership_memberships!inner (
          dealership_id
        )
      `)
      .in('id', body.user_ids);

    if (usersError) {
      console.error('Failed to fetch users:', usersError);
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      );
    }

    const result: PushResult = { sent: 0, failed: 0, users: [] };

    for (const targetUser of targetUsers ?? []) {

      try {
        // Create session
        const session = await createConversationSession({
          userId: targetUser.id,
          dealershipId,
          mode,
          questionText,
        });

        // Send SMS
        const smsResponse = await sendSms(targetUser.phone, questionText);

        // Transition: pending → active
        await updateSessionStatus(session.id, 'active');

        // Log outbound
        await insertTranscriptLog({
          userId: targetUser.id,
          dealershipId,
          direction: 'outbound',
          messageBody: questionText,
          sinchMessageId: smsResponse.message_id,
          phone: targetUser.phone,
          sessionId: session.id,
        });

        // Log delivery
        await insertDeliveryLog({
          dealershipId,
          userId: targetUser.id,
          phone: targetUser.phone,
          sinchMessageId: smsResponse.message_id,
          status: 'sent',
          sessionId: session.id,
        });

        result.sent++;
        result.users.push({
          user_id: targetUser.id,
          status: 'sent',
        });

        // Stagger: 50ms between sends
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error(`Failed to push training to ${targetUser.id}:`, err);
        result.failed++;
        result.users.push({
          user_id: targetUser.id,
          status: 'failed',
          error: 'Failed to send SMS',
        });
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/push/training error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
