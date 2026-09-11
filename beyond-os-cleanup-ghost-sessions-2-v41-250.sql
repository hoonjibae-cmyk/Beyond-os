-- Beyond OS v41-250 (2차): 새벽 시간대에만 존재하는 '유령 세션' 정리
--
-- 1차 정리(beyond-os-cleanup-ghost-sessions-v41-250.sql)는 [입실 시각 = 퇴실 시각]
-- 인 행만 지웠습니다. 그런데 00:34에 퇴실 신호가 유령 세션을 만든 뒤 01:06에 신호가
-- 한 번 더 들어오면 두 시각이 벌어져서 조건에 걸리지 않습니다.
--
-- 이 파일은 더 정확한 기준을 씁니다.
--
--   "그 세션의 등원 기록이, 세션 날짜 당일의 하루 경계(새벽 2시) 이전에 찍혀 있다"
--
-- 이건 정상적으로는 생길 수 없습니다. 그 시간대에는 운영일이 아직 '전날'이라
-- 모든 기록이 전날 세션으로 들어가야 하기 때문입니다. 9월 11일 세션인데 입실이
-- 9월 11일 00:34 로 찍혀 있다면, 그것은 9월 10일 운영일의 기록이 잘못 들어간 것입니다.
--
-- ※ 하루 경계 = [자동 퇴실 마감 시각] + 1시간. 현재 설정(마감 새벽 1시) 기준 새벽 2시입니다.
--    마감을 바꾸셨다면 아래 interval '2 hours' 를 그에 맞게 고치세요.
--
-- 실행 순서
--   1) [1단계] SELECT 로 대상을 눈으로 확인
--   2) 맞으면 [2단계] 실행

-- ── 1단계: 지울 대상 확인 (먼저 이것만 실행) ──────────────────
select
  s.session_date                            as "세션 날짜",
  st.name                                   as "학생",
  s.seat_no                                 as "좌석",
  to_char(s.check_in_at  at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "입실(KST)",
  to_char(s.check_out_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as "퇴실(KST)",
  coalesce(s.pure_study_minutes, 0)         as "순공(분)",
  coalesce(s.away_total_minutes, 0)         as "외출(분)",
  s.seat_status                             as "상태"
from daily_sessions s
left join students st on st.id = s.student_id
where s.check_in_at is not null
  -- 등원 기록이 '세션 날짜 당일의 경계 이전'에 찍힌 경우
  and (s.check_in_at at time zone 'Asia/Seoul')
      <  (s.session_date::timestamp + interval '2 hours')
  and (s.check_in_at at time zone 'Asia/Seoul')
      >= s.session_date::timestamp
  and s.session_date >= (current_date - interval '7 days')
order by s.session_date desc, s.seat_no;

-- ── 2단계: 실제 삭제 (1단계 결과를 확인한 뒤에 실행) ──────────
with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and (s.check_in_at at time zone 'Asia/Seoul')
        <  (s.session_date::timestamp + interval '2 hours')
    and (s.check_in_at at time zone 'Asia/Seoul')
        >= s.session_date::timestamp
    and s.session_date >= (current_date - interval '7 days')
)
delete from attendance_events
where session_id in (select id from ghost);

with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and (s.check_in_at at time zone 'Asia/Seoul')
        <  (s.session_date::timestamp + interval '2 hours')
    and (s.check_in_at at time zone 'Asia/Seoul')
        >= s.session_date::timestamp
    and s.session_date >= (current_date - interval '7 days')
)
delete from daily_sessions
where id in (select id from ghost);
