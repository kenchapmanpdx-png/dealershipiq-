-- =============================================================================
-- 2026-07-03: Replace session advisory locks with lease-based table locks.
--
-- ROOT CAUSE of intermittent silent message drops ("the app froze"):
-- pg_try_advisory_lock is SESSION-scoped, but RPCs arrive over PostgREST's
-- CONNECTION POOL. The lock lands on one pooled connection and stays with it
-- when the connection returns to the pool; unlock_user later executes on a
-- DIFFERENT pooled connection, where pg_advisory_unlock is a no-op. The lock
-- leaks until Postgres recycles that connection. Every subsequent message
-- from that phone hits try_lock_user -> false -> silent drop, unless the RPC
-- happens to land on the leaking connection again. Pure pool roulette.
-- (The 2026-03-15 migration introduced this; the xact-scoped original it
-- replaced released instantly and was harmless-but-useless.)
--
-- FIX: a lease row per phone. Connection-independent, atomic, and
-- self-expiring -- a crashed invocation can leak a lock for at most
-- LEASE seconds instead of forever. Function signatures unchanged, so no
-- application code changes are required.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_locks (
  phone TEXT PRIMARY KEY,
  locked_until TIMESTAMPTZ NOT NULL
);

-- Lock table is service-role-only: enable RLS with no policies.
ALTER TABLE public.user_locks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.try_lock_user(user_phone TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  got BOOLEAN := FALSE;
BEGIN
  -- Atomic: insert a fresh 90s lease, or take over an EXPIRED one.
  -- If a live lease exists, the WHERE fails, nothing is returned, got stays
  -- NULL -> return false.
  INSERT INTO public.user_locks (phone, locked_until)
  VALUES (user_phone, now() + interval '90 seconds')
  ON CONFLICT (phone) DO UPDATE
    SET locked_until = EXCLUDED.locked_until
    WHERE public.user_locks.locked_until < now()
  RETURNING TRUE INTO got;

  RETURN COALESCE(got, FALSE);
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION public.unlock_user(user_phone TEXT)
RETURNS VOID AS $$
BEGIN
  DELETE FROM public.user_locks WHERE phone = user_phone;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_catalog;
