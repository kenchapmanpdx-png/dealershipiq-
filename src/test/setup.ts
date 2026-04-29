// Vitest global setup
// Ensure env vars don't leak from test environment

// Stub required env vars for modules that read them at import time
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.SINCH_SERVICE_PLAN_ID = 'test-sinch-plan';
process.env.SINCH_API_TOKEN = 'test-sinch-token';
process.env.SINCH_PHONE_NUMBER = '+10000000000';
process.env.SINCH_WEBHOOK_SECRET = 'test-webhook-secret';
// 2026-04-18 L-19: Prefix every fake secret with `unit_fake_0000` so secret
// scanners (gitleaks, trufflehog, Stripe's own scanner) see a pattern that
// obviously does NOT match a live Stripe key. Previously the `sk_test_fake`
// literal tripped scanners during CI and triggered noisy Slack alerts.
process.env.STRIPE_SECRET_KEY = 'sk_test_unit_fake_0000';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_unit_fake_0000';
process.env.STRIPE_PRICE_ID = 'price_test_unit_fake_0000';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.APP_TOKEN_SECRET = 'test-app-token-secret-at-least-32-chars-long';
process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
