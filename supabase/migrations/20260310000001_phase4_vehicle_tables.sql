-- Phase 4: Vehicle Reference Tables
-- Global shared vehicle data (no dealership_id, public read access)
-- Build Master ref: Phase 4 — Training Intelligence

-- =============================================================================
-- Makes Table
-- Automotive manufacturers (Toyota, Ford, BMW, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  country text NOT NULL, -- 'USA', 'Japan', 'Germany', etc.
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
COMMENT ON TABLE public.makes IS 'Automotive manufacturers (global reference)';

-- =============================================================================
-- Models Table
-- Vehicle models per make (Toyota Camry, Ford F-150, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id uuid NOT NULL REFERENCES public.makes(id) ON DELETE CASCADE,
  name text NOT NULL,
  body_type text NOT NULL, -- 'sedan', 'suv', 'truck', 'coupe', 'wagon', etc.
  years int[] NOT NULL DEFAULT ARRAY[]::int[], -- [2020, 2021, 2022, ...]
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE (make_id, name)
);
COMMENT ON TABLE public.models IS 'Vehicle models per manufacturer';
CREATE INDEX idx_models_make_id ON public.models(make_id);

-- =============================================================================
-- Trims Table
-- Trim levels for a model in a specific year (Camry LE, Camry XLE, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.trims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  name text NOT NULL,
  year int NOT NULL,
  msrp int NOT NULL, -- USD cents (e.g., 2500000 = $25,000)
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE (model_id, year, name)
);
COMMENT ON TABLE public.trims IS 'Trim levels per model/year (LE, XLE, Limited, etc.)';
CREATE INDEX idx_trims_model_id ON public.trims(model_id);
CREATE INDEX idx_trims_year ON public.trims(year);

-- =============================================================================
-- Trim Features Table
-- Specific features/specs for each trim (engine, interior, tech, safety, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.trim_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trim_id uuid NOT NULL REFERENCES public.trims(id) ON DELETE CASCADE,
  category text NOT NULL, -- 'engine', 'interior', 'safety', 'tech', 'transmission', 'drivetrain'
  name text NOT NULL, -- 'V6 Engine', 'Leather Seats', 'Apple CarPlay', '10 Airbags'
  value text NOT NULL, -- '3.5L', 'Perforated', 'Yes', 'Standard', etc.
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
COMMENT ON TABLE public.trim_features IS 'Individual features/specs per trim';
CREATE INDEX idx_trim_features_trim_id ON public.trim_features(trim_id);
CREATE INDEX idx_trim_features_category ON public.trim_features(category);

-- =============================================================================
-- Selling Points Table
-- Key selling points/claims for a model (reliability, efficiency, safety, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.selling_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  category text NOT NULL, -- 'reliability', 'performance', 'value', 'design', 'safety', 'efficiency'
  point text NOT NULL, -- 'Industry-leading safety ratings', 'Exceptional fuel economy', etc.
  source text NOT NULL, -- 'NHTSA', 'EPA', 'J.D. Power', 'consumer_research', 'marketing'
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
COMMENT ON TABLE public.selling_points IS 'Key selling points per vehicle model';
CREATE INDEX idx_selling_points_model_id ON public.selling_points(model_id);
CREATE INDEX idx_selling_points_category ON public.selling_points(category);

-- =============================================================================
-- Competitive Sets Table
-- Define competitive alternatives (which models compete with which)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.competitive_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  competitor_model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  comparison_notes text, -- 'Camry directly competes with Accord in mid-size sedan market'
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE (model_id, competitor_model_id),
  CONSTRAINT different_models CHECK (model_id != competitor_model_id)
);
COMMENT ON TABLE public.competitive_sets IS 'Competitive relationships between models';
CREATE INDEX idx_competitive_sets_model_id ON public.competitive_sets(model_id);
CREATE INDEX idx_competitive_sets_competitor_model_id ON public.competitive_sets(competitor_model_id);

-- =============================================================================
-- RLS: Public read access (no authentication required)
-- Write access will be managed via service role or admin API
-- =============================================================================
ALTER TABLE public.makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trim_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selling_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitive_sets ENABLE ROW LEVEL SECURITY;

-- Public read policies (no auth required)
CREATE POLICY makes_select_public
  ON public.makes FOR SELECT
  TO public
  USING (true);

CREATE POLICY models_select_public
  ON public.models FOR SELECT
  TO public
  USING (true);

CREATE POLICY trims_select_public
  ON public.trims FOR SELECT
  TO public
  USING (true);

CREATE POLICY trim_features_select_public
  ON public.trim_features FOR SELECT
  TO public
  USING (true);

CREATE POLICY selling_points_select_public
  ON public.selling_points FOR SELECT
  TO public
  USING (true);

CREATE POLICY competitive_sets_select_public
  ON public.competitive_sets FOR SELECT
  TO public
  USING (true);
