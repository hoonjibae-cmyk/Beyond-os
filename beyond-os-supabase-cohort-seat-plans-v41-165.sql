-- Beyond OS v41-165: 기수별 좌석 배치 준비(초안)
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   1기가 운영 중인 동안 2기 좌석 배정을 미리 짜 둘 수 있게 합니다.
--
-- 왜 별도 표가 필요한가
--   좌석 배정은 students.default_seat_no 와 seats.current_student_id 두 곳에
--   "지금 상태"로 저장됩니다. 좌석 데이터 점검도 이 둘이 일치하는지를 봅니다.
--   그래서 미리 2기 배치를 넣으면 1기 좌석배치도와 출결 판정이 그 자리에서 바뀝니다.
--   초안은 여기에만 담아 두고, 기수가 바뀌는 날 [적용]을 눌러야 실제로 옮깁니다.
--
-- 설계 메모
--   - 한 기수 안에서 좌석 번호는 하나만, 학생도 하나만 배정되도록 막습니다.
--   - 학생이 지워지면 초안에서도 함께 빠집니다.
--   - 적용 이력(applied_at)은 기수 단위로 cohorts가 아니라 여기서 관리하지 않고,
--     적용할 때마다 작업 로그(user_action_logs)에 남깁니다.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists cohort_seat_plans (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references cohorts(id) on delete cascade,
  seat_no integer not null,
  student_id uuid references students(id) on delete cascade,
  memo text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table cohort_seat_plans add column if not exists cohort_id uuid references cohorts(id) on delete cascade;
alter table cohort_seat_plans add column if not exists seat_no integer;
alter table cohort_seat_plans add column if not exists student_id uuid references students(id) on delete cascade;
alter table cohort_seat_plans add column if not exists memo text;
alter table cohort_seat_plans add column if not exists created_by text;
alter table cohort_seat_plans add column if not exists created_at timestamptz default now();
alter table cohort_seat_plans add column if not exists updated_at timestamptz default now();

-- 한 기수에서 같은 좌석이 두 번 나오지 않게 합니다.
create unique index if not exists idx_cohort_seat_plans_seat
  on cohort_seat_plans(cohort_id, seat_no);

-- 한 기수에서 같은 학생이 두 자리를 갖지 않게 합니다. (student_id가 있을 때만)
create unique index if not exists idx_cohort_seat_plans_student
  on cohort_seat_plans(cohort_id, student_id)
  where student_id is not null;

drop trigger if exists set_timestamp_cohort_seat_plans on cohort_seat_plans;
create trigger set_timestamp_cohort_seat_plans
before update on cohort_seat_plans
for each row execute function public.set_updated_at();

comment on table cohort_seat_plans is '기수별 좌석 배치 초안 (적용 전까지 실제 좌석에 영향 없음)';
