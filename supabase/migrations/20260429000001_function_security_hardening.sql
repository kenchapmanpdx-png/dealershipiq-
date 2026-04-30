-- 2026-04-29 H11/H12: function security hardening
--
-- H11: REVOKE EXECUTE on anon-callable SECURITY DEFINER functions that do
--      NOT check auth. Privilege-escalation risk if anon hits the RPC.
--
-- H12: Pin search_path on every SECURITY DEFINER function. A mutable
--      search_path lets the caller control function lookup, which is a
--      known privilege-escalation vector. `search_path = public, pg_catalog`
--      ensures lookups resolve only against project-owned schemas.
--
-- Idempotent: each REVOKE / ALTER FUNCTION succeeds whether or not the
-- privilege/setting was already in place.

-- ────────────────────────────────────────────────────────────────────────
-- H11: revoke anon/authenticated EXECUTE on functions that lack auth checks
-- ────────────────────────────────────────────────────────────────────────

-- record_chain_step(): SECURITY DEFINER, no auth.uid() check, mutates
-- scenario_chains based on caller-supplied IDs. Should only be callable
-- by service_role (cron + webhook contexts).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_chain_step'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.record_chain_step(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.record_chain_step(uuid, integer, jsonb) TO service_role';
  END IF;
END $$;

-- rls_auto_enable(): SECURITY DEFINER event-trigger function. Internal
-- maintenance — never needs to be callable by client roles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- H12: pin search_path on all SECURITY DEFINER functions
-- ────────────────────────────────────────────────────────────────────────

-- These ALTER statements are no-ops if the function does not exist; the DO
-- blocks above handle the "function might not exist" case for the most
-- security-sensitive ones. For the remainder, we pin search_path
-- conditionally so the migration stays idempotent across environments.

DO $$
DECLARE
  fn record;
  signature text;
BEGIN
  FOR fn IN
    SELECT
      p.oid,
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname IN (
        'has_active_subscription',
        'record_chain_step',
        'unlock_user',
        'try_lock_user',
        'set_updated_at',
        'validate_timezone',
        'switch_active_dealership',
        'get_dealership_id',
        'get_user_role',
        'is_manager',
        'custom_access_token_hook',
        'rls_auto_enable',
        'erase_user_everywhere'
      )
  LOOP
    signature := format('%I.%I(%s)', fn.nspname, fn.proname, fn.args);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', signature);
    RAISE NOTICE 'Pinned search_path on %', signature;
  END LOOP;
END $$;
