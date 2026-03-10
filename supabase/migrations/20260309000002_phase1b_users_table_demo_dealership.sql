-- Phase 1B: Users table, training_results, leaderboard_entries, demo dealership
-- Build Master ref: Phase 1B — Add dealership_id to ALL Existing Tables
--
-- On a NEW Supabase project, "existing tables" don't exist yet.
-- This migration creates them with dealership_id from the start.
-- Also re-points dealership_memberships.user_id FK from auth.users to public.users
-- (employees have no auth.users row — phone-only identity per Phase 1H).

-- =============================================================================
-- public.users (global — one row per human, keyed by phone)
-- =============================================================================
CREATE TABLE public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL for employees (phone-only)
  phone TEXT NOT NULL,           -- E.164 format (+1XXXXXXXXXX)
  full_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  status TEXT NOT NULL DEFAULT 'pending_consent'
    CHECK (status IN ('pending_consent', 'active', 'opted_out', 'deactivated')),
  last_active_dealership_id UUID REFERENCES public.dealerships(id) ON DELETE SET NULL,
    -- Used by Custom Access Token Hook (Phase 1I) to determine which dealership_id to inject into JWT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_users_phone ON public.users (phone);
CREATE INDEX idx_users_auth_id ON public.users (auth_id) WHERE auth_id IS NOT NULL;
CREATE INDEX idx_users_status ON public.users (status);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Re-point dealership_memberships.user_id FK: auth.users → public.users
-- Employees have no auth.users row (phone = identity, Phase 1H).
-- =============================================================================
ALTER TABLE public.dealership_memberships
  DROP CONSTRAINT dealership_memberships_user_id_fkey;

ALTER TABLE public.dealership_memberships
  ADD CONSTRAINT dealership_memberships_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- =============================================================================
-- training_results (stores AI grading outcomes per session)
-- =============================================================================
CREATE TABLE public.training_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  session_id UUID,                -- FK to conversation_sessions added in Phase 1E
  mode TEXT NOT NULL CHECK (mode IN ('roleplay', 'quiz', 'objection')),
  product_accuracy INT NOT NULL CHECK (product_accuracy BETWEEN 1 AND 5),
  tone_rapport INT NOT NULL CHECK (tone_rapport BETWEEN 1 AND 5),
  addressed_concern INT NOT NULL CHECK (addressed_concern BETWEEN 1 AND 5),
  close_attempt INT NOT NULL CHECK (close_attempt BETWEEN 1 AND 5),
  feedback TEXT NOT NULL,
  reasoning TEXT,
  prompt_version_id UUID,         -- FK to prompt_versions added in Phase 1D
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_results_user ON public.training_results (user_id);
CREATE INDEX idx_training_results_dealership ON public.training_results (dealership_id);
CREATE INDEX idx_training_results_session ON public.training_results (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_training_results_dealership_created ON public.training_results (dealership_id, created_at);

ALTER TABLE public.training_results ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- leaderboard_entries (tenant-scoped, supports TV display mode)
-- =============================================================================
CREATE TABLE public.leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  sessions_completed INT NOT NULL DEFAULT 0,
  average_score DECIMAL(3,2) NOT NULL DEFAULT 0,
  total_points INT NOT NULL DEFAULT 0,
  rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_leaderboard_user_period
  ON public.leaderboard_entries (user_id, dealership_id, period_start, period_end);
CREATE INDEX idx_leaderboard_dealership ON public.leaderboard_entries (dealership_id);
CREATE INDEX idx_leaderboard_ranking
  ON public.leaderboard_entries (dealership_id, period_start, period_end, total_points DESC);

CREATE TRIGGER trg_leaderboard_updated_at
  BEFORE UPDATE ON public.leaderboard_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Demo Honda dealership (used for testing through all phases)
-- =============================================================================
INSERT INTO public.dealerships (id, name, slug, timezone, settings, feature_flags)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Demo Honda',
  'demo-honda',
  'America/New_York',
  '{}',
  '{}'
);
