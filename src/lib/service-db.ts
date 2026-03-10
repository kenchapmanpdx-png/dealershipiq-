// Approved data access layer for service-role queries.
// Build Master Invariant: No API route, cron handler, or webhook handler
// may call serviceClient.from(table) directly. All access goes through here.
//
// Rule 2: Every service-role SELECT against a tenant-scoped table must include
// .eq('dealership_id', id). Exceptions documented inline.

import { serviceClient } from '@/lib/supabase/service';

// ─── Dealership lookups ────────────────────────────────────────────────
// Used by: daily training cron (hourly timezone scan)
// Exception to Rule 2: cross-tenant query (finds all dealerships by timezone hour)
export async function getDealershipsByTimezoneHour(hour: number) {
  // Cross-tenant query — approved exception.
  // The hourly cron needs to find all dealerships where current local hour = training hour.
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name, timezone, settings')
    .not('timezone', 'is', null);

  if (error) throw error;

  // Filter in-app: check if current hour in each dealership's timezone matches
  return (data ?? []).filter((d) => {
    try {
      const now = new Date();
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          hour: 'numeric',
          hour12: false,
          timeZone: d.timezone,
        }).format(now)
      );
      return localHour === hour;
    } catch {
      return false;
    }
  });
}

// ─── User lookup by phone ──────────────────────────────────────────────
// Used by: webhook handler (identify which user/dealership an inbound SMS belongs to)
// Exception to Rule 2: initial phone lookup to determine dealership_id
export async function getUserByPhone(phone: string) {
  // Cross-tenant lookup — approved exception (phone → dealership resolution).
  const { data, error } = await serviceClient
    .from('users')
    .select(`
      id, phone, full_name, language, status,
      dealership_memberships (
        dealership_id, role
      )
    `)
    .eq('phone', phone)
    .single();

  if (error) throw error;
  return data;
}

// ─── Tenant-scoped queries (dealership_id required) ────────────────────

export async function getActiveSession(userId: string, dealershipId: string) {
  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .select('*')
    .eq('dealership_id', dealershipId)
    .eq('user_id', userId)
    .in('status', ['pending', 'active', 'grading'])
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data;
}

export async function updateSessionStatus(
  sessionId: string,
  dealershipId: string,
  status: string,
  additionalFields?: Record<string, unknown>
) {
  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .update({ status, ...additionalFields })
    .eq('id', sessionId)
    .eq('dealership_id', dealershipId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function insertTranscriptLog(entry: {
  dealership_id: string;
  user_id: string | null;
  direction: 'inbound' | 'outbound';
  phone: string;
  message_body: string;
  sinch_message_id: string | null;
  session_id: string | null;
}) {
  const { error } = await serviceClient
    .from('sms_transcript_log')
    .insert(entry);

  if (error) throw error;
}

export async function checkOptOut(phone: string, dealershipId: string) {
  const { data, error } = await serviceClient
    .from('sms_opt_outs')
    .select('id')
    .eq('phone', phone)
    .eq('dealership_id', dealershipId)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

export async function insertTrainingResult(result: {
  user_id: string;
  dealership_id: string;
  session_id: string | null;
  mode: string;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  reasoning: string | null;
  prompt_version_id: string | null;
}) {
  const { data, error } = await serviceClient
    .from('training_results')
    .insert(result)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Feature flags ─────────────────────────────────────────────────────

export async function isFeatureEnabled(
  dealershipId: string,
  flagName: string
): Promise<boolean> {
  const { data, error } = await serviceClient
    .from('feature_flags')
    .select('enabled')
    .eq('dealership_id', dealershipId)
    .eq('flag_name', flagName)
    .maybeSingle();

  if (error) throw error;
  return data?.enabled ?? false;
}

export async function getFeatureFlagConfig(
  dealershipId: string,
  flagName: string
): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceClient
    .from('feature_flags')
    .select('enabled, config')
    .eq('dealership_id', dealershipId)
    .eq('flag_name', flagName)
    .maybeSingle();

  if (error) throw error;
  if (!data?.enabled) return null;
  return data.config as Record<string, unknown>;
}
