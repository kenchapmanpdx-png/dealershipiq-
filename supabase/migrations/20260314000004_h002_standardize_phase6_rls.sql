-- AUDIT-1 H-002: Standardize Phase 6 RLS policies to use get_dealership_id() / get_user_role()
-- Replaces direct auth.jwt() extraction with helper functions for consistency with Phase 1K pattern.

-- === scenario_chains ===
DROP POLICY IF EXISTS "scenario_chains_dealership_isolation" ON scenario_chains;
CREATE POLICY "scenario_chains_dealership_isolation"
  ON scenario_chains FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "scenario_chains_insert_own" ON scenario_chains;
CREATE POLICY "scenario_chains_insert_own"
  ON scenario_chains FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "scenario_chains_update_own" ON scenario_chains;
CREATE POLICY "scenario_chains_update_own"
  ON scenario_chains FOR UPDATE TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

-- === daily_challenges ===
DROP POLICY IF EXISTS "daily_challenges_dealership_isolation" ON daily_challenges;
CREATE POLICY "daily_challenges_dealership_isolation"
  ON daily_challenges FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "daily_challenges_insert_manager" ON daily_challenges;
CREATE POLICY "daily_challenges_insert_manager"
  ON daily_challenges FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.get_dealership_id()) = dealership_id
    AND (SELECT public.get_user_role()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "daily_challenges_update_manager" ON daily_challenges;
CREATE POLICY "daily_challenges_update_manager"
  ON daily_challenges FOR UPDATE TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id)
  WITH CHECK ((SELECT public.get_user_role()) IN ('owner', 'manager'));

-- === peer_challenges ===
DROP POLICY IF EXISTS "peer_challenges_dealership_isolation" ON peer_challenges;
CREATE POLICY "peer_challenges_dealership_isolation"
  ON peer_challenges FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "peer_challenges_insert_own" ON peer_challenges;
CREATE POLICY "peer_challenges_insert_own"
  ON peer_challenges FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "peer_challenges_update_participant" ON peer_challenges;
CREATE POLICY "peer_challenges_update_participant"
  ON peer_challenges FOR UPDATE TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

-- === custom_training_content ===
DROP POLICY IF EXISTS "custom_training_dealership_isolation" ON custom_training_content;
CREATE POLICY "custom_training_dealership_isolation"
  ON custom_training_content FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "custom_training_insert_manager" ON custom_training_content;
CREATE POLICY "custom_training_insert_manager"
  ON custom_training_content FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.get_dealership_id()) = dealership_id
    AND (SELECT public.get_user_role()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "custom_training_update_manager" ON custom_training_content;
CREATE POLICY "custom_training_update_manager"
  ON custom_training_content FOR UPDATE TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id)
  WITH CHECK ((SELECT public.get_user_role()) IN ('owner', 'manager'));

-- === manager_scenarios ===
DROP POLICY IF EXISTS "manager_scenarios_dealership_isolation" ON manager_scenarios;
CREATE POLICY "manager_scenarios_dealership_isolation"
  ON manager_scenarios FOR SELECT TO authenticated
  USING ((SELECT public.get_dealership_id()) = dealership_id);
