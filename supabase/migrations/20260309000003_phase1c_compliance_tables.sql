-- Phase 1C: Compliance Tables (10-Year Retention)
-- Build Master ref: Phase 1C — Compliance Tables
-- TCPA/CTIA/Virginia SB 1339: 10-year retention on consent records and opt-outs

-- =============================================================================
-- consent_records — checked during legal discovery
-- NEVER delete or anonymize, even during tenant offboarding
-- =============================================================================
CREATE TABLE public.consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE RESTRICT,
    -- RESTRICT: cannot delete dealership with consent records (legal retention)
  phone TEXT NOT NULL,                    -- E.164, stored unhashed (must match future opt-out requests)
  consent_type TEXT NOT NULL CHECK (consent_type IN ('opt_in', 'opt_out')),
  consent_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  method TEXT NOT NULL,                   -- 'sms_reply', 'web_form', 'manager_add'
  text_shown TEXT,                        -- exact consent message sent to user
  reply_text TEXT,                        -- user's actual reply (e.g. 'YES', 'STOP')
  consenting_party TEXT,                  -- name of person consenting (if known)
  added_by UUID REFERENCES public.users(id) ON DELETE SET NULL,  -- manager who initiated
  ip_address TEXT,                        -- for web-form consent
  retention_expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 years'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_phone ON public.consent_records (phone);
CREATE INDEX idx_consent_dealership ON public.consent_records (dealership_id);
CREATE INDEX idx_consent_retention ON public.consent_records (retention_expires_at);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- sms_opt_outs — checked on every outbound message
-- Local cache; Sinch consent state is authoritative (Build Master invariant)
-- =============================================================================
CREATE TABLE public.sms_opt_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,                    -- E.164
  dealership_id UUID NOT NULL REFERENCES public.dealerships(id) ON DELETE RESTRICT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  keyword_used TEXT,                      -- 'STOP', 'CANCEL', 'natural_language', etc.
  synced_from_sinch BOOLEAN NOT NULL DEFAULT false,  -- true if synced via Consents API cron
  last_synced_at TIMESTAMPTZ,            -- last time Sinch Consents API confirmed this opt-out
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique per phone+dealership (same phone can opt out from multiple dealerships)
CREATE UNIQUE INDEX idx_opt_outs_phone_dealership ON public.sms_opt_outs (phone, dealership_id);
CREATE INDEX idx_opt_outs_dealership ON public.sms_opt_outs (dealership_id);
CREATE INDEX idx_opt_outs_synced ON public.sms_opt_outs (last_synced_at)
  WHERE synced_from_sinch = true;

ALTER TABLE public.sms_opt_outs ENABLE ROW LEVEL SECURITY;
