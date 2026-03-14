// Phase 4.5B: Morning Meeting Script data queries.
// All queries use service_role client. Run during cron job.

import { serviceClient } from '@/lib/supabase/service';
import { selectCoachingPrompt, DOMAIN_LABELS } from './coaching-prompts';
import type {
  MeetingScriptShoutout,
  MeetingScriptGap,
  MeetingScriptCoachingFocus,
  MeetingScriptAtRisk,
  MeetingScriptNumbers,
} from '@/types/meeting-script';

// --- Query 1: Shoutout (Top Scorer Yesterday) ---

export async function getShoutout(
  dealershipId: string
): Promise<MeetingScriptShoutout | null> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);

  try {
    const { data: results } = await serviceClient
      .from('training_results')
      .select(`
        user_id,
        product_accuracy,
        tone_rapport,
        addressed_concern,
        close_attempt,
        training_domain,
        users ( full_name )
      `)
      .eq('dealership_id', dealershipId)
      .gte('created_at', startOfYesterday.toISOString())
      .lte('created_at', endOfYesterday.toISOString())
      .order('created_at', { ascending: false });

    if (!results || results.length === 0) return null;

    // Find the result with highest average score
    let bestResult: (typeof results)[0] | null = null;
    let bestAvg = 0;

    for (const r of results) {
      const avg =
        ((r.product_accuracy as number) +
          (r.tone_rapport as number) +
          (r.addressed_concern as number) +
          (r.close_attempt as number)) /
        4;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestResult = r;
      }
    }

    if (!bestResult) return null;

    const user = bestResult.users as unknown as { full_name: string } | null;
    const firstName = (user?.full_name ?? 'Unknown').split(' ')[0];
    const domain = (bestResult.training_domain as string) ?? 'training';
    const domainLabel = DOMAIN_LABELS[domain] ?? domain;

    // Score as percentage (1-5 scale → 0-100%)
    const scorePercent = Math.round(bestAvg * 20);

    return {
      name: firstName,
      domain: domainLabel,
      score: scorePercent,
    };
  } catch (err) {
    console.error('Shoutout query failed:', (err as Error).message ?? err);
    return null;
  }
}

// --- Query 2: Team Gap (Knowledge Gaps) ---

export async function getTeamGap(
  dealershipId: string
): Promise<MeetingScriptGap | null> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    // Try knowledge_gaps table first
    const { data: gaps } = await serviceClient
      .from('knowledge_gaps')
      .select('topic')
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (gaps && gaps.length > 0) {
      // Group by topic, count occurrences
      const topicCounts: Record<string, number> = {};
      for (const g of gaps) {
        const topic = (g.topic as string) ?? 'unknown';
        topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      }

      // Find most frequent
      let topTopic = '';
      let topCount = 0;
      for (const [topic, count] of Object.entries(topicCounts)) {
        if (count > topCount) {
          topCount = count;
          topTopic = topic;
        }
      }

      if (topTopic && topCount > 0) {
        // Attempt vehicle data answer lookup (best-effort)
        const answer = await lookupVehicleAnswer(dealershipId, topTopic);
        return { topic: topTopic, count: topCount, answer };
      }
    }

    // Fallback: askiq_queries with low confidence
    const { data: queries } = await serviceClient
      .from('askiq_queries')
      .select('topic')
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString())
      .lt('confidence', 0.7);

    if (queries && queries.length > 0) {
      const topicCounts: Record<string, number> = {};
      for (const q of queries) {
        const topic = (q.topic as string) ?? 'unknown';
        topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
      }

      let topTopic = '';
      let topCount = 0;
      for (const [topic, count] of Object.entries(topicCounts)) {
        if (count > topCount) {
          topCount = count;
          topTopic = topic;
        }
      }

      if (topTopic && topCount > 0) {
        const answer = await lookupVehicleAnswer(dealershipId, topTopic);
        return { topic: topTopic, count: topCount, answer };
      }
    }

    return null;
  } catch (err) {
    console.error('Team gap query failed:', (err as Error).message ?? err);
    return null;
  }
}

/** Best-effort vehicle data keyword match for gap topic answer */
async function lookupVehicleAnswer(
  dealershipId: string,
  topic: string
): Promise<string | null> {
  try {
    const keywords = topic.toLowerCase().split(/\s+/);

    // Search selling_points for keyword matches
    const { data: points } = await serviceClient
      .from('selling_points')
      .select('advantage')
      .limit(50);

    if (points) {
      for (const p of points) {
        const advantage = (p.advantage as string) ?? '';
        const lowerAdv = advantage.toLowerCase();
        const match = keywords.some(
          (kw) => kw.length > 3 && lowerAdv.includes(kw)
        );
        if (match) return advantage;
      }
    }

    return null;
  } catch {
    return null;
  }
}

// --- Query 3: Coaching Focus ---

export async function getCoachingFocus(
  dealershipId: string
): Promise<MeetingScriptCoachingFocus | null> {
  try {
    // Get weakest domain from adaptive weighting (highest weight = weakest)
    const weakestDomain = await getWeakestDomain(dealershipId);

    if (weakestDomain) {
      // Get vehicle context for prompt variable substitution
      const { topModel, competitorModel } =
        await getVehicleNamesForDealership(dealershipId);

      const prompt = selectCoachingPrompt(
        weakestDomain,
        topModel,
        competitorModel
      );
      if (prompt) {
        return {
          domain: DOMAIN_LABELS[weakestDomain] ?? weakestDomain,
          prompt,
        };
      }
    }

    // Fallback: lowest average grading scores this week
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: results } = await serviceClient
      .from('training_results')
      .select('training_domain, product_accuracy, tone_rapport, addressed_concern, close_attempt')
      .eq('dealership_id', dealershipId)
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!results || results.length === 0) return null;

    // Average per domain
    const domainAvgs: Record<string, { sum: number; count: number }> = {};
    for (const r of results) {
      const domain = (r.training_domain as string) ?? 'general';
      if (!domainAvgs[domain]) domainAvgs[domain] = { sum: 0, count: 0 };
      const avg =
        ((r.product_accuracy as number) +
          (r.tone_rapport as number) +
          (r.addressed_concern as number) +
          (r.close_attempt as number)) /
        4;
      domainAvgs[domain].sum += avg;
      domainAvgs[domain].count++;
    }

    let lowestDomain = '';
    let lowestAvg = Infinity;
    for (const [domain, stats] of Object.entries(domainAvgs)) {
      // V4-H-003: Guard division by zero
      const avg = stats.count > 0 ? stats.sum / stats.count : 0;
      if (avg < lowestAvg) {
        lowestAvg = avg;
        lowestDomain = domain;
      }
    }

    if (lowestDomain) {
      const { topModel, competitorModel } =
        await getVehicleNamesForDealership(dealershipId);
      const prompt = selectCoachingPrompt(
        lowestDomain,
        topModel,
        competitorModel
      );
      if (prompt) {
        return {
          domain: DOMAIN_LABELS[lowestDomain] ?? lowestDomain,
          prompt,
        };
      }
    }

    return null;
  } catch (err) {
    console.error('Coaching focus query failed:', (err as Error).message ?? err);
    return null;
  }
}

/** Get the weakest domain across all employees from priority vectors */
async function getWeakestDomain(
  dealershipId: string
): Promise<string | null> {
  try {
    const { data: vectors } = await serviceClient
      .from('employee_priority_vectors')
      .select('weights')
      .eq('dealership_id', dealershipId);

    if (!vectors || vectors.length === 0) return null;

    // Aggregate average weight per domain (highest weight = weakest)
    const domainTotals: Record<string, { sum: number; count: number }> = {};
    for (const v of vectors) {
      const weights = v.weights as Record<string, number> | null;
      if (!weights) continue;
      for (const [domain, weight] of Object.entries(weights)) {
        if (!domainTotals[domain]) domainTotals[domain] = { sum: 0, count: 0 };
        domainTotals[domain].sum += weight;
        domainTotals[domain].count++;
      }
    }

    let weakestDomain = '';
    let highestWeight = 0;
    for (const [domain, stats] of Object.entries(domainTotals)) {
      // V4-H-003: Guard division by zero
      const avg = stats.count > 0 ? stats.sum / stats.count : 0;
      if (avg > highestWeight) {
        highestWeight = avg;
        weakestDomain = domain;
      }
    }

    return weakestDomain || null;
  } catch {
    return null;
  }
}

/** Get top model and competitor model names for prompt substitution */
async function getVehicleNamesForDealership(
  dealershipId: string
): Promise<{ topModel: string | null; competitorModel: string | null }> {
  try {
    // Get dealership's brand via dealership_brands
    const { data: brandRow } = await serviceClient
      .from('dealership_brands')
      .select('make_id, makes ( name )')
      .eq('dealership_id', dealershipId)
      .limit(1)
      .maybeSingle();

    if (!brandRow) return { topModel: null, competitorModel: null };

    const makeName = (brandRow.makes as unknown as { name: string } | null)?.name ?? null;

    // Get a model from this make for top_model
    const { data: modelRow } = await serviceClient
      .from('models')
      .select('name')
      .eq('make_id', brandRow.make_id as string)
      .limit(1)
      .maybeSingle();

    const topModel = modelRow
      ? `${makeName} ${modelRow.name as string}`
      : makeName;

    // Get a competitor model from competitive_sets
    const { data: compRow } = await serviceClient
      .from('competitive_sets')
      .select('vehicle_b_trim_id, trims!competitive_sets_vehicle_b_trim_id_fkey ( name, model_years ( models ( name, makes ( name ) ) ) )')
      .limit(1)
      .maybeSingle();

    let competitorModel: string | null = null;
    if (compRow) {
      const trim = compRow.trims as unknown as {
        name: string;
        model_years: { models: { name: string; makes: { name: string } } };
      } | null;
      // V4-M-002: Optional chaining on deeply nested competitive data
      if (trim?.model_years?.models?.makes?.name && trim?.model_years?.models?.name) {
        competitorModel = `${trim.model_years.models.makes.name} ${trim.model_years.models.name}`;
      }
    }

    return { topModel, competitorModel };
  } catch {
    return { topModel: null, competitorModel: null };
  }
}

// --- Query 4: At-Risk Reps (from red_flag_events) ---

export async function getAtRiskReps(
  dealershipId: string
): Promise<MeetingScriptAtRisk[]> {
  try {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const { data: events } = await serviceClient
      .from('red_flag_events')
      .select('user_id, signal_type, users ( full_name )')
      .eq('dealership_id', dealershipId)
      .eq('acknowledged', false)
      .gte('created_at', twoDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (!events || events.length === 0) return [];

    // Deduplicate by user — take the most recent signal per user
    const userSignals = new Map<string, { name: string; signal: string }>();

    for (const e of events) {
      const userId = e.user_id as string;
      if (userSignals.has(userId)) continue;

      const user = e.users as unknown as { full_name: string } | null;
      const firstName = (user?.full_name ?? 'Unknown').split(' ')[0];

      // Check if user is scheduled off today — skip if so
      const isOff = await checkScheduledOff(userId, dealershipId);
      if (isOff) continue;

      const signalLabel = SIGNAL_LABELS[e.signal_type as string] ?? (e.signal_type as string);
      userSignals.set(userId, { name: firstName, signal: signalLabel });
    }

    const result: MeetingScriptAtRisk[] = [];
    userSignals.forEach((v) => result.push(v));
    return result;
  } catch (err) {
    console.error('At-risk query failed:', (err as Error).message ?? err);
    return [];
  }
}

const SIGNAL_LABELS: Record<string, string> = {
  no_response_3d: 'no response 3 days',
  low_completion: 'low completion rate',
  score_decline: 'score declining',
  gone_dark: 'gone dark',
};

async function checkScheduledOff(
  userId: string,
  dealershipId: string
): Promise<boolean> {
  try {
    const { data: schedule } = await serviceClient
      .from('employee_schedules')
      .select('recurring_days_off, one_off_absences')
      .eq('user_id', userId)
      .eq('dealership_id', dealershipId)
      .maybeSingle();

    if (!schedule) return false;

    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun

    const recurringOff = (schedule.recurring_days_off as number[]) ?? [];
    if (recurringOff.includes(dayOfWeek)) return true;

    const absences = (schedule.one_off_absences as string[]) ?? [];
    const todayStr = today.toISOString().split('T')[0];
    if (absences.includes(todayStr)) return true;

    return false;
  } catch {
    return false;
  }
}

// --- Query 5: Team Numbers ---

export async function getTeamNumbers(
  dealershipId: string
): Promise<MeetingScriptNumbers> {
  try {
    const now = new Date();

    // Start of this week (Monday)
    const startOfThisWeek = new Date(now);
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    startOfThisWeek.setDate(now.getDate() - daysToMonday);
    startOfThisWeek.setHours(0, 0, 0, 0);

    // Start of last week
    const startOfLastWeek = new Date(startOfThisWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    // This week
    const { data: thisWeekSessions } = await serviceClient
      .from('conversation_sessions')
      .select('id, status')
      .eq('dealership_id', dealershipId)
      .gte('created_at', startOfThisWeek.toISOString());

    const thisWeekTotal = thisWeekSessions?.length ?? 0;
    const thisWeekCompleted = (thisWeekSessions ?? []).filter(
      (s) => (s.status as string) === 'completed'
    ).length;
    const thisWeekRate =
      thisWeekTotal > 0
        ? Math.round((thisWeekCompleted / thisWeekTotal) * 100)
        : 0;

    // Last week
    const { data: lastWeekSessions } = await serviceClient
      .from('conversation_sessions')
      .select('id, status')
      .eq('dealership_id', dealershipId)
      .gte('created_at', startOfLastWeek.toISOString())
      .lt('created_at', startOfThisWeek.toISOString());

    const lastWeekTotal = lastWeekSessions?.length ?? 0;
    const lastWeekCompleted = (lastWeekSessions ?? []).filter(
      (s) => (s.status as string) === 'completed'
    ).length;
    const lastWeekRate =
      lastWeekTotal > 0
        ? Math.round((lastWeekCompleted / lastWeekTotal) * 100)
        : 0;

    return {
      completion_rate: thisWeekRate,
      prior_week_rate: lastWeekRate,
      delta: thisWeekRate - lastWeekRate,
    };
  } catch (err) {
    console.error('Team numbers query failed:', (err as Error).message ?? err);
    return { completion_rate: 0, prior_week_rate: 0, delta: 0 };
  }
}
