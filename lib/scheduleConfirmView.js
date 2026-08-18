// Beyond OS v41-205 — 학부모가 제출한 확인 내용을 관리자 화면에서 읽기 좋게 정리합니다.
//
// 지금까지는 '확인 완료 / 수정 요청'이라는 상태만 보였고, 학부모가 무엇을 확인했는지
// 무엇을 고쳤는지는 화면 어디에도 나오지 않았습니다.
// 그대로 확인한 경우에도 '무엇을 확인해 준 것인지'는 남아야 합니다.
//
// 규칙
//   - 그대로 확인(confirmed) : 학부모에게 보여 준 시간표(snapshot)가 곧 확인해 준 내용입니다.
//   - 수정 요청(change_requested) : 보여 준 것(snapshot)과 제출한 것(response)을 나란히 놓고
//     달라진 요일만 표시합니다.

export const CONFIRM_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const CONFIRM_DAY_LABELS = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

function clock(value) {
  return String(value || '').slice(0, 5);
}

// 요일 한 칸을 한 줄로 풀어 씁니다. 비교도 이 문자열로 합니다.
export function describeConfirmDay(day) {
  if (!day) return '등원 없음';
  if (day.absent) {
    const reason = String(day.absentReason || '').trim();
    return reason ? `등원 없음 (결석) · ${reason}` : '등원 없음 (결석)';
  }
  const parts = [`${clock(day.checkIn) || '-'} ~ ${clock(day.checkOut) || '-'}`];
  const away = (Array.isArray(day.breaks) ? day.breaks : [])
    .filter((item) => item && (item.start || item.end))
    .map((item) => {
      const range = `${clock(item.start) || '?'}~${clock(item.end) || '?'}`;
      const reason = String(item.reason || '').trim();
      return reason ? `${range} ${reason}` : range;
    });
  if (away.length) parts.push(`외출 ${away.join(', ')}`);
  const note = String(day.note || '').trim();
  if (note) parts.push(note);
  return parts.join(' · ');
}

const SPECIAL_LABELS = { absent: '결석', away: '외출', start_from: '등원 시작', unknown: '확인 필요' };

export function describeConfirmSpecial(item) {
  if (!item) return '';
  const label = SPECIAL_LABELS[item.type] || item.type || '일정';
  const dates = Array.isArray(item.dates) ? item.dates : [];
  const when = dates.length ? dates.map((date) => String(date).slice(5).replace('-', '/')).join(', ') : '날짜 미정';
  const time = item.start || item.end ? ` ${clock(item.start) || '?'}~${clock(item.end) || '?'}` : '';
  const reason = String(item.reason || '').trim();
  return `${label} · ${when}${time}${reason ? ` · ${reason}` : ''}`;
}

function specialLines(list) {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && item.include !== false)
    .map(describeConfirmSpecial)
    .filter(Boolean);
}

/**
 * 확인 요청 한 건을 화면에서 그대로 쓸 수 있는 형태로 바꿉니다.
 *
 * @returns {{
 *   changed: boolean,            // 학부모가 고쳐서 제출했는지
 *   days: Array<{key,label,before,after,changed}>,
 *   changedDayCount: number,
 *   special: { before: string[], after: string[], changed: boolean },
 *   submitted: boolean,          // 학부모가 제출을 마쳤는지
 * }}
 */
export function buildConfirmDetail(row = {}) {
  const submitted = row.status === 'confirmed' || row.status === 'change_requested';
  const changed = row.status === 'change_requested' && Boolean(row.response);

  const snapshot = row.snapshot || {};
  const before = snapshot.days || {};
  // 수정 요청이라도 response.days 가 없으면 보여 준 내용을 그대로 확인한 것으로 봅니다.
  const after = changed && row.response?.days ? row.response.days : before;

  const days = CONFIRM_DAY_KEYS.map((key) => {
    const beforeText = describeConfirmDay(before[key]);
    const afterText = describeConfirmDay(after[key]);
    return {
      key,
      label: CONFIRM_DAY_LABELS[key],
      before: beforeText,
      after: afterText,
      changed: changed && beforeText !== afterText,
    };
  });

  const beforeSpecial = specialLines(snapshot.special);
  const afterSpecial = changed && Array.isArray(row.response?.special)
    ? specialLines(row.response.special)
    : beforeSpecial;

  return {
    submitted,
    changed,
    days,
    changedDayCount: days.filter((day) => day.changed).length,
    special: {
      before: beforeSpecial,
      after: afterSpecial,
      changed: changed && beforeSpecial.join('|') !== afterSpecial.join('|'),
    },
  };
}

// 목록 한 줄에 붙일 짧은 요약. ('수 · 금 2개 요일 변경' / '보여 드린 대로 확인')
export function summarizeConfirmDetail(detail) {
  if (!detail?.submitted) return '';
  if (!detail.changed) return '보여 드린 시간표 그대로 확인';
  const changedDays = detail.days.filter((day) => day.changed).map((day) => day.label);
  const parts = [];
  if (changedDays.length) parts.push(`${changedDays.join('·')} ${changedDays.length}개 요일 변경`);
  if (detail.special.changed) parts.push('특별 일정 변경');
  return parts.length ? parts.join(' · ') : '내용은 그대로, 메모만 남김';
}
