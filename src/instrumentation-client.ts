import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session Replay: capture 5% of sessions, 100% on error
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration(),
    Sentry.browserTracingIntegration(),
  ],

  // Filter noisy errors
  ignoreErrors: [
    // Browser extensions & benign network errors
    'ResizeObserver loop',
    'Non-Error promise rejection captured',
    /Loading chunk \d+ failed/,
    'Network request failed',
  ],

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
});

// Instrument client-side navigations for performance tracing
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
