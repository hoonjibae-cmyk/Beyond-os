// Beyond OS v41-266 — 다음 기수 등록불가 표시
//
// 기수마다 학습 태도를 평가해 다음 기수 등록을 받지 않을 학생을 표시합니다.
// students 표의 enrollment_blocked / enrollment_block_reason / _updated_at / _updated_by 를 읽어
// 화면에 쓸 모양으로 정리합니다. 칸이 아직 없으면(SQL 미실행) 전부 '해당 없음'으로 봅니다.

export const ENROLLMENT_BLOCK_LABEL = '다음기수 등록불가';
export const ENROLLMENT_BLOCK_SQL_HINT = 'beyond-os-supabase-enrollment-block-v41-266.sql 실행 여부를 확인하세요.';

export function getEnrollmentBlock(student = {}) {
  const blocked = student?.enrollment_blocked === true;
  return {
    blocked,
    reason: blocked ? String(student?.enrollment_block_reason || '').trim() : '',
    updatedAt: blocked ? (student?.enrollment_block_updated_at || null) : null,
    updatedBy: blocked ? String(student?.enrollment_block_updated_by || '').trim() : '',
  };
}

function formatKstDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** 배지 title(마우스 올렸을 때) 문구. 사유 → 표시한 사람 · 날짜 순. */
export function formatEnrollmentBlockTitle(block = {}) {
  if (!block?.blocked) return '';
  const lines = [`사유: ${block.reason || '사유 미입력'}`];
  const who = [block.updatedBy, formatKstDate(block.updatedAt)].filter(Boolean).join(' · ');
  if (who) lines.push(`표시: ${who}`);
  return lines.join('\n');
}

/** 저장 전 정리: 표시할 때는 사유를 다듬고, 해제할 때는 사유도 비웁니다. */
export function buildEnrollmentBlockPayload({ blocked, reason, actorName, now = new Date() } = {}) {
  const on = blocked === true;
  return {
    enrollment_blocked: on,
    enrollment_block_reason: on ? (String(reason || '').trim().slice(0, 500) || null) : null,
    enrollment_block_updated_at: on ? now.toISOString() : null,
    enrollment_block_updated_by: on ? (String(actorName || '').trim() || null) : null,
  };
}
