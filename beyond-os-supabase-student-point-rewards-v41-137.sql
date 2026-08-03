-- Beyond OS v41-137: 상벌점 상품 지급(리셋) 이력
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   순점수(상점-벌점)가 기준점(기본 10점)을 초과하면 "상품 지급 대상" 알림이 뜹니다.
--   운영자가 [상품지급안내완료]를 누르면 그 시점 이후로 카운팅을 다시 0부터 시작하고(리셋),
--   [미지급]을 누르면 리셋 없이 계속 누적하되 추가로 기준점을 넘을 때까지 알림을 잠시 끕니다.
--
--   상벌점 원본(student_points)은 절대 지우지 않습니다. 이 테이블은 "언제 어떤 상태에서
--   리셋/보류했는지"만 기록하며, 그 시점의 상벌점 스냅샷을 함께 보관해 이력 조회에 사용합니다.
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

create table if not exists student_point_rewards (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  -- granted: 상품지급안내완료(카운팅 리셋) / deferred: 미지급(계속 누적)
  action text not null check (action in ('granted', 'deferred')),
  net_points integer not null default 0,
  reward_points integer not null default 0,
  penalty_points integer not null default 0,
  entry_count integer not null default 0,
  threshold integer not null default 10,
  -- 이번 사이클이 시작된 시각(직전 granted 시각). 최초 사이클이면 null
  cycle_start_at timestamptz,
  -- 처리 당시 상벌점 내역 스냅샷 (리포트/이력에 조그맣게 계속 표시)
  snapshot jsonb,
  memo text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table student_point_rewards add column if not exists student_id text;
alter table student_point_rewards add column if not exists action text;
alter table student_point_rewards add column if not exists net_points integer not null default 0;
alter table student_point_rewards add column if not exists reward_points integer not null default 0;
alter table student_point_rewards add column if not exists penalty_points integer not null default 0;
alter table student_point_rewards add column if not exists entry_count integer not null default 0;
alter table student_point_rewards add column if not exists threshold integer not null default 10;
alter table student_point_rewards add column if not exists cycle_start_at timestamptz;
alter table student_point_rewards add column if not exists snapshot jsonb;
alter table student_point_rewards add column if not exists memo text;
alter table student_point_rewards add column if not exists created_by text;
alter table student_point_rewards add column if not exists created_at timestamptz default now();
alter table student_point_rewards add column if not exists updated_at timestamptz default now();

create index if not exists idx_student_point_rewards_student
on student_point_rewards(student_id, created_at desc);

create index if not exists idx_student_point_rewards_action
on student_point_rewards(student_id, action, created_at desc);

drop trigger if exists set_timestamp_student_point_rewards on student_point_rewards;
create trigger set_timestamp_student_point_rewards
before update on student_point_rewards
for each row execute function public.set_updated_at();
