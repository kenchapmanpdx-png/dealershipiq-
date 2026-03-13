-- S-005: Fix overly permissive WITH CHECK on users_update_manager
-- Old policy: WITH CHECK (true) — allows manager to SET any column to any value
-- New policy: Constrain columns that actually exist on users table
-- Note: role lives on dealership_memberships, not users. Role escalation
-- is guarded by the memberships_update_manager policy on that table.

DROP POLICY IF EXISTS users_update_manager ON public.users;

CREATE POLICY users_update_manager
  ON public.users FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_manager())
    AND id IN (
      SELECT user_id FROM public.dealership_memberships
      WHERE dealership_id = (SELECT public.get_dealership_id())
    )
  )
  WITH CHECK (
    -- Prevent invalid status values
    status IN ('active', 'pending_consent', 'deactivated', 'inactive')
    -- Prevent cross-dealership reassignment via last_active_dealership_id
    AND (
      last_active_dealership_id IS NULL
      OR last_active_dealership_id = (SELECT public.get_dealership_id())
    )
  );
