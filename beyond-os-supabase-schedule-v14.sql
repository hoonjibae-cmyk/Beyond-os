
-- Beyond OS v14 수정본: 학생별 시간표 / 시간표 기반 알림 로그
-- Supabase SQL Editor에서 기존 스키마 실행 후 추가로 실행하세요.
-- v14의 trigger_set_timestamp() 오류를 수정한 버전입니다.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists student_daily_schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  schedule_date date not null,
  planned_check_in time,
  planned_check_out time,
  parent_confirmed boolean default false,
  confirmation_note text,
  schedule_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(student_id, schedule_date)
);

create table if not exists student_schedule_breaks (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references student_daily_schedules(id) on delete cascade,
  leave_start time not null,
  return_time time,
  reason text not null default '기타',
  reason_detail text,
  break_note text,
  created_at timestamptz default now()
);

create table if not exists parent_notification_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete set null,
  schedule_id uuid references student_daily_schedules(id) on delete set null,
  break_id uuid references student_schedule_breaks(id) on delete set null,
  notification_type text not null,
  message_text text not null,
  send_status text not null default 'draft',
  sent_channel text default 'kakao_pending',
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_student_daily_schedules_date 
on student_daily_schedules(schedule_date);

create index if not exists idx_student_daily_schedules_student_date 
on student_daily_schedules(student_id, schedule_date);

create index if not exists idx_student_schedule_breaks_schedule 
on student_schedule_breaks(schedule_id);

create index if not exists idx_parent_notification_logs_student 
on parent_notification_logs(student_id);

create index if not exists idx_parent_notification_logs_created_at 
on parent_notification_logs(created_at);

drop trigger if exists set_timestamp_student_daily_schedules 
on student_daily_schedules;

create trigger set_timestamp_student_daily_schedules
before update on student_daily_schedules
for each row execute function public.set_updated_at();
