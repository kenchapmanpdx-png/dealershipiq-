// Knowledge gaps page — low-confidence Ask IQ queries
// Client component — shows queries where AI confidence was below 70%
// Build Master: Phase 3

'use client';

import { useState, useEffect, useCallback } from 'react';

interface KnowledgeGap {
  id: string;
  user_id: string;
  user_name: string;
  query_text: string;
  ai_response: string;
  confidence: number;
  topic: string | null;
  created_at: string;
}

export default function GapsPage() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dashboard/gaps');
      if (res.ok) {
        const data = await res.json();
        setGaps(data.gaps ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch knowledge gaps:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse">Loading knowledge gaps...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Knowledge Gaps</h1>
        <span className="text-sm text-gray-500">
          Low-confidence Ask IQ queries from past 30 days
        </span>
      </div>

      {gaps.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-600">No low-confidence queries found</p>
          <p className="text-sm text-gray-400 mt-2">
            Queries where AI confidence is below 70% will appear here
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Question
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Asked By
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Topic
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {gaps.map((gap) => (
                <GapRow
                  key={gap.id}
                  gap={gap}
                  isExpanded={expandedId === gap.id}
                  onToggle={() =>
                    setExpandedId(expandedId === gap.id ? null : gap.id)
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function GapRow({
  gap,
  isExpanded,
  onToggle,
}: {
  gap: KnowledgeGap;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const confidenceColor =
    gap.confidence < 30
      ? 'bg-red-100 text-red-800'
      : gap.confidence < 50
        ? 'bg-orange-100 text-orange-800'
        : 'bg-yellow-100 text-yellow-800';

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-6 py-4 whitespace-nowrap">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${confidenceColor}`}
          >
            {gap.confidence}%
          </span>
        </td>
        <td className="px-6 py-4">
          <p className="text-sm text-gray-900 line-clamp-2">
            {gap.query_text}
          </p>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
          {gap.user_name}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
          {gap.topic ?? '—'}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          {formatDate(gap.created_at)}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={5} className="px-6 py-4 bg-gray-50">
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">
                  Full Question
                </h4>
                <p className="text-sm text-gray-900">{gap.query_text}</p>
              </div>
              <div>
                <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">
                  AI Response (low confidence)
                </h4>
                <p className="text-sm text-gray-700">{gap.ai_response}</p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
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
