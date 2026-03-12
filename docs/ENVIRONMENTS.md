# Environments

## Production
- URL: https://dealershipiq-wua7.vercel.app
- Branch: main
- Stripe: Live keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID)
- Supabase: Production project (nnelylyialhnyytfeoom)
- Sinch: Production number (when upgraded from trial)

## Staging (Future)
- URL: TBD — Vercel preview deployments from `staging` branch
- Branch: staging
- Stripe: Test keys (STRIPE_SECRET_KEY with sk_test_ prefix)
- Supabase: Same project, different schema prefix or separate project
- Sinch: Test number

## Environment Variables Required

### Existing
| Variable | Where | Notes |
|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Vercel | Public |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Vercel | Public |
| SUPABASE_SERVICE_ROLE_KEY | Vercel | Secret |
| OPENAI_API_KEY | Vercel | Secret |
| SINCH_SERVICE_PLAN_ID | Vercel | Secret |
| SINCH_API_TOKEN | Vercel | Secret |
| SINCH_PHONE_NUMBER | Vercel | Secret |
| SINCH_WEBHOOK_SECRET | Vercel | Secret |
| CRON_SECRET | Vercel | Secret |
| NEXT_PUBLIC_APP_URL | Vercel | Public |

### Phase 5 (New)
| Variable | Where | Notes |
|---|---|---|
| STRIPE_SECRET_KEY | Vercel | Secret — sk_live_ or sk_test_ |
| STRIPE_WEBHOOK_SECRET | Vercel | Secret — whsec_ from Stripe dashboard |
| STRIPE_PRICE_ID | Vercel | Secret — price_ from Stripe product |
| RESEND_API_KEY | Vercel | Secret — for dunning emails |

## Ken Manual Steps (Phase 5)

1. Create Stripe product + price ($449/month recurring) in Stripe Dashboard
2. Copy price_id → set STRIPE_PRICE_ID in Vercel
3. Create Stripe webhook endpoint → https://dealershipiq-wua7.vercel.app/api/webhooks/stripe
4. Enable events: checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed
5. Copy webhook signing secret → set STRIPE_WEBHOOK_SECRET in Vercel
6. Configure Stripe Customer Portal (branding, cancellation, payment methods)
7. Sign up for Resend → set RESEND_API_KEY in Vercel
8. Verify domain in Resend for billing@dealershipiq.com
9. Set existing pilot dealerships: UPDATE dealerships SET is_pilot = true WHERE id IN (...)
