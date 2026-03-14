// Main dashboard overview page
// Client component — fetches team stats and activity feed
// Build Master: Phase 3

'use client';

import { useState, useEffect, useCallback } from 'react';
import MeetingScript from '@/components/dashboard/MeetingScript';

interface TeamOverview {
  totalReps: number;
  activeToday: number;
  avgScore: number;
}

interface Activity {
  id: string;
  userName: string;
  action: string;
  score: number;
  timestamp: string;
}

interface DashboardData {
  overview: TeamOverview;
  recentActivity: Activity[];
}

interface CoachThemes {
  total_sessions: number;
  unique_users: number;
  themes: { topic: string; count: number; percentage: number }[];
  insufficient_data?: boolean;
  message?: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [coachThemes, setCoachThemes] = useState<CoachThemes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/team');
      if (!res.ok) {
        setError('Failed to fetch dashboard data');
        setLoading(false);
        return;
      }

      const teamData = await res.json();
      const team = teamData.team ?? [];

      // Calculate overview stats
      const totalReps = team.length;
      const activeToday = team.filter(
        (rep: Record<string, unknown>) =>
          rep.last_training_at &&
          isToday(new Date(rep.last_training_at as string))
      ).length;
      const avgScore =
        team.length > 0
          ? (team.reduce((sum: number, rep: Record<string, unknown>) => sum + (rep.average_score as number), 0) /
              team.length) * 100
          : 0;

      // Fetch recent sessions for activity feed
      const sessionsRes = await fetch('/api/dashboard/sessions?days=1');
      const sessionsData = await sessionsRes.json();
      const sessions = sessionsData.sessions ?? [];

      const recentActivity: Activity[] = sessions
        .slice(0, 5)
        .map((session: Record<string, unknown>) => ({
          id: session.id as string,
          userName: session.user_name as string,
          action: `Completed ${session.mode} training`,
          score: Math.round(
            ((session.product_accuracy as number) +
              (session.tone_rapport as number) +
              (session.addressed_concern as number) +
              (session.close_attempt as number)) /
              4
          ),
          timestamp: session.created_at as string,
        }));

      setData({
        overview: {
          totalReps,
          activeToday,
          avgScore: Math.round(avgScore * 10) / 10,
        },
        recentActivity,
      });

      // Fetch coach themes (non-blocking) — uses cookie-based auth automatically
      try {
        const coachRes = await fetch('/api/dashboard/coach-themes');
        if (coachRes.ok) {
          const coachData = await coachRes.json();
          if (coachData.data) setCoachThemes(coachData.data);
        }
      } catch {
        // Non-critical
      }

      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch dashboard:', (err as Error).message ?? err);
      setError('An error occurred');
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Poll every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse">Loading dashboard...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-600">
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>No data available</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Morning Meeting Script — top of dashboard */}
      <MeetingScript />

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <div className="text-gray-600 text-sm font-medium">Total Reps</div>
          <div className="text-4xl font-bold text-gray-900 mt-2">
            {data.overview.totalReps}
          </div>
        </Card>

        <Card>
          <div className="text-gray-600 text-sm font-medium">Active Today</div>
          <div className="text-4xl font-bold text-blue-600 mt-2">
            {data.overview.activeToday}
          </div>
          <div className="text-sm text-gray-500 mt-2">
            {data.overview.totalReps > 0
              ? Math.round((data.overview.activeToday / data.overview.totalReps) * 100)
              : 0}
            % participation
          </div>
        </Card>

        <Card>
          <div className="text-gray-600 text-sm font-medium">Avg Score</div>
          <div className="text-4xl font-bold text-green-600 mt-2">
            {data.overview.avgScore.toFixed(1)}%
          </div>
        </Card>
      </div>

      {/* Coach themes (if data available) */}
      {coachThemes && !coachThemes.insufficient_data && coachThemes.total_sessions > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Coach Mode Themes</h2>
          <p className="text-sm text-gray-500 mb-3">
            {coachThemes.total_sessions} sessions from {coachThemes.unique_users} reps this week
          </p>
          <div className="space-y-2">
            {coachThemes.themes.slice(0, 4).map((theme) => (
              <div key={theme.topic} className="flex justify-between items-center">
                <span className="text-sm text-gray-700 capitalize">{theme.topic}</span>
                <span className="text-sm font-medium text-gray-900">{theme.percentage}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      {coachThemes?.insufficient_data && (
        <Card>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Coach Mode</h2>
          <p className="text-sm text-gray-500">{coachThemes.message}</p>
        </Card>
      )}

      {/* Recent activity */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="text-gray-600">No activity in the last 24 hours</p>
        ) : (
          <div className="space-y-4">
            {data.recentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex justify-between items-center py-3 border-b border-gray-200 last:border-b-0"
              >
                <div>
                  <p className="font-medium text-gray-900">{activity.userName}</p>
                  <p className="text-sm text-gray-600">{activity.action}</p>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-gray-900">
                    {activity.score}/5
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatTimeAgo(activity.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      {children}
    </div>
  );
}

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

function formatTimeAgo(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
