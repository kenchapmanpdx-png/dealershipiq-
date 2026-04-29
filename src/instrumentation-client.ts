import * as Sentry from '@sentry/nextjs';

// 2026-04-18 M-1: PII scrubbing for client-side Sentry.
// Session Replay defaults are NOT enough -- explicitly mask all text/inputs
// and block media so captured replays never contain phone numbers,
// last-4 digits, billing info, AI transcripts, or dealership names.
// `sendDefaultPii: false` stops the SDK from auto-attaching user IPs.
// `beforeSend` scrubs auth/cookie/session headers from request events.

type SentryEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0];

function scrubEvent(event: SentryEvent): SentryEvent {
  // Strip sensitive headers if any network event captures them client-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = event.request as any;
  if (request?.headers && typeof request.headers === 'object') {
    const sensitive = ['authorization', 'cookie', 'x-admin-key', 'x-worker-secret', 'x-sinch-signature'];
    for (const key of Object.keys(request.headers)) {
      if (sensitive.includes(key.toLowerCase())) {
        request.headers[key] = '[scrubbed]';
      }
    }
  }

  if (event.user) {
    delete event.user.email;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (event.user as any).phone;
    delete event.user.ip_address;
  }

  return event;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // M-1: do not attach browser IP / cookies by default.
  sendDefaultPii: false,

  // Performance: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session Replay: capture 5% of sessions, 100% on error
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    // M-1: mask ALL text and inputs; block ALL media. Captured replays
    // should never contain phone numbers, last-4s, transcripts, names.
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // M-1: strip sensitive headers and user PII before events leave browser.
  beforeSend: scrubEvent,

  // Filter noisy errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error promise rejection captured',
    /Loading chunk \d+ failed/,
    'Network request failed',
  ],

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
});

// Instrument client-side navigations for performance tracing
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
