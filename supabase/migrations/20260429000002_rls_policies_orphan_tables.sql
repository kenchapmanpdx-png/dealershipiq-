-- 2026-04-29 C9: add RLS policies to tables that have RLS enabled but no policies.
--
-- 9 tables flagged by Supabase advisor `rls_enabled_no_policy`:
--   billing_events                 — service-role only (Stripe webhook writes)
--   competitive_sets               — dealership-scoped read for managers
--   manager_scenarios              — dealership-scoped CRUD for managers
--   makes / models / trims         — global reference data, manager read-only
--   trim_features                  — global reference data, manager read-only
--   selling_points                 — global reference data, manager read-only
--   scenario_bank                  — global reference data, manager read-only
--
-- service_role bypasses RLS entirely so cron/webhook code paths are
-- unaffected. These policies only constrain user-scoped clients.
--
-- All policies use `(select auth.uid())` form to avoid the
-- auth_rls_initplan perf gotcha (init-plan re-evaluation per row).

-- ────────────────────────────────────────────────────────────────────────
-- billing_events — service-role only (no client-side reads ever)
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='billing_events') THEN
    -- Drop any pre-existing duplicate of this policy first (idempotent re-run).
    EXECUTE 'DROP POLICY IF EXISTS billing_events_service_only ON public.billing_events';
    EXECUTE $sql$
      CREATE POLICY billing_events_service_only ON public.billing_events
        FOR ALL
        TO authenticated, anon
        USING (false)
        WITH CHECK (false)
    $sql$;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- competitive_sets — dealership-scoped, manager+ read
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='competitive_sets') THEN
    EXECUTE 'DROP POLICY IF EXISTS competitive_sets_manager_read ON public.competitive_sets';
    EXECUTE $sql$
      CREATE POLICY competitive_sets_manager_read ON public.competitive_sets
        FOR SELECT
        TO authenticated
        USING (
          dealership_id = public.get_dealership_id()
          AND public.is_manager()
        )
    $sql$;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- manager_scenarios — dealership-scoped, manager+ CRUD
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='manager_scenarios') THEN
    EXECUTE 'DROP POLICY IF EXISTS manager_scenarios_manager_select ON public.manager_scenarios';
    EXECUTE 'DROP POLICY IF EXISTS manager_scenarios_manager_write ON public.manager_scenarios';
    EXECUTE $sql$
      CREATE POLICY manager_scenarios_manager_select ON public.manager_scenarios
        FOR SELECT
        TO authenticated
        USING (
          dealership_id = public.get_dealership_id()
          AND public.is_manager()
        )
    $sql$;
    EXECUTE $sql$
      CREATE POLICY manager_scenarios_manager_write ON public.manager_scenarios
        FOR INSERT
        TO authenticated
        WITH CHECK (
          dealership_id = public.get_dealership_id()
          AND public.is_manager()
        )
    $sql$;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- Reference data: manager-readable across all dealerships
--   (these tables hold global vehicle/scenario reference content)
-- ────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  ref_table text;
BEGIN
  FOREACH ref_table IN ARRAY ARRAY[
    'makes',
    'models',
    'trims',
    'trim_features',
    'selling_points',
    'scenario_bank'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=ref_table) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I_manager_read ON public.%I', ref_table, ref_table);
      EXECUTE format(
        'CREATE POLICY %I_manager_read ON public.%I FOR SELECT TO authenticated USING (public.is_manager())',
        ref_table, ref_table
      );
      RAISE NOTICE 'Added manager_read policy on public.%', ref_table;
    END IF;
  END LOOP;
END $$;
