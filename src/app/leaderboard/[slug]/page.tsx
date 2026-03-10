// Public leaderboard page
// Server component — SSR, no auth required
// Shows top performers for a dealership by slug
// Build Master: Phase 3

import { notFound } from 'next/navigation';
import { serviceClient } from '@/lib/supabase/service';

interface LeaderboardEntry {
  userId: string;
  userName: string;
  rank: number;
  avgScore: number;
  totalSessions: number;
}

interface LeaderboardPageProps {
  params: Promise<{ slug: string }>;
}

export default async function LeaderboardPage({
  params,
}: LeaderboardPageProps) {
  const { slug } = await params;

  // Find dealership by slug (or name if slug not directly stored)
  const { data: dealership, error: dealershipError } = await serviceClient
    .from('dealerships')
    .select('id, name, timezone')
    .eq('name', decodeURIComponent(slug))
    .maybeSingle();

  if (dealershipError || !dealership) {
    notFound();
  }

  // Get top performers
  const { data: results, error: resultsError } = await serviceClient
    .from('training_results')
    .select(`
      user_id,
      users (full_name),
      product_accuracy,
      tone_rapport,
      addressed_concern,
      close_attempt
    `)
    .eq('dealership_id', dealership.id)
    .order('created_at', { ascending: false });

  if (resultsError) {
    console.error('Failed to fetch leaderboard:', resultsError);
    notFound();
  }

  // Aggregate scores by user
  const userScores: Record<
    string,
    {
      name: string;
      scores: number[];
      sessionCount: number;
    }
  > = {};

  (results ?? []).forEach((result: Record<string, unknown>) => {
    const userId = result.user_id as string;
    const userName = ((result.users as Record<string, unknown>)?.full_name ?? 'Unknown') as string;
    const avgScore =
      ((result.product_accuracy as number) +
        (result.tone_rapport as number) +
        (result.addressed_concern as number) +
        (result.close_attempt as number)) /
      4;

    if (!userScores[userId]) {
      userScores[userId] = {
        name: userName,
        scores: [],
        sessionCount: 0,
      };
    }

    userScores[userId].scores.push(avgScore);
    userScores[userId].sessionCount += 1;
  });

  // Calculate averages and rank
  const leaderboard: LeaderboardEntry[] = Object.entries(userScores)
    .map(([userId, data]) => ({
      userId,
      userName: data.name,
      avgScore:
        data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0,
      totalSessions: data.sessionCount,
    }))
    .sort((a, b) => b.avgScore - a.avgScore)
    .map((entry, idx) => ({
      ...entry,
      rank: idx + 1,
    }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            {dealership.name} Leaderboard
          </h1>
          <p className="text-gray-600">
            Top performers in sales training
          </p>
        </div>

        {/* Leaderboard */}
        {leaderboard.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <p className="text-gray-600">No training sessions yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {leaderboard.map((entry) => (
              <div
                key={entry.userId}
                className={`bg-white rounded-lg shadow p-6 flex items-center gap-6 ${
                  entry.rank === 1
                    ? 'border-2 border-yellow-400 bg-yellow-50'
                    : entry.rank === 2
                      ? 'border-2 border-gray-400 bg-gray-50'
                      : entry.rank === 3
                        ? 'border-2 border-orange-400 bg-orange-50'
                        : ''
                }`}
              >
                {/* Rank badge */}
                <div
                  className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                    entry.rank === 1
                      ? 'bg-yellow-500 text-white'
                      : entry.rank === 2
                        ? 'bg-gray-500 text-white'
                        : entry.rank === 3
                          ? 'bg-orange-500 text-white'
                          : 'bg-blue-500 text-white'
                  }`}
                >
                  {entry.rank}
                </div>

                {/* Name and sessions */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-gray-900 truncate">
                    {entry.userName}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {entry.totalSessions} session{entry.totalSessions !== 1 ? 's' : ''}
                  </p>
                </div>

                {/* Score */}
                <div className="flex-shrink-0 text-right">
                  <div className="text-3xl font-bold text-gray-900">
                    {Math.round(entry.avgScore * 100)}
                  </div>
                  <p className="text-xs text-gray-600">avg score</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-sm text-gray-600">
          <p>Data updated in real-time</p>
        </div>
      </div>
    </div>
  );
}
