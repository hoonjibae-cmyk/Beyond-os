-- Beyond OS v41-241: 주간 순공 자동 상점 + 상품 지급 주간 스캔
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 무엇이 바뀌나
--   1) 매주 월요일 06:00(KST)에 지난 월~일 순공시간을 집계해 구간표대로 상점을 일괄 부여합니다.
--      부여 결과는 student_point_auto_awards 에 한 줄씩 남습니다.
--   2) 같은 시각에 전체 학생 순점수를 한 번 스캔해 상품 지급 대상 명단을 만듭니다.
--      결과는 student_point_weekly_scans 에 학생 × 스캔일 한 줄로 남습니다.
--      (예전처럼 화면을 열 때마다 실시간으로 판정하지 않습니다)
--
-- 상벌점 원본(student_points)은 그대로입니다. 자동 상점도 일반 상점과 같은 표에
-- 들어가며, created_by 가 '시스템 자동'으로 기록됩니다. 아래 두 표는 "언제 무슨
-- 근거로 넣었는지"와 "그 주 스캔 결과"만 따로 보관합니다.
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
  -- 집계한 주 (월요일 ~ 일요일)
  week_start date not null,
  week_end date not null,
  -- 실제로 배치를 돌린 날짜 (보통 week_end 다음 월요일)
  run_date date not null,
  -- 그 주 순공시간 합계(분)
  study_minutes integer not null default 0,
  -- 걸린 구간의 기준 시간(분)과 이름
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

-- 한 학생에게 같은 주 상점이 두 번 들어가지 않게 막습니다.
-- 배치를 다시 돌려도(수동 재실행 포함) 두 번째부터는 조용히 건너뜁니다.
create unique index if not exists idx_student_point_auto_awards_week
on student_point_auto_awards(student_id, week_start);

create index if not exists idx_student_point_auto_awards_run
on student_point_auto_awards(run_date desc, student_id);

drop trigger if exists set_timestamp_student_point_auto_awards on student_point_auto_awards;
create trigger set_timestamp_student_point_auto_awards
before update on student_point_auto_awards
for each row execute function public.set_updated_at();

-- ── 2) 주간 순점수 스캔 결과 ─────────────────────────────────
create table if not exists student_point_weekly_scans (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  -- 스캔을 돌린 날짜 (월요일)
  scan_date date not null,
  -- 그때 집계 대상이었던 주
  week_start date not null,
  week_end date not null,
  -- 판정에 쓴 기준 순점수
  threshold integer not null default 15,
  net_points integer not null default 0,
  reward_points integer not null default 0,
  penalty_points integer not null default 0,
  entry_count integer not null default 0,
  -- 그 주 순공시간과 자동으로 받은 상점 (명단에서 함께 보여줍니다)
  study_minutes integer not null default 0,
  auto_points integer not null default 0,
  -- 기준 초과 여부
  is_eligible boolean not null default false,
  -- 몇 주 연속으로 대상에 올랐는지. 대상이 아니면 0입니다.
  streak_weeks integer not null default 0,
  -- 이 명단 건을 처리한 시각/방식 (granted = 알림톡 발송, deferred = 미지급).
  --
  -- is_eligible 과 반드시 따로 둡니다. is_eligible 은 "그 월요일에 기준을 넘었는가"라는
  -- 사실이라 나중에 바뀌면 안 됩니다. 연속 주 수는 이 값으로 셉니다.
  -- 처리 여부는 handled_at 으로만 판단하며, 화면 명단에서는 처리한 건을 내립니다.
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

-- 같은 학생 × 같은 스캔일은 한 줄. 다시 돌리면 덮어씁니다.
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
