-- Stayful Intelligence — initial schema
-- Run this in the Supabase SQL editor for a fresh project.

-- =========================
-- profiles
-- =========================
-- Extends auth.users. One row per user, created on signup.
-- Access model: 5 free reports from sign-up (tracked in reports_run); after
-- that, plan must be 'pro' (driven by Stripe subscription) for hasAccess()
-- to return true. trial_ends_at is retained for the Monday CRM mirror only.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  mobile text,
  plan text not null default 'free',                  -- 'free' | 'pro'
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,                    -- 'trialing' | 'active' | 'past_due' | 'canceled' | ...
  -- Monday "Trial signups" CRM mirror — itemId of the row that
  -- represents this user on the trial board (null until first push,
  -- and until MONDAY_TRIAL_BOARD_ID env vars are configured).
  monday_item_id text,
  -- Server-of-truth counters for trial usage. Monday is a mirror.
  reports_run integer not null default 0,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotent: catch up existing tables from earlier schema revisions.
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists mobile text;
alter table public.profiles add column if not exists monday_item_id text;
alter table public.profiles add column if not exists reports_run integer not null default 0;
alter table public.profiles add column if not exists last_seen_at timestamptz;

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user is created.
-- Pulls full_name and mobile out of raw_user_meta_data — these are set
-- by signupAction via supabase.auth.signUp({ options: { data: {...} } }).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, mobile)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'mobile', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================
-- saved_searches
-- =========================
create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  address text not null,
  guest_count integer not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists saved_searches_user_id_created_at_idx
  on public.saved_searches (user_id, created_at desc);

alter table public.saved_searches enable row level security;

drop policy if exists "Users can manage own searches" on public.saved_searches;
create policy "Users can manage own searches"
  on public.saved_searches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================
-- Market Explorer: goal profile + watchlist
-- =========================
-- market_goals holds the user's questionnaire answers (see
-- src/lib/market/goals.ts for the shape). Editable any time; drives the
-- personalised "Your fit" score. The "Users can update own profile" policy
-- above already covers writes.
alter table public.profiles add column if not exists market_goals jsonb;
alter table public.profiles add column if not exists market_goals_updated_at timestamptz;

create table if not exists public.saved_areas (
  user_id uuid not null references public.profiles(id) on delete cascade,
  postcode_area text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, postcode_area)
);

alter table public.saved_areas enable row level security;

drop policy if exists "Users can manage own saved areas" on public.saved_areas;
create policy "Users can manage own saved areas"
  on public.saved_areas for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================
-- Market Explorer: weekly trend alerts
-- =========================
-- alert_weekly: opt-in (default on) for the weekly digest about saved areas.
-- saved_areas.last_alerted_* remember what the last digest said so the next
-- one only reports changes (a flipped enquiry trend or a confidence tier
-- crossing into Confirmed).
alter table public.profiles add column if not exists alert_weekly boolean not null default true;
alter table public.saved_areas add column if not exists last_alerted_direction text;
alter table public.saved_areas add column if not exists last_alerted_tier text;
alter table public.saved_areas add column if not exists last_alerted_at timestamptz;

-- =========================
-- Data broker: shared cache + spend ledger (service role only)
-- =========================
-- broker_cache holds every paid answer keyed by question + params so the
-- same postcode / grid cell / listing is never bought twice inside its TTL.
-- provider_calls records every call (cache hits included) so daily budgets
-- per provider and per member can be enforced and spend shown on /admin.
create table if not exists public.broker_cache (
  question text not null,
  key text not null,
  value jsonb not null,
  provider text not null,
  level int not null default 1,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (question, key)
);
alter table public.broker_cache enable row level security;

create table if not exists public.provider_calls (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  provider text not null,
  question text not null,
  key text,
  cost_pence int not null default 0,
  cache_hit boolean not null default false,
  user_id uuid,
  ok boolean not null default true,
  ms int
);
create index if not exists provider_calls_at_provider_idx on public.provider_calls (at desc, provider);
create index if not exists provider_calls_user_at_idx on public.provider_calls (user_id, at desc);
alter table public.provider_calls enable row level security;

-- =========================
-- Listing links: snapshots + a member's checked listings
-- =========================
-- listing_snapshots: one parsed snapshot per canonical listing URL, shared by
-- every member who pastes it (typed fields only, never page HTML).
create table if not exists public.listing_snapshots (
  canonical_url text primary key,
  source text not null,
  snapshot jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.listing_snapshots enable row level security;

-- checked_listings: a member's own list of listings they have looked at,
-- with the quick figures, deal maths and (later) pipeline status.
create table if not exists public.checked_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canonical_url text not null,
  source text not null,
  kind text not null,
  postcode text,
  postcode_area text,
  lat double precision,
  lng double precision,
  snapshot jsonb not null,
  quick_estimate jsonb,
  deal jsonb,
  status text not null default 'watching',
  notes text,
  price_history jsonb not null default '[]'::jsonb,
  listing_status text,
  share_token text unique,
  last_checked_at timestamptz,
  analysed_report_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_url)
);
create index if not exists checked_listings_user_idx on public.checked_listings (user_id, updated_at desc);
alter table public.checked_listings enable row level security;
drop policy if exists "Users can manage own checked listings" on public.checked_listings;
create policy "Users can manage own checked listings"
  on public.checked_listings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Report history: every full analysis is kept so it can be reopened.
alter table public.saved_searches add column if not exists postcode text;
alter table public.saved_searches add column if not exists postcode_area text;
alter table public.saved_searches add column if not exists bedrooms int;
alter table public.saved_searches add column if not exists kind text;
alter table public.saved_searches add column if not exists source_listing jsonb;
alter table public.saved_searches add column if not exists deal jsonb;
alter table public.saved_searches add column if not exists checked_listing_id uuid;

-- =========================
-- Listing re-checks + deal sourcing (PR 1.3)
-- =========================
-- rechecked_at: when the daily re-check cron last looked at the listing.
-- Kept apart from last_checked_at (a member's own resolve) so the cron never
-- counts against the member's daily resolve cap. price_history entries are
-- { at, amount, period, status, notified } — notified flips once the change
-- has been emailed, so a failed send is retried next run rather than lost.
alter table public.checked_listings add column if not exists rechecked_at timestamptz;
create index if not exists checked_listings_recheck_idx on public.checked_listings (rechecked_at nulls first, last_checked_at);

-- sourcing_alerts: opt-in (default OFF) for the daily deal-sourcing email.
-- sourcing_last_sent_at: when the last sourcing email went out.
alter table public.profiles add column if not exists sourcing_alerts boolean not null default false;
alter table public.profiles add column if not exists sourcing_last_sent_at timestamptz;

-- sourced_listings: every listing a sourcing query has ever surfaced, so
-- "new since last run" is a simple first_seen_at comparison.
create table if not exists public.sourced_listings (
  canonical_url text primary key,
  source text not null,
  kind text not null,
  query_key text not null,
  postcode_area text,
  snapshot jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists sourced_listings_seen_idx on public.sourced_listings (first_seen_at desc);
alter table public.sourced_listings enable row level security;

-- sourcing_sent: which listings each member has already been emailed.
create table if not exists public.sourcing_sent (
  user_id uuid not null references public.profiles(id) on delete cascade,
  canonical_url text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, canonical_url)
);
alter table public.sourcing_sent enable row level security;
