-- Phase 1I: Custom Access Token Hook
-- Build Master ref: Phase 1I — Custom Access Token Hook (Approach B — Skip Approach A)
--
-- Injects dealership_id + user_role into JWT at token issuance.
-- Priority: last_active_dealership_id → is_primary → oldest membership.
-- Enable via Supabase Dashboard → Authentication → Hooks → Custom Access Token.
--
-- DECISION LOCKED (v4, v4.2): Canonical claim shape is app_metadata.dealership_id.

-- =============================================================================
-- Custom Access Token Hook function
-- SECURITY DEFINER: runs with function owner's permissions
-- =============================================================================
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB AS $$
DECLARE
  _user_id UUID;
  _dealership_id UUID;
  _user_role TEXT;
  _claims JSONB;
BEGIN
  -- Extract user ID from the event
  _user_id := (event->>'user_id')::UUID;

  -- Look up user's public profile to get last_active_dealership_id
  -- Then resolve active membership with priority:
  -- 1. last_active_dealership_id (if valid membership exists)
  -- 2. is_primary = true
  -- 3. oldest membership (by created_at)
  SELECT
    dm.dealership_id,
    dm.role
  INTO _dealership_id, _user_role
  FROM public.dealership_memberships dm
  INNER JOIN public.users u ON u.auth_id = _user_id
  WHERE dm.user_id = u.id
  ORDER BY
    -- Priority 1: matches last_active_dealership_id
    CASE WHEN dm.dealership_id = u.last_active_dealership_id THEN 0 ELSE 1 END,
    -- Priority 2: is_primary
    CASE WHEN dm.is_primary THEN 0 ELSE 1 END,
    -- Priority 3: oldest membership
    dm.created_at ASC
  LIMIT 1;

  -- Build claims
  _claims := coalesce(event->'claims', '{}'::JSONB);

  IF _dealership_id IS NOT NULL THEN
    -- Inject into app_metadata (users cannot modify app_metadata — safe for RLS)
    _claims := jsonb_set(
      _claims,
      '{app_metadata}',
      coalesce(_claims->'app_metadata', '{}'::JSONB) ||
        jsonb_build_object(
          'dealership_id', _dealership_id::TEXT,
          'user_role', _user_role
        )
    );
  END IF;

  -- Return modified event with updated claims
  RETURN jsonb_set(event, '{claims}', _claims);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Grant execute to supabase_auth_admin (required for hook invocation)
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- Revoke from public for security
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM public;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated;

-- =============================================================================
-- Helper functions for RLS policies (Phase 1K)
-- Extract claims from JWT without DB lookup.
-- NOTE: Placed in public schema (not auth) because Supabase Dashboard SQL Editor
-- does not have CREATE permission on the auth schema. Functionally identical.
-- =============================================================================

-- public.get_dealership_id() — returns current user's dealership_id from JWT
CREATE OR REPLACE FUNCTION public.get_dealership_id()
RETURNS UUID AS $$
  SELECT COALESCE(
    (current_setting('request.jwt.claims', true)::JSONB -> 'app_metadata' ->> 'dealership_id')::UUID,
    NULL
  );
$$ LANGUAGE sql STABLE;

-- public.get_user_role() — returns current user's role from JWT
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::JSONB -> 'app_metadata' ->> 'user_role',
    NULL
  );
$$ LANGUAGE sql STABLE;

-- public.is_manager() — returns true if role is owner or manager
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN AS $$
  SELECT public.get_user_role() IN ('owner', 'manager');
$$ LANGUAGE sql STABLE;

-- Grant to authenticated users (needed for RLS evaluation)
GRANT EXECUTE ON FUNCTION public.get_dealership_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;

-- =============================================================================
-- Server action support: update last_active_dealership_id for dealership switching
-- Dashboard calls this via server action, then triggers supabase.auth.refreshSession()
-- to re-issue JWT with new dealership_id.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.switch_active_dealership(target_dealership_id UUID)
RETURNS VOID AS $$
DECLARE
  _user_id UUID;
  _public_user_id UUID;
BEGIN
  _user_id := (SELECT auth.uid());

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Resolve public user from auth user
  SELECT id INTO _public_user_id
  FROM public.users
  WHERE auth_id = _user_id;

  IF _public_user_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  -- Verify user has membership in target dealership
  IF NOT EXISTS (
    SELECT 1 FROM public.dealership_memberships
    WHERE user_id = _public_user_id
      AND dealership_id = target_dealership_id
  ) THEN
    RAISE EXCEPTION 'No membership in target dealership';
  END IF;

  -- Update last active dealership
  UPDATE public.users
  SET last_active_dealership_id = target_dealership_id
  WHERE id = _public_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow authenticated users to call switch_active_dealership
GRANT EXECUTE ON FUNCTION public.switch_active_dealership(UUID) TO authenticated;
