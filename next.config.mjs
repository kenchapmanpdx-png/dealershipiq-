import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};

export default withSentryConfig(nextConfig, {
  // Upload source maps for better stack traces
  silent: !process.env.CI,

  // Org & project slugs from Sentry
  org: 'dealershipiq',
  project: 'dealershipiq-nextjs',

  // Automatically tree-shake Sentry logger in production
  disableLogger: true,

  // Hide source maps from the client bundle
  hideSourceMaps: true,

  // Widen scope of uploaded source maps
  widenClientFileUpload: true,

  // Tunnel Sentry events through a Next.js rewrite to avoid ad-blockers
  tunnelRoute: '/monitoring',
});
