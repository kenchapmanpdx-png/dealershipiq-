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
      last_active_dealership_id,
      dealership_memberships (
        dealership_id, role,
        dealerships ( id, name, timezone )
      )
    `)
    .eq('phone', phone)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  // Resolve active dealership (priority: last_active → first membership)
  const memberships = (data.dealership_memberships ?? []) as unknown as Array<{
    dealership_id: string;
    role: string;
    dealerships: { id: string; name: string; timezone: string } | null;
  }>;
  const activeMembership = memberships.find(
    (m) => m.dealership_id === data.last_active_dealership_id
  ) ?? memberships[0];

  if (!activeMembership?.dealerships) return null;

  return {
    id: data.id as string,
    phone: data.phone as string,
    fullName: data.full_name as string,
    language: (data.language as string) ?? 'en',
    dealershipId: activeMembership.dealership_id,
    dealershipName: activeMembership.dealerships.name,
    dealershipTimezone: activeMembership.dealerships.timezone,
    role: activeMembership.role,
  };
}

// ─── Tenant-scoped queries (dealership_id required) ────────────────────

export async function getActiveSession(userId: string, dealershipId: string) {
  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .select('id, status, question_text, mode, prompt_version_id, created_at')
    .eq('dealership_id', dealershipId)
    .eq('user_id', userId)
    .in('status', ['pending', 'active', 'grading'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    status: data.status as string,
    questionText: data.question_text as string,
    mode: data.mode as string,
    promptVersionId: data.prompt_version_id as string | null,
  };
}

export async function updateSessionStatus(sessionId: string, status: string) {
  const { error } = await serviceClient
    .from('conversation_sessions')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;
}

export async function insertTranscriptLog(entry: {
  userId: string;
  dealershipId: string;
  direction: 'inbound' | 'outbound';
  messageBody: string;
  sinchMessageId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await serviceClient
    .from('sms_transcript_log')
    .insert({
      user_id: entry.userId,
      dealership_id: entry.dealershipId,
      direction: entry.direction,
      message_body: entry.messageBody,
      sinch_message_id: entry.sinchMessageId ?? null,
      session_id: entry.sessionId ?? null,
    });

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
  userId: string;
  dealershipId: string;
  sessionId: string;
  productAccuracy: number;
  toneRapport: number;
  addressedConcern: number;
  closeAttempt: number;
  feedback: string;
  model: string;
  promptVersionId?: string;
}) {
  const { error } = await serviceClient
    .from('training_results')
    .insert({
      user_id: result.userId,
      dealership_id: result.dealershipId,
      session_id: result.sessionId,
      product_accuracy: result.productAccuracy,
      tone_rapport: result.toneRapport,
      addressed_concern: result.addressedConcern,
      close_attempt: result.closeAttempt,
      feedback: result.feedback,
      prompt_version_id: result.promptVersionId ?? null,
    });

  if (error) throw error;
}

// ─── Advisory lock ────────────────────────────────────────────────────
// Build Master 2B: prevents concurrent processing for same phone

export async function tryLockUser(phone: string): Promise<boolean> {
  const { data, error } = await serviceClient.rpc('try_lock_user', {
    user_phone: phone,
  });

  if (error) {
    console.error('Advisory lock error:', error);
    return false;
  }
  return data === true;
}

// ─── Opt-out management ──────────────────────────────────────────────

export async function registerOptOut(phone: string, dealershipId: string) {
  const { error } = await serviceClient
    .from('sms_opt_outs')
    .upsert(
      { phone, dealership_id: dealershipId, synced_from_sinch: false },
      { onConflict: 'phone,dealership_id' }
    );

  if (error) throw error;
}

export async function removeOptOut(phone: string, dealershipId: string) {
  const { error } = await serviceClient
    .from('sms_opt_outs')
    .delete()
    .eq('phone', phone)
    .eq('dealership_id', dealershipId);

  if (error) throw error;
}

// ─── Consent records ─────────────────────────────────────────────────

export async function insertConsentRecord(entry: {
  userId: string;
  dealershipId: string;
  consentType: string;
  channel: string;
  consentSource: string;
}) {
  const { error } = await serviceClient
    .from('consent_records')
    .insert({
      user_id: entry.userId,
      dealership_id: entry.dealershipId,
      consent_type: entry.consentType,
      channel: entry.channel,
      consent_source: entry.consentSource,
    });

  if (error) throw error;
}

// ─── Session creation (for outbound training trigger) ────────────────

export async function createConversationSession(entry: {
  userId: string;
  dealershipId: string;
  mode: string;
  questionText: string;
  promptVersionId?: string;
}) {
  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .insert({
      user_id: entry.userId,
      dealership_id: entry.dealershipId,
      mode: entry.mode,
      question_text: entry.questionText,
      prompt_version_id: entry.promptVersionId ?? null,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) throw error;
  return data;
}

// ─── Eligible users for daily training ───────────────────────────────

export async function getEligibleUsers(dealershipId: string) {
  // Users who: have active status, are not opted out, don't have an active session today
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await serviceClient
    .from('users')
    .select(`
      id, phone, full_name, language,
      dealership_memberships!inner ( dealership_id, role )
    `)
    .eq('dealership_memberships.dealership_id', dealershipId)
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (error) throw error;

  // Filter out opted-out users
  const { data: optOuts } = await serviceClient
    .from('sms_opt_outs')
    .select('phone')
    .eq('dealership_id', dealershipId);

  const optOutPhones = new Set((optOuts ?? []).map((o) => o.phone));

  // Filter out users with session today
  const { data: todaySessions } = await serviceClient
    .from('conversation_sessions')
    .select('user_id')
    .eq('dealership_id', dealershipId)
    .gte('created_at', `${today}T00:00:00Z`);

  const todayUserIds = new Set((todaySessions ?? []).map((s) => s.user_id));

  return (data ?? []).filter(
    (u) => !optOutPhones.has(u.phone) && !todayUserIds.has(u.id)
  );
}

// ─── Orphaned session cleanup ────────────────────────────────────────

export async function getOrphanedSessions(hoursThreshold: number = 2) {
  const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString();

  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .select('id, user_id, dealership_id, status, created_at')
    .in('status', ['active', 'grading'])
    .lt('updated_at', cutoff);

  if (error) throw error;
  return data ?? [];
}

// ─── Delivery log ────────────────────────────────────────────────────

export async function insertDeliveryLog(entry: {
  dealershipId: string;
  userId: string;
  phone: string;
  sinchMessageId: string;
  status: string;
  sessionId?: string;
}) {
  const { error } = await serviceClient
    .from('sms_delivery_log')
    .insert({
      dealership_id: entry.dealershipId,
      user_id: entry.userId,
      phone: entry.phone,
      sinch_message_id: entry.sinchMessageId,
      status: entry.status,
      session_id: entry.sessionId ?? null,
    });

  if (error) throw error;
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
