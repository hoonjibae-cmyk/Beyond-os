// Beyond OS v41-196 — 자율학습 시간대
//
// v41-275.2: 아래 SELF_STUDY_WINDOWS 고정값은 '예전 링크·설정이 없을 때의 폴백'입니다.
// 실제 기준은 그 날짜에 적용되는 기수별 기본 시간표의 "자율학습" 차시이며,
// resolveSelfStudyRanges() / selfStudyWindowFromBase() 가 그 값을 우선합니다.
//
// 정규 운영이 끝난 뒤에도 학습실을 열어 두는 시간입니다.
// 이 시간에는 개인 시간표를 미리 정해 두지 않고 학생이 자유롭게 오갑니다.
//
// 학부모에게 보내는 시간표에 하원 시각만 적으면 "그 시각에 문을 닫는다"로 읽히기 때문에,
// 요일 유형별로 이 시간대를 함께 표기합니다.
//
// 요일 유형은 설정 · 기본 시간표의 판정(평일 / 토요일 / 일요일 / 공휴일)을 그대로 씁니다.
// 운영 시간이 바뀌면 이 값만 고치면 화면과 이미지에 함께 반영됩니다.
export const SELF_STUDY_WINDOWS = {
  weekday: { start: '22:30', end: '24:00' },
  saturday: { start: '18:30', end: '22:00' },
  sunday: { start: '09:30', end: '22:00' },
  // 공휴일은 운영하지 않으므로 자율학습도 없습니다.
  holiday: null,
};

export function getSelfStudyWindow(dayType) {
  const window = SELF_STUDY_WINDOWS[dayType];
  return window && window.start && window.end ? window : null;
}

export function formatSelfStudyWindow(dayType) {
  const window = getSelfStudyWindow(dayType);
  return window ? `${window.start}~${window.end}` : '';
}

// 안내 문구 한 줄. (이미지 하단, 학부모 확인 화면에서 함께 씁니다)
export function describeSelfStudyWindows() {
  const parts = [];
  if (SELF_STUDY_WINDOWS.weekday) parts.push(`평일 ${formatSelfStudyWindow('weekday')}`);
  if (SELF_STUDY_WINDOWS.saturday) parts.push(`토요일 ${formatSelfStudyWindow('saturday')}`);
  if (SELF_STUDY_WINDOWS.sunday) parts.push(`일요일 ${formatSelfStudyWindow('sunday')}`);
  return parts.join(' · ');
}

// ─────────────────────────────────────────────────────────────
// v41-275.1 / 275.2: 기수별 기본 시간표에서 자율학습 구간 가져오기
// ─────────────────────────────────────────────────────────────
export const SELF_STUDY_LABEL_PATTERN = /(자율|자습|자유)/;

function clockToMinutes(value) {
  const raw = String(value || '').trim();
  if (raw === '24:00') return 1440;
  const match = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToClock(minutes) {
  const value = Math.round(Number(minutes) || 0);
  if (value >= 1440) return '24:00';
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 그 날짜의 기본 시간표(기수별 설정 반영)에서 자율학습 구간을 뽑습니다.
 *   1) 차시 이름에 자율·자습·자유가 든 차시
 *   2) 없으면 마지막 관리 차시 끝 ~ 기본 하원
 *   3) 그래도 없으면 요일 유형 고정값(SELF_STUDY_WINDOWS)
 * 휴무일(operating === false)은 관리 차시가 없으므로 공부 인정 구간 전부가 자율학습입니다. (source 'closed')
 *
 * @param {object} dayInfo  { dayType, operating, plannedCheckOut, studyWindows }
 * @returns {{ ranges: Array<{start:number,end:number,startClock:string,endClock:string,label:string}>, source: 'window'|'tail'|'legacy'|'none' }}
 */
export function resolveSelfStudyRanges(dayInfo = {}) {
  const windows = Array.isArray(dayInfo?.studyWindows) ? dayInfo.studyWindows : [];
  const make = (start, end) => ({ start, end, startClock: minutesToClock(start), endClock: minutesToClock(end), label: `${minutesToClock(start)}~${minutesToClock(end)}` });

  // v41-275.3: 휴무일(운영 안 함)에는 관리 차시가 없습니다. 그날의 공부 인정 시간(구간) 전부가 자율학습입니다.
  if (dayInfo && dayInfo.operating === false) {
    const all = windows
      .map((item) => {
        const start = clockToMinutes(item?.start);
        const end = clockToMinutes(item?.end);
        if (start === null || end === null || end <= start) return null;
        return make(start, end);
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
    return { ranges: all, source: all.length ? 'closed' : 'none' };
  }

  const named = windows
    .filter((item) => SELF_STUDY_LABEL_PATTERN.test(String(item?.label || '')))
    .map((item) => {
      const start = clockToMinutes(item?.start);
      const end = clockToMinutes(item?.end);
      if (start === null || end === null || end <= start) return null;
      return make(start, end);
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  if (named.length) return { ranges: named, source: 'window' };

  const ends = windows.map((item) => clockToMinutes(item?.end)).filter((value) => value !== null);
  const checkOut = clockToMinutes(dayInfo?.plannedCheckOut);
  if (ends.length && checkOut !== null) {
    const lastEnd = Math.max(...ends);
    if (checkOut > lastEnd) return { ranges: [make(lastEnd, checkOut)], source: 'tail' };
  }

  const legacy = getSelfStudyWindow(dayInfo?.dayType || 'weekday');
  if (legacy) {
    const start = clockToMinutes(legacy.start);
    const end = clockToMinutes(legacy.end);
    if (start !== null && end !== null && end > start) return { ranges: [make(start, end)], source: 'legacy' };
  }
  return { ranges: [], source: 'none' };
}

/**
 * 이미지·학부모 확인 화면용: 요일 기준(base)에서 자율학습 한 구간 { start, end }를 돌려줍니다.
 * base.selfStudy(서버가 기본 시간표에서 뽑아 넣은 값)가 있으면 그것을, 없으면 요일 유형 고정값을 씁니다.
 * 구간이 둘 이상이면 처음 시작 ~ 마지막 끝으로 합쳐 보여 줍니다.
 */
export function selfStudyWindowFromBase(base) {
  if (!base) return null;
  const ranges = Array.isArray(base.selfStudy) ? base.selfStudy : null;
  if (ranges) {
    if (!ranges.length) return null;
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    return { start: first.startClock || first.start, end: last.endClock || last.end };
  }
  // 예전 링크(selfStudy 없음): 휴무일은 표시하지 않고, 그 외는 요일 유형 고정값
  if (base.operating === false) return null;
  return getSelfStudyWindow(base.dayType || 'weekday');
}

// 안내 문구 한 줄을 요일 기준표(baseByDay)에서 만듭니다. "평일 22:00~24:00 · 토요일 18:00~22:00 · 일요일 09:30~18:00"
// baseByDay 가 없거나 비어 있으면 예전 고정값 문구를 씁니다.
export function describeSelfStudyFromBaseByDay(baseByDay = null) {
  const entries = baseByDay && typeof baseByDay === 'object' ? Object.values(baseByDay) : [];
  if (!entries.length) return describeSelfStudyWindows();
  const byType = {};
  for (const base of entries) {
    const type = base?.dayType || 'weekday';
    if (byType[type]) continue;
    const window = selfStudyWindowFromBase(base);
    if (window) byType[type] = `${window.start}~${window.end}`;
  }
  const labels = { weekday: '평일', saturday: '토요일', sunday: '일요일', holiday: '공휴일' };
  const parts = ['weekday', 'saturday', 'sunday', 'holiday'].filter((type) => byType[type]).map((type) => `${labels[type]} ${byType[type]}`);
  return parts.length ? parts.join(' · ') : describeSelfStudyWindows();
}
