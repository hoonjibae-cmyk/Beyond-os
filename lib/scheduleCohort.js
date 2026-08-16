// Beyond OS v41-185
// 개인 시간표(student_daily_schedules)를 기수 단위로 끊어 주는 공용 규칙입니다.
//
// 두 가지를 지킵니다.
//   1) 개인 시간표는 그 기수의 기간 안에만 존재합니다.
//      기수 시작 전, 종료 후, 그리고 어느 기수에도 속하지 않는 날짜에는 만들지 않습니다.
//   2) 한 번의 저장/생성은 기수 하나만 채웁니다.
//      기수가 이어지는 학생이라도 다음 기수 시간표는 새로 입력해야 합니다.
//      반복 저장이나 일괄 생성이 기수 경계를 넘어가면 경계에서 잘립니다.
//
// 예외는 요청에 allowCrossCohort:true 가 실려 올 때뿐입니다.
// (화면의 [기수가 바뀌어도 이어서 만들기] 체크)
//
// 기수를 하나도 만들지 않은 환경에서는 아무것도 막지 않습니다. (기존 동작 유지)

import { normalizeCohort, isUsableCohort, sortCohorts, resolveCohortForDate } from './cohorts';

export const SCHEDULE_BLOCK_REASON = {
  // 어느 기수 기간에도 들어가지 않는 날짜 (기수 사이 공백일, 마지막 기수 이후 등)
  NO_COHORT: 'no_cohort',
  // 저장 기준 날짜가 속한 기수와 다른 기수의 날짜
  OTHER_COHORT: 'other_cohort',
};

export async function loadScheduleCohortContext(supabase) {
  try {
    const { data, error } = await supabase
      .from('cohorts')
      .select('id, name, start_date, end_date, sort_order, is_active')
      .order('start_date', { ascending: true });
    if (error) throw error;
    const cohorts = sortCohorts((data || []).map(normalizeCohort).filter(isUsableCohort));
    return { enabled: cohorts.length > 0, cohorts };
  } catch {
    // 기수 목록을 못 읽으면 막지 않습니다. (조회 실패로 시간표 저장이 멈추면 안 됩니다)
    return { enabled: false, cohorts: [] };
  }
}

export function getCohortForDate(context, dateString) {
  if (!context?.enabled) return null;
  return resolveCohortForDate(context.cohorts, dateString);
}

// 기수 기간과 겹치도록 [start, end] 를 자릅니다. 겹치지 않으면 null.
export function clampRangeToCohort(cohort, startDate, endDate) {
  if (!cohort?.startDate || !cohort?.endDate) return { startDate, endDate, clamped: false };
  const start = startDate < cohort.startDate ? cohort.startDate : startDate;
  const end = endDate > cohort.endDate ? cohort.endDate : endDate;
  if (end < start) return null;
  return { startDate: start, endDate: end, clamped: start !== startDate || end !== endDate };
}

// 저장하려는 날짜들을 기수 기준으로 걸러 냅니다.
//   anchorDate : 저장의 기준이 되는 날짜(팝업을 연 날짜). 이 날짜가 속한 기수만 채웁니다.
//   dates      : 반복 확장까지 끝난 전체 날짜 목록
// 반환값
//   { enabled, cohort, allowed, blocked: [{ date, reason }], crossed }
export function planScheduleDates(context, { anchorDate, dates = [], allowCrossCohort = false } = {}) {
  const list = [...new Set((dates || []).filter(Boolean))].sort();
  if (!context?.enabled || allowCrossCohort) {
    return { enabled: false, cohort: null, allowed: list, blocked: [], crossed: false };
  }

  const cohort = resolveCohortForDate(context.cohorts, anchorDate);
  if (!cohort) {
    // 기준 날짜부터가 어느 기수에도 속하지 않습니다.
    return {
      enabled: true,
      cohort: null,
      allowed: [],
      blocked: list.map((date) => ({ date, reason: SCHEDULE_BLOCK_REASON.NO_COHORT })),
      crossed: false,
    };
  }

  const allowed = [];
  const blocked = [];
  for (const date of list) {
    if (date >= cohort.startDate && date <= cohort.endDate) {
      allowed.push(date);
      continue;
    }
    const other = resolveCohortForDate(context.cohorts, date);
    blocked.push({
      date,
      reason: other ? SCHEDULE_BLOCK_REASON.OTHER_COHORT : SCHEDULE_BLOCK_REASON.NO_COHORT,
      cohortName: other?.name || '',
    });
  }

  return { enabled: true, cohort, allowed, blocked, crossed: blocked.length > 0 };
}

// 화면에 그대로 띄울 수 있는 안내문을 만듭니다.
export function describeBlockedDates(plan) {
  if (!plan?.enabled || !plan.blocked.length) return '';
  const dates = plan.blocked.map((item) => item.date);
  const range = dates.length === 1 ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`;
  const otherNames = [...new Set(plan.blocked.map((item) => item.cohortName).filter(Boolean))];

  if (!plan.cohort) {
    return `${range} (${dates.length}일)은 어느 기수 기간에도 들어가지 않아 개인 시간표를 만들지 않았습니다.`
      + ' 설정 · 기수 관리에서 기간을 확인해 주세요.';
  }
  const tail = otherNames.length
    ? ` ${otherNames.join('·')} 시간표는 그 기수에서 새로 만들어 주세요.`
    : ' 기수 기간 밖이라 만들지 않았습니다.';
  return `${plan.cohort.name} 기간(${plan.cohort.startDate}~${plan.cohort.endDate})까지만 저장했습니다.`
    + ` ${range} (${dates.length}일)은 제외했습니다.${tail}`;
}
