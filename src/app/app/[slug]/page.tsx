// Ask IQ tab — Product facts, spec lookup
// Placeholder for MVP — Coach Mode is the primary deliverable
// Phase 4.5A

'use client';

export default function AskIQPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Ask IQ</h2>
      <p className="text-gray-600 max-w-xs">
        Quick product facts and spec lookups. Coming soon — tap the Coach tab to get started with AI coaching.
      </p>
    </div>
  );
}
