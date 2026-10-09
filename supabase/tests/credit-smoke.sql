-- Schema and ledger checks for Stayful Intelligence. Run AFTER schema.sql: by
-- hand in the Supabase SQL editor, or by CI (.github/workflows/ci.yml, job
-- "schema", which runs schema.sql twice on a fresh Postgres 16 behind
-- supabase/tests/shim.sql and then this file).
-- Everything runs inside one transaction and is rolled back at the end, so it
-- leaves no data behind. A failing check raises; success prints notices.
-- Expected balances are computed from the live top-up spend rate
-- (credit_spend_rate), so a change of rate on /admin/billing does not fail them.
begin;

do $$
declare
  u uuid := gen_random_uuid();   -- the ledger member
  a uuid := gen_random_uuid();   -- an action id
  v uuid := gen_random_uuid();   -- overdraft forgiveness
  w uuid := gen_random_uuid();   -- plan cycles
  o uuid := gen_random_uuid();   -- referral code owner (created 1 Sep 2026)
  x uuid := gen_random_uuid();   -- welcome credit withheld
  y uuid := gen_random_uuid();   -- a clean referral redeemer
  z uuid := gen_random_uuid();   -- starter pack claim
  g_plan uuid; g_top uuid; g_top2 uuid;
  r record;
  j jsonb;
  res uuid;
  tx bigint;
  ok boolean;
  rate numeric := credit_spend_rate('topup');
  base numeric;
  id1 bigint; id2 bigint; id3 bigint;
  yesterday date := ((now() - interval '1 day') at time zone 'Europe/London')::date;
  two_days_ago date := ((now() - interval '2 days') at time zone 'Europe/London')::date;
begin
  -- Throwaway auth users (the trigger creates each profile).
  insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
  select i, 'credit-smoke-' || i::text || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()
    from unnest(array[u, v, w, x, y, z]) as i;
  insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
  values (o, 'credit-smoke-' || o::text || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', timestamptz '2026-09-01 10:00:00+00', now());
  insert into profiles (id, email) select i, 'credit-smoke-' || i::text || '@example.test' from unnest(array[u, v, w, o, x, y, z]) as i on conflict (id) do nothing;

  -- ── Batch 21 (A17): the profile's created_at is the auth user's ──
  if (select created_at from profiles where id = o) <> timestamptz '2026-09-01 10:00:00+00' then
    raise exception 'profiles.created_at should follow auth.users.created_at (A17)';
  end if;

  -- ── Batch 21 (A10): one top-up rate, 1.3, seeded and as the SQL fallback ──
  if rate <> 1.3 then raise exception 'top-up spend rate should be 1.3 on a fresh install, got % (A10)', rate; end if;

  -- ── Grants: £5 plan (expires in a month), £10 top-up; idempotent on source_ref ──
  g_plan := credit_grant(u, 'plan', 500, now() + interval '30 days', 'inv:smoke_' || u::text, 'Smoke plan');
  g_top := credit_grant(u, 'topup', 1000, null, 'pi:smoke_' || u::text, 'Smoke top-up');
  g_top2 := credit_grant(u, 'topup', 1000, null, 'pi:smoke_' || u::text, 'Smoke top-up again');
  if g_top2 <> g_top then raise exception 'credit_grant should be idempotent on source_ref'; end if;

  select * into r from credit_available(u);
  if r.plan_pence <> 500 or r.topup_pence <> 1000 then raise exception 'buckets wrong: %', r; end if;
  if abs(r.spendable_base_pence - (500 + 1000 / rate)) > 0.01 then raise exception 'spendable wrong: %', r.spendable_base_pence; end if;
  raise notice 'grants ok: %', r;

  -- Reserve more than spendable → P0402.
  ok := false;
  begin
    perform credit_reserve(u, 'report', a, 2000);
  exception when sqlstate 'P0402' then ok := true;
  end;
  if not ok then raise exception 'oversized reservation should raise P0402'; end if;

  -- Reserve 910 max, debit 730 base (a full report): plan 500 first, then 230 base × rate from the top-up.
  res := credit_reserve(u, 'report', a, 910);
  tx := credit_debit(u, 730, res, true, jsonb_build_object('action_id', a, 'action', 'report', 'provider', 'airbtics', 'unit', 'report_all'));
  perform credit_release(res);
  select * into r from credit_available(u);
  if r.plan_pence <> 0 then raise exception 'plan should be drained, got %', r.plan_pence; end if;
  if abs(r.topup_pence - (1000 - 230 * rate)) > 0.01 then raise exception 'top-up should be %, got %', 1000 - 230 * rate, r.topup_pence; end if;
  if abs(r.spendable_base_pence - (1000 - 230 * rate) / rate) > 0.01 then raise exception 'spendable wrong after debit: %', r.spendable_base_pence; end if;
  if r.reserved_base_pence <> 0 then raise exception 'reservation not released'; end if;
  if abs((select amount_pence from credit_transactions where id = tx) + (500 + 230 * rate)) > 0.01 then raise exception 'debit amount should be % grant pence', -(500 + 230 * rate); end if;
  if (select count(*) from credit_allocations where transaction_id = tx) <> 2 then raise exception 'debit should span two grants'; end if;
  raise notice 'mixed-rate debit ok: %', r;

  -- Refund half (365 base) → 250 plan + half the top-up share back.
  perform credit_refund(tx, 365, 'smoke refund');
  select * into r from credit_available(u);
  if abs(r.plan_pence - 250) > 0.01 or abs(r.topup_pence - (1000 - 115 * rate)) > 0.01 then raise exception 'refund wrong: %', r; end if;
  raise notice 'refund ok: %', r;

  -- Expiry: expire plan grants; only the top-up counts.
  perform credit_expire_plan_grants(u, 'smoke');
  select * into r from credit_available(u);
  if r.plan_pence <> 0 then raise exception 'plan should be expired'; end if;
  if abs(r.spendable_base_pence - (1000 - 115 * rate) / rate) > 0.01 then raise exception 'spendable after expiry wrong: %', r.spendable_base_pence; end if;

  -- Debit 50 base beyond spendable without allow_negative → P0402.
  base := r.spendable_base_pence + 50;
  ok := false;
  begin
    perform credit_debit(u, base, null, false, '{}'::jsonb);
  exception when sqlstate 'P0402' then ok := true;
  end;
  if not ok then raise exception 'unaffordable debit should raise P0402'; end if;

  -- Overdraft: allow_negative pays the provider and dips 50 base negative; the next grant repays it.
  perform credit_debit(u, base, null, true, '{}'::jsonb);
  select * into r from credit_available(u);
  if r.topup_pence <> 0 then raise exception 'top-up should be drained, got %', r.topup_pence; end if;
  if abs(r.adjustment_pence + 50) > 0.01 then raise exception 'overdraft should be -50 base, got %', r.adjustment_pence; end if;
  perform credit_grant(u, 'welcome', 2000, null, 'welcome:smoke_' || u::text, 'Smoke welcome');
  select * into r from credit_available(u);
  if abs(r.adjustment_pence) > 0.01 then raise exception 'overdraft should be repaid, got %', r.adjustment_pence; end if;
  if abs(r.welcome_pence - 1950) > 0.01 then raise exception 'welcome should be 1950 after repaying, got %', r.welcome_pence; end if;
  raise notice 'overdraft + repayment ok: %', r;

  -- Promo code: once per user.
  insert into credit_codes (code, kind, amount_pence, created_by) values ('SMOKE10', 'promo', 1000, 'smoke');
  perform credit_redeem_code(u, 'smoke 10');
  ok := false;
  begin
    perform credit_redeem_code(u, 'SMOKE10');
  exception when sqlstate 'P0403' then ok := true;
  end;
  if not ok then raise exception 'second redemption should fail'; end if;
  select * into r from credit_available(u);
  if abs(r.adjustment_pence - 1000) > 0.01 then raise exception 'promo should add 1000 adjustment, got %', r.adjustment_pence; end if;
  raise notice 'promo ok: %', r;

  -- ── Batch 21 (B2): forgiving an overdraft zeroes it and writes an 'adjust' row ──
  perform credit_debit(v, 25, null, true, '{}'::jsonb);
  select * into r from credit_available(v);
  if abs(r.adjustment_pence + 25) > 0.01 then raise exception 'v should be 25 overdrawn, got %', r.adjustment_pence; end if;
  j := credit_forgive_overdrafts('smoke');
  if (j->>'members')::int < 1 or (j->>'pence')::numeric < 25 then raise exception 'forgiveness should cover v: %', j; end if;
  select * into r from credit_available(v);
  if abs(r.adjustment_pence) > 0.01 then raise exception 'v overdraft should be forgiven, got %', r.adjustment_pence; end if;
  if not exists (select 1 from credit_transactions where user_id = v and kind = 'adjust' and abs(amount_pence - 25) < 0.01 and description = 'Overdraft forgiven') then
    raise exception 'forgiveness should write an adjust row for v';
  end if;
  if not exists (select 1 from billing_settings where key = 'batch21_overdrafts_forgiven_at') then raise exception 'the one-off forgiveness should be marked'; end if;
  raise notice 'overdraft forgiveness ok: %', j;

  -- ── Batch 21 (B1): credit_plan_cycle is atomic and a replay expires nothing ──
  j := credit_plan_cycle(w, 1900, now() + interval '30 days', 'inv:cycle1_' || w::text, 'Starter plan credit');
  if not (j->>'created')::boolean or (j->>'expired')::int <> 0 then raise exception 'first cycle should create: %', j; end if;
  perform credit_debit(w, 100, null, false, '{}'::jsonb);
  r := null;
  select * into r from credit_available(w);
  if abs(r.plan_pence - 1800) > 0.01 then raise exception 'w should have 1800 plan credit, got %', r.plan_pence; end if;
  j := credit_plan_cycle(w, 1900, now() + interval '30 days', 'inv:cycle1_' || w::text, 'Starter plan credit');
  if (j->>'created')::boolean or (j->>'expired')::int <> 0 then raise exception 'a replay should create and expire nothing: %', j; end if;
  select * into r from credit_available(w);
  if abs(r.plan_pence - 1800) > 0.01 then raise exception 'a replay must not zero the plan credit, got %', r.plan_pence; end if;
  j := credit_plan_cycle(w, 1900, now() + interval '60 days', 'inv:cycle2_' || w::text, 'Starter plan credit');
  if not (j->>'created')::boolean or (j->>'expired')::int <> 1 then raise exception 'the next cycle should expire the old grant: %', j; end if;
  select * into r from credit_available(w);
  if abs(r.plan_pence - 1900) > 0.01 then raise exception 'w should have a fresh 1900, got %', r.plan_pence; end if;
  raise notice 'plan cycle ok';

  -- ── Batch 21 (B9): no referral credit, no referral reward, for a withheld account ──
  insert into credit_codes (code, kind, amount_pence, owner_user_id, created_by) values ('SMOKEREF', 'referral', 1000, o, 'smoke');
  update profiles set welcome_withheld_reason = 'disposable_email' where id = x;
  ok := false;
  begin
    perform credit_redeem_code(x, 'SMOKEREF');
  exception when sqlstate 'P0403' then
    ok := sqlerrm = 'referral_withheld';
  end;
  if not ok then raise exception 'a withheld account should be refused with referral_withheld'; end if;
  select * into r from credit_available(o);
  if r.adjustment_pence <> 0 then raise exception 'the owner should earn nothing from a withheld account, got %', r.adjustment_pence; end if;
  perform credit_redeem_code(y, 'SMOKEREF');
  select * into r from credit_available(y);
  if abs(r.adjustment_pence - 1000) > 0.01 then raise exception 'y should get the referral credit, got %', r.adjustment_pence; end if;
  select * into r from credit_available(o);
  if abs(r.adjustment_pence - credit_setting_num('referral_pence', 1000)) > 0.01 then raise exception 'the owner should earn the referral reward, got %', r.adjustment_pence; end if;
  if (select referred_by_code from profiles where id = y) <> 'SMOKEREF' then raise exception 'referred_by_code should be stamped'; end if;
  raise notice 'referral guard ok';

  -- ── Batch 21 (A9): updated_at is maintained by a trigger ──
  update profiles set full_name = 'Smoke', updated_at = timestamptz '2020-01-01 00:00:00+00' where id = u;
  if (select updated_at from profiles where id = u) <> now() then raise exception 'profiles.updated_at should be set by the trigger (A9)'; end if;

  -- ── Batch 21 (A1, A11): no member insert policy; one update policy with both halves ──
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT') then raise exception 'profiles should have no insert policy (A1)'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE') <> 1 then raise exception 'profiles should have one update policy (A11)'; end if;
  if (select with_check from pg_policies where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE') is null then raise exception 'the update policy needs a with check (A11)'; end if;

  -- ── Batch 21 (A4, A7, A13, C4, D24): columns and grants ──
  if exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'profiles' and column_name = 'monday_item_id' and grantee = 'authenticated' and privilege_type = 'UPDATE') then
    raise exception 'monday_item_id should not be member-writable (A4)';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'onboarding_skips') then raise exception 'onboarding_skips should be gone (A7)'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'monday_funnel_runs' and column_name = 'cursor') then raise exception 'monday_funnel_runs.cursor should be gone (A13)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'input') then raise exception 'leads.input should exist (C4)'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'provider_calls_action_idx') then raise exception 'provider_calls_action_idx should exist (D24)'; end if;

  -- ── Batch 21 (A12): the funnel counters are service-role only ──
  if has_function_privilege('anon', 'public.funnel_hit(uuid, text, timestamptz, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.funnel_spend_reserve(uuid, timestamptz, numeric, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.funnel_alert_claim(uuid, text, timestamptz)', 'execute') then
    raise exception 'funnel functions should not be executable by anon or authenticated (A12)';
  end if;

  -- ── Batch 21 (B44): the 8-day sweep leaves a captured pack alone ──
  insert into starter_pack_purchases (payment_intent_id, user_id, status, price_pence, credit_pence, created_at, captured_at)
  values ('pi_smoke_captured', null, 'reserved', 1000, 3000, now() - interval '9 days', now() - interval '9 days'),
         ('pi_smoke_stale', null, 'reserved', 1000, 3000, now() - interval '9 days', null);
  j := starter_pack_claim(jsonb_build_object('pi', 'pi_smoke_z', 'user', z, 'price', 1000, 'credit', 3000, 'currency', 'gbp'));
  if j->>'status' <> 'reserved' then raise exception 'z should reserve a pack: %', j; end if;
  if (select status from starter_pack_purchases where payment_intent_id = 'pi_smoke_captured') <> 'reserved' then raise exception 'a captured pack must not be swept to failed (B44)'; end if;
  if (select status from starter_pack_purchases where payment_intent_id = 'pi_smoke_stale') <> 'failed' then raise exception 'an uncaptured 9-day-old reservation should be swept to failed'; end if;
  j := starter_pack_claim(jsonb_build_object('pi', 'pi_smoke_z', 'user', z, 'price', 1000, 'credit', 3000, 'currency', 'gbp'));
  if not (j->>'replay')::boolean then raise exception 'a second claim of the same PaymentIntent is a replay: %', j; end if;
  raise notice 'starter pack claim ok';

  -- ── Batch 21 (E23, E27): the active-days sync takes only settled rows, never a preview's ──
  insert into activity_events (user_id, occurred_at, kind, extras) values (u, now() - interval '1 day', 'today_view', '{}'::jsonb) returning id into id1;
  insert into activity_events (user_id, occurred_at, kind, extras) values (u, now() - interval '2 days', 'today_view', '{"env":"preview"}'::jsonb) returning id into id2;
  insert into activity_events (user_id, occurred_at, kind, extras) values (u, now() - interval '10 seconds', 'today_view', '{}'::jsonb) returning id into id3;
  j := lifecycle_active_days_sync(jsonb_build_object('qualifying', jsonb_build_array('today_view'), 'engaged', '[]'::jsonb, 'apply', true));
  if (j->>'to')::bigint < id2 or (j->>'to')::bigint >= id3 then raise exception 'the watermark should stop before rows younger than two minutes: % (ids % % %)', j, id1, id2, id3; end if;
  if not exists (select 1 from member_active_days where user_id = u and day = yesterday) then raise exception 'yesterday''s view should be an active day (E23)'; end if;
  if exists (select 1 from member_active_days where user_id = u and day = two_days_ago) then raise exception 'a preview deployment''s event must not be an active day (E27)'; end if;
  if (select count(*) from member_active_days where user_id = u) <> 1 then raise exception 'u should have exactly one active day so far'; end if;
  raise notice 'active-days sync ok: %', j;

  -- ── Batch 21 (E3, E27): weekly facts carry signed_in and ignore a preview's events ──
  j := activity_weekly_facts(jsonb_build_object('weeks', 4, 'qualifying', jsonb_build_array('today_view'), 'counted', jsonb_build_array('today_view')));
  if (select (m->>'signed_in')::boolean from jsonb_array_elements(j->'members') m where (m->>'id')::uuid = u) then raise exception 'u has never signed in (E3)'; end if;
  if exists (select 1 from jsonb_array_elements(j->'qdays') q, jsonb_array_elements_text(q->'d') d where (q->>'u')::uuid = u and d::date = two_days_ago) then raise exception 'a preview event must not be a qualifying day (E27)'; end if;
  if not exists (select 1 from jsonb_array_elements(j->'qdays') q, jsonb_array_elements_text(q->'d') d where (q->>'u')::uuid = u and d::date = yesterday) then raise exception 'yesterday should be a qualifying day'; end if;
  update auth.users set last_sign_in_at = now() where id = u;
  j := activity_weekly_facts(jsonb_build_object('weeks', 4, 'qualifying', jsonb_build_array('today_view'), 'counted', jsonb_build_array('today_view')));
  if not (select (m->>'signed_in')::boolean from jsonb_array_elements(j->'members') m where (m->>'id')::uuid = u) then raise exception 'u has signed in now (E3)'; end if;
  raise notice 'weekly facts ok';

  -- ── Batch 23: the call safety rules are unique indexes ──
  insert into si_calls_log (user_id, direction, call_type, status, uk_day) values (u, 'outbound', 'intro', 'answered', current_date);
  begin
    insert into si_calls_log (user_id, direction, call_type, status, uk_day, trigger_ref) values (u, 'outbound', 'low_credit', 'ringing', current_date, 'g1');
    raise exception 'a second outbound call the same UK day must be refused';
  exception when unique_violation then null;
  end;
  begin
    insert into si_calls_log (user_id, direction, call_type, status) values (u, 'outbound', 'intro', 'queued');
    raise exception 'a second intro call must be refused';
  exception when unique_violation then null;
  end;
  insert into si_calls_log (user_id, direction, call_type, status, trigger_ref) values (u, 'outbound', 'low_credit', 'queued', 'g1');
  begin
    insert into si_calls_log (user_id, direction, call_type, status, trigger_ref) values (u, 'outbound', 'low_credit', 'blocked', 'g1');
    raise exception 'one low-credit call per credit landing';
  exception when unique_violation then null;
  end;
  begin
    insert into si_calls_log (user_id, direction, call_type, status, trigger_ref) values (u, 'outbound', 'low_credit', 'queued', 'g2');
    raise exception 'one outbound call in flight per member';
  exception when unique_violation then null;
  end;
  -- Callbacks don't count towards the day.
  insert into si_calls_log (user_id, direction, call_type, status) values (u, 'inbound', 'callback', 'answered');
  insert into si_call_charges (charge_key, user_id, kind, charged_pence) values ('call:smoke:minutes', u, 'minutes', 44);
  begin
    insert into si_call_charges (charge_key, user_id, kind, charged_pence) values ('call:smoke:minutes', u, 'minutes', 44);
    raise exception 'a charge key is charged once';
  exception when unique_violation then null;
  end;
  raise notice 'call safety indexes ok';

  -- ── Batch 22f: funnel leads numbered and charged in one statement ──
  declare
    f uuid := gen_random_uuid();
    l1 uuid := gen_random_uuid();
    l2 uuid := gen_random_uuid();
    l3 uuid := gen_random_uuid();
    l4 uuid := gen_random_uuid();
    mk date := date_trunc('month', now() at time zone 'Europe/London')::date;
    before_tx integer;
  begin
    insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
    values (f, 'credit-smoke-' || f::text || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
    insert into profiles (id, email) values (f, 'credit-smoke-' || f::text || '@example.test') on conflict (id) do nothing;
    perform credit_grant(f, 'topup', 1000, null, 'pi:smoke_funnel_' || f::text, 'Smoke top-up');

    j := funnel_lead_charge(jsonb_build_object('owner', f, 'lead', l1, 'enhanced', false, 'meta', jsonb_build_object('action', 'funnel_lead', 'description', 'Funnel lead')));
    if (j->>'n')::int <> 1 or (j->>'base_pence')::numeric <> 500 or (j->>'already')::boolean then raise exception 'the first lead is n 1 at 500: %', j; end if;
    -- The tier price is a base price: top-up credit pays it at the top-up rate.
    select * into r from credit_available(f);
    if abs(r.topup_pence - (1000 - 500 * rate)) > 0.01 then raise exception 'top-up should pay 500 base at the top-up rate, left %', r.topup_pence; end if;

    -- The same lead again (a retry, the drain): the first charge back, no second debit.
    select count(*) into before_tx from credit_transactions where user_id = f and kind = 'debit';
    j := funnel_lead_charge(jsonb_build_object('owner', f, 'lead', l1, 'enhanced', false));
    if not (j->>'already')::boolean or (j->>'n')::int <> 1 then raise exception 'a lead is charged once: %', j; end if;
    if (select count(*) from credit_transactions where user_id = f and kind = 'debit') <> before_tx then raise exception 'a repeat must not debit again'; end if;

    j := funnel_lead_charge(jsonb_build_object('owner', f, 'lead', l2, 'enhanced', false));
    if (j->>'n')::int <> 2 then raise exception 'the next lead is n 2: %', j; end if;

    -- A month at 20: lead 21 is the first at the 21+ tier; enhanced adds its extra.
    update funnel_lead_months set leads = 20 where owner_id = f and month = mk;
    j := funnel_lead_charge(jsonb_build_object('owner', f, 'lead', l3, 'enhanced', false));
    if (j->>'n')::int <> 21 or (j->>'base_pence')::numeric <> 400 then raise exception 'lead 21 is 400: %', j; end if;
    j := funnel_lead_charge(jsonb_build_object('owner', f, 'lead', l4, 'enhanced', true, 'enhanced_extra', 200));
    if (j->>'n')::int <> 22 or (j->>'base_pence')::numeric <> 600 then raise exception 'an enhanced lead 22 is 600: %', j; end if;
    if (select leads from funnel_lead_months where owner_id = f and month = mk) <> 22 then raise exception 'the month should count 22'; end if;
    if (select count(*) from funnel_lead_charges where owner_id = f) <> 4 then raise exception 'one charge row per lead'; end if;
    if (select (metadata->>'lead_number')::int from credit_transactions where id = (j->>'tx')::bigint) <> 22 then raise exception 'the debit should carry its lead number'; end if;

    if has_function_privilege('authenticated', 'public.funnel_lead_charge(jsonb)', 'execute')
       or has_function_privilege('anon', 'public.mc_page_view_hit(boolean)', 'execute') then
      raise exception 'Batch 22f functions should be service-role only';
    end if;
    if has_column_privilege('authenticated', 'public.profiles', 'signup_path', 'update') then
      raise exception 'the management stamp must not be member-writable';
    end if;
    perform mc_page_view_hit(true);
    perform mc_page_view_hit(false);
    if (select views from mc_page_views where day = (now() at time zone 'Europe/London')::date) < 2 then raise exception 'page views should count'; end if;
    -- The owner's new-lead email is claimed once per lead: a second finish claims nothing.
    insert into leads (id, user_id, email, status) values (l1, f, 'landlord@example.test', 'new');
    update leads set owner_notified_at = now() where id = l1 and owner_notified_at is null;
    get diagnostics before_tx = row_count;
    if before_tx <> 1 then raise exception 'the first finish should claim the new-lead email'; end if;
    update leads set owner_notified_at = now() where id = l1 and owner_notified_at is null;
    get diagnostics before_tx = row_count;
    if before_tx <> 0 then raise exception 'a lead''s new-lead email is claimed once'; end if;
    raise notice 'funnel lead tiers ok';
  end;

  -- ── Batch 21 (A10): the SQL fallback when the setting is missing ──
  delete from billing_settings where key = 'spend_rates';
  if credit_spend_rate('topup') <> 1.3 or credit_spend_rate('plan') <> 1 then raise exception 'credit_spend_rate fallback should be 1.3 / 1 (A10)'; end if;

  raise notice 'ALL CREDIT SMOKE CHECKS PASSED';
end $$;

-- ── Batch 25 (R2-13): a face debit (calls, texts, emails, seats) never takes reserved credit ──
do $$
declare
  q uuid := gen_random_uuid();
  rate numeric := credit_spend_rate('topup');
  res uuid;
  tx bigint;
  refused boolean := false;
  r record;
begin
  insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
  values (q, 'credit-smoke-' || q::text || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
  insert into profiles (id, email) values (q, 'credit-smoke-' || q::text || '@example.test') on conflict (id) do nothing;
  perform credit_grant(q, 'topup', 1000, null, 'pi:smoke_r213_' || q::text, 'Smoke top-up');
  -- A running action holds all but about 69p (base) of the £10 top-up.
  res := credit_reserve(q, 'smoke_analysis', gen_random_uuid(), round(1000 / rate - 69.2307, 4));

  -- £1 face would take ~77p base: more than is free. Refused, nothing taken.
  begin
    perform credit_debit_face(q, 100, '{"action":"si_call","description":"Smoke call"}'::jsonb);
  exception when sqlstate 'P0402' then refused := true;
  end;
  if not refused then raise exception 'credit_debit_face took credit an open reservation holds (R2-13)'; end if;
  select * into r from credit_available(q);
  if r.topup_pence <> 1000 then raise exception 'a refused face debit should take nothing, topup now %', r.topup_pence; end if;

  -- 80p face (~62p base) fits beside the reservation.
  tx := credit_debit_face(q, 80, '{"action":"si_call","description":"Smoke call"}'::jsonb);
  if tx is null then raise exception 'a face debit within the free credit should go'; end if;
  select * into r from credit_available(q);
  if r.spendable_base_pence < -0.0001 then raise exception 'the reservation is no longer covered: spendable %', r.spendable_base_pence; end if;

  -- Released, the rest is free to spend again.
  perform credit_release(res);
  tx := credit_debit_face(q, 500, '{"action":"si_call","description":"Smoke call"}'::jsonb);
  if tx is null then raise exception 'a face debit after the release should go'; end if;
  raise notice 'R2-13 face debits leave reservations alone: ok';
end $$;

rollback;
