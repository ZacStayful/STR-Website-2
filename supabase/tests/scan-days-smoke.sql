-- Batch 22e: "properties scanned" checks. Run AFTER schema.sql (CI job
-- "schema", after credit-smoke.sql). One transaction, rolled back at the end,
-- so it leaves no data behind. A failing check raises; success prints notices.
begin;

do $$
declare
  u uuid := gen_random_uuid();
  d1 date := date '2026-09-28';
  d2 date := date '2026-09-29';
  d3 date := date '2026-09-30';
  n integer;
  j jsonb;
begin
  -- Isolate from anything already stored.
  delete from public.listing_scan_days where day between d1 - 1 and d3 + 1;

  -- Three listings: A first screened on d1 (a sale in LS), B on d2 (a rent in LS), C on d2 (a sale in M).
  insert into public.sourced_listings (canonical_url, source, kind, query_key, postcode_area, snapshot, first_seen_at, last_seen_at) values
    ('https://t.test/a', 'test', 'sale', 'k', 'LS', '{}', d1::timestamp at time zone 'Europe/London' + interval '9 hours', d1::timestamp at time zone 'Europe/London' + interval '9 hours'),
    ('https://t.test/b', 'test', 'rent', 'k', 'ls', '{}', d2::timestamp at time zone 'Europe/London' + interval '9 hours', d2::timestamp at time zone 'Europe/London' + interval '9 hours'),
    ('https://t.test/c', 'test', 'sale', 'k', 'M', '{}', d2::timestamp at time zone 'Europe/London' + interval '23 hours 30 minutes', d2::timestamp at time zone 'Europe/London' + interval '23 hours 30 minutes');

  -- A is re-screened on d2 and d3 the way every job writes: ignore the duplicate, move last_seen_at only.
  insert into public.sourced_listings (canonical_url, source, kind, query_key, postcode_area, snapshot, first_seen_at, last_seen_at)
  values ('https://t.test/a', 'test', 'sale', 'k', 'LS', '{}', d2::timestamp at time zone 'Europe/London' + interval '9 hours', d2::timestamp at time zone 'Europe/London' + interval '9 hours')
  on conflict (canonical_url) do nothing;
  insert into public.sourced_listings (canonical_url, source, kind, query_key, postcode_area, snapshot, first_seen_at, last_seen_at)
  values ('https://t.test/a', 'test', 'sale', 'k', 'LS', '{}', d3::timestamp at time zone 'Europe/London' + interval '9 hours', d3::timestamp at time zone 'Europe/London' + interval '9 hours')
  on conflict (canonical_url) do nothing;
  update public.sourced_listings set last_seen_at = d3::timestamp at time zone 'Europe/London' + interval '9 hours' where canonical_url = 'https://t.test/a';

  perform public.record_listing_scan_days(array[d1, d2, d3]);
  select coalesce(sum(new_listings), 0) into n from public.listing_scan_days where day between d1 and d3;
  if n <> 3 then raise exception 'scan days: expected 3 listings over three days, got %', n; end if;
  select coalesce(sum(new_listings), 0) into n from public.listing_scan_days where day = d1 and postcode_area = 'LS' and kind = 'sale';
  if n <> 1 then raise exception 'scan days: a listing re-screened on 3 days counts once on its first day, got %', n; end if;
  select coalesce(sum(new_listings), 0) into n from public.listing_scan_days where day = d2 and postcode_area = 'LS' and kind = 'rent';
  if n <> 1 then raise exception 'scan days: areas are upper-cased, got %', n; end if;
  select coalesce(sum(new_listings), 0) into n from public.listing_scan_days where day = d2 and postcode_area = 'M';
  if n <> 1 then raise exception 'scan days: 23:30 UK time is still that UK day, got %', n; end if;
  raise notice 'scan days: re-screened listing counts once ok';

  -- Running the job again (twice) recounts: nothing doubles.
  perform public.record_listing_scan_days(array[d2, d3]);
  perform public.record_listing_scan_days(array[d1, d2, d3]);
  select coalesce(sum(new_listings), 0) into n from public.listing_scan_days where day between d1 and d3;
  if n <> 3 then raise exception 'scan days: a re-run doubled a day (%)', n; end if;
  raise notice 'scan days: re-run does not double ok';

  -- A member who joined on d1, every area, both kinds: A was live when they joined (baseline 1), B and C came after (new 2).
  insert into auth.users (id, email, raw_user_meta_data, instance_id, aud, role, created_at, updated_at)
  values (u, 'scan-smoke-' || u || '@example.test', '{}'::jsonb, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now());
  insert into public.profiles (id, email) values (u, 'scan-smoke-' || u || '@example.test') on conflict (id) do nothing;

  j := public.member_scanned(jsonb_build_object('user', u, 'join_day', d1, 'today', d1, 'areas', null, 'kinds', jsonb_build_array('sale', 'rent')));
  if (j->>'baseline')::int <> 1 or (j->>'new_since')::int <> 2 or (j->>'stored')::boolean then raise exception 'member scanned (joining day): %', j; end if;
  if exists (select 1 from public.member_scan_baselines where user_id = u) then raise exception 'member scanned: stored a baseline on the joining day'; end if;

  -- Sales in LS only: A in the baseline, nothing new.
  j := public.member_scanned(jsonb_build_object('user', u, 'join_day', d1, 'today', d1, 'areas', jsonb_build_array('ls'), 'kinds', jsonb_build_array('sale')));
  if (j->>'baseline')::int <> 1 or (j->>'new_since')::int <> 0 then raise exception 'member scanned (LS sales): %', j; end if;

  -- After the joining day the baseline is stored once, and read back afterwards.
  j := public.member_scanned(jsonb_build_object('user', u, 'join_day', d1, 'today', d3, 'areas', null, 'kinds', jsonb_build_array('sale', 'rent')));
  if (j->>'baseline')::int <> 1 or not (j->>'stored')::boolean then raise exception 'member scanned (stored): %', j; end if;
  delete from public.sourced_listings where canonical_url = 'https://t.test/a';
  j := public.member_scanned(jsonb_build_object('user', u, 'join_day', d1, 'today', d3, 'areas', null, 'kinds', jsonb_build_array('sale', 'rent')));
  if (j->>'baseline')::int <> 1 then raise exception 'member scanned: the stored baseline moved (%)', j; end if;
  raise notice 'member scanned ok';
end $$;

rollback;
