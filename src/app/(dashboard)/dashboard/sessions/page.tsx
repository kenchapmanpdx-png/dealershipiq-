// Sessions page — table view of training results
// Client component — filters by date range, default 7 days
// Build Master: Phase 3

'use client';

import { useState, useEffect, useCallback } from 'react';

interface Session {
  id: string;
  user_name: string;
  mode: string;
  product_accuracy: number;
  tone_rapport: number;
  addressed_concern: number;
  close_attempt: number;
  feedback: string;
  created_at: string;
}

interface SessionsData {
  sessions: Session[];
  days: number;
}

export default function SessionsPage() {
  const [data, setData] = useState<SessionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/sessions?days=${days}`);
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse">Loading sessions...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-gray-600">
        <p>No sessions found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Training Sessions</h1>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm"
        >
          <option value={1}>Last day</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {data.sessions.length === 0 ? (
          <div className="p-6 text-center text-gray-600">
            <p>No sessions in the last {days} day(s)</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Rep Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Mode
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Accuracy
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Rapport
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Concern
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Close
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Avg
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.sessions.map((session) => {
                const avg = Math.round(
                  (session.product_accuracy +
                    session.tone_rapport +
                    session.addressed_concern +
                    session.close_attempt) /
                    4
                );
                return (
                  <tr
                    key={session.id}
                    className="hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {session.user_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                        {session.mode}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {session.product_accuracy}/5
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {session.tone_rapport}/5
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {session.addressed_concern}/5
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {session.close_attempt}/5
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                      {avg}/5
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {formatDate(session.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
