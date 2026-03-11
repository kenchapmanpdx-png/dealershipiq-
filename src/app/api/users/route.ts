// User Management: Add new employee
// POST /api/users
// Body: { full_name: string; phone: string }
// Auth: manager+ role required
// Validates E.164 phone, checks for duplicates and opt-outs

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/sms';
import { getDealershipName, insertTranscriptLog } from '@/lib/service-db';

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

// E.164 validation: +1-10 digits, optional formatting
function validateE164Phone(phone: string): boolean {
  const e164Pattern = /^\+?1?\d{10,15}$/;
  return e164Pattern.test(phone.replace(/\D/g, ''));
}

// Normalize to E.164 format: +1XXXXXXXXXX
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If starts with 1, add +, else add +1
  return digits.length === 11 && digits.startsWith('1')
    ? `+${digits}`
    : `+1${digits}`;
}

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

    const body = await request.json() as CreateUserRequest;

    // Validate input
    if (!body.full_name || !body.phone) {
      return NextResponse.json(
        { error: 'Missing required fields: full_name, phone' },
        { status: 400 }
      );
    }

    // Validate phone format
    if (!validateE164Phone(body.phone)) {
      return NextResponse.json(
        { error: 'Invalid phone number. Use E.164 format (e.g., +1 2025551234)' },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(body.phone);

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
      return NextResponse.json(
        { error: 'User with this phone number already exists' },
        { status: 409 }
      );
    }

    // Check if phone is opted out in this dealership
    const { data: optOut, error: optOutError } = await serviceClient
      .from('sms_opt_outs')
      .select('id')
      .eq('phone', normalizedPhone)
      .eq('dealership_id', dealershipId)
      .maybeSingle();

    if (optOutError && optOutError.code !== 'PGRST116') {
      throw optOutError;
    }

    if (optOut) {
      return NextResponse.json(
        { error: 'This phone number is opted out. Remove from opt-out list first.' },
        { status: 409 }
      );
    }

    // Create user
    const { data: newUser, error: createError } = await serviceClient
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
      console.error('Failed to create user:', createError);
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      );
    }

    // Add to dealership_memberships as salesperson
    const { error: memberError } = await serviceClient
      .from('dealership_memberships')
      .insert({
        user_id: newUser.id,
        dealership_id: dealershipId,
        role: 'salesperson',
        is_primary: true,
      });

    if (memberError) {
      console.error('Failed to add dealership membership:', memberError);
      // Rollback user creation
      await serviceClient.from('users').delete().eq('id', newUser.id);
      return NextResponse.json(
        { error: 'Failed to add user to dealership' },
        { status: 500 }
      );
    }

    // Send consent SMS (non-blocking — don't fail the add if SMS fails)
    try {
      const dealershipName = await getDealershipName(dealershipId);
      const consentMsg = `${dealershipName} uses DealershipIQ for sales training. You'll receive daily practice questions via text. Reply YES to opt in, or STOP to decline.`;
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
      console.error('Consent SMS failed (user still created):', smsErr);
    }

    const response: CreateUserResponse = {
      id: newUser.id,
      full_name: newUser.full_name,
      phone: newUser.phone,
      status: newUser.status,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error('POST /api/users error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
