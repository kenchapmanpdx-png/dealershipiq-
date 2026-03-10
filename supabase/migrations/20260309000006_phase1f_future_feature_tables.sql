-- Phase 1F: Future-Feature Tables (Schema Now, Wire Later)
-- Build Master ref: Phase 1F
-- Creating now avoids schema migrations during feature phases.

-- =============================================================================
-- employee_schedules — day-off and vacation tracking
-- Used by daily training cron to skip absent employees
-- =============================================================================
CREATE TABLE public.employee_schedules (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  recurring_days_off INTEGER[],           -- 0=Sun, 1=Mon, ..., 6=Sat
  vacation_start DATE,
  vacation_end DATE,
  one_off_absences DATE[],                -- individual days off
  last_confirmed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedules_dealership ON public.employee_schedules (dealership_id);

CREATE TRIGGER trg_schedules_updated_at
  BEFORE UPDATE ON public.employee_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- employee_priority_vectors — adaptive training weighting per employee
-- Drives intelligent question selection (Phase 4)
-- =============================================================================
CREATE TABLE public.employee_priority_vectors (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  weights JSONB NOT NULL DEFAULT '{}',    -- topic → weight mapping
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_priority_dealership ON public.employee_priority_vectors (dealership_id);

ALTER TABLE public.employee_priority_vectors ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- askiq_queries — Ask IQ interaction log
-- session_id links to ConversationSession when query originated from live training.
-- query_context stores model parameters, source channel, metadata for analytics.
-- =============================================================================
CREATE TABLE public.askiq_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  query_text TEXT NOT NULL,
  response TEXT,
  confidence FLOAT,
  query_context JSONB NOT NULL DEFAULT '{}',  -- model params, source channel, metadata
  session_id UUID REFERENCES public.conversation_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_askiq_user ON public.askiq_queries (user_id);
CREATE INDEX idx_askiq_dealership ON public.askiq_queries (dealership_id);
CREATE INDEX idx_askiq_session ON public.askiq_queries (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.askiq_queries ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- knowledge_gaps — tracks topics where employees struggle
-- source_query_id traces gaps back to the Ask IQ query that surfaced them.
-- Required for patent pipeline (detection → training content generation).
-- =============================================================================
CREATE TABLE public.knowledge_gaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  source TEXT NOT NULL,                   -- 'grading', 'askiq', 'manual'
  severity TEXT NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  resolved BOOLEAN NOT NULL DEFAULT false,
  source_query_id UUID REFERENCES public.askiq_queries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gaps_user ON public.knowledge_gaps (user_id);
CREATE INDEX idx_gaps_dealership ON public.knowledge_gaps (dealership_id);
CREATE INDEX idx_gaps_unresolved ON public.knowledge_gaps (dealership_id, resolved)
  WHERE resolved = false;
CREATE INDEX idx_gaps_source_query ON public.knowledge_gaps (source_query_id)
  WHERE source_query_id IS NOT NULL;

ALTER TABLE public.knowledge_gaps ENABLE ROW LEVEL SECURITY;
