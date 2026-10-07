-- Beyond OS v41-266: 다음 기수 등록불가 표시
-- Supabase SQL Editor에서 1회 실행하세요.
--
-- 무엇이 바뀌나
--   기수마다 학습 태도를 평가해 다음 기수 등록을 받지 않을 학생을 프로그램에 표시합니다.
--   좌석 패널·학생 기본정보의 이름 옆에 [다음기수 등록불가] 배지가 붙고,
--   마우스를 올리면 사유와 표시한 사람·시각이 보입니다. 입력은 로그인한 누구나 할 수 있습니다.
--
-- students 표에 칸 네 개를 더합니다. 기존 행은 전부 '해당 없음'(false)입니다.

alter table students
  add column if not exists enrollment_blocked boolean not null default false,
  add column if not exists enrollment_block_reason text,
  add column if not exists enrollment_block_updated_at timestamptz,
  add column if not exists enrollment_block_updated_by text;

comment on column students.enrollment_blocked is '다음 기수 등록불가 여부 (v41-266)';
comment on column students.enrollment_block_reason is '등록불가 상세 사유. 배지에 마우스를 올리면 보입니다.';
