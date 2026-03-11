-- Phase 4B: Vehicle Data Pipeline — Rebuild vehicle tables with Build Master schema
-- Old tables had wrong FK relationships (model-level). New schema uses model_years and trim-level references.

-- Drop old tables (CASCADE handles FKs, RLS policies, indexes)
DROP TABLE IF EXISTS competitive_sets CASCADE;
DROP TABLE IF EXISTS selling_points CASCADE;
DROP TABLE IF EXISTS trim_features CASCADE;
DROP TABLE IF EXISTS trims CASCADE;
DROP TABLE IF EXISTS models CASCADE;
DROP TABLE IF EXISTS makes CASCADE;

-- ===== MAKES =====
CREATE TABLE makes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  country TEXT,
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== MODELS =====
CREATE TABLE models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id UUID NOT NULL REFERENCES makes(id),
  name TEXT NOT NULL,
  body_style TEXT,
  segment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(make_id, name)
);

-- ===== MODEL_YEARS =====
CREATE TABLE model_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES models(id),
  year INT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_id, year)
);

-- ===== TRIMS =====
CREATE TABLE trims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_year_id UUID NOT NULL REFERENCES model_years(id),
  name TEXT NOT NULL,
  msrp DECIMAL,
  invoice DECIMAL,
  engine TEXT,
  hp INT,
  torque INT,
  transmission TEXT,
  drivetrain TEXT,
  fuel_type TEXT,
  mpg_city DECIMAL,
  mpg_highway DECIMAL,
  mpg_combined DECIMAL,
  cargo_cu_ft DECIMAL,
  seating_capacity INT,
  towing_lbs INT,
  curb_weight_lbs INT,
  annual_fuel_cost DECIMAL,
  co2_tailpipe DECIMAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_year_id, name)
);

-- ===== TRIM_FEATURES =====
CREATE TABLE trim_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trim_id UUID NOT NULL REFERENCES trims(id),
  feature_name TEXT NOT NULL,
  feature_value TEXT,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== COMPETITIVE_SETS =====
CREATE TABLE competitive_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_a_trim_id UUID NOT NULL REFERENCES trims(id),
  vehicle_b_trim_id UUID NOT NULL REFERENCES trims(id),
  comparison_notes JSONB NOT NULL DEFAULT '{}',
  generated_by TEXT NOT NULL DEFAULT 'llm',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(vehicle_a_trim_id, vehicle_b_trim_id)
);

-- ===== SELLING_POINTS =====
CREATE TABLE selling_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trim_id UUID NOT NULL REFERENCES trims(id),
  advantage TEXT NOT NULL,
  vs_competitor TEXT,
  objection_response TEXT,
  category TEXT,
  generated_by TEXT NOT NULL DEFAULT 'llm',
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== DEALERSHIP_BRANDS =====
CREATE TABLE IF NOT EXISTS dealership_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  make_id UUID NOT NULL REFERENCES makes(id),
  is_franchise BOOLEAN NOT NULL DEFAULT true,
  training_depth TEXT NOT NULL DEFAULT 'deep' CHECK (training_depth IN ('deep', 'basic')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealership_id, make_id)
);

-- ===== INDEXES =====
CREATE INDEX idx_models_make ON models(make_id);
CREATE INDEX idx_model_years_model ON model_years(model_id);
CREATE INDEX idx_trims_model_year ON trims(model_year_id);
CREATE INDEX idx_trim_features_trim ON trim_features(trim_id);
CREATE INDEX idx_competitive_sets_a ON competitive_sets(vehicle_a_trim_id);
CREATE INDEX idx_competitive_sets_b ON competitive_sets(vehicle_b_trim_id);
CREATE INDEX idx_selling_points_trim ON selling_points(trim_id);
CREATE INDEX idx_dealership_brands_dealership ON dealership_brands(dealership_id);
CREATE INDEX idx_dealership_brands_make ON dealership_brands(make_id);

-- ===== RLS =====
-- Vehicle tables are GLOBAL reference data — no RLS
-- dealership_brands IS tenant-scoped
ALTER TABLE dealership_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers see own dealership brands"
  ON dealership_brands FOR SELECT
  USING (dealership_id = (current_setting('request.jwt.claims', true)::json->>'dealership_id')::uuid);

CREATE POLICY "Managers manage own dealership brands"
  ON dealership_brands FOR ALL
  USING (dealership_id = (current_setting('request.jwt.claims', true)::json->>'dealership_id')::uuid);

-- ===== FEATURE FLAG =====
-- Insert vehicle_data_enabled feature flag for all dealerships (default disabled)
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'vehicle_data_enabled', false, '{}'::jsonb
FROM dealerships
ON CONFLICT (dealership_id, flag_name) DO NOTHING;

-- Enable for test dealership
UPDATE feature_flags
SET enabled = true
WHERE dealership_id = 'd0000000-0000-0000-0000-000000000000'
  AND flag_name = 'vehicle_data_enabled';
