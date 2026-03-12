-- Phase 5: Billing Events + Missing Columns
-- billing_events: idempotent webhook processing via stripe_event_id UNIQUE
-- New columns on dealerships: is_pilot, trial_ends_at (stripe_subscription_id already exists as subscription_id)

-- billing_events table
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  dealership_id UUID REFERENCES dealerships(id),
  payload JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_stripe_event ON billing_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_dealership ON billing_events(dealership_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_type ON billing_events(event_type);

-- Add missing columns to dealerships
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS is_pilot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- RLS function: returns true if dealership has active or trialing or past_due subscription, or is_pilot
CREATE OR REPLACE FUNCTION public.has_active_subscription(d_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM dealerships
    WHERE id = d_id
    AND (
      is_pilot = true
      OR subscription_status IN ('active', 'trialing', 'past_due')
    )
  );
$$;

-- RLS on billing_events: only service role (no user access needed)
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (handled by service key bypassing RLS)
-- No user-facing policies needed for billing_events

-- Feature flag for billing
INSERT INTO feature_flags (dealership_id, flag_name, enabled, config)
SELECT id, 'billing_enabled', true, '{}'::jsonb
FROM dealerships
WHERE id NOT IN (
  SELECT dealership_id FROM feature_flags WHERE flag_name = 'billing_enabled'
)
ON CONFLICT DO NOTHING;
