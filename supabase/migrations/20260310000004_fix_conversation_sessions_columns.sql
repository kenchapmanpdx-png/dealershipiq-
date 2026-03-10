-- Fix missing columns on conversation_sessions
-- Required by: src/lib/service-db.ts getActiveSession(), updateSessionStatus()
-- These columns were referenced in code but not included in the original migration.

ALTER TABLE conversation_sessions
  ADD COLUMN IF NOT EXISTS question_text text,
  ADD COLUMN IF NOT EXISTS prompt_version_id uuid REFERENCES prompt_versions(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
