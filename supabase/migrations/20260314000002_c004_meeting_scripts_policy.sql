-- AUDIT-1 C-004: meeting_scripts has RLS enabled but no authenticated policies.
-- Dashboard reads meeting scripts via authenticated client (manager-only).
CREATE POLICY "meeting_scripts_select_manager"
  ON meeting_scripts FOR SELECT TO authenticated
  USING (
    (SELECT public.get_dealership_id()) = dealership_id
    AND (SELECT public.get_user_role()) IN ('manager', 'owner')
  );
