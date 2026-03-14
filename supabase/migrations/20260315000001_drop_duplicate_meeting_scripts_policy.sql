-- Cleanup: Drop duplicate meeting_scripts SELECT policy.
-- "Managers see own meeting scripts" ({public} role, current_setting pattern) was the original.
-- "meeting_scripts_select_manager" ({authenticated} role, get_dealership_id() helper) was added by
-- Audit 1 remediation (20260314000002). Both enforce dealership isolation + manager role.
-- Keeping the newer helper-based policy as canonical.
DROP POLICY IF EXISTS "Managers see own meeting scripts" ON meeting_scripts;
