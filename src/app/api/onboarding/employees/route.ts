// POST /api/onboarding/employees
// Phase 5: Import employees during onboarding
// C-003: Migrated to RLS client. users INSERT + memberships INSERT policies exist for managers.
// 2026-04-18 C-1: INSERT schema previously referenced columns that don't exist on `users`
//   (email, role, dealership_id). Canonical schema: id, full_name, phone, status, language,
//   last_active_dealership_id, auth_id. Aligned with `/api/users` and `/api/users/import`.
// 2026-04-18 H-4: Added MAX_EMPLOYEES cap to prevent unbounded work.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { tryNormalizePhone, isValidE164 } from '@/lib/phone';
import { sendSms } from '@/lib/sms';
import { getDealershipName, insertTranscriptLog } from '@/lib/service-db';
import { log } from '@/lib/logger';
import { requireJsonContentType } from '@/lib/api-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface EmployeeInput {
  full_name: string;
  phone: string;
  role: string;
}

interface EmployeeError {
  row: number;
  full_name: string;
  reason: string;
}

// H-4: Cap batch size to match `users/import` (500). Prevents unbounded work
// and matches the pattern already in place for CSV import.
const MAX_EMPLOYEES = 500;

export async function POST(request: NextRequest) {
  // L-14: content-type gate
  const ctErr = requireJsonContentType(request);
  if (ctErr) return ctErr;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dealershipId = user.app_metadata?.dealership_id as string;
  if (!dealershipId) {
    return NextResponse.json({ error: 'No dealership' }, { status: 403 });
  }

  // H-001: Verify user has manager/owner role
  const userRole = user.app_metadata?.user_role as string;
  if (!userRole || !['owner', 'manager'].includes(userRole)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { employees } = await request.json();
  if (!Array.isArray(employees) || employees.length === 0) {
    return NextResponse.json({ error: 'Employees required' }, { status: 400 });
  }

  // H-4: Reject over-cap batches rather than truncating silently
  if (employees.length > MAX_EMPLOYEES) {
    return NextResponse.json(
      { error: `Onboarding limited to ${MAX_EMPLOYEES} employees per batch. Received ${employees.length}.` },
      { status: 400 }
    );
  }

  let imported = 0;
  let errors = 0;
  const invalidRows: EmployeeError[] = [];
  const usersToNotify: Array<{ id: string; phone: string; fullName: string }> = [];
  const seenPhones = new Set<string>();

  for (let i = 0; i < (employees as EmployeeInput[]).length; i++) {
    const emp = (employees as EmployeeInput[])[i];
    if (!emp.full_name?.trim() || !emp.phone?.trim()) {
      invalidRows.push({ row: i, full_name: emp.full_name ?? '', reason: 'missing_fields' });
      continue;
    }

    // H4: Canonical phone normalization + strict E.164 validation.
    // Previously garbage input like "+!@#$" was silently accepted.
    const phone = tryNormalizePhone(emp.phone);
    if (!phone || !isValidE164(phone)) {
      invalidRows.push({ row: i, full_name: emp.full_name, reason: 'invalid_phone' });
      continue;
    }

    // Dedup within this batch
    if (seenPhones.has(phone)) {
      invalidRows.push({ row: i, full_name: emp.full_name, reason: 'duplicate_in_batch' });
      continue;
    }

    // Canonical membership roles are 'owner' | 'manager' | 'salesperson'.
    // Legacy input said 'employee' — map to 'salesperson' to align with DB enum
    // and the queries in service-db (e.g., `.eq('role', 'salesperson')`).
    const membershipRole = emp.role === 'manager' ? 'manager' : 'salesperson';

    let createdUserId: string | null = null;
    try {
      // C-1: Only write columns that exist on `users`:
      //   id (auto), full_name, phone, status, language, last_active_dealership_id, auth_id
      // Dealership binding lives on dealership_memberships (inserted below).
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          full_name: emp.full_name.trim(),
          phone,
          status: 'pending_consent',
          language: 'en',
        })
        .select('id')
        .single();

      if (insertError || !newUser) {
        log.error('onboarding.employees.user_insert_failed', {
          row: i,
          error: (insertError as Error | undefined)?.message ?? 'unknown',
        });
        errors++;
        continue;
      }

      createdUserId = newUser.id as string;

      // C-003: RLS-backed — memberships_insert_manager policy
      const { error: memberError } = await supabase
        .from('dealership_memberships')
        .insert({
          user_id: newUser.id as string,
          dealership_id: dealershipId,
          role: membershipRole,
          is_primary: true,
        });

      if (memberError) {
        log.error('onboarding.employees.membership_insert_failed', {
          row: i,
          user_id: createdUserId,
          error: (memberError as Error).message,
        });
        // H9: Roll back the orphaned user row via service client so the same
        // CSV can be retried without tripping phone-uniqueness.
        try {
          await serviceClient.from('users').delete().eq('id', createdUserId);
        } catch (cleanupErr) {
          log.error('onboarding.employees.rollback_failed', {
            user_id: createdUserId,
            error: (cleanupErr as Error).message,
          });
        }
        errors++;
        continue;
      }

      seenPhones.add(phone);
      imported++;

      usersToNotify.push({
        id: createdUserId,
        phone,
        fullName: emp.full_name.trim(),
      });
    } catch (err) {
      log.error('onboarding.employees.unexpected_error', {
        row: i,
        error: (err as Error).message,
      });
      if (createdUserId) {
        try {
          await serviceClient.from('users').delete().eq('id', createdUserId);
        } catch (cleanupErr) {
          log.error('onboarding.employees.rollback_failed', {
            user_id: createdUserId,
            error: (cleanupErr as Error).message,
          });
        }
      }
      errors++;
    }
  }

  // Batch-send consent SMS (non-blocking — mirror users/import pattern)
  if (usersToNotify.length > 0) {
    let dealershipName = '';
    try {
      dealershipName = await getDealershipName(dealershipId);
    } catch (err) {
      log.warn('onboarding.employees.dealership_name_lookup_failed', {
        dealership_id: dealershipId,
        error: (err as Error).message,
      });
    }

    const consentMsg = `${dealershipName} uses DealershipIQ for training. You'll receive daily practice questions via text. Reply YES to opt in, or STOP to decline.`;
    const BATCH_SIZE = 10;

    for (let i = 0; i < usersToNotify.length; i += BATCH_SIZE) {
      const batch = usersToNotify.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(
        batch.map(async (u) => {
          try {
            const smsResponse = await sendSms(u.phone, consentMsg);
            await insertTranscriptLog({
              userId: u.id,
              dealershipId,
              phone: u.phone,
              direction: 'outbound',
              messageBody: consentMsg,
              sinchMessageId: smsResponse.message_id,
              metadata: { type: 'consent_request' },
            }, supabase);
          } catch (smsErr) {
            const err = smsErr as Error;
            const kind = err?.name === 'SmsRateLimitedError' ? 'rate_limited' : 'send_failed';
            log.warn('onboarding.employees.consent_sms_failed', {
              kind,
              error: err?.message,
            });
          }
        })
      );

      if (i + BATCH_SIZE < usersToNotify.length) {
        // Small pause between batches to avoid Sinch rate limits.
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  return NextResponse.json({
    imported,
    errors,
    invalidRows,
    summary: {
      requested: employees.length,
      succeeded: imported,
      invalid: invalidRows.length,
      errorCount: errors,
    },
  });
}
