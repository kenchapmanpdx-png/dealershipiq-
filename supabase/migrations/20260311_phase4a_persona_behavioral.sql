-- Phase 4A: Persona Moods + Behavioral Scoring
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Add persona_mood and difficulty_coefficient to conversation_sessions
ALTER TABLE conversation_sessions 
  ADD COLUMN IF NOT EXISTS persona_mood TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS difficulty_coefficient FLOAT DEFAULT 1.0;

COMMENT ON COLUMN conversation_sessions.persona_mood IS 'Phase 4A: AI customer personality (skeptical, rushed, price_shopping, angry_spouse, no_credit, friendly, impatient)';
COMMENT ON COLUMN conversation_sessions.difficulty_coefficient IS 'Phase 4A: Normalization coefficient for persona difficulty. 1.0 = baseline.';

-- 2. Add behavioral scoring dimensions to training_results
ALTER TABLE training_results
  ADD COLUMN IF NOT EXISTS urgency_creation INTEGER DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS competitive_positioning INTEGER DEFAULT NULL;

COMMENT ON COLUMN training_results.urgency_creation IS 'Phase 4A: 0=none, 1=generic, 2=specific urgency creation';
COMMENT ON COLUMN training_results.competitive_positioning IS 'Phase 4A: 0=none, 1=generic, 2=specific competitive positioning';

-- 3. Add trainee_start_date to users for tenure-based progression
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trainee_start_date DATE DEFAULT NULL;

COMMENT ON COLUMN users.trainee_start_date IS 'Phase 4A: Date user started training. Drives persona mood progression.';

-- 4. Insert Phase 4A feature flags (defaults to disabled)
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT d.id, 'persona_moods_enabled', false, '{}'::jsonb
FROM dealerships d
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags ff 
  WHERE ff.dealership_id = d.id AND ff.flag_name = 'persona_moods_enabled'
);

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT d.id, 'behavioral_scoring_urgency', false, '{}'::jsonb
FROM dealerships d
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags ff 
  WHERE ff.dealership_id = d.id AND ff.flag_name = 'behavioral_scoring_urgency'
);

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT d.id, 'behavioral_scoring_competitive', false, '{}'::jsonb
FROM dealerships d
WHERE NOT EXISTS (
  SELECT 1 FROM feature_flags ff 
  WHERE ff.dealership_id = d.id AND ff.flag_name = 'behavioral_scoring_competitive'
);

-- 5. Enable all Phase 4A flags for test dealership
UPDATE feature_flags 
SET enabled = true 
WHERE dealership_id = 'd0000000-0000-0000-0000-000000000001'
AND flag_name IN ('persona_moods_enabled', 'behavioral_scoring_urgency', 'behavioral_scoring_competitive');
