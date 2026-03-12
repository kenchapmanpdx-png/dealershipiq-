// Phase 5: Billing types

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired';

export type DunningStage =
  | 'none'
  | 'day1'
  | 'day3'
  | 'day14'
  | 'day21'
  | 'day30_canceled';

export interface BillingState {
  subscription_status: SubscriptionStatus;
  is_pilot: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  past_due_since: string | null;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  max_locations: number;
  days_remaining_in_trial: number | null;
  dunning_stage: DunningStage;
  is_active: boolean;
}

export interface BillingEvent {
  id: string;
  stripe_event_id: string;
  event_type: string;
  dealership_id: string | null;
  payload: Record<string, unknown>;
  processed_at: string;
  created_at: string;
}

export interface CheckoutRequest {
  dealershipName: string;
  email: string;
  password: string;
  managerName: string;
  locations: number;
  timezone: string;
}

export interface DunningTemplate {
  subject: string;
  body: string;
}

export interface CostEntry {
  dealership_id: string;
  dealership_name: string;
  sms_count: number;
  openai_tokens: number;
  estimated_cost_usd: number;
  period: string;
}
