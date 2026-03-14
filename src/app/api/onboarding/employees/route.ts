// POST /api/onboarding/employees
// Phase 5: Import employees during onboarding
// C-003: Migrated to RLS client. users INSERT + memberships INSERT policies exist for managers.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

interface EmployeeInput {
  full_name: string;
  phone: string;
  role: string;
}

export async function POST(request: NextRequest) {
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

  let imported = 0;
  let errors = 0;

  for (const emp of employees as EmployeeInput[]) {
    if (!emp.full_name?.trim() || !emp.phone?.trim()) continue;

    // Normalize phone: ensure +1 prefix
    let phone = emp.phone.replace(/[^\d+]/g, '');
    if (!phone.startsWith('+')) {
      if (phone.startsWith('1') && phone.length === 11) {
        phone = '+' + phone;
      } else if (phone.length === 10) {
        phone = '+1' + phone;
      } else {
        phone = '+' + phone;
      }
    }

    try {
      // C-003: RLS-backed — users_insert_manager policy
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert({
          full_name: emp.full_name.trim(),
          phone,
          email: '',
          role: emp.role === 'manager' ? 'manager' : 'employee',
          status: 'active',
          dealership_id: dealershipId,
        })
        .select('id')
        .single();

      if (insertError || !newUser) {
        errors++;
        continue;
      }

      // C-003: RLS-backed — memberships_insert_manager policy
      await supabase.from('dealership_memberships').insert({
        user_id: newUser.id as string,
        dealership_id: dealershipId,
        role: emp.role === 'manager' ? 'manager' : 'employee',
      });

      imported++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({ imported, errors });
}
