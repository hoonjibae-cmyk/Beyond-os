-- Beyond OS v41-10
-- 학생별 출결 알림 제외 설정 테이블
-- 실행 위치: Supabase SQL Editor

create table if not exists student_attendance_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  exclude_check_in boolean not null default false,
  exclude_check_out boolean not null default false,
  exclude_away boolean not null default false,
  exclude_return boolean not null default false,
  exclude_return_overdue boolean not null default false,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table student_attendance_notification_preferences add column if not exists student_id uuid references students(id) on delete cascade;
alter table student_attendance_notification_preferences add column if not exists exclude_check_in boolean not null default false;
alter table student_attendance_notification_preferences add column if not exists exclude_check_out boolean not null default false;
alter table student_attendance_notification_preferences add column if not exists exclude_away boolean not null default false;
alter table student_attendance_notification_preferences add column if not exists exclude_return boolean not null default false;
alter table student_attendance_notification_preferences add column if not exists exclude_return_overdue boolean not null default false;
alter table student_attendance_notification_preferences add column if not exists memo text;
alter table student_attendance_notification_preferences add column if not exists created_at timestamptz not null default now();
alter table student_attendance_notification_preferences add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_student_attendance_notification_preferences_student
  on student_attendance_notification_preferences(student_id);

create index if not exists idx_student_attendance_notification_preferences_updated_at
  on student_attendance_notification_preferences(updated_at desc);

comment on table student_attendance_notification_preferences is 'Beyond OS v41-10 학생별 출결 알림 제외 설정';
comment on column student_attendance_notification_preferences.exclude_check_in is '이 학생의 입실 알림 발송 제외';
comment on column student_attendance_notification_preferences.exclude_check_out is '이 학생의 퇴실 알림 발송 제외';
comment on column student_attendance_notification_preferences.exclude_away is '이 학생의 외출 알림 발송 제외';
comment on column student_attendance_notification_preferences.exclude_return is '이 학생의 복귀 알림 발송 제외';
comment on column student_attendance_notification_preferences.exclude_return_overdue is '이 학생의 복귀 지연 알림 발송 제외';
