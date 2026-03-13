'use client';

import { useState, useEffect } from 'react';
import type { MeetingScriptFullScript, MeetingScriptResponse } from '@/types/meeting-script';

export default function MeetingScript() {
  const [script, setScript] = useState<MeetingScriptFullScript | null>(null);
  const [isYesterday, setIsYesterday] = useState(false);
  const [scriptDate, setScriptDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchScript() {
      try {
        // H-003 fix: Use credentials: 'include' instead of fragile cookie parsing.
        // The Supabase middleware injects the auth session from httpOnly cookies automatically.
        const res = await fetch('/api/dashboard/meeting-script', {
          credentials: 'include',
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data: MeetingScriptResponse = await res.json();
        setScript(data.data);
        setIsYesterday(data.is_yesterday);
        setScriptDate(data.script_date);
      } catch {
        // Non-critical
      }
      setLoading(false);
    }

    fetchScript();
  }, []);

  if (loading) return null;
  if (!script) return null;

  const formattedDate = formatScriptDate(scriptDate);

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          This Morning&apos;s Intel &mdash; {formattedDate}
        </h2>
        {isYesterday && (
          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
            Yesterday&apos;s intel &mdash; today&apos;s updates at 7 AM
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* SHOUTOUT */}
        {script.shoutout && (
          <Section title="SHOUTOUT" timeBadge="30 sec">
            <p className="text-gray-700">
              {script.shoutout.name} scored {script.shoutout.score}% on{' '}
              {script.shoutout.domain} yesterday. Ask them to share their
              approach with the team.
            </p>
          </Section>
        )}

        {/* TEAM GAP */}
        {script.gap && (
          <Section title="TEAM GAP" timeBadge="30 sec">
            <p className="text-gray-700">
              {script.gap.count} rep{script.gap.count === 1 ? '' : 's'} asked
              about {script.gap.topic} this week.
              {script.gap.answer && (
                <>
                  {' '}
                  <span className="font-medium">
                    Answer: {script.gap.answer}
                  </span>
                </>
              )}
            </p>
          </Section>
        )}

        {/* COACHING FOCUS */}
        {script.coaching_focus && (
          <Section title="COACHING FOCUS" timeBadge="30 sec">
            <p className="text-sm text-gray-500 mb-1">
              Your team&apos;s weakest area: {script.coaching_focus.domain}.
            </p>
            <p className="text-gray-700 italic">
              &ldquo;{script.coaching_focus.prompt}&rdquo;
            </p>
          </Section>
        )}

        {/* PRIVATE — At Risk */}
        {script.at_risk.length > 0 && (
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Private
              </span>
              <span className="text-xs text-gray-400">
                Don&apos;t mention in meeting
              </span>
            </div>
            {script.at_risk.map((rep, idx) => (
              <p key={idx} className="text-sm text-gray-600">
                {rep.name} &mdash; {rep.signal}. Consider a check-in.
              </p>
            ))}
          </div>
        )}

        {/* NUMBERS */}
        <Section title="NUMBERS" timeBadge="">
          <p className="text-gray-700">
            Completion: {script.numbers.completion_rate}% this week (
            {formatDelta(script.numbers.delta)} vs last week).
          </p>
          {script.benchmark && (
            <p className="text-gray-700 mt-1">
              Rank: #{script.benchmark.rank} of {script.benchmark.total}{' '}
              {script.benchmark.brand} stores.
            </p>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  timeBadge,
  children,
}: {
  title: string;
  timeBadge: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
          {title}
        </span>
        {timeBadge && (
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            {timeBadge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function formatScriptDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}%`;
  if (delta < 0) return `${delta}%`;
  return '0%';
}
