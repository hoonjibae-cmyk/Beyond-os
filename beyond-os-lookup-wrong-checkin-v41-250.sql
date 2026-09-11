-- Beyond OS: 입실 시각이 잘못 찍힌 세션의 '실제 등원 시각' 찾기
--
-- 읽기 전용입니다. 아무것도 바꾸지 않습니다.
--
-- 새벽 퇴실이 다음 날 세션을 잘못 만든 뒤 그날 오후에 학생이 실제로 등원하면,
-- 입실 시각이 새벽 값으로 남고 그 사이가 통째로 외출로 잡힙니다.
-- 아래에서 [지금 입실]과 [로그의 실제 등원]을 비교하고, 실제 값으로 고치면 됩니다.
--
-- ※ 경계 = [자동 퇴실 마감 시각] + 1시간. 현재 설정(마감 새벽 1시) 기준 새벽 2시.

select
  s.session_date                                   as "세션 날짜",
  st.name                                          as "학생",
  s.seat_no                                        as "좌석",
  to_char(s.check_in_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "지금 입실(잘못됨)",
  -- 키오스크 수신 로그에서 그 운영일의 첫 '도착' 신호
  to_char(
    (select min(coalesce(i.received_at, i.created_at))
       from attendance_import_events i
      where i.student_id = s.student_id
        and i.parsed_event_type = 'check_in'
        and (coalesce(i.received_at, i.created_at) at time zone 'Asia/Seoul')
            >= (s.session_date::timestamp + interval '2 hours')
        and (coalesce(i.received_at, i.created_at) at time zone 'Asia/Seoul')
            <  (s.session_date::timestamp + interval '1 day' + interval '2 hours'))
    at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS')  as "로그의 실제 등원",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as "지금 퇴실",
  coalesce(s.away_total_minutes, 0)                as "외출 누적(부풀려짐)",
  coalesce(s.pure_study_minutes, 0)                as "지금 순공(분)"
from daily_sessions s
left join students st on st.id = s.student_id
where s.check_in_at is not null
  and (s.check_in_at at time zone 'Asia/Seoul') >= s.session_date::timestamp
  and (s.check_in_at at time zone 'Asia/Seoul') <  (s.session_date::timestamp + interval '2 hours')
  and s.session_date >= (current_date - interval '30 days')
order by s.session_date desc, s.seat_no;
