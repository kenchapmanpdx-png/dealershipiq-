// POST /api/app/auth — Phone-based authentication for employee PWA
// Verifies phone + last 4 digits, returns session token
// Phase 4.5A

import { NextRequest, NextResponse } from 'next/server';
import { serviceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const { phone, last_four, dealership_slug } = await request.json();

    if (!phone || !last_four || last_four.length !== 4) {
      return NextResponse.json(
        { error: 'Phone and last 4 digits required' },
        { status: 400 }
      );
    }

    // Normalize phone: strip spaces, dashes, parens; ensure E.164
    let normalized = phone.replace(/[\s\-\(\)\.]/g, '');
    if (!normalized.startsWith('+')) {
      if (normalized.startsWith('1') && normalized.length === 11) {
        normalized = '+' + normalized;
      } else if (normalized.length === 10) {
        normalized = '+1' + normalized;
      } else {
        normalized = '+' + normalized;
      }
    }

    // Verify last 4 digits match
    if (!normalized.endsWith(last_four)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Look up user by phone
    const { data: user, error: userError } = await serviceClient
      .from('users')
      .select('id, full_name, language, dealership_id, status')
      .eq('phone', normalized)
      .single();

    if (userError || !user) {
      // Try alternate format without +
      const alt = normalized.replace(/^\+/, '');
      const { data: user2 } = await serviceClient
        .from('users')
        .select('id, full_name, language, dealership_id, status')
        .eq('phone', alt)
        .single();

      if (!user2) {
        return NextResponse.json({ error: 'User not found' }, { status: 401 });
      }

      return createSessionResponse(user2, dealership_slug);
    }

    return createSessionResponse(user, dealership_slug);
  } catch (err) {
    console.error('Auth error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

function createSessionResponse(
  user: Record<string, unknown>,
  _dealershipSlug: string
) {
  const userId = user.id as string;
  const dealershipId = user.dealership_id as string;
  const firstName = ((user.full_name as string) ?? '').split(' ')[0] || 'there';
  const language = (user.language as string) ?? 'en';

  // Simple session token: base64(userId:dealershipId:firstName:language:timestamp)
  // Production: use HMAC signing with a secret
  const timestamp = Date.now().toString();
  const payload = [userId, dealershipId, firstName, language, timestamp].join(':');
  const token = Buffer.from(payload).toString('base64');

  return NextResponse.json({ token, first_name: firstName });
}
