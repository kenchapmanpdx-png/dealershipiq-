-- Phase 1E: ConversationSession Production Schema
-- Build Master ref: Phase 1E — ConversationSession Production Schema

-- =============================================================================
-- conversation_sessions — the core session state machine
-- =============================================================================
CREATE TABLE public.conversation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('roleplay', 'quiz', 'objection')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'grading', 'completed', 'abandoned', 'error')),
  step_index INT NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,         -- optimistic locking (Phase 2+)
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CRITICAL: Enforce one active session per user globally
-- Prevents race conditions where user has multiple simultaneous sessions
CREATE UNIQUE INDEX idx_one_active_session
  ON public.conversation_sessions (user_id)
  WHERE status IN ('pending', 'active', 'grading');

CREATE INDEX idx_sessions_user ON public.conversation_sessions (user_id);
CREATE INDEX idx_sessions_dealership ON public.conversation_sessions (dealership_id);
CREATE INDEX idx_sessions_status ON public.conversation_sessions (status);
CREATE INDEX idx_sessions_dealership_status
  ON public.conversation_sessions (dealership_id, status);
-- Orphaned session detector: find sessions stuck in active/grading
CREATE INDEX idx_sessions_orphan_check
  ON public.conversation_sessions (status, last_message_at)
  WHERE status IN ('active', 'grading');

ALTER TABLE public.conversation_sessions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Add deferred FKs from Phase 1B and 1D tables
-- =============================================================================

-- training_results.session_id → conversation_sessions
ALTER TABLE public.training_results
  ADD CONSTRAINT training_results_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.conversation_sessions(id) ON DELETE SET NULL;

-- sms_transcript_log.session_id → conversation_sessions
ALTER TABLE public.sms_transcript_log
  ADD CONSTRAINT sms_transcript_log_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.conversation_sessions(id) ON DELETE SET NULL;

-- =============================================================================
-- try_lock_user — advisory lock RPC for concurrency control (Phase 2B)
-- Created now so the function exists when webhook handler is built.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.try_lock_user(user_phone TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN pg_try_advisory_xact_lock(hashtext(user_phone));
END;
$$ LANGUAGE plpgsql;
