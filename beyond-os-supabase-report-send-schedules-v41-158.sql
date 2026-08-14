-- Beyond OS v41-158: 리포트 예약 발송
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   데일리/위클리 리포트를 지금 바로 보내는 대신 원하는 시각에 자동 발송합니다.
--   Vercel Cron이 주기적으로 이 표를 확인해, 예약 시각이 지난 건을 발송합니다.
--
-- 설계 메모
--   - 예약할 때 리포트 본문을 복사해 두지 않고 대상(session_id / weekly_reports.id)만
--     기록합니다. 발송 시점에 최신 리포트 내용으로 나갑니다.
--     (예약해 둔 뒤 코멘트를 수정하면 수정본이 나갑니다)
--   - 실제 발송은 기존 발송 API를 그대로 통과하므로, 중복 발송 방지·수신자 결정·
--     발송 로그 기록 규칙이 즉시 발송과 완전히 동일합니다.
--   - 상태는 pending → processing → done/failed 로만 흐릅니다.
--     processing 을 거치게 해서 Cron이 겹쳐 돌아도 두 번 보내지 않습니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists report_send_schedules (
  id uuid primary key default gen_random_uuid(),
  -- daily: 데일리 리포트, weekly: 위클리 리포트
  report_type text not null check (report_type in ('daily', 'weekly')),
  -- 발송 예정 시각 (timestamptz. 화면에서는 한국시간으로 입력받습니다)
  scheduled_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'canceled')),
  -- 발송 대상. [{ id, studentName }] 형태이며 id는
  --   daily  → daily_sessions.id
  --   weekly → weekly_reports.id
  targets jsonb not null default '[]'::jsonb,
  target_count integer not null default 0,
  -- 화면 표시용 라벨 (예: "2026-08-14 데일리 24명")
  label text,
  memo text,
  -- 발송 결과 요약 { sent, failed, skipped, details: [...] }
  result jsonb,
  last_error text,
  attempts integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_by text,
  canceled_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table report_send_schedules add column if not exists report_type text;
alter table report_send_schedules add column if not exists scheduled_at timestamptz;
alter table report_send_schedules add column if not exists status text not null default 'pending';
alter table report_send_schedules add column if not exists targets jsonb not null default '[]'::jsonb;
alter table report_send_schedules add column if not exists target_count integer not null default 0;
alter table report_send_schedules add column if not exists label text;
alter table report_send_schedules add column if not exists memo text;
alter table report_send_schedules add column if not exists result jsonb;
alter table report_send_schedules add column if not exists last_error text;
alter table report_send_schedules add column if not exists attempts integer not null default 0;
alter table report_send_schedules add column if not exists started_at timestamptz;
alter table report_send_schedules add column if not exists finished_at timestamptz;
alter table report_send_schedules add column if not exists created_by text;
alter table report_send_schedules add column if not exists canceled_by text;
alter table report_send_schedules add column if not exists created_at timestamptz default now();
alter table report_send_schedules add column if not exists updated_at timestamptz default now();

-- Cron이 "보낼 때가 된 예약"을 빠르게 찾습니다.
create index if not exists idx_report_send_schedules_due
  on report_send_schedules(status, scheduled_at);

create index if not exists idx_report_send_schedules_recent
  on report_send_schedules(created_at desc);

drop trigger if exists set_timestamp_report_send_schedules on report_send_schedules;
create trigger set_timestamp_report_send_schedules
before update on report_send_schedules
for each row execute function public.set_updated_at();

comment on table report_send_schedules is '데일리/위클리 리포트 예약 발송 큐';
