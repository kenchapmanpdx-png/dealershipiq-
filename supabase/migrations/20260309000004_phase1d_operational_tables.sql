-- Phase 1D: Operational Tables
-- Build Master ref: Phase 1D — Operational Tables

-- =============================================================================
-- sms_delivery_log — tracks every outbound SMS delivery status
-- =============================================================================
CREATE TABLE public.sms_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  batch_id TEXT,                          -- groups sends from same cron invocation
  recipient_phone TEXT NOT NULL,          -- E.164
  sinch_message_id TEXT,                  -- correlate with Sinch delivery reports
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'failed')),
  error_code TEXT,
  cost DECIMAL(8,5),                      -- per-message cost in USD
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_delivery_dealership ON public.sms_delivery_log (dealership_id);
CREATE INDEX idx_delivery_sinch_id ON public.sms_delivery_log (sinch_message_id)
  WHERE sinch_message_id IS NOT NULL;
CREATE INDEX idx_delivery_batch ON public.sms_delivery_log (batch_id)
  WHERE batch_id IS NOT NULL;
CREATE INDEX idx_delivery_status ON public.sms_delivery_log (status, created_at);

ALTER TABLE public.sms_delivery_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- feature_flags — per-dealership feature toggles (database-driven, no code deploy)
-- =============================================================================
CREATE TABLE public.feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  flag_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}',     -- flag-specific config (e.g. rollout %)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_feature_flags_dealership_name
  ON public.feature_flags (dealership_id, flag_name);

CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- prompt_versions — database-managed prompt versioning (no redeploy to update)
-- =============================================================================
CREATE TABLE public.prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                     -- 'grading_roleplay', 'grading_quiz', etc.
  version INT NOT NULL,
  content TEXT NOT NULL,                  -- full prompt template
  model TEXT NOT NULL,                    -- 'gpt-4o-2024-11-20', 'gpt-4o-mini-2024-07-18'
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active version per prompt name
CREATE UNIQUE INDEX idx_prompt_active
  ON public.prompt_versions (name) WHERE is_active = true;
CREATE INDEX idx_prompt_name_version
  ON public.prompt_versions (name, version);

-- prompt_versions is global (not tenant-scoped). No dealership_id.
-- Service-role access only. No RLS policies needed but enable for CI gate.
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- usage_tracking — per-dealership monthly usage for billing/analytics
-- =============================================================================
CREATE TABLE public.usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE CASCADE,
  month DATE NOT NULL,                    -- first day of month (2026-03-01)
  sms_count INT NOT NULL DEFAULT 0,
  ai_tokens_in INT NOT NULL DEFAULT 0,
  ai_tokens_out INT NOT NULL DEFAULT 0,
  estimated_cost DECIMAL(10,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_usage_dealership_month
  ON public.usage_tracking (dealership_id, month);

CREATE TRIGGER trg_usage_updated_at
  BEFORE UPDATE ON public.usage_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- sms_transcript_log — immutable audit trail of ALL SMS messages
-- Append-only. NEVER UPDATE or DELETE.
-- Used for: debugging AI grading, compliance evidence, conversation replay.
-- =============================================================================
CREATE TABLE public.sms_transcript_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  phone TEXT NOT NULL,                    -- E.164
  message_body TEXT NOT NULL,
  sinch_message_id TEXT UNIQUE,           -- deduplication key
  session_id UUID,                        -- FK to conversation_sessions added in Phase 1E
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transcript_dealership ON public.sms_transcript_log (dealership_id);
CREATE INDEX idx_transcript_user ON public.sms_transcript_log (user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_transcript_phone ON public.sms_transcript_log (phone);
CREATE INDEX idx_transcript_session ON public.sms_transcript_log (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX idx_transcript_created ON public.sms_transcript_log (created_at);

ALTER TABLE public.sms_transcript_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- system_messages — all user-facing SMS text, configurable without code deploy
-- Compliance messages (consent request, STOP confirmation, HELP) have legal requirements.
-- =============================================================================
CREATE TABLE public.system_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,               -- 'consent_request', 'welcome', 'stop_confirm', etc.
  en_text TEXT NOT NULL,                  -- English template (supports {dealership_name} interpolation)
  es_text TEXT NOT NULL,                  -- Spanish template
  max_segments INT NOT NULL DEFAULT 1,    -- SMS segment budget
  category TEXT NOT NULL CHECK (category IN ('compliance', 'training', 'alert', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_system_messages_updated_at
  BEFORE UPDATE ON public.system_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- system_messages is global (not tenant-scoped). No dealership_id.
ALTER TABLE public.system_messages ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Seed compliance-required system messages (legal requirements for content)
-- Templates use {dealership_name} placeholder for interpolation.
-- =============================================================================
INSERT INTO public.system_messages (key, en_text, es_text, max_segments, category) VALUES
  ('consent_request',
   'DealershipIQ: {dealership_name} invites you. Up to 3/day. Msg&data rates may apply. Reply YES. HELP for help. STOP to opt out.',
   'DealershipIQ: {dealership_name} te invita. Hasta 3/día. Se aplican tarifas de msg y datos. Responde SÍ. HELP para ayuda. STOP para cancelar.',
   2, 'compliance'),
  ('welcome',
   'DealershipIQ: Welcome to {dealership_name} training. Up to 3/day. Msg&data rates may apply. Reply HELP. Reply STOP to opt out.',
   'DealershipIQ: Bienvenido al entrenamiento de {dealership_name}. Hasta 3/día. Se aplican tarifas. Responde HELP. Responde STOP para cancelar.',
   2, 'compliance'),
  ('stop_confirm',
   'DealershipIQ: You''ve been unsubscribed. No more messages will be sent. Reply START to re-subscribe.',
   'DealershipIQ: Has sido dado de baja. No se enviarán más mensajes. Responde START para volver a suscribirte.',
   1, 'compliance'),
  ('help_response',
   'DealershipIQ: {dealership_name} training. Support: support@dealershipiq.com. Reply STOP to opt out. Msg&data rates may apply.',
   'DealershipIQ: Entrenamiento de {dealership_name}. Soporte: support@dealershipiq.com. Responde STOP para cancelar. Se aplican tarifas.',
   1, 'compliance'),
  ('start_confirm',
   'DealershipIQ: Welcome back to {dealership_name} training. You''re re-subscribed. Reply STOP to opt out.',
   'DealershipIQ: Bienvenido de nuevo al entrenamiento de {dealership_name}. Estás re-suscrito. Responde STOP para cancelar.',
   1, 'compliance');

-- =============================================================================
-- Add FK from training_results.prompt_version_id → prompt_versions
-- (training_results created in Phase 1B, prompt_versions now exists)
-- =============================================================================
ALTER TABLE public.training_results
  ADD CONSTRAINT training_results_prompt_version_id_fkey
  FOREIGN KEY (prompt_version_id) REFERENCES public.prompt_versions(id) ON DELETE SET NULL;
