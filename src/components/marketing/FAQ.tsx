'use client';

import { useState } from 'react';

interface FAQItem {
  q: string;
  a: string;
}

export default function FAQ({ items }: { items: FAQItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((faq, i) => {
        const isOpen = openIndex === i;
        return (
          <button
            key={i}
            onClick={() => setOpenIndex(isOpen ? null : i)}
            className="w-full text-left glass rounded-xl p-5 sm:p-6 transition-all duration-300 ease-out-cubic hover:border-[var(--border-hover)] group"
            aria-expanded={isOpen}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-sm font-semibold text-white group-hover:text-[var(--accent-hover)] transition-colors duration-300">
                {faq.q}
              </h3>
              <div
                className="flex-shrink-0 w-6 h-6 rounded-full border border-white/10 flex items-center justify-center transition-all duration-300"
                style={{
                  transform: isOpen ? 'rotate(45deg)' : 'rotate(0)',
                  borderColor: isOpen ? 'var(--accent)' : undefined,
                }}
              >
                <svg
                  className="w-3 h-3 text-[var(--text-muted)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
            </div>
            <div
              className="overflow-hidden transition-all duration-500 ease-out-cubic"
              style={{
                maxHeight: isOpen ? '200px' : '0px',
                opacity: isOpen ? 1 : 0,
                marginTop: isOpen ? '12px' : '0px',
              }}
            >
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed pr-10">
                {faq.a}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
