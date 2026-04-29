// User Management: Add new employee
// POST /api/users
// Body: { full_name: string; phone: string }
// Auth: manager+ role required
// Validates E.164 phone, checks for duplicates and opt-outs
// C-003: Tenant-scoped queries use RLS client. Cross-tenant phone check uses serviceClient.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/sms';
import { getDealershipName, insertTranscriptLog } from '@/lib/service-db';
import { requireAuth } from '@/lib/auth-helpers';
import { apiError, apiSuccess, requireJsonContentType } from '@/lib/api-helpers';
import { tryNormalizePhone, isValidE164 } from '@/lib/phone';
import { log } from '@/lib/logger';

// 2026-04-18 H-6: Removed the local `validateE164Phone` / `normalizePhone`
// helpers. Those accepted patterns the canonical helper rejects (e.g. bare
// 8–15 digit international numbers, "+++++1234567890") and unconditionally
// prepended "+1" to any 10-digit input. That mismatch meant a rep added via
// this route could be stored with a different format than one added via
// /api/users/import or /api/onboarding/employees — breaking the exact-match
// `.eq('phone', ...)` lookup that inbound SMS dispatch relies on. All three
// routes now funnel through `tryNormalizePhone` + `isValidE164`.

interface CreateUserRequest {
  full_name: string;
  phone: string;
}

interface CreateUserResponse {
  id: string;
  full_name: string;
  phone: string;
  status: string;
}

export async function POST(request: NextRequest) {
  try {
    // L-14: content-type gate
    const ctErr = requireJsonContentType(request);
    if (ctErr) return ctErr;

    const supabase = await createServerSupabaseClient();

    // Validate auth and get context
    const auth = await requireAuth(supabase, ['manager', 'owner']);
    if (auth instanceof NextResponse) return auth;
    const { dealershipId } = auth;

    const body = await request.json() as CreateUserRequest;

    // Validate input
    if (!body.full_name || !body.phone) {
      return apiError('Missing required fields: full_name, phone', 400);
    }

    // H-6: Canonical normalization — same rules as CSV import and onboarding.
    const normalizedPhone = tryNormalizePhone(body.phone);
    if (!normalizedPhone || !isValidE164(normalizedPhone)) {
      return apiError(
        'Invalid phone number. Use E.164 format (e.g., +1 2025551234)',
        400
      );
    }

    // Check for existing user with same phone
    const { data: existingUser, error: existingError } = await serviceClient
      .from('users')
      .select('id, phone')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError;
    }

    if (existingUser) {
      return apiError('User with this phone number already exists', 409);
    }

    // C-003: RLS-backed — sms_opt_outs SELECT policy filters by dealership_id from JWT
    const { data: optOut, error: optOutError } = await supabase
      .from('sms_opt_outs')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (optOutError && optOutError.code !== 'PGRST116') {
      throw optOutError;
    }

    if (optOut) {
      return apiError('This phone number is opted out. Remove from opt-out list first.', 409);
    }

    // C-003: RLS-backed — users_insert_manager policy allows manager INSERT
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        full_name: body.full_name.trim(),
        phone: normalizedPhone,
        status: 'pending_consent',
        language: 'en',
      })
      .select('id, full_name, phone, status')
      .single();

    if (createError) {
      log.error('users.create.insert_failed', {
        dealership_id: dealershipId,
        error: (createError as Error).message ?? String(createError),
      });
      return apiError('Failed to create user', 500);
    }

    // C-003: RLS-backed — memberships_insert_manager policy allows manager INSERT
    const { error: memberError } = await supabase
      .from('dealership_memberships')
      .insert({
        user_id: newUser.id,
        dealership_id: dealershipId,
        role: 'salesperson',
        is_primary: true,
      });

    if (memberError) {
      log.error('users.create.membership_insert_failed', {
        dealership_id: dealershipId,
        user_id: newUser.id,
        error: (memberError as Error).message ?? String(memberError),
      });
      // Rollback user creation
      try {
        await serviceClient.from('users').delete().eq('id', newUser.id);
      } catch (cleanupErr) {
        log.error('users.create.rollback_failed', {
          user_id: newUser.id,
          error: (cleanupErr as Error).message,
        });
      }
      return apiError('Failed to add user to dealership', 500);
    }

    // Send consent SMS (non-blocking — don't fail the add if SMS fails)
    try {
      const dealershipName = await getDealershipName(dealershipId);
      const consentMsg = `${dealershipName} uses DealershipIQ for training. You'll receive daily practice questions via text. Reply YES to opt in, or STOP to decline.`;
      const smsResponse = await sendSms(normalizedPhone, consentMsg);
      await insertTranscriptLog({
        userId: newUser.id,
        dealershipId,
        phone: normalizedPhone,
        direction: 'outbound',
        messageBody: consentMsg,
        sinchMessageId: smsResponse.message_id,
        metadata: { type: 'consent_request' },
      });
    } catch (smsErr) {
      log.warn('users.create.consent_sms_failed', {
        user_id: newUser.id,
        error: (smsErr as Error).message ?? String(smsErr),
      });
    }

    const response: CreateUserResponse = {
      id: newUser.id,
      full_name: newUser.full_name,
      phone: newUser.phone,
      status: newUser.status,
    };

    return apiSuccess(response, 201);
  } catch (err) {
    log.error('users.create.error', {
      error: (err as Error).message ?? String(err),
    });
    return apiError('Internal server error', 500);
  }
}
