-- Beyond OS v41-250 (2차, 수정판): 유령 세션 구분과 정리
--
-- ⚠ 이전 판은 조건이 너무 넓어 실제 출결 기록까지 목록에 올렸습니다. 쓰지 마세요.
--
-- 왜 구분이 필요한가
--   새벽 퇴실이 다음 날 세션을 잘못 만들고 나서, 그 학생이 그날 오후에 실제로
--   등원하면 같은 행에 실제 출결이 이어서 쌓입니다. 그래서 한 행 안에
--   [잘못 찍힌 새벽 입실] + [진짜 그날 출결] 이 섞여 있습니다.
--
--   이런 행은 지우면 안 됩니다. 입실 시각만 고쳐야 합니다.
--
-- 구분 기준
--   그 세션에 '하루 경계(새벽 2시) 이후' 출결 이벤트가 있는가
--     없다 → 진짜 유령. 새벽 신호만 있고 그날 오지 않았습니다. 지웁니다.
--     있다 → 실제 출결이 섞여 있습니다. 지우지 말고 입실 시각을 고칩니다.
--
-- ※ 경계 = [자동 퇴실 마감 시각] + 1시간. 현재 설정(마감 새벽 1시) 기준 새벽 2시입니다.

-- ── A) 진짜 유령 (지워도 되는 것) ─────────────────────────────
select
  s.session_date as "세션 날짜", st.name as "학생", s.seat_no as "좌석",
  to_char(s.check_in_at  at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "입실(KST)",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "퇴실(KST)",
  coalesce(s.pure_study_minutes, 0) as "순공(분)"
from daily_sessions s
left join students st on st.id = s.student_id
where s.check_in_at is not null
  and (s.check_in_at at time zone 'Asia/Seoul') >= s.session_date::timestamp
  and (s.check_in_at at time zone 'Asia/Seoul') <  (s.session_date::timestamp + interval '2 hours')
  and s.session_date >= (current_date - interval '14 days')
  and not exists (
    select 1 from attendance_events e
    where e.session_id = s.id
      and (e.event_at at time zone 'Asia/Seoul') >= (s.session_date::timestamp + interval '2 hours')
  )
order by s.session_date desc, s.seat_no;

-- ── B) 실제 출결이 섞인 세션 (지우지 말 것 · 입실 시각만 고치기) ──
-- 아래 "실제 첫 등원" 시각이 그날 진짜로 온 시각입니다.
-- 화면에서 해당 좌석 → [출결시간 조정] 으로 입실 시각을 이 값으로 바꾸고,
-- 외출 누적은 실제 외출만 남도록 조정하세요.
select
  s.session_date as "세션 날짜", st.name as "학생", s.seat_no as "좌석",
  to_char(s.check_in_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "지금 입실(잘못됨)",
  to_char(
    (select min(e.event_at) from attendance_events e
     where e.session_id = s.id and e.event_type = 'check_in'
       and (e.event_at at time zone 'Asia/Seoul') >= (s.session_date::timestamp + interval '2 hours'))
    at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "실제 첫 등원",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "퇴실(KST)",
  coalesce(s.away_total_minutes, 0) as "외출 누적(분·부풀려짐)",
  coalesce(s.pure_study_minutes, 0) as "순공(분)"
from daily_sessions s
left join students st on st.id = s.student_id
where s.check_in_at is not null
  and (s.check_in_at at time zone 'Asia/Seoul') >= s.session_date::timestamp
  and (s.check_in_at at time zone 'Asia/Seoul') <  (s.session_date::timestamp + interval '2 hours')
  and s.session_date >= (current_date - interval '14 days')
  and exists (
    select 1 from attendance_events e
    where e.session_id = s.id
      and (e.event_at at time zone 'Asia/Seoul') >= (s.session_date::timestamp + interval '2 hours')
  )
order by s.session_date desc, s.seat_no;

-- ── C) 삭제 ── ⚠ 실행하지 마세요 (2026-09-11 사용 중지) ───────
--
-- 이 조건은 '경계 이후 출결 이벤트가 있는가' 로 유령을 가렸는데,
-- 이벤트의 event_at 이 비어 있으면 비교가 참이 되지 않아 '이벤트 없음'으로
-- 판정됩니다. 그 탓에 실제 출결 기록(김승은 9/10)을 지웠습니다.
--
-- 남은 건들은 지울 대상이 아니라 '입실 시각만 고칠 대상' 입니다.
-- A·B 조회는 그대로 쓰셔도 되고, 삭제는 아래를 쓰지 마세요.
-- 필요하시면 event_at 누락까지 처리한 판을 다시 만들어 드리겠습니다.
--
-- 아래는 기록용으로만 남깁니다. 실행하려면 주석을 직접 풀어야 합니다.
/*

with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and (s.check_in_at at time zone 'Asia/Seoul') >= s.session_date::timestamp
    and (s.check_in_at at time zone 'Asia/Seoul') <  (s.session_date::timestamp + interval '2 hours')
    and s.session_date >= (current_date - interval '14 days')
    and not exists (
      select 1 from attendance_events e
      where e.session_id = s.id
        and (e.event_at at time zone 'Asia/Seoul') >= (s.session_date::timestamp + interval '2 hours')
    )
)
delete from attendance_events where session_id in (select id from ghost);

with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and (s.check_in_at at time zone 'Asia/Seoul') >= s.session_date::timestamp
    and (s.check_in_at at time zone 'Asia/Seoul') <  (s.session_date::timestamp + interval '2 hours')
    and s.session_date >= (current_date - interval '14 days')
    and not exists (
      select 1 from attendance_events e
      where e.session_id = s.id
        and (e.event_at at time zone 'Asia/Seoul') >= (s.session_date::timestamp + interval '2 hours')
    )
)
delete from daily_sessions where id in (select id from ghost);
*/
