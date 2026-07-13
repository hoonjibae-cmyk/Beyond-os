-- Beyond OS v41-61: 게시용 랭킹보드 — 학생 닉네임 + 랭킹 게시 동의
-- Supabase SQL Editor에서 1회 실행하세요. (기존 스키마 실행 후 추가)
-- 게시용(TV) 랭킹보드는 실명 대신 닉네임으로 표기하며,
-- 게시 미동의(ranking_opt_in = false) 학생은 화면에서 'XXX'로 표기됩니다.

alter table students add column if not exists nickname text;
alter table students add column if not exists ranking_opt_in boolean not null default false;

comment on column students.nickname is '게시용 랭킹보드에 표시할 닉네임 (미설정 시 XXX 처리)';
comment on column students.ranking_opt_in is '게시용 랭킹보드 노출 동의 여부 (false면 XXX로 표기)';
