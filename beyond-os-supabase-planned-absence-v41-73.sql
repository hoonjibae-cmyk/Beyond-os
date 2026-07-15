-- Beyond OS v41-73: 결석 일정(예약 결석) 지원
-- Supabase SQL Editor에서 1회 실행하세요.
-- 학생 시간표(액티비티 블록)에 결석 일정을 넣으면 해당 날짜가 자동으로 결석 처리됩니다.

alter table student_daily_schedules add column if not exists planned_absent boolean not null default false;
alter table student_daily_schedules add column if not exists absent_reason text;
