// User Management: Bulk import from CSV
// POST /api/users/import
// Body: CSV text with columns: full_name, phone
// Auth: manager+ role required
// Validates, deduplicates, returns summary of imported/skipped/errors

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { sendSms } from '@/lib/sms';
import { getDealershipName, insertTranscriptLog } from '@/lib/service-db';

interface ImportRow {
  full_name: string;
  phone: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  rows: Array<{
    row_number: number;
    full_name: string;
    phone: string;
    status: 'imported' | 'skipped' | 'error';
    reason?: string;
  }>;
}

// E.164 validation
function validateE164Phone(phone: string): boolean {
  const e164Pattern = /^\+?1?\d{10,15}$/;
  return e164Pattern.test(phone.replace(/\D/g, ''));
}

// Normalize to E.164 format: +1XXXXXXXXXX
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1')
    ? `+${digits}`
    : `+1${digits}`;
}

// Parse CSV with header row
function parseCSV(csvText: string): ImportRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const fullNameIdx = headers.indexOf('full_name');
  const phoneIdx = headers.indexOf('phone');

  if (fullNameIdx === -1 || phoneIdx === -1) {
    throw new Error('CSV must include full_name and phone columns');
  }

  return lines.slice(1).map((line) => {
    const fields = line.split(',').map((f) => f.trim());
    return {
      full_name: fields[fullNameIdx],
      phone: fields[phoneIdx],
    };
  });
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

    // Read CSV from request body
    const csvText = await request.text();
    if (!csvText || csvText.trim().length === 0) {
      return NextResponse.json(
        { error: 'Request body must contain CSV data' },
        { status: 400 }
      );
    }

    // Parse CSV
    let rows: ImportRow[];
    try {
      rows = parseCSV(csvText);
    } catch (err) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No data rows found in CSV' },
        { status: 400 }
      );
    }

    // Get existing phones in dealership + opt-outs
    const { data: existingUsers } = await serviceClient
      .from('users')
      .select('phone');

    const { data: optOuts } = await serviceClient
      .from('sms_opt_outs')
      .select('phone')
      .eq('dealership_id', dealershipId);

    const existingPhones = new Set(
      (existingUsers ?? []).map((u: Record<string, unknown>) => u.phone)
    );
    const optOutPhones = new Set(
      (optOuts ?? []).map((o: Record<string, unknown>) => o.phone)
    );

    // Fetch dealership name for consent SMS
    let dealershipName = '';
    try {
      dealershipName = await getDealershipName(dealershipId);
    } catch {
      console.error('Failed to fetch dealership name for consent SMS');
    }

    // Process rows
    const result: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: 0,
      rows: [],
    };

    const seenPhones = new Set<string>();
    const usersToNotify: Array<{ id: string; phone: string; fullName: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // +2 because CSV has header, array is 0-indexed

      // Validate required fields
      if (!row.full_name || !row.phone) {
        result.errors++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name || '',
          phone: row.phone || '',
          status: 'error',
          reason: 'Missing full_name or phone',
        });
        continue;
      }

      // Validate phone format
      if (!validateE164Phone(row.phone)) {
        result.skipped++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: row.phone,
          status: 'skipped',
          reason: 'Invalid phone format',
        });
        continue;
      }

      const normalizedPhone = normalizePhone(row.phone);

      // Check for duplicates within this import
      if (seenPhones.has(normalizedPhone)) {
        result.skipped++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: normalizedPhone,
          status: 'skipped',
          reason: 'Duplicate in import batch',
        });
        continue;
      }

      // Check if already exists
      if (existingPhones.has(normalizedPhone)) {
        result.skipped++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: normalizedPhone,
          status: 'skipped',
          reason: 'User already exists',
        });
        continue;
      }

      // Check if opted out
      if (optOutPhones.has(normalizedPhone)) {
        result.skipped++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: normalizedPhone,
          status: 'skipped',
          reason: 'Phone number opted out',
        });
        continue;
      }

      try {
        // Create user
        const { data: newUser, error: createError } = await serviceClient
          .from('users')
          .insert({
            full_name: row.full_name.trim(),
            phone: normalizedPhone,
            status: 'pending_consent',
            language: 'en',
          })
          .select('id')
          .single();

        if (createError) throw createError;

        // Add to dealership_memberships
        const { error: memberError } = await serviceClient
          .from('dealership_memberships')
          .insert({
            user_id: newUser.id,
            dealership_id: dealershipId,
            role: 'salesperson',
            is_primary: true,
          });

        if (memberError) throw memberError;

        seenPhones.add(normalizedPhone);
        result.imported++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: normalizedPhone,
          status: 'imported',
        });

        // Queue for consent SMS (batch after database operations)
        usersToNotify.push({
          id: newUser.id,
          phone: normalizedPhone,
          fullName: row.full_name.trim(),
        });
      } catch (err) {
        result.errors++;
        result.rows.push({
          row_number: rowNumber,
          full_name: row.full_name,
          phone: normalizedPhone,
          status: 'error',
          reason: 'Database error',
        });
      }
    }

    // Send consent SMS in batches with rate limiting
    const BATCH_SIZE = 10;
    const BATCH_DELAY_MS = 1000;

    for (let i = 0; i < usersToNotify.length; i += BATCH_SIZE) {
      const batch = usersToNotify.slice(i, i + BATCH_SIZE);
      const consentMsg = `${dealershipName} uses DealershipIQ for sales training. You'll receive daily practice questions via text. Reply YES to opt in, or STOP to decline.`;

      await Promise.all(
        batch.map(async (user) => {
          try {
            const smsResponse = await sendSms(user.phone, consentMsg);
            await insertTranscriptLog({
              userId: user.id,
              dealershipId,
              phone: user.phone,
              direction: 'outbound',
              messageBody: consentMsg,
              sinchMessageId: smsResponse.message_id,
              metadata: { type: 'consent_request' },
            });
          } catch (smsErr) {
            console.error(
              `Consent SMS failed for ${user.phone.slice(0, 6)}**** (${user.fullName}):`,
              smsErr
            );
          }
        })
      );

      // Add delay between batches (not after the last batch)
      if (i + BATCH_SIZE < usersToNotify.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/users/import error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
