// Phase 4.5B: Cross-dealership benchmark.
// Only runs when feature flag enabled AND 3+ active dealerships.
// Privacy: never exposes another dealership's name, scores, or rep data.

import { serviceClient } from '@/lib/supabase/service';
import { isFeatureEnabled } from '@/lib/service-db';
import type { MeetingScriptBenchmark } from '@/types/meeting-script';

export async function getBenchmark(
  dealershipId: string
): Promise<MeetingScriptBenchmark | null> {
  try {
    const enabled = await isFeatureEnabled(
      dealershipId,
      'cross_dealership_benchmark'
    );
    if (!enabled) return null;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Get all completed sessions in last 7 days across all dealerships
    const { data: sessions } = await serviceClient
      .from('training_results')
      .select('dealership_id, product_accuracy, tone_rapport, addressed_concern, close_attempt')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (!sessions || sessions.length === 0) return null;

    // Group by dealership, compute avg score
    const dealershipScores: Record<string, { sum: number; count: number }> = {};
    for (const s of sessions) {
      const did = s.dealership_id as string;
      if (!dealershipScores[did]) dealershipScores[did] = { sum: 0, count: 0 };
      const avg =
        ((s.product_accuracy as number) +
          (s.tone_rapport as number) +
          (s.addressed_concern as number) +
          (s.close_attempt as number)) /
        4;
      dealershipScores[did].sum += avg;
      dealershipScores[did].count++;
    }

    const activeDealershipIds = Object.keys(dealershipScores);
    if (activeDealershipIds.length < 3) return null;

    // Check for same-brand peers
    const { data: brands } = await serviceClient
      .from('dealership_brands')
      .select('dealership_id, make_id, makes ( name )')
      .in('dealership_id', activeDealershipIds);

    // Find this dealership's brand
    const thisBrand = brands?.find(
      (b) => (b.dealership_id as string) === dealershipId
    );

    let brandLabel = 'all';
    let rankPool = activeDealershipIds;

    if (thisBrand) {
      const sameBrandPeers =
        brands?.filter(
          (b) => (b.make_id as string) === (thisBrand.make_id as string)
        ) ?? [];
      const sameBrandIds = sameBrandPeers.map(
        (b) => b.dealership_id as string
      );

      // Use same-brand ranking if 5+ same-brand dealerships active
      if (sameBrandIds.length >= 5) {
        rankPool = sameBrandIds;
        const makeName = (thisBrand.makes as unknown as { name: string } | null)?.name;
        brandLabel = makeName ?? 'brand';
      }
    }

    // Rank dealerships by avg score (descending)
    const ranked = rankPool
      .filter((id) => dealershipScores[id])
      .map((id) => ({
        id,
        // V4-H-002: Guard division by zero
        avg: dealershipScores[id].count > 0 ? dealershipScores[id].sum / dealershipScores[id].count : 0,
      }))
      .sort((a, b) => b.avg - a.avg);

    const myRank = ranked.findIndex((r) => r.id === dealershipId) + 1;

    if (myRank === 0) return null; // This dealership not in pool

    return {
      rank: myRank,
      total: ranked.length,
      brand: brandLabel,
    };
  } catch (err) {
    console.error('Benchmark query failed:', err);
    return null;
  }
}
