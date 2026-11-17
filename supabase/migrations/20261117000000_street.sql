-- 파팅 거리: 줄 서기, 가게, 주최 클릭, 방문 집계, 알림 연락처
-- Supabase SQL Editor에서 이 파일 전체를 실행한 다음 20261117000100_street_regions.sql을 실행한다.
-- 둘 다 여러 번 실행해도 안전하다.
--
-- 테이블은 RLS로 잠그고 직접 읽기/쓰기를 막는다. 브라우저는 아래 함수(RPC)로만 접근하고,
-- 읽기는 합계만 돌려준다. visitor_id는 브라우저가 만든 익명 번호다.
-- 사람을 식별하는 정보(휴대폰 번호)는 street_contact에만 있고, 그것을 읽어 주는 함수는 없다.

-- ───────── 테이블 ─────────

-- 유효한 시군구 코드. 내용은 20261117000100_street_regions.sql이 채운다
create table if not exists public.street_region (
  code text primary key check (code ~ '^[0-9]{5}$'),
  name text not null
);

-- 줄 한 자리. 보기의 key는 src/data/questions.ts, src/data/categories.ts와 맞아야 한다
create table if not exists public.street_queue (
  visitor_id uuid not null,
  sigungu text not null references public.street_region (code),
  category text not null check (category in ('wine', 'board', 'rooftop', 'run', 'book', 'club')),
  time_slot text not null check (time_slot in ('weekday', 'frisat', 'weekend')),
  fee text not null check (fee in ('f1', 'f2', 'f3', 'f4')),
  age text check (age in ('a20e', 'a20l', 'a30e', 'a30l', 'a40')),
  size text check (size in ('small', 'medium', 'large')),
  wants_host boolean,
  created_at timestamptz not null default now(),
  primary key (visitor_id, sigungu, category)
);
create index if not exists street_queue_shop_idx on public.street_queue (sigungu, category, created_at);

-- 개업한 가게. 행이 없으면 빈 가게다. 초기에는 운영자가 Table Editor에서 직접 넣는다
create table if not exists public.street_shop (
  sigungu text not null references public.street_region (code),
  category text not null check (category in ('wine', 'board', 'rooftop', 'run', 'book', 'club')),
  status text not null default 'open' check (status = 'open'),
  party_url text check (party_url ~ '^https://[^[:space:]]+$'),
  opened_at timestamptz not null default now(),
  primary key (sigungu, category)
);

create table if not exists public.street_host_click (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  sigungu text not null references public.street_region (code),
  category text not null check (category in ('wine', 'board', 'rooftop', 'run', 'book', 'club')),
  created_at timestamptz not null default now()
);

-- 하루 한 번 (한국 시간). ref는 처음 들어온 경로: 'share' 공유 링크, 'direct' 그 외
create table if not exists public.street_visit (
  visitor_id uuid not null,
  day date not null,
  ref text check (ref ~ '^[a-z0-9_]{1,16}$'),
  created_at timestamptz not null default now(),
  primary key (visitor_id, day)
);

-- 개업 알림을 신청한 사람의 휴대폰 번호. 숫자만 저장한다 (01012345678)
create table if not exists public.street_contact (
  visitor_id uuid primary key,
  phone text not null check (phone ~ '^010[0-9]{8}$'),
  consent_at timestamptz not null default now(),
  consent_version text not null check (consent_version ~ '^[0-9a-z.-]{1,20}$'),
  created_at timestamptz not null default now()
);
create index if not exists street_contact_phone_idx on public.street_contact (phone);

-- 반복 호출 제한용. 접속 IP의 해시와 10분 단위 호출 수. 1시간이 지나면 지운다
create table if not exists public.street_throttle (
  key text not null,
  bucket timestamptz not null,
  n integer not null default 1,
  primary key (key, bucket)
);

alter table public.street_region enable row level security;
alter table public.street_queue enable row level security;
alter table public.street_shop enable row level security;
alter table public.street_host_click enable row level security;
alter table public.street_visit enable row level security;
alter table public.street_contact enable row level security;
alter table public.street_throttle enable row level security;

revoke all on public.street_region from anon, authenticated;
revoke all on public.street_queue from anon, authenticated;
revoke all on public.street_shop from anon, authenticated;
revoke all on public.street_host_click from anon, authenticated;
revoke all on public.street_visit from anon, authenticated;
revoke all on public.street_contact from anon, authenticated;
revoke all on public.street_throttle from anon, authenticated;

-- ───────── 안에서만 쓰는 함수 (브라우저에서 부를 수 없다) ─────────

-- 분포를 보여주는 최소 대기 인원. 이보다 적으면 "모으는 중"
create or replace function public.street_min_display()
returns integer
language sql
immutable
as $$ select 5 $$;

-- 한 사람이 동시에 설 수 있는 줄 수
create or replace function public.street_max_queues()
returns integer
language sql
immutable
as $$ select 5 $$;

-- 같은 IP에서 10분 동안 p_limit번을 넘게 부르면 true.
-- IP를 알 수 없으면(SQL Editor에서 직접 실행 등) 제한하지 않는다
create or replace function public.street_throttled(p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  h jsonb;
  ip text;
  c integer;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    h := null;
  end;
  ip := coalesce(nullif(h ->> 'cf-connecting-ip', ''), nullif(btrim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''));
  if ip is null then
    return false;
  end if;
  delete from public.street_throttle where bucket < now() - interval '1 hour';
  insert into public.street_throttle (key, bucket)
  values (md5(ip), date_bin('10 minutes', now(), timestamptz '2000-01-01 00:00:00+00'))
  on conflict (key, bucket) do update set n = public.street_throttle.n + 1
  returning n into c;
  return c > p_limit;
end;
$$;

-- 가게별 대기 인원. 같은 휴대폰 번호는 visitor_id가 달라도 한 명으로 센다
--   waiting 대기 인원, notify 알림 신청 인원, week 최근 7일에 줄 선 인원
create or replace function public.street_counts()
returns table (sigungu text, category text, waiting bigint, notify bigint, week bigint)
language sql
stable
security definer
set search_path = public
as $$
  select q.sigungu, q.category,
    count(distinct coalesce(c.phone, q.visitor_id::text)),
    count(distinct c.phone),
    count(distinct coalesce(c.phone, q.visitor_id::text)) filter (where q.created_at > now() - interval '7 days')
  from public.street_queue q
  left join public.street_contact c on c.visitor_id = q.visitor_id
  group by q.sigungu, q.category;
$$;

-- 한 가게에서 이 방문자의 순번과 전체 대기 인원. 줄에 없으면 position은 0
create or replace function public.street_spot(p_visitor uuid, p_sigungu text, p_category text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select q.visitor_id, q.created_at, coalesce(c.phone, q.visitor_id::text) as person
    from public.street_queue q
    left join public.street_contact c on c.visitor_id = q.visitor_id
    where q.sigungu = p_sigungu and q.category = p_category
  ),
  firsts as (
    select person, min(created_at) as at from p group by person
  ),
  me as (
    select f.at from firsts f where f.person = (select p.person from p where p.visitor_id = p_visitor)
  )
  select jsonb_build_object(
    'waiting', (select count(*) from firsts),
    'position', (select count(*) from firsts f where f.at <= (select at from me))
  );
$$;

-- ───────── 쓰기 ─────────

-- 줄 서기. 결과:
--   ok      줄 섰다 (position, waiting 포함)
--   dup     이미 이 가게 줄에 있다 (position, waiting 포함)
--   limit   이미 5개의 줄에 서 있다
--   open    이미 개업한 가게라 줄을 서지 않는다
--   invalid 지역, 카테고리, 답변 값이 잘못됐다
--   busy    짧은 시간에 너무 많이 불렀다
create or replace function public.street_join(
  p_visitor uuid,
  p_sigungu text,
  p_category text,
  p_time text,
  p_fee text,
  p_age text default null,
  p_size text default null,
  p_wants_host boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor is null or p_sigungu is null or p_category is null then
    return jsonb_build_object('result', 'invalid');
  end if;
  if public.street_throttled(40) then
    return jsonb_build_object('result', 'busy');
  end if;
  -- 같은 방문자의 동시 요청이 5개 제한을 넘기지 못하게 줄 세운다
  perform pg_advisory_xact_lock(hashtextextended(p_visitor::text, 0));

  if exists (select 1 from public.street_shop s where s.sigungu = p_sigungu and s.category = p_category) then
    return jsonb_build_object('result', 'open');
  end if;
  if exists (select 1 from public.street_queue q where q.visitor_id = p_visitor and q.sigungu = p_sigungu and q.category = p_category) then
    return jsonb_build_object('result', 'dup') || public.street_spot(p_visitor, p_sigungu, p_category);
  end if;
  -- 이미 개업한 가게의 줄은 5개에 넣지 않는다
  if (
    select count(*) from public.street_queue q
    where q.visitor_id = p_visitor
      and not exists (select 1 from public.street_shop s where s.sigungu = q.sigungu and s.category = q.category)
  ) >= public.street_max_queues() then
    return jsonb_build_object('result', 'limit');
  end if;

  insert into public.street_queue (visitor_id, sigungu, category, time_slot, fee, age, size, wants_host)
  values (p_visitor, p_sigungu, p_category, p_time, p_fee, p_age, p_size, p_wants_host);
  return jsonb_build_object('result', 'ok') || public.street_spot(p_visitor, p_sigungu, p_category);
exception
  when check_violation or foreign_key_violation or not_null_violation then
    return jsonb_build_object('result', 'invalid');
end;
$$;

-- 줄에서 나가기. 마지막 줄에서 나가면 알림용 번호도 같이 지운다
create or replace function public.street_leave(p_visitor uuid, p_sigungu text, p_category text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.street_queue q
  where q.visitor_id = p_visitor and q.sigungu = p_sigungu and q.category = p_category;
  if not exists (select 1 from public.street_queue q where q.visitor_id = p_visitor) then
    delete from public.street_contact c where c.visitor_id = p_visitor;
  end if;
  return jsonb_build_object('result', 'ok', 'waiting', (public.street_spot(p_visitor, p_sigungu, p_category) -> 'waiting'));
end;
$$;

-- 알림용 휴대폰 번호 저장. 동의 체크는 화면에서 받고, 동의한 문구의 버전을 같이 남긴다.
-- 결과: ok | invalid (번호 형식) | noqueue (줄에 서 있지 않다) | busy
create or replace function public.street_contact_set(p_visitor uuid, p_phone text, p_consent_version text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if d like '8210%' then
    d := '0' || substr(d, 3);
  end if;
  if p_visitor is null or d !~ '^010[0-9]{8}$' or coalesce(p_consent_version, '') !~ '^[0-9a-z.-]{1,20}$' then
    return 'invalid';
  end if;
  if public.street_throttled(40) then
    return 'busy';
  end if;
  if not exists (select 1 from public.street_queue q where q.visitor_id = p_visitor) then
    return 'noqueue';
  end if;
  insert into public.street_contact (visitor_id, phone, consent_version)
  values (p_visitor, d, p_consent_version)
  on conflict (visitor_id) do update
    set phone = excluded.phone, consent_version = excluded.consent_version, consent_at = now();
  return 'ok';
end;
$$;

-- 알림 그만 받기. 번호를 지운다
create or replace function public.street_contact_remove(p_visitor uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.street_contact c where c.visitor_id = p_visitor;
$$;

-- "이 가게 열기" 클릭 기록
create or replace function public.street_host_click(p_visitor uuid, p_sigungu text, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visitor is null or public.street_throttled(40) then
    return;
  end if;
  insert into public.street_host_click (visitor_id, sigungu, category)
  values (p_visitor, p_sigungu, p_category);
exception
  when check_violation or foreign_key_violation or not_null_violation then
    return;
end;
$$;

-- 하루에 한 번만 집계된다 (한국 시간 기준). 그날 처음 들어온 경로만 남는다
create or replace function public.street_visit(p_visitor uuid, p_ref text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.street_visit (visitor_id, day, ref)
  select p_visitor, (now() at time zone 'Asia/Seoul')::date,
    case when p_ref ~ '^[a-z0-9_]{1,16}$' then p_ref end
  where p_visitor is not null
  on conflict do nothing;
$$;

-- ───────── 읽기 (합계만) ─────────

-- 지도용. 개업한 가게의 줄은 대기 인원에 넣지 않는다
--   total 대기 인원 합계(가게별 대기 인원의 합. 한 사람이 두 줄에 서면 2)
create or replace function public.street_map()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with w as (
    select c.sigungu, c.waiting from public.street_counts() c
    where not exists (select 1 from public.street_shop s where s.sigungu = c.sigungu and s.category = c.category)
  )
  select jsonb_build_object(
    'total', coalesce((select sum(waiting) from w), 0),
    'shops', (select count(*) from w),
    'open', (select count(*) from public.street_shop),
    'sido', coalesce((select jsonb_object_agg(x.k, x.n) from (select left(sigungu, 2) as k, sum(waiting) as n from w group by 1) x), '{}'::jsonb),
    'sigungu', coalesce((select jsonb_object_agg(x.k, x.n) from (select sigungu as k, sum(waiting) as n from w group by 1) x), '{}'::jsonb)
  );
$$;

-- 한 동네의 가게별 상태: {"wine": {"waiting": 37, "open": false, "url": null}, ...}
-- 줄도 없고 개업도 안 한 카테고리는 빠진다
create or replace function public.street_town(p_sigungu text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(
    coalesce(c.category, s.category),
    jsonb_build_object('waiting', coalesce(c.waiting, 0), 'open', s.sigungu is not null, 'url', s.party_url)
  ), '{}'::jsonb)
  from (select * from public.street_counts() where sigungu = p_sigungu) c
  full join (select * from public.street_shop where sigungu = p_sigungu) s on s.category = c.category;
$$;

-- 영수증용. 대기 인원이 기준 미만이면 dist는 null이다
create or replace function public.street_shop_detail(p_sigungu text, p_category text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  w bigint := 0;
  n bigint := 0;
  wk bigint := 0;
  d jsonb := null;
  s public.street_shop%rowtype;
begin
  select c.waiting, c.notify, c.week into w, n, wk from public.street_counts() c
  where c.sigungu = p_sigungu and c.category = p_category;
  w := coalesce(w, 0);
  n := coalesce(n, 0);
  wk := coalesce(wk, 0);
  select * into s from public.street_shop x where x.sigungu = p_sigungu and x.category = p_category;

  if w >= public.street_min_display() then
    select jsonb_build_object(
      'time', coalesce((select jsonb_object_agg(x.k, x.n) from (select time_slot as k, count(*) as n from public.street_queue where sigungu = p_sigungu and category = p_category group by 1) x), '{}'::jsonb),
      'fee', coalesce((select jsonb_object_agg(x.k, x.n) from (select fee as k, count(*) as n from public.street_queue where sigungu = p_sigungu and category = p_category group by 1) x), '{}'::jsonb),
      'age', coalesce((select jsonb_object_agg(x.k, x.n) from (select age as k, count(*) as n from public.street_queue where sigungu = p_sigungu and category = p_category and age is not null group by 1) x), '{}'::jsonb),
      'size', coalesce((select jsonb_object_agg(x.k, x.n) from (select size as k, count(*) as n from public.street_queue where sigungu = p_sigungu and category = p_category and size is not null group by 1) x), '{}'::jsonb),
      'hosts', (select count(*) from public.street_queue where sigungu = p_sigungu and category = p_category and wants_host)
    ) into d;
  end if;

  return jsonb_build_object(
    'waiting', w,
    'notify', n,
    -- 최근 7일에 줄 선 인원
    'week', wk,
    -- 최근 30일에 "이 가게 열기"를 누른 사람 수
    'clicks', (
      select count(distinct h.visitor_id) from public.street_host_click h
      where h.sigungu = p_sigungu and h.category = p_category and h.created_at > now() - interval '30 days'
    ),
    'open', s.sigungu is not null,
    'url', s.party_url,
    'min', public.street_min_display(),
    'dist', d
  );
end;
$$;

-- 주최자 보기용 순위: 아직 주인이 없는 가게를 대기 인원이 많은 순으로
create or replace function public.street_rank(p_limit integer default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('sigungu', r.sigungu, 'category', r.category, 'waiting', r.waiting, 'notify', r.notify, 'week', r.week)
    order by r.waiting desc, r.week desc, r.sigungu, r.category
  ), '[]'::jsonb)
  from (
    select c.* from public.street_counts() c
    where not exists (select 1 from public.street_shop s where s.sigungu = c.sigungu and s.category = c.category)
    order by c.waiting desc, c.week desc, c.sigungu, c.category
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ) r;
$$;

-- 내가 선 줄과 알림 신청 여부. 번호 자체는 돌려주지 않는다
create or replace function public.street_mine(p_visitor uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'notify', exists (select 1 from public.street_contact c where c.visitor_id = p_visitor),
    'queues', coalesce((
      select jsonb_agg(
        jsonb_build_object('sigungu', q.sigungu, 'category', q.category, 'open', s.sigungu is not null, 'url', s.party_url)
          || public.street_spot(p_visitor, q.sigungu, q.category)
        order by q.created_at
      )
      from public.street_queue q
      left join public.street_shop s on s.sigungu = q.sigungu and s.category = q.category
      where q.visitor_id = p_visitor
    ), '[]'::jsonb)
  );
$$;

-- ───────── 운영자용 (브라우저에서 부를 수 없다. SQL Editor에서 실행) ─────────

-- 보유 기간이 지난 번호 삭제: 신청 후 1년. 지운 행 수를 돌려준다
create or replace function public.street_contact_purge()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c integer;
begin
  delete from public.street_contact where consent_at < now() - interval '1 year';
  get diagnostics c = row_count;
  return c;
end;
$$;

-- ───────── 권한 ─────────
-- Supabase는 public 스키마의 새 함수를 anon에게도 열어 두므로 하나씩 닫고 필요한 것만 연다

revoke execute on function public.street_min_display() from public, anon, authenticated;
revoke execute on function public.street_max_queues() from public, anon, authenticated;
revoke execute on function public.street_throttled(integer) from public, anon, authenticated;
revoke execute on function public.street_counts() from public, anon, authenticated;
revoke execute on function public.street_spot(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.street_contact_purge() from public, anon, authenticated;

revoke execute on function public.street_join(uuid, text, text, text, text, text, text, boolean) from public;
revoke execute on function public.street_leave(uuid, text, text) from public;
revoke execute on function public.street_contact_set(uuid, text, text) from public;
revoke execute on function public.street_contact_remove(uuid) from public;
revoke execute on function public.street_host_click(uuid, text, text) from public;
revoke execute on function public.street_visit(uuid, text) from public;
revoke execute on function public.street_map() from public;
revoke execute on function public.street_town(text) from public;
revoke execute on function public.street_shop_detail(text, text) from public;
revoke execute on function public.street_rank(integer) from public;
revoke execute on function public.street_mine(uuid) from public;

grant execute on function public.street_join(uuid, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.street_leave(uuid, text, text) to anon, authenticated;
grant execute on function public.street_contact_set(uuid, text, text) to anon, authenticated;
grant execute on function public.street_contact_remove(uuid) to anon, authenticated;
grant execute on function public.street_host_click(uuid, text, text) to anon, authenticated;
grant execute on function public.street_visit(uuid, text) to anon, authenticated;
grant execute on function public.street_map() to anon, authenticated;
grant execute on function public.street_town(text) to anon, authenticated;
grant execute on function public.street_shop_detail(text, text) to anon, authenticated;
grant execute on function public.street_rank(integer) to anon, authenticated;
grant execute on function public.street_mine(uuid) to anon, authenticated;
