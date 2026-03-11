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
export async function getDealershipsReadyForTraining() {
  // Cross-tenant query — approved exception.
  // The hourly cron finds all dealerships where current local hour matches
  // their configured training_send_hour (default 10, range 9-12).
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name, timezone, settings')
    .not('timezone', 'is', null);

  if (error) throw error;

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
      // Use configured send hour from settings JSONB, default 10, clamped 9-12
      const settings = (d.settings ?? {}) as Record<string, unknown>;
      const sendHour = Math.max(9, Math.min(12, Number(settings.training_send_hour ?? 10)));
      return localHour === sendHour;
    } catch {
      return false;
    }
  });
}

/** @deprecated Use getDealershipsReadyForTraining() for training cron. This remains for non-training crons. */
export async function getDealershipsByTimezoneHour(hour: number) {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name, timezone, settings')
    .not('timezone', 'is', null);

  if (error) throw error;

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
    status: (data.status as string) ?? 'active',
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
    .select('id, status, question_text, mode, prompt_version_id, step_index, persona_mood, training_domain, created_at')
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
    stepIndex: (data.step_index as number) ?? 0,
    personaMood: (data.persona_mood as string | null) ?? null,
    trainingDomain: (data.training_domain as string | null) ?? null,
  };
}

// ─── Session step management (multi-exchange) ─────────────────────────

export async function updateSessionStep(sessionId: string, stepIndex: number) {
  const { error } = await serviceClient
    .from('conversation_sessions')
    .update({ step_index: stepIndex, updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  if (error) throw error;
}

// ─── Session transcript (for AI context in multi-exchange) ─────────────

export interface TranscriptEntry {
  direction: 'inbound' | 'outbound';
  messageBody: string;
  createdAt: string;
}

export async function getSessionTranscript(sessionId: string): Promise<TranscriptEntry[]> {
  const { data, error } = await serviceClient
    .from('sms_transcript_log')
    .select('direction, message_body, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    direction: row.direction as 'inbound' | 'outbound',
    messageBody: row.message_body as string,
    createdAt: row.created_at as string,
  }));
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
  phone: string;
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
      phone: entry.phone,
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
  mode: string;
  productAccuracy: number;
  toneRapport: number;
  addressedConcern: number;
  closeAttempt: number;
  feedback: string;
  model: string;
  promptVersionId?: string;
  urgencyCreation?: number | null;
  competitivePositioning?: number | null;
  trainingDomain?: string;
}) {
  const insertData: Record<string, unknown> = {
    user_id: result.userId,
    dealership_id: result.dealershipId,
    session_id: result.sessionId,
    mode: result.mode,
    product_accuracy: result.productAccuracy,
    tone_rapport: result.toneRapport,
    addressed_concern: result.addressedConcern,
    close_attempt: result.closeAttempt,
    feedback: result.feedback,
    prompt_version_id: result.promptVersionId ?? null,
  };

  // Phase 4A: behavioral scoring (only set if provided)
  if (result.urgencyCreation != null) {
    insertData.urgency_creation = result.urgencyCreation;
  }
  if (result.competitivePositioning != null) {
    insertData.competitive_positioning = result.competitivePositioning;
  }

  // Phase 4B: training domain tracking
  if (result.trainingDomain) {
    insertData.training_domain = result.trainingDomain;
  }

  const { error } = await serviceClient
    .from('training_results')
    .insert(insertData);

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
  personaMood?: string | null;
  difficultyCoefficient?: number;
  trainingDomain?: string;
}) {
  const insertData: Record<string, unknown> = {
    user_id: entry.userId,
    dealership_id: entry.dealershipId,
    mode: entry.mode,
    question_text: entry.questionText,
    prompt_version_id: entry.promptVersionId ?? null,
    status: 'pending',
  };

  // Phase 4A: persona mood
  if (entry.personaMood) {
    insertData.persona_mood = entry.personaMood;
  }
  if (entry.difficultyCoefficient != null && entry.difficultyCoefficient !== 1.0) {
    insertData.difficulty_coefficient = entry.difficultyCoefficient;
  }

  // Phase 4B: training domain
  if (entry.trainingDomain) {
    insertData.training_domain = entry.trainingDomain;
  }

  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .insert(insertData)
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

// ─── Phase 4A: Persona mood + engagement helpers ──────────────────────

/**
 * Get user tenure in weeks since trainee_start_date (or account creation).
 * Used for persona mood progression: weeks 1-2 friendly, 3-4 skeptical/rushed, 5+ angry/no-credit.
 */
export async function getUserTenureWeeks(userId: string): Promise<number> {
  const { data, error } = await serviceClient
    .from('users')
    .select('trainee_start_date, created_at')
    .eq('id', userId)
    .single();

  if (error) throw error;

  const startDate = data.trainee_start_date
    ? new Date(data.trainee_start_date as string)
    : new Date(data.created_at as string);
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  return Math.max(1, Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)));
}

/**
 * Get user's current training streak (consecutive weekdays with completed sessions).
 */
export async function getUserStreak(userId: string, dealershipId: string): Promise<number> {
  const { data, error } = await serviceClient
    .from('conversation_sessions')
    .select('created_at')
    .eq('user_id', userId)
    .eq('dealership_id', dealershipId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(90);

  if (error) throw error;
  if (!data || data.length === 0) return 0;

  // Count consecutive days (skipping weekends)
  let streak = 0;
  let checkDate = new Date();

  // Walk backward day by day
  for (let i = 0; i < 100; i++) {
    const dayOfWeek = checkDate.getDay();
    // Skip weekends
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      checkDate.setDate(checkDate.getDate() - 1);
      continue;
    }

    const dateStr = checkDate.toISOString().split('T')[0];
    const hasSession = data.some((s) => {
      const sessionDate = new Date(s.created_at as string).toISOString().split('T')[0];
      return sessionDate === dateStr;
    });

    if (hasSession) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Get user's recent score trend for a specific dimension (last 3 sessions).
 * Returns array of scores newest-first, e.g. [4.1, 3.8, 3.2]
 */
export async function getRecentScoreTrend(
  userId: string,
  dealershipId: string,
  dimension: 'product_accuracy' | 'tone_rapport' | 'addressed_concern' | 'close_attempt' = 'product_accuracy'
): Promise<number[]> {
  const { data, error } = await serviceClient
    .from('training_results')
    .select(dimension)
    .eq('user_id', userId)
    .eq('dealership_id', dealershipId)
    .order('created_at', { ascending: false })
    .limit(3);

  if (error) throw error;
  return (data ?? []).map((r) => (r as Record<string, unknown>)[dimension] as number);
}

// ─── Daily digest (Phase 3) ────────────────────────────────────────────
// Get managers for a dealership

export interface ManagerUser {
  id: string;
  full_name: string;
  phone: string;
  role: string;
}

export async function getManagersForDealership(
  dealershipId: string
): Promise<ManagerUser[]> {
  const { data, error } = await serviceClient
    .from('users')
    .select(`
      id,
      full_name,
      phone,
      dealership_memberships!inner ( role )
    `)
    .eq('dealership_memberships.dealership_id', dealershipId)
    .in('dealership_memberships.role', ['manager', 'owner'])
    .not('phone', 'is', null);

  if (error) throw error;

  return (data ?? []).map((user: Record<string, unknown>) => ({
    id: user.id as string,
    full_name: user.full_name as string,
    phone: user.phone as string,
    role: ((user.dealership_memberships as Array<Record<string, unknown>>)?.[0]?.role ?? 'manager') as string,
  }));
}

// Daily digest stats for a dealership on a specific date
export interface DigestStats {
  completionRate: number;
  totalSessions: number;
  completedSessions: number;
  topPerformer: { fullName: string; score: number } | null;
  lowestPerformer: { fullName: string; score: number } | null;
  avgScores: Record<string, number>;
}

export async function getDailyDigestStats(
  dealershipId: string,
  dateStr: string // YYYY-MM-DD format
): Promise<DigestStats> {
  // Get all users eligible for training that day
  const { data: eligibleUsers, error: eligibleError } = await serviceClient
    .from('users')
    .select(`
      id,
      dealership_memberships!inner ( dealership_id )
    `)
    .eq('dealership_memberships.dealership_id', dealershipId)
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (eligibleError) throw eligibleError;

  const totalSessions = eligibleUsers?.length ?? 0;

  // Get training results from that date
  const startOfDay = `${dateStr}T00:00:00Z`;
  const endOfDay = `${dateStr}T23:59:59Z`;

  const { data: results, error: resultsError } = await serviceClient
    .from('training_results')
    .select(`
      id,
      user_id,
      users ( full_name ),
      product_accuracy,
      tone_rapport,
      addressed_concern,
      close_attempt
    `)
    .eq('dealership_id', dealershipId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  if (resultsError) throw resultsError;

  const completedSessions = results?.length ?? 0;
  const completionRate = totalSessions > 0 ? completedSessions / totalSessions : 0;

  // Aggregate scores by user
  const userScores: Record<
    string,
    { fullName: string; scores: number[] }
  > = {};

  (results ?? []).forEach((r: Record<string, unknown>) => {
    const userId = r.user_id as string;
    const fullName = (r.users as Record<string, unknown>)?.full_name ?? 'Unknown';
    const avgScore =
      ((r.product_accuracy as number) +
        (r.tone_rapport as number) +
        (r.addressed_concern as number) +
        (r.close_attempt as number)) /
      4;

    if (!userScores[userId]) {
      userScores[userId] = { fullName: fullName as string, scores: [] };
    }
    userScores[userId].scores.push(avgScore);
  });

  // Find top and lowest performers
  const performers = Object.entries(userScores)
    .map(([_userId, data]) => ({
      fullName: data.fullName,
      avgScore:
        data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const topPerformer = performers.length > 0 ? performers[0] : null;
  const lowestPerformer =
    performers.length > 0 ? performers[performers.length - 1] : null;

  // Calculate overall averages
  const allScores: Record<string, number[]> = {
    product_accuracy: [],
    tone_rapport: [],
    addressed_concern: [],
    close_attempt: [],
  };

  (results ?? []).forEach((r: Record<string, unknown>) => {
    allScores.product_accuracy.push(r.product_accuracy as number);
    allScores.tone_rapport.push(r.tone_rapport as number);
    allScores.addressed_concern.push(r.addressed_concern as number);
    allScores.close_attempt.push(r.close_attempt as number);
  });

  const avgScores: Record<string, number> = {};
  Object.entries(allScores).forEach(([key, scores]) => {
    avgScores[key] =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  });

  return {
    completionRate,
    totalSessions,
    completedSessions,
    topPerformer: topPerformer
      ? { fullName: topPerformer.fullName, score: topPerformer.avgScore }
      : null,
    lowestPerformer: lowestPerformer
      ? { fullName: lowestPerformer.fullName, score: lowestPerformer.avgScore }
      : null,
    avgScores,
  };
}

// ─── Red flag detection (Phase 3) ──────────────────────────────────────

export interface FlaggedUser {
  id: string;
  fullName: string;
  phone: string;
  flags: string[];
}

export async function getRedFlagUsers(
  dealershipId: string
): Promise<FlaggedUser[]> {
  // Get all active users in dealership
  const { data: users, error: usersError } = await serviceClient
    .from('users')
    .select(`
      id,
      full_name,
      phone,
      dealership_memberships!inner ( dealership_id )
    `)
    .eq('dealership_memberships.dealership_id', dealershipId)
    .eq('status', 'active')
    .not('phone', 'is', null);

  if (usersError) throw usersError;

  const flaggedList: FlaggedUser[] = [];

  for (const user of users ?? []) {
    const flags: string[] = [];

    // Check: no response in 3+ days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: recentSessions, error: sessionsError } = await serviceClient
      .from('conversation_sessions')
      .select('id, updated_at')
      .eq('dealership_id', dealershipId)
      .eq('user_id', user.id)
      .gte('updated_at', threeDaysAgo.toISOString())
      .limit(1);

    if (!sessionsError && (!recentSessions || recentSessions.length === 0)) {
      flags.push('no_response_3d');
    }

    // Check: completion rate <30% (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: sevenDaySessions, error: sevenDayError } =
      await serviceClient
        .from('conversation_sessions')
        .select('id, status')
        .eq('dealership_id', dealershipId)
        .eq('user_id', user.id)
        .gte('created_at', sevenDaysAgo.toISOString());

    if (!sevenDayError) {
      const sessions = sevenDaySessions ?? [];
      const completed = sessions.filter((s: Record<string, unknown>) => s.status === 'completed').length;
      const completionRate = sessions.length > 0 ? completed / sessions.length : 0;

      if (sessions.length > 0 && completionRate < 0.3) {
        flags.push('low_completion');
      }
    }

    // Check: score decline >40% vs previous week
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const { data: previousWeek, error: prevWeekError } = await serviceClient
      .from('training_results')
      .select('product_accuracy, tone_rapport, addressed_concern, close_attempt')
      .eq('dealership_id', dealershipId)
      .eq('user_id', user.id)
      .gte('created_at', twoWeeksAgo.toISOString())
      .lt('created_at', weekAgo.toISOString());

    const { data: currentWeek, error: currWeekError } = await serviceClient
      .from('training_results')
      .select('product_accuracy, tone_rapport, addressed_concern, close_attempt')
      .eq('dealership_id', dealershipId)
      .eq('user_id', user.id)
      .gte('created_at', weekAgo.toISOString());

    if (!prevWeekError && !currWeekError) {
      const prevScores = previousWeek ?? [];
      const currScores = currentWeek ?? [];

      if (prevScores.length > 0 && currScores.length > 0) {
        const prevAvg =
          prevScores.reduce(
            (sum: number, r: Record<string, unknown>) =>
              sum +
              ((r.product_accuracy as number) +
                (r.tone_rapport as number) +
                (r.addressed_concern as number) +
                (r.close_attempt as number)) /
                4,
            0
          ) / prevScores.length;

        const currAvg =
          currScores.reduce(
            (sum: number, r: Record<string, unknown>) =>
              sum +
              ((r.product_accuracy as number) +
                (r.tone_rapport as number) +
                (r.addressed_concern as number) +
                (r.close_attempt as number)) /
                4,
            0
          ) / currScores.length;

        const decline = (prevAvg - currAvg) / prevAvg;
        if (decline > 0.4) {
          flags.push('score_decline');
        }
      }
    }

    if (flags.length > 0) {
      flaggedList.push({
        id: user.id,
        fullName: user.full_name,
        phone: user.phone,
        flags,
      });
    }
  }

  return flaggedList;
}

// ─── Phase 4: Adaptive Weighting ────────────────────────────────────────
// Manage employee priority vectors across training domains

export async function getEmployeePriorityVector(
  userId: string,
  dealershipId: string
): Promise<Record<string, number> | null> {
  const { data, error } = await serviceClient
    .from('employee_priority_vectors')
    .select('weights')
    .eq('dealership_id', dealershipId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return data.weights as Record<string, number>;
}

export async function upsertPriorityVector(
  userId: string,
  dealershipId: string,
  weights: Record<string, number>
): Promise<void> {
  const { error } = await serviceClient.from('employee_priority_vectors').upsert(
    {
      user_id: userId,
      dealership_id: dealershipId,
      weights,
      last_updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,dealership_id' }
  );

  if (error) throw error;
}

export async function getLastTrainingDomain(
  userId: string,
  dealershipId: string
): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('training_results')
    .select('training_domain')
    .eq('dealership_id', dealershipId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return data.training_domain as string;
}

export async function getAdaptiveWeightingConfig(
  dealershipId: string
): Promise<{
  alpha: number;
  beta: number;
  threshold: number;
  k_values: Record<string, number>;
} | null> {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('feature_flags')
    .eq('id', dealershipId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  const flags = data.feature_flags as Record<string, unknown>;
  const adaptive = flags.adaptive_weighting as Record<string, unknown> | undefined;

  if (!adaptive) return null;

  return {
    alpha: Number(adaptive.alpha ?? 0.3),
    beta: Number(adaptive.beta ?? 0.1),
    threshold: Number(adaptive.threshold ?? 3.0),
    k_values: (adaptive.k_values as Record<string, number>) ?? {},
  };
}

// ─── Phase 4: Schedule Awareness ────────────────────────────────────────
// Manage employee schedules (days off, vacation)

export async function getEmployeeSchedule(
  userId: string,
  dealershipId: string
): Promise<{
  recurringDaysOff: number[];
  oneOffAbsences: string[];
  vacationStart: string | null;
  vacationEnd: string | null;
  lastConfirmedAt: string;
  updatedAt: string;
} | null> {
  const { data, error } = await serviceClient
    .from('employee_schedules')
    .select('recurring_days_off, one_off_absences, vacation_start, vacation_end, last_confirmed_at, updated_at')
    .eq('dealership_id', dealershipId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return {
    recurringDaysOff: (data.recurring_days_off as number[]) ?? [],
    oneOffAbsences: (data.one_off_absences as string[]) ?? [],
    vacationStart: data.vacation_start as string | null,
    vacationEnd: data.vacation_end as string | null,
    lastConfirmedAt: data.last_confirmed_at as string,
    updatedAt: data.updated_at as string,
  };
}

export async function upsertEmployeeSchedule(
  userId: string,
  dealershipId: string,
  schedule: {
    recurringDaysOff?: number[];
    oneOffAbsences?: string[];
    vacationStart?: string | null;
    vacationEnd?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const insertData: Record<string, unknown> = {
    user_id: userId,
    dealership_id: dealershipId,
    last_confirmed_at: now,
    updated_at: now,
  };

  if (schedule.recurringDaysOff !== undefined) {
    insertData.recurring_days_off = schedule.recurringDaysOff;
  }
  if (schedule.oneOffAbsences !== undefined) {
    insertData.one_off_absences = schedule.oneOffAbsences;
  }
  if (schedule.vacationStart !== undefined) {
    insertData.vacation_start = schedule.vacationStart;
  }
  if (schedule.vacationEnd !== undefined) {
    insertData.vacation_end = schedule.vacationEnd;
  }

  const { error } = await serviceClient.from('employee_schedules').upsert(insertData, {
    onConflict: 'user_id,dealership_id',
  });

  if (error) throw error;
}

// ─── Billing functions ──────────────────────────────────────────────

export async function updateDealershipBilling(
  dealershipId: string,
  billing: {
    stripeCustomerId?: string;
    subscriptionStatus?: string;
    subscriptionId?: string;
    maxLocations?: number;
    currentPeriodEnd?: string;
    pastDueSince?: string | null;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (billing.stripeCustomerId !== undefined) {
    updateData.stripe_customer_id = billing.stripeCustomerId;
  }
  if (billing.subscriptionStatus !== undefined) {
    updateData.subscription_status = billing.subscriptionStatus;
  }
  if (billing.subscriptionId !== undefined) {
    updateData.subscription_id = billing.subscriptionId;
  }
  if (billing.maxLocations !== undefined) {
    updateData.max_locations = billing.maxLocations;
  }
  if (billing.currentPeriodEnd !== undefined) {
    updateData.current_period_end = billing.currentPeriodEnd;
  }
  if (billing.pastDueSince !== undefined) {
    updateData.past_due_since = billing.pastDueSince;
  }

  const { error } = await serviceClient
    .from('dealerships')
    .update(updateData)
    .eq('id', dealershipId);

  if (error) throw error;
}

export async function getDealershipByStripeCustomer(stripeCustomerId: string) {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name, subscription_status, stripe_customer_id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;

  return {
    id: data.id as string,
    name: data.name as string,
    subscriptionStatus: data.subscription_status as string,
  };
}

export async function getPastDueDealerships() {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('id, name, subscription_status, past_due_since, stripe_customer_id')
    .eq('subscription_status', 'past_due')
    .not('past_due_since', 'is', null)
    .order('past_due_since', { ascending: true });

  if (error) throw error;

  return (data ?? []).map((d: Record<string, unknown>) => ({
    id: d.id as string,
    name: d.name as string,
    subscriptionStatus: d.subscription_status as string,
    pastDueSince: d.past_due_since as string,
    stripeCustomerId: d.stripe_customer_id as string,
  }));
}

export async function createDealershipWithManager(
  dealership: {
    name: string;
    timezone: string;
    stripeCustomerId?: string;
  },
  manager: {
    email: string;
    fullName: string;
    phone: string;
  }
): Promise<{ dealershipId: string; userId: string }> {
  // Create dealership
  const dealershipSlug = dealership.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const { data: dealershipData, error: dealershipError } = await serviceClient
    .from('dealerships')
    .insert({
      name: dealership.name,
      slug: dealershipSlug,
      timezone: dealership.timezone,
      stripe_customer_id: dealership.stripeCustomerId || null,
      subscription_status: dealership.stripeCustomerId ? 'active' : 'trialing',
    })
    .select('id')
    .single();

  if (dealershipError) throw dealershipError;
  const dealershipId = dealershipData.id as string;

  // Create user (manager)
  const { data: userData, error: userError } = await serviceClient
    .from('users')
    .insert({
      phone: manager.phone,
      full_name: manager.fullName,
      language: 'en',
      status: 'active',
      last_active_dealership_id: dealershipId,
    })
    .select('id')
    .single();

  if (userError) throw userError;
  const userId = userData.id as string;

  // Create dealership membership
  const { error: membershipError } = await serviceClient
    .from('dealership_memberships')
    .insert({
      user_id: userId,
      dealership_id: dealershipId,
      role: 'owner',
      is_primary: true,
    });

  if (membershipError) throw membershipError;

  return { dealershipId, userId };
}

// ─── Phase 6: Growth Features ───────────────────────────────────────────────

// ─── Scenario Chains (Progressive Scenario Chains) ─────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getScenarioChain(chainId: string): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('scenario_chains')
    .select('*')
    .eq('id', chainId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getScenarioChainByUserDealership(
  userId: string,
  dealershipId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('scenario_chains')
    .select('*')
    .eq('user_id', userId)
    .eq('dealership_id', dealershipId)
    .eq('status', 'active')
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function createScenarioChain(
  userId: string,
  dealershipId: string,
  chain: {
    currentStep: number;
    maxSteps: number;
    narrativeContext: Record<string, unknown>;
    stepResults: Record<string, unknown>[];
    status: string;
  }
): Promise<string> {
  const { data, error } = await serviceClient
    .from('scenario_chains')
    .insert({
      user_id: userId,
      dealership_id: dealershipId,
      current_step: chain.currentStep,
      max_steps: chain.maxSteps,
      narrative_context: chain.narrativeContext,
      step_results: chain.stepResults,
      status: chain.status,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

export async function updateScenarioChain(
  chainId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (updates.currentStep !== undefined) updateData.current_step = updates.currentStep;
  if (updates.narrativeContext !== undefined) updateData.narrative_context = updates.narrativeContext;
  if (updates.stepResults !== undefined) updateData.step_results = updates.stepResults;
  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.updatedAt !== undefined) updateData.updated_at = updates.updatedAt;

  const { error } = await serviceClient
    .from('scenario_chains')
    .update(updateData)
    .eq('id', chainId);

  if (error) throw error;
}

// ─── Daily Challenges ─────────────────────────────────────────────────────

export async function createDailyChallenge(data: {
  dealershipId: string;
  challengeDate: string;
  scenarioText: string;
  gradingRubric: Record<string, unknown>;
  results: unknown[];
}): Promise<string> {
  const { data: result, error } = await serviceClient
    .from('daily_challenges')
    .insert({
      dealership_id: data.dealershipId,
      challenge_date: data.challengeDate,
      scenario_text: data.scenarioText,
      grading_rubric: data.gradingRubric,
      results: data.results,
    })
    .select('id')
    .single();

  if (error) throw error;
  return result.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDailyChallenge(challengeId: string): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('daily_challenges')
    .select('*')
    .eq('id', challengeId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getDailyChallengeByChallengeDate(
  dealershipId: string,
  challengeDate: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('daily_challenges')
    .select('*')
    .eq('dealership_id', dealershipId)
    .eq('challenge_date', challengeDate)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateDailyChallenge(
  challengeId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (updates.results !== undefined) updateData.results = updates.results;
  if (updates.scenarioText !== undefined) updateData.scenario_text = updates.scenarioText;

  const { error } = await serviceClient
    .from('daily_challenges')
    .update(updateData)
    .eq('id', challengeId);

  if (error) throw error;
}

// ─── Peer Challenges ──────────────────────────────────────────────────────

export async function createPeerChallenge(data: {
  dealershipId: string;
  challengerId: string;
  challengedId: string;
  scenarioText: string;
  status: string;
  expiresAt: string;
}): Promise<string> {
  const { data: result, error } = await serviceClient
    .from('peer_challenges')
    .insert({
      dealership_id: data.dealershipId,
      challenger_id: data.challengerId,
      challenged_id: data.challengedId,
      scenario_text: data.scenarioText,
      status: data.status,
      expires_at: data.expiresAt,
    })
    .select('id')
    .single();

  if (error) throw error;
  return result.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPeerChallenge(challengeId: string): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('peer_challenges')
    .select('*')
    .eq('id', challengeId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPeerChallengesForUser(userId: string, dealershipId: string): Promise<any[]> {
  const { data, error } = await serviceClient
    .from('peer_challenges')
    .select('*')
    .eq('dealership_id', dealershipId)
    .or(`challenger_id.eq.${userId},challenged_id.eq.${userId}`)
    .in('status', ['pending', 'active']);

  if (error) throw error;
  return data || [];
}

export async function updatePeerChallenge(
  challengeId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (updates.challenger_response !== undefined)
    updateData.challenger_response = updates.challenger_response;
  if (updates.challenged_response !== undefined)
    updateData.challenged_response = updates.challenged_response;
  if (updates.challenger_score !== undefined) updateData.challenger_score = updates.challenger_score;
  if (updates.challenged_score !== undefined) updateData.challenged_score = updates.challenged_score;
  if (updates.status !== undefined) updateData.status = updates.status;

  const { error } = await serviceClient
    .from('peer_challenges')
    .update(updateData)
    .eq('id', challengeId);

  if (error) throw error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getExpiredPeerChallenges(): Promise<any[]> {
  const now = new Date();

  const { data, error } = await serviceClient
    .from('peer_challenges')
    .select('*')
    .in('status', ['pending', 'active'])
    .lt('expires_at', now.toISOString());

  if (error) throw error;
  return data || [];
}

// ─── Custom Training Content ──────────────────────────────────────────────

export async function createCustomTrainingContent(data: {
  dealershipId: string;
  createdBy: string;
  rawInput: string;
  formattedScenario: string;
  mode: string;
  status: string;
}): Promise<string> {
  const { data: result, error } = await serviceClient
    .from('custom_training_content')
    .insert({
      dealership_id: data.dealershipId,
      created_by: data.createdBy,
      raw_input: data.rawInput,
      formatted_scenario: data.formattedScenario,
      mode: data.mode,
      status: data.status,
    })
    .select('id')
    .single();

  if (error) throw error;
  return result.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCustomTrainingContent(contentId: string): Promise<any | null> {
  const { data, error } = await serviceClient
    .from('custom_training_content')
    .select('*')
    .eq('id', contentId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function updateCustomTrainingContent(
  contentId: string,
  updates: Record<string, unknown>
): Promise<void> {
  const updateData: Record<string, unknown> = {};

  if (updates.status !== undefined) updateData.status = updates.status;
  if (updates.formattedScenario !== undefined) updateData.formatted_scenario = updates.formattedScenario;

  const { error } = await serviceClient
    .from('custom_training_content')
    .update(updateData)
    .eq('id', contentId);

  if (error) throw error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPendingApprovals(dealershipId: string): Promise<any[]> {
  const { data, error } = await serviceClient
    .from('custom_training_content')
    .select('*')
    .eq('dealership_id', dealershipId)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getApprovedContent(dealershipId: string): Promise<any[]> {
  const { data, error } = await serviceClient
    .from('custom_training_content')
    .select('*')
    .eq('dealership_id', dealershipId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

// ─── Helper: Get user by name (for peer challenges) ────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getUserByName(fullName: string, dealershipId: string): Promise<any | null> {
  // Search for user by full_name in this dealership's members
  const { data, error } = await serviceClient
    .from('dealership_memberships')
    .select('users!inner(id, full_name, phone)')
    .eq('dealership_id', dealershipId)
    .ilike('users.full_name', `%${fullName}%`)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;

  if (data) {
    const record = Array.isArray(data) ? data[0] : data;
    if (record && (record as Record<string, unknown>).users) {
      const users = (record as Record<string, unknown>).users as Record<string, unknown>;
      return {
        id: users.id as string,
        fullName: users.full_name as string,
        phone: users.phone as string,
      };
    }
  }

  return null;
}

// ─── Helper: Get eligible users for daily challenge ───────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getEligibleUsersForChallenge(dealershipId: string): Promise<any[]> {
  const { data, error } = await serviceClient
    .from('dealership_memberships')
    .select('user_id, users!inner(id, full_name, phone, status)')
    .eq('dealership_id', dealershipId)
    .eq('users.status', 'active')
    .eq('role', 'salesperson');

  if (error) throw error;

  return (data || []).map((m: Record<string, unknown>) => ({
    userId: m.user_id as string,
    fullName: (m.users as Record<string, unknown>).full_name as string,
    phone: (m.users as Record<string, unknown>).phone as string,
  }));
}

// ─── Consent SMS ─────────────────────────────────────────────────────

export async function getDealershipName(dealershipId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from('dealerships')
    .select('name')
    .eq('id', dealershipId)
    .single();

  if (error) throw error;
  return data.name as string;
}

export async function updateUserStatus(userId: string, status: string) {
  const { error } = await serviceClient
    .from('users')
    .update({ status })
    .eq('id', userId);

  if (error) throw error;
}

