-- Beyond OS v40-83: 학부모 공개 리포트 링크 기반

create extension if not exists pgcrypto;

-- Supabase SQL Editor에서 1회 실행하세요.
-- 목적:
-- 1) 알림톡 #{리포트링크} 변수에 사용할 공개 리포트 링크 저장
-- 2) 데일리/위클리 리포트별 보안 토큰 기반 열람 URL 제공
-- 3) 기본 30일 만료 및 비활성 처리 지원

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists report_share_links (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('daily', 'weekly')),
  report_id text not null,
  token text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '30 days'),
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table report_share_links add column if not exists report_type text;
alter table report_share_links add column if not exists report_id text;
alter table report_share_links add column if not exists token text;
alter table report_share_links add column if not exists is_active boolean not null default true;
alter table report_share_links add column if not exists expires_at timestamptz not null default (now() + interval '30 days');
alter table report_share_links add column if not exists view_count integer not null default 0;
alter table report_share_links add column if not exists last_viewed_at timestamptz;
alter table report_share_links add column if not exists created_by text;
alter table report_share_links add column if not exists created_at timestamptz default now();
alter table report_share_links add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_report_share_links_token
on report_share_links(token);

create index if not exists idx_report_share_links_report
on report_share_links(report_type, report_id);

create index if not exists idx_report_share_links_active_expires
on report_share_links(is_active, expires_at);

drop trigger if exists set_timestamp_report_share_links on report_share_links;
create trigger set_timestamp_report_share_links
before update on report_share_links
for each row execute function public.set_updated_at();
