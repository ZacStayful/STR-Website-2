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
  plan text not null default 'free',                  -- 'free' | 'pro'
  trial_ends_at timestamptz not null default (now() + interval '14 days'),
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
  ('starter',    'Starter',      1900,  'month', 1900,  '{"sourcingCadence":"weekly","priorityRefresh":false,"phoneSupport":false,"quarterlyBriefing":false}', 1),
  ('pro',        'Pro',          3999,  'month', 5000,  '{"sourcingCadence":"weekly","priorityRefresh":true,"phoneSupport":false,"quarterlyBriefing":false}', 2),
  ('scale',      'Scale',        9900,  'month', 14000, '{"sourcingCadence":"daily","priorityRefresh":true,"phoneSupport":true,"quarterlyBriefing":true}', 3),
  ('pro_annual', 'Pro (annual)', 36000, 'year',  5000,  '{"sourcingCadence":"weekly","priorityRefresh":true,"phoneSupport":false,"quarterlyBriefing":true}', 4)
on conflict (code) do update set
  name = excluded.name, price_pence = excluded.price_pence, interval = excluded.interval,
  monthly_credit_pence = excluded.monthly_credit_pence, perks = excluded.perks, sort = excluded.sort;
alter table public.billing_plans enable row level security;
drop policy if exists "Signed-in users can read plans" on public.billing_plans;
create policy "Signed-in users can read plans" on public.billing_plans for select to authenticated using (true);

-- ── Unit costs: one row per (provider, unit); seeded from src/lib/credit/costs.ts, edited on /admin/billing ──
create table if not exists public.unit_costs (
  provider text not null,
  unit text not null,
  label text not null,
  unit_cost_pence numeric(12,4) not null default 0,   -- our real cost per unit
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
  unit_cost_pence numeric(12,4),
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
alter table public.profiles add column if not exists auto_topup_last_at timestamptz;
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
