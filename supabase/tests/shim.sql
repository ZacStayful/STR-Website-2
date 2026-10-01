-- A stand-in for what a Supabase project provides before supabase/schema.sql
-- runs: the roles, the auth and storage schemas and pgcrypto. CI loads it on a
-- plain Postgres 16 (.github/workflows/ci.yml, job "schema") and then runs
-- schema.sql twice and supabase/tests/credit-smoke.sql. Never run this on a
-- Supabase project: everything in it already exists there.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;
create role authenticator noinherit login;
create role supabase_admin superuser login;
create schema auth;
create schema storage;
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  email text,
  phone text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz, metadata jsonb, path_tokens text[]);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role, supabase_auth_admin;
grant all on all tables in schema storage to service_role;
grant select on auth.users to service_role, supabase_auth_admin;
