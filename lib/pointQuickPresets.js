// Beyond OS v41-269
// 상벌점 탭 '자주 주는 상점' 프리셋과 여러 학생 일괄 부여 공용 로직입니다.
//
// 모범태도(+2) · 플래너 성실 작성(+3)은 거의 매일 주는 상점이라 사유를 매번 치지 않도록
// 버튼으로 빼 두고, 학생을 여러 명 골라 한 번에 기록합니다.

export const QUICK_REWARD_PRESETS = [
  { key: 'attitude', label: '모범태도', points: 2, pointType: 'reward' },
  { key: 'planner', label: '플래너 성실 작성', points: 3, pointType: 'reward' },
];

export const MAX_BULK_POINT_STUDENTS = 60;

export function getQuickRewardPreset(key) {
  return QUICK_REWARD_PRESETS.find((preset) => preset.key === String(key || '')) || null;
}

function toDateString(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

// 학생 id 목록을 정리합니다. 빈 값·중복은 버리고 순서는 유지합니다.
export function normalizeStudentIdList(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const id = String(item ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * 일괄 부여 입력을 검증하고 insert 할 행을 만듭니다.
 * 반환: { ok, error, rows, studentIds, pointDate, pointType, points, reason }
 */
export function buildBulkPointRows(input = {}, options = {}) {
  const studentIds = normalizeStudentIdList(input.studentIds);
  const maxStudents = Number(options.maxStudents) > 0 ? Number(options.maxStudents) : MAX_BULK_POINT_STUDENTS;
  if (!studentIds.length) return { ok: false, error: '학생을 한 명 이상 선택하세요.', rows: [] };
  if (studentIds.length > maxStudents) {
    return { ok: false, error: `한 번에 ${maxStudents}명까지만 기록할 수 있습니다.`, rows: [] };
  }

  const preset = getQuickRewardPreset(input.presetKey);
  const pointType = preset ? preset.pointType : (input.pointType === 'penalty' ? 'penalty' : 'reward');
  const pointsRaw = preset ? preset.points : Number(input.points || 0);
  const points = Math.max(1, Math.round(Number.isFinite(pointsRaw) ? pointsRaw : 0));
  const reason = String(preset ? preset.label : (input.reason || '')).trim();
  if (!reason) return { ok: false, error: '상벌점 사유를 입력하세요.', rows: [] };

  const pointDate = toDateString(input.pointDate) || toDateString(options.today) || '';
  if (!pointDate) return { ok: false, error: '날짜가 올바르지 않습니다.', rows: [] };

  const memo = String(input.memo || '').trim();
  const createdBy = String(options.actorName || input.createdBy || '관리자');

  const rows = studentIds.map((studentId) => ({
    student_id: studentId,
    point_date: pointDate,
    point_type: pointType,
    points,
    reason,
    memo: memo || null,
    created_by: createdBy,
    is_deleted: false,
  }));

  return { ok: true, error: '', rows, studentIds, pointDate, pointType, points, reason, memo };
}

// 결과 안내 문구: "모범태도 +2점 · 5명 기록 완료"
export function formatBulkPointMessage({ pointType, points, reason, count }) {
  const sign = pointType === 'penalty' ? '-' : '+';
  return `${reason} ${sign}${points}점 · ${count}명 기록 완료`;
}

// 확인창용 이름 요약: "김민준, 이서연 외 3명"
export function summarizeStudentNames(names = [], shown = 3) {
  const list = (names || []).map((name) => String(name || '').trim()).filter(Boolean);
  if (!list.length) return '';
  if (list.length <= shown) return list.join(', ');
  return `${list.slice(0, shown).join(', ')} 외 ${list.length - shown}명`;
}
