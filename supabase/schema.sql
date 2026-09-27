-- Stayful Intelligence — initial schema
-- Run this in the Supabase SQL editor for a fresh project.

-- =========================
-- profiles
-- =========================
-- Extends auth.users. One row per user, created on signup.
-- Access model: 5 free reports from sign-up (tracked in reports_run); after
-- that the account needs a subscription for hasAccess() to return true.
-- trial_ends_at is retained for the Monday CRM mirror only.
--
-- IMPORTANT: "is this a paying customer?" is derived from BOTH `plan` and
-- `stripe_subscription_status` (see src/lib/access.ts → accountStatus). A live
-- Stripe status wins over the plan column, so a customer whose plan write
-- failed is never mistaken for a free-trial user.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  mobile text,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
  -- On the live project from before this file tracked it; nothing in this app reads it.
  trial_started_at timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_subscription_status text,                    -- 'trialing' | 'active' | 'past_due' | 'canceled' | ...
  -- How the plan was granted: 'stripe' (webhook) or 'manual' (subscription
  -- arranged by hand and set in the dashboard). Lets a manually granted plan
  -- be told apart from one Stripe is keeping in sync.
  plan_source text,                                   -- 'stripe' | 'manual' | null
  subscription_started_at timestamptz,
  subscription_ended_at timestamptz,
  -- Monday "Trial signups" CRM mirror — itemId of the row that
  -- represents this user on the trial board (null until first push,
  -- and until MONDAY_TRIAL_BOARD_ID env vars are configured).
  monday_item_id text,
  -- Server-of-truth counters for trial usage. Monday is a mirror.
  -- reports_run is the FREE-TRIAL allowance counter and only advances while
  -- the account is on the free trial. reports_total counts every report ever
  -- run, subscribers included — use it for usage reporting, never for gating.
  reports_run integer not null default 0,
  reports_total integer not null default 0,
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
-- Declared in the create-table block above but never given a catch-up alter, so
-- it is missing on any project created before it was added. The column grants
-- further down name it, and `grant update (...)` errors on a column that does
-- not exist — which would take the whole permission change down with it.
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles add column if not exists reports_total integer not null default 0;
alter table public.profiles add column if not exists plan_source text;
alter table public.profiles add column if not exists subscription_started_at timestamptz;
alter table public.profiles add column if not exists subscription_ended_at timestamptz;
alter table public.profiles add column if not exists trial_started_at timestamptz not null default now();

-- The Stripe webhook falls back to matching a payment by email when it has no
-- user id, and does so case-insensitively. Index the lowered email so that
-- lookup stays cheap.
create index if not exists profiles_email_lower_idx
  on public.profiles (lower(email));

-- Match subscription.* events straight back to a profile.
create index if not exists profiles_stripe_subscription_id_idx
  on public.profiles (stripe_subscription_id);
create index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id);

-- Seed the new all-time counter from the historic trial counter, which until
-- now advanced for every user. Safe to re-run — it never lowers a value.
update public.profiles
   set reports_total = greatest(coalesce(reports_total, 0), coalesce(reports_run, 0))
 where coalesce(reports_total, 0) < coalesce(reports_run, 0);

-- ---------------------------------------------------------------
-- Repair: paying customers stuck on plan='free'
-- ---------------------------------------------------------------
-- Anyone Stripe reports as live but whose plan column never flipped was being
-- treated as a free-trial user (and shown "you have N free reports left").
-- Safe to re-run.
update public.profiles
   set plan = 'pro',
       plan_source = coalesce(plan_source, 'stripe'),
       subscription_ended_at = null
 where plan is distinct from 'pro'
   and stripe_subscription_status in ('active', 'trialing', 'past_due');

-- Mark plans that exist without any Stripe record as manually granted, so
-- they're not mistaken for stale webhook state.
update public.profiles
   set plan_source = 'manual'
 where plan = 'pro'
   and plan_source is null
   and stripe_subscription_id is null
   and stripe_subscription_status is null;

-- `plan` only ever holds 'free' or 'pro' (the paid tier is plan_code). The
-- check is inline in the create-table block above; this adds it to a table
-- created before it was.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_plan_check') then
    alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'pro'));
  end if;
end $$;

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- On the live project from before this file tracked it. Every row is made by
-- the on_auth_user_created trigger below, so the primary key refuses a
-- member's own insert unless their row is missing.
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

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

-- sourcing_alerts: the daily pick email. Shipped opt-in (default OFF); the
-- "Daily picks" section at the end of this file flips the default to ON and
-- backfills. sourcing_last_sent_at: when the last pick went out (informational;
-- the cron's one-a-day guard reads sourcing_sent, not this).
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

-- =========================
-- Browser extension: scoped tokens (Part 2)
-- =========================
-- A member connects the Stayful browser extension from /extension/connect,
-- which mints a random token and stores only its SHA-256 hash here. The
-- extension sends the raw token as a Bearer header to /api/ext/*; revoking
-- sets revoked_at and the token stops working immediately.
create table if not exists public.extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists extension_tokens_user_idx on public.extension_tokens (user_id, created_at desc);
alter table public.extension_tokens enable row level security;
drop policy if exists "Users can read own extension tokens" on public.extension_tokens;
create policy "Users can read own extension tokens"
  on public.extension_tokens for select
  using (auth.uid() = user_id);

-- =========================
-- Self-serve plan management: pause / cancel
-- =========================
-- Pause is a WINDOW, not a flag, and both ends mirror Stripe:
--
--   subscription_paused_from   the current period end at the moment they hit
--                              pause. The member keeps the time they already
--                              paid for; the pause bites afterwards.
--   subscription_paused_until  pause_collection.resumes_at.
--
-- Access is withheld only BETWEEN the two (see src/lib/access.ts -> isPaused).
-- Because it is a time comparison rather than a stored boolean, an auto-resume
-- heals itself on the next page read even if the resume webhook never lands —
-- nothing here needs a cron.
--
-- subscription_cancel_at mirrors Stripe's cancel_at, set by cancel_at_period_end.
-- The member keeps full access until then and can undo it.
alter table public.profiles add column if not exists subscription_paused_from timestamptz;
alter table public.profiles add column if not exists subscription_paused_until timestamptz;
alter table public.profiles add column if not exists subscription_cancel_at timestamptz;
alter table public.profiles add column if not exists subscription_current_period_end timestamptz;
-- What the cancel retention flow captured. Reporting only, never gating.
alter table public.profiles add column if not exists cancel_reason text;
alter table public.profiles add column if not exists cancel_reason_comment text;
alter table public.profiles add column if not exists cancel_reason_at timestamptz;

-- ---------------------------------------------------------------
-- Lock the billing columns to the service role
-- ---------------------------------------------------------------
-- "Users can update own profile" above has no column restriction, so until now
-- any signed-in member could `update profiles set plan = 'pro'` with the anon
-- key — or reset reports_run to zero for endless free reports. Shipping a
-- self-serve billing UI makes that the obvious thing to try.
--
-- Column-level grants fail closed: anything not listed here simply cannot be
-- written by a user session, whoever they are. Every column a user session
-- legitimately writes is listed; billing and usage counters deliberately are
-- not, and are written only by the webhook and the /account server actions via
-- the service-role client. Adding a user-writable column later means adding it
-- to this list.
-- sourcing_opted_out_at: set when a member turns daily picks off (goals
-- modal, /picks toggle or the unsubscribe link), cleared when they turn them
-- back on. Declared here, above the grant, because the grant names it: a
-- grant on a column that does not exist fails the whole statement.
alter table public.profiles add column if not exists sourcing_opted_out_at timestamptz;
revoke update on public.profiles from anon, authenticated;
grant update (
  full_name,
  mobile,
  monday_item_id,
  last_seen_at,
  market_goals,
  market_goals_updated_at,
  alert_weekly,
  sourcing_alerts,
  sourcing_last_sent_at,
  sourcing_opted_out_at,
  updated_at
) on public.profiles to authenticated;

-- The update policy had no `with check`, so a row could be re-pointed at
-- another user id. Re-create it with both halves.
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- =========================
-- Credit billing (usage-based, Claude-style)
-- =========================
-- Every paid provider call is priced in BASE pence (raw cost × base markup)
-- and debited from the member's credit grants in priority order:
--   plan (subscription, expires at cycle end) → welcome → top-up / adjustment.
-- Each grant carries a spend_rate frozen at creation: plan and welcome
-- credit spend at 1.0 (×5 overall), top-ups / promo / referral / admin
-- adjustments at 1.5 (×7.5 overall). Displayed balances are always grant
-- pence (what was paid); sufficiency checks use "spendable base pence" =
-- Σ remaining ÷ spend_rate minus open reservations.
-- All mutations go through the security-definer functions below, which take
-- the member's profile row lock first, so reserve / debit / grant / refund
-- serialise per member. Called via the service role only.

-- ── Plans (Stripe price ids live in env, not here) ──
create table if not exists public.billing_plans (
  code text primary key,                    -- 'starter' | 'pro' | 'scale' | 'pro_annual'
  name text not null,
  price_pence int not null,
  interval text not null,                   -- 'month' | 'year'
  monthly_credit_pence int not null,
  perks jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  active boolean not null default true
);
alter table public.billing_plans add column if not exists perks jsonb not null default '{}'::jsonb;
insert into public.billing_plans (code, name, price_pence, interval, monthly_credit_pence, perks, sort) values
  ('starter',    'Starter',      1900,  'month', 1900,  '{"sourcingCadence":"daily","priorityRefresh":false,"phoneSupport":false,"quarterlyBriefing":false}', 1),
  ('pro',        'Pro',          3999,  'month', 5000,  '{"sourcingCadence":"daily","priorityRefresh":true,"phoneSupport":false,"quarterlyBriefing":false}', 2),
  ('scale',      'Scale',        9900,  'month', 14000, '{"sourcingCadence":"daily","priorityRefresh":true,"phoneSupport":true,"quarterlyBriefing":true}', 3),
  ('pro_annual', 'Pro (annual)', 36000, 'year',  5000,  '{"sourcingCadence":"daily","priorityRefresh":true,"phoneSupport":false,"quarterlyBriefing":true}', 4)
on conflict (code) do update set
  name = excluded.name, price_pence = excluded.price_pence, interval = excluded.interval,
  monthly_credit_pence = excluded.monthly_credit_pence, perks = excluded.perks, sort = excluded.sort;
-- Daily picks for every plan. The seed above covers the four known rows; this
-- catches any other row (a plan added by hand) that still says weekly. The DB
-- row overrides src/lib/credit/perks.ts, so without this the live site would
-- keep advertising the old cadence.
update public.billing_plans
   set perks = coalesce(perks, '{}'::jsonb) || '{"sourcingCadence":"daily"}'::jsonb
 where coalesce(perks->>'sourcingCadence', '') <> 'daily';
alter table public.billing_plans enable row level security;
drop policy if exists "Signed-in users can read plans" on public.billing_plans;
create policy "Signed-in users can read plans" on public.billing_plans for select to authenticated using (true);

-- ── Unit costs: one row per (provider, unit); seeded from src/lib/credit/costs.ts, edited on /admin/billing ──
create table if not exists public.unit_costs (
  provider text not null,
  unit text not null,
  label text not null,
  unit_cost_pence numeric(16,8) not null default 0,   -- our real cost per unit (8 places: per-token and per-character prices)
  markup numeric(6,2) not null default 5,             -- base charge = unit_cost × markup
  notes text,
  updated_at timestamptz not null default now(),
  updated_by text,
  primary key (provider, unit)
);
alter table public.unit_costs enable row level security;   -- no policies: service role only (raw costs never reach a browser)

-- ── Small key/value settings ──
create table if not exists public.billing_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.billing_settings enable row level security;
insert into public.billing_settings (key, value) values
  ('welcome_grant_pence', '2000'),
  ('low_balance_ratio', '0.8'),
  ('base_markup', '5'),
  -- Multiplier for white-label funnel leads (see src/lib/credit/costs.ts).
  -- Kept apart from base_markup so repricing leads cannot reprice the
  -- members-only analyser by accident.
  ('funnel_markup', '2'),
  ('spend_rates', '{"plan":1,"welcome":1,"topup":1.5,"adjustment":1.5}'),
  ('topup_presets_pence', '[1000,2500,5000]'),
  ('referral_pence', '1000')
on conflict (key) do nothing;

-- ── Credit buckets ──
create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                       -- 'plan' | 'welcome' | 'topup' | 'adjustment'
  priority smallint not null,               -- consumption order: plan=1, welcome=2, topup/adjustment=3
  amount_pence numeric(14,4) not null,
  remaining_pence numeric(14,4) not null,
  spend_rate numeric(4,2) not null default 1, -- grant pence consumed per base penny
  expires_at timestamptz,                   -- plan grants only; null = never
  source_ref text,                          -- 'inv:<stripe invoice>' | 'pi:<payment intent>' | 'welcome:<user>' | 'code:<code>:<user>' | ...
  description text,
  created_at timestamptz not null default now()
);
create unique index if not exists credit_grants_source_ref_uidx on public.credit_grants (source_ref) where source_ref is not null;
create index if not exists credit_grants_consume_idx on public.credit_grants (user_id, priority, expires_at, created_at) where remaining_pence > 0;
create index if not exists credit_grants_user_idx on public.credit_grants (user_id, created_at desc);
alter table public.credit_grants enable row level security;
drop policy if exists "Users can read own credit grants" on public.credit_grants;
create policy "Users can read own credit grants" on public.credit_grants for select using (auth.uid() = user_id);

-- ── Append-only ledger (the usage page) ──
create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,                       -- 'grant' | 'debit' | 'refund' | 'expire' | 'adjust'
  amount_pence numeric(14,4) not null,      -- grant pence moved: + in, − out
  base_pence numeric(14,4),                 -- the ×5 charge (debits / refunds)
  grant_id uuid references public.credit_grants(id),
  action_id uuid,                           -- groups every debit of one report / quick view / narration
  action text,                              -- 'report' | 'quick_view' | 'narrate' | 'speak' | 'autocomplete' | 'geocode' | 'cron:sourcing' ...
  provider text,
  unit text,
  quantity numeric(14,4),
  unit_cost_pence numeric(16,8),
  markup numeric(6,2),
  raw_cost_pence numeric(14,4),
  description text,
  provider_call_id bigint,
  metadata jsonb
);
create index if not exists credit_transactions_user_at_idx on public.credit_transactions (user_id, at desc);
create index if not exists credit_transactions_action_idx on public.credit_transactions (action_id) where action_id is not null;
alter table public.credit_transactions enable row level security;
drop policy if exists "Users can read own credit transactions" on public.credit_transactions;
create policy "Users can read own credit transactions" on public.credit_transactions for select using (auth.uid() = user_id);

-- ── Which grant(s) a debit consumed, at what rate ──
create table if not exists public.credit_allocations (
  transaction_id bigint not null references public.credit_transactions(id) on delete cascade,
  grant_id uuid not null references public.credit_grants(id),
  base_pence numeric(14,4) not null,
  grant_pence numeric(14,4) not null,
  spend_rate numeric(4,2) not null,
  primary key (transaction_id, grant_id)
);
create index if not exists credit_allocations_grant_idx on public.credit_allocations (grant_id);
alter table public.credit_allocations enable row level security;
drop policy if exists "Users can read own credit allocations" on public.credit_allocations;
create policy "Users can read own credit allocations" on public.credit_allocations for select
  using (exists (select 1 from public.credit_transactions t where t.id = transaction_id and t.user_id = auth.uid()));

-- ── Holds for in-flight multi-call actions (base pence) ──
create table if not exists public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  action_id uuid not null,
  max_base_pence numeric(14,4) not null,
  settled_base_pence numeric(14,4) not null default 0,
  status text not null default 'open',      -- 'open' | 'released'
  created_at timestamptz not null default now(),
  expires_at timestamptz not null           -- expired opens are ignored by credit_available
);
create index if not exists credit_reservations_open_idx on public.credit_reservations (user_id) where status = 'open';
alter table public.credit_reservations enable row level security;
drop policy if exists "Users can read own credit reservations" on public.credit_reservations;
create policy "Users can read own credit reservations" on public.credit_reservations for select using (auth.uid() = user_id);

-- ── Stripe webhook idempotency ──
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.stripe_events enable row level security;

-- ── Promo / referral codes ──
create table if not exists public.credit_codes (
  code text primary key,                    -- upper-case, no spaces
  kind text not null,                       -- 'promo' | 'referral'
  amount_pence int not null,
  max_redemptions int,                      -- null = unlimited
  redeemed_count int not null default 0,
  expires_at timestamptz,
  owner_user_id uuid references public.profiles(id) on delete cascade,  -- referral codes: who earns the reward
  created_by text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.credit_codes enable row level security;
create table if not exists public.credit_code_redemptions (
  code text not null references public.credit_codes(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table public.credit_code_redemptions enable row level security;
drop policy if exists "Users can read own code redemptions" on public.credit_code_redemptions;
create policy "Users can read own code redemptions" on public.credit_code_redemptions for select using (auth.uid() = user_id);

-- ── profiles: billing columns ──
alter table public.profiles add column if not exists plan_code text;                          -- null = free
alter table public.profiles add column if not exists stripe_price_id text;
alter table public.profiles add column if not exists stripe_default_payment_method_id text;
alter table public.profiles add column if not exists current_period_end timestamptz;
alter table public.profiles add column if not exists cancel_at_period_end boolean not null default false;
alter table public.profiles add column if not exists mobile_key text;                         -- normalised mobile, one welcome grant per number
alter table public.profiles add column if not exists welcome_checked_at timestamptz;
alter table public.profiles add column if not exists welcome_withheld_reason text;
alter table public.profiles add column if not exists auto_topup_amount_pence int;
alter table public.profiles add column if not exists auto_topup_threshold_pence int not null default 500;
-- The £5 default predates funnels and does not even cover ONE worst-case
-- enhanced run (£6.32), let alone the three concurrent ones a live public
-- funnel can produce. £20 does.
--
-- `add column if not exists` never alters an existing column's default, so
-- the change needs its own statement. Existing ROWS are deliberately left
-- alone: re-pointing a customer at a bigger charge than the one they agreed
-- to is not a migration's decision to make.
alter table public.profiles alter column auto_topup_threshold_pence set default 2000;
alter table public.profiles add column if not exists auto_topup_last_at timestamptz;
-- One pre-charge warning per cycle, in the band above the trigger.
alter table public.profiles add column if not exists last_topup_warning_email_at timestamptz;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by_code text;
alter table public.profiles add column if not exists last_low_balance_email_at timestamptz;
alter table public.profiles add column if not exists last_out_of_credit_email_at timestamptz;
alter table public.profiles add column if not exists hit_zero_at timestamptz;
alter table public.profiles add column if not exists last_topup_at timestamptz;
create unique index if not exists profiles_mobile_key_uidx on public.profiles (mobile_key) where mobile_key is not null;
create unique index if not exists profiles_referral_code_uidx on public.profiles (referral_code) where referral_code is not null;

-- ── provider_calls: metering columns (cost_pence stays the raw cost) ──
alter table public.provider_calls add column if not exists unit text;
alter table public.provider_calls add column if not exists quantity numeric(14,4);
alter table public.provider_calls add column if not exists base_pence numeric(14,4) not null default 0;
alter table public.provider_calls add column if not exists charged_pence numeric(14,4) not null default 0;
alter table public.provider_calls add column if not exists billed_user_id uuid;
alter table public.provider_calls add column if not exists action_id uuid;
alter table public.provider_calls add column if not exists bypass boolean not null default false;
create index if not exists provider_calls_billed_user_idx on public.provider_calls (billed_user_id, at desc) where billed_user_id is not null;

-- ── Functions ──

create or replace function public.credit_setting_num(p_key text, p_default numeric)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce((select (value #>> '{}')::numeric from billing_settings where key = p_key), p_default);
$$;

create or replace function public.credit_spend_rate(p_kind text)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce((select (value ->> p_kind)::numeric from billing_settings where key = 'spend_rates'), case when p_kind in ('plan', 'welcome') then 1 else 1.5 end);
$$;

create or replace function public.credit_available(p_user uuid)
returns table (
  plan_pence numeric, welcome_pence numeric, topup_pence numeric, adjustment_pence numeric,
  spendable_base_pence numeric, reserved_base_pence numeric, plan_expires_at timestamptz
)
language sql security definer set search_path = public stable as $$
  with g as (
    select kind, remaining_pence, spend_rate, expires_at
    from credit_grants
    where user_id = p_user and (expires_at is null or expires_at > now())
  ), r as (
    select coalesce(sum(max_base_pence - settled_base_pence), 0) as reserved
    from credit_reservations
    where user_id = p_user and status = 'open' and expires_at > now()
  )
  select
    coalesce(sum(remaining_pence) filter (where kind = 'plan'), 0),
    coalesce(sum(remaining_pence) filter (where kind = 'welcome'), 0),
    coalesce(sum(remaining_pence) filter (where kind = 'topup'), 0),
    coalesce(sum(remaining_pence) filter (where kind = 'adjustment'), 0),
    coalesce(sum(remaining_pence / spend_rate), 0) - (select reserved from r),
    (select reserved from r),
    max(expires_at) filter (where kind = 'plan' and remaining_pence > 0)
  from g;
$$;

create or replace function public.credit_reserve(p_user uuid, p_action text, p_action_id uuid, p_max_base numeric, p_ttl interval default interval '10 minutes')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_spendable numeric;
  v_id uuid;
begin
  perform 1 from profiles where id = p_user for update;
  select spendable_base_pence into v_spendable from credit_available(p_user);
  if coalesce(v_spendable, 0) < p_max_base then
    raise exception 'insufficient_credit' using errcode = 'P0402',
      detail = json_build_object('required_base', p_max_base, 'spendable_base', coalesce(v_spendable, 0))::text;
  end if;
  insert into credit_reservations (user_id, action, action_id, max_base_pence, expires_at)
  values (p_user, p_action, p_action_id, p_max_base, now() + p_ttl)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.credit_release(p_reservation uuid)
returns void language sql security definer set search_path = public as $$
  update credit_reservations set status = 'released' where id = p_reservation and status = 'open';
$$;

-- Debits p_base_pence, walking grants by priority and converting through each
-- grant's spend_rate. With a reservation the hold is settled; without one the
-- spendable balance is checked first. p_allow_negative lets a call the provider
-- has already been paid for overdraw into a per-member 'overdraft' adjustment
-- grant (rate 1, base pence) which later grants repay.
create or replace function public.credit_debit(p_user uuid, p_base_pence numeric, p_reservation uuid default null, p_allow_negative boolean default false, p_meta jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_remaining numeric := round(p_base_pence, 4);
  v_tx bigint;
  v_total_grant numeric := 0;
  v_spendable numeric;
  v_take_base numeric;
  v_take_grant numeric;
  v_overdraft uuid;
  g record;
begin
  if v_remaining <= 0 then return null; end if;
  perform 1 from profiles where id = p_user for update;

  if p_reservation is not null then
    update credit_reservations set settled_base_pence = settled_base_pence + v_remaining
    where id = p_reservation and user_id = p_user;
  else
    select spendable_base_pence into v_spendable from credit_available(p_user);
    if coalesce(v_spendable, 0) < v_remaining and not p_allow_negative then
      raise exception 'insufficient_credit' using errcode = 'P0402',
        detail = json_build_object('required_base', v_remaining, 'spendable_base', coalesce(v_spendable, 0))::text;
    end if;
  end if;

  insert into credit_transactions (user_id, kind, amount_pence, base_pence, action_id, action, provider, unit, quantity, unit_cost_pence, markup, raw_cost_pence, description, provider_call_id, metadata)
  values (
    p_user, 'debit', 0, v_remaining,
    nullif(p_meta ->> 'action_id', '')::uuid, p_meta ->> 'action', p_meta ->> 'provider', p_meta ->> 'unit',
    nullif(p_meta ->> 'quantity', '')::numeric, nullif(p_meta ->> 'unit_cost_pence', '')::numeric, nullif(p_meta ->> 'markup', '')::numeric,
    nullif(p_meta ->> 'raw_cost_pence', '')::numeric, p_meta ->> 'description', nullif(p_meta ->> 'provider_call_id', '')::bigint,
    p_meta - array['action_id', 'action', 'provider', 'unit', 'quantity', 'unit_cost_pence', 'markup', 'raw_cost_pence', 'description', 'provider_call_id']
  ) returning id into v_tx;

  for g in
    select id, remaining_pence, spend_rate from credit_grants
    where user_id = p_user and remaining_pence > 0 and (expires_at is null or expires_at > now())
    order by priority, expires_at nulls last, created_at
    for update
  loop
    exit when v_remaining <= 0;
    v_take_base := least(v_remaining, round(g.remaining_pence / g.spend_rate, 4));
    if v_take_base <= 0 then continue; end if;
    v_take_grant := least(g.remaining_pence, round(v_take_base * g.spend_rate, 4));
    update credit_grants set remaining_pence = remaining_pence - v_take_grant where id = g.id;
    insert into credit_allocations (transaction_id, grant_id, base_pence, grant_pence, spend_rate) values (v_tx, g.id, v_take_base, v_take_grant, g.spend_rate);
    v_total_grant := v_total_grant + v_take_grant;
    v_remaining := v_remaining - v_take_base;
  end loop;

  if v_remaining > 0.0001 then
    if not p_allow_negative then
      raise exception 'insufficient_credit' using errcode = 'P0402',
        detail = json_build_object('required_base', p_base_pence, 'shortfall_base', v_remaining)::text;
    end if;
    select id into v_overdraft from credit_grants where user_id = p_user and source_ref = 'overdraft:' || p_user::text;
    if v_overdraft is null then
      insert into credit_grants (user_id, kind, priority, amount_pence, remaining_pence, spend_rate, source_ref, description)
      values (p_user, 'adjustment', 3, 0, 0, 1, 'overdraft:' || p_user::text, 'Overdraft (repaid by the next credit)')
      returning id into v_overdraft;
    end if;
    update credit_grants set remaining_pence = remaining_pence - v_remaining where id = v_overdraft;
    insert into credit_allocations (transaction_id, grant_id, base_pence, grant_pence, spend_rate) values (v_tx, v_overdraft, v_remaining, v_remaining, 1);
    v_total_grant := v_total_grant + v_remaining;
    v_remaining := 0;
  end if;

  update credit_transactions set amount_pence = -v_total_grant where id = v_tx;
  return v_tx;
end;
$$;

-- Reverses a debit (fully, or p_base_pence of it) back into the grants it
-- consumed; expired grants receive their share as a new adjustment grant.
create or replace function public.credit_refund(p_transaction_id bigint, p_base_pence numeric default null, p_reason text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  t record;
  a record;
  v_ratio numeric;
  v_base_back numeric;
  v_total numeric := 0;
  v_grant_back numeric;
  v_tx bigint;
  v_new uuid;
  v_expired boolean;
begin
  select * into t from credit_transactions where id = p_transaction_id and kind = 'debit';
  if not found then raise exception 'debit % not found', p_transaction_id; end if;
  perform 1 from profiles where id = t.user_id for update;
  v_base_back := least(coalesce(p_base_pence, t.base_pence), t.base_pence);
  if v_base_back <= 0 then return null; end if;
  v_ratio := v_base_back / t.base_pence;
  insert into credit_transactions (user_id, kind, amount_pence, base_pence, action_id, action, provider, unit, description, metadata)
  values (t.user_id, 'refund', 0, v_base_back, t.action_id, t.action, t.provider, t.unit, coalesce(p_reason, 'Refund'), jsonb_build_object('refund_of', t.id))
  returning id into v_tx;
  for a in select al.*, g.expires_at, g.kind, g.priority from credit_allocations al join credit_grants g on g.id = al.grant_id where al.transaction_id = t.id loop
    v_grant_back := round(a.grant_pence * v_ratio, 4);
    if v_grant_back <= 0 then continue; end if;
    v_expired := a.expires_at is not null and a.expires_at <= now();
    if v_expired then
      insert into credit_grants (user_id, kind, priority, amount_pence, remaining_pence, spend_rate, description)
      values (t.user_id, 'adjustment', 3, v_grant_back, v_grant_back, a.spend_rate, 'Refund of an expired-cycle debit')
      returning id into v_new;
      insert into credit_allocations (transaction_id, grant_id, base_pence, grant_pence, spend_rate) values (v_tx, v_new, round(a.base_pence * v_ratio, 4), v_grant_back, a.spend_rate);
    else
      update credit_grants set remaining_pence = remaining_pence + v_grant_back where id = a.grant_id;
      insert into credit_allocations (transaction_id, grant_id, base_pence, grant_pence, spend_rate) values (v_tx, a.grant_id, round(a.base_pence * v_ratio, 4), v_grant_back, a.spend_rate);
    end if;
    v_total := v_total + v_grant_back;
  end loop;
  update credit_transactions set amount_pence = v_total where id = v_tx;
  return v_tx;
end;
$$;

-- Adds credit. Idempotent on p_source_ref (a replayed Stripe event returns the
-- existing grant). Repays any outstanding overdraft from the new grant first.
create or replace function public.credit_grant(p_user uuid, p_kind text, p_amount numeric, p_expires_at timestamptz default null, p_source_ref text default null, p_description text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_rate numeric;
  v_priority smallint;
  v_overdraft record;
  v_debt_base numeric;
  v_repay_base numeric;
  v_repay_grant numeric;
begin
  if p_kind not in ('plan', 'welcome', 'topup', 'adjustment') then raise exception 'bad grant kind %', p_kind; end if;
  perform 1 from profiles where id = p_user for update;
  if p_source_ref is not null then
    select id into v_id from credit_grants where source_ref = p_source_ref;
    if v_id is not null then return v_id; end if;
  end if;
  v_rate := credit_spend_rate(p_kind);
  v_priority := case p_kind when 'plan' then 1 when 'welcome' then 2 else 3 end;
  insert into credit_grants (user_id, kind, priority, amount_pence, remaining_pence, spend_rate, expires_at, source_ref, description)
  values (p_user, p_kind, v_priority, p_amount, p_amount, v_rate, p_expires_at, p_source_ref, p_description)
  returning id into v_id;
  insert into credit_transactions (user_id, kind, amount_pence, grant_id, description, metadata)
  values (p_user, 'grant', p_amount, v_id, coalesce(p_description, initcap(p_kind) || ' credit'), jsonb_build_object('grant_kind', p_kind, 'source_ref', p_source_ref, 'expires_at', p_expires_at));

  -- Repay overdraft (base pence, rate 1) from this grant.
  select * into v_overdraft from credit_grants where user_id = p_user and source_ref = 'overdraft:' || p_user::text and remaining_pence < 0 for update;
  if found and p_amount > 0 then
    v_debt_base := -v_overdraft.remaining_pence;
    v_repay_base := least(v_debt_base, round(p_amount / v_rate, 4));
    v_repay_grant := least(p_amount, round(v_repay_base * v_rate, 4));
    update credit_grants set remaining_pence = remaining_pence + v_repay_base where id = v_overdraft.id;
    update credit_grants set remaining_pence = remaining_pence - v_repay_grant where id = v_id;
    insert into credit_transactions (user_id, kind, amount_pence, base_pence, grant_id, description, metadata)
    values (p_user, 'adjust', -v_repay_grant, v_repay_base, v_id, 'Overdraft repaid', jsonb_build_object('overdraft_grant', v_overdraft.id));
  end if;
  return v_id;
end;
$$;

-- Zeroes a member's unexpired plan grants (renewal, cancellation, downgrade).
create or replace function public.credit_expire_plan_grants(p_user uuid, p_reason text default 'cycle_ended')
returns int language plpgsql security definer set search_path = public as $$
declare
  g record;
  n int := 0;
begin
  perform 1 from profiles where id = p_user for update;
  for g in select id, remaining_pence from credit_grants where user_id = p_user and kind = 'plan' and remaining_pence > 0 and (expires_at is null or expires_at > now()) for update loop
    insert into credit_transactions (user_id, kind, amount_pence, grant_id, description, metadata)
    values (p_user, 'expire', -g.remaining_pence, g.id, 'Plan credit expired', jsonb_build_object('reason', p_reason));
    update credit_grants set remaining_pence = 0, expires_at = least(coalesce(expires_at, now()), now()) where id = g.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Sweep: write 'expire' rows for every grant past its expiry that still has credit (keeps the ledger honest).
create or replace function public.credit_expire_due()
returns int language plpgsql security definer set search_path = public as $$
declare
  g record;
  n int := 0;
begin
  for g in select id, user_id, remaining_pence from credit_grants where expires_at is not null and expires_at <= now() and remaining_pence > 0 for update skip locked loop
    insert into credit_transactions (user_id, kind, amount_pence, grant_id, description, metadata)
    values (g.user_id, 'expire', -g.remaining_pence, g.id, 'Plan credit expired', jsonb_build_object('reason', 'expired'));
    update credit_grants set remaining_pence = 0 where id = g.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Promo / referral redemption. Grants the redeemer (and, for referral codes, the owner).
create or replace function public.credit_redeem_code(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  v_grant uuid;
  v_owner_grant uuid;
  v_referral numeric;
begin
  if v_code = '' then raise exception 'code_required' using errcode = 'P0403'; end if;
  perform 1 from profiles where id = p_user for update;
  select * into c from credit_codes where code = v_code for update;
  if not found or not c.active then raise exception 'code_invalid' using errcode = 'P0403'; end if;
  if c.expires_at is not null and c.expires_at <= now() then raise exception 'code_expired' using errcode = 'P0403'; end if;
  if c.max_redemptions is not null and c.redeemed_count >= c.max_redemptions then raise exception 'code_exhausted' using errcode = 'P0403'; end if;
  if c.owner_user_id = p_user then raise exception 'code_own_referral' using errcode = 'P0403'; end if;
  if exists (select 1 from credit_code_redemptions where code = v_code and user_id = p_user) then raise exception 'code_already_used' using errcode = 'P0403'; end if;
  if c.kind = 'referral' and exists (select 1 from credit_code_redemptions r join credit_codes cc on cc.code = r.code where r.user_id = p_user and cc.kind = 'referral') then
    raise exception 'referral_already_used' using errcode = 'P0403';
  end if;
  insert into credit_code_redemptions (code, user_id) values (v_code, p_user);
  update credit_codes set redeemed_count = redeemed_count + 1 where code = v_code;
  v_grant := credit_grant(p_user, 'adjustment', c.amount_pence, null, 'code:' || v_code || ':' || p_user::text,
    case when c.kind = 'referral' then 'Referral credit' else 'Promo code ' || v_code end);
  if c.kind = 'referral' and c.owner_user_id is not null then
    v_referral := credit_setting_num('referral_pence', 1000);
    v_owner_grant := credit_grant(c.owner_user_id, 'adjustment', v_referral, null, 'referral:' || v_code || ':' || p_user::text, 'Referral reward');
    update profiles set referred_by_code = v_code where id = p_user and referred_by_code is null;
  end if;
  return jsonb_build_object('kind', c.kind, 'amount_pence', c.amount_pence, 'grant_id', v_grant, 'owner_grant_id', v_owner_grant);
end;
$$;

revoke execute on function public.credit_setting_num(text, numeric) from public, anon, authenticated;
revoke execute on function public.credit_spend_rate(text) from public, anon, authenticated;
revoke execute on function public.credit_available(uuid) from public, anon, authenticated;
revoke execute on function public.credit_reserve(uuid, text, uuid, numeric, interval) from public, anon, authenticated;
revoke execute on function public.credit_release(uuid) from public, anon, authenticated;
revoke execute on function public.credit_debit(uuid, numeric, uuid, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.credit_refund(bigint, numeric, text) from public, anon, authenticated;
revoke execute on function public.credit_grant(uuid, text, numeric, timestamptz, text, text) from public, anon, authenticated;
revoke execute on function public.credit_expire_plan_grants(uuid, text) from public, anon, authenticated;
revoke execute on function public.credit_expire_due() from public, anon, authenticated;
revoke execute on function public.credit_redeem_code(uuid, text) from public, anon, authenticated;

-- ── Welcome credit backfill for every existing account (one-off, idempotent) ──
-- New accounts are granted by the app after the abuse checks (src/lib/credit/welcome.ts).
do $$
declare p record;
begin
  for p in select id from profiles where not exists (select 1 from credit_grants g where g.user_id = profiles.id and g.kind = 'welcome') loop
    perform credit_grant(p.id, 'welcome', credit_setting_num('welcome_grant_pence', 2000), null, 'welcome:' || p.id::text, 'Welcome credit');
    update profiles set welcome_checked_at = now() where id = p.id;
  end loop;
end $$;

-- =========================
-- Market Explorer: planning signals (direct-booking "contractor projects")
-- =========================
-- One row per postcode area: large planning applications PlanIt holds within
-- radius_km of the area's centre over the last 12 months and the 12 before.
-- Written by /api/internal/planning-signals (service role) and read into the
-- explorer snapshot; no member-facing policy, so RLS with no policies.
create table if not exists public.area_planning_signals (
  postcode_area text primary key,
  lat numeric not null,
  lng numeric not null,
  radius_km numeric not null,
  large_apps_12m integer,
  large_apps_prev_12m integer,
  fetched_at timestamptz not null default now(),
  source text not null default 'planit'
);
alter table public.area_planning_signals enable row level security;

-- =========================
-- Daily picks (one sourced property a day per member)
-- =========================
-- Daily picks are ON by default: every member who has signed in at least once
-- (welcome_checked_at set) gets one listing a day that fits their goals, or a
-- Stayful house pick when they have no goals, charged at the daily_pick unit
-- cost. Paused subscriptions are skipped by the cron. Turning picks off writes
-- sourcing_opted_out_at (declared above the profiles grant), so the backfill
-- below can never re-enrol someone who opted out. Safe to re-run.
alter table public.profiles alter column sourcing_alerts set default true;
update public.profiles
   set sourcing_alerts = true
 where sourcing_alerts = false
   and sourcing_opted_out_at is null
   and sourcing_last_sent_at is null;

-- sourcing_sent grows from a (user, url) dedupe ledger into the pick record
-- the member sees on /picks and reacts to from the email. The composite
-- primary key stays: one listing can never be sent twice to the same member.
--   status    pending (row inserted before the send, so overlapping runs and a
--             crash mid-send can never produce two picks) | sent | failed
--             (Resend refused or timed out; kept so the listing is not retried)
--   token     public link token for the email buttons (/p/<token>)
--   basis     goals (from the member's filter) | house (Stayful pick)
--   reaction  yes | no, reaction_source link (email click) | form (confirmed)
alter table public.sourcing_sent add column if not exists id uuid not null default gen_random_uuid();
create unique index if not exists sourcing_sent_id_uidx on public.sourcing_sent (id);
alter table public.sourcing_sent add column if not exists token text;
create unique index if not exists sourcing_sent_token_uidx on public.sourcing_sent (token);
alter table public.sourcing_sent add column if not exists status text not null default 'sent';
alter table public.sourcing_sent add column if not exists kind text;
alter table public.sourcing_sent add column if not exists postcode_area text;
alter table public.sourcing_sent add column if not exists basis text;
alter table public.sourcing_sent add column if not exists deal jsonb;
alter table public.sourcing_sent add column if not exists fit integer;
alter table public.sourcing_sent add column if not exists charged_base_pence numeric(14,4);
alter table public.sourcing_sent add column if not exists reaction text;
alter table public.sourcing_sent add column if not exists reaction_source text;
alter table public.sourcing_sent add column if not exists reasons text[];
alter table public.sourcing_sent add column if not exists comment text;
alter table public.sourcing_sent add column if not exists responded_at timestamptz;
alter table public.sourcing_sent add column if not exists checked_listing_id uuid;
alter table public.sourcing_sent add column if not exists saved_at timestamptz;
create index if not exists sourcing_sent_user_sent_idx on public.sourcing_sent (user_id, sent_at desc);
create index if not exists sourcing_sent_sent_at_idx on public.sourcing_sent (sent_at desc);
-- Still service-role only (RLS on, no policies): /picks reads and writes
-- through the admin client after checking the session and filtering by user.

-- =========================
-- White-label lead funnels
-- =========================
-- A customer points their own form (Squarespace, an ad, wherever) at
-- /f/<public_token>. The prospect fills in a property, gets a report under
-- the customer's branding, and the run is charged to the CUSTOMER's credit
-- at the funnel markup — not to the prospect, who never has an account.
--
-- Everything here is written through the service-role client. The public
-- funnel page has no session at all, and the members-only pages read their
-- own rows through the select policies below. Nothing in this section is
-- user-writable, so none of it needs a column grant.
--
-- Deliberately NOT touching public.profiles: the access gate selects a fixed
-- column list (ACCESS_COLUMNS in src/lib/access.ts) and a select naming a
-- missing column fails the whole query and paywalls every member. Funnel
-- state lives in its own tables so that gate can never be affected.

create table if not exists public.funnels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The credential in the public URL. Minted server-side, rotatable.
  public_token text not null unique,
  name text not null default 'My funnel',
  -- { logoUrl, primary, accent, companyName, replyToEmail } — see src/lib/funnels.
  brand jsonb not null default '{}'::jsonb,
  -- Qualification filter; shape and tolerant parse in src/lib/leads/rules.ts.
  lead_rules jsonb not null default '{}'::jsonb,
  report_depth text not null default 'standard',        -- 'standard' | 'enhanced'
  -- What happens to a lead that fails the filter: push it to the CRM flagged
  -- as not qualified, or hold it inside Stayful for the customer to review,
  -- export or promote later.
  unqualified_policy text not null default 'crm_flagged', -- 'crm_flagged' | 'hold'
  active boolean not null default true,
  -- Abuse and cost ceilings, both per UTC day. The spend cap is the backstop
  -- that turns any residual billing bug into a bounded loss rather than an
  -- unbounded one, so it applies even when the credit checks all pass.
  daily_cap integer not null default 100,
  daily_spend_cap_pence integer not null default 5000,
  -- Set when the public token was last rotated, so a leaked link can be
  -- replaced without losing the lead history attached to the funnel.
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists funnels_user_idx on public.funnels (user_id, created_at desc);
alter table public.funnels enable row level security;
drop policy if exists "Users can read own funnels" on public.funnels;
create policy "Users can read own funnels"
  on public.funnels for select
  using (auth.uid() = user_id);

-- leads: one row per prospect who completed a funnel.
--
-- The analysis lives HERE, in `result`, and never in saved_searches. That
-- table is the member's own analyser history and is pruned to the newest 200
-- rows per member (see /api/analyse); funnel leads saving into it would
-- evict a customer's own reports within weeks. Keeping them apart also keeps
-- the two features apart in the UI, the API and the billing history, which
-- is the point: "my reports" and "my leads" are different things.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  -- The customer who owns this lead and paid for the report.
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Null once a funnel is deleted: the customer keeps leads they paid for.
  funnel_id uuid references public.funnels(id) on delete set null,
  -- ── The prospect ──
  name text,
  email text,
  phone text,
  -- When they agreed to the customer's privacy notice. The customer is the
  -- data controller and Stayful the processor, so this is the lawful basis
  -- for holding the rest of this row.
  consent_at timestamptz,
  -- ── The property ──
  address text,
  postcode text,
  postcode_area text,
  bedrooms integer,
  -- ── The report ──
  result jsonb,
  -- Unguessable path for the prospect's own copy; they have no account.
  report_token text unique,
  -- Supabase Storage path of the rendered PDF, once it has been stored.
  pdf_path text,
  -- ── Qualification ──
  qualified boolean,
  -- The per-rule checks behind `qualified` (LeadVerdict in src/lib/leads/rules.ts),
  -- so a customer can see WHY a lead did not make the cut.
  qualification jsonb,
  -- 'queued'  captured, report not run yet (customer had no credit)
  -- 'new'     report ran, nothing done with it yet
  -- 'pushed'  delivered to the customer's CRM
  -- 'held'    failed the filter on a 'hold' funnel; kept here for review
  -- 'exported' pulled out via the API or a CSV download
  status text not null default 'new',
  crm_item_id text,
  crm_pushed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_created_idx on public.leads (user_id, created_at desc);
create index if not exists leads_funnel_created_idx on public.leads (funnel_id, created_at desc);
-- Powers the qualified-vs-unqualified counts on /leads and /api/v1/leads/stats.
create index if not exists leads_user_qualified_idx on public.leads (user_id, qualified, created_at desc);
-- The queue drained after a top-up lands; tiny, so keep it partial.
create index if not exists leads_queued_idx on public.leads (created_at) where status = 'queued';
-- ── Pipeline stage ──
-- The customer's own sales stage, for customers without a CRM. Deliberately
-- separate from `status`, which is OUR delivery state (queued, pushed…):
-- the two answer different questions and one must not overwrite the other.
-- Fixed list, mirrored by LEAD_STAGES in src/lib/leads/stage.ts.
alter table public.leads add column if not exists stage text not null default 'new';
alter table public.leads add column if not exists stage_changed_at timestamptz;
alter table public.leads drop constraint if exists leads_stage_check;
alter table public.leads add constraint leads_stage_check
  check (stage in ('new', 'contacted', 'meeting_booked', 'signed', 'lost'));

-- ── Retention ── (src/lib/leads/retention.ts, /api/internal/lead-retention)
-- A lead nobody has used for 6 months is archived, kept 7 days so it can be
-- restored, then deleted. The customer is emailed 2 days before and again
-- when it happens.
--
-- `last_activity_at` is what "used" means: the customer opening it, a
-- single-lead API/MCP read, the prospect reopening their report, or a push
-- to the CRM. The default fills EXISTING rows with the moment this runs, so
-- the clock starts at launch and old leads are not all archived on night one.
alter table public.leads add column if not exists last_activity_at timestamptz not null default now();
-- The "archiving in 2 days" email went out. Cleared by any activity.
alter table public.leads add column if not exists archive_warned_at timestamptz;
alter table public.leads add column if not exists archived_at timestamptz;
alter table public.leads add column if not exists archive_reason text;
alter table public.leads drop constraint if exists leads_archive_reason_check;
alter table public.leads add constraint leads_archive_reason_check
  check (archive_reason is null or archive_reason in ('inactive', 'manual'));
-- The "archived" email went out (inactive archives only).
alter table public.leads add column if not exists archive_notified_at timestamptz;
-- When the row is deleted. Set only once the customer has been told — a
-- manual archive tells them on screen, an inactive one by email — so a
-- failed email can never lead to data vanishing unannounced.
alter table public.leads add column if not exists purge_after timestamptz;
create index if not exists leads_user_archived_idx on public.leads (user_id, archived_at, created_at desc);
create index if not exists leads_activity_idx on public.leads (last_activity_at) where archived_at is null;
create index if not exists leads_purge_idx on public.leads (purge_after) where purge_after is not null;

alter table public.leads enable row level security;
drop policy if exists "Users can read own leads" on public.leads;
create policy "Users can read own leads"
  on public.leads for select
  using (auth.uid() = user_id);

-- crm_connections: where a customer's leads are delivered.
--
-- Holds encrypted credentials, so it is service-role only: RLS on with NO
-- policies, like unit_costs. The settings UI reads a sanitised view through
-- a server component; a raw credential must never reach a browser.
--
-- Monday board and column ids differ for every customer, so `config` carries
-- the field map (board id, group id, and the column id for each of name,
-- email, phone, report file, date, qualified) rather than assuming ours.
create table if not exists public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null,                       -- 'monday' | 'webhook'
  -- AES-256-GCM, stored iv:tag:ciphertext (src/lib/crypto/secrets.ts).
  credential_enc text,
  -- Shared secret the webhook payload is signed with, same encryption.
  webhook_secret_enc text,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'unverified',    -- 'unverified' | 'ok' | 'error'
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_connections_user_idx on public.crm_connections (user_id, created_at desc);
alter table public.crm_connections enable row level security;

-- crm_deliveries: the retry queue behind every CRM push.
--
-- A push is never done inline with the prospect's request: the customer's
-- CRM being down must not cost them the lead or leave the prospect waiting.
-- /api/internal/crm-deliveries drains this with backoff.
create table if not exists public.crm_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  connection_id uuid not null references public.crm_connections(id) on delete cascade,
  status text not null default 'pending',       -- 'pending' | 'sent' | 'failed'
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- The cron's only query: what is due, oldest first.
create index if not exists crm_deliveries_due_idx
  on public.crm_deliveries (next_attempt_at) where status = 'pending';
create index if not exists crm_deliveries_lead_idx on public.crm_deliveries (lead_id);
alter table public.crm_deliveries enable row level security;

-- api_keys: bearer tokens for /api/v1/* and the MCP server.
--
-- Same shape and the same hashing as extension_tokens (raw value shown once,
-- only the SHA-256 stored, so a database read can never impersonate anyone),
-- but a separate table: the shipped Chrome extension reads extension_tokens
-- and must not be disturbed. Raw keys are prefixed 'sfk_'.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text,
  -- e.g. {'leads:read','leads:write','analyse','markets:read'}. Empty means
  -- read-only, so a key can never gain reach by omission.
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists api_keys_user_idx on public.api_keys (user_id, created_at desc);
alter table public.api_keys enable row level security;
drop policy if exists "Users can read own api keys" on public.api_keys;
create policy "Users can read own api keys"
  on public.api_keys for select
  using (auth.uid() = user_id);

-- funnel_hits: durable rate limiting and the daily caps.
--
-- The in-memory limiter in /api/analyse is per serverless instance, which is
-- close to no limit at all across a fleet. A public endpoint that spends a
-- customer's money needs counters that survive a cold start, so they live
-- here. One row per (funnel, bucket, window): 'funnel' for the daily totals
-- the caps are checked against, 'ip:<addr>' for per-visitor throttling.
create table if not exists public.funnel_hits (
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  spend_base_pence numeric(14,4) not null default 0,
  primary key (funnel_id, bucket, window_start)
);
-- Lets the sweep drop windows that have rolled over.
create index if not exists funnel_hits_window_idx on public.funnel_hits (window_start);
alter table public.funnel_hits enable row level security;

-- ── Funnel alerts: one row per funnel, kind and UTC day ──
--
-- The dedup store behind "tell the owner when their funnel stops working".
-- Every wall a funnel can hit used to be silent: a customer whose credit ran
-- dry kept collecting leads that were captured, queued and never reported on,
-- and nothing told them. A prospect landing on a paused link was invisible too.
--
-- The INSERT is the decision. Whoever creates the row sends the email and
-- everybody else conflicts and stays quiet, so a funnel that hits its ceiling
-- eighty times in a day sends one email rather than eighty — and it is decided
-- atomically, not by reading and then writing.
create table if not exists public.funnel_alerts (
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  -- 'out_of_credit' | 'paused_hit' | 'daily_cap' | 'spend_cap'
  kind text not null,
  day timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (funnel_id, kind, day)
);
-- Lets a sweep drop days that have rolled over.
create index if not exists funnel_alerts_day_idx on public.funnel_alerts (day);

alter table public.funnel_alerts enable row level security;

/**
 * Claims the right to tell this funnel's owner about this wall today.
 * Returns true to exactly one caller per (funnel, kind, UTC day).
 *
 * In SQL for the same reason funnel_hit and funnel_spend_reserve are: the
 * decision has to be the write. Reading whether we have already sent and then
 * writing that we have would let concurrent submissions all decide they were
 * first and send their own copy — and the whole point is one email, not one
 * per prospect. It is a function rather than an upsert from the client so the
 * contract is ours and does not depend on how a driver reports a conflict.
 */
create or replace function public.funnel_alert_claim(
  p_funnel uuid,
  p_kind text,
  p_day timestamptz
)
returns boolean
language plpgsql
as $$
begin
  insert into public.funnel_alerts (funnel_id, kind, day)
  values (p_funnel, p_kind, p_day)
  on conflict (funnel_id, kind, day) do nothing;
  -- 0 when somebody else already claimed it today.
  return found;
end;
$$;

-- ── Funnel caps: atomic, because a public endpoint spends real money ──
--
-- The members-only daily cap (resolvesToday in src/lib/listing/server.ts)
-- counts rows and then checks the count. That is fine when the member is one
-- person clicking a button. On a public funnel, N concurrent requests all read
-- the same count and all pass it, so a count-then-check does not cap anything.
--
-- These do the counting and the checking in ONE statement, so concurrent
-- requests serialise on the row.

/**
 * Records an attempt and reports whether it is within the limit.
 * Returns the new count, or -1 when the attempt is over it. The row still
 * counts a refused attempt, so a flood shows up afterwards instead of being
 * invisible. p_limit <= 0 means no limit.
 */
create or replace function public.funnel_hit(
  p_funnel uuid,
  p_bucket text,
  p_window timestamptz,
  p_limit integer
)
returns integer
language plpgsql
as $$
declare
  v_hits integer;
begin
  insert into public.funnel_hits (funnel_id, bucket, window_start, hits)
  values (p_funnel, p_bucket, p_window, 1)
  on conflict (funnel_id, bucket, window_start)
    do update set hits = public.funnel_hits.hits + 1
  returning hits into v_hits;

  if p_limit > 0 and v_hits > p_limit then
    return -1;
  end if;
  return v_hits;
end;
$$;

/**
 * Claims p_base_pence of the funnel's daily spend ceiling BEFORE a run, at the
 * run's worst case. Returns false when the claim would breach the cap, having
 * changed nothing.
 *
 * Reserving up front and settling afterwards is the same shape as a credit
 * reservation, and for the same reason: checking the spend so far and then
 * spending leaves a window where concurrent runs all pass the check and the
 * day's total sails past the ceiling.
 */
create or replace function public.funnel_spend_reserve(
  p_funnel uuid,
  p_window timestamptz,
  p_base_pence numeric,
  p_cap numeric
)
returns boolean
language plpgsql
as $$
declare
  v_spend numeric;
begin
  insert into public.funnel_hits (funnel_id, bucket, window_start, spend_base_pence)
  values (p_funnel, 'funnel', p_window, p_base_pence)
  on conflict (funnel_id, bucket, window_start)
    do update set spend_base_pence = public.funnel_hits.spend_base_pence + p_base_pence
  returning spend_base_pence into v_spend;

  if p_cap > 0 and v_spend > p_cap then
    -- Put it back: the caller is not going to run, so the claim must not
    -- linger and lock out the rest of the day.
    update public.funnel_hits
       set spend_base_pence = spend_base_pence - p_base_pence
     where funnel_id = p_funnel and bucket = 'funnel' and window_start = p_window;
    return false;
  end if;
  return true;
end;
$$;

/**
 * Reconciles a reservation to what the run actually cost. The difference is
 * usually negative (the reservation is the worst case), which hands unused
 * headroom back to the rest of the day.
 */
create or replace function public.funnel_spend_settle(
  p_funnel uuid,
  p_window timestamptz,
  p_reserved numeric,
  p_actual numeric
)
returns void
language plpgsql
as $$
begin
  update public.funnel_hits
     set spend_base_pence = greatest(0, spend_base_pence - p_reserved + p_actual)
   where funnel_id = p_funnel and bucket = 'funnel' and window_start = p_window;
end;
$$;

/** Drops throttle windows that have rolled over. Called by the daily sweep. */
create or replace function public.funnel_hits_sweep(p_before timestamptz)
returns integer
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from public.funnel_hits where window_start < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- =========================
-- Motivated sellers and landlords
-- =========================
-- The motivated-seller filter is the one pick that is allowed to be old: a
-- listing that has been sitting for months is the whole point of it. Its pool
-- reads sourced_listings by area and kind, bounded below by an age floor and
-- ordered by last sighting, so this index carries the filtering columns and
-- leaves only a small set to sort.
--
-- Nothing else is needed. The member's filter rides inside the existing
-- profiles.market_goals jsonb, and the listing-level fields (listedDate, uprn,
-- addedOrReduced, agentHash) ride inside sourced_listings.snapshot — so no
-- column is added to profiles, and ACCESS_COLUMNS in src/lib/access.ts is
-- untouched.
create index if not exists sourced_listings_area_kind_idx
  on public.sourced_listings (postcode_area, kind, first_seen_at desc);

-- The advice sent with a near-miss pick: which filter was the binding one and
-- what to change it to. Stored rather than recomputed because the one-click
-- "change it" link on /p/[token] must apply only a value WE proposed — the
-- token travels in an email, so anyone holding that email can invoke the
-- action, and accepting a value from the request would let them rewrite
-- someone else's filter to anything at all.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE THAT READS IT. PICK_COLUMNS in
-- src/lib/listing/picks-server.ts is a fixed select, so a missing column fails
-- the whole query and takes /picks and /p/[token] down with it.
alter table public.sourcing_sent add column if not exists relaxation jsonb;

-- The motivation signals that fired for this pick, as they were claimed in the
-- email. Stored rather than recomputed so the picks page can never disagree
-- with what the member was actually told: a recomputation would be missing the
-- area median from the run that produced it, and would quietly drop a reason.
-- Same deployment rule as above — column first, then the code.
alter table public.sourcing_sent add column if not exists motivation jsonb;

-- The income screening that decided this pick was worth sending: band, the
-- figures behind it, and whether each input was confirmed or estimated. Stored
-- rather than recomputed for the same reason as motivation above — the area
-- revenue and the rent ladder move, so a recomputation would quietly disagree
-- with the numbers the member was actually shown.
-- Same deployment rule as above — column first, then the code.
alter table public.sourcing_sent add column if not exists screening jsonb;

-- =========================
-- subscription_events
-- =========================
-- Append-only history of what a subscription did and why, so churn can be
-- measured. Everything else subscription-shaped is a MUTABLE column on
-- profiles, which cannot answer the two questions the churn report asks:
--
--   "why did the ones who left at 6 months leave?"   profiles.cancel_reason is
--   overwritten by the next cancellation and, until the fix in
--   src/lib/stripe/webhook.ts, was nulled the moment the subscription actually
--   ended — so the reason was destroyed at the exact moment it became the
--   answer.
--
--   "how long did they stay?"   a member who leaves and comes back has one
--   subscription_started_at, so the two spells look like one long one.
--
-- cycle_started_at is what separates them: it is the Stripe subscription's own
-- start_date, so a win-back is a SECOND cohort rather than a longer first one.
-- Tenure is always derived (at − cycle_started_at) and never stored, for the
-- same reason the pause window is a time comparison rather than a flag —
-- nothing to drift, nothing to keep in step with a cron.
--
-- Deliberately NOT columns on profiles: ACCESS_COLUMNS in src/lib/access.ts
-- selects a fixed list, and a PostgREST select naming a column that does not
-- exist fails the whole query and bounces every member to the paywall. A
-- separate table cannot take the site down by being added a merge late.
create table if not exists public.subscription_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  -- 'started' | 'cancel_scheduled' | 'cancel_reverted' | 'ended'
  -- | 'paused' | 'resumed' | 'past_due' | 'recovered' | 'plan_changed'
  kind text not null,
  -- The subscription's own start_date. Null only for a manually granted plan
  -- that Stripe has never seen.
  cycle_started_at timestamptz,
  plan_code text,
  -- Monthly-equivalent price AS AT this event, so a later price change can
  -- never rewrite history. Annual plans are divided down (see churn.ts).
  mrr_pence integer,
  -- The cancel-reason slug. A superset of CANCEL_REASONS in
  -- src/app/account/plan-view.ts: reporting also uses 'payment_failed', which
  -- is never offered to a member because nobody chooses a dead card.
  reason text,
  reason_comment text,
  -- 'self_serve' | 'portal' | 'stripe' | 'manual' | 'backfill'. Tells an
  -- answer the member typed apart from one Stripe inferred.
  source text not null default 'stripe',
  stripe_subscription_id text,
  stripe_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_events_user_at_idx
  on public.subscription_events (user_id, at);
create index if not exists subscription_events_kind_at_idx
  on public.subscription_events (kind, at);

-- One Stripe delivery can legitimately produce two rows — a plan change and a
-- scheduled cancel arrive on the same event — so the guard is per (event, kind)
-- rather than per event. A replayed delivery, a second webhook endpoint and a
-- re-run of the backfill all land on the same row and are ignored.
create unique index if not exists subscription_events_stripe_event_kind_uidx
  on public.subscription_events (stripe_event_id, kind)
  where stripe_event_id is not null;

alter table public.subscription_events enable row level security;  -- no policies: service role only
-- Supabase grants the API roles privileges on new public tables by default.
-- RLS with no policies already returns nothing, but revoking says so outright.
revoke all on public.subscription_events from anon, authenticated;

-- =========================
-- Deals marketplace
-- =========================
-- A browsable pool of every currently-active listing in the top scored areas
-- that clears the income screening (src/lib/listing/screen.ts). One row per
-- listing; the address, postcode and listing URL stay on sourced_listings
-- and are only read once a member has paid to open the deal (deal_opens).
-- The grid selects PUBLIC_DEAL_COLUMNS (src/lib/marketplace/grid.ts) and never
-- the canonical_url. Service role only.
create table if not exists public.marketplace_deals (
  canonical_url text primary key references public.sourced_listings(canonical_url) on delete cascade,
  -- The public handle. Reactivation reuses the row, so the id is stable for
  -- the life of the listing and deal_opens.deal_id can never dangle.
  id uuid not null default gen_random_uuid(),
  source text not null,
  kind text not null,                        -- sale | rent
  postcode_area text,
  outcode text,
  town text,
  bedrooms int,
  price_amount numeric,                      -- sale: asking price; rent: pcm
  price_period text,                         -- total | pcm
  raw_type text,
  tenure text,
  photo text,
  photos jsonb,
  band text not null,                        -- 'qualified' while live; kept for the admin report on retirement
  screening jsonb not null,
  deal jsonb,                                -- deal.ts figures at house finance defaults
  suitability text,                          -- ok | unknown
  motivation jsonb,
  -- screening.surplus: the annual surplus over a long let (purchase) or the
  -- annual profit after rent (rent-to-rent). The ladder price and sort key.
  annual_profit numeric,
  uplift_pct numeric,                        -- purchase only
  price_history jsonb not null default '[]'::jsonb,
  reduced_at timestamptz,
  listed_date timestamptz,
  -- pending_verify: qualified on the feed, waiting for its first page fetch,
  -- which supplies the photo and the live status. live: on the grid.
  status text not null default 'pending_verify',
  retired_reason text,                       -- sold | under_offer | let_agreed | removed | unqualified | unsuitable | stale_listed | stale_unseen | unverifiable | admin
  retired_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_checked_live_at timestamptz,
  last_confirmed_at timestamptz not null default now(),
  last_confirmed_via text not null default 'feed',   -- feed | live
  next_check_due_at timestamptz,
  -- Set by an open that could not verify the listing; the recheck takes these first.
  check_requested_at timestamptz,
  -- The last time a member's grid showed this deal: the recheck checks what
  -- members are looking at before the tail.
  last_shown_at timestamptz,
  check_failures int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists marketplace_deals_id_uidx on public.marketplace_deals (id);
create index if not exists marketplace_deals_live_profit_idx on public.marketplace_deals (kind, annual_profit desc) where status = 'live';
create index if not exists marketplace_deals_live_area_idx on public.marketplace_deals (postcode_area, kind) where status = 'live';
create index if not exists marketplace_deals_live_seen_idx on public.marketplace_deals (first_seen_at desc) where status = 'live';
create index if not exists marketplace_deals_due_idx on public.marketplace_deals (status, next_check_due_at) where status in ('live', 'pending_verify');
alter table public.marketplace_deals enable row level security;  -- no policies: service role only
revoke all on public.marketplace_deals from anon, authenticated;

-- deal_opens: a member's unlocks. The row is inserted BEFORE the debit
-- (status pending) and flipped to open after it; the id doubles as the
-- ledger action_id, so a crash between the two is recovered by
-- actionAlreadyCharged rather than charged twice. An open row is forever:
-- a deal that later goes off market still reads in /deals/opened.
create table if not exists public.deal_opens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canonical_url text not null,
  deal_id uuid not null,
  status text not null default 'pending',    -- pending | open
  opened_at timestamptz not null default now(),
  charged_base_pence numeric(14,4) not null default 0,
  transaction_id bigint,
  verified_via text,                         -- live | recent_live | recent_confirm | pick | admin
  status_at_open text,
  band_at_open text,
  annual_profit_at_open numeric,
  checked_listing_id uuid,
  saved_at timestamptz,
  -- Whether this open spent a page fetch, for the per-member hourly cap.
  fetched boolean not null default false,
  primary key (user_id, canonical_url)
);
create unique index if not exists deal_opens_id_uidx on public.deal_opens (id);
create index if not exists deal_opens_user_idx on public.deal_opens (user_id, opened_at desc);
create index if not exists deal_opens_deal_idx on public.deal_opens (deal_id);
alter table public.deal_opens enable row level security;  -- no policies: service role only
revoke all on public.deal_opens from anon, authenticated;

-- marketplace_runs: one row per sweep / recheck pass, for /admin/deals.
create table if not exists public.marketplace_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                        -- sweep | recheck
  dry boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);
create index if not exists marketplace_runs_kind_idx on public.marketplace_runs (kind, started_at desc);
alter table public.marketplace_runs enable row level security;  -- no policies: service role only
revoke all on public.marketplace_runs from anon, authenticated;

-- marketplace_cohorts: the PropertyData motivated-seller cohorts per area,
-- refreshed weekly by the sweep (one credit per cohort per area).
create table if not exists public.marketplace_cohorts (
  postcode_area text primary key,
  payload jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table public.marketplace_cohorts enable row level security;  -- no policies: service role only
revoke all on public.marketplace_cohorts from anon, authenticated;

-- The pick that came from the pool links to its deal sheet. APPLY BEFORE
-- deploying the code that reads it: PICK_COLUMNS is a fixed select.
alter table public.sourcing_sent add column if not exists deal_id uuid;

-- Lead-form provisioning (src/app/api/internal/leads/provision): where the
-- member came from, and when they first signed in so the activation can be
-- reported back to the ad platform.
alter table public.profiles add column if not exists lead_source jsonb;
alter table public.profiles add column if not exists lead_activated_at timestamptz;

-- The open-price ladder (src/lib/marketplace/ladder.ts). Bands on annual
-- profit; editable from /admin/deals.
insert into public.billing_settings (key, value)
values ('deal_open_ladder', '[{"upTo":15000,"pence":25},{"upTo":25000,"pence":40},{"upTo":40000,"pence":60},{"upTo":60000,"pence":80},{"upTo":null,"pence":100}]'::jsonb)
on conflict (key) do nothing;

-- =========================
-- Teams (src/lib/team)
-- =========================
-- An account owner invites colleagues. One team per login: member_id is the
-- primary key. The owner has no row; owning is simply not being a member.
-- Each member's seat is a flat £10 of the OWNER's credit, charged on joining
-- and every 30 days (team_seat_charges). All three tables are service-role
-- only: RLS on, no policies — the app reads them server-side and decides.
create table if not exists public.team_members (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  -- True when the login was created to accept the invite. Such a login is
  -- deleted when the member is removed; a pre-existing account just leaves.
  created_via_invite boolean not null default false,
  joined_at timestamptz not null default now(),
  -- The seat is paid up to here; the seats cron renews at or after it.
  seat_paid_until timestamptz not null,
  -- Set when a renewal could not be paid. Cleared when it is.
  suspended_at timestamptz,
  constraint team_members_not_self check (owner_id <> member_id)
);
create index if not exists team_members_owner_idx on public.team_members (owner_id);
alter table public.team_members enable row level security;
revoke all on public.team_members from anon, authenticated;

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  -- Stored lower-case; compared to the accepting user's email.
  email text not null,
  -- sha256 of the emailed token; the token itself is never stored.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz
);
-- One open invite per owner per address: a resend replaces the token.
create unique index if not exists team_invites_open_idx
  on public.team_invites (owner_id, email) where accepted_at is null and revoked_at is null;
create index if not exists team_invites_email_idx on public.team_invites (email) where accepted_at is null and revoked_at is null;
alter table public.team_invites enable row level security;
revoke all on public.team_invites from anon, authenticated;

-- One row per paid seat period. The unique key is the double-charge guard:
-- the row is inserted BEFORE the debit, so a retried accept or two cron runs
-- racing on the same seat cannot both charge it.
create table if not exists public.team_seat_charges (
  id bigint generated always as identity primary key,
  member_id uuid not null,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  period_start timestamptz not null,
  transaction_id bigint,
  created_at timestamptz not null default now(),
  constraint team_seat_charges_period_key unique (member_id, period_start)
);
create index if not exists team_seat_charges_owner_idx on public.team_seat_charges (owner_id, created_at desc);
alter table public.team_seat_charges enable row level security;
revoke all on public.team_seat_charges from anon, authenticated;

-- Debits a FACE amount: exactly p_face_pence of displayed balance, whatever
-- mix of grants pays it. credit_debit takes BASE pence and multiplies by each
-- grant's spend rate, so "£10" would cost £15 of top-up credit — wrong for a
-- seat sold as a flat £10. Each allocation records base = face / rate, so
-- credit_refund reverses it like any other debit. Never overdrafts. Ignores
-- open reservations (they are minutes long and settle themselves).
create or replace function public.credit_debit_face(p_user uuid, p_face_pence numeric, p_meta jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_remaining numeric := round(p_face_pence, 4);
  v_available numeric;
  v_tx bigint;
  v_total_base numeric := 0;
  v_take_grant numeric;
  v_take_base numeric;
  g record;
begin
  if v_remaining <= 0 then return null; end if;
  perform 1 from profiles where id = p_user for update;

  select coalesce(sum(remaining_pence), 0) into v_available
  from credit_grants
  where user_id = p_user and remaining_pence > 0 and (expires_at is null or expires_at > now());
  if v_available < v_remaining then
    raise exception 'insufficient_credit' using errcode = 'P0402',
      detail = json_build_object('required_face', v_remaining, 'available_face', v_available)::text;
  end if;

  insert into credit_transactions (user_id, kind, amount_pence, base_pence, action_id, action, description, metadata)
  values (
    p_user, 'debit', -v_remaining, 0,
    nullif(p_meta ->> 'action_id', '')::uuid, p_meta ->> 'action', p_meta ->> 'description',
    p_meta - array['action_id', 'action', 'description']
  ) returning id into v_tx;

  for g in
    select id, remaining_pence, spend_rate from credit_grants
    where user_id = p_user and remaining_pence > 0 and (expires_at is null or expires_at > now())
    order by priority, expires_at nulls last, created_at
    for update
  loop
    exit when v_remaining <= 0;
    v_take_grant := least(v_remaining, g.remaining_pence);
    v_take_base := round(v_take_grant / g.spend_rate, 4);
    update credit_grants set remaining_pence = remaining_pence - v_take_grant where id = g.id;
    insert into credit_allocations (transaction_id, grant_id, base_pence, grant_pence, spend_rate) values (v_tx, g.id, v_take_base, v_take_grant, g.spend_rate);
    v_total_base := v_total_base + v_take_base;
    v_remaining := v_remaining - v_take_grant;
  end loop;

  if v_remaining > 0.0001 then
    raise exception 'insufficient_credit' using errcode = 'P0402',
      detail = json_build_object('required_face', p_face_pence, 'shortfall_face', v_remaining)::text;
  end if;

  update credit_transactions set base_pence = v_total_base where id = v_tx;
  return v_tx;
end;
$$;
revoke execute on function public.credit_debit_face(uuid, numeric, jsonb) from public, anon, authenticated;

-- ── Shared team reports ──
-- A report belongs to the ACCOUNT that paid for it (owner_id) and was run by
-- user_id. For someone on their own they are the same; a team member's
-- reports are the team's, paid from the owner's credit, and every active
-- member sees them. Backfilled so every existing report is its author's.
alter table public.saved_searches add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
update public.saved_searches set owner_id = user_id where owner_id is null;
create index if not exists saved_searches_owner_idx on public.saved_searches (owner_id, created_at desc);
-- Helpers live in `private`, a schema the API does not expose: nobody can
-- call them over /rest/v1/rpc, and they are still usable from policies and
-- triggers.
create schema if not exists private;
grant usage on schema private to authenticated;

-- The caller's team owner while their seat is active, else null.
-- team_members is service-role only, so a policy cannot read it directly;
-- this definer function answers the one question the policy needs.
create or replace function private.active_team_owner()
returns uuid language sql security definer set search_path = public stable as $$
  select owner_id from public.team_members
  where member_id = (select auth.uid()) and suspended_at is null;
$$;
revoke execute on function private.active_team_owner() from public;
grant execute on function private.active_team_owner() to authenticated;

-- Wrapped in (select ...) so each is evaluated once per query, not per row.
-- `to authenticated`: anonymous requests never evaluate it.
drop policy if exists "Team can read team searches" on public.saved_searches;
create policy "Team can read team searches"
  on public.saved_searches for select to authenticated
  using (owner_id = (select auth.uid()) or owner_id = (select private.active_team_owner()));

-- owner_id is decided by the database, never by the writer. Signed-in users
-- can write their own rows with the public key, so a client-supplied
-- owner_id would let anyone plant a report in another account's team list.
-- On insert it is derived from team membership (the team owner, else the
-- author); once set it never moves. This also covers inserts from code that
-- predates the column.
create or replace function private.saved_searches_set_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.owner_id is not null then
    new.owner_id := old.owner_id;
  else
    new.owner_id := coalesce(
      (select tm.owner_id from public.team_members tm where tm.member_id = new.user_id),
      new.user_id
    );
  end if;
  return new;
end;
$$;
revoke execute on function private.saved_searches_set_owner() from public;
drop trigger if exists saved_searches_set_owner on public.saved_searches;
create trigger saved_searches_set_owner
  before insert or update on public.saved_searches
  for each row execute function private.saved_searches_set_owner();

-- =========================
-- Early access to marketplace deals (src/lib/marketplace/visibility.ts)
-- =========================
-- An account that has ever paid (any subscription, any top-up, admins — see
-- hasEverPaid in src/lib/access.ts) sees a deal the moment it goes live.
-- Every other account, and every signed-out visitor, sees it
-- free_deal_delay_hours later. Inside that window the deal is simply absent
-- for them: not on the grid, the map, the counts, the teaser, by id, as an
-- open or as a daily pick.
--
-- live_since is stamped by the trigger on every transition to 'live' (first
-- entry, pending_verify → live, reactivation, admin restore), so none of the
-- code paths that flip the status can forget it. A live row it has not
-- stamped counts as brand new: hidden from the delayed tier, never shown
-- early. APPLY BEFORE deploying the code that reads it: DEAL_COLUMNS
-- (src/lib/marketplace/server.ts) is a fixed select, and every deal read
-- filters on this column.
alter table public.marketplace_deals add column if not exists live_since timestamptz;
create or replace function private.marketplace_deals_stamp_live()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    new.live_since := now();
  end if;
  return new;
end;
$$;
drop trigger if exists marketplace_deals_stamp_live on public.marketplace_deals;
create trigger marketplace_deals_stamp_live
  before insert or update on public.marketplace_deals
  for each row execute function private.marketplace_deals_stamp_live();
-- Rows that were live before the column existed: their first sighting is the
-- best date we have. live → live, so the trigger leaves this value alone.
update public.marketplace_deals set live_since = coalesce(live_since, first_seen_at) where status = 'live' and live_since is null;
create index if not exists marketplace_deals_live_since_idx on public.marketplace_deals (live_since) where status = 'live';
-- The window, in hours. 0 switches it off. Edit the row to change it; no deploy needed.
insert into public.billing_settings (key, value) values ('free_deal_delay_hours', '48') on conflict (key) do nothing;

-- =========================
-- Notifications panel (src/lib/notifications)
-- =========================
-- One switch per notification type, each a boolean on profiles:
--   sourcing_alerts  daily picks (with sourcing_opted_out_at, above)
--   alert_weekly     weekly area alerts
--   alert_credit     "picks paused / out of credit": the paused-picks letter
--                    and the low-balance / out-of-credit emails
-- The panel is the only place these change (service role, via
-- src/lib/notifications/server.ts); the goals modal no longer writes them.
-- Billing and receipt emails have no switch.
alter table public.profiles add column if not exists alert_credit boolean not null default true;

-- =========================
-- "Your picks have paused" (src/lib/listing/picks-paused.ts)
-- =========================
-- When the daily-picks run finds a member a property but their credit will
-- not cover it, the pick is recorded here — figures only, never the address,
-- postcode or URL — and the 08:00 cron (/api/internal/picks-paused) sends
-- one letter per member: on the first day, then at most every seven days
-- while they stay out of credit, listing everything missed since the last
-- letter, and never once they have credit again. Service role only.
create table if not exists public.sourcing_missed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  canonical_url text not null,
  missed_at timestamptz not null default now(),
  kind text not null,                        -- sale | rent
  postcode_area text,
  bedrooms int,
  price_amount numeric,                      -- sale: asking price; rent: pcm
  price_period text,                         -- total | pcm
  annual_profit numeric,                     -- screening.surplus, £/yr
  need_pence numeric not null default 0,     -- what the pick would have cost
  emailed_at timestamptz,                    -- the letter that listed it
  superseded_at timestamptz,                 -- a pick went out after it, so it never resurfaces
  unique (user_id, canonical_url)
);
create index if not exists sourcing_missed_user_idx on public.sourcing_missed (user_id, missed_at desc);
create index if not exists sourcing_missed_pending_idx on public.sourcing_missed (missed_at) where emailed_at is null and superseded_at is null;
alter table public.sourcing_missed enable row level security;  -- no policies: service role only
revoke all on public.sourcing_missed from anon, authenticated;
-- When the last paused letter went out (null: never).
alter table public.profiles add column if not exists picks_paused_email_at timestamptz;

-- One-off "picks are now daily" notice (src/lib/listing/daily-notice-run.ts):
-- when it was sent to this member, so a second press of the admin button
-- never sends twice. Null: not yet.
alter table public.profiles add column if not exists daily_notice_sent_at timestamptz;

-- =========================
-- Batch 2: signup questions and nav
-- =========================
-- onboarding_skips: how many times the member has tapped "Skip for now" on
-- the welcome questions (/welcome). The screen stops appearing after 3 (see
-- src/lib/onboarding/status.ts); answering writes market_goals, which ends
-- it for good. Written by the member's own session, so it needs a column
-- grant like market_goals above. Deliberately NOT in ACCESS_COLUMNS: if this
-- section has not been run yet, /welcome fails closed (straight to /deals)
-- and nothing else is affected.
alter table public.profiles add column if not exists onboarding_skips smallint not null default 0;
grant update (onboarding_skips) on public.profiles to authenticated;

-- =========================
-- Batch 3: deal card
-- =========================
-- deal_reactions: a member's Keep or Pass on a marketplace deal, from the
-- card's buttons (src/lib/marketplace/reactions-server.ts). Both are free and
-- neither reveals the address. One row per (member, deal): the actions write
-- the target state (upsert on the key, or delete), so a double tap can never
-- make a second row. `reasons` are PICK_REASONS keys (src/lib/listing/picks.ts)
-- and only ever set on a pass; the daily picks run turns them into the same
-- rules a "no" on a pick makes. updated_at is written by the code (there is
-- no trigger) and is what "the latest answer wins" compares against
-- sourcing_sent.responded_at. Keyed on the signed-in member, not the team
-- owner: opens are shared across a team, opinions are not.
create table if not exists public.deal_reactions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  deal_id uuid not null references public.marketplace_deals(id) on delete cascade,
  reaction text not null check (reaction in ('keep', 'pass')),
  reasons text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, deal_id)
);
create index if not exists deal_reactions_user_idx on public.deal_reactions (user_id, reaction, updated_at desc);
create index if not exists deal_reactions_deal_idx on public.deal_reactions (deal_id);
alter table public.deal_reactions enable row level security;  -- no policies: service role only
revoke all on public.deal_reactions from anon, authenticated;

-- deal_shares: a public link to one marketplace deal (/d/<token>), one per
-- (sharer, deal) so sharing again hands back the same link. Same token shape
-- as a checked listing's share_token (24 random bytes, base64url). The page
-- shows only what the card shows — never the address, postcode or listing
-- link, even when the sharer has opened the deal — and carries the sharer's
-- referral code on its join button.
create table if not exists public.deal_shares (
  token text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  deal_id uuid not null references public.marketplace_deals(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists deal_shares_user_deal_uidx on public.deal_shares (user_id, deal_id);
alter table public.deal_shares enable row level security;  -- no policies: service role only
revoke all on public.deal_shares from anon, authenticated;

-- The grid embeds deal_reactions to hide a member's passes; tell PostgREST
-- about the new relationships now rather than on its next schema reload.
notify pgrst, 'reload schema';

-- =========================
-- Batch 4: today screen
-- =========================
-- today_selections: the deals Today shows a member for one day
-- (src/lib/today). Chosen once, on the member's first visit after the day
-- turns over at 07:00 UTC (the hour the picks email goes out), then read
-- back, so every reload and every device shows the same list. `day` is the
-- date that Today-day started on, in UTC. A deal stored here never comes
-- back to that member's Today on a later day. The daily pick is NOT stored:
-- it is read from sourcing_sent on every visit, because it can land after
-- the list was chosen. `advice` is the one-line "what to change" shown when
-- nothing matched exactly and the list holds the closest deal instead.
-- Service role only.
create table if not exists public.today_selections (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  deal_ids uuid[] not null default '{}',
  near_miss boolean not null default false,
  advice text,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.today_selections enable row level security;  -- no policies: service role only
revoke all on public.today_selections from anon, authenticated;

-- checklist_steps: the first-week checklist on Today. One row per (member,
-- step), written when the step is first seen done in the member's own
-- activity, never self-reported. The £1 reward is a `welcome`-kind grant
-- with source_ref 'checklist:<step>:<user>', so credit_grants' unique
-- source_ref makes a second payment impossible; grant_id records it here.
-- skipped_reason says why a step will never be paid (welcome credit
-- withheld, a team member, done after the first seven days). seen_at is
-- when the "+£1 credit" line was shown. Deliberately a table, not columns
-- on profiles (see ACCESS_COLUMNS in src/lib/access.ts). Service role only.
create table if not exists public.checklist_steps (
  user_id uuid not null references public.profiles(id) on delete cascade,
  step text not null check (step in ('goals', 'keep3', 'open', 'report', 'share')),
  completed_at timestamptz not null default now(),
  grant_id uuid,
  skipped_reason text,
  seen_at timestamptz,
  primary key (user_id, step)
);
alter table public.checklist_steps enable row level security;  -- no policies: service role only
revoke all on public.checklist_steps from anon, authenticated;

-- =========================
-- Other Stayful tools on this database
-- =========================
-- Tables and functions that other Stayful tools created on the live project,
-- not this app. Declared here so this file describes the whole public
-- schema: a fresh project built from it matches live, and re-running it on
-- live changes nothing. Those tools still own these; change a definition
-- there first, then mirror it here.
-- This app only reads analyser_reports (the market explorer, planning
-- signals and the internal broker provider). The live project also has the
-- `allotment`, `outreach` and `private` schemas, which belong to other tools
-- and are not tracked in this file.

-- analyser_reports: one row per analyser run (source 'analyser' by default).
create table if not exists public.analyser_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  address text,
  postcode text,
  postcode_area text,
  bedrooms integer,
  adr numeric,
  occupancy numeric,
  gross_revenue numeric,
  purchase_price numeric,
  lead_email text,
  source text default 'analyser',
  raw_response jsonb,
  net_revenue numeric,
  property_value_low numeric,
  property_value_high numeric,
  comp_count integer,
  comp_radius_km numeric,
  comp_avg_adr numeric,
  comp_avg_occupancy numeric,
  comp_avg_annual_revenue numeric,
  filename text,
  extraction_status text default 'ok',
  extraction_error text,
  comp_avg_rating numeric,
  comp_avg_review_count numeric,
  comp_avg_listing_age numeric,
  active_listings integer,
  listing_density numeric,
  demand_hospitals integer,
  demand_universities integer,
  demand_transport integer,
  demand_events integer,
  lat numeric,
  lng numeric,
  market_signals_version integer,
  request_id text
);
create unique index if not exists analyser_reports_source_request_id_key on public.analyser_reports (source, request_id) where request_id is not null;
create index if not exists idx_analyser_reports_area_created on public.analyser_reports (postcode_area, created_at);
create index if not exists idx_analyser_reports_bedrooms on public.analyser_reports (bedrooms);
create index if not exists idx_analyser_reports_postcode_area on public.analyser_reports (postcode_area);
alter table public.analyser_reports enable row level security;  -- no policies: service role only

-- airbtics_report_cache: Airbtics report ids kept until expires_at.
create table if not exists public.airbtics_report_cache (
  cache_key text primary key,
  report_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_airbtics_report_cache_expires on public.airbtics_report_cache (expires_at);
alter table public.airbtics_report_cache enable row level security;  -- no policies: service role only

-- admin_users / admin_password_resets: an admin sign-in (salted password
-- hashes, reset tokens). Service role only: unlike the tables around them,
-- anon and authenticated hold no grants on these at all.
create table if not exists public.admin_users (
  email text primary key,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from anon, authenticated;

create table if not exists public.admin_password_resets (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text
);
create index if not exists idx_admin_password_resets_email on public.admin_password_resets (email);
create index if not exists idx_admin_password_resets_expires on public.admin_password_resets (expires_at);
alter table public.admin_password_resets enable row level security;
revoke all on public.admin_password_resets from anon, authenticated;

-- bulk_jobs / bulk_job_rows: bulk analyser runs from a spreadsheet, one job
-- per upload and one row per property in it, claimed by workers through
-- claim_bulk_rows below.
create table if not exists public.bulk_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  filename text,
  status text not null default 'draft',
  total_rows integer not null default 0,
  runnable_rows integer not null default 0,
  header_map jsonb,
  paused_reason text,
  confirmed_at timestamptz,
  finished_at timestamptz
);
alter table public.bulk_jobs enable row level security;  -- no policies: service role only

create table if not exists public.bulk_job_rows (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.bulk_jobs(id) on delete cascade,
  row_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  input_email text,
  input_phone text,
  input_phone_e164 text,
  input_address text,
  input_postcode text,
  input_bedrooms integer,
  input_guests integer,
  warnings jsonb not null default '[]'::jsonb,
  monday_item_id text,
  monday_item_name text,
  match_method text,
  monday_prev_values jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  claim_token uuid,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  report_id uuid references public.analyser_reports(id) on delete set null,
  gross_revenue numeric,
  net_revenue numeric,
  long_let_monthly numeric,
  recommendation text,
  qualification text,
  uplift_pct numeric,
  data_quality_level text,
  comparables_found integer,
  monday_synced boolean not null default false,
  pdf_uploaded boolean not null default false,
  input_desired_rent numeric
);
create index if not exists idx_bulk_job_rows_claim on public.bulk_job_rows (status, claimed_at);
create index if not exists idx_bulk_job_rows_job on public.bulk_job_rows (job_id);
create unique index if not exists uq_bulk_job_rows_job_row on public.bulk_job_rows (job_id, row_number);
alter table public.bulk_job_rows enable row level security;  -- no policies: service role only
comment on column public.bulk_job_rows.input_desired_rent is 'Monthly rent the landlord is asking for, in GBP. Null when the sheet had no value, in which case the assessment estimates it and flags it as estimated.';

-- Hands a worker its next rows, capped across every worker at once.
create or replace function public.claim_bulk_rows(p_limit integer, p_claim_token uuid, p_max_inflight integer default 6, p_stale_seconds integer default 900)
returns setof public.bulk_job_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inflight int;
  v_take     int;
begin
  -- Global ceiling on rows running at once, across every worker. This is the
  -- Airbtics spend-rate throttle, not just a concurrency limit.
  select count(*) into v_inflight
    from bulk_job_rows r
   where r.status in ('claimed', 'running')
     and r.claimed_at > now() - make_interval(secs => p_stale_seconds);

  v_take := least(p_limit, greatest(p_max_inflight - v_inflight, 0));
  if v_take <= 0 then
    return;
  end if;

  return query
  with candidate as (
    select r.id
      from bulk_job_rows r
      join bulk_jobs j on j.id = r.job_id
     where j.status = 'running'
       and r.attempts < r.max_attempts
       and (
             r.status = 'pending'
             -- Reclaim anything abandoned by a killed invocation. The window is
             -- ~15x the worst-case row time, so it can't race a live worker.
             or (r.status in ('claimed', 'running')
                 and r.claimed_at < now() - make_interval(secs => p_stale_seconds))
           )
     order by j.created_at, r.row_number
     limit v_take
     for update of r skip locked
  )
  update bulk_job_rows r
     set status      = 'claimed',
         claim_token = p_claim_token,
         claimed_at  = now(),
         -- Incremented AT CLAIM, not on completion, so a row that hard-kills
         -- its worker (OOM, timeout) burns max_attempts and then stops rather
         -- than looping forever on someone else's credit.
         attempts    = r.attempts + 1,
         updated_at  = now()
    from candidate c
   where r.id = c.id
  returning r.*;
end;
$$;
revoke all on function public.claim_bulk_rows(integer, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_bulk_rows(integer, uuid, integer, integer) to service_role;

-- Text to a number, or null when it is not one.
create or replace function public.safe_numeric(t text)
returns numeric
language plpgsql
immutable
as $$
begin
  return t::numeric;
exception when others then
  return null;
end;
$$;

-- =========================
-- Batch 5: my deals
-- =========================
-- My deals (/my-deals) groups every deal a member tracks by stage. The stage
-- of a pipeline row is checked_listings.status, which gains two keys:
-- 'contacted' and 'secured' (src/lib/listing/pipeline.ts). The column is
-- plain text with no check constraint, so the new keys need no DDL, and
-- existing rows are not migrated: 'watching' is shown as "Kept".
--
-- report_started_at: a full report in flight for this pipeline row.
-- /api/analyse claims it with one conditional UPDATE before reserving any
-- credit, so a double click, a second tab or a refresh cannot start (and
-- charge) a second report for the same listing while the first runs. Cleared
-- when the run ends; a claim older than three minutes (the route's limit is
-- sixty seconds) is treated as abandoned. Not in ACCESS_COLUMNS.
alter table public.checked_listings add column if not exists report_started_at timestamptz;

-- =========================
-- Batch 6: emails and alerts
-- =========================
-- notification_sends: the ONE record of every capped member email, and so
-- the cap itself (src/lib/notify/cap.ts, sends.ts). A member gets at most
-- one non-billing email a day (the "daily" slot: Today's 5, the changes-only
-- email, the picks-paused letter, an admin notice) and on Mondays one more
-- (the "weekly" slot: Your week). The unique key is the cap: whoever inserts
-- the row owns the slot, so two passes, two crons or a retry can never send
-- a second one. Billing and receipt emails never touch this table.
--
-- status: claimed (the slot is ours, nothing sent yet) → sending (the email
-- is going to Resend) → sent | failed. A claim that never reached Resend and
-- is older than a few minutes may be taken over (claim_notification_slot); a
-- `sending` row never is, because the email may have gone. `day` is the UTC
-- date, the same day the picks' "sent today" guard uses. `summary` records
-- what went (deal ids, alert ids, counts), never an address. Service role
-- only. Deliberately a table, not columns on profiles (ACCESS_COLUMNS).
create table if not exists public.notification_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  slot text not null,                         -- daily | weekly
  kind text not null,                         -- todays_5 | deal_changes | picks_paused | your_week | notice
  channel text not null default 'email',      -- Batch 8 adds 'sms', with its own rows
  status text not null default 'claimed',     -- claimed | sending | sent | failed
  summary jsonb not null default '{}'::jsonb,
  -- One-click unsubscribe for this email (/api/notify/unsubscribe/<token>).
  unsubscribe_token text,
  claimed_at timestamptz not null default now(),
  sending_at timestamptz,
  sent_at timestamptz
);
create unique index if not exists notification_sends_slot_uidx on public.notification_sends (user_id, day, slot, channel);
create index if not exists notification_sends_day_idx on public.notification_sends (day, slot);
create unique index if not exists notification_sends_unsub_uidx on public.notification_sends (unsubscribe_token) where unsubscribe_token is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_sends'::regclass and conname = 'notification_sends_slot_check') then
    alter table public.notification_sends add constraint notification_sends_slot_check check (slot in ('daily', 'weekly'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_sends'::regclass and conname = 'notification_sends_status_check') then
    alter table public.notification_sends add constraint notification_sends_status_check check (status in ('claimed', 'sending', 'sent', 'failed'));
  end if;
end $$;
alter table public.notification_sends enable row level security;  -- no policies: service role only
revoke all on public.notification_sends from anon, authenticated;

-- Claim a slot, or take over a stale claim that never reached Resend.
-- Returns the row id when the slot is now the caller's, null when it is
-- taken. One statement each way, so two callers can never both win.
create or replace function public.claim_notification_slot(
  p_user uuid,
  p_day date,
  p_slot text,
  p_kind text,
  p_channel text default 'email',
  p_stale_after interval default interval '5 minutes'
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.notification_sends (user_id, day, slot, kind, channel)
  values (p_user, p_day, p_slot, p_kind, p_channel)
  on conflict (user_id, day, slot, channel) do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  update public.notification_sends
     set kind = p_kind, claimed_at = now(), summary = '{}'::jsonb, unsubscribe_token = null
   where user_id = p_user and day = p_day and slot = p_slot and channel = p_channel
     and status = 'claimed' and claimed_at < now() - p_stale_after
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_notification_slot(uuid, date, text, text, text, interval) from public, anon, authenticated;
grant execute on function public.claim_notification_slot(uuid, date, text, text, text, interval) to service_role;

-- deal_alerts: one row per member per change on a deal they track (Part C:
-- price drop, back on market, nearly gone, gone). Pipeline rows and kept
-- marketplace deals share it: one alert model. Written by the 06:55
-- collector (/api/internal/deal-alerts); the unique key makes a re-run a
-- no-op. Pending = notified_at is null, whatever send_id says; notified_at
-- is set only after the email carrying it was sent (finish_notification_send),
-- so an alert in a failed email goes in the next one. deal_key is Batch 5's
-- key for the deal on My deals ('d-<deal id>' for a marketplace deal, with
-- or without a pipeline row; 'l-<row id>' for a listing the member added):
-- one stream per deal whichever list it is on, and never a URL, so an
-- unopened deal's listing can never leak through here. Service role only.
create table if not exists public.deal_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  alert_type text not null,                   -- price_drop | back_on_market | nearly_gone | gone
  source text not null,                       -- pipeline | marketplace
  deal_key text not null,                    -- 'd-<deal id>' | 'l-<checked_listings id>'
  deal_id uuid,
  checked_listing_id uuid,
  event_at timestamptz not null,              -- the change's own timestamp
  payload jsonb not null default '{}'::jsonb, -- old/new price, profit, statuses, watcher count
  send_id uuid,                               -- the notification_sends row that carried it
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists deal_alerts_event_uidx on public.deal_alerts (user_id, alert_type, deal_key, event_at);
create index if not exists deal_alerts_pending_idx on public.deal_alerts (user_id, created_at) where notified_at is null;
create index if not exists deal_alerts_user_idx on public.deal_alerts (user_id, created_at desc);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.deal_alerts'::regclass and conname = 'deal_alerts_type_check') then
    alter table public.deal_alerts add constraint deal_alerts_type_check check (alert_type in ('price_drop', 'back_on_market', 'nearly_gone', 'gone'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.deal_alerts'::regclass and conname = 'deal_alerts_source_check') then
    alter table public.deal_alerts add constraint deal_alerts_source_check check (source in ('pipeline', 'marketplace'));
  end if;
end $$;
alter table public.deal_alerts enable row level security;  -- no policies: service role only
revoke all on public.deal_alerts from anon, authenticated;

-- Close a send: the slot sent or failed, and — only when it was sent — the
-- alerts it carried marked notified, in one transaction.
create or replace function public.finish_notification_send(
  p_id uuid,
  p_sent boolean,
  p_summary jsonb default null,
  p_alert_ids uuid[] default null
)
returns void
language plpgsql
as $$
begin
  update public.notification_sends
     set status = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then now() else null end,
         summary = coalesce(p_summary, summary)
   where id = p_id;
  if p_sent and p_alert_ids is not null and cardinality(p_alert_ids) > 0 then
    update public.deal_alerts
       set notified_at = now(), send_id = p_id
     where id = any(p_alert_ids) and notified_at is null;
  end if;
end;
$$;
revoke all on function public.finish_notification_send(uuid, boolean, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.finish_notification_send(uuid, boolean, jsonb, uuid[]) to service_role;

-- Two notification switches (src/lib/notifications/registry.ts), on by
-- default like the others. Written only by the notifications writer (service
-- role), so no column grant. NOT in ACCESS_COLUMNS: a database that has not
-- had this run reads them as their default and nothing else is affected.
--   alert_tracked  "Changes on deals I'm tracking": the daily alerts and
--                  Your week's recap of your deals
--   alert_missed   "Weekly: deals I missed": Your week's first section
alter table public.profiles add column if not exists alert_tracked boolean not null default true;
alter table public.profiles add column if not exists alert_missed boolean not null default true;

-- Back on market: a deal retired as sold / under offer / let agreed /
-- removed that the feed shows again is revived to pending_verify, and goes
-- live (re-stamping live_since, so the early-access window restarts) only
-- once a page read confirms it. These record that it came back and from
-- what. Read separately, never in DEAL_COLUMNS.
alter table public.marketplace_deals add column if not exists revived_at timestamptz;
alter table public.marketplace_deals add column if not exists revived_from text;

-- =========================
-- Batch 7: pipeline actions
-- =========================
-- The next step shown on each My deals item and deal page
-- (src/lib/pipeline, src/app/my-deals/_components/NextStepSlot.tsx).
--
-- billing_settings 'offer_discount_bands': the Offer stage's discount bands
-- (src/lib/pipeline/offer-rules.ts), edited at /admin/next-steps.
-- Deliberately NOT seeded. With no row, the offer range shows the member's
-- target figure only and never a guessed discount. Shape:
--   { "purchase":   [ { "minMonths": 6, "minReductions": 2, "discountPct": 8 }, ... ],
--     "rentToRent": [ { "minWeeks": 4, "discountPct": 5 }, ... ] }
--
-- pipeline_checklist_ticks: ticks on the Viewing and Secured checklists, one
-- row per ticked item, per person (like stages). item_key is the My deals
-- key ('d-<dealId>' or 'l-<checkedListingId>'), which stays the same when a
-- deal gains a pipeline row. item_id is the checklist item's id in
-- src/lib/pipeline/next-steps.ts. Untick deletes the row. Written by the
-- server actions after checking the deal is the member's
-- (src/app/my-deals/next-step-actions.ts), so service role only.
create table if not exists public.pipeline_checklist_ticks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_key text not null,
  item_id text not null,
  ticked_at timestamptz not null default now(),
  primary key (user_id, item_key, item_id)
);
alter table public.pipeline_checklist_ticks enable row level security;  -- no policies: service role only
revoke all on public.pipeline_checklist_ticks from anon, authenticated;

-- pipeline_step_events: which next-step tools members use, one row per use.
-- Append-only, service role only (src/lib/pipeline/events.ts).
--   action   'copy' | 'email' (a message), 'tick' | 'untick' (a checklist
--            item), 'advance' (the one-tap stage button), 'enquiry' (the
--            Secured stage's "Talk to us")
--   stage    the stage the member was at (Batch 5's keys: 'watching' = Kept)
--   item_id  the message id, checklist item id, or for 'advance' the stage moved to
create table if not exists public.pipeline_step_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_key text not null,
  stage text not null,
  deal_kind text not null,
  action text not null,
  item_id text,
  at timestamptz not null default now()
);
create index if not exists pipeline_step_events_user_idx on public.pipeline_step_events (user_id, at desc);
create index if not exists pipeline_step_events_at_idx on public.pipeline_step_events (at desc);
alter table public.pipeline_step_events enable row level security;  -- no policies: service role only
revoke all on public.pipeline_step_events from anon, authenticated;

-- =========================
-- Batch 8: sms
-- =========================
-- Text alerts (src/lib/sms). OFF for everyone, existing members included,
-- until a member verifies a UK mobile and switches texts on. At most one text
-- a member a day (Batch 6's notification_sends, channel 'sms') and a monthly
-- cap (billing_settings.sms_monthly_cap), 08:00–20:00 UK time only. Texts are
-- free to members: the cost is house spend, logged in provider_calls and here.
-- Nothing below is in ACCESS_COLUMNS.

-- The per-type switches (src/lib/notifications/registry.ts, channel 'sms').
-- Off by default. Turned on together when a member verifies their number,
-- then each can be turned off in Account → Notifications. Written only by the
-- notifications writer (service role), so no column grant. They are in
-- NOTIFICATION_COLUMNS, a fixed select; readNotifications falls back to the
-- older column list when these are missing, so the panel keeps working if
-- the code deploys before this is run. NOT in ACCESS_COLUMNS.
alter table public.profiles add column if not exists sms_price_drop boolean not null default false;
alter table public.profiles add column if not exists sms_back_on_market boolean not null default false;
alter table public.profiles add column if not exists sms_nearly_gone boolean not null default false;
alter table public.profiles add column if not exists sms_gone boolean not null default false;

-- sms_contacts: the member's texting number and its state. One row per member
-- who has started verifying. `enabled` is the member's own on/off. `stopped_at`
-- is a reply of STOP (or Twilio refusing with 21610): a hard block on every
-- text to that number, on every account, until START clears it. Verification
-- swaps the number in only once the new one is proved, so a change of number
-- never sends to an unverified phone. Service role only.
create table if not exists public.sms_contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_e164 text,
  verified_at timestamptz,
  enabled boolean not null default false,
  consent_at timestamptz,
  consent_source text,                        -- signup | account
  stopped_at timestamptz,
  stop_source text,                           -- keyword | twilio | admin
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One account per verified number, so a STOP can never be ambiguous.
create unique index if not exists sms_contacts_verified_phone_uidx on public.sms_contacts (phone_e164) where verified_at is not null;
create index if not exists sms_contacts_phone_idx on public.sms_contacts (phone_e164);
alter table public.sms_contacts enable row level security;  -- no policies: service role only
revoke all on public.sms_contacts from anon, authenticated;

-- sms_verifications: one row per code sent. The code itself is never stored,
-- only an HMAC of (id, code). Ten minutes, five guesses (counted by
-- sms_verification_attempt before the compare); a newer code supersedes it.
create table if not exists public.sms_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_e164 text not null,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  superseded_at timestamptz
);
create index if not exists sms_verifications_user_idx on public.sms_verifications (user_id, created_at desc);
alter table public.sms_verifications enable row level security;  -- no policies: service role only
revoke all on public.sms_verifications from anon, authenticated;

-- Take one guess: counts it and hands back the hash only while the code is
-- still open (unexpired, unused, not replaced, under five guesses). One
-- statement, so parallel guesses can never get past five. The limit here and
-- MAX_ATTEMPTS in src/lib/sms/verify.ts are the same number.
create or replace function public.sms_verification_attempt(p_id uuid, p_user uuid)
returns table (code_hash text, phone_e164 text, attempts int, created_at timestamptz)
language sql
as $$
  update public.sms_verifications v
     set attempts = v.attempts + 1
   where v.id = p_id
     and v.user_id = p_user
     and v.verified_at is null
     and v.superseded_at is null
     and v.expires_at > now()
     and v.attempts < 5
  returning v.code_hash, v.phone_e164, v.attempts, v.created_at;
$$;
revoke all on function public.sms_verification_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sms_verification_attempt(uuid, uuid) to service_role;

-- sms_messages: every text sent (verification codes and alerts) and every
-- keyword received, with Twilio's sid, delivery status and price, so the
-- spend can be reconciled against Twilio. `alert_ids` are the deal_alerts a
-- text told: an alert is never texted twice. Inbound rows keep the keyword,
-- never the member's words. `outcome`: pending (about to call Twilio) →
-- accepted | refused | unknown (the call failed mid-way; the text may have
-- gone, so it counts as sent) | dry_run. Service role only.
create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  direction text not null,                    -- outbound | inbound
  kind text not null,                         -- verify | alert | keyword
  phone_e164 text not null,
  body text,
  alert_ids uuid[] not null default '{}'::uuid[],
  send_id uuid,                               -- the notification_sends row an alert text used
  dry_run boolean not null default false,
  outcome text not null default 'pending',
  twilio_sid text,
  status text,
  status_at timestamptz,
  error_code int,
  segments int,
  price numeric,
  price_unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sms_messages_sid_uidx on public.sms_messages (twilio_sid) where twilio_sid is not null;
create index if not exists sms_messages_user_idx on public.sms_messages (user_id, created_at desc);
create index if not exists sms_messages_phone_idx on public.sms_messages (phone_e164, created_at desc);
create index if not exists sms_messages_unpriced_idx on public.sms_messages (created_at) where twilio_sid is not null and price is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.sms_messages'::regclass and conname = 'sms_messages_direction_check') then
    alter table public.sms_messages add constraint sms_messages_direction_check check (direction in ('outbound', 'inbound'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.sms_messages'::regclass and conname = 'sms_messages_kind_check') then
    alter table public.sms_messages add constraint sms_messages_kind_check check (kind in ('verify', 'alert', 'keyword'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.sms_messages'::regclass and conname = 'sms_messages_outcome_check') then
    alter table public.sms_messages add constraint sms_messages_outcome_check check (outcome in ('pending', 'accepted', 'refused', 'unknown', 'dry_run', 'received'));
  end if;
end $$;
alter table public.sms_messages enable row level security;  -- no policies: service role only
revoke all on public.sms_messages from anon, authenticated;

-- The monthly cap: texts a member may get per UK calendar month. Editable
-- without a deploy.
insert into public.billing_settings (key, value) values ('sms_monthly_cap', '8'::jsonb)
on conflict (key) do nothing;

-- =========================
-- Batch 9: activity tracking
-- =========================
-- One log of what members do in the app, and their visits
-- (src/lib/activity). Weekly active members is worked out from these on
-- /admin/weekly-active. src/lib/activity/kinds.ts lists the kinds and which
-- of them count towards weekly active.
--
-- Service role only, like every table since Batch 3: RLS on, no policies,
-- nothing granted to anon or authenticated. A member cannot read a row, their
-- own included; every write goes through the functions below.
--
-- Nothing here touches profiles and nothing is in ACCESS_COLUMNS, so running
-- this late breaks no page: until it runs, logging fails quietly with a
-- warning and the admin page says the schema is missing.
--
-- Every function takes ONE jsonb argument, so adding a field never changes
-- its signature. A changed signature would leave a second overload behind,
-- and PostgREST refuses to choose between two (PGRST203), which would stop
-- logging without a word.

-- activity_events: one row per member action.
--   user_id     who acted. For a team member, the member, never the owner who paid.
--   occurred_at when they did it (taken when the action happens, not when the row is written)
--   kind        see src/lib/activity/kinds.ts. Checked in code, not here, so a
--               later batch can add one without a schema change.
--   deal_id     marketplace_deals.id. No foreign key: the history outlives the deal.
--   visit_id    activity_visits.id. No foreign key: retention prunes both by age,
--               and a key would make every visit delete scan this table.
--   source      web | email_link | sms_link | system | extension | api
--               (how the member got there: an in-app action inherits how its
--               visit started). Checked in code.
--   extras      a few small facts: stage from/to, report tier, pass reasons.
--               Never an address, a postcode or a link; the code refuses them.
--               'env' is set on preview deployments.
--   profile_id  saved profiles (Batch 13). Unused until then.
--   dedupe_key  the action's own id where it has one ('report:<actionId>',
--               'topup:pi:<id>'): a repeat of it is ignored. A plain unique
--               index, not a partial one: nulls never collide, and ON CONFLICT
--               cannot use a partial index without repeating its predicate.
--   backfilled  written by activity_backfill from older tables, not live.
create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  kind text not null,
  deal_id uuid,
  visit_id uuid,
  source text not null default 'web',
  extras jsonb not null default '{}'::jsonb,
  profile_id uuid,
  dedupe_key text,
  backfilled boolean not null default false
);
create unique index if not exists activity_events_dedupe_uidx on public.activity_events (user_id, dedupe_key);
create index if not exists activity_events_key_idx on public.activity_events (dedupe_key) where dedupe_key is not null;
create index if not exists activity_events_at_idx on public.activity_events (occurred_at);
create index if not exists activity_events_user_idx on public.activity_events (user_id, occurred_at desc);
create index if not exists activity_events_kind_idx on public.activity_events (kind, occurred_at);
create index if not exists activity_events_deal_idx on public.activity_events (deal_id) where deal_id is not null;
alter table public.activity_events enable row level security;  -- no policies: service role only
revoke all on public.activity_events from anon, authenticated;

-- activity_visits: one row per visit. A visit starts on the first
-- members-only page, return to the tab, or in-app action after 30 minutes of
-- nothing, and ends at its last heartbeat (last_seen_at). The heartbeat is
-- src/components/activity/VisitHeartbeat.tsx.
--   page_count    pages loaded or navigated to in the visit
--   action_count  counted actions logged during it
--   entry_source  web | email_link | sms_link: how the visit began
create table if not exists public.activity_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  page_count integer not null default 0,
  action_count integer not null default 0,
  entry_source text not null default 'web'
);
create index if not exists activity_visits_user_idx on public.activity_visits (user_id, last_seen_at desc);
create index if not exists activity_visits_started_idx on public.activity_visits (started_at);
alter table public.activity_visits enable row level security;  -- no policies: service role only
revoke all on public.activity_visits from anon, authenticated;

-- activity_meta: a few stored values. 'backfill_cutoff' is fixed by the
-- first real backfill run: the time of the first event logged live in
-- production. The backfill only ever copies history from before it, so a
-- second run, or retention later deleting that first event, can never make it
-- copy something that was also logged live.
create table if not exists public.activity_meta (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.activity_meta enable row level security;  -- no policies: service role only
revoke all on public.activity_meta from anon, authenticated;

-- activity_excluded_accounts: test and team accounts switched out of every
-- weekly-active figure on /admin/weekly-active. Admin emails (ADMIN_EMAILS)
-- and @stayful.co.uk addresses are left out in code without a row here.
create table if not exists public.activity_excluded_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text,
  added_by text,
  added_at timestamptz not null default now()
);
alter table public.activity_excluded_accounts enable row level security;  -- no policies: service role only
revoke all on public.activity_excluded_accounts from anon, authenticated;

-- activity_log(p): records one event. Returns its id, or null when it was a
-- repeat. The fields of p:
--   user, kind            required
--   at                    when it happened (default now)
--   deal                  marketplace_deals.id
--   listing_url           a listing's canonical URL, turned into the deal id
--                         here and never stored
--   source, extras, profile, dedupe_key
--   window_seconds        double-submit guard (default 60; 0 turns it off):
--                         an event the same as the member's latest one (kind,
--                         deal and extras) within this many seconds is a
--                         repeat. Only when there is no dedupe_key.
--   visit                 'extend': attach to the member's open visit, starting
--                         one when there is none (an in-app action);
--                         'attach': attach only if one is open; 'none'
--   counted               adds one to the visit's action_count
-- A per-member advisory lock makes the checks and the insert one step, so
-- two racing requests (a double click, two tabs) cannot both get through.
create or replace function public.activity_log(p jsonb)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_kind text := nullif(p->>'kind', '');
  v_at timestamptz := coalesce(nullif(p->>'at', '')::timestamptz, now());
  v_deal uuid := nullif(p->>'deal', '')::uuid;
  v_url text := nullif(p->>'listing_url', '');
  v_source text := nullif(p->>'source', '');
  v_extras jsonb := coalesce(p->'extras', '{}'::jsonb);
  v_key text := nullif(p->>'dedupe_key', '');
  v_window integer := coalesce(nullif(p->>'window_seconds', '')::integer, 60);
  v_mode text := coalesce(nullif(p->>'visit', ''), 'attach');
  v_counted boolean := coalesce(nullif(p->>'counted', '')::boolean, false);
  v_profile uuid := nullif(p->>'profile', '')::uuid;
  v_visit uuid;
  v_visit_source text;
  v_last record;
  v_id bigint;
begin
  if v_user is null or v_kind is null then
    return null;
  end if;
  if jsonb_typeof(v_extras) is distinct from 'object' then
    v_extras := '{}'::jsonb;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('activity:' || v_user::text, 0));

  if v_deal is null and v_url is not null then
    select d.id into v_deal from public.marketplace_deals d where d.canonical_url = v_url;
  end if;

  if v_key is null and v_window > 0 then
    select e.kind, e.deal_id, e.extras, e.occurred_at into v_last
      from public.activity_events e
     where e.user_id = v_user and not e.backfilled
     order by e.occurred_at desc, e.id desc
     limit 1;
    if found
       and v_last.kind = v_kind
       and v_last.deal_id is not distinct from v_deal
       and v_last.extras = v_extras
       and abs(extract(epoch from (v_at - v_last.occurred_at))) < v_window then
      return null;
    end if;
  end if;

  if v_mode in ('attach', 'extend') then
    select v.id, v.entry_source into v_visit, v_visit_source
      from public.activity_visits v
     where v.user_id = v_user
       and v.last_seen_at >= v_at - interval '30 minutes'
       and v.started_at <= v_at + interval '1 minute'
     order by v.last_seen_at desc
     limit 1;
    if v_visit is null and v_mode = 'extend' then
      insert into public.activity_visits (user_id, started_at, last_seen_at, page_count, entry_source)
      values (v_user, v_at, v_at, 0, coalesce(v_source, 'web'))
      returning id, entry_source into v_visit, v_visit_source;
    end if;
  end if;

  insert into public.activity_events (user_id, occurred_at, kind, deal_id, visit_id, source, extras, profile_id, dedupe_key)
  values (v_user, v_at, v_kind, v_deal, v_visit, coalesce(v_source, v_visit_source, 'web'), v_extras, v_profile, v_key)
  on conflict (user_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and v_visit is not null and (v_counted or v_mode = 'extend') then
    update public.activity_visits
       set action_count = action_count + (case when v_counted then 1 else 0 end),
           last_seen_at = case when v_mode = 'extend' then greatest(last_seen_at, v_at) else last_seen_at end
     where id = v_visit;
  end if;
  return v_id;
end;
$$;
revoke all on function public.activity_log(jsonb) from public, anon, authenticated;
grant execute on function public.activity_log(jsonb) to service_role;

-- activity_visit_touch(p): one heartbeat. Returns the visit's id (null for a
-- closing beat when no visit is open). The fields of p:
--   user     required
--   kind     'load' (a page load), 'page' (a navigation), 'beat' (still here,
--            every minute while the tab is shown and in use), 'resume' (the
--            tab shown again), 'hide' (the tab hidden or closed)
--   pages    navigations counted in the browser since the last write
--   via      'email' | 'sms' when the page was reached from our email or text
--   at       default now
-- A visit seen in the last 30 minutes is extended; otherwise a new one
-- starts, except on 'hide'. A bare beat within 20 seconds of the last write
-- is dropped (two tabs); a page count or a closing beat never is.
create or replace function public.activity_visit_touch(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'beat');
  v_now timestamptz := coalesce(nullif(p->>'at', '')::timestamptz, now());
  v_pages integer := greatest(coalesce(nullif(p->>'pages', '')::integer, 0), 0)
                     + case when v_kind in ('load', 'page') then 1 else 0 end;
  v_source text := case p->>'via' when 'email' then 'email_link' when 'sms' then 'sms_link' else 'web' end;
  v_id uuid;
  v_last timestamptz;
begin
  if v_user is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('activity:' || v_user::text, 0));

  select v.id, v.last_seen_at into v_id, v_last
    from public.activity_visits v
   where v.user_id = v_user and v.last_seen_at >= v_now - interval '30 minutes'
   order by v.last_seen_at desc
   limit 1;

  if v_id is not null then
    if v_kind = 'beat' and v_pages = 0 and v_last >= v_now - interval '20 seconds' then
      return v_id;
    end if;
    update public.activity_visits
       set last_seen_at = greatest(last_seen_at, v_now),
           page_count = page_count + v_pages
     where id = v_id;
    return v_id;
  end if;

  if v_kind = 'hide' then
    return null;
  end if;
  insert into public.activity_visits (user_id, started_at, last_seen_at, page_count, entry_source)
  values (v_user, v_now, v_now, greatest(v_pages, 1), v_source)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.activity_visit_touch(jsonb) from public, anon, authenticated;
grant execute on function public.activity_visit_touch(jsonb) to service_role;

-- activity_weekly_facts(p): everything /admin/weekly-active needs, in one
-- jsonb value, so no 1,000-row select limit applies. Weeks are Monday 00:00
-- to Sunday 23:59, UK time. src/lib/activity/metrics.ts does the sums; this
-- only groups. The fields of p:
--   weeks       how many weeks, the current one included (default 12, max 52)
--   now         default now
--   qualifying  kinds that count towards weekly active
--   counted     kinds that count as actions
create or replace function public.activity_weekly_facts(p jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(nullif(p->>'now', '')::timestamptz, now());
  v_weeks integer := least(greatest(coalesce(nullif(p->>'weeks', '')::integer, 12), 1), 52);
  v_qual text[] := array(select jsonb_array_elements_text(coalesce(p->'qualifying', '[]'::jsonb)));
  v_counted text[] := array(select jsonb_array_elements_text(coalesce(p->'counted', '[]'::jsonb)));
  v_this date := (date_trunc('week', v_now at time zone 'Europe/London'))::date;
  v_first date := v_this - (v_weeks - 1) * 7;
  v_t0 timestamptz := (v_first::timestamp) at time zone 'Europe/London';
  v_t1 timestamptz := ((v_this + 7)::timestamp) at time zone 'Europe/London';
begin
  return jsonb_build_object(
    'now', v_now,
    'first_week', v_first,
    'this_week', v_this,
    'weeks', v_weeks,
    -- Live tracking began with the first event logged in production (a
    -- preview on the live database stamps extras.env), as for the backfill
    -- cutoff; visits count from then too, so a preview's visits never make
    -- the weeks before the release look tracked.
    'tracking_since', (select min(e.occurred_at) from public.activity_events e where not e.backfilled and not (e.extras ? 'env')),
    'visits_since', greatest(
      (select min(v.started_at) from public.activity_visits v),
      (select min(e.occurred_at) from public.activity_events e where not e.backfilled and not (e.extras ? 'env'))
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'email', lower(trim(pr.email)),
        'name', nullif(trim(pr.full_name), ''),
        'created_at', pr.created_at,
        'plan', pr.plan,
        'plan_code', pr.plan_code,
        'plan_source', pr.plan_source,
        'status', pr.stripe_subscription_status,
        'sub_started', pr.subscription_started_at,
        'sub_ended', pr.subscription_ended_at,
        'paused_from', pr.subscription_paused_from,
        'paused_until', pr.subscription_paused_until,
        'owner', tm.owner_id
      ) order by pr.created_at), '[]'::jsonb)
      from public.profiles pr
      left join public.team_members tm on tm.member_id = pr.id
    ),
    'excluded', (
      select coalesce(jsonb_agg(jsonb_build_object('u', x.user_id, 'reason', x.reason)), '[]'::jsonb)
      from public.activity_excluded_accounts x
    ),
    -- Real money: card top-ups and paid subscription invoices, less any that
    -- were refunded or disputed (a matching '<ref>:refunded' adjustment).
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('u', q.user_id, 'first', q.first_at, 'before', q.last_before, 'list', q.recent)), '[]'::jsonb)
      from (
        select g.user_id,
               min(g.created_at) as first_at,
               max(g.created_at) filter (where g.created_at < v_t0 - interval '90 days') as last_before,
               coalesce(jsonb_agg(g.created_at order by g.created_at) filter (where g.created_at >= v_t0 - interval '90 days' and g.created_at < v_t1), '[]'::jsonb) as recent
        from public.credit_grants g
        where (g.kind = 'topup' or (g.kind = 'plan' and g.source_ref like 'inv:%'))
          and not exists (
            select 1 from public.credit_grants r
            where r.user_id = g.user_id and r.kind = 'adjustment'
              and r.source_ref in (g.source_ref || ':refunded', g.source_ref || ':disputed')
          )
        group by g.user_id
      ) q
    ),
    'sub_events', (
      select coalesce(jsonb_agg(jsonb_build_object('u', se.user_id, 'k', se.kind, 'at', se.at) order by se.at), '[]'::jsonb)
      from public.subscription_events se
      where se.kind in ('started', 'ended', 'paused', 'resumed')
    ),
    'qdays', (
      select coalesce(jsonb_agg(jsonb_build_object('u', q.user_id, 'd', q.days)), '[]'::jsonb)
      from (
        select e.user_id, jsonb_agg(distinct (e.occurred_at at time zone 'Europe/London')::date) as days
        from public.activity_events e
        where e.occurred_at >= v_t0 - interval '31 days' and e.occurred_at < v_t1 and e.kind = any(v_qual)
        group by e.user_id
      ) q
    ),
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('u', w.user_id, 'w', w.wk, 'c', w.c, 'r', w.r)), '[]'::jsonb)
      from (
        select e.user_id,
               (date_trunc('week', e.occurred_at at time zone 'Europe/London'))::date as wk,
               count(*) filter (where e.kind = any(v_counted)) as c,
               count(*) filter (where e.kind = 'report_run') as r
        from public.activity_events e
        where e.occurred_at >= v_t0 and e.occurred_at < v_t1
        group by 1, 2
      ) w
    ),
    'visits', (
      select coalesce(jsonb_agg(jsonb_build_object('u', v.user_id, 'w', v.wk, 'n', v.n, 'a', v.a, 's', v.secs)), '[]'::jsonb)
      from (
        select vi.user_id,
               (date_trunc('week', vi.started_at at time zone 'Europe/London'))::date as wk,
               count(*) as n,
               sum(vi.action_count) as a,
               jsonb_agg(greatest(round(extract(epoch from (vi.last_seen_at - vi.started_at)))::integer, 0)) as secs
        from public.activity_visits vi
        where vi.started_at >= v_t0 and vi.started_at < v_t1
        group by 1, 2
      ) v
    ),
    -- Opens and whether the same person ran a report on the same deal within
    -- 14 days. matured: the 14 days are over.
    'opens', (
      select coalesce(jsonb_agg(jsonb_build_object('u', o.user_id, 'w', o.wk, 'n', o.n, 'm', o.matured, 'cm', o.conv_matured, 'c', o.conv)), '[]'::jsonb)
      from (
        select op.user_id,
               (date_trunc('week', op.occurred_at at time zone 'Europe/London'))::date as wk,
               count(*) as n,
               count(*) filter (where op.occurred_at <= v_now - interval '14 days') as matured,
               count(*) filter (where op.reported) as conv,
               count(*) filter (where op.reported and op.occurred_at <= v_now - interval '14 days') as conv_matured
        from (
          select e.user_id, e.occurred_at,
                 exists (
                   select 1 from public.activity_events r
                   where r.user_id = e.user_id and r.kind = 'report_run' and r.deal_id = e.deal_id
                     and r.occurred_at >= e.occurred_at and r.occurred_at < e.occurred_at + interval '14 days'
                 ) as reported
          from public.activity_events e
          where e.kind = 'deal_open' and e.deal_id is not null and e.occurred_at >= v_t0 and e.occurred_at < v_t1
        ) op
        group by 1, 2
      ) o
    ),
    -- Keep rate on Today's 5: for each Today list a member actually viewed
    -- (a today_view event in that Today-day, which turns over at 07:00 UTC),
    -- the deals it showed (the stored list and the morning pick, at most 5)
    -- and how many of those they kept during that Today-day.
    'today', (
      select coalesce(jsonb_agg(jsonb_build_object('u', t.user_id, 'w', t.wk, 'shown', t.shown, 'kept', t.kept)), '[]'::jsonb)
      from (
        select l.user_id,
               (date_trunc('week', l.first_view at time zone 'Europe/London'))::date as wk,
               sum(least(cardinality(l.ids), 5)) as shown,
               sum(least(l.kept, 5)) as kept
        from (
          select tv.user_id, tv.first_view, tv.ids,
                 (select count(distinct k.deal_id) from public.activity_events k
                   where k.user_id = tv.user_id and k.kind = 'keep' and k.deal_id = any(tv.ids)
                     and k.occurred_at >= tv.day_start and k.occurred_at < tv.day_start + interval '1 day') as kept
          from (
            select vw.user_id, vw.first_view, vw.day_start,
                   array(select distinct x from unnest(coalesce(ts.deal_ids, '{}'::uuid[]) || coalesce(pk.ids, '{}'::uuid[])) x) as ids
            from (
              select e.user_id,
                     ((e.occurred_at - interval '7 hours') at time zone 'UTC')::date as td,
                     (((((e.occurred_at - interval '7 hours') at time zone 'UTC')::date)::timestamp + interval '7 hours') at time zone 'UTC') as day_start,
                     min(e.occurred_at) as first_view
              from public.activity_events e
              where e.kind = 'today_view' and e.occurred_at >= v_t0 and e.occurred_at < v_t1
              group by 1, 2, 3
            ) vw
            left join public.today_selections ts on ts.user_id = vw.user_id and ts.day = vw.td
            left join lateral (
              select array[s.deal_id] as ids
              from public.sourcing_sent s
              where s.user_id = vw.user_id and s.status = 'sent' and s.deal_id is not null
                and s.sent_at >= vw.day_start and s.sent_at < vw.day_start + interval '1 day'
              order by s.sent_at desc
              limit 1
            ) pk on true
          ) tv
        ) l
        where cardinality(l.ids) > 0
        group by 1, 2
      ) t
    ),
    'last', (
      select coalesce(jsonb_agg(jsonb_build_object('u', la.user_id, 'k', la.kind, 'at', la.occurred_at)), '[]'::jsonb)
      from (
        select distinct on (e.user_id) e.user_id, e.kind, e.occurred_at
        from public.activity_events e
        where e.kind = any(v_counted) or e.kind = any(v_qual)
        order by e.user_id, e.occurred_at desc
      ) la
    )
  );
end;
$$;
revoke all on function public.activity_weekly_facts(jsonb) from public, anon, authenticated;
grant execute on function public.activity_weekly_facts(jsonb) to service_role;

-- activity_backfill(p): copies history from the tables that already record
-- member actions into activity_events, marked backfilled. p.apply = false
-- (the default) only counts. Safe to run any number of times:
--   - only rows from before the cutoff (the first event logged live in
--     production, fixed on the first real run) and inside the 24 months
--     retention keeps
--   - every copied row has a key ('bf:<table>:<id>', or the live key where
--     one exists) and a key that is already there, for anyone, is skipped
-- Not copied: today_selections (the morning cron makes most of those rows,
-- so one is no sign the member looked at Today) and checklist_steps (each
-- step repeats the open, keep, report or share that completed it).
-- The real run is refused until something has been logged live in
-- production: run on a preview before merging, it would fix the cutoff too
-- early and leave a gap between the preview and the release.
create or replace function public.activity_backfill(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_apply boolean := coalesce(nullif(p->>'apply', '')::boolean, false);
  v_floor timestamptz := now() - interval '24 months';
  v_stored timestamptz;
  v_first_live timestamptz;
  v_cutoff timestamptz;
  v_sources jsonb;
  v_inserted bigint;
begin
  select nullif(m.value->>'cutoff', '')::timestamptz into v_stored from public.activity_meta m where m.key = 'backfill_cutoff';
  select min(e.occurred_at) into v_first_live from public.activity_events e where not e.backfilled and not (e.extras ? 'env');
  v_cutoff := coalesce(v_stored, v_first_live);

  if v_apply then
    if v_cutoff is null then
      return jsonb_build_object('dry', false, 'error', 'not_live');
    end if;
    if v_stored is null then
      insert into public.activity_meta (key, value) values ('backfill_cutoff', jsonb_build_object('cutoff', v_cutoff))
      on conflict (key) do nothing;
      select nullif(m.value->>'cutoff', '')::timestamptz into v_cutoff from public.activity_meta m where m.key = 'backfill_cutoff';
    end if;
  end if;

  with src (s, user_id, occurred_at, kind, deal_id, source, extras, dedupe_key) as (
    -- Deals a member chose to open: not the daily pick's automatic open, not
    -- an admin's free look. A team member's open is stored against the owner
    -- who paid; the member who pressed the button is on the charge.
    select 'deal_opens', coalesce(nullif(ct.metadata->>'member_id', '')::uuid, o.user_id), o.opened_at, 'deal_open', o.deal_id, 'web',
           '{}'::jsonb, 'bf:deal_opens:' || o.id::text
    from public.deal_opens o
    left join public.credit_transactions ct on ct.id = o.transaction_id
    where o.status = 'open' and coalesce(o.verified_via, '') not in ('pick', 'admin')
    union all
    -- Keep / Pass: only the current state is kept, so this is the latest one.
    select 'deal_reactions', r.user_id, r.updated_at, case when r.reaction = 'keep' then 'keep' else 'pass' end, r.deal_id, 'web',
           case when r.reaction = 'pass' and cardinality(r.reasons) > 0 then jsonb_build_object('reasons', to_jsonb(r.reasons)) else '{}'::jsonb end,
           'bf:deal_reactions:' || r.user_id::text || ':' || r.deal_id::text
    from public.deal_reactions r
    union all
    -- Reports (tier unknown). A report run on a marketplace deal's own listing
    -- is tied to the deal.
    select 'saved_searches', s.user_id, s.created_at, 'report_run', md.id, 'web',
           jsonb_build_object('from', case when md.id is not null then 'deal' when s.checked_listing_id is not null then 'listing' else 'address' end),
           'bf:saved_searches:' || s.id::text
    from public.saved_searches s
    left join public.checked_listings cl on cl.id = s.checked_listing_id
    left join public.marketplace_deals md on md.canonical_url = cl.canonical_url
    union all
    -- A share: the first time only (sharing again reuses the link).
    select 'deal_shares', sh.user_id, sh.created_at, 'deal_share', sh.deal_id, 'web',
           '{}'::jsonb, 'bf:deal_shares:' || sh.user_id::text || ':' || sh.deal_id::text
    from public.deal_shares sh
    union all
    -- Top-ups. Manual and automatic cannot be told apart here, so they are
    -- kept as their own kind, which does not count towards weekly active.
    -- Same key as a live top-up.
    select 'credit_grants', g.user_id, g.created_at, 'topup_unknown', null::uuid, 'system',
           jsonb_build_object('amount_pence', g.amount_pence), 'topup:' || g.source_ref
    from public.credit_grants g
    where g.kind = 'topup' and g.source_ref is not null
      and not exists (
        select 1 from public.credit_grants x
        where x.user_id = g.user_id and x.kind = 'adjustment'
          and x.source_ref in (g.source_ref || ':refunded', g.source_ref || ':disputed')
      )
    union all
    -- Answers to the daily pick from the email or its page ("Yes, more like
    -- this" / "Not for me"). The link can be clicked by a mail scanner, so
    -- these never count towards weekly active.
    select 'sourcing_sent', ss.user_id, ss.responded_at, 'email_feedback', ss.deal_id, 'email_link',
           jsonb_strip_nulls(jsonb_build_object(
             'answer', ss.reaction,
             'via', ss.reaction_source,
             'reasons', case when cardinality(ss.reasons) > 0 then to_jsonb(ss.reasons) end
           )),
           'bf:sourcing_sent:' || ss.id::text
    from public.sourcing_sent ss
    where ss.reaction is not null and ss.responded_at is not null
    union all
    -- Batch 7's next-step tools. The one-tap stage button is a stage move.
    select 'pipeline_step_events', pe.user_id, pe.at,
           case when pe.action = 'advance' then 'stage_move' else 'next_step' end,
           case when pe.item_key ~ '^d-[0-9a-fA-F-]{36}$' then substr(pe.item_key, 3)::uuid end,
           'web',
           case when pe.action = 'advance'
                then jsonb_strip_nulls(jsonb_build_object('from', pe.stage, 'to', pe.item_id, 'via', 'next_step',
                       'item', case when pe.item_key like 'l-%' then pe.item_key end))
                else jsonb_strip_nulls(jsonb_build_object('action', pe.action, 'stage', pe.stage, 'step', pe.item_id,
                       'item', case when pe.item_key like 'l-%' then pe.item_key end))
           end,
           'bf:pipeline_step_events:' || pe.id::text
    from public.pipeline_step_events pe
    union all
    -- Plan changes the member made. A start is keyed by subscription: the
    -- Stripe webhook records it twice (checkout, then the subscription).
    -- Resumes Stripe reports on its own may be the pause simply ending, so
    -- only the member's own are copied.
    select 'subscription_events', se.user_id, se.at,
           case se.kind when 'started' then 'plan_start' when 'plan_changed' then 'plan_change' when 'paused' then 'plan_pause'
             when 'resumed' then 'plan_resume' when 'cancel_scheduled' then 'plan_cancel' else 'plan_cancel_undone' end,
           null::uuid,
           case when se.source = 'self_serve' then 'web' else 'system' end,
           jsonb_strip_nulls(jsonb_build_object('plan', se.plan_code)),
           case when se.kind = 'started' and se.stripe_subscription_id is not null
                then 'plan_start:' || se.stripe_subscription_id
                else 'bf:subscription_events:' || se.id::text end
    from public.subscription_events se
    where se.kind in ('started', 'plan_changed', 'paused', 'cancel_scheduled', 'cancel_reverted')
       or (se.kind = 'resumed' and se.source = 'self_serve')
  ), cand as (
    select distinct on (src.user_id, src.dedupe_key) src.*
    from src
    where src.occurred_at is not null
      and src.occurred_at < coalesce(v_cutoff, now())
      and src.occurred_at >= v_floor
      and exists (select 1 from public.profiles pr where pr.id = src.user_id)
    order by src.user_id, src.dedupe_key, src.occurred_at
  ), fresh as (
    select c.* from cand c
    where not exists (select 1 from public.activity_events e where e.dedupe_key = c.dedupe_key)
  ), ins as (
    insert into public.activity_events (user_id, occurred_at, kind, deal_id, source, extras, dedupe_key, backfilled)
    select f.user_id, f.occurred_at, f.kind, f.deal_id, f.source, f.extras, f.dedupe_key, true
    from fresh f
    where v_apply
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select
    (select coalesce(jsonb_object_agg(t.s, jsonb_build_object('found', t.found, 'new', t.fresh)), '{}'::jsonb)
       from (select c.s, count(*) as found, count(f.dedupe_key) as fresh
               from cand c left join fresh f on f.user_id = c.user_id and f.dedupe_key = c.dedupe_key
              group by c.s) t),
    (select count(*) from ins)
  into v_sources, v_inserted;

  return jsonb_build_object(
    'dry', not v_apply,
    'cutoff', v_cutoff,
    'cutoff_fixed', v_stored is not null or v_apply,
    'floor', v_floor,
    'sources', v_sources,
    'inserted', v_inserted
  );
end;
$$;
revoke all on function public.activity_backfill(jsonb) from public, anon, authenticated;
grant execute on function public.activity_backfill(jsonb) to service_role;

-- activity_retention(p): the daily cron's work. Deletes events and visits
-- older than p.before, at most p.limit of each per run (default 50,000); with
-- p.apply = false (the default) it only counts. Refuses a cutoff less than a
-- year old, so a wrong date can never empty the log.
create or replace function public.activity_retention(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_before timestamptz := nullif(p->>'before', '')::timestamptz;
  v_apply boolean := coalesce(nullif(p->>'apply', '')::boolean, false);
  v_limit integer := least(greatest(coalesce(nullif(p->>'limit', '')::integer, 50000), 1), 500000);
  v_events bigint;
  v_visits bigint;
begin
  if v_before is null or v_before > now() - interval '12 months' then
    raise exception 'activity_retention: before must be at least 12 months ago';
  end if;
  if not v_apply then
    select count(*) into v_events from public.activity_events e where e.occurred_at < v_before;
    select count(*) into v_visits from public.activity_visits v where v.started_at < v_before;
    return jsonb_build_object('dry', true, 'before', v_before, 'events', v_events, 'visits', v_visits);
  end if;
  with gone as (
    delete from public.activity_events e
    where e.id in (select x.id from public.activity_events x where x.occurred_at < v_before order by x.occurred_at limit v_limit)
    returning 1
  ) select count(*) into v_events from gone;
  with gone as (
    delete from public.activity_visits v
    where v.id in (select x.id from public.activity_visits x where x.started_at < v_before order by x.started_at limit v_limit)
    returning 1
  ) select count(*) into v_visits from gone;
  return jsonb_build_object(
    'dry', false,
    'before', v_before,
    'events', v_events,
    'visits', v_visits,
    'more', exists (select 1 from public.activity_events e where e.occurred_at < v_before)
         or exists (select 1 from public.activity_visits v where v.started_at < v_before)
  );
end;
$$;
revoke all on function public.activity_retention(jsonb) from public, anon, authenticated;
grant execute on function public.activity_retention(jsonb) to service_role;

notify pgrst, 'reload schema';

-- =========================
-- Batch 10: analyser path + pricing
-- =========================
-- Fixed prices for deals in the feed, daily deals, 1:1 plan credit and a
-- lower top-up rate (src/lib/credit/deal-pricing.ts reads every key below;
-- /admin/billing edits them). All in base pence: what a member on a plan
-- pays. Top-up credit pays base × its spend rate. Inserted only when
-- missing, so an edit made on /admin/billing survives a re-run.
--   full_analysis_pence   a Full analysis of a feed deal; a Quick look
--                         already paid for that deal comes off it
--   pmi_addon_pence       the optional PMI second opinion, on top
--   todays_5_daily_pence  one day of daily deals (Today's 5), charged only
--                         on a day it is delivered, from new_pricing_from
--   analysis_reuse_days   a saved analysis of the same deal younger than
--                         this is reused instead of paying the providers again
--   plan_credit_pence     monthly plan credit from new_pricing_from, applied
--                         at each subscriber's first renewal on or after it
--                         (annual: the first ANNUAL renewal)
--   new_pricing_from      the date plan credit and daily deals change. null
--                         until it is set on /admin/billing, which only allows
--                         a date at least 14 days after the members' notice
--   profit_range_pct      the area-estimate profit range either side, by the
--                         screening's confidence (capped at 25 in the code)
-- None of this is in ACCESS_COLUMNS.
insert into public.billing_settings (key, value) values
  ('full_analysis_pence', '400'::jsonb),
  ('pmi_addon_pence', '200'::jsonb),
  ('todays_5_daily_pence', '33'::jsonb),
  ('analysis_reuse_days', '30'::jsonb),
  ('plan_credit_pence', '{"starter":1900,"pro":3999,"scale":9900,"pro_annual":3000}'::jsonb),
  ('new_pricing_from', 'null'::jsonb),
  ('profit_range_pct', '{"high":10,"medium":15,"low":25}'::jsonb)
on conflict (key) do nothing;

-- Top-up and adjustment (promo, referral, admin) credit spend at 1.3×, down
-- from 1.5×. A grant's spend_rate is frozen when it is made, so balances
-- bought before today are moved to 1.3 as well (decided 27 Sep 2026: one
-- rate, in the member's favour). Past debits keep the rate they were taken
-- at in credit_allocations. The overdraft grant (rate 1) is not touched.
-- Runs ONCE, marked by the batch10_rates_applied_at row: re-running this file
-- must never undo a later change of rate made on /admin/billing.
do $$
begin
  if not exists (select 1 from public.billing_settings where key = 'batch10_rates_applied_at') then
    update public.billing_settings
       set value = value || '{"topup":1.3,"adjustment":1.3}'::jsonb, updated_at = now()
     where key = 'spend_rates';
    update public.credit_grants
       set spend_rate = 1.3
     where kind in ('topup', 'adjustment') and spend_rate = 1.5 and remaining_pence > 0;
    insert into public.billing_settings (key, value) values ('batch10_rates_applied_at', to_jsonb(now()));
  end if;
end $$;

-- ── Saved analyses (src/lib/analysis/reuse.ts) ──
-- A Full analysis of a feed deal, kept so the next Full analysis of the same
-- deal within analysis_reuse_days reuses it instead of paying the providers
-- again. Only what the providers said about the PROPERTY is kept: never the
-- member's deal maths, cash flow, finance, name, notes, stage or report id.
-- Written only by the server from a fresh run (never copied from
-- saved_searches, which its author can edit). Service role only.
create table if not exists public.deal_analyses (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  canonical_url text not null,
  input_key text not null,                   -- the fixed inputs the providers were asked (deal-input.ts)
  inputs jsonb not null,
  result jsonb not null,                     -- { result, stampDuty, stampDutyPrice }: see SharedAnalysis
  has_second_opinion boolean not null default false,
  raw_cost_pence numeric(14,4) not null default 0,
  action_id uuid,                            -- the purchase that ran it (provider_calls.action_id)
  analysed_at timestamptz not null default now(),
  second_opinion_at timestamptz
);
create index if not exists deal_analyses_lookup_idx on public.deal_analyses (deal_id, input_key, analysed_at desc);
alter table public.deal_analyses enable row level security;  -- no policies: service role only
revoke all on public.deal_analyses from anon, authenticated;

-- ── Full analysis and PMI purchases (src/lib/analysis/deal-analysis.ts) ──
-- One row per purchase; its id is the ledger action_id of its debits. The
-- row is claimed (pending) BEFORE anything is charged, and one pending row per
-- account and deal (or per report, for PMI) is the double-tap guard: a second
-- tab gets "already running". A Full analysis is charged only once the
-- analysis is complete and saved; a failed one is marked failed and costs
-- nothing (a Quick look it charged on the way stays: the deal is open).
--   user_id    the account that pays (a team member's owner)
--   buyer_id   who pressed the button; the report is theirs
--   quoted_base_pence       the total the member confirmed, Quick look included
--   analysis_base_pence     the Full analysis debit: its price less open_credit
--   pmi_base_pence          the PMI debit, taken only if PMI answered
--   open_credit_base_pence  what the account paid to open the deal, off the price
create table if not exists public.analysis_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,                        -- full_analysis | pmi_addon
  status text not null default 'pending',    -- pending | complete | failed
  deal_id uuid,
  canonical_url text,
  report_id uuid,                            -- the report made (full_analysis) or added to (pmi_addon)
  analysis_id uuid,                          -- the deal_analyses row used
  with_pmi boolean not null default false,
  input_key text,
  inputs jsonb,
  quoted_base_pence numeric(14,4),
  analysis_base_pence numeric(14,4) not null default 0,
  pmi_base_pence numeric(14,4) not null default 0,
  open_credit_base_pence numeric(14,4) not null default 0,
  opened_by_purchase boolean not null default false,
  open_action_id uuid,                       -- the deal_opens row this purchase opened (its debit's action_id)
  reservation_id uuid,
  reused boolean,
  second_opinion boolean,                    -- PMI answered (only then is pmi_addon charged)
  charged_base_pence numeric(14,4) not null default 0,
  transaction_ids bigint[] not null default '{}',
  failure text,
  ready_at timestamptz,
  run_started_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists analysis_purchases_running_uidx on public.analysis_purchases (user_id, deal_id) where kind = 'full_analysis' and status = 'pending';
create unique index if not exists analysis_purchases_pmi_running_uidx on public.analysis_purchases (report_id) where kind = 'pmi_addon' and status = 'pending';
create index if not exists analysis_purchases_user_idx on public.analysis_purchases (user_id, created_at desc);
create index if not exists analysis_purchases_deal_idx on public.analysis_purchases (deal_id, user_id, created_at desc);
alter table public.analysis_purchases enable row level security;  -- no policies: service role only
revoke all on public.analysis_purchases from anon, authenticated;

-- A report made by a Full analysis of a feed deal says which deal (the deal
-- page finds it by this, pipeline row or not) and when its figures were
-- found, which the report shows as "Analysed on" when that was before today.
-- Such reports are never pruned by the 200-report limit: they were paid for.
alter table public.saved_searches add column if not exists deal_id uuid;
alter table public.saved_searches add column if not exists analysed_at timestamptz;
create index if not exists saved_searches_deal_idx on public.saved_searches (owner_id, deal_id) where deal_id is not null;

-- ── Daily deals: one charge per member per day (src/lib/listing/daily-deals-server.ts) ──
-- From new_pricing_from, a delivered Today's 5 costs todays_5_daily_pence,
-- once per member per UTC day, charged to the account that pays (a team
-- member's owner). The row is inserted BEFORE the debit: (user_id, day) is
-- the guard that the 07:00 picks passes, the 08:10 digest and any retry can
-- never charge one member twice for one day. charged_base_pence and
-- transaction_id are written only once the debit has gone through.
create table if not exists public.daily_deal_charges (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  run text not null,                         -- picks | digest
  send_ref text,                             -- the sourcing_sent row, or the digest's send token
  charged_base_pence numeric(14,4) not null default 0,
  transaction_id bigint,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);
create unique index if not exists daily_deal_charges_id_uidx on public.daily_deal_charges (id);
create index if not exists daily_deal_charges_payer_idx on public.daily_deal_charges (payer_id, day desc);
alter table public.daily_deal_charges enable row level security;  -- no policies: service role only
revoke all on public.daily_deal_charges from anon, authenticated;

-- ── The members' notice of these prices (src/lib/credit/pricing-notice-run.ts) ──
-- Sent by hand from /admin/billing after a dry run, at least 14 days before
-- new_pricing_from. Stamped on each profile as it is sent, so a second press
-- never mails anyone twice; the latest stamp also sets the earliest date the
-- new pricing may start (/admin/billing). pricing_notice_date is the date the
-- notice announced: the new pricing takes effect only once one has been
-- announced, and never before the date announced (effectivePricingDate).
alter table public.profiles add column if not exists pricing_notice_sent_at timestamptz;
insert into public.billing_settings (key, value) values ('pricing_notice_date', 'null'::jsonb)
on conflict (key) do nothing;
