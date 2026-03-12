// Three Doors entry — Coach Mode initial selection
// Phase 4.5A

'use client';

import type { CoachDoor } from '@/types/coach';

interface ThreeDoorsProps {
  firstName: string;
  tenureDescription: string;
  dealershipName: string;
  onSelectDoor: (door: CoachDoor) => void;
  showConfidentiality?: boolean;
}

export default function ThreeDoors({
  firstName,
  tenureDescription,
  dealershipName,
  onSelectDoor,
  showConfidentiality = false,
}: ThreeDoorsProps) {
  return (
    <div className="flex flex-col items-center px-4 py-8">
      <p className="text-gray-700 text-center mb-8 text-lg">
        Hey {firstName}. {tenureDescription} at {dealershipName} — how&apos;s the floor treating you?
      </p>

      <div className="w-full max-w-sm space-y-3">
        <button
          onClick={() => onSelectDoor('tactical')}
          className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-blue-300 hover:bg-blue-50 transition text-left shadow-sm"
        >
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <circle cx="12" cy="12" r="3" strokeWidth={2} />
              <path strokeLinecap="round" strokeWidth={2} d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </div>
          <span className="text-gray-900 font-medium">Get sharper at something</span>
        </button>

        <button
          onClick={() => onSelectDoor('debrief')}
          className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-blue-300 hover:bg-blue-50 transition text-left shadow-sm"
        >
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <span className="text-gray-900 font-medium">Talk through something</span>
        </button>

        <button
          onClick={() => onSelectDoor('career')}
          className="w-full flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-5 py-4 hover:border-blue-300 hover:bg-blue-50 transition text-left shadow-sm"
        >
          <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
          </div>
          <span className="text-gray-900 font-medium">What&apos;s ahead for me</span>
        </button>
      </div>

      {showConfidentiality && (
        <p className="text-xs text-gray-400 mt-6 text-center max-w-xs">
          Everything here is private. Your manager can&apos;t see what you say.
        </p>
      )}
    </div>
  );
}
