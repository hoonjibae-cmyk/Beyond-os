-- Beyond OS v41-83: 학생 기본정보 탭 — 관리자 특이사항(자유 기재) 컬럼
-- students 테이블에 관리자가 직접 기재하는 특이사항 메모 컬럼을 추가합니다.
-- 안전하게 여러 번 실행해도 됩니다(IF NOT EXISTS).

alter table students add column if not exists admin_note text;
alter table students add column if not exists admin_note_updated_at timestamptz;
alter table students add column if not exists admin_note_updated_by text;

comment on column students.admin_note is '학생 기본정보 탭에서 관리자가 직접 기재하는 특이사항(자유 서술)';
comment on column students.admin_note_updated_at is '특이사항 최종 수정 시각';
comment on column students.admin_note_updated_by is '특이사항 최종 수정자(표시명)';
