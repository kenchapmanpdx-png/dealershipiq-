// User Management: Employee deletion
// DELETE /api/users/[id]
// Supports both modes via `?mode=deactivate|erase` query param:
//   - deactivate (default, backward compat): sets status='deactivated', no PII purge.
//   - erase (S4 / GDPR Art. 17): cascade-purge via erase_user_everywhere RPC,
//     then delete the Supabase auth.users row.
// Auth: manager+ role required. The target user must belong to the caller's dealership.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import { log } from '@/lib/logger';

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

    // C-003: RLS-backed + explicit dealership_id filter for defense-in-depth.
    // Ensures target user belongs to the calling manager's dealership.
    const { data: membership, error: memberError } = await supabase
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

    const rawMode = (new URL(request.url).searchParams.get('mode') ?? 'deactivate').toLowerCase();

    // 2026-04-29 M16: validate mode enum. Previously a typo (e.g. ?mode=erse)
    // silently fell through to deactivate, which violates least-surprise for
    // a destructive operation. Reject unknown modes with 400.
    const ALLOWED_MODES = ['deactivate', 'erase'] as const;
    type Mode = typeof ALLOWED_MODES[number];
    if (!ALLOWED_MODES.includes(rawMode as Mode)) {
      return NextResponse.json(
        { error: `Invalid mode '${rawMode}'. Must be one of: ${ALLOWED_MODES.join(', ')}` },
        { status: 400 }
      );
    }
    const mode: Mode = rawMode as Mode;

    if (mode === 'erase') {
      // S4: full GDPR-style erasure. Requires owner role (stricter than deactivate).
      if (userRole !== 'owner') {
        return NextResponse.json({ error: 'Only owners can erase user data' }, { status: 403 });
      }
      // Purge all child PII via service-role RPC (bypasses RLS by design).
      const { data: rpcResult, error: rpcErr } = await serviceClient
        .rpc('erase_user_everywhere', { p_user_id: id });
      if (rpcErr) {
        log.error('users.delete.erase_rpc_failed', { target_user_id: id, err: rpcErr.message });
        return NextResponse.json({ error: 'Erase failed' }, { status: 500 });
      }
      // Best-effort: delete the Supabase auth row too.
      try {
        await serviceClient.auth.admin.deleteUser(id);
      } catch (authErr) {
        log.warn('users.delete.auth_delete_failed', {
          target_user_id: id,
          err: (authErr as Error).message,
        });
      }
      log.info('users.delete.erased', { target_user_id: id, actor_user_id: user.id, detail: rpcResult });
      return NextResponse.json({ success: true, mode: 'erase', detail: rpcResult });
    }

    // Default: soft-delete (status flip). Preserves data for dashboard history.
    const { error: updateError } = await supabase
      .from('users')
      .update({ status: 'deactivated', updated_at: new Date().toISOString() })
      .eq('id', id);

    if (updateError) {
      console.error('Failed to deactivate user:', (updateError as Error).message ?? updateError);
      return NextResponse.json(
        { error: 'Failed to deactivate user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, mode: 'deactivate' });
  } catch (err) {
    console.error('DELETE /api/users/[id] error:', (err as Error).message ?? err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
