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
    // v41-268: 표시한 기수. 없으면(옛 표시) 표에서 표시일로 기수를 추정합니다.
    cohortId: blocked ? String(student?.enrollment_block_cohort_id || '') : '',
    cohortName: blocked ? String(student?.enrollment_block_cohort_name || '').trim() : '',
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

/**
 * 저장 전 정리: 표시할 때는 사유를 다듬고, 해제할 때는 사유도 비웁니다.
 * v41-268: cohort({id, name})를 주면 '표시한 기수'로 함께 저장합니다. 이미 표시된 학생의
 * 사유만 고치는 경우(keepCohort)는 처음 표시한 기수를 그대로 둡니다.
 */
export function buildEnrollmentBlockPayload({ blocked, reason, actorName, now = new Date(), cohort = null, keepCohort = false } = {}) {
  const on = blocked === true;
  const payload = {
    enrollment_blocked: on,
    enrollment_block_reason: on ? (String(reason || '').trim().slice(0, 500) || null) : null,
    enrollment_block_updated_at: on ? now.toISOString() : null,
    enrollment_block_updated_by: on ? (String(actorName || '').trim() || null) : null,
  };
  if (!on) {
    payload.enrollment_block_cohort_id = null;
    payload.enrollment_block_cohort_name = null;
  } else if (!keepCohort) {
    payload.enrollment_block_cohort_id = cohort?.id ? String(cohort.id) : null;
    payload.enrollment_block_cohort_name = cohort?.name ? String(cohort.name).trim() : null;
  }
  return payload;
}

/** 기수 칸만 떼어 냅니다. (기수 칸이 없는 DB 에서 다시 시도할 때 씁니다) */
export function stripCohortColumns(payload = {}) {
  const { enrollment_block_cohort_id, enrollment_block_cohort_name, ...rest } = payload;
  return rest;
}

/**
 * 등록불가 학생들을 기수별로 묶습니다. 최근 기수가 먼저입니다.
 * 기수 기록이 없는 학생은 표시일이 속한 기수로 추정하고, 그래도 없으면 '기수 미기록' 묶음에 둡니다.
 * @param students  students 행 (enrollment_blocked = true 인 것)
 * @param cohorts   normalizeCohort 를 거친 기수 목록
 * @param resolveCohortForDate (cohorts, dateString) → cohort | null
 */
export function groupBlockedStudentsByCohort(students = [], cohorts = [], resolveCohortForDate = () => null) {
  const groups = new Map();
  const cohortById = new Map((cohorts || []).map((c) => [String(c.id), c]));
  for (const student of Array.isArray(students) ? students : []) {
    const block = getEnrollmentBlock(student);
    if (!block.blocked) continue;
    let cohort = block.cohortId ? cohortById.get(block.cohortId) || null : null;
    let cohortName = block.cohortName || cohort?.name || '';
    let inferred = false;
    if (!cohort && !cohortName && block.updatedAt) {
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(block.updatedAt));
      cohort = resolveCohortForDate(cohorts, date);
      cohortName = cohort?.name || '';
      inferred = Boolean(cohort);
    }
    const key = cohort?.id ? String(cohort.id) : (cohortName || '__none__');
    if (!groups.has(key)) {
      groups.set(key, { key, cohortId: cohort?.id || block.cohortId || '', cohortName: cohortName || '기수 미기록', startDate: cohort?.startDate || '', rows: [] });
    }
    groups.get(key).rows.push({
      studentId: String(student.id),
      name: student.name || '학생',
      school: student.school || '',
      grade: student.grade || '',
      studentPhone: student.student_phone || '',
      status: student.status || 'active',
      reason: block.reason,
      updatedAt: block.updatedAt,
      updatedBy: block.updatedBy,
      cohortInferred: inferred,
    });
  }
  const list = [...groups.values()];
  for (const group of list) group.rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || a.name.localeCompare(b.name, 'ko'));
  // 최근 기수 먼저, '기수 미기록'은 맨 뒤
  list.sort((a, b) => {
    if (a.key === '__none__') return 1;
    if (b.key === '__none__') return -1;
    return String(b.startDate || '').localeCompare(String(a.startDate || '')) || b.cohortName.localeCompare(a.cohortName, 'ko');
  });
  return list;
}
