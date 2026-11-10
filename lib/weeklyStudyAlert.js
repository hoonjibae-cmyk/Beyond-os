// Beyond OS v41-289 — 주간 순공시간 부족 학생 슬랙 알림
//
// 지난 주(월~일) 순공시간이 운영자가 정한 기준(시간) 미만인 학생 명단을 슬랙(비욘드 봇)으로 보냅니다.
// 기준·요일·시각은 자동 상점 기준(point_auto_rules)에 함께 저장합니다.
//   weeklyStudyAlertEnabled   켜짐/꺼짐 (기본 꺼짐)
//   weeklyStudyAlertMinHours  기준 시간. 이 값 "미만"이면 명단에 오릅니다. (기본 20시간)
//   weeklyStudyAlertWeekday   보내는 요일 (0=일 … 6=토, 기본 1=월)
//   weeklyStudyAlertTime      보내는 시각 'HH:MM' 한국시간 (기본 10:00)
// 순공시간 집계는 주간 자동 상점 배치와 같은 계산(loadWeeklyStudyMinutes)을 씁니다.

import { getKstNowParts, timeTextToMinutes, WEEKDAY_LABELS_KO } from './weeklyAutoSend';

export function isWeeklyStudyAlertDue(rules, nowParts = getKstNowParts()) {
  if (!rules?.weeklyStudyAlertEnabled) return false;
  if (nowParts.weekday !== Number(rules.weeklyStudyAlertWeekday)) return false;
  const due = timeTextToMinutes(rules.weeklyStudyAlertTime);
  if (due === null) return false;
  return nowParts.minutes >= due;
}

export function formatHoursKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h && !m) return '0시간';
  if (!m) return `${h}시간`;
  if (!h) return `${m}분`;
  return `${h}시간 ${m}분`;
}

export function formatThresholdHours(hours) {
  const value = Number(hours || 0);
  return Number.isInteger(value) ? `${value}시간` : `${value}시간`.replace('.5시간', '시간 30분');
}

/** 기준 미만 학생 고르기 (순공 적은 순) */
export function pickBelowThreshold(students = [], minutesByStudent = {}, minHours = 20) {
  const limit = Math.round(Number(minHours || 0) * 60);
  return (students || [])
    .map((student) => ({ studentId: String(student.id), name: student.name || '학생', minutes: Math.round(Number(minutesByStudent[String(student.id)] || 0)) }))
    .filter((row) => row.minutes < limit)
    .sort((a, b) => a.minutes - b.minutes || String(a.name).localeCompare(String(b.name), 'ko'));
}

/**
 * 슬랙 메시지. 부원장님 지정 형식:
 *   주간 순공 시간 xx시간 미만 학생: xxx(xx시간), ...
 */
export function buildWeeklyStudyAlertMessage({ week, minHours, rows = [], totalStudents = 0, cohortName = '' }) {
  const label = (d) => String(d || '').slice(5).replace('-', '/');
  const threshold = formatThresholdHours(minHours);
  const list = rows.length ? rows.map((row) => `${row.name}(${formatHoursKo(row.minutes)})`).join(', ') : '없음';
  const headline = `주간 순공 시간 ${threshold} 미만 학생: ${list}`;
  const context = `${label(week.start)}~${label(week.end)} (월~일)${cohortName ? ` · ${cohortName}` : ''} · 대상 ${totalStudents}명 중 ${rows.length}명`;
  const text = `${headline}\n${context}`;
  const bold = rows.length ? rows.map((row) => `*${row.name}*(${formatHoursKo(row.minutes)})`).join(', ') : '없음';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: `주간 순공 시간 ${threshold} 미만 학생 · ${rows.length}명`, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `주간 순공 시간 ${threshold} 미만 학생: ${bold}`.slice(0, 2900) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: context }] },
  ];
  return { text, blocks, headline };
}

export function describeWeeklyStudyAlert(rules) {
  return `매주 ${WEEKDAY_LABELS_KO[Number(rules?.weeklyStudyAlertWeekday ?? 1)]}요일 ${rules?.weeklyStudyAlertTime || '10:00'} · 지난 주(월~일) 순공 ${formatThresholdHours(rules?.weeklyStudyAlertMinHours ?? 20)} 미만`;
}
