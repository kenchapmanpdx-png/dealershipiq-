import * as Sentry from '@sentry/nextjs';

// 2026-04-18 M-2: Server Sentry PII scrubber. Without this, captured
// request events can ship `authorization` headers, `x-admin-key`,
// `x-worker-secret`, `x-sinch-*` webhook signatures, raw Sinch payload
// bodies (with phone numbers + message content), and Supabase session
// cookies. Scrubbing happens BEFORE events leave the server.

type SentryEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-admin-key',
  'x-worker-secret',
  'x-internal-worker',
  'x-sinch-signature',
  'x-sinch-webhook-token',
  'stripe-signature',
  'x-supabase-auth',
]);

function scrubEvent(event: SentryEvent): SentryEvent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const request = event.request as any;
  if (request) {
    if (request.headers && typeof request.headers === 'object') {
      for (const key of Object.keys(request.headers)) {
        if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
          request.headers[key] = '[scrubbed]';
        }
      }
    }
    // Request bodies may contain phone numbers, SMS content, webhook payloads --
    // strip wholesale rather than try to whitelist fields.
    if (request.data !== undefined) {
      request.data = '[scrubbed]';
    }
    if (request.cookies) {
      request.cookies = '[scrubbed]';
    }
    if (request.query_string && typeof request.query_string === 'string') {
      request.query_string = request.query_string.length > 0 ? '[scrubbed]' : '';
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

  // M-2: do not attach server IP / cookies by default.
  sendDefaultPii: false,

  // Performance: sample 10% of transactions in production
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // M-2: strip sensitive headers + request bodies from every event.
  beforeSend: scrubEvent,

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
});
