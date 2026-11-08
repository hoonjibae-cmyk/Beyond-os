// Beyond OS v41-287 — 위클리 리포트 자동 생성·발송 설정
//
// report_send_settings(system_settings) 안의 weeklyAutoSend 항목입니다.
//   enabled     켜짐/꺼짐
//   weekday     실행 요일 (0=일 … 6=토). 기본 1(월)
//   time        실행 시각 'HH:MM' (한국시간). 기본 '09:00'
//   weekTarget  어느 주를 보낼지
//                 'previous' = 실행일 기준 직전 월~일 (월요일 아침 실행용, 기본)
//                 'current'  = 실행일이 속한 월~일 (일요일 밤 실행용)
//   composeMode 리포트 자동 구성 방식
//                 'missing' = 아직 저장된 리포트가 없는 학생만 만들고, 손으로 쓴 리포트는 그대로 둠 (기본)
//                 'all'     = 전원 최신 데이터로 다시 정리 (면담·최종 코멘트는 유지)
//   notifySlack 실행 결과를 슬랙(비욘드 봇)으로 알릴지. 슬랙 설정이 없으면 조용히 건너뜀
//
// 발송 대상은 항상 "그 주 리포트가 저장돼 있고 아직 발송 완료(sent)가 아닌 학생"입니다.
// 이미 보낸 학생에게 다시 보내지 않으므로 수동 발송과 섞여도 중복이 나지 않습니다.

import { addDaysToDateString, getWeekStartMonday } from './pointAutoRules';

export const WEEKDAY_LABELS_KO = ['일', '월', '화', '수', '목', '금', '토'];

export const DEFAULT_WEEKLY_AUTO_SEND_SETTINGS = {
  enabled: false,
  weekday: 1,
  time: '09:00',
  weekTarget: 'previous',
  composeMode: 'missing',
  notifySlack: true,
};

export function normalizeWeeklyAutoSendSettings(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallback = DEFAULT_WEEKLY_AUTO_SEND_SETTINGS;
  const weekday = Number(source.weekday);
  const time = String(source.time || '').trim();
  return {
    enabled: source.enabled === true || source.enabled === 'true',
    weekday: Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? weekday : fallback.weekday,
    time: timeTextToMinutes(time) !== null && /^\d{2}:\d{2}$/.test(time) ? time : fallback.time,
    weekTarget: source.weekTarget === 'current' ? 'current' : 'previous',
    composeMode: source.composeMode === 'all' ? 'all' : 'missing',
    notifySlack: source.notifySlack !== false && source.notifySlack !== 'false',
  };
}

/** 'HH:MM' → 분. 잘못된 값은 null */
export function timeTextToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const h = Number(match[1]); const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** 한국시간 기준 지금의 { date: 'YYYY-MM-DD', minutes, weekday } */
export function getKstNowParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minutes: hour * 60 + Number(parts.minute), weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

/** 실행일(YYYY-MM-DD)에 대해 보낼 주(월~일) */
export function resolveTargetWeek(runDate, weekTarget = 'previous') {
  const monday = getWeekStartMonday(runDate);
  if (!monday) return { start: '', end: '' };
  const start = weekTarget === 'current' ? monday : addDaysToDateString(monday, -7);
  return { start, end: addDaysToDateString(start, 6) };
}

/**
 * 지금 실행할 때인가.
 *   실행 요일이고, 설정 시각이 지났으면 true. (크론이 10분마다 돌므로 같은 날 안에서 늦게라도 잡습니다)
 *   같은 주를 두 번 보내지 않는 것은 실행 기록(run_key)이 막습니다.
 */
export function isWeeklyAutoSendDue(settings, nowParts = getKstNowParts()) {
  const normalized = normalizeWeeklyAutoSendSettings(settings);
  if (!normalized.enabled) return false;
  if (nowParts.weekday !== normalized.weekday) return false;
  const dueMinutes = timeTextToMinutes(normalized.time);
  if (dueMinutes === null) return false;
  return nowParts.minutes >= dueMinutes;
}

/** 다음 자동 실행 시각(한국시간)과 그때 보낼 주. 꺼져 있으면 null */
export function getNextWeeklyAutoSendRun(settings, nowParts = getKstNowParts()) {
  const normalized = normalizeWeeklyAutoSendSettings(settings);
  if (!normalized.enabled) return null;
  const dueMinutes = timeTextToMinutes(normalized.time) ?? 0;
  let daysAhead = (normalized.weekday - nowParts.weekday + 7) % 7;
  if (daysAhead === 0 && nowParts.minutes >= dueMinutes) daysAhead = 7;
  const runDate = addDaysToDateString(nowParts.date, daysAhead);
  return {
    runDate,
    time: normalized.time,
    weekdayLabel: WEEKDAY_LABELS_KO[normalized.weekday],
    week: resolveTargetWeek(runDate, normalized.weekTarget),
  };
}

export function buildAutoRunKey(week, trigger = 'auto') {
  return trigger === 'auto' ? `auto:${week.start}~${week.end}` : `${trigger}:${week.start}~${week.end}:${Date.now()}`;
}

export function describeWeeklyAutoSendSettings(settings) {
  const s = normalizeWeeklyAutoSendSettings(settings);
  const weekText = s.weekTarget === 'current' ? '실행일이 속한 주(월~일)' : '직전 주(월~일)';
  const composeText = s.composeMode === 'all' ? '전원 최신 데이터로 갱신 구성' : '미작성 학생만 자동 구성';
  return `매주 ${WEEKDAY_LABELS_KO[s.weekday]}요일 ${s.time} · ${weekText} · ${composeText} · 미발송 학생에게만 발송`;
}
