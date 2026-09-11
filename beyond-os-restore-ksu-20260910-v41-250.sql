-- Beyond OS: 김승은 2026-09-10 세션 복구
--
-- 무엇을 되살리나
--   정리 SQL 이 잘못 지운 김승은 학생의 9월 10일 출결 기록 1건입니다.
--   키오스크 수신 로그(attendance_import_events)에 남아 있는 원본 시각으로 복원합니다.
--
--     등원   2026-09-10 20:28:05
--     외출   2026-09-10 21:21:08
--     복귀   2026-09-10 21:29:03   (외출 8분)
--     하원   2026-09-10 22:11:33
--     순공   76분  (학습 인정 구간 84분 - 외출 8분)
--
--   ※ 같은 날 00:57:55 에 찍힌 하원은 9월 9일 운영일의 퇴실이라 여기에 넣지 않습니다.
--
-- 안전장치
--   이미 그 세션이 있으면 아무것도 하지 않습니다. 여러 번 실행해도 중복 생성되지 않습니다.

-- ── 1단계: 지금 상태 확인 (먼저 이것만 실행) ─────────────────
select
  (select count(*) from daily_sessions s join students st on st.id = s.student_id
   where st.name = '김승은' and s.session_date = date '2026-09-10') as "지금 세션 수(0이어야 복구 대상)",
  (select count(*) from students where name = '김승은')             as "김승은 학생 수(1이어야 함)";

-- ── 2단계: 복구 실행 (1단계 확인 후) ─────────────────────────
with target as (
  select id as student_id from students where name = '김승은' limit 1
), created as (
  insert into daily_sessions (
    student_id, seat_no, session_date, seat_status,
    check_in_at, check_out_at, away_started_at, away_total_minutes,
    pure_study_minutes, pure_study_manual_text
  )
  select
    t.student_id, 24, date '2026-09-10', 'out',
    timestamptz '2026-09-10 20:28:05+09',
    timestamptz '2026-09-10 22:11:33+09',
    null, 8, 76, null
  from target t
  where not exists (
    select 1 from daily_sessions s
    where s.student_id = t.student_id and s.session_date = date '2026-09-10'
  )
  returning id, student_id, seat_no
)
insert into attendance_events (session_id, student_id, seat_no, event_type, event_at, memo, created_by)
select c.id, c.student_id, c.seat_no, v.event_type, v.event_at,
       '키오스크 수신 로그 기준 복구', '관리자 복구'
from created c
cross join (values
  ('check_in',  timestamptz '2026-09-10 20:28:05+09'),
  ('away',      timestamptz '2026-09-10 21:21:08+09'),
  ('return',    timestamptz '2026-09-10 21:29:03+09'),
  ('check_out', timestamptz '2026-09-10 22:11:33+09')
) as v(event_type, event_at);

-- ── 3단계: 복구 확인 ─────────────────────────────────────────
select
  st.name as "학생", s.seat_no as "좌석",
  to_char(s.check_in_at  at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "등원",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "하원",
  s.away_total_minutes as "외출(분)", s.pure_study_minutes as "순공(분)",
  (select count(*) from attendance_events e where e.session_id = s.id) as "출결기록 수"
from daily_sessions s join students st on st.id = s.student_id
where st.name = '김승은' and s.session_date = date '2026-09-10';
