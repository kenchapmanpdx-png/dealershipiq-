import * as Sentry from '@sentry/nextjs';

// 2026-04-18 M-16: Edge runtime Sentry. Matches the PII scrubbing applied
// on server.config.ts so Edge middleware errors (e.g. auth JWT verify,
// rate-limit breaches, CSP nonce generation) never ship raw cookies,
// webhook signatures, or session tokens to Sentry.

type SentryEvent = Parameters<NonNullable<Parameters<typeof Sentry.init>[0]['beforeSend']>>[0];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-admin-key',
  'x-worker-secret',
  'x-internal-worker',
  'x-sinch-signature',
  'x-sinch-webhook-signature',
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
    if (request.data !== undefined) request.data = '[scrubbed]';
    if (request.cookies) request.cookies = '[scrubbed]';
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

  // M-16: do not attach IPs / cookies by default at the Edge.
  sendDefaultPii: false,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  beforeSend: scrubEvent,

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
});
