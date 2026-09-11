-- Beyond OS: 김승은 2026-09-10 세션 복구 (2판 · 이름 매칭에 의존하지 않음)
--
-- 1판은 students.name = '김승은' 으로 학생을 찾았습니다. 이름에 공백이 있거나
-- 표기가 다르면 아무것도 못 찾고 조용히 끝납니다. 이번에는 키오스크 수신 로그에
-- 이미 연결돼 있는 student_id 를 그대로 씁니다.

-- ══════════════════════════════════════════════════════════════
-- 1단계: 진단 — 먼저 이것만 실행해서 결과를 확인하세요
-- ══════════════════════════════════════════════════════════════
select 'A) 이름이 정확히 김승은인 학생 수' as "구분",
       (select count(*)::text from students where name = '김승은') as "값"
union all
select 'B) 이름에 김승은이 포함된 학생',
       coalesce((select string_agg('[' || name || ']', ' , ') from students where name like '%김승은%'), '없음')
union all
select 'C) 로그에서 찾은 student_id',
       coalesce((select student_id::text from attendance_import_events
                 where parsed_student_name like '%김승은%' and student_id is not null
                 order by created_at desc limit 1), '없음')
union all
select 'D) 그 학생의 9/10 세션',
       coalesce((select s.id::text from daily_sessions s
                 where s.student_id = (select student_id from attendance_import_events
                                       where parsed_student_name like '%김승은%' and student_id is not null
                                       order by created_at desc limit 1)
                   and s.session_date = date '2026-09-10' limit 1), '없음(복구 대상)')
union all
select 'E) 좌석번호(로그 기준)',
       coalesce((select seat_no::text from attendance_import_events
                 where parsed_student_name like '%김승은%' and seat_no is not null
                 order by created_at desc limit 1), '없음');

-- ══════════════════════════════════════════════════════════════
-- 2단계: 복구 — 1단계에서 C 가 나오고 D 가 '없음(복구 대상)' 일 때만 실행
-- ══════════════════════════════════════════════════════════════
--   등원 20:28:05 / 외출 21:21:08 / 복귀 21:29:03 / 하원 22:11:33
--   외출 8분 · 순공 76분
--   ※ 같은 날 00:57:55 하원은 9/9 운영일 것이라 넣지 않습니다.
--   여러 번 실행해도 중복 생성되지 않습니다.

with target as (
  select
    (select student_id from attendance_import_events
      where parsed_student_name like '%김승은%' and student_id is not null
      order by created_at desc limit 1) as student_id,
    coalesce((select seat_no from attendance_import_events
      where parsed_student_name like '%김승은%' and seat_no is not null
      order by created_at desc limit 1), 24) as seat_no
), created as (
  insert into daily_sessions (
    student_id, seat_no, session_date, seat_status,
    check_in_at, check_out_at, away_started_at, away_total_minutes, pure_study_minutes
  )
  select t.student_id, t.seat_no, date '2026-09-10', 'out',
         timestamptz '2026-09-10 20:28:05+09',
         timestamptz '2026-09-10 22:11:33+09',
         null, 8, 76
  from target t
  where t.student_id is not null
    and not exists (
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

-- ══════════════════════════════════════════════════════════════
-- 3단계: 복구 확인
-- ══════════════════════════════════════════════════════════════
select st.name as "학생", s.seat_no as "좌석",
  to_char(s.check_in_at  at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "등원",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "하원",
  s.away_total_minutes as "외출(분)", s.pure_study_minutes as "순공(분)",
  (select count(*) from attendance_events e where e.session_id = s.id) as "출결기록 수"
from daily_sessions s left join students st on st.id = s.student_id
where s.session_date = date '2026-09-10'
  and s.student_id = (select student_id from attendance_import_events
                      where parsed_student_name like '%김승은%' and student_id is not null
                      order by created_at desc limit 1);
