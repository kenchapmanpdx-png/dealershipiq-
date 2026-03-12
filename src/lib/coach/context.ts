// Coach Mode rep context builder — Phase 4.5A
// Loads rep training data for system prompt injection and session snapshot.

import { serviceClient } from '@/lib/supabase/service';
import {
  getUserTenureWeeks,
  getUserStreak,
  getRecentScoreTrend,
  getEmployeePriorityVector,
} from '@/lib/service-db';
import type { RepContextSnapshot } from '@/types/coach';

const SCORING_DIMENSIONS = [
  'product_accuracy',
  'tone_rapport',
  'addressed_concern',
  'close_attempt',
] as const;

export async function buildRepContext(
  userId: string,
  dealershipId: string
): Promise<RepContextSnapshot> {
  // Parallel fetches for performance
  const [
    userRow,
    dealershipRow,
    tenureWeeks,
    streak,
    priorityVec,
    recentGaps,
    prevCoachSessions,
    domainScores,
  ] = await Promise.all([
    serviceClient
      .from('users')
      .select('full_name, hire_date, created_at, language')
      .eq('id', userId)
      .single(),
    serviceClient
      .from('dealerships')
      .select('name')
      .eq('id', dealershipId)
      .single(),
    getUserTenureWeeks(userId),
    getUserStreak(userId, dealershipId),
    getEmployeePriorityVector(userId, dealershipId).catch(() => null),
    getRecentGaps(userId, dealershipId),
    getPreviousCoachSessions(userId),
    getDomainScores(userId, dealershipId),
  ]);

  const firstName = (userRow.data?.full_name as string)?.split(' ')[0] ?? 'there';
  const dealershipName = (dealershipRow.data?.name as string) ?? 'your dealership';
  const hireDate = (userRow.data?.hire_date as string) ?? null;
  const createdAt = userRow.data?.created_at as string;
  const tenureDays = tenureWeeks * 7;

  // Calculate completion rate (last 30 days)
  const completionRate = await getCompletionRate30d(userId, dealershipId);

  // Best streak
  const bestStreak = streak; // Simplified — could track separately

  // Total sessions
  const totalSessions = Object.values(domainScores).reduce(
    (sum, d) => sum + d.session_count,
    0
  );

  return {
    first_name: firstName,
    dealership_name: dealershipName,
    tenure_days: tenureDays,
    hire_date: hireDate ?? createdAt?.split('T')[0] ?? null,
    training_scores: domainScores,
    overall_stats: {
      total_sessions: totalSessions,
      current_streak: streak,
      best_streak: bestStreak,
      completion_rate_30d: completionRate,
    },
    priority_vector: priorityVec ?? null,
    recent_gaps: recentGaps,
    previous_coach_sessions: prevCoachSessions,
  };
}

export function getTenureDescription(tenureDays: number): string {
  if (tenureDays < 7) return 'First week';
  if (tenureDays <= 14) return 'Two weeks';
  if (tenureDays <= 30) return `${Math.round(tenureDays / 7)} weeks`;
  return `${Math.round(tenureDays / 30)} months`;
}

// --- Internal helpers ---

async function getDomainScores(
  userId: string,
  dealershipId: string
): Promise<RepContextSnapshot['training_scores']> {
  const scores: RepContextSnapshot['training_scores'] = {};

  for (const dimension of SCORING_DIMENSIONS) {
    try {
      const trend = await getRecentScoreTrend(userId, dealershipId, dimension);
      if (!trend || trend.length === 0) continue;

      const avg = trend.reduce((s, v) => s + v, 0) / trend.length;
      const trendDir = determineTrend(trend);

      scores[dimension] = {
        avg_score: Math.round(avg * 10) / 10,
        trend: trendDir,
        session_count: trend.length,
      };
    } catch {
      // Skip domain on error
    }
  }

  return scores;
}

function determineTrend(
  scores: number[]
): 'improving' | 'stable' | 'declining' {
  if (scores.length < 3) return 'stable';
  const recent = scores.slice(-3);
  const older = scores.slice(0, -3);
  if (older.length === 0) return 'stable';

  const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const olderAvg = older.reduce((s, v) => s + v, 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (diff > 0.5) return 'improving';
  if (diff < -0.5) return 'declining';
  return 'stable';
}

async function getRecentGaps(
  userId: string,
  dealershipId: string
): Promise<string[]> {
  try {
    const { data } = await serviceClient
      .from('askiq_queries')
      .select('topic')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .order('created_at', { ascending: false })
      .limit(5);

    return (data ?? [])
      .map((r) => r.topic as string)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getPreviousCoachSessions(
  userId: string
): Promise<RepContextSnapshot['previous_coach_sessions']> {
  try {
    const { data } = await serviceClient
      .from('coach_sessions')
      .select('session_topic, sentiment_trend, created_at')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(3);

    return (data ?? []).map((r) => ({
      session_topic: (r.session_topic as string) ?? 'unknown',
      sentiment_trend: (r.sentiment_trend as string) ?? 'neutral',
      created_at: r.created_at as string,
    }));
  } catch {
    return [];
  }
}

async function getCompletionRate30d(
  userId: string,
  dealershipId: string
): Promise<number> {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: total } = await serviceClient
      .from('conversation_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { count: completed } = await serviceClient
      .from('conversation_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .eq('status', 'completed')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (!total || total === 0) return 0;
    return Math.round(((completed ?? 0) / total) * 100) / 100;
  } catch {
    return 0;
  }
}
