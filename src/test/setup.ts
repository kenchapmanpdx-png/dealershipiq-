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
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake';
process.env.STRIPE_PRICE_ID = 'price_test_fake';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.ADMIN_API_KEY = 'test-admin-key';
process.env.APP_TOKEN_SECRET = 'test-app-token-secret-at-least-32-chars-long';
process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000';
