-- 2026-07-03: upsertPriorityVector uses onConflict (user_id, dealership_id)
-- but no matching unique constraint existed -> every write since launch
-- failed with "no unique or exclusion constraint matching the ON CONFLICT
-- specification" (logged as 'Priority vector update failed' on each graded
-- session). Adaptive weighting never persisted a single vector. Table
-- verified empty with no duplicates before adding.
-- APPLIED TO PROD 2026-07-03 via Supabase MCP (alongside
-- 20260703000001_lease_based_user_locks.sql).
ALTER TABLE public.employee_priority_vectors
  ADD CONSTRAINT employee_priority_vectors_user_dealership_key
  UNIQUE (user_id, dealership_id);
