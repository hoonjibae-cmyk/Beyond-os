-- Beyond OS v40-25: weekly_reports 발송 상태 컬럼 추가
-- 목적: 위클리 리포트도 데일리 리포트처럼 발송대기/발송완료/발송실패 상태를 저장합니다.

alter table weekly_reports
  add column if not exists send_status text default 'draft',
  add column if not exists sent_at timestamptz,
  add column if not exists sent_channel text,
  add column if not exists send_error text,
  add column if not exists send_payload jsonb,
  add column if not exists parent_phone_snapshot text;

create index if not exists idx_weekly_reports_send_status
on weekly_reports(send_status);

create index if not exists idx_weekly_reports_sent_at
on weekly_reports(sent_at);
