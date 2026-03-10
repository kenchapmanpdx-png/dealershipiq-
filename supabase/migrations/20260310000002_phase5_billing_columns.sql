-- Phase 5: Billing + Self-Service
-- Add Stripe integration columns to dealerships table

ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing';
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS subscription_id TEXT;
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS max_locations INTEGER DEFAULT 1;
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
ALTER TABLE dealerships ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;

-- Indexes for billing queries
CREATE INDEX IF NOT EXISTS idx_dealerships_stripe_customer ON dealerships(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_dealerships_subscription_status ON dealerships(subscription_status);
CREATE INDEX IF NOT EXISTS idx_dealerships_past_due_since ON dealerships(past_due_since) WHERE past_due_since IS NOT NULL;
