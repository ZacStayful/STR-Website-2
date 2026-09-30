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
-- A trigger function only: never callable over the API (/rest/v1/rpc). The
-- auth service, which inserts auth.users, and the service role keep it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin, service_role;

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
-- Frozen to the accounts it was written for (it ran on 12 Sep 2026): re-running
-- this file must never hand £20 to a newer account, which would skip the abuse
-- checks, a team seat's "no welcome credit" and, from Batch 20, the starter
-- pack that replaces the welcome credit for new members.
do $$
declare p record;
begin
  for p in select id from profiles where profiles.created_at < timestamptz '2026-09-13 00:00:00+00' and not exists (select 1 from credit_grants g where g.user_id = profiles.id and g.kind = 'welcome') loop
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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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
  -- pending_check: qualified on the area's figures, waiting on the shortlist
  -- for its own comparables check (Batch 16). pending_verify: qualified,
  -- waiting for its first page fetch, which supplies the photo and the live
  -- status. live: on the grid.
  status text not null default 'pending_verify',
  retired_reason text,                       -- sold | under_offer | let_agreed | removed | unqualified | unsuitable | stale_listed | stale_unseen | unverifiable | admin | insufficient_data | unchecked (Batch 16)
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
returns trigger language plpgsql set search_path = '' as $$
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
-- and are not tracked in this file. `outreach` (the n8n WhatsApp outreach
-- tool) is service_role only: RLS on every table, its v_due_* views
-- security_invoker, nothing granted to anon or authenticated (set live by the
-- `security_advisor_fixes` migration).

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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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
set search_path = ''
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
-- Only the server sets them (a Full analysis it ran and charged for): the
-- cards, the deal page and the purchase itself trust them. Signed-in members
-- can write their own saved_searches rows with the public key (the policy
-- above is FOR ALL), so from them a value is dropped on insert and kept as it
-- was on update. The service role (the server) and the SQL editor are not
-- touched. A plain (invoker) function: current_user is the caller's role.
create or replace function private.saved_searches_keep_analysis()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.deal_id := null;
      new.analysed_at := null;
    else
      new.deal_id := old.deal_id;
      new.analysed_at := old.analysed_at;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.saved_searches_keep_analysis() from public;
drop trigger if exists saved_searches_keep_analysis on public.saved_searches;
create trigger saved_searches_keep_analysis
  before insert or update on public.saved_searches
  for each row execute function private.saved_searches_keep_analysis();

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

-- =========================
-- Batch 12: profile quiz
-- =========================
-- The profile quiz (src/lib/profile): every member answers ~20 questions,
-- one per screen. The search-criteria answers go into profiles.market_goals
-- (bumped to version 2 in code; no SQL change), the "about you" answers into
-- the column below, and the bookkeeping — which questions are answered,
-- where they stopped, the £5 — into profile_quiz. None of this is in
-- ACCESS_COLUMNS (src/lib/access.ts), and must not become so.

-- ── profiles.about_you: Section A, the member's own answers (src/lib/profile/about.ts) ──
-- Written by the member's own session, like market_goals, so it is granted
-- to `authenticated` (the row policy limits them to their own row). Declared
-- above the grant, because the grant names it.
alter table public.profiles add column if not exists about_you jsonb;
alter table public.profiles add column if not exists about_you_updated_at timestamptz;
grant update (about_you, about_you_updated_at) on public.profiles to authenticated;

-- ── profile_quiz: one row per member who has started (src/lib/profile/state.ts) ──
--   answered               {question_id: {at, notSure}}: the questions answered,
--                          a real answer or "Not sure". Stored, not derived, so
--                          "Not sure" can be told from never asked
--   last_question          where they were last: the admin drop-off table
--   credit_grant_id        the £5 (credit_grants), once paid; unique on the
--                          grant's source_ref 'profile_complete:<user>' so a
--                          retry can never pay twice
--   credit_skipped_reason  why it will never be paid (team_member,
--                          welcome_withheld): the welcome check's own verdict
--   reminder_collapsed_day the Today-day the reminder card was collapsed for;
--                          it returns the next day and never stops until complete
-- Service role only: a member can never mark their own quiz complete or paid.
create table if not exists public.profile_quiz (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_question text,
  answered jsonb not null default '{}'::jsonb,
  finish_later_at timestamptz,
  resumed_at timestamptz,
  credit_grant_id uuid,
  credit_skipped_reason text,
  reminder_collapsed_day date,
  updated_at timestamptz not null default now()
);
create index if not exists profile_quiz_completed_idx on public.profile_quiz (completed_at);
alter table public.profile_quiz enable row level security;  -- no policies: service role only
revoke all on public.profile_quiz from anon, authenticated;

-- ── Settings (src/lib/credit/unit-costs.ts reads them; /admin/billing edits them) ──
--   profile_complete_pence       the one-off credit for a complete profile
--   profile_credit_min_real_pct  the share of the non-mandatory questions that
--                                need a real answer (not "Not sure") before
--                                it is paid, so answering everything "Not
--                                sure" earns nothing
insert into public.billing_settings (key, value) values
  ('profile_complete_pence', '500'::jsonb),
  ('profile_credit_min_real_pct', '75'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- =========================
-- Batch 13: saved profiles
-- =========================
-- Up to five saved profiles per member (src/lib/profiles). A profile is one
-- set of search criteria: the same MarketGoals jsonb as profiles.market_goals,
-- the "specific areas" answer (saved_areas) and the quiz's answered marks
-- (profile_quiz.answered). "About you" (profiles.about_you), the quiz gate and
-- the £5 stay one per member, exactly as Batch 12 built them.
--
-- ONE profile per member is active: the one the header shows. Its criteria
-- are ALSO the live profiles.market_goals / saved_areas / profile_quiz.answered
-- that every existing reader and writer already uses. The triggers below copy
-- any change of those into the active profile's row, so the quiz, the Advanced
-- form, the relaxation link and lead provisioning never need to know which
-- profile is active. select_search_profile swaps them in one transaction.
-- Everything that runs per profile (the daily run, the digest, emails, My
-- deals) reads search_profiles.
--
-- Running = not paused and not deleted: gets its own Today's 5 in the daily
-- email and its own daily charge. Paused only by the member (no auto-pause).
-- Deletes are soft, so deals keep their profile and read "(deleted profile)".
-- Team members keep exactly one profile (src/lib/profiles/rules.ts).
-- Nothing here is in ACCESS_COLUMNS (src/lib/access.ts), and must not become so.
-- Everything is additive: this section can be run before the code is merged.

create table if not exists public.search_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  criteria jsonb,                              -- MarketGoals; null = no preferences yet (house picks)
  areas text[] not null default '{}',          -- postcode areas: the "specific areas" answer
  answered jsonb not null default '{}'::jsonb, -- the quiz's {question: {at, notSure}} marks for this profile
  for_client boolean not null default false,   -- set up for someone else (the permission reminder)
  copied_from uuid,                            -- the profile it was copied from (analytics only)
  is_active boolean not null default false,    -- the one the header shows; its criteria are also profiles.market_goals
  paused_at timestamptz,                       -- daily deals paused by the member; null = running
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.search_profiles'::regclass and conname = 'search_profiles_name_check') then
    alter table public.search_profiles add constraint search_profiles_name_check check (char_length(btrim(name)) between 1 and 40);
  end if;
end $$;
create unique index if not exists search_profiles_active_uidx on public.search_profiles (user_id) where is_active and deleted_at is null;
create unique index if not exists search_profiles_name_uidx on public.search_profiles (user_id, lower(btrim(name))) where deleted_at is null;
create index if not exists search_profiles_user_idx on public.search_profiles (user_id, created_at);
create index if not exists search_profiles_running_idx on public.search_profiles (user_id) where deleted_at is null and paused_at is null;
alter table public.search_profiles enable row level security;  -- no policies: service role only
revoke all on public.search_profiles from anon, authenticated;

-- ── Each profile's Today list for a day (src/lib/today/selection.ts) ──
-- today_selections is keyed (user_id, day): one list a member. This is the
-- same thing per profile. today_selections is left as it was (history, and a
-- rollback keeps working); its rows are copied here for the first profile.
create table if not exists public.profile_today_lists (
  profile_id uuid not null references public.search_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  deal_ids uuid[] not null default '{}',
  near_miss boolean not null default false,
  advice text,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);
create index if not exists profile_today_lists_user_day_idx on public.profile_today_lists (user_id, day);
alter table public.profile_today_lists enable row level security;  -- no policies: service role only
revoke all on public.profile_today_lists from anon, authenticated;

-- ── One daily-deals charge per profile per day (src/lib/listing/daily-deals-server.ts) ──
-- Batch 10's daily_deal_charges is keyed (user_id, day): one charge a member.
-- A member with three running profiles is charged three times a day, so the
-- guard row moves here, keyed (profile_id, day), inserted BEFORE the debit
-- exactly as Batch 10's is. daily_deal_charges is left as it was; a legacy row
-- for the same member and day counts as the active profile's charge.
create table if not exists public.profile_daily_charges (
  id uuid not null default gen_random_uuid(),
  profile_id uuid not null references public.search_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  payer_id uuid not null references public.profiles(id) on delete cascade,
  run text not null,                         -- picks | digest
  send_ref text,
  charged_base_pence numeric(14,4) not null default 0,
  transaction_id bigint,
  created_at timestamptz not null default now(),
  primary key (profile_id, day)
);
create unique index if not exists profile_daily_charges_id_uidx on public.profile_daily_charges (id);
create index if not exists profile_daily_charges_user_day_idx on public.profile_daily_charges (user_id, day);
create index if not exists profile_daily_charges_payer_idx on public.profile_daily_charges (payer_id, day desc);
alter table public.profile_daily_charges enable row level security;  -- no policies: service role only
revoke all on public.profile_daily_charges from anon, authenticated;

-- ── Which profile a pick, a Keep / Pass, a pipeline row, an open or a miss belongs to ──
-- Nullable: untagged history is attached to the member's first profile below.
-- A team member's open is recorded against the owner (deal_opens.user_id is
-- the payer), so opens are tagged only when the opener pays for themselves.
alter table public.sourcing_sent add column if not exists profile_id uuid references public.search_profiles(id) on delete set null;
alter table public.deal_reactions add column if not exists profile_id uuid references public.search_profiles(id) on delete set null;
alter table public.checked_listings add column if not exists profile_id uuid references public.search_profiles(id) on delete set null;
alter table public.deal_opens add column if not exists profile_id uuid references public.search_profiles(id) on delete set null;
alter table public.sourcing_missed add column if not exists profile_id uuid references public.search_profiles(id) on delete set null;
create index if not exists sourcing_sent_profile_idx on public.sourcing_sent (profile_id) where profile_id is not null;
create index if not exists deal_reactions_profile_idx on public.deal_reactions (profile_id) where profile_id is not null;
create index if not exists checked_listings_profile_idx on public.checked_listings (profile_id) where profile_id is not null;
create index if not exists deal_opens_profile_idx on public.deal_opens (profile_id) where profile_id is not null;
create index if not exists sourcing_missed_profile_idx on public.sourcing_missed (profile_id) where profile_id is not null;

-- ── Every member's first profile, "My deals", holding what they have now ──
insert into public.search_profiles (user_id, name, criteria, areas, answered, is_active)
select p.id,
       'My deals',
       p.market_goals,
       coalesce((select array_agg(s.postcode_area order by s.postcode_area) from public.saved_areas s where s.user_id = p.id), '{}'),
       coalesce((select q.answered from public.profile_quiz q where q.user_id = p.id), '{}'::jsonb),
       true
  from public.profiles p
 where not exists (select 1 from public.search_profiles sp where sp.user_id = p.id);

-- ── Untagged history belongs to the member's first profile ──
-- Only rows from before the first profile ever existed: after that the
-- triggers below tag every new row, so a re-run never relabels anything (and
-- never pins a team member's untagged open on the owner's profile).
do $$
declare
  v_cutover timestamptz := (select min(created_at) from public.search_profiles);
begin
  if v_cutover is null then return; end if;
  with first_profile as (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at)
  update public.sourcing_sent t set profile_id = f.id from first_profile f where t.profile_id is null and f.user_id = t.user_id and t.sent_at < v_cutover;
  with first_profile as (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at)
  update public.deal_reactions t set profile_id = f.id from first_profile f where t.profile_id is null and f.user_id = t.user_id and t.created_at < v_cutover;
  with first_profile as (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at)
  update public.checked_listings t set profile_id = f.id from first_profile f where t.profile_id is null and f.user_id = t.user_id and t.created_at < v_cutover;
  with first_profile as (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at)
  update public.deal_opens t set profile_id = f.id from first_profile f where t.profile_id is null and f.user_id = t.user_id and t.opened_at < v_cutover;
  with first_profile as (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at)
  update public.sourcing_missed t set profile_id = f.id from first_profile f where t.profile_id is null and f.user_id = t.user_id and t.missed_at < v_cutover;
end $$;
insert into public.profile_today_lists (profile_id, user_id, day, deal_ids, near_miss, advice, created_at)
select f.id, t.user_id, t.day, t.deal_ids, t.near_miss, t.advice, t.created_at
  from public.today_selections t
  join (select distinct on (user_id) user_id, id from public.search_profiles order by user_id, created_at) f on f.user_id = t.user_id
on conflict (profile_id, day) do nothing;

-- ── New rows are tagged with the member's active profile unless the code says otherwise ──
-- Security definer: members insert pipeline rows through their own session
-- and cannot read search_profiles. The code still sets profile_id wherever
-- it matters (a pick's own profile, the profile a card was shown under).
create or replace function private.search_profiles_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.profile_id is null then
    select sp.id into new.profile_id from public.search_profiles sp
     where sp.user_id = new.user_id and sp.is_active and sp.deleted_at is null;
  end if;
  return new;
end;
$$;
revoke execute on function private.search_profiles_tag() from public;
drop trigger if exists search_profiles_tag on public.sourcing_sent;
create trigger search_profiles_tag before insert on public.sourcing_sent for each row execute function private.search_profiles_tag();
drop trigger if exists search_profiles_tag on public.deal_reactions;
create trigger search_profiles_tag before insert on public.deal_reactions for each row execute function private.search_profiles_tag();
drop trigger if exists search_profiles_tag on public.checked_listings;
create trigger search_profiles_tag before insert on public.checked_listings for each row execute function private.search_profiles_tag();
drop trigger if exists search_profiles_tag on public.sourcing_missed;
create trigger search_profiles_tag before insert on public.sourcing_missed for each row execute function private.search_profiles_tag();

-- ── The live copies keep the active profile up to date ──
create or replace function private.search_profiles_sync_goals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.search_profiles
     set criteria = new.market_goals, updated_at = now()
   where user_id = new.id and is_active and deleted_at is null;
  return new;
end;
$$;
revoke execute on function private.search_profiles_sync_goals() from public;
drop trigger if exists search_profiles_sync_goals on public.profiles;
create trigger search_profiles_sync_goals after update of market_goals on public.profiles
  for each row when (old.market_goals is distinct from new.market_goals)
  execute function private.search_profiles_sync_goals();

create or replace function private.search_profiles_sync_areas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
begin
  update public.search_profiles
     set areas = coalesce((select array_agg(s.postcode_area order by s.postcode_area) from public.saved_areas s where s.user_id = v_user), '{}'),
         updated_at = now()
   where user_id = v_user and is_active and deleted_at is null;
  return null;
end;
$$;
revoke execute on function private.search_profiles_sync_areas() from public;
drop trigger if exists search_profiles_sync_areas on public.saved_areas;
create trigger search_profiles_sync_areas after insert or delete on public.saved_areas
  for each row execute function private.search_profiles_sync_areas();

create or replace function private.search_profiles_sync_answered()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.search_profiles
     set answered = new.answered, updated_at = now()
   where user_id = new.user_id and is_active and deleted_at is null;
  return new;
end;
$$;
revoke execute on function private.search_profiles_sync_answered() from public;
drop trigger if exists search_profiles_sync_answered on public.profile_quiz;
create trigger search_profiles_sync_answered after insert or update of answered on public.profile_quiz
  for each row execute function private.search_profiles_sync_answered();

-- ── Create: the limit is checked under the member's row lock, so two at once cannot make a sixth ──
-- p: {user, name, criteria, areas, answered, for_client, copied_from}
-- Raises profile_limit (P0409) at billing_settings.saved_profiles_max.
create or replace function public.create_search_profile(p jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_max integer := coalesce((select (value #>> '{}')::integer from public.billing_settings where key = 'saved_profiles_max'), 5);
  v_count integer;
  v_id uuid;
begin
  if v_user is null then raise exception 'profile_user_required'; end if;
  perform 1 from public.profiles where id = v_user for no key update;
  select count(*) into v_count from public.search_profiles where user_id = v_user and deleted_at is null;
  if v_count >= v_max then
    raise exception 'profile_limit' using errcode = 'P0409', detail = json_build_object('max', v_max)::text;
  end if;
  insert into public.search_profiles (user_id, name, criteria, areas, answered, for_client, copied_from, is_active)
  values (
    v_user,
    btrim(p->>'name'),
    p->'criteria',
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'areas', '[]'::jsonb)) x), '{}'),
    coalesce(p->'answered', '{}'::jsonb),
    coalesce((p->>'for_client')::boolean, false),
    nullif(p->>'copied_from', '')::uuid,
    v_count = 0
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_search_profile(jsonb) from public, anon, authenticated;
grant execute on function public.create_search_profile(jsonb) to service_role;

-- ── Switch: save the old active profile, load the new one into the live copies ──
-- p: {user, profile, shared: [question ids stored in about_you]}
-- The About-you marks are the member's, not the profile's, so they are kept
-- as they are; every other mark comes from the profile switched to.
-- Raises profile_not_found (P0404) for a deleted, unknown or someone else's profile.
create or replace function public.select_search_profile(p jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_target uuid := nullif(p->>'profile', '')::uuid;
  v_shared text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'shared', '[]'::jsonb)) x), '{}');
  v_row public.search_profiles%rowtype;
  v_old uuid;
begin
  perform 1 from public.profiles where id = v_user for no key update;
  select * into v_row from public.search_profiles where id = v_target and user_id = v_user and deleted_at is null;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0404';
  end if;
  select id into v_old from public.search_profiles where user_id = v_user and is_active and deleted_at is null;
  if v_old = v_target then return v_target; end if;
  if v_old is not null then
    update public.search_profiles sp
       set is_active = false,
           criteria = pr.market_goals,
           areas = coalesce((select array_agg(s.postcode_area order by s.postcode_area) from public.saved_areas s where s.user_id = v_user), '{}'),
           answered = coalesce((select q.answered from public.profile_quiz q where q.user_id = v_user), sp.answered),
           updated_at = now()
      from public.profiles pr
     where sp.id = v_old and pr.id = v_user;
  end if;
  update public.search_profiles set is_active = true, updated_at = now() where id = v_target;
  update public.profiles set market_goals = v_row.criteria, market_goals_updated_at = now() where id = v_user;
  delete from public.saved_areas where user_id = v_user and not (postcode_area = any (v_row.areas));
  insert into public.saved_areas (user_id, postcode_area)
  select v_user, a from unnest(v_row.areas) a
  on conflict (user_id, postcode_area) do nothing;
  update public.profile_quiz q
     set answered = (v_row.answered - v_shared)
                    || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(q.answered) e where e.key = any (v_shared)), '{}'::jsonb),
         updated_at = now()
   where q.user_id = v_user;
  return v_target;
end;
$$;
revoke all on function public.select_search_profile(jsonb) from public, anon, authenticated;
grant execute on function public.select_search_profile(jsonb) to service_role;

-- ── Setting: how many profiles a member may keep (read by maxProfilesSetting in src/lib/profiles/server.ts) ──
insert into public.billing_settings (key, value) values ('saved_profiles_max', '5'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- =========================
-- Batch 14: tailoring
-- =========================
-- What a member's answers do to their Today (src/lib/tailoring). Run AFTER
-- Batch 13's section: it adds to that section's tables. Everything is
-- additive and idempotent, service role only, and nothing here is in
-- ACCESS_COLUMNS (src/lib/access.ts), nor may it become so. The code reads
-- every column below in a query of its own, so this section can be run
-- before or after the code is deployed: until it is, members simply get no
-- must-have switches and no "never shown twice" record for replaced cards.

-- ── A profile's must-have / nice-to-have switches (src/lib/tailoring/profile.ts) ──
-- {criterion: 'must' | 'nice'}, only what the member set; anything absent is
-- the default. Its own column, outside criteria, so the goal writers (the
-- quiz, the Advanced form, the relaxation link) can never overwrite it.
alter table public.search_profiles add column if not exists filter_modes jsonb not null default '{}'::jsonb;

-- ── What a re-choose took off today's list, and the day's must-have count ──
-- shown_ids: deals shown on the list and then replaced (a switch, a widen, an
-- accepted prompt), so "never shown twice" still holds for them. deal_ids
-- keeps what is on the list now.
-- tailoring: {mustMatches, capped}, the deals meeting every must-have when
-- the list was chosen, for "N deals match you" on Today.
alter table public.profile_today_lists add column if not exists shown_ids uuid[] not null default '{}';
alter table public.profile_today_lists add column if not exists tailoring jsonb;

-- ── When each behaviour prompt was shown and answered (src/lib/tailoring/behaviour.ts) ──
-- "You've kept 4 houses but said flats only." One row per member, profile and
-- question: asked at most once a week, and not for 30 days after "keep my
-- answer". scope is the profile's id, or 'member' for a member with no
-- profile row yet.
create table if not exists public.tailoring_prompts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  question text not null,
  last_shown_at timestamptz,
  answered_at timestamptz,
  answer text check (answer in ('accepted', 'dismissed')),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, question)
);
alter table public.tailoring_prompts enable row level security;  -- no policies: service role only
revoke all on public.tailoring_prompts from anon, authenticated;

notify pgrst, 'reload schema';

-- =========================
-- Batch 15: demand-led sourcing
-- =========================
-- Members' running saved profiles steer which extra areas get searched
-- (src/lib/sourcing-demand). An area × kind that at least
-- billing_settings.demand_min_members members want, and that the
-- marketplace sweep does not already cover, is searched by the
-- /api/internal/demand-sourcing cron, within a provider-spend cap per UK
-- calendar month (billing_settings.demand_monthly_cap_pence). The sweep's
-- own list is never shortened by any of this. Service role only. Nothing
-- here is in ACCESS_COLUMNS (src/lib/access.ts), and must not become so.
-- Everything is additive: this section can be run before the code is merged,
-- and until it is run the demand cron searches nothing (it fails closed).

-- demand_searches: one row per demand-led search. A search claims its
-- worst-case cost first (demand_search_reserve) and is settled to what its
-- metered provider calls actually cost. The month's spend is the settled
-- costs plus any open claims at their reserve, so a pass that dies
-- mid-search errs on the safe side. status: reserved → answered (the broker
-- gave listings) | unavailable (it gave none) | failed (an error, or a claim
-- left open and closed at its reserve). At most one reserved or answered
-- search per area × kind per UK day, so a scheduled pass and an admin's
-- "run a pass" can never both search the same area.
create table if not exists public.demand_searches (
  id uuid primary key default gen_random_uuid(),
  month date not null,                         -- first day of the UK calendar month the spend counts against
  day date not null,                           -- the UK day, for "searched today"
  postcode_area text not null,
  kind text not null,                          -- sale | rent
  query_key text not null,
  status text not null default 'reserved',
  reserve_pence numeric(14,4) not null default 0,
  cost_pence numeric(14,4),                    -- raw provider cost, once settled
  provider text,                               -- the broker rung that answered: pmi | onthemarket
  cached boolean,
  listings int,
  new_deals int,
  members int not null default 0,              -- the demand when it was searched
  paying_members int not null default 0,
  action_id uuid not null,                     -- provider_calls.action_id of this search's calls
  run_id uuid,
  triggered_by text not null default 'cron',   -- cron, or the admin's email for "run a pass"
  reserved_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists demand_searches_month_idx on public.demand_searches (month);
create index if not exists demand_searches_reserved_idx on public.demand_searches (reserved_at desc);
create unique index if not exists demand_searches_daily_uidx on public.demand_searches (day, postcode_area, kind) where status in ('reserved', 'answered');
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.demand_searches'::regclass and conname = 'demand_searches_kind_check') then
    alter table public.demand_searches add constraint demand_searches_kind_check check (kind in ('sale', 'rent'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.demand_searches'::regclass and conname = 'demand_searches_status_check') then
    alter table public.demand_searches add constraint demand_searches_status_check check (status in ('reserved', 'answered', 'unavailable', 'failed'));
  end if;
end $$;
alter table public.demand_searches enable row level security;  -- no policies: service role only
revoke all on public.demand_searches from anon, authenticated;

-- Claims one search. p: {month, day, area, kind, key, reserve_pence,
-- cap_pence, action_id, run_id, triggered_by, members, paying_members}.
-- Returns {id, refused, spent_pence}. refused is null (go ahead), 'cap' (the
-- month's spend plus this reserve would pass the cap; a cap of 0 refuses
-- everything) or 'duplicate' (already reserved or answered today). The claim
-- has to be the write: one transaction-scoped lock serialises claims, so
-- parallel passes can never both slip under the cap on the same figure.
create or replace function public.demand_search_reserve(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_month date := (p->>'month')::date;
  v_reserve numeric := greatest(0, coalesce((p->>'reserve_pence')::numeric, 0));
  v_cap numeric := coalesce((p->>'cap_pence')::numeric, 0);
  v_spent numeric;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.demand_searches'));
  select coalesce(sum(case when s.settled_at is null then s.reserve_pence else coalesce(s.cost_pence, 0) end), 0)
    into v_spent
    from public.demand_searches s
   where s.month = v_month;
  if v_cap <= 0 or v_spent + v_reserve > v_cap then
    return jsonb_build_object('id', null, 'refused', 'cap', 'spent_pence', v_spent);
  end if;
  insert into public.demand_searches (month, day, postcode_area, kind, query_key, reserve_pence, members, paying_members, action_id, run_id, triggered_by)
  values (
    v_month,
    (p->>'day')::date,
    p->>'area',
    p->>'kind',
    p->>'key',
    v_reserve,
    coalesce((p->>'members')::int, 0),
    coalesce((p->>'paying_members')::int, 0),
    (p->>'action_id')::uuid,
    nullif(p->>'run_id', '')::uuid,
    coalesce(nullif(p->>'triggered_by', ''), 'cron')
  )
  on conflict (day, postcode_area, kind) where status in ('reserved', 'answered') do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('id', null, 'refused', 'duplicate', 'spent_pence', v_spent);
  end if;
  return jsonb_build_object('id', v_id, 'refused', null, 'spent_pence', v_spent + v_reserve);
end;
$$;
revoke all on function public.demand_search_reserve(jsonb) from public, anon, authenticated;
grant execute on function public.demand_search_reserve(jsonb) to service_role;

-- The month's figures for the cap check and /admin/demand. p: {month}.
-- Summed here so no caller ever has to page through the rows.
create or replace function public.demand_sourcing_month(p jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'spent_pence', coalesce(sum(case when s.settled_at is null then s.reserve_pence else coalesce(s.cost_pence, 0) end), 0),
    'open_pence', coalesce(sum(case when s.settled_at is null then s.reserve_pence else 0 end), 0),
    'searches', count(*),
    'answered', count(*) filter (where s.status = 'answered'),
    'new_deals', coalesce(sum(s.new_deals), 0)
  )
  from public.demand_searches s
  where s.month = (p->>'month')::date;
$$;
revoke all on function public.demand_sourcing_month(jsonb) from public, anon, authenticated;
grant execute on function public.demand_sourcing_month(jsonb) to service_role;

-- ── Settings (src/lib/sourcing-demand/settings.ts has the defaults and bounds; /admin/demand edits them) ──
--   demand_min_members            members whose running profiles must want an area × kind before it is searched
--   demand_monthly_cap_pence      provider spend on demand-led searches per UK calendar month (10000 = £100)
--   demand_paying_weight          how much a paying member counts in the search order (not in the threshold)
--   demand_radius_areas           a "near me" radius adds the home area plus up to this many nearest areas inside it
--   demand_active_days            a member counts only if seen in the app within this many days
--   demand_max_areas_per_profile  the most areas one profile adds
insert into public.billing_settings (key, value) values
  ('demand_min_members', '2'::jsonb),
  ('demand_monthly_cap_pence', '10000'::jsonb),
  ('demand_paying_weight', '2'::jsonb),
  ('demand_radius_areas', '5'::jsonb),
  ('demand_active_days', '30'::jsonb),
  ('demand_max_areas_per_profile', '10'::jsonb)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

-- =========================
-- Batch 16: deal quality
-- =========================
-- Each marketplace deal is checked on its own Airbnb comparables before it is
-- shown; cheaper-entry deal streams; past reports cleaned up; spend safety
-- (src/lib/deal-quality). Every statement is idempotent: re-running this
-- section changes nothing. Service role only. Nothing here is in
-- ACCESS_COLUMNS (src/lib/access.ts), and must not become so.

-- ── Settings (defaults and bounds in code; a missing or bad row takes the default) ──
--   r2r_qualified_profit   the rent-to-rent bar: £ a year of profit after rent and running
--                          costs (src/lib/listing/screen.ts parseR2rBar: whole pounds from
--                          £4,000, the medium bar, to £20,000; was £8,000). Edited on /admin/deals.
insert into public.billing_settings (key, value) values
  ('r2r_qualified_profit', '6000'::jsonb)
on conflict (key) do nothing;

-- ── Auction lots (Part E; src/lib/deal-quality/auction.ts has the defaults and bounds) ──
--   auction_model   how an auction lot is priced from its guide: the usual uplift (%), the
--                   buyer's premium (£1,500 inc VAT in a traditional room; the modern method's
--                   4.5% + VAT, at least £6,000), and the bridging loan it completes on
--                   (70% LTV, 0.85% a month, 2% arrangement, £2,000 legal and valuation,
--                   12 months) before refinancing onto the member's own mortgage.
insert into public.billing_settings (key, value) values
  ('auction_model', '{"upliftPct": 15, "traditionalPremium": 1500, "modernPremiumPct": 4.5, "vatPct": 20, "modernPremiumMin": 6000, "bridgingLtvPct": 70, "bridgingMonthlyPct": 0.85, "arrangementPct": 2, "legalAndValuation": 2000, "termMonths": 12}'::jsonb)
on conflict (key) do nothing;

-- ── Past reports: the Monday backfill clean-up (Part D; src/lib/deal-quality/backfill.ts) ──
-- analyser_reports_removed: every analyser_reports row the clean-up removes,
-- archived whole before it is deleted (an exact duplicate of another row, or
-- an earlier analysis of the same file), with the row it gave way to. Nothing
-- is deleted unless its archive row was written. Service role only.
create table if not exists public.analyser_reports_removed (
  id uuid primary key,                 -- the removed row's own id
  removed_at timestamptz not null default now(),
  reason text not null,                -- exact_duplicate | reanalysed
  kept_id uuid,                        -- the row that stays in its place
  removed_by text,                     -- the admin's email, or 'internal'
  row jsonb not null                   -- the whole row as it was
);
alter table public.analyser_reports_removed enable row level security;  -- no policies: service role only
revoke all on public.analyser_reports_removed from anon, authenticated;

-- ── Spend safety (Part H) ──
--   area_rent_daily_attempts   the most PropertyData long-let lookups the market snapshot may
--                              make for its areas in a UTC day, failed attempts included
--                              (src/lib/market/area-longlet.ts). 0 stops them.
insert into public.billing_settings (key, value) values
  ('area_rent_daily_attempts', '40'::jsonb)
on conflict (key) do nothing;

-- provider_calls.cost_pence is a whole number, so a 2.5p PropertyData credit
-- logged as 3p and a 0.395p geocode as 0. raw_pence keeps the exact cost the
-- meter priced (null on rows written before this column); spend reads use
-- coalesce(raw_pence, cost_pence).
alter table public.provider_calls add column if not exists raw_pence numeric(14,4);

-- Spend reads that see every row. PostgREST returns at most 1,000 rows a
-- query, so the admin spend views and the broker's daily budget summed only
-- the first 1,000 calls of a day or week: during the 12–25 Sep valuation-rent
-- loop the budgets could not bind and the views showed a fraction of it.
-- Service role only.

-- A provider's spend since p_since by the broker's own lookups (questions not
-- named '<provider>.<unit>'), all payers or one: the broker's daily budget.
create or replace function public.provider_spend_since(p_provider text, p_since timestamptz, p_user uuid default null)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(c.raw_pence, c.cost_pence)), 0)::numeric
  from public.provider_calls c
  where c.provider = p_provider
    and c.ok
    and c.at >= p_since
    and c.question not like p_provider || '.%'
    and (p_user is null or c.user_id = p_user);
$$;
revoke all on function public.provider_spend_since(text, timestamptz, uuid) from public, anon, authenticated;

-- Calls and spend per UTC day and provider since p_since: the admin dashboard.
create or replace function public.provider_spend_daily(p_since timestamptz)
returns table (day text, provider text, calls bigint, cache_hits bigint, failed bigint, pence numeric)
language sql
stable
set search_path = ''
as $$
  select to_char(c.at at time zone 'UTC', 'YYYY-MM-DD'), c.provider, count(*), count(*) filter (where c.cache_hit), count(*) filter (where not c.ok),
         coalesce(sum(coalesce(c.raw_pence, c.cost_pence)), 0)::numeric
  from public.provider_calls c
  where c.at >= p_since
  group by 1, 2;
$$;
revoke all on function public.provider_spend_daily(timestamptz) from public, anon, authenticated;

-- Paid calls per provider × unit since p_since, with what was charged and
-- what was house spend: /admin/billing.
create or replace function public.provider_spend_by_unit(p_since timestamptz)
returns table (provider text, unit text, calls bigint, raw_pence numeric, charged_pence numeric, house_pence numeric)
language sql
stable
set search_path = ''
as $$
  select c.provider, coalesce(c.unit, ''), count(*),
         coalesce(sum(coalesce(c.raw_pence, c.cost_pence)), 0)::numeric,
         coalesce(sum(c.charged_pence), 0)::numeric,
         coalesce(sum(coalesce(c.raw_pence, c.cost_pence)) filter (where not coalesce(c.charged_pence, 0) > 0), 0)::numeric
  from public.provider_calls c
  where c.at >= p_since and c.ok and not c.cache_hit
  group by 1, 2;
$$;
revoke all on function public.provider_spend_by_unit(timestamptz) from public, anon, authenticated;

-- ── The three streams and the nationwide low-entry search (Part F; src/lib/deal-quality/streams.ts) ──
--   low_entry        the low-entry stream's bar (a sale the house deal model gets into for at most
--                    maxCashIn, £), and the nationwide search's price cap (£), bedroom floor, weekly
--                    spend cap (raw pence, Monday to Sunday UK time) and areas a pass. Bounds in
--                    src/lib/deal-quality/config.ts; edited on /admin/deals.
--   deal_comps       the deal check's comparables search (Step 0, Part B): target count, radius
--   deal_confidence  steps, minimum, setting check; the confidence bands; the daily checks' limits.
--   deal_checks      Defaults and bounds in src/lib/deal-quality/config.ts.
insert into public.billing_settings (key, value) values
  ('low_entry', '{"maxCashIn": 50000, "searchMaxPrice": 135000, "minBedrooms": 1, "weeklyCapPence": 400, "areasPerPass": 8}'::jsonb),
  ('deal_comps', '{"targetCount": 12, "radiiKm": [0.8, 2, 5, 12, 25], "maxRadiusKm": 25, "minComps": 5, "setting": {"minRadiusKm": 5, "neighbourKm": 1.5, "ratio": 3, "minCluster": 3}}'::jsonb),
  ('deal_confidence', '{"highPct": 20, "mediumPct": 40, "mediumMaxComps": 7}'::jsonb),
  ('deal_checks', '{"perDay": 20, "dailyCapPence": 100, "split": {"top60": 6, "low_entry": 8, "r2r": 6}, "maxCallsPerCheck": 3, "validDays": 180, "shortlistExpiryDays": 7, "recheckCeilingPence": 1200}'::jsonb)
on conflict (key) do nothing;

-- marketplace_deals.stream: which stream a deal is in — top60 (a sale in the
-- sweep's areas), low_entry (a sale the house finance gets into for at most
-- the low-entry cash; an auction lot at its auction price) or r2r (a rental).
-- Set when the record is built (src/lib/marketplace/record.ts); the code
-- writes it through writeWithoutMissing, so a database without the column
-- still takes the row. Rows from before the column are filled in once, from
-- the house-finance deal they carry, at the seeded £50,000 bar.
alter table public.marketplace_deals add column if not exists stream text;
create index if not exists marketplace_deals_live_stream_idx on public.marketplace_deals (stream, kind) where status = 'live';
update public.marketplace_deals
set stream = case
  when kind = 'rent' then 'r2r'
  when deal->>'kind' = 'purchase' and (deal->>'cashRequired')::numeric > 0 and (deal->>'cashRequired')::numeric <= 50000 then 'low_entry'
  else 'top60'
end
where stream is null;
-- marketplace_runs.kind also takes 'low_entry_search' (src/lib/deal-quality/low-entry-run.ts).

-- ── The daily paid checks (Part B; src/lib/deal-quality/checks.ts, checks-run.ts, recheck-comps-run.ts) ──
-- No new column. A qualifying listing now waits as marketplace_deals.status
-- 'pending_check' (the shortlist: invisible to members, like pending_verify)
-- for its own Airbnb comparables check; the check it gets is kept on the
-- deal's own screening (screening.check: gross, adr, occupancy, compCount,
-- spreadPct, confidence, radiusKm, calls, pence, checkedAt, bedrooms, kind),
-- so every later re-screen builds on it while it is good, and a database
-- that has not run this section still takes every row. While a deal is
-- shortlisted, next_check_due_at is when it is dropped unchecked and
-- check_failures counts its failed searches (three retire it as
-- unverifiable). Two more retired_reason values: 'insufficient_data' (too
-- few similar homes within the widest radius: never shown, never revived)
-- and 'unchecked' (dropped from the shortlist, or retired by the admin
-- button; revived onto the shortlist like unqualified). marketplace_runs.kind
-- also takes 'deal_checks' (the nightly job) and 'deal_recheck' (the one-off
-- re-check of live deals, and the retire-unchecked button), each with who
-- ran it; today's runs are what the day's cap is read from. A check also
-- writes an analyser_reports row with source 'deal_comps', keyed on the deal
-- id (request_id) so a re-check replaces it, carrying the outward code only
-- (never the full postcode, the address or the listing): those rows feed the
-- area and district figures and stay out of the single-postcode figure
-- (src/lib/market/quality.ts).
create index if not exists marketplace_deals_shortlist_idx on public.marketplace_deals (annual_profit desc) where status = 'pending_check';

notify pgrst, 'reload schema';

-- =========================
-- Batch 17: project deals
-- =========================
-- Project (BRRR) deals: sale listings whose own words say they need work,
-- photo-checked within a daily allowance, costed as a guide, valued after
-- works against sold prices and shown only when the value added is real
-- (src/lib/project). And "Which deals do you want to see?" per profile
-- (src/lib/profile/deal-types.ts): that needs no column, it lives in the
-- profile's goals JSON (search_profiles.criteria, profiles.market_goals).
--
-- Run Batch 16's section first: this one builds on its 'pending_check'
-- status and its stream column. Every statement is idempotent: re-running
-- this section changes nothing. Service role only. Nothing here is in
-- ACCESS_COLUMNS (src/lib/access.ts), and must not become so; no new
-- column is in CARD_COLUMNS or DEAL_COLUMNS either: the app reads them with
-- their own tolerant selects, so it keeps working before this is run.

-- ── marketplace_deals ──
-- needs_work: the listing's renovation wording as our own phrase keys
--   ({flag, score, phrases}, src/lib/project/needs-work.ts); never its words.
-- project: a Project deal's card numbers (src/lib/project/headline.ts
--   ProjectCardData: works range, value after works, value added, months,
--   cash range, money left in). Numbers only: never a line, a reason or a
--   photo; those stay in project_estimates, read only after an open.
alter table public.marketplace_deals add column if not exists needs_work jsonb;
alter table public.marketplace_deals add column if not exists project jsonb;
create index if not exists marketplace_deals_live_project_idx on public.marketplace_deals ((project is not null), kind) where status = 'live';
create index if not exists marketplace_deals_project_shortlist_idx on public.marketplace_deals (first_seen_at) where status = 'pending_check' and stream = 'project';
-- marketplace_deals.stream also takes 'project': a sale held on the shortlist
-- for its comparables check and then its Project photo check. New
-- retired_reason values, none of them revived:
--   not_project           it needs work, but the value added does not pass
--   project_excluded      non-standard construction, a lease under 80 years,
--                         listed, a conservation area, structural red flags
--   project_no_evidence   fewer than 5 sold prices of its type within 3 miles
--   project_uncheckable   flagged, but its page can never be read (Zoopla)
-- marketplace_runs.kind also takes 'project_checks' (the project job, with
-- who ran it) and 'project_backfill' (the one-off pass over the live deals
-- whose words say they need work, dry runs included).

-- ── project_checks: one photo-check claim a listing a UK day ──
-- Claimed through project_claim_check (below) before the call is made, so
-- the day's allowance and spend cap hold across concurrent runs. The photo
-- URLs, the validated answer and the tokens stay here, private.
create table if not exists public.project_checks (
  id uuid primary key default gen_random_uuid(),
  canonical_url text not null,
  deal_id uuid,
  check_day date not null,                      -- the UK day it was claimed on
  status text not null default 'claimed',      -- claimed | done | refused | invalid | max_tokens | unavailable | failed
  model text,                                   -- the model that answered
  fell_back boolean not null default false,     -- a refusal re-run on the fallback
  photos jsonb,                                 -- the photo URLs sent, in order: the answer's numbers refer to these
  floorplans jsonb,
  findings jsonb,                               -- the validated answer (src/lib/project/photo-check-schema.ts)
  usage jsonb,                                  -- tokens a hop, at the model that ran it
  cost_pence numeric(12,4) not null default 0,  -- raw provider spend
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists project_checks_day_uidx on public.project_checks (canonical_url, check_day);
create index if not exists project_checks_check_day_idx on public.project_checks (check_day);
alter table public.project_checks enable row level security;  -- no policies: service role only
revoke all on public.project_checks from anon, authenticated;

-- ── project_prep: a candidate's day of free and cheaper steps ──
-- Each UK day a candidate is prepped before its photo check: its page read
-- again (the photos and floorplans the check will look at, by URL), the
-- exclusions, the free best case, the planning checks and the sold-price
-- ceiling (both through the broker, so a repeat within its cache is free).
-- Also the days a step failed: three and the listing is let go. Private:
-- the photo URLs are never shown before a deal is opened.
create table if not exists public.project_prep (
  canonical_url text primary key,
  deal_id uuid,
  price numeric,                                -- the asking price the steps were taken at
  prepped_on date,                              -- the UK day of the page read
  photos jsonb,                                 -- the page's photo URLs, in order (at most project_checks.maxPhotos)
  floorplans jsonb,
  facts jsonb,                                  -- bedrooms, bathrooms, type, floor area, tax country
  best_case jsonb,
  exclusion text,
  ceiling jsonb,                                -- {value, sales, radiusMiles, basis}; null: not enough evidence
  sold_checked_at timestamptz,
  designation jsonb,                            -- {listed, conservation} from PropertyData
  designation_checked_at timestamptz,
  outcome text,                                 -- ready | excluded | not_project | no_evidence | auction | released | retired | failed
  failed_days int not null default 0,
  last_failed_day date,
  updated_at timestamptz not null default now()
);
alter table public.project_prep enable row level security;  -- no policies: service role only
revoke all on public.project_prep from anon, authenticated;

-- ── project_estimates: the full estimate, read only after the deal is opened ──
-- The lines with their reasons and photo numbers, the works, the value and
-- the finance (src/lib/project/estimate.ts), with the photo URLs the
-- numbers refer to. The deal sheet's working section reads it for a member
-- who has opened the deal; nothing else shows it.
create table if not exists public.project_estimates (
  deal_id uuid primary key,
  canonical_url text not null,
  version int not null default 1,
  price numeric not null,
  estimate jsonb not null,
  photos jsonb not null default '[]'::jsonb,
  check_id uuid,
  estimated_at timestamptz not null default now()
);
create index if not exists project_estimates_url_idx on public.project_estimates (canonical_url);
alter table public.project_estimates enable row level security;  -- no policies: service role only
revoke all on public.project_estimates from anon, authenticated;

-- ── project_member_figures: a member's own working, every version kept ──
-- Private to the member: never shown to anyone else, never used to change
-- the house estimate. At most one locked version a member a deal.
create table if not exists public.project_member_figures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  deal_id uuid not null,
  version int not null,
  lines jsonb not null,
  figures jsonb not null,
  locked boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists project_member_figures_version_uidx on public.project_member_figures (user_id, deal_id, version);
create unique index if not exists project_member_figures_locked_uidx on public.project_member_figures (user_id, deal_id) where locked;
alter table public.project_member_figures enable row level security;  -- no policies: service role only
revoke all on public.project_member_figures from anon, authenticated;

-- ── project_claim_check: one photo check claimed against the day's allowance ──
-- Under an advisory lock, so two runs cannot both take the last slot: a
-- listing is checked at most once a UK day, at most p_max times a day in
-- all, and only while the day's spend plus this check's worst case stays
-- within p_cap_pence. The claim is written at that worst case, so a check
-- still running (or one whose run died before writing its cost) counts in
-- full against the cap; the run replaces it with the real cost. Returns
-- {ok, reason}. Service role only.
create or replace function public.project_claim_check(p_url text, p_deal uuid, p_day date, p_max int, p_cap_pence numeric, p_worst_pence numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used int;
  v_spent numeric;
begin
  perform pg_advisory_xact_lock(hashtext('project_claim_check'));
  if exists (select 1 from public.project_checks where canonical_url = p_url and check_day = p_day) then
    return jsonb_build_object('ok', false, 'reason', 'already_today');
  end if;
  select count(*), coalesce(sum(cost_pence), 0) into v_used, v_spent from public.project_checks where check_day = p_day;
  if v_used >= greatest(p_max, 0) then
    return jsonb_build_object('ok', false, 'reason', 'allowance');
  end if;
  if v_spent + greatest(p_worst_pence, 0) > greatest(p_cap_pence, 0) then
    return jsonb_build_object('ok', false, 'reason', 'cap');
  end if;
  insert into public.project_checks (canonical_url, deal_id, check_day, status, cost_pence) values (p_url, p_deal, p_day, 'claimed', greatest(p_worst_pence, 0));
  return jsonb_build_object('ok', true, 'reason', null);
end;
$$;
revoke all on function public.project_claim_check(text, uuid, date, int, numeric, numeric) from public, anon, authenticated;
grant execute on function public.project_claim_check(text, uuid, date, int, numeric, numeric) to service_role;

-- ── Settings (defaults and bounds in code, src/lib/project/config.ts and src/lib/today/mix.ts; a missing or bad row takes the default) ──
--   project_rates        the works lines' rates (£, VAT included), the kitchen size factors, contingency %
--   project_quantities   rooms, carpets, windows, doors and damp walls from the bedrooms; the rewire's baseline
--   project_value        value after works: 2× visible, 1× hidden and can't-tell works; the test: value added
--                        (value − price − works at the high end) of at least £15,000 and 10% of the value;
--                        the refinance at 75% of the value
--   project_ceiling      sold prices: 0.5 → 3 miles until 10 sales (at least 5), weights 1 / 0.75 / 0.5 / 0.25,
--                        the weighted 75th percentile, the last 24 months
--   project_costs        buying costs (£2,500; £3,500 with a bridge), months held, the level thresholds
--                        (full above £15k of works, light under £5k), the bridge's terms
--   project_checks       the job's switch (off), sold-price lookups a day, days before giving up, photos sent,
--                        reuse window, the planning checks, the model's effort
--   today_mix            Today's mix of deal types: 2 Short-let / 2 Rent-to-rent / 1 BRRR, 3 / 2 for two types,
--                        shifted over 14 days' Keeps at 3 Keeps a slot, at least 1 of each chosen type
-- The photo checks' allowance (5 a UK day) and Batch 17's spend line (250p a
-- UK day: photo checks, sold prices and planning checks together) sit in
-- Batch 16's deal_checks row as projectPhotoChecks / projectCapPence, beside
-- that cap on /admin/deals; read with those defaults while the row lacks them.
insert into public.billing_settings (key, value) values
  ('project_rates', '{"waste":300,"rewire":4500,"boiler":2500,"radiator":300,"waterTank":2500,"pipework":500,"bathroom":2000,"plaster":500,"skirting":650,"paint":350,"kitchen":4000,"kitchenFactors":{"small":1,"big":1.5,"extra_big":2},"carpet":250,"roof":3000,"window":400,"outsideDoor":600,"internalDoor":300,"damp":350,"contingencyPct":10}'::jsonb),
  ('project_quantities', '{"roomsPlusBedrooms":2,"carpetsPlusBedrooms":1,"windowsPlusRooms":1,"outsideDoorsHouse":2,"outsideDoorsFlat":1,"dampWallsHouse":4,"dampWallsFlat":2,"defaultBathrooms":1,"rewireBaselineRooms":5,"rewireBaselineSqft":900}'::jsonb),
  ('project_value', '{"visibleMultiplier":2,"hiddenMultiplier":1,"minUplift":15000,"minUpliftPctOfValue":10,"refinancePct":75}'::jsonb),
  ('project_ceiling', '{"radiiMiles":[0.5,1,2,3],"weights":[1,0.75,0.5,0.25],"months":24,"targetSales":10,"minSales":5,"quantile":0.75}'::jsonb),
  ('project_costs', '{"buyingCosts":2500,"buyingCostsBridging":3500,"monthsLight":2,"monthsFull":4,"monthsFullLarge":6,"largeFromBedrooms":4,"bridgeWorksPct":0,"arrangementFee":true,"legalAndValuation":false,"fullAboveWorks":15000,"lightBelowWorks":5000}'::jsonb),
  ('project_checks', '{"enabled":false,"soldLookupsPerDay":15,"giveUpDays":3,"maxPhotos":10,"reuseDays":60,"planningChecks":true,"effort":"medium"}'::jsonb),
  ('today_mix', '{"all":{"buy_str":2,"brrr":1,"r2r":2},"two":[3,2],"windowDays":14,"keepsPerSlot":3,"floor":1}'::jsonb)
on conflict (key) do nothing;

-- =========================
-- Batch 18: feedback and announcements
-- =========================
-- Members tell us about bugs and ideas from inside the app, and we tell them
-- what became of them (src/lib/feedback): a report per send, a status email
-- per report and status, and announcements shown as one banner at the top of
-- the members' pages. Every table here is service role only (RLS on, no
-- policies, nothing granted to anon or authenticated): a member sends and
-- reads their own reports only through the app's routes, which take the
-- member from the session, so the daily limit and the email to the admin
-- address cannot be skipped by writing to a table directly. Screenshots live
-- in the private storage bucket 'feedback-screenshots' (below), shown to
-- admins only through links that expire after five minutes, and deleted by
-- /api/internal/feedback-retention after
-- billing_settings.feedback_screenshot_retention_days. Nothing is charged.
-- Nothing here is in ACCESS_COLUMNS (src/lib/access.ts), and must not become
-- so. Everything is additive: this section can be run before the code is
-- merged, and until it is run the form says it cannot send, the banner shows
-- nothing and the admin pages say to run it.

-- ── feedback_reports: one row per bug report or idea (src/lib/feedback/server.ts) ──
--   ref              the short number people use ("#123")
--   kind             bug | feature
--   body             the member's text, plain (src/lib/feedback/rules.ts cleanText)
--   status           new | planned | done (reads Fixed on a bug, Built on an
--                    idea) | not_doing
--   duplicate_of     the original, once admin marks this a duplicate: it then
--                    follows the original's status and message, and is left
--                    out of the totals. Never itself (checked) and never a
--                    chain (the app points duplicates at the original)
--   admin_note       private to admins; never shown to the member
--   status_message   the one line sent with the latest status email, also
--                    shown on "Your feedback"
--   context          what the form captured, for admins only: the page,
--                    device, screen, app version, plan, team, active profile
--   client_key       the form's own id for this send: a retry comes back as
--                    the same report (feedback_submit)
--   admin_emailed_at when the email to the admin address went; null until it
--                    has, and the daily retention run retries it
create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  ref bigint generated always as identity unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  body text not null,
  status text not null default 'new',
  duplicate_of uuid references public.feedback_reports(id) on delete set null,
  admin_note text,
  status_message text,
  status_changed_at timestamptz,
  context jsonb not null default '{}'::jsonb,
  client_key text not null,
  screenshot_count int not null default 0,
  admin_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists feedback_reports_client_key_uidx on public.feedback_reports (user_id, client_key);
create index if not exists feedback_reports_created_idx on public.feedback_reports (created_at desc);
create index if not exists feedback_reports_user_idx on public.feedback_reports (user_id, created_at desc);
create index if not exists feedback_reports_duplicate_idx on public.feedback_reports (duplicate_of) where duplicate_of is not null;
create index if not exists feedback_reports_unemailed_idx on public.feedback_reports (created_at) where admin_emailed_at is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_reports'::regclass and conname = 'feedback_reports_kind_check') then
    alter table public.feedback_reports add constraint feedback_reports_kind_check check (kind in ('bug', 'feature'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_reports'::regclass and conname = 'feedback_reports_status_check') then
    alter table public.feedback_reports add constraint feedback_reports_status_check check (status in ('new', 'planned', 'done', 'not_doing'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_reports'::regclass and conname = 'feedback_reports_body_check') then
    alter table public.feedback_reports add constraint feedback_reports_body_check check (char_length(body) between 1 and 2000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_reports'::regclass and conname = 'feedback_reports_message_check') then
    alter table public.feedback_reports add constraint feedback_reports_message_check check (status_message is null or char_length(status_message) <= 200);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_reports'::regclass and conname = 'feedback_reports_not_own_duplicate') then
    alter table public.feedback_reports add constraint feedback_reports_not_own_duplicate check (duplicate_of is null or duplicate_of <> id);
  end if;
end $$;
alter table public.feedback_reports enable row level security;  -- no policies: service role only
revoke all on public.feedback_reports from anon, authenticated;

-- ── feedback_screenshots: the images sent with a report (src/lib/feedback/storage.ts) ──
-- One row per image in the private bucket, written before the upload. If the
-- upload fails, the image is removed (in case it landed) before the row, so
-- no stored image is ever without its row.
-- report_id is set to null when the report goes (the account was deleted),
-- so the retention run still finds the image and removes it. deleted_at: the
-- image has been removed from the bucket after the retention period; the row
-- stays, so admin can say so.
create table if not exists public.feedback_screenshots (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.feedback_reports(id) on delete set null,
  path text not null unique,
  content_type text not null,
  bytes int not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists feedback_screenshots_report_idx on public.feedback_screenshots (report_id);
create index if not exists feedback_screenshots_live_idx on public.feedback_screenshots (created_at) where deleted_at is null;
alter table public.feedback_screenshots enable row level security;  -- no policies: service role only
revoke all on public.feedback_screenshots from anon, authenticated;

-- ── feedback_status_emails: one per report and status (src/lib/feedback/server.ts) ──
-- When admin moves a report to planned, done or not_doing, its reporter and
-- the reporters of its duplicates are emailed: one email per member, keyed on
-- that member's own report. The unique (report_id, status) is the rule "each
-- status at most once": a report that goes Planned → New → Planned is told
-- Planned once. state: claimed → sent | failed | skipped (no email address).
-- The claim is the write (feedback_status_claim): a failed row, or one left
-- claimed after its send died, can be taken again; a sent one never.
create table if not exists public.feedback_status_emails (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.feedback_reports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null,
  message text,
  state text not null default 'claimed',
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);
create unique index if not exists feedback_status_emails_uidx on public.feedback_status_emails (report_id, status);
create index if not exists feedback_status_emails_user_idx on public.feedback_status_emails (user_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_status_emails'::regclass and conname = 'feedback_status_emails_status_check') then
    alter table public.feedback_status_emails add constraint feedback_status_emails_status_check check (status in ('planned', 'done', 'not_doing'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.feedback_status_emails'::regclass and conname = 'feedback_status_emails_state_check') then
    alter table public.feedback_status_emails add constraint feedback_status_emails_state_check check (state in ('claimed', 'sent', 'failed', 'skipped'));
  end if;
end $$;
alter table public.feedback_status_emails enable row level security;  -- no policies: service role only
revoke all on public.feedback_status_emails from anon, authenticated;

-- ── Submit: the retry check and the daily limit are one step under the member's row lock ──
-- p: {user, kind, body, context, client_key, limit}. Returns {outcome, id,
-- ref, used, limit}. outcome: 'created'; 'duplicate' when this client_key has
-- been sent already (the same report comes back and nothing is written); or
-- 'limit' when the member has sent p.limit reports this UK day. The limit is
-- billing_settings.feedback_daily_limit, parsed and clamped in
-- src/lib/feedback/rules.ts and passed in, so a badly saved setting can
-- never make every send fail. Locking the member's profiles row (as
-- create_search_profile does) means two sends at once cannot both slip under
-- the limit, and a double tap cannot make two reports.
create or replace function public.feedback_submit(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_key text := nullif(btrim(coalesce(p->>'client_key', '')), '');
  v_limit integer := greatest(1, coalesce((p->>'limit')::integer, 10));
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Europe/London') at time zone 'Europe/London';
  v_used integer;
  v_id uuid;
  v_ref bigint;
begin
  if v_user is null or v_key is null then raise exception 'feedback_submit_bad_input'; end if;
  perform 1 from public.profiles where id = v_user for no key update;
  select r.id, r.ref into v_id, v_ref from public.feedback_reports r where r.user_id = v_user and r.client_key = v_key;
  if v_id is not null then
    return jsonb_build_object('outcome', 'duplicate', 'id', v_id, 'ref', v_ref);
  end if;
  select count(*) into v_used from public.feedback_reports r where r.user_id = v_user and r.created_at >= v_day_start;
  if v_used >= v_limit then
    return jsonb_build_object('outcome', 'limit', 'used', v_used, 'limit', v_limit);
  end if;
  insert into public.feedback_reports (user_id, kind, body, context, client_key)
  values (v_user, p->>'kind', p->>'body', coalesce(p->'context', '{}'::jsonb), v_key)
  returning id, ref into v_id, v_ref;
  return jsonb_build_object('outcome', 'created', 'id', v_id, 'ref', v_ref, 'used', v_used + 1, 'limit', v_limit);
end;
$$;
revoke all on function public.feedback_submit(jsonb) from public, anon, authenticated;
grant execute on function public.feedback_submit(jsonb) to service_role;

-- ── Claim a status email: whoever makes (or retakes) the row sends it ──
-- p: {report, user, status, message, stale_seconds}. Returns true when the
-- caller should send: a new row, a failed one, or one left 'claimed' longer
-- than stale_seconds (the send died). A sent or skipped row is never taken
-- again, so a double press, a retry or two admins at once send one email.
create or replace function public.feedback_status_claim(p jsonb)
returns boolean language plpgsql set search_path = '' as $$
declare
  v_report uuid := (p->>'report')::uuid;
  v_status text := p->>'status';
  v_stale integer := greatest(60, coalesce((p->>'stale_seconds')::integer, 600));
  v_id uuid;
begin
  insert into public.feedback_status_emails (report_id, user_id, status, message)
  values (v_report, (p->>'user')::uuid, v_status, nullif(p->>'message', ''))
  on conflict (report_id, status) do nothing
  returning id into v_id;
  if v_id is not null then return true; end if;
  update public.feedback_status_emails e
     set state = 'claimed', claimed_at = now(), message = nullif(p->>'message', ''), error = null
   where e.report_id = v_report
     and e.status = v_status
     and (e.state = 'failed' or (e.state = 'claimed' and e.claimed_at < now() - make_interval(secs => v_stale)))
  returning e.id into v_id;
  return v_id is not null;
end;
$$;
revoke all on function public.feedback_status_claim(jsonb) from public, anon, authenticated;
grant execute on function public.feedback_status_claim(jsonb) to service_role;

-- ── announcements: what's new, shown to members as one banner (src/lib/feedback/announcements.ts) ──
--   kind            feature ("New feature") | fix ("Bug fix")
--   link_path       an optional page on this site for "Take a look": a path,
--                   never another site (src/lib/feedback/rules.ts memberPath;
--                   the check below is the same rule's floor)
--   report_ids      the reports it answers, for admin
--   published_at    when it went live. A member sees it only if they joined
--                   before this, and only for
--                   billing_settings.announcement_max_age_days
--   unpublished_at  taken down: nobody sees it from then on (published again,
--                   this is cleared and published_at restarts)
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  body text not null,
  link_path text,
  report_ids uuid[] not null default '{}',
  published_at timestamptz,
  unpublished_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_live_idx on public.announcements (published_at desc) where published_at is not null and unpublished_at is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.announcements'::regclass and conname = 'announcements_kind_check') then
    alter table public.announcements add constraint announcements_kind_check check (kind in ('feature', 'fix'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.announcements'::regclass and conname = 'announcements_title_check') then
    alter table public.announcements add constraint announcements_title_check check (char_length(title) between 1 and 80);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.announcements'::regclass and conname = 'announcements_body_check') then
    alter table public.announcements add constraint announcements_body_check check (char_length(body) between 1 and 300);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.announcements'::regclass and conname = 'announcements_link_check') then
    alter table public.announcements add constraint announcements_link_check check (
      link_path is null
      or (char_length(link_path) <= 300 and link_path ~ '^/[!-~]*$' and link_path !~ '^//' and strpos(link_path, E'\\') = 0)
    );
  end if;
end $$;
alter table public.announcements enable row level security;  -- no policies: service role only
revoke all on public.announcements from anon, authenticated;

-- ── announcement_views: what each member was shown and did (src/lib/feedback/announcements-server.ts) ──
-- shown_at when the banner first had it on their screen (never from a
-- prefetch: only the browser reports it). dismissed_at or clicked_at ("Take
-- a look") and it is never shown to them again. The admin page's views,
-- dismissals and click-through come from here.
create table if not exists public.announcement_views (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  shown_at timestamptz,
  dismissed_at timestamptz,
  clicked_at timestamptz,
  primary key (announcement_id, user_id)
);
-- A Dismiss also covers the ones folded under "N more", which were never
-- seen, so a row can exist without shown_at. (A table made by an earlier
-- draft of this section had it not null with a default.)
alter table public.announcement_views alter column shown_at drop not null;
alter table public.announcement_views alter column shown_at drop default;
create index if not exists announcement_views_user_idx on public.announcement_views (user_id);
alter table public.announcement_views enable row level security;  -- no policies: service role only
revoke all on public.announcement_views from anon, authenticated;

-- The admin list's figures, per announcement: members shown it, dismissed
-- it and tapped "Take a look" (click-through is clicked / shown). Counted in
-- the database rather than by reading every view. p is unused, kept for
-- the one-jsonb rule.
create or replace function public.announcement_stats(p jsonb)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.announcement_id, 'shown', v.shown, 'dismissed', v.dismissed, 'clicked', v.clicked)), '[]'::jsonb)
  from (
    select announcement_id, count(shown_at) as shown, count(dismissed_at) as dismissed, count(clicked_at) as clicked
    from public.announcement_views
    group by announcement_id
  ) v;
$$;
revoke all on function public.announcement_stats(jsonb) from public, anon, authenticated;
grant execute on function public.announcement_stats(jsonb) to service_role;

-- ── Settings (src/lib/feedback/config.ts; edited on /admin/feedback and /admin/announcements) ──
--   feedback_daily_limit               reports one member may send in a UK day
--   feedback_max_screenshots           screenshots on one report (0 turns them off)
--   feedback_screenshot_max_mb         the biggest image a member may pick, before
--                                      the browser shrinks it
--   feedback_screenshot_retention_days days a screenshot is kept (never below 7)
--   feedback_admin_email               where every new report is emailed
--   announcement_max_age_days          announcements older than this are not shown
insert into public.billing_settings (key, value) values
  ('feedback_daily_limit', '10'::jsonb),
  ('feedback_max_screenshots', '3'::jsonb),
  ('feedback_screenshot_max_mb', '5'::jsonb),
  ('feedback_screenshot_retention_days', '90'::jsonb),
  ('feedback_admin_email', '"zac@stayful.co.uk"'::jsonb),
  ('announcement_max_age_days', '30'::jsonb)
on conflict (key) do nothing;

-- ── The private bucket for screenshots (src/lib/feedback/storage.ts) ──
-- Private, and there is no storage.objects policy for it, so only the service
-- role can read or write it; an admin sees an image through a signed link
-- that expires after five minutes. file_size_limit is a ceiling only (the
-- most feedback_screenshot_max_mb can be set to); the app checks the real
-- limit first. Created here rather than by hand so it can never start out
-- public, and "on conflict" puts it back to private if it was ever switched.
-- If this storage schema is too old for these columns, it raises a notice
-- instead of stopping the run: create the bucket by hand then (README,
-- "Switch on feedback").
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('feedback-screenshots', 'feedback-screenshots', false, 20971520, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;
exception when others then
  raise notice 'The feedback-screenshots bucket was not created (%): create it by hand, private.', sqlerrm;
end $$;

notify pgrst, 'reload schema';

-- =========================
-- Batch 19: consent and attribution
-- =========================
-- Cookie consent, the Meta pixel and Conversions API, and where members came
-- from (src/lib/tracking, src/lib/meta). Every table here is service role only
-- (RLS on, no policies, nothing granted to anon or authenticated): the app's
-- routes take the member from the session. Nothing is charged. Nothing here is
-- in ACCESS_COLUMNS (src/lib/access.ts), and must not become so, and nothing
-- is added to profiles. Everything is additive: this section can be run
-- before the code is merged, and until it is run the banner still works (the
-- choice is kept on the device), nothing is recorded or sent to Meta, and
-- /admin/signups says to run it.

-- ── consent_records: proof of every cookie choice (src/lib/tracking/consent-server.ts) ──
--   visitor_id  the random device id kept in the sf_consent cookie
--   user_id     the member: signed in when they chose, or attached when they
--               signed up or in on that device. Set to null if the account is
--               deleted, so the proof stays (it then holds no personal data)
--   choice      accept | reject
--   source      banner | signup | settings (the Cookie settings link)
--   version     the wording shown (cookie-v1, …). New wording means a new
--               version, so every choice stays tied to what the person saw
create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  visitor_id uuid not null,
  user_id uuid references public.profiles(id) on delete set null,
  choice text not null,
  source text not null,
  version text not null
);
create index if not exists consent_records_visitor_idx on public.consent_records (visitor_id, created_at desc);
create index if not exists consent_records_user_idx on public.consent_records (user_id, created_at desc) where user_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.consent_records'::regclass and conname = 'consent_records_choice_check') then
    alter table public.consent_records add constraint consent_records_choice_check check (choice in ('accept', 'reject'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.consent_records'::regclass and conname = 'consent_records_source_check') then
    alter table public.consent_records add constraint consent_records_source_check check (source in ('banner', 'signup', 'settings'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.consent_records'::regclass and conname = 'consent_records_version_check') then
    alter table public.consent_records add constraint consent_records_version_check check (char_length(version) between 1 and 40);
  end if;
end $$;
alter table public.consent_records enable row level security;  -- no policies: service role only
revoke all on public.consent_records from anon, authenticated;

-- ── member_consent: each member's latest choice, which the server obeys ──
--   choice/chosen_at  the newest choice wins, whichever device it came from
--                     (member_consent_set below)
--   record_id         the consent_records row it came from
--   ctx_*             the member's last-seen browser details (IP, user agent,
--                     _fbp, _fbc), kept only while the choice is Accept and
--                     cleared the moment it is Reject. Used only for a
--                     Conversions API event that happens with no browser in
--                     the request (a Stripe payment); refreshed at most hourly
create table if not exists public.member_consent (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  choice text not null,
  chosen_at timestamptz not null,
  source text not null,
  version text not null,
  record_id uuid references public.consent_records(id) on delete set null,
  ctx_ip text,
  ctx_ua text,
  ctx_fbp text,
  ctx_fbc text,
  ctx_at timestamptz,
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_consent'::regclass and conname = 'member_consent_choice_check') then
    alter table public.member_consent add constraint member_consent_choice_check check (choice in ('accept', 'reject'));
  end if;
end $$;
alter table public.member_consent enable row level security;  -- no policies: service role only
revoke all on public.member_consent from anon, authenticated;

-- ── member_consent_set: the newest choice wins, in one statement ──
-- p: {user, choice, chosen_at, source, version, record_id}. Returns the row
-- the member now has: {choice, chosen_at, applied}. applied is false when a
-- newer choice was already saved (another device), which then stands. A
-- Reject clears the stored browser details in the same write.
create or replace function public.member_consent_set(p jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_choice text := p->>'choice';
  -- Never later than now: a device with a fast clock must not freeze the choice.
  v_at timestamptz := least(coalesce(nullif(p->>'chosen_at', '')::timestamptz, now()), now());
  v_applied boolean := false;
  v_row public.member_consent%rowtype;
begin
  if v_user is null or v_choice not in ('accept', 'reject') then
    return jsonb_build_object('applied', false, 'choice', null, 'chosen_at', null);
  end if;
  insert into public.member_consent as mc (user_id, choice, chosen_at, source, version, record_id, updated_at)
  values (v_user, v_choice, v_at, coalesce(p->>'source', 'banner'), coalesce(p->>'version', 'cookie-v1'), nullif(p->>'record_id', '')::uuid, now())
  on conflict (user_id) do update set
    choice = excluded.choice,
    chosen_at = excluded.chosen_at,
    source = excluded.source,
    version = excluded.version,
    record_id = excluded.record_id,
    ctx_ip = case when excluded.choice = 'reject' then null else mc.ctx_ip end,
    ctx_ua = case when excluded.choice = 'reject' then null else mc.ctx_ua end,
    ctx_fbp = case when excluded.choice = 'reject' then null else mc.ctx_fbp end,
    ctx_fbc = case when excluded.choice = 'reject' then null else mc.ctx_fbc end,
    ctx_at = case when excluded.choice = 'reject' then null else mc.ctx_at end,
    updated_at = now()
  where mc.chosen_at <= excluded.chosen_at
  returning true into v_applied;
  select * into v_row from public.member_consent where user_id = v_user;
  return jsonb_build_object('applied', coalesce(v_applied, false), 'choice', v_row.choice, 'chosen_at', v_row.chosen_at);
end $$;
revoke all on function public.member_consent_set(jsonb) from public, anon, authenticated;
grant execute on function public.member_consent_set(jsonb) to service_role;

-- ── member_attribution: where a member came from, first touch, once ──
-- Written once when a website account is created (src/lib/tracking/signup-server.ts):
-- at the moment the email sign-up form is submitted (so confirming on another
-- device cannot lose it), or on the Google callback. Never overwritten
-- (insert … on conflict do nothing). Existing members have no row and are
-- "direct / unknown"; there is no backfill. Lead-form accounts have no row
-- either: the report reads profiles.lead_source for them.
--   env           production | preview | development: previews write to this
--                 database too, and only production rows are reported
--   signup_method email | google
--   team_invite   the sign-up was to join someone's team (left out of the report)
--   fbclid(_at)   the Meta click id and when it was seen, kept to build fbc
--                 for the member's Conversions API events
--   landing_path  the first page, without its query; ids and tokens replaced
--   captured_via  form | cookie | redirect (Google's return) | none
create table if not exists public.member_attribution (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  env text not null default 'production',
  signup_method text not null,
  team_invite boolean not null default false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  fbclid_at timestamptz,
  landing_path text,
  referrer_domain text,
  captured_via text not null default 'none'
);
create index if not exists member_attribution_created_idx on public.member_attribution (created_at);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_attribution'::regclass and conname = 'member_attribution_method_check') then
    alter table public.member_attribution add constraint member_attribution_method_check check (signup_method in ('email', 'google'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_attribution'::regclass and conname = 'member_attribution_via_check') then
    alter table public.member_attribution add constraint member_attribution_via_check check (captured_via in ('form', 'cookie', 'redirect', 'none'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_attribution'::regclass and conname = 'member_attribution_lengths_check') then
    alter table public.member_attribution add constraint member_attribution_lengths_check check (
      coalesce(char_length(utm_source), 0) <= 200 and coalesce(char_length(utm_medium), 0) <= 200
      and coalesce(char_length(utm_campaign), 0) <= 200 and coalesce(char_length(utm_content), 0) <= 200
      and coalesce(char_length(utm_term), 0) <= 200 and coalesce(char_length(fbclid), 0) <= 500
      and coalesce(char_length(landing_path), 0) <= 200 and coalesce(char_length(referrer_domain), 0) <= 200
    );
  end if;
end $$;
alter table public.member_attribution enable row level security;  -- no policies: service role only
revoke all on public.member_attribution from anon, authenticated;

-- ── meta_conversions: every conversion we know of, sent to Meta or not (src/lib/meta/conversions.ts) ──
-- One row per conversion, keyed on dedupe_key (the only unique key), inserted
-- before anything is sent: only the caller whose insert went in may send, so
-- a Stripe redelivery, the webhook and the one-click route, or a retry can
-- never send twice. The row is written even without consent, so "once per
-- account" holds if the member accepts later; it is sent only if they accept
-- within the release window (src/lib/tracking/config.ts).
--   dedupe_key          CompleteRegistration:<user>, ProfileComplete:<user>,
--                       FirstReport:<user>, Subscribe:<user>, Purchase:<payment intent>
--   event_id            what Meta de-duplicates the browser and server copies on
--                       (a random id, the Stripe invoice or the PaymentIntent)
--   env                 production | preview | development: only production
--                       rows are ever sent or fired
--   consented           the member's choice was Accept when it was recorded or released
--   server_status       held (no consent yet) | pending | sending | sent |
--                       failed | skipped; server_note says why (never the token)
--   test_event          sent with META_TEST_EVENT_CODE (Test events only)
--   browser_claimed_at  the browser fired it (claimed once, atomically)
create table if not exists public.meta_conversions (
  dedupe_key text primary key,
  event_id text not null,
  event_name text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  env text not null default 'production',
  value_pence integer,
  currency text,
  consented boolean not null default false,
  released_at timestamptz,
  server_status text not null default 'pending',
  server_note text,
  server_http integer,
  server_sent_at timestamptz,
  test_event boolean not null default false,
  browser_claimed_at timestamptz
);
create index if not exists meta_conversions_user_idx on public.meta_conversions (user_id, created_at desc);
create index if not exists meta_conversions_created_idx on public.meta_conversions (created_at desc);
create index if not exists meta_conversions_event_idx on public.meta_conversions (event_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.meta_conversions'::regclass and conname = 'meta_conversions_event_check') then
    alter table public.meta_conversions add constraint meta_conversions_event_check check (event_name in ('CompleteRegistration', 'ProfileComplete', 'FirstReport', 'Subscribe', 'Purchase'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meta_conversions'::regclass and conname = 'meta_conversions_status_check') then
    alter table public.meta_conversions add constraint meta_conversions_status_check check (server_status in ('held', 'pending', 'sending', 'sent', 'failed', 'skipped'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.meta_conversions'::regclass and conname = 'meta_conversions_note_check') then
    alter table public.meta_conversions add constraint meta_conversions_note_check check (server_note is null or char_length(server_note) <= 300);
  end if;
end $$;
alter table public.meta_conversions enable row level security;  -- no policies: service role only
revoke all on public.meta_conversions from anon, authenticated;

-- ── When tracking started ──
-- Set once, the first time this section runs, and never changed: the sign-up
-- journey events (CompleteRegistration, ProfileComplete, FirstReport) count
-- only for accounts created after it, and Subscribe only for subscriptions
-- started after it, so existing members' renewals and old quizzes never fire.
-- A fact rather than a setting: not on /admin/billing.
insert into public.billing_settings (key, value) values ('meta_tracking_since', to_jsonb(now()))
on conflict (key) do nothing;

-- ── signup_source_facts: what /admin/signups adds up (src/lib/tracking/report-server.ts) ──
-- p: {from, to} (timestamps; either may be null). One entry per account
-- created in the range that has a member_attribution row (a website sign-up)
-- or came from a lead form (profiles.lead_source): its attribution, whether it
-- has signed in, when it finished the profile, its first report (report_run
-- or full_analysis) and its first real payment (a card top-up or a paid
-- subscription invoice, annual included, less refunds and disputes). Weekly
-- active is not here: the page reuses Batch 9's activity_weekly_facts.
-- security definer: it reads auth.users.last_sign_in_at.
create or replace function public.signup_source_facts(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := coalesce(nullif(p->>'from', '')::timestamptz, '-infinity'::timestamptz);
  v_to timestamptz := coalesce(nullif(p->>'to', '')::timestamptz, 'infinity'::timestamptz);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'u', pr.id,
      'email', pr.email,
      'created', pr.created_at,
      'signed_in', au.last_sign_in_at is not null,
      'lead', case when pr.lead_source is not null then coalesce(pr.lead_source->>'source', 'lead_form') end,
      'a', case when ma.user_id is null then null else jsonb_build_object(
        'src', ma.utm_source, 'med', ma.utm_medium, 'cmp', ma.utm_campaign, 'cnt', ma.utm_content,
        'fb', ma.fbclid is not null, 'ref', ma.referrer_domain, 'env', ma.env,
        'method', ma.signup_method, 'team', ma.team_invite) end,
      'profile_done', pq.completed_at,
      'first_report', fr.at,
      'first_paid', fp.at
    ) order by pr.created_at)
    from public.profiles pr
    left join auth.users au on au.id = pr.id
    left join public.member_attribution ma on ma.user_id = pr.id
    left join public.profile_quiz pq on pq.user_id = pr.id
    left join lateral (
      select min(e.occurred_at) as at from public.activity_events e
      where e.user_id = pr.id and e.kind in ('report_run', 'full_analysis')
    ) fr on true
    left join lateral (
      select min(g.created_at) as at from public.credit_grants g
      where g.user_id = pr.id
        and (g.kind = 'topup' or (g.kind = 'plan' and (g.source_ref like 'inv:%' or g.source_ref like 'annual:%')))
        and not exists (
          select 1 from public.credit_grants r
          where r.user_id = g.user_id and r.kind = 'adjustment'
            and r.source_ref in (g.source_ref || ':refunded', g.source_ref || ':disputed')
        )
    ) fp on true
    where pr.created_at >= v_from and pr.created_at < v_to
      and (ma.user_id is not null or pr.lead_source is not null)
  ), '[]'::jsonb);
end $$;
revoke all on function public.signup_source_facts(jsonb) from public, anon, authenticated;
grant execute on function public.signup_source_facts(jsonb) to service_role;

notify pgrst, 'reload schema';

-- =========================
-- Batch 20: starter pack, inactivity and Monday sync
-- =========================
-- The £10 starter pack (src/lib/starter-pack), the payments behind "Total
-- paid" (src/lib/payments), the inactivity rules (src/lib/inactivity) and the
-- Monday sales-funnel sync (src/lib/crm/monday-funnel). Every new table is
-- service role only. Nothing is added to ACCESS_COLUMNS: the code reads each
-- new column in a query of its own, so until this section is run the pack is
-- never offered, nobody is paused and nothing is written to Monday.

-- ── profiles: Batch 20 columns ──
alter table public.profiles add column if not exists starter_pack_bought_at timestamptz;          -- the pack was granted
alter table public.profiles add column if not exists starter_pack_snoozed_until timestamptz;      -- "Not now" on the Today card
alter table public.profiles add column if not exists reengage_since timestamptz;                  -- inactive_reengage_days without a qualifying action
alter table public.profiles add column if not exists picks_paused_inactive_at timestamptz;        -- picks_pause_inactive_days: daily picks paused
alter table public.profiles add column if not exists picks_paused_inactive_email_at timestamptz;  -- the "while you're away" letter for this pause

-- ── Settings (inserted only when missing, so an edit on /admin/lifecycle survives a re-run) ──
-- starter_pack_from and inactivity_from start empty: the pack and the
-- inactivity rules are off until a date is set (src/lib/lifecycle/settings.ts).
insert into public.billing_settings (key, value) values
  ('starter_pack_from', 'null'),
  ('starter_pack_price_pence', '1000'),
  ('starter_pack_credit_pence', '3000'),
  ('starter_pack_snooze_days', '7'),
  ('low_credit_pence', '500'),
  ('inactive_reengage_days', '14'),
  ('picks_pause_inactive_days', '25'),
  ('inactivity_from', 'null')
on conflict (key) do nothing;

-- ── starter_pack_purchases: one starter pack per person, ever ──
-- One row per PaymentIntent that tried to buy a pack. A pack is claimed
-- (reserved) after the card is authorised and before it is captured, so a
-- repeat is cancelled without ever being charged; captured, it is granted.
-- Only reserved and granted rows hold the identity (the partial unique
-- indexes), so a blocked or failed attempt never stops a later one. The rows
-- are kept when an account is deleted: "once per person, ever".
--   status       reserved | granted | blocked | failed
--   blocked_by   account | email | mobile | card | race (why it was refused)
--   email_key    profiles.email, trimmed and lower-cased (emailKey)
--   mobile_key   normaliseMobile(profiles.mobile), whether or not the account holds profiles.mobile_key
create table if not exists public.starter_pack_purchases (
  payment_intent_id text primary key,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'reserved',
  blocked_by text,
  email_key text,
  mobile_key text,
  card_fingerprint text,
  price_pence integer not null,
  credit_pence integer not null,
  amount_paid_pence integer,
  currency text,
  consent_at timestamptz,
  consent_version text,
  refunded_pence integer not null default 0,
  created_at timestamptz not null default now(),
  granted_at timestamptz
);
create unique index if not exists starter_pack_user_uidx on public.starter_pack_purchases (user_id) where status in ('reserved', 'granted') and user_id is not null;
create unique index if not exists starter_pack_email_uidx on public.starter_pack_purchases (email_key) where status in ('reserved', 'granted') and email_key is not null;
create unique index if not exists starter_pack_mobile_uidx on public.starter_pack_purchases (mobile_key) where status in ('reserved', 'granted') and mobile_key is not null;
create unique index if not exists starter_pack_card_uidx on public.starter_pack_purchases (card_fingerprint) where status in ('reserved', 'granted') and card_fingerprint is not null;
create index if not exists starter_pack_purchases_user_idx on public.starter_pack_purchases (user_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.starter_pack_purchases'::regclass and conname = 'starter_pack_status_check') then
    alter table public.starter_pack_purchases add constraint starter_pack_status_check check (status in ('reserved', 'granted', 'blocked', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.starter_pack_purchases'::regclass and conname = 'starter_pack_blocked_by_check') then
    alter table public.starter_pack_purchases add constraint starter_pack_blocked_by_check check (blocked_by is null or blocked_by in ('account', 'email', 'mobile', 'card', 'race'));
  end if;
end $$;
alter table public.starter_pack_purchases enable row level security;  -- no policies: service role only
revoke all on public.starter_pack_purchases from anon, authenticated;

-- starter_pack_claim(p): the once-per-person decision, atomically.
-- p: {pi, user, email_key, mobile_key, card, price, credit, currency,
--     consent_at, consent_version}. Serialised on the member's profile row;
-- the partial unique indexes settle two accounts racing with the same email,
-- number or card. A reservation that was never captured stops blocking after
-- 8 days (Stripe drops an uncaptured hold after 7).
-- Returns {status, replay, blocked_by}: replay is true when this PaymentIntent
-- was already claimed (a redelivery), with the status it has.
create or replace function public.starter_pack_claim(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pi text := nullif(p->>'pi', '');
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_email text := nullif(p->>'email_key', '');
  v_mobile text := nullif(p->>'mobile_key', '');
  v_card text := nullif(p->>'card', '');
  v_row public.starter_pack_purchases%rowtype;
  v_by text;
begin
  if v_pi is null or v_user is null then raise exception 'starter_pack_claim needs pi and user'; end if;
  perform 1 from public.profiles where id = v_user for update;
  select * into v_row from public.starter_pack_purchases where payment_intent_id = v_pi;
  if found then
    return jsonb_build_object('status', v_row.status, 'replay', true, 'blocked_by', v_row.blocked_by);
  end if;
  update public.starter_pack_purchases set status = 'failed'
   where status = 'reserved' and created_at < now() - interval '8 days';
  v_by := case
    when exists (select 1 from public.starter_pack_purchases s where s.user_id = v_user and s.status in ('reserved', 'granted')) then 'account'
    when v_email is not null and exists (select 1 from public.starter_pack_purchases s where s.email_key = v_email and s.status in ('reserved', 'granted')) then 'email'
    when v_mobile is not null and exists (select 1 from public.starter_pack_purchases s where s.mobile_key = v_mobile and s.status in ('reserved', 'granted')) then 'mobile'
    when v_card is not null and exists (select 1 from public.starter_pack_purchases s where s.card_fingerprint = v_card and s.status in ('reserved', 'granted')) then 'card'
  end;
  if v_by is null then
    begin
      insert into public.starter_pack_purchases (payment_intent_id, user_id, status, email_key, mobile_key, card_fingerprint, price_pence, credit_pence, currency, consent_at, consent_version)
      values (v_pi, v_user, 'reserved', v_email, v_mobile, v_card, (p->>'price')::integer, (p->>'credit')::integer, nullif(p->>'currency', ''), nullif(p->>'consent_at', '')::timestamptz, nullif(p->>'consent_version', ''));
      return jsonb_build_object('status', 'reserved', 'replay', false, 'blocked_by', null);
    exception when unique_violation then
      v_by := 'race';
    end;
  end if;
  insert into public.starter_pack_purchases (payment_intent_id, user_id, status, blocked_by, email_key, mobile_key, card_fingerprint, price_pence, credit_pence, currency, consent_at, consent_version)
  values (v_pi, v_user, 'blocked', v_by, v_email, v_mobile, v_card, (p->>'price')::integer, (p->>'credit')::integer, nullif(p->>'currency', ''), nullif(p->>'consent_at', '')::timestamptz, nullif(p->>'consent_version', ''));
  return jsonb_build_object('status', 'blocked', 'replay', false, 'blocked_by', v_by);
end $$;
revoke all on function public.starter_pack_claim(jsonb) from public, anon, authenticated;
grant execute on function public.starter_pack_claim(jsonb) to service_role;

-- starter_pack_clawback(p): {user, base, target, refunded, description}. A
-- pack's refund or dispute, cumulatively: takes back what is still owed, the
-- target less the adjustments already made under `base` (the first is `base`
-- itself, a later one `base:<refunded>`). Read and written under the
-- member's profile row lock, so two refunds handled at once see each other.
-- Returns the pence this call took back.
create or replace function public.starter_pack_clawback(p jsonb)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := nullif(p->>'user', '')::uuid;
  v_base text := nullif(p->>'base', '');
  v_target numeric := greatest(0, coalesce((p->>'target')::numeric, 0));
  v_taken numeric;
  v_diff numeric;
begin
  if v_user is null or v_base is null then raise exception 'starter_pack_clawback needs user and base'; end if;
  perform 1 from public.profiles where id = v_user for update;
  select coalesce(sum(greatest(0, -g.amount_pence)), 0) into v_taken
    from public.credit_grants g
   where g.user_id = v_user and g.kind = 'adjustment'
     and (g.source_ref = v_base or left(g.source_ref, length(v_base) + 1) = v_base || ':');
  v_diff := round(v_target - v_taken);
  if v_diff <= 0 then return 0; end if;
  perform public.credit_grant(v_user, 'adjustment', -v_diff, null,
    case when v_taken > 0 then v_base || ':' || coalesce(nullif(p->>'refunded', ''), '0') else v_base end,
    nullif(p->>'description', ''));
  return v_diff;
end $$;
revoke all on function public.starter_pack_clawback(jsonb) from public, anon, authenticated;
grant execute on function public.starter_pack_clawback(jsonb) to service_role;

-- ── member_payments / member_refunds: what "Total paid" adds up (src/lib/payments) ──
-- Every successful payment, keyed by its Stripe id, amount as charged (VAT
-- included): 'pi:<payment intent>' for a starter pack or a top-up,
-- 'inv:<invoice>' for a subscription invoice. Refunds are kept per charge as
-- the charge's cumulative amount_refunded, set and never added, so a
-- redelivered or out-of-order event cannot count twice. Total paid =
-- payments - refunds of those payments (matched on the PaymentIntent; an
-- invoice's is looked up when it is paid), never below 0. Nothing from before
-- Batch 20 is here, so a refund of an older payment is not taken off.
create table if not exists public.member_payments (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  amount_pence integer not null,
  currency text not null default 'gbp',
  plan_code text,
  payment_intent_id text,
  paid_at timestamptz not null default now()
);
create index if not exists member_payments_user_idx on public.member_payments (user_id, paid_at);
create index if not exists member_payments_pi_idx on public.member_payments (payment_intent_id) where payment_intent_id is not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_payments'::regclass and conname = 'member_payments_kind_check') then
    alter table public.member_payments add constraint member_payments_kind_check check (kind in ('starter_pack', 'topup', 'auto_topup', 'subscription'));
  end if;
end $$;
alter table public.member_payments enable row level security;  -- no policies: service role only
revoke all on public.member_payments from anon, authenticated;

create table if not exists public.member_refunds (
  charge_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payment_intent_id text,
  amount_refunded_pence integer not null,
  updated_at timestamptz not null default now()
);
create index if not exists member_refunds_user_idx on public.member_refunds (user_id);
create index if not exists member_refunds_pi_idx on public.member_refunds (payment_intent_id) where payment_intent_id is not null;
alter table public.member_refunds enable row level security;  -- no policies: service role only
revoke all on public.member_refunds from anon, authenticated;

-- member_refund_set(p): {charge, user, pi, amount}. Keeps the largest
-- cumulative amount seen for the charge (an older event arriving late never
-- lowers it). Returns the amount now stored.
create or replace function public.member_refund_set(p jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_amount integer;
begin
  insert into public.member_refunds (charge_id, user_id, payment_intent_id, amount_refunded_pence)
  values (p->>'charge', (p->>'user')::uuid, nullif(p->>'pi', ''), greatest(0, (p->>'amount')::integer))
  on conflict (charge_id) do update
    set amount_refunded_pence = greatest(public.member_refunds.amount_refunded_pence, excluded.amount_refunded_pence),
        payment_intent_id = coalesce(public.member_refunds.payment_intent_id, excluded.payment_intent_id),
        updated_at = now()
  returning amount_refunded_pence into v_amount;
  return v_amount;
end $$;
revoke all on function public.member_refund_set(jsonb) from public, anon, authenticated;
grant execute on function public.member_refund_set(jsonb) to service_role;

-- ── member_active_days: one row per member per UK day with a qualifying action ──
-- Batch 9's definition, stored once: an activity_events row whose kind is in
-- QUALIFYING_KINDS (passed in by src/lib/inactivity, never written here), on
-- its UK date. Filled from activity_events past a watermark on its id, so
-- the nightly never rescans the log, a late backfilled row is still picked
-- up, and the totals outlive the log's 24-month retention.
create table if not exists public.member_active_days (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);
alter table public.member_active_days enable row level security;  -- no policies: service role only
revoke all on public.member_active_days from anon, authenticated;

create table if not exists public.member_active_days_state (
  id smallint primary key default 1,
  last_event_id bigint not null default 0,
  updated_at timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.member_active_days_state'::regclass and conname = 'member_active_days_state_one_row') then
    alter table public.member_active_days_state add constraint member_active_days_state_one_row check (id = 1);
  end if;
end $$;
insert into public.member_active_days_state (id) values (1) on conflict (id) do nothing;
alter table public.member_active_days_state enable row level security;  -- no policies: service role only
revoke all on public.member_active_days_state from anon, authenticated;

-- lifecycle_active_days_sync(p): {qualifying: [kinds], apply, limit}. Adds the
-- (member, UK day) pairs of up to `limit` activity_events rows past the
-- watermark and moves it on. apply = false counts what it would add and
-- changes nothing, and lists each member's latest such day among them
-- (`pending`), so a dry run's preview counts actions since the last nightly.
-- Returns {from, to, added, more, pending}.
create or replace function public.lifecycle_active_days_sync(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_qual text[] := coalesce(array(select jsonb_array_elements_text(p->'qualifying')), '{}'::text[]);
  v_apply boolean := coalesce((p->>'apply')::boolean, false);
  v_limit integer := least(greatest(coalesce((p->>'limit')::integer, 50000), 1), 200000);
  v_from bigint;
  v_to bigint;
  v_added integer := 0;
  v_pending jsonb;
begin
  if cardinality(v_qual) = 0 then raise exception 'lifecycle_active_days_sync needs the qualifying kinds'; end if;
  -- A dry run writes nothing, not even the watermark's row.
  if v_apply then
    insert into public.member_active_days_state (id) values (1) on conflict (id) do nothing;
    select last_event_id into v_from from public.member_active_days_state where id = 1 for update;
  else
    select last_event_id into v_from from public.member_active_days_state where id = 1;
  end if;
  v_from := coalesce(v_from, 0);
  select max(x.id) into v_to from (select e.id from public.activity_events e where e.id > v_from order by e.id limit v_limit) x;
  if v_to is null then
    return jsonb_build_object('from', v_from, 'to', v_from, 'added', 0, 'more', false);
  end if;
  if v_apply then
    insert into public.member_active_days (user_id, day)
    select distinct e.user_id, (e.occurred_at at time zone 'Europe/London')::date
      from public.activity_events e
     where e.id > v_from and e.id <= v_to and e.kind = any(v_qual)
    on conflict do nothing;
    get diagnostics v_added = row_count;
    update public.member_active_days_state set last_event_id = v_to, updated_at = now() where id = 1;
  else
    select count(*) into v_added from (
      select distinct e.user_id, (e.occurred_at at time zone 'Europe/London')::date as day
        from public.activity_events e
       where e.id > v_from and e.id <= v_to and e.kind = any(v_qual)
    ) n
    where not exists (select 1 from public.member_active_days d where d.user_id = n.user_id and d.day = n.day);
    select coalesce(jsonb_agg(jsonb_build_object('u', x.user_id, 'day', x.day)), '[]'::jsonb) into v_pending from (
      select e.user_id, max((e.occurred_at at time zone 'Europe/London')::date) as day
        from public.activity_events e
       where e.id > v_from and e.id <= v_to and e.kind = any(v_qual)
       group by e.user_id
    ) x;
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'added', v_added,
    'more', exists (select 1 from public.activity_events e where e.id > v_to), 'pending', v_pending);
end $$;
revoke all on function public.lifecycle_active_days_sync(jsonb) from public, anon, authenticated;
grant execute on function public.lifecycle_active_days_sync(jsonb) to service_role;

-- lifecycle_member_stats(p): {users: [uuid]}. Per member: the last UK day
-- with a qualifying action, how many such days and how many UK weeks (Monday
-- to Sunday, as Batch 9 counts them) since sign-up; what they have paid
-- (payments and refunds as above, the first payment, paid top-ups that are
-- not fully refunded and the latest); and whether they bought the pack.
create or replace function public.lifecycle_member_stats(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  with u as (
    select distinct x::uuid as id from jsonb_array_elements_text(coalesce(p->'users', '[]'::jsonb)) x
  ), a as (
    select d.user_id, max(d.day) as last_day, count(*) as days, count(distinct date_trunc('week', d.day::timestamp)) as weeks
      from public.member_active_days d join u on u.id = d.user_id
     group by d.user_id
  ), pay as (
    select m.user_id, sum(m.amount_pence) as paid, min(m.paid_at) as first_paid
      from public.member_payments m join u on u.id = m.user_id
     group by m.user_id
  ), ref as (
    -- Only refunds of the payments counted above (matched on the PaymentIntent),
    -- each at most the payment: a refund of a payment from before Batch 20, or
    -- one never recorded, is not taken off what was never added.
    select m.user_id, sum(least(m.amount_pence, rr.refunded)) as refunded
      from public.member_payments m join u on u.id = m.user_id
      join lateral (
        select sum(r.amount_refunded_pence) as refunded from public.member_refunds r
         where r.payment_intent_id = m.payment_intent_id and r.user_id = m.user_id
      ) rr on rr.refunded is not null
     where m.payment_intent_id is not null
     group by m.user_id
  ), top as (
    select m.user_id, count(*) as topups, max(m.paid_at) as last_topup
      from public.member_payments m join u on u.id = m.user_id
     where m.kind in ('topup', 'auto_topup')
       and coalesce((select sum(r.amount_refunded_pence) from public.member_refunds r where r.payment_intent_id = m.payment_intent_id), 0) < m.amount_pence
     group by m.user_id
  ), pack as (
    select s.user_id, min(s.granted_at) as bought_at
      from public.starter_pack_purchases s join u on u.id = s.user_id
     where s.status = 'granted'
     group by s.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'u', u.id,
    'last_day', a.last_day,
    'days', coalesce(a.days, 0),
    'weeks', coalesce(a.weeks, 0),
    'paid', coalesce(pay.paid, 0),
    'refunded', coalesce(ref.refunded, 0),
    'first_paid', pay.first_paid,
    'topups', coalesce(top.topups, 0),
    'last_topup', top.last_topup,
    'pack_at', pack.bought_at
  )), '[]'::jsonb)
  from u
  left join a on a.user_id = u.id
  left join pay on pay.user_id = u.id
  left join ref on ref.user_id = u.id
  left join top on top.user_id = u.id
  left join pack on pack.user_id = u.id;
$$;
revoke all on function public.lifecycle_member_stats(jsonb) from public, anon, authenticated;
grant execute on function public.lifecycle_member_stats(jsonb) to service_role;

-- lifecycle_balances(p): {users: [uuid]}. Each member's displayed balance
-- (every unexpired bucket) through the ledger's own credit_available, so the
-- nightly reads a whole page of members in one call and never has a second
-- balance formula.
create or replace function public.lifecycle_balances(p jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'u', u.id,
    'total', round(b.plan_pence + b.welcome_pence + b.topup_pence + b.adjustment_pence, 4),
    'spendable', round(b.spendable_base_pence, 4)
  )), '[]'::jsonb)
  from (select distinct x::uuid as id from jsonb_array_elements_text(coalesce(p->'users', '[]'::jsonb)) x) u
  cross join lateral public.credit_available(u.id) b;
$$;
revoke all on function public.lifecycle_balances(jsonb) from public, anon, authenticated;
grant execute on function public.lifecycle_balances(jsonb) to service_role;

-- ── Mobile numbers (Part D): the oldest account keeps a shared number ──
-- mobile_key_assign(p): {key, keep, apply}. Gives `key` to the account
-- `keep` and takes it from any other account holding it, in one transaction
-- (the unique index allows one holder). Nothing else on the profiles changes.
-- apply = false reports what it would do. Returns {taken_from: [uuid], set}.
create or replace function public.mobile_key_assign(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_key text := nullif(p->>'key', '');
  v_keep uuid := nullif(p->>'keep', '')::uuid;
  v_apply boolean := coalesce((p->>'apply')::boolean, false);
  v_taken uuid[];
  v_set boolean;
begin
  if v_key is null or v_keep is null then raise exception 'mobile_key_assign needs key and keep'; end if;
  select coalesce(array_agg(id), '{}') into v_taken from public.profiles where mobile_key = v_key and id <> v_keep;
  select not exists (select 1 from public.profiles where id = v_keep and mobile_key is not distinct from v_key) into v_set;
  if v_apply then
    update public.profiles set mobile_key = null where mobile_key = v_key and id <> v_keep;
    update public.profiles set mobile_key = v_key where id = v_keep and mobile_key is distinct from v_key;
  end if;
  return jsonb_build_object('taken_from', to_jsonb(v_taken), 'set', v_set);
end $$;
revoke all on function public.mobile_key_assign(jsonb) from public, anon, authenticated;
grant execute on function public.mobile_key_assign(jsonb) to service_role;

-- ── monday_funnel_queue: members whose Monday row needs updating ──
-- An event (a payment, a plan change, low credit, coming back...) never talks
-- to Monday itself: it queues the member here, and /api/internal/monday-funnel
-- drains the queue every 10 minutes. One row per member, so a burst of events
-- is one update.
create table if not exists public.monday_funnel_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reasons text[] not null default '{}',
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text,
  last_attempt_at timestamptz
);
create index if not exists monday_funnel_queue_at_idx on public.monday_funnel_queue (queued_at);
alter table public.monday_funnel_queue enable row level security;  -- no policies: service role only
revoke all on public.monday_funnel_queue from anon, authenticated;

-- monday_funnel_enqueue(p): {user, reason}. Adds the member, or the reason
-- to their queued row (at most 10 kept); a re-queue resets the attempt count
-- and moves queued_at on, so a drain that read the row before it deletes
-- only the row it read (the newer event waits for the next drain).
create or replace function public.monday_funnel_enqueue(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := left(coalesce(nullif(p->>'reason', ''), 'event'), 40);
begin
  insert into public.monday_funnel_queue (user_id, reasons) values ((p->>'user')::uuid, array[v_reason])
  on conflict (user_id) do update
    set reasons = (select array(select distinct r from unnest(public.monday_funnel_queue.reasons || array[v_reason]) r limit 10)),
        queued_at = now(),
        attempts = 0;
end $$;
revoke all on function public.monday_funnel_enqueue(jsonb) from public, anon, authenticated;
grant execute on function public.monday_funnel_enqueue(jsonb) to service_role;

-- ── monday_funnel_runs / monday_funnel_lock: the nightly's progress and the one-writer lease ──
-- One row per UK day of the nightly pass: when it started and finished, the
-- inactivity step, how far it got (a pass resumes where the last one stopped)
-- and what it did. The lease makes sure only one run (the cron, or a
-- backfill from /admin/lifecycle) writes to Monday at a time.
create table if not exists public.monday_funnel_runs (
  day date primary key,
  started_at timestamptz,
  finished_at timestamptz,
  inactivity_at timestamptz,
  cursor text,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.monday_funnel_runs enable row level security;  -- no policies: service role only
revoke all on public.monday_funnel_runs from anon, authenticated;

create table if not exists public.monday_funnel_lock (
  id smallint primary key default 1,
  holder text,
  lease_until timestamptz
);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.monday_funnel_lock'::regclass and conname = 'monday_funnel_lock_one_row') then
    alter table public.monday_funnel_lock add constraint monday_funnel_lock_one_row check (id = 1);
  end if;
end $$;
insert into public.monday_funnel_lock (id) values (1) on conflict (id) do nothing;
alter table public.monday_funnel_lock enable row level security;  -- no policies: service role only
revoke all on public.monday_funnel_lock from anon, authenticated;

-- monday_funnel_lease(p): {holder, seconds, release}. Takes the lease when it
-- is free, expired or already this holder's; release gives it back. Returns
-- whether the caller holds it now.
create or replace function public.monday_funnel_lease(p jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_holder text := nullif(p->>'holder', '');
  v_ok boolean;
begin
  if v_holder is null then raise exception 'monday_funnel_lease needs a holder'; end if;
  insert into public.monday_funnel_lock (id) values (1) on conflict (id) do nothing;
  if coalesce((p->>'release')::boolean, false) then
    update public.monday_funnel_lock set holder = null, lease_until = null where id = 1 and holder = v_holder;
    return false;
  end if;
  update public.monday_funnel_lock
     set holder = v_holder,
         lease_until = now() + make_interval(secs => least(greatest(coalesce((p->>'seconds')::integer, 60), 10), 900))
   where id = 1 and (holder is null or lease_until is null or lease_until < now() or holder = v_holder)
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.monday_funnel_lease(jsonb) from public, anon, authenticated;
grant execute on function public.monday_funnel_lease(jsonb) to service_role;

notify pgrst, 'reload schema';
