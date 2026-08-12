-- Beyond OS v41-151: 학부모 시간표 최종 확인
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   설문으로 받은 등하원 시간표를 학생별 공개 링크로 보내 학부모가 최종 확인하거나
--   그 자리에서 수정 요청할 수 있게 합니다.
--
-- 설계 메모
--   - 링크는 토큰으로만 열립니다. (로그인 불필요, 학생 한 명 정보만 노출)
--   - 학부모가 제출한 내용은 곧바로 시간표에 반영하지 않고 response에 담아 둡니다.
--     관리자가 확인한 뒤 [반영]을 눌러야 실제 개인 시간표가 바뀝니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists schedule_confirmations (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  student_id uuid not null references students(id) on delete cascade,
  cohort_id uuid references cohorts(id) on delete set null,
  start_date date not null,
  end_date date not null,
  -- pending: 발송 전/대기, confirmed: 그대로 확인, change_requested: 수정 요청
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'change_requested')),
  -- 학부모에게 보여준 요일별 시간표
  snapshot jsonb not null default '{}'::jsonb,
  -- 학부모가 제출한 요일별 시간표(수정 요청 시)
  response jsonb,
  parent_note text,
  confirmed_by text,
  confirmed_at timestamptz,
  -- 관리자가 실제 시간표에 반영한 시각
  applied_at timestamptz,
  applied_by text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table schedule_confirmations add column if not exists token text;
alter table schedule_confirmations add column if not exists student_id uuid references students(id) on delete cascade;
alter table schedule_confirmations add column if not exists cohort_id uuid references cohorts(id) on delete set null;
alter table schedule_confirmations add column if not exists start_date date;
alter table schedule_confirmations add column if not exists end_date date;
alter table schedule_confirmations add column if not exists status text not null default 'pending';
alter table schedule_confirmations add column if not exists snapshot jsonb not null default '{}'::jsonb;
alter table schedule_confirmations add column if not exists response jsonb;
alter table schedule_confirmations add column if not exists parent_note text;
alter table schedule_confirmations add column if not exists confirmed_by text;
alter table schedule_confirmations add column if not exists confirmed_at timestamptz;
alter table schedule_confirmations add column if not exists applied_at timestamptz;
alter table schedule_confirmations add column if not exists applied_by text;
alter table schedule_confirmations add column if not exists created_by text;
alter table schedule_confirmations add column if not exists created_at timestamptz default now();
alter table schedule_confirmations add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_schedule_confirmations_token
  on schedule_confirmations(token);

-- 같은 학생·같은 기간의 확인 요청은 하나만 유지합니다.
create unique index if not exists idx_schedule_confirmations_student_range
  on schedule_confirmations(student_id, start_date, end_date);

create index if not exists idx_schedule_confirmations_status
  on schedule_confirmations(status, updated_at desc);

drop trigger if exists set_timestamp_schedule_confirmations on schedule_confirmations;
create trigger set_timestamp_schedule_confirmations
before update on schedule_confirmations
for each row execute function public.set_updated_at();

comment on table schedule_confirmations is '학부모 시간표 최종 확인 요청 및 응답';
