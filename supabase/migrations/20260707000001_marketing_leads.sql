-- Marketing lead capture from the public landing page (/api/leads).
-- Pre-signup prospects — intentionally NOT tenant-scoped (no dealership_id).
-- RLS enabled with NO policies: anon/authenticated clients get zero access;
-- only the service role (which bypasses RLS) reads/writes via the API route.
-- Applied to prod via Supabase MCP 2026-07-07.

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  dealership_name text not null,
  team_size text,
  role text,
  notes text,
  source text not null default 'landing_page'
);

alter table public.marketing_leads enable row level security;

create index if not exists idx_marketing_leads_created_at
  on public.marketing_leads (created_at desc);
