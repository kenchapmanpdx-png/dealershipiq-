-- Phase 6 Rebuild: Growth Features
-- Alters existing Phase 6 tables to match v5 spec + creates new tables
-- Existing tables: scenario_chains, daily_challenges, peer_challenges, custom_training_content

-- ═══════════════════════════════════════════════════════════════════════
-- 1. chain_templates (NEW)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chain_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  total_steps INTEGER NOT NULL DEFAULT 3,
  step_prompts JSONB NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard')),
  taxonomy_domains TEXT[] NOT NULL,
  vehicle_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. manager_scenarios (NEW — replaces custom_training_content for SMS flow)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS manager_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  created_by UUID NOT NULL REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manager_sms'
    CHECK (source IN ('manager_sms', 'manager_web', 'imported')),
  manager_input_text TEXT NOT NULL,
  scenario_text TEXT NOT NULL,
  customer_persona TEXT,
  taxonomy_domain TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  grading_rubric JSONB NOT NULL,
  vehicle_context JSONB,
  awaiting_now_confirmation BOOLEAN DEFAULT false,
  now_confirmation_expires_at TIMESTAMPTZ,
  push_immediately BOOLEAN DEFAULT false,
  pushed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manager_scenarios_dealership
  ON manager_scenarios(dealership_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manager_scenarios_pending
  ON manager_scenarios(created_by, awaiting_now_confirmation)
  WHERE awaiting_now_confirmation = true;

ALTER TABLE manager_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manager_scenarios_dealership_isolation"
  ON manager_scenarios FOR SELECT
  USING (dealership_id = (auth.jwt()->>'dealership_id')::uuid);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ALTER scenario_chains
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS chain_template_id UUID REFERENCES chain_templates(id);
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS chain_context JSONB NOT NULL DEFAULT '{}';
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 3;
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS work_days_without_response INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scenario_chains ADD COLUMN IF NOT EXISTS last_step_at TIMESTAMPTZ;

-- Expand status CHECK to include 'expired'
ALTER TABLE scenario_chains DROP CONSTRAINT IF EXISTS scenario_chains_status_check;
ALTER TABLE scenario_chains ADD CONSTRAINT scenario_chains_status_check
  CHECK (status IN ('active', 'completed', 'abandoned', 'expired'));

CREATE INDEX IF NOT EXISTS idx_scenario_chains_user_active
  ON scenario_chains(user_id, status) WHERE status = 'active';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. ALTER daily_challenges
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS taxonomy_domain TEXT;
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS persona_mood TEXT;
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS vehicle_context JSONB;
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS winner_user_id UUID REFERENCES users(id);
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS participation_count INTEGER DEFAULT 0;
ALTER TABLE daily_challenges ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- Add CHECK constraint for status
ALTER TABLE daily_challenges DROP CONSTRAINT IF EXISTS daily_challenges_status_check;
ALTER TABLE daily_challenges ADD CONSTRAINT daily_challenges_status_check
  CHECK (status IN ('active', 'grading', 'completed', 'no_responses'));

-- ═══════════════════════════════════════════════════════════════════════
-- 5. ALTER peer_challenges
-- ═══════════════════════════════════════════════════════════════════════
-- Allow NULL challenged_id (during disambiguation)
ALTER TABLE peer_challenges ALTER COLUMN challenged_id DROP NOT NULL;
ALTER TABLE peer_challenges ALTER COLUMN scenario_text DROP NOT NULL;

ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS grading_rubric JSONB;
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS taxonomy_domain TEXT;
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS challenger_session_id UUID REFERENCES conversation_sessions(id);
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS challenged_session_id UUID REFERENCES conversation_sessions(id);
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS disambiguation_options JSONB;
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE peer_challenges ADD COLUMN IF NOT EXISTS winner_id UUID REFERENCES users(id);

-- Expand status CHECK
ALTER TABLE peer_challenges DROP CONSTRAINT IF EXISTS peer_challenges_status_check;
ALTER TABLE peer_challenges ADD CONSTRAINT peer_challenges_status_check
  CHECK (status IN ('disambiguating', 'pending', 'active', 'completed', 'expired', 'declined'));

-- Better indexes
CREATE INDEX IF NOT EXISTS idx_peer_challenges_active
  ON peer_challenges(status, expires_at)
  WHERE status IN ('disambiguating', 'pending', 'active');
CREATE INDEX IF NOT EXISTS idx_peer_challenges_challenged_pending
  ON peer_challenges(challenged_id, status)
  WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════════════════
-- 6. ALTER conversation_sessions
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS challenge_id UUID REFERENCES daily_challenges(id);
ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS scenario_chain_id UUID REFERENCES scenario_chains(id);
ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS chain_step INTEGER;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. Feature flags (Phase 6 features — default OFF)
-- ═══════════════════════════════════════════════════════════════════════
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'manager_quick_create_enabled', false, NULL
FROM dealerships
WHERE id NOT IN (SELECT dealership_id FROM feature_flags WHERE flag_name = 'manager_quick_create_enabled')
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'daily_challenge_enabled', false, '{"frequency":"mwf"}'::jsonb
FROM dealerships
WHERE id NOT IN (SELECT dealership_id FROM feature_flags WHERE flag_name = 'daily_challenge_enabled')
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'scenario_chains_enabled', false, NULL
FROM dealerships
WHERE id NOT IN (SELECT dealership_id FROM feature_flags WHERE flag_name = 'scenario_chains_enabled')
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'peer_challenge_enabled', false, NULL
FROM dealerships
WHERE id NOT IN (SELECT dealership_id FROM feature_flags WHERE flag_name = 'peer_challenge_enabled')
ON CONFLICT DO NOTHING;
