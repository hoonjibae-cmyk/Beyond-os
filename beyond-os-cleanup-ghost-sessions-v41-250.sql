-- Beyond OS v41-250: 마감 직전 퇴실이 다음 날에 잘못 만든 '유령 세션' 정리
--
-- 무엇을 지우나
--   마감(새벽 1시) 직전에 찍힌 퇴실 신호가 다음 날 세션으로 들어가면서 만들어진
--   [입실 시각 = 퇴실 시각 · 순공 0분 · 순찰 기록 없음] 짜리 빈 세션입니다.
--   좌석배치도에 하루 종일 [퇴실 완료]로 남습니다.
--
--   v41-250 코드 수정으로 앞으로는 생기지 않습니다. 이 파일은 이미 생긴 것만 정리합니다.
--
-- 실행 순서
--   1) 아래 [1단계] SELECT 를 먼저 돌려 지울 대상을 눈으로 확인하세요.
--   2) 목록이 예상과 같으면 [2단계] 를 돌리세요.
--
-- 안전장치
--   · 입실 시각과 퇴실 시각이 완전히 같은 행만 봅니다. (정상 세션은 다릅니다)
--   · 순공시간 0분인 행만 봅니다.
--   · 최근 7일치만 봅니다.
--   지울 게 없으면 아무 일도 일어나지 않습니다.

-- ── 1단계: 지울 대상 확인 (먼저 이것만 실행) ──────────────────
select
  s.session_date              as "세션 날짜",
  st.name                     as "학생",
  s.seat_no                   as "좌석",
  s.check_in_at at time zone 'Asia/Seoul'  as "입실(KST)",
  s.check_out_at at time zone 'Asia/Seoul' as "퇴실(KST)",
  s.pure_study_minutes        as "순공(분)",
  s.seat_status               as "상태"
from daily_sessions s
left join students st on st.id = s.student_id
where s.check_in_at is not null
  and s.check_out_at is not null
  and s.check_in_at = s.check_out_at
  and coalesce(s.pure_study_minutes, 0) = 0
  and s.session_date >= (current_date - interval '7 days')
order by s.session_date desc, s.seat_no;

-- ── 2단계: 실제 삭제 (1단계 결과를 확인한 뒤에 실행) ──────────
-- 출결 이벤트를 먼저 지우고 세션을 지웁니다.
with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and s.check_out_at is not null
    and s.check_in_at = s.check_out_at
    and coalesce(s.pure_study_minutes, 0) = 0
    and s.session_date >= (current_date - interval '7 days')
)
delete from attendance_events
where session_id in (select id from ghost);

with ghost as (
  select s.id
  from daily_sessions s
  where s.check_in_at is not null
    and s.check_out_at is not null
    and s.check_in_at = s.check_out_at
    and coalesce(s.pure_study_minutes, 0) = 0
    and s.session_date >= (current_date - interval '7 days')
)
delete from daily_sessions
where id in (select id from ghost);
