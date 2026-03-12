-- Phase 4.5B: Morning Meeting Script + Red Flag Events persistence
-- meeting_scripts: one per dealership per day, stores SMS + full script JSONB
-- red_flag_events: persists red-flag-check cron findings for morning script consumption

CREATE TABLE meeting_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  script_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sms_text TEXT NOT NULL,
  full_script JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(dealership_id, script_date)
);

CREATE INDEX idx_meeting_scripts_dealership_date
  ON meeting_scripts(dealership_id, script_date DESC);

ALTER TABLE meeting_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers see own meeting scripts"
  ON meeting_scripts FOR SELECT
  USING (dealership_id = (current_setting('request.jwt.claims', true)::json->>'dealership_id')::uuid);

-- Red flag events: persisted by red-flag-check cron, consumed by morning script
CREATE TABLE red_flag_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES dealerships(id),
  user_id UUID NOT NULL REFERENCES users(id),
  signal_type TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_red_flag_events_dealership
  ON red_flag_events(dealership_id, created_at DESC);
CREATE INDEX idx_red_flag_events_user
  ON red_flag_events(user_id, created_at DESC);

ALTER TABLE red_flag_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers see own dealership red flags"
  ON red_flag_events FOR SELECT
  USING (dealership_id = (current_setting('request.jwt.claims', true)::json->>'dealership_id')::uuid);

-- Feature flags
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'morning_script_enabled', true, '{}'::jsonb FROM dealerships
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'cross_dealership_benchmark', false, '{}'::jsonb FROM dealerships
ON CONFLICT DO NOTHING;
