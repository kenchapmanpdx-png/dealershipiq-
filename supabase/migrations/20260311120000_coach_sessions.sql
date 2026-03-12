-- Phase 4.5A: Coach Mode — coach_sessions table
-- NO RLS: employees are phone-identified, not Supabase Auth. Service_role + explicit user_id filtering.

CREATE TABLE coach_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  messages JSONB NOT NULL DEFAULT '[]',
  session_topic TEXT,
  sentiment_trend TEXT DEFAULT 'neutral',
  coaching_style TEXT,
  door_selected TEXT,
  rep_context_snapshot JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX idx_coach_sessions_user ON coach_sessions(user_id, created_at DESC);
CREATE INDEX idx_coach_sessions_dealership ON coach_sessions(dealership_id, created_at DESC);
CREATE INDEX idx_coach_sessions_topic ON coach_sessions(session_topic);

-- Feature flags
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'coach_mode_enabled', false, '{}'::jsonb FROM dealerships
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'coach_proactive_outreach', false, '{}'::jsonb FROM dealerships
ON CONFLICT DO NOTHING;

-- Enable for test dealership
UPDATE feature_flags SET enabled = true
WHERE flag_name = 'coach_mode_enabled'
AND dealership_id = (SELECT id FROM dealerships LIMIT 1);
