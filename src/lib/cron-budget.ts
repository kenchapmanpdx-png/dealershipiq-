// Cron timeout budget helper — prevents Vercel from force-killing a cron mid-loop.
//
// Usage:
//   const budget = createBudget({ maxMs: 55_000, safetyBufferMs: 10_000 });
//   for (const item of items) {
//     if (budget.shouldStop()) break;
//     await process(item);
//   }
//   return NextResponse.json({ processed: budget.processed, ...budget.report() });
//
// Vercel free tier = 10s, Pro = 60s, Enterprise up to 900s. `maxMs` should be
// set to ~90% of the route's declared `maxDuration` to leave room for cleanup.

import { log } from '@/lib/logger';

export interface BudgetOptions {
  maxMs: number;
  safetyBufferMs?: number;
  cronName: string;
}

export interface Budget {
  startedAt: number;
  elapsedMs(): number;
  remainingMs(): number;
  shouldStop(): boolean;
  markProcessed(): void;
  markSkipped(): void;
  report(): {
    cron_name: string;
    elapsed_ms: number;
    processed: number;
    skipped: number;
    partial: boolean;
  };
}

export function createBudget(opts: BudgetOptions): Budget {
  const startedAt = Date.now();
  const safety = opts.safetyBufferMs ?? 10_000;
  let processed = 0;
  let skipped = 0;
  let stopped = false;

  return {
    startedAt,
    elapsedMs() {
      return Date.now() - startedAt;
    },
    remainingMs() {
      return Math.max(0, opts.maxMs - (Date.now() - startedAt));
    },
    shouldStop() {
      if (stopped) return true;
      const elapsed = Date.now() - startedAt;
      if (elapsed + safety > opts.maxMs) {
        if (!stopped) {
          log.warn('cron.budget.stop', {
            cron_name: opts.cronName,
            elapsed_ms: elapsed,
            max_ms: opts.maxMs,
            processed,
            skipped,
          });
        }
        stopped = true;
        return true;
      }
      return false;
    },
    markProcessed() {
      processed++;
    },
    markSkipped() {
      skipped++;
    },
    report() {
      return {
        cron_name: opts.cronName,
        elapsed_ms: Date.now() - startedAt,
        processed,
        skipped,
        partial: stopped,
      };
    },
  };
}
