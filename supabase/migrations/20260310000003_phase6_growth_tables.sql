-- Phase 6: Growth Features
-- Tables for progressive scenario chains, daily challenges, peer challenges, and manager-created content

-- ─── Scenario Chains (Feature B: Progressive Scenario Chains) ─────────────────
-- 3-day storylines unfolding across training sessions
-- Day N grading feeds Day N+1 scenario generation
CREATE TABLE scenario_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_step INTEGER NOT NULL DEFAULT 1,
  max_steps INTEGER NOT NULL DEFAULT 3,
  narrative_context JSONB NOT NULL DEFAULT '{}',
  step_results JSONB[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_chains_dealership ON scenario_chains(dealership_id);
CREATE INDEX idx_scenario_chains_user ON scenario_chains(user_id);
CREATE INDEX idx_scenario_chains_status ON scenario_chains(status);
CREATE INDEX idx_scenario_chains_dealership_user_status ON scenario_chains(dealership_id, user_id, status);

-- ─── Daily Challenges (Feature E: Daily Leaderboard Push) ──────────────────
-- Morning cron: yesterday's top 3 + today's shared challenge (same scenario for all employees)
-- End-of-day cron: grade all challenge responses, text top 3
CREATE TABLE daily_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  challenge_date DATE NOT NULL,
  scenario_text TEXT NOT NULL,
  grading_rubric JSONB NOT NULL DEFAULT '{}',
  results JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealership_id, challenge_date)
);

CREATE INDEX idx_daily_challenges_dealership ON daily_challenges(dealership_id);
CREATE INDEX idx_daily_challenges_date ON daily_challenges(challenge_date);
CREATE INDEX idx_daily_challenges_dealership_date ON daily_challenges(dealership_id, challenge_date);

-- ─── Peer Challenges (Feature H: Peer Challenge Mode) ──────────────────────
-- Rep texts CHALLENGE [name] → both get same scenario → AI grades both → results to both
-- Challenge = the training for that day (counts as daily messages for both)
-- 4-hour expiry, no-show = default win for challenger
CREATE TABLE peer_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  challenger_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenged_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scenario_text TEXT NOT NULL,
  challenger_response TEXT,
  challenger_score JSONB,
  challenged_response TEXT,
  challenged_score JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'expired', 'no_show')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_peer_challenges_dealership ON peer_challenges(dealership_id);
CREATE INDEX idx_peer_challenges_challenger ON peer_challenges(challenger_id);
CREATE INDEX idx_peer_challenges_challenged ON peer_challenges(challenged_id);
CREATE INDEX idx_peer_challenges_status ON peer_challenges(status);
CREATE INDEX idx_peer_challenges_expires_at ON peer_challenges(expires_at);
CREATE INDEX idx_peer_challenges_dealership_status ON peer_challenges(dealership_id, status);

-- ─── Custom Training Content (Feature C: Manager Quick-Create via SMS) ──────
-- Manager texts scenario idea → AI formats into training content → approval flow
CREATE TABLE custom_training_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_input TEXT NOT NULL,
  formatted_scenario TEXT,
  mode TEXT NOT NULL DEFAULT 'roleplay',
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_training_dealership ON custom_training_content(dealership_id);
CREATE INDEX idx_custom_training_created_by ON custom_training_content(created_by);
CREATE INDEX idx_custom_training_status ON custom_training_content(status);
CREATE INDEX idx_custom_training_dealership_status ON custom_training_content(dealership_id, status);

-- ─── RLS Policies ─────────────────────────────────────────────────────────

ALTER TABLE scenario_chains ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE peer_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_training_content ENABLE ROW LEVEL SECURITY;

-- Scenario chains: dealership isolation, users can see their own chains only
CREATE POLICY "scenario_chains_dealership_isolation"
  ON scenario_chains
  FOR SELECT
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "scenario_chains_insert_own"
  ON scenario_chains
  FOR INSERT
  WITH CHECK (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "scenario_chains_update_own"
  ON scenario_chains
  FOR UPDATE
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

-- Daily challenges: dealership isolation, readable by all members
CREATE POLICY "daily_challenges_dealership_isolation"
  ON daily_challenges
  FOR SELECT
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "daily_challenges_insert_manager"
  ON daily_challenges
  FOR INSERT
  WITH CHECK (
    dealership_id = auth.jwt()->'dealership_id'::uuid
    AND auth.jwt()->>'user_role' IN ('owner', 'manager')
  );

CREATE POLICY "daily_challenges_update_manager"
  ON daily_challenges
  FOR UPDATE
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid)
  WITH CHECK (auth.jwt()->>'user_role' IN ('owner', 'manager'));

-- Peer challenges: dealership isolation, users involved can view
CREATE POLICY "peer_challenges_dealership_isolation"
  ON peer_challenges
  FOR SELECT
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "peer_challenges_insert_own"
  ON peer_challenges
  FOR INSERT
  WITH CHECK (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "peer_challenges_update_participant"
  ON peer_challenges
  FOR UPDATE
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

-- Custom training content: dealership isolation, managers only
CREATE POLICY "custom_training_dealership_isolation"
  ON custom_training_content
  FOR SELECT
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid);

CREATE POLICY "custom_training_insert_manager"
  ON custom_training_content
  FOR INSERT
  WITH CHECK (
    dealership_id = auth.jwt()->'dealership_id'::uuid
    AND auth.jwt()->>'user_role' IN ('owner', 'manager')
  );

CREATE POLICY "custom_training_update_manager"
  ON custom_training_content
  FOR UPDATE
  USING (dealership_id = auth.jwt()->'dealership_id'::uuid)
  WITH CHECK (auth.jwt()->>'user_role' IN ('owner', 'manager'));
