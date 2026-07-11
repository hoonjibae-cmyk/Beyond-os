-- Beyond OS v31: 데일리 리포트 카카오 발송 워크플로우
-- 실제 알림톡/비즈메시지 연동 전에도 발송 준비/대기/성공/실패 상태를 저장할 수 있도록 보강합니다.

alter table daily_reports add column if not exists sent_at timestamptz;
alter table daily_reports add column if not exists send_error text;
alter table daily_reports add column if not exists send_payload jsonb;
alter table daily_reports add column if not exists parent_phone_snapshot text;
alter table daily_reports add column if not exists planner_image_url_snapshot text;

create table if not exists report_send_logs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references daily_reports(id) on delete cascade,
  session_id uuid references daily_sessions(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  action text not null default 'prepare',
  status text not null default 'ready',
  recipient_phone text,
  message_text text,
  planner_image_url text,
  provider text default 'kakao_pending',
  provider_response jsonb,
  error_message text,
  created_by text,
  created_at timestamptz default now()
);

create index if not exists idx_report_send_logs_report_id on report_send_logs(report_id);
create index if not exists idx_report_send_logs_session_id on report_send_logs(session_id);
create index if not exists idx_report_send_logs_created_at on report_send_logs(created_at);
