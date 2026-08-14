-- Beyond OS v41-156: 벌점 누적 단계별 조치 기록
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   누적 벌점이 10 / 20 / 30점을 초과할 때 단계별 알림을 띄우고,
--   그 단계에 대해 어떤 조치를 했는지 기록합니다.
--     10점 초과 → 학부모 알림(경고성)
--     20점 초과 → 센터장 면담
--     30점 초과 → 제적 검토
--
-- 설계 메모
--   - 상벌점 원본(student_points)은 건드리지 않습니다.
--   - 상품 지급(student_point_rewards)의 리셋과는 무관하게 동작합니다.
--     상점을 많이 받아 순점수가 리셋되어도 누적 벌점 단계는 그대로 남습니다.
--   - 한 단계에 여러 번 기록될 수 있고(보류 → 나중에 완료), 계산할 때
--     'done'이 있으면 완료로 봅니다.
--
-- 주의: student_points.student_id 가 text 타입이므로 여기서도 text로 맞춥니다.

create extension if not exists pgcrypto;

create table if not exists student_penalty_actions (
  id uuid primary key default gen_random_uuid(),
  student_id text not null,
  -- 10 / 20 / 30
  stage integer not null,
  -- done: 조치 완료(알림 내림), deferred: 보류(알림 유지)
  action text not null default 'done' check (action in ('done', 'deferred')),
  -- 조치 시점의 누적 벌점 (나중에 되짚어 볼 수 있도록 남깁니다)
  penalty_points integer not null default 0,
  memo text,
  created_by text,
  created_at timestamptz default now()
);

alter table student_penalty_actions add column if not exists student_id text;
alter table student_penalty_actions add column if not exists stage integer;
alter table student_penalty_actions add column if not exists action text not null default 'done';
alter table student_penalty_actions add column if not exists penalty_points integer not null default 0;
alter table student_penalty_actions add column if not exists memo text;
alter table student_penalty_actions add column if not exists created_by text;
alter table student_penalty_actions add column if not exists created_at timestamptz default now();

create index if not exists idx_student_penalty_actions_student
  on student_penalty_actions(student_id, created_at desc);

create index if not exists idx_student_penalty_actions_stage
  on student_penalty_actions(student_id, stage, created_at desc);

comment on table student_penalty_actions is '벌점 누적 단계(10/20/30점 초과)별 조치 기록';
