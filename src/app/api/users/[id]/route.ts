// User Management: Soft-delete employee
// DELETE /api/users/[id]
// Sets status to 'inactive'
// Auth: manager+ role required
// C-003: Fully migrated to RLS-backed authenticated client.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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

    // C-003: RLS-backed — memberships SELECT policy auto-filters by dealership_id from JWT
    const { data: membership, error: memberError } = await supabase
      .from('dealership_memberships')
      .select('id')
      .eq('user_id', id)
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

    // C-003: RLS-backed — users UPDATE policy allows managers to update users in their dealership
    const { error: updateError } = await supabase
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
