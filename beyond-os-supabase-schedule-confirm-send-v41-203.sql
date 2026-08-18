-- Beyond OS v41-203: 학부모 시간표 확인 링크 알림톡 발송 기록
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 목적
--   확인 링크를 알림톡으로 언제 누구에게 보냈는지 남깁니다.
--   두 번 보내는 실수를 줄이고, 학부모가 "못 받았다"고 할 때 확인할 근거가 됩니다.
--
-- 실행하지 않아도 발송 자체는 동작합니다. (기록만 남지 않습니다)

alter table schedule_confirmations add column if not exists sent_at timestamptz;
alter table schedule_confirmations add column if not exists last_send_summary jsonb;

comment on column schedule_confirmations.sent_at is '확인 링크를 알림톡으로 마지막에 보낸 시각';
comment on column schedule_confirmations.last_send_summary is '마지막 알림톡 발송 요약 (수신자 수·마스킹된 번호·상태)';

create index if not exists idx_schedule_confirmations_sent_at
  on schedule_confirmations(sent_at desc);
