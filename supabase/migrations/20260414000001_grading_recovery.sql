-- C3: Add grading_started_at column so a recovery cron can detect stuck sessions.
-- A session entering 'grading' stamps this column; entering 'completed'/'error' clears it.
-- Sessions with grading_started_at older than 3 minutes are considered orphaned
-- (webhook timed out before the grader returned) and are reset to 'active' so the
-- user can resume.

ALTER TABLE public.conversation_sessions
  ADD COLUMN IF NOT EXISTS grading_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS conversation_sessions_grading_started_at_idx
  ON public.conversation_sessions (grading_started_at)
  WHERE grading_started_at IS NOT NULL;
