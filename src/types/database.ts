// Generated types — replace with `supabase gen types typescript` output after migrations run.
// This stub provides type safety for development before codegen is available.

export type UserRole = 'owner' | 'manager' | 'salesperson';
export type UserStatus = 'pending_consent' | 'active' | 'opted_out' | 'deactivated';
export type SessionMode = 'roleplay' | 'quiz' | 'objection';
export type SessionStatus = 'pending' | 'active' | 'grading' | 'completed' | 'abandoned' | 'error';
export type ConsentType = 'opt_in' | 'opt_out';
export type MessageDirection = 'inbound' | 'outbound';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'failed';
export type MessageCategory = 'compliance' | 'training' | 'alert' | 'system';
export type GapSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface Dealership {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  timezone: string;
  feature_flags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DealershipMembership {
  id: string;
  user_id: string;
  dealership_id: string;
  role: UserRole;
  is_primary: boolean;
  created_at: string;
}

export interface User {
  id: string;
  auth_id: string | null;
  phone: string;
  full_name: string;
  language: 'en' | 'es';
  status: UserStatus;
  last_active_dealership_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationSession {
  id: string;
  user_id: string;
  dealership_id: string;
  mode: SessionMode;
  status: SessionStatus;
  step_index: number;
  version: number;
  started_at: string;
  last_message_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TrainingResult {
  id: string;
  user_id: string;
  dealership_id: string;
  session_id: string | null;
  mode: SessionMode;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  reasoning: string | null;
  prompt_version_id: string | null;
  created_at: string;
}

export interface FeatureFlag {
  id: string;
  dealership_id: string;
  flag_name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ScenarioBankEntry {
  scenario_id: string;
  customer_line: string;
  technique_tag: string;
  elite_dialogue: string;
  elite_response: string | null;
  fail_signals: string;
  mode: string;
  domain: string;
  difficulty: string | null;
  is_active: boolean;
  created_at: string;
}

// JWT custom claims shape (injected by Custom Access Token Hook)
export interface AppMetadataClaims {
  dealership_id: string;
  user_role: UserRole;
}
