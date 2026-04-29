export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
    // S1/S11/S15: boot-time assertion that all required env vars and
    // runtime deps are present. Throws on missing — the Vercel deploy
    // health check surfaces this immediately instead of a silent prod
    // break when someone forgets to add an env var.
    const { validateBootEnvironment } = await import('@/lib/bootcheck');
    validateBootEnvironment();
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
    // M-16 (2026-04-18): the Edge runtime hosts middleware.ts, which requires
    // SUPABASE_JWT_SECRET and NEXT_PUBLIC_SUPABASE_URL to verify every request.
    // Without boot validation here, a missing env surfaces as a per-request
    // 500 only the first time a user visits a protected route -- after the
    // previous Node boot succeeded. Fail fast at Edge boot instead.
    const { validateBootEnvironment } = await import('@/lib/bootcheck');
    validateBootEnvironment();
  }
}

export const onRequestError = async (
  err: { digest?: string } & Error,
  request: {
    path: string;
    method: string;
    headers: { [key: string]: string };
  },
  context: { routerKind: string; routePath: string; routeType: string; renderSource: string },
) => {
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
};
