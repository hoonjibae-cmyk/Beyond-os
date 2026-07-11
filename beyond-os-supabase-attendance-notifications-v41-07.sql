-- Beyond OS v41-07
-- 입실/퇴실 자동 알림톡 발송 로그 테이블
-- 실행 위치: Supabase SQL Editor

create table if not exists attendance_notification_logs (
  id uuid primary key default gen_random_uuid(),
  attendance_event_id uuid references attendance_events(id) on delete set null,
  session_id uuid references daily_sessions(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  event_type text not null,
  event_at timestamptz,
  source_type text not null default 'manual',
  source_label text,
  message_text text not null,
  recipient_count integer not null default 0,
  recipient_snapshot jsonb not null default '[]'::jsonb,
  recipient_phone_snapshot text,
  send_status text not null default 'ready',
  provider text default 'kakao_send_webhook',
  provider_status text,
  request_id text,
  idempotency_key text,
  test_mode boolean not null default false,
  recipient_policy jsonb,
  provider_response jsonb,
  error_message text,
  created_by text,
  created_at timestamptz not null default now()
);

alter table attendance_notification_logs add column if not exists attendance_event_id uuid references attendance_events(id) on delete set null;
alter table attendance_notification_logs add column if not exists session_id uuid references daily_sessions(id) on delete set null;
alter table attendance_notification_logs add column if not exists student_id uuid references students(id) on delete set null;
alter table attendance_notification_logs add column if not exists event_type text not null default 'check_in';
alter table attendance_notification_logs alter column event_type drop default;
alter table attendance_notification_logs add column if not exists event_at timestamptz;
alter table attendance_notification_logs add column if not exists source_type text not null default 'manual';
alter table attendance_notification_logs add column if not exists source_label text;
alter table attendance_notification_logs add column if not exists message_text text not null default '';
alter table attendance_notification_logs alter column message_text drop default;
alter table attendance_notification_logs add column if not exists recipient_count integer not null default 0;
alter table attendance_notification_logs add column if not exists recipient_snapshot jsonb not null default '[]'::jsonb;
alter table attendance_notification_logs add column if not exists recipient_phone_snapshot text;
alter table attendance_notification_logs add column if not exists send_status text not null default 'ready';
alter table attendance_notification_logs add column if not exists provider text default 'kakao_send_webhook';
alter table attendance_notification_logs add column if not exists provider_status text;
alter table attendance_notification_logs add column if not exists request_id text;
alter table attendance_notification_logs add column if not exists idempotency_key text;
alter table attendance_notification_logs add column if not exists test_mode boolean not null default false;
alter table attendance_notification_logs add column if not exists recipient_policy jsonb;
alter table attendance_notification_logs add column if not exists provider_response jsonb;
alter table attendance_notification_logs add column if not exists error_message text;
alter table attendance_notification_logs add column if not exists created_by text;
alter table attendance_notification_logs add column if not exists created_at timestamptz not null default now();

create unique index if not exists idx_attendance_notification_logs_idempotency
  on attendance_notification_logs(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_attendance_notification_logs_created_at
  on attendance_notification_logs(created_at desc);

create index if not exists idx_attendance_notification_logs_student_date
  on attendance_notification_logs(student_id, event_at desc);

create index if not exists idx_attendance_notification_logs_status
  on attendance_notification_logs(send_status, created_at desc);

create index if not exists idx_attendance_notification_logs_event_type
  on attendance_notification_logs(event_type, created_at desc);

comment on table attendance_notification_logs is 'Beyond OS v41-07 입실/퇴실 자동 알림톡 발송 로그';
comment on column attendance_notification_logs.source_type is 'manual 또는 kiosk 등 출결 기록 방식';
comment on column attendance_notification_logs.test_mode is '리포트 발송 설정의 테스트모드 적용 여부';
comment on column attendance_notification_logs.idempotency_key is '동일 입실/퇴실 이벤트 중복 발송 방지 키';
