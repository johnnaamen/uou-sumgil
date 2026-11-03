-- 울산대 숨길 · Supabase SQL Editor에 통째로 붙여넣고 Run 하세요.

-- 1) 신고 테이블
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('smoke', 'crowd', 'clear')),
  x integer not null check (x between 0 and 1680),
  y integer not null check (y between 0 and 1290),
  ts bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_at timestamptz not null default now()
);
create index if not exists reports_ts_idx on public.reports (ts desc);

-- 2) 시간은 서버가 찍고(조작 방지), 1분에 60건 넘게 몰리면 막기(도배 방지)
create or replace function public.reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.ts := (extract(epoch from now()) * 1000)::bigint;
  new.created_at := now();
  if (select count(*) from public.reports where created_at > now() - interval '1 minute') >= 60 then
    raise exception 'too many reports, try again shortly';
  end if;
  return new;
end $$;
drop trigger if exists reports_guard on public.reports;
create trigger reports_guard before insert on public.reports
  for each row execute function public.reports_guard();

-- 3) 권한: 누구나 최근 30분 신고 읽기 + 신고 쓰기. 수정·삭제는 막힘.
alter table public.reports enable row level security;
drop policy if exists "read recent reports" on public.reports;
create policy "read recent reports" on public.reports
  for select to anon, authenticated using (created_at > now() - interval '30 minutes');
drop policy if exists "anyone can report" on public.reports;
create policy "anyone can report" on public.reports
  for insert to anon, authenticated with check (true);

-- 4) 새 신고를 실시간으로 받기
do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;

-- 5) (선택) 하루 지난 신고 자동 삭제 — Database → Extensions에서 pg_cron을 켠 뒤 실행
-- select cron.schedule('sumgil-cleanup', '0 4 * * *', $$delete from public.reports where created_at < now() - interval '1 day'$$);
