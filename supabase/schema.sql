-- Stayful Intelligence — initial schema
-- Run this in the Supabase SQL editor for a fresh project.

-- =========================
-- profiles
-- =========================
-- Extends auth.users. One row per user, created on signup.
-- Trial model: 14-day full access from sign-up; after that, plan must be 'pro'
-- (driven by Stripe subscription) for hasAccess() to return true.

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
