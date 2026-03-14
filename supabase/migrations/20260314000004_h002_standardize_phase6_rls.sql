-- AUDIT-1 H-002: Standardize Phase 6 RLS policies to use get_dealership_id() / get_user_role()
-- Replaces direct auth.jwt() extraction with helper functions for consistency with Phase 1K pattern.
-- NOTE: These policies use TO public (matching existing role grants). The helpers enforce auth internally.
-- dealership_brands is NOT included — it already uses current_setting() pattern (close enough).

BEGIN;

-- === scenario_chains (3 policies) ===
DROP POLICY IF EXISTS "scenario_chains_dealership_isolation" ON scenario_chains;
CREATE POLICY "scenario_chains_dealership_isolation"
  ON scenario_chains FOR SELECT TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "scenario_chains_insert_own" ON scenario_chains;
CREATE POLICY "scenario_chains_insert_own"
  ON scenario_chains FOR INSERT TO public
  WITH CHECK ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "scenario_chains_update_own" ON scenario_chains;
CREATE POLICY "scenario_chains_update_own"
  ON scenario_chains FOR UPDATE TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

-- === daily_challenges (3 policies) ===
DROP POLICY IF EXISTS "daily_challenges_dealership_isolation" ON daily_challenges;
CREATE POLICY "daily_challenges_dealership_isolation"
  ON daily_challenges FOR SELECT TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "daily_challenges_insert_manager" ON daily_challenges;
CREATE POLICY "daily_challenges_insert_manager"
  ON daily_challenges FOR INSERT TO public
  WITH CHECK (
    (SELECT public.get_dealership_id()) = dealership_id
    AND (SELECT public.get_user_role()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "daily_challenges_update_manager" ON daily_challenges;
CREATE POLICY "daily_challenges_update_manager"
  ON daily_challenges FOR UPDATE TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id)
  WITH CHECK ((SELECT public.get_user_role()) IN ('owner', 'manager'));

-- === peer_challenges (3 policies) ===
DROP POLICY IF EXISTS "peer_challenges_dealership_isolation" ON peer_challenges;
CREATE POLICY "peer_challenges_dealership_isolation"
  ON peer_challenges FOR SELECT TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "peer_challenges_insert_own" ON peer_challenges;
CREATE POLICY "peer_challenges_insert_own"
  ON peer_challenges FOR INSERT TO public
  WITH CHECK ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "peer_challenges_update_participant" ON peer_challenges;
CREATE POLICY "peer_challenges_update_participant"
  ON peer_challenges FOR UPDATE TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

-- === custom_training_content (3 policies) ===
DROP POLICY IF EXISTS "custom_training_dealership_isolation" ON custom_training_content;
CREATE POLICY "custom_training_dealership_isolation"
  ON custom_training_content FOR SELECT TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id);

DROP POLICY IF EXISTS "custom_training_insert_manager" ON custom_training_content;
CREATE POLICY "custom_training_insert_manager"
  ON custom_training_content FOR INSERT TO public
  WITH CHECK (
    (SELECT public.get_dealership_id()) = dealership_id
    AND (SELECT public.get_user_role()) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS "custom_training_update_manager" ON custom_training_content;
CREATE POLICY "custom_training_update_manager"
  ON custom_training_content FOR UPDATE TO public
  USING ((SELECT public.get_dealership_id()) = dealership_id)
  WITH CHECK ((SELECT public.get_user_role()) IN ('owner', 'manager'));

COMMIT;
