-- Defense in depth: RLS on coach_sessions
-- Application uses service_role for all coach queries, but RLS prevents accidental anon key exposure
ALTER TABLE coach_sessions ENABLE ROW LEVEL SECURITY;

-- Deny all for anon key (default deny)
CREATE POLICY "coach_sessions_deny_anon" ON coach_sessions
  FOR ALL USING (false);

-- Service role bypasses RLS automatically
