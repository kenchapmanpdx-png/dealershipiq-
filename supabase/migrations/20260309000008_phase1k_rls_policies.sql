-- Phase 1K: Enable RLS Policies on ALL Tables
-- Build Master ref: Phase 1K — Enable RLS (LAST step of Phase 1)
--
-- RLS was already ENABLED on all tables in earlier migrations (CI/CD gate).
-- This migration adds the actual POLICIES.
--
-- DECISION LOCKED (v4, v4.2): Canonical claim shape is app_metadata.dealership_id.
-- Uses public.get_dealership_id(), public.get_user_role(), public.is_manager() helper functions (Phase 1I).
-- NOTE: Functions placed in public schema (not auth) due to Supabase auth schema permissions.
-- Always uses (SELECT auth.uid()) — caches per-statement vs per-row.
--
-- Policy naming convention: {table}_{operation}_{who}
-- USING = filter for SELECT/UPDATE/DELETE
-- WITH CHECK = validate for INSERT/UPDATE

-- =============================================================================
-- dealerships
-- Managers can read their own dealership. Owners can read all.
-- Only owners can update dealership settings.
-- =============================================================================
CREATE POLICY dealerships_select_member
  ON public.dealerships FOR SELECT TO authenticated
  USING (id = (SELECT public.get_dealership_id()));

CREATE POLICY dealerships_update_manager
  ON public.dealerships FOR UPDATE TO authenticated
  USING (id = (SELECT public.get_dealership_id()) AND (SELECT public.is_manager()))
  WITH CHECK (id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- dealership_memberships
-- Managers can read all memberships in their dealership.
-- Users can read their own membership.
-- Managers can insert/update/delete memberships in their dealership.
-- =============================================================================
CREATE POLICY memberships_select_own_dealership
  ON public.dealership_memberships FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

CREATE POLICY memberships_insert_manager
  ON public.dealership_memberships FOR INSERT TO authenticated
  WITH CHECK (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

CREATE POLICY memberships_update_manager
  ON public.dealership_memberships FOR UPDATE TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  )
  WITH CHECK (dealership_id = (SELECT public.get_dealership_id()));

CREATE POLICY memberships_delete_manager
  ON public.dealership_memberships FOR DELETE TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- =============================================================================
-- users
-- Managers see all users in their dealership (via membership join).
-- Users can read their own row.
-- Managers can insert/update users linked to their dealership.
-- =============================================================================
CREATE POLICY users_select_own
  ON public.users FOR SELECT TO authenticated
  USING (
    auth_id = (SELECT auth.uid())
    OR id IN (
      SELECT user_id FROM public.dealership_memberships
      WHERE dealership_id = (SELECT public.get_dealership_id())
    )
  );

CREATE POLICY users_update_own
  ON public.users FOR UPDATE TO authenticated
  USING (auth_id = (SELECT auth.uid()))
  WITH CHECK (auth_id = (SELECT auth.uid()));

CREATE POLICY users_insert_manager
  ON public.users FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_manager()));

CREATE POLICY users_update_manager
  ON public.users FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_manager())
    AND id IN (
      SELECT user_id FROM public.dealership_memberships
      WHERE dealership_id = (SELECT public.get_dealership_id())
    )
  )
  WITH CHECK (true);

-- =============================================================================
-- training_results
-- Managers see all results in their dealership.
-- =============================================================================
CREATE POLICY training_results_select
  ON public.training_results FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

-- Insert: service-role only (grading happens in webhook handler)
-- No authenticated INSERT policy needed.

-- =============================================================================
-- leaderboard_entries
-- Managers see their dealership's leaderboard.
-- Public leaderboard (TV display) uses a separate anon-accessible endpoint if needed.
-- =============================================================================
CREATE POLICY leaderboard_select
  ON public.leaderboard_entries FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- conversation_sessions
-- Managers see all sessions in their dealership.
-- =============================================================================
CREATE POLICY sessions_select
  ON public.conversation_sessions FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- consent_records
-- Managers can read consent records for their dealership.
-- Insert: service-role or manager (when adding employees).
-- NEVER delete (10-year legal retention).
-- =============================================================================
CREATE POLICY consent_select_manager
  ON public.consent_records FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

CREATE POLICY consent_insert_manager
  ON public.consent_records FOR INSERT TO authenticated
  WITH CHECK (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- No UPDATE or DELETE policies — consent records are immutable.

-- =============================================================================
-- sms_opt_outs
-- Managers can read opt-outs for their dealership.
-- =============================================================================
CREATE POLICY opt_outs_select_manager
  ON public.sms_opt_outs FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- Insert/Update: service-role only (sync from Sinch Consents API).

-- =============================================================================
-- sms_delivery_log
-- Managers can read delivery logs for their dealership.
-- =============================================================================
CREATE POLICY delivery_log_select_manager
  ON public.sms_delivery_log FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- Insert: service-role only.

-- =============================================================================
-- feature_flags
-- Managers can read flags for their dealership. Owners can update.
-- =============================================================================
CREATE POLICY feature_flags_select
  ON public.feature_flags FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

CREATE POLICY feature_flags_manage_owner
  ON public.feature_flags FOR ALL TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.get_user_role()) = 'owner'
  )
  WITH CHECK (dealership_id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- prompt_versions
-- Global table. Read-only for authenticated. Managed via service-role.
-- =============================================================================
CREATE POLICY prompt_versions_select
  ON public.prompt_versions FOR SELECT TO authenticated
  USING (true);

-- Insert/Update/Delete: service-role only.

-- =============================================================================
-- usage_tracking
-- Managers can read usage for their dealership.
-- =============================================================================
CREATE POLICY usage_select_manager
  ON public.usage_tracking FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- Insert/Update: service-role only (cron jobs aggregate usage).

-- =============================================================================
-- sms_transcript_log
-- Managers can read transcripts for their dealership.
-- Immutable: no UPDATE or DELETE policies.
-- =============================================================================
CREATE POLICY transcript_select_manager
  ON public.sms_transcript_log FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- Insert: service-role only.

-- =============================================================================
-- system_messages
-- Global table. Read-only for all authenticated users.
-- =============================================================================
CREATE POLICY system_messages_select
  ON public.system_messages FOR SELECT TO authenticated
  USING (true);

-- =============================================================================
-- employee_schedules
-- Managers can read/manage schedules in their dealership.
-- =============================================================================
CREATE POLICY schedules_select
  ON public.employee_schedules FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

CREATE POLICY schedules_manage_manager
  ON public.employee_schedules FOR ALL TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  )
  WITH CHECK (dealership_id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- employee_priority_vectors
-- Managers can read vectors in their dealership.
-- =============================================================================
CREATE POLICY priority_vectors_select
  ON public.employee_priority_vectors FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

-- Update: service-role only (AI system updates weights).

-- =============================================================================
-- askiq_queries
-- Managers can read queries from their dealership.
-- =============================================================================
CREATE POLICY askiq_select
  ON public.askiq_queries FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

-- Insert: service-role only (webhook handler logs queries).

-- =============================================================================
-- knowledge_gaps
-- Managers can read/manage gaps in their dealership.
-- =============================================================================
CREATE POLICY gaps_select
  ON public.knowledge_gaps FOR SELECT TO authenticated
  USING (dealership_id = (SELECT public.get_dealership_id()));

CREATE POLICY gaps_manage_manager
  ON public.knowledge_gaps FOR UPDATE TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  )
  WITH CHECK (dealership_id = (SELECT public.get_dealership_id()));

-- =============================================================================
-- CI/CD RLS Deployment Gate Verification Query
-- Must return 0 rows — any result means a table is missing RLS.
-- =============================================================================
-- SELECT schemaname, tablename FROM pg_tables
-- WHERE schemaname = 'public'
--   AND tablename NOT IN ('schema_migrations')
--   AND tablename NOT IN (SELECT relname FROM pg_class WHERE relrowsecurity = true);
