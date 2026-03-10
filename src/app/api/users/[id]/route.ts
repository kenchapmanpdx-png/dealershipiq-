// User Management: Soft-delete employee
// DELETE /api/users/[id]
// Sets status to 'inactive'
// Auth: manager+ role required

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';

export async function DELETE(
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

    // Verify user belongs to this dealership
    const { data: membership, error: memberError } = await serviceClient
      .from('dealership_memberships')
      .select('id')
      .eq('user_id', id)
      .eq('dealership_id', dealershipId)
      .maybeSingle();

    if (memberError && memberError.code !== 'PGRST116') {
      throw memberError;
    }

    if (!membership) {
      return NextResponse.json(
        { error: 'User not found in your dealership' },
        { status: 404 }
      );
    }

    // Soft-delete: set status to inactive
    const { error: updateError } = await serviceClient
      .from('users')
      .update({ status: 'deactivated', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Failed to deactivate user:', updateError);
      return NextResponse.json(
        { error: 'Failed to deactivate user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/users/[id] error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
