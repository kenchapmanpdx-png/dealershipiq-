-- C-003: Add RLS policies to enable migration from serviceClient to RLS-scoped client.
-- Two tables:
--   1. coach_sessions: Add manager SELECT policy (dashboard/coach-themes)
--   2. askiq_queries: Add authenticated INSERT policy (ask/route)
-- Uses Phase 1I helper functions for consistency with existing RLS policies.

-- =============================================================================
-- coach_sessions: Manager SELECT (for dashboard/coach-themes endpoint)
-- Managers can read coach sessions from their own dealership for aggregated themes.
-- The deny-anon policy stays as defense-in-depth for the anon key.
-- =============================================================================
CREATE POLICY "coach_sessions_select_manager"
  ON public.coach_sessions FOR SELECT TO authenticated
  USING (
    dealership_id = (SELECT public.get_dealership_id())
    AND (SELECT public.is_manager())
  );

-- =============================================================================
-- askiq_queries: Authenticated INSERT (for /api/ask endpoint)
-- Employees and managers can insert Ask IQ queries for their own dealership.
-- Enforces dealership_id from JWT to prevent cross-tenant writes.
-- =============================================================================
CREATE POLICY "askiq_insert_authenticated"
  ON public.askiq_queries FOR INSERT TO authenticated
  WITH CHECK (dealership_id = (SELECT public.get_dealership_id()));
