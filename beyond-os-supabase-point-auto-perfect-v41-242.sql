-- Beyond OS v41-242: 주간 개근 자동 상점
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- v41-241 SQL을 이미 실행했든 아직 안 했든, 이 파일 하나만 실행하면 됩니다.
-- (v41-241의 표 정의를 그대로 포함하고, 그 위에 이번 변경분을 얹습니다)
--
-- 무엇이 바뀌나
--   주간 순공시간 구간 상점과 별개로 "주간 개근 상점"이 생깁니다. 같은 주에 둘 다
--   받을 수 있어야 하므로, 자동 상점 한 줄에 종류(award_kind)를 붙이고 중복 방지
--   기준을 (학생, 주) 에서 (학생, 주, 종류) 로 넓힙니다.
--
--     award_kind = 'study'    주간 순공시간 구간 상점
--     award_kind = 'perfect'  주간 개근 상점
--
-- 주의: student_points.student_id 가 text 타입이므로 여기서도 text로 맞춥니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── 1) 자동 상점 부여 내역 ───────────────────────────────────
create table if not exists student_point_auto_awards (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  -- 상점 종류: 'study'(주간 순공 구간) / 'perfect'(주간 개근)
  award_kind text not null default 'study',
  -- 집계한 주 (월요일 ~ 일요일)
  week_start date not null,
  week_end date not null,
  -- 실제로 배치를 돌린 날짜 (보통 week_end 다음 월요일)
  run_date date not null,
  -- 그 주 순공시간 합계(분)
  study_minutes integer not null default 0,
  -- 걸린 구간의 기준 시간(분)과 이름. 개근 상점이면 일일 최소 순공시간이 들어갑니다.
  tier_min_minutes integer not null default 0,
  tier_label text,
  -- 실제로 준 상점
  points integer not null default 0,
  -- 함께 만들어진 student_points 행 id
  point_id uuid,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_point_auto_awards add column if not exists student_id text;
alter table student_point_auto_awards add column if not exists award_kind text not null default 'study';
alter table student_point_auto_awards add column if not exists week_start date;
alter table student_point_auto_awards add column if not exists week_end date;
alter table student_point_auto_awards add column if not exists run_date date;
alter table student_point_auto_awards add column if not exists study_minutes integer not null default 0;
alter table student_point_auto_awards add column if not exists tier_min_minutes integer not null default 0;
alter table student_point_auto_awards add column if not exists tier_label text;
alter table student_point_auto_awards add column if not exists points integer not null default 0;
alter table student_point_auto_awards add column if not exists point_id uuid;
alter table student_point_auto_awards add column if not exists created_by text;
alter table student_point_auto_awards add column if not exists created_at timestamptz default now();
alter table student_point_auto_awards add column if not exists updated_at timestamptz default now();

-- 이미 들어간 줄이 있으면 순공 구간 상점으로 봅니다. (v41-242 이전에는 그것뿐이었습니다)
update student_point_auto_awards set award_kind = 'study' where award_kind is null or award_kind = '';

-- v41-241의 (학생, 주) 유니크를 (학생, 주, 종류) 로 넓힙니다.
-- 이 인덱스가 남아 있으면 같은 주에 개근 상점을 넣을 수 없습니다.
drop index if exists idx_student_point_auto_awards_week;

create unique index if not exists idx_student_point_auto_awards_week_kind
on student_point_auto_awards(student_id, week_start, award_kind);

create index if not exists idx_student_point_auto_awards_run
on student_point_auto_awards(run_date desc, student_id);

drop trigger if exists set_timestamp_student_point_auto_awards on student_point_auto_awards;
create trigger set_timestamp_student_point_auto_awards
before update on student_point_auto_awards
for each row execute function public.set_updated_at();

-- ── 2) 주간 순점수 스캔 결과 (v41-241과 동일) ────────────────
create table if not exists student_point_weekly_scans (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  scan_date date not null,
  week_start date not null,
  week_end date not null,
  threshold integer not null default 15,
  net_points integer not null default 0,
  reward_points integer not null default 0,
  penalty_points integer not null default 0,
  entry_count integer not null default 0,
  study_minutes integer not null default 0,
  auto_points integer not null default 0,
  is_eligible boolean not null default false,
  streak_weeks integer not null default 0,
  handled_at timestamptz,
  handled_action text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_point_weekly_scans add column if not exists student_id text;
alter table student_point_weekly_scans add column if not exists scan_date date;
alter table student_point_weekly_scans add column if not exists week_start date;
alter table student_point_weekly_scans add column if not exists week_end date;
alter table student_point_weekly_scans add column if not exists threshold integer not null default 15;
alter table student_point_weekly_scans add column if not exists net_points integer not null default 0;
alter table student_point_weekly_scans add column if not exists reward_points integer not null default 0;
alter table student_point_weekly_scans add column if not exists penalty_points integer not null default 0;
alter table student_point_weekly_scans add column if not exists entry_count integer not null default 0;
alter table student_point_weekly_scans add column if not exists study_minutes integer not null default 0;
alter table student_point_weekly_scans add column if not exists auto_points integer not null default 0;
alter table student_point_weekly_scans add column if not exists is_eligible boolean not null default false;
alter table student_point_weekly_scans add column if not exists streak_weeks integer not null default 0;
alter table student_point_weekly_scans add column if not exists handled_at timestamptz;
alter table student_point_weekly_scans add column if not exists handled_action text;
alter table student_point_weekly_scans add column if not exists created_at timestamptz default now();
alter table student_point_weekly_scans add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_student_point_weekly_scans_key
on student_point_weekly_scans(student_id, scan_date);

create index if not exists idx_student_point_weekly_scans_scan
on student_point_weekly_scans(scan_date desc, is_eligible);

create index if not exists idx_student_point_weekly_scans_student
on student_point_weekly_scans(student_id, scan_date desc);

drop trigger if exists set_timestamp_student_point_weekly_scans on student_point_weekly_scans;
create trigger set_timestamp_student_point_weekly_scans
before update on student_point_weekly_scans
for each row execute function public.set_updated_at();
