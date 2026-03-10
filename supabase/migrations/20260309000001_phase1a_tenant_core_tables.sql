-- Phase 1A: Tenant Core Tables
-- Creates dealerships (tenant config) and dealership_memberships (user-to-tenant mapping)
-- Build Master ref: Phase 1A — Tenant Core Tables
-- DECISIONS.md ref: timezone source locked (IANA string, required)

-- =============================================================================
-- updated_at trigger function (reusable across all tables with updated_at)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- dealerships (tenant config)
-- =============================================================================
CREATE TABLE public.dealerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}',
  timezone TEXT NOT NULL,  -- IANA string, e.g. 'America/New_York'. Set during onboarding.
  feature_flags JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slug is used in URLs (e.g. /leaderboard/demo-honda). Must be unique.
CREATE UNIQUE INDEX idx_dealerships_slug ON public.dealerships (slug);

-- Timezone lookups for daily training cron (hourly scan across all dealerships)
CREATE INDEX idx_dealerships_timezone ON public.dealerships (timezone);

-- Auto-update updated_at on row modification
CREATE TRIGGER trg_dealerships_updated_at
  BEFORE UPDATE ON public.dealerships
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS enabled (CI/CD deployment gate requires relrowsecurity = true on all public tables)
-- Policies added in Phase 1K after auth is functional
ALTER TABLE public.dealerships ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- dealership_memberships (user-to-tenant mapping)
-- =============================================================================
CREATE TABLE public.dealership_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'salesperson')),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate memberships for same user + dealership
CREATE UNIQUE INDEX idx_memberships_user_dealership
  ON public.dealership_memberships (user_id, dealership_id);

-- Custom Access Token Hook reads memberships by user_id (Phase 1I)
CREATE INDEX idx_memberships_user_id
  ON public.dealership_memberships (user_id);

-- Tenant-scoped queries filter by dealership_id
CREATE INDEX idx_memberships_dealership_id
  ON public.dealership_memberships (dealership_id);

-- RLS enabled — policies added in Phase 1K
ALTER TABLE public.dealership_memberships ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Validate timezone column contains valid IANA timezone
-- Uses pg_timezone_names system view for validation
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_timezone()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dealerships_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.dealerships
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_timezone();
