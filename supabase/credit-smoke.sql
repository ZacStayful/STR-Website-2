-- Credit ledger smoke test. Run in the Supabase SQL editor AFTER schema.sql.
-- Everything runs inside one transaction and is rolled back at the end, so
-- it leaves no data behind. A failing check raises; success prints notices.
begin;

do $$
declare
  u uuid := gen_random_uuid();
  a uuid := gen_random_uuid();
  g_plan uuid; g_top uuid; g_top2 uuid;
  r record;
  res uuid;
  tx bigint;
  ok boolean;
begin
  -- A throwaway auth user + profile (the trigger creates the profile).
  insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
  values (u, 'credit-smoke-' || u::text || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
  insert into profiles (id, email) values (u, 'credit-smoke@example.test') on conflict (id) do nothing;

  -- Grants: £5 plan (expires in a month), £10 top-up.
  g_plan := credit_grant(u, 'plan', 500, now() + interval '30 days', 'inv:smoke_' || u::text, 'Smoke plan');
  g_top := credit_grant(u, 'topup', 1000, null, 'pi:smoke_' || u::text, 'Smoke top-up');
  -- Idempotent on source_ref.
  g_top2 := credit_grant(u, 'topup', 1000, null, 'pi:smoke_' || u::text, 'Smoke top-up again');
  if g_top2 <> g_top then raise exception 'credit_grant should be idempotent on source_ref'; end if;

  select * into r from credit_available(u);
  if r.plan_pence <> 500 or r.topup_pence <> 1000 then raise exception 'buckets wrong: %', r; end if;
  -- spendable base = 500/1 + 1000/1.5 = 1166.6667
  if abs(r.spendable_base_pence - 1166.6667) > 0.01 then raise exception 'spendable wrong: %', r.spendable_base_pence; end if;
  raise notice 'grants ok: %', r;

  -- Reserve more than spendable → P0402.
  ok := false;
  begin
    perform credit_reserve(u, 'report', a, 2000);
  exception when sqlstate 'P0402' then ok := true;
  end;
  if not ok then raise exception 'oversized reservation should raise P0402'; end if;

  -- Reserve £9.10 max, debit 730 base (a full report): plan 500 first, then 230 base × 1.5 = 345 top-up.
  res := credit_reserve(u, 'report', a, 910);
  tx := credit_debit(u, 730, res, true, jsonb_build_object('action_id', a, 'action', 'report', 'provider', 'airbtics', 'unit', 'report_all'));
  perform credit_release(res);
  select * into r from credit_available(u);
  if r.plan_pence <> 0 then raise exception 'plan should be drained, got %', r.plan_pence; end if;
  if abs(r.topup_pence - 655) > 0.01 then raise exception 'top-up should be 655, got %', r.topup_pence; end if;
  if abs(r.spendable_base_pence - 436.6667) > 0.01 then raise exception 'spendable should be 436.67, got %', r.spendable_base_pence; end if;
  if r.reserved_base_pence <> 0 then raise exception 'reservation not released'; end if;
  if (select amount_pence from credit_transactions where id = tx) <> -845 then raise exception 'debit amount should be -845 grant pence'; end if;
  if (select count(*) from credit_allocations where transaction_id = tx) <> 2 then raise exception 'debit should span two grants'; end if;
  raise notice 'mixed-rate debit ok: %', r;

  -- Refund half (365 base) → 250 plan + 172.5 top-up back.
  perform credit_refund(tx, 365, 'smoke refund');
  select * into r from credit_available(u);
  if abs(r.plan_pence - 250) > 0.01 or abs(r.topup_pence - 827.5) > 0.01 then raise exception 'refund wrong: %', r; end if;
  raise notice 'refund ok: %', r;

  -- Expiry exclusion: expire plan grants; only top-up counts.
  perform credit_expire_plan_grants(u, 'smoke');
  select * into r from credit_available(u);
  if r.plan_pence <> 0 then raise exception 'plan should be expired'; end if;
  if abs(r.spendable_base_pence - 551.6667) > 0.01 then raise exception 'spendable after expiry wrong: %', r.spendable_base_pence; end if;

  -- Debit without reservation beyond spendable and without allow_negative → P0402.
  ok := false;
  begin
    perform credit_debit(u, 600, null, false, '{}'::jsonb);
  exception when sqlstate 'P0402' then ok := true;
  end;
  if not ok then raise exception 'unaffordable debit should raise P0402'; end if;

  -- Overdraft: allow_negative pays the provider and dips negative; the next grant repays it.
  perform credit_debit(u, 600, null, true, '{}'::jsonb);
  select * into r from credit_available(u);
  if r.topup_pence <> 0 then raise exception 'top-up should be drained, got %', r.topup_pence; end if;
  if abs(r.adjustment_pence - (-48.3333)) > 0.01 then raise exception 'overdraft should be -48.33 base, got %', r.adjustment_pence; end if;
  perform credit_grant(u, 'welcome', 2000, null, 'welcome:smoke_' || u::text, 'Smoke welcome');
  select * into r from credit_available(u);
  if abs(r.adjustment_pence) > 0.01 then raise exception 'overdraft should be repaid, got %', r.adjustment_pence; end if;
  if abs(r.welcome_pence - 1951.6667) > 0.01 then raise exception 'welcome should be 1951.67 after repaying, got %', r.welcome_pence; end if;
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

  raise notice 'ALL CREDIT SMOKE CHECKS PASSED';
end $$;

rollback;
