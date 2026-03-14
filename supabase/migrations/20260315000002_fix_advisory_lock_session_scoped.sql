-- F1-H-001: Replace xact-scoped advisory lock with session-scoped lock
-- pg_try_advisory_xact_lock releases at transaction end (immediately after RPC call)
-- pg_try_advisory_lock holds until explicitly released or connection closes
-- This ensures the lock is held during entire webhook processing, not just the RPC call

CREATE OR REPLACE FUNCTION try_lock_user(user_phone TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_try_advisory_lock(hashtext(user_phone));
END;
$$ LANGUAGE plpgsql;

-- Explicit unlock function for use in finally blocks
CREATE OR REPLACE FUNCTION unlock_user(user_phone TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtext(user_phone));
END;
$$ LANGUAGE plpgsql;
