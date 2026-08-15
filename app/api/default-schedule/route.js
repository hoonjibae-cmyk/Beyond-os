import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import {
  DEFAULT_SCHEDULE_SETTING_KEY,
  COHORT_SCHEDULE_KEY_PREFIX,
  getCohortScheduleSettingKey,
  parseCohortScheduleSettingKey,
  DEFAULT_SCHEDULE_DAY_TYPES,
  DEFAULT_SCHEDULE_DAY_TYPE_LABELS,
  FALLBACK_DEFAULT_SCHEDULE_SETTINGS,
  normalizeDefaultScheduleSettings,
  normalizeDefaultScheduleConfig,
  normalizeHolidayList,
  timeToMinutes24,
  isFiveMinuteTime24,
} from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';


function validateScheduleVariant(value = {}, dayLabel = '') {
  const source = value && typeof value === 'object' ? value : {};
  const prefix = dayLabel ? `[${dayLabel}] ` : '';
  const errors = [];
  const plannedCheckIn = source.plannedCheckIn || source.planned_check_in || FALLBACK_DEFAULT_SCHEDULE_SETTINGS.plannedCheckIn;
  const plannedCheckOut = source.plannedCheckOut || source.planned_check_out || FALLBACK_DEFAULT_SCHEDULE_SETTINGS.plannedCheckOut;
  const inMinute = timeToMinutes24(plannedCheckIn);
  const outMinute = timeToMinutes24(plannedCheckOut);

  if (!isFiveMinuteTime24(plannedCheckIn) || inMinute === 24 * 60) errors.push(`${prefix}기본 예정 등원은 5분 단위 HH:MM 형식으로 선택하세요.`);
  if (!isFiveMinuteTime24(plannedCheckOut)) errors.push(`${prefix}기본 예정 하원은 5분 단위 HH:MM 형식으로 선택하세요.`);
  if (inMinute !== null && outMinute !== null && outMinute <= inMinute) errors.push(`${prefix}기본 예정 하원은 기본 예정 등원보다 늦어야 합니다.`);

  const windows = Array.isArray(source.studyWindows || source.study_windows)
    ? (source.studyWindows || source.study_windows)
    : [];

  windows.forEach((item, index) => {
    const start = item?.start;
    const end = item?.end;
    const startMinute = timeToMinutes24(start);
    const endMinute = timeToMinutes24(end);
    if (!String(item?.label || '').trim()) errors.push(`${prefix}${index + 1}번째 구간: 이름을 입력하세요.`);
    if (!isFiveMinuteTime24(start) || startMinute === 24 * 60) errors.push(`${prefix}${index + 1}번째 구간: 시작시간은 5분 단위 HH:MM 형식으로 선택하세요.`);
    if (!isFiveMinuteTime24(end)) errors.push(`${prefix}${index + 1}번째 구간: 종료시간은 5분 단위 HH:MM 형식으로 선택하세요.`);
    if (startMinute !== null && endMinute !== null && endMinute <= startMinute) errors.push(`${prefix}${index + 1}번째 구간: 종료시간은 시작시간보다 늦어야 합니다.`);
  });

  return errors;
}

// 신규(요일 유형별) 저장값과 레거시(평일 단일) 저장값을 모두 검증합니다.
function validateDefaultScheduleInput(rawConfig, legacySchedule) {
  const errors = [];
  const variants = rawConfig && typeof rawConfig === 'object' && rawConfig.variants && typeof rawConfig.variants === 'object'
    ? rawConfig.variants
    : null;

  if (variants) {
    for (const dayType of DEFAULT_SCHEDULE_DAY_TYPES) {
      const variant = variants[dayType];
      if (!variant) continue;
      errors.push(...validateScheduleVariant(variant, DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dayType]));
    }
  } else if (legacySchedule) {
    errors.push(...validateScheduleVariant(legacySchedule));
  }

  const holidaySource = (rawConfig && (rawConfig.holidays || rawConfig.holiday_dates)) || [];
  if (Array.isArray(holidaySource) && holidaySource.length) {
    const normalized = normalizeHolidayList(holidaySource);
    const rawCount = holidaySource.filter((item) => item != null && String(item).trim()).length;
    if (normalized.length < rawCount) {
      errors.push('공휴일 날짜는 YYYY-MM-DD 형식으로 입력하세요.');
    }
  }

  return errors;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    // v41-177: 공통 설정과 기수별 설정을 함께 읽습니다.
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_key, setting_value');

    if (error) {
      return Response.json({
        defaultSchedule: normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
        defaultScheduleConfig: normalizeDefaultScheduleConfig(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
        cohortConfigs: {},
        warning: 'system_settings 테이블이 없어 기본 시간표 fallback을 사용합니다. v40-6 SQL을 실행하면 저장 기능을 사용할 수 있습니다.',
      });
    }

    const rows = data || [];
    const globalRow = rows.find((row) => row.setting_key === DEFAULT_SCHEDULE_SETTING_KEY);
    const rawValue = globalRow?.setting_value || FALLBACK_DEFAULT_SCHEDULE_SETTINGS;

    // 기수별로 따로 저장된 설정(있는 것만)
    const cohortRaw = {};
    for (const row of rows) {
      const cohortId = parseCohortScheduleSettingKey(row.setting_key);
      if (cohortId && row.setting_value) cohortRaw[cohortId] = row.setting_value;
    }

    // 실제 판정에 쓰도록 기수 기간을 붙인 설정을 만듭니다.
    let cohortSchedules = [];
    const cohortIds = Object.keys(cohortRaw);
    if (cohortIds.length) {
      try {
        const { data: cohortData } = await supabase
          .from('cohorts')
          .select('id, name, start_date, end_date')
          .in('id', cohortIds);
        cohortSchedules = (cohortData || []).map((cohort) => ({
          id: String(cohort.id),
          name: cohort.name || '',
          startDate: String(cohort.start_date || '').slice(0, 10),
          endDate: String(cohort.end_date || '').slice(0, 10),
          config: cohortRaw[String(cohort.id)],
        }));
      } catch {
        cohortSchedules = [];
      }
    }

    const merged = { ...(rawValue && typeof rawValue === 'object' ? rawValue : {}), cohortSchedules };

    // 편집 화면에서 쓰도록 기수별 설정을 정규화해 함께 내려 줍니다.
    const cohortConfigs = {};
    for (const [cohortId, value] of Object.entries(cohortRaw)) {
      cohortConfigs[cohortId] = normalizeDefaultScheduleConfig({ ...value, cohortSchedules: [] });
      delete cohortConfigs[cohortId].cohortSchedules;
    }

    return Response.json({
      defaultSchedule: normalizeDefaultScheduleSettings(rawValue),
      defaultScheduleConfig: normalizeDefaultScheduleConfig(merged),
      cohortConfigs,
    });
  } catch (error) {
    return Response.json({
      defaultSchedule: normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
      defaultScheduleConfig: normalizeDefaultScheduleConfig(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
      cohortConfigs: {},
      warning: error.message || '기본 시간표 fallback을 사용합니다.',
    });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    // v41-177: cohortId 를 주면 그 기수 전용 설정으로 저장/삭제합니다.
    // 주지 않으면 지금까지처럼 공통 설정을 저장합니다.
    const cohortId = String(body.cohortId || '').trim();
    const settingKey = cohortId ? getCohortScheduleSettingKey(cohortId) : DEFAULT_SCHEDULE_SETTING_KEY;
    const supabase = getSupabaseAdmin();

    // 기수 전용 설정 해제 → 그 기수는 다시 공통 설정을 따릅니다.
    if (String(body.action || '') === 'reset') {
      if (!cohortId) {
        return Response.json({ error: '공통 설정은 해제할 수 없습니다. 기수를 선택하세요.' }, { status: 400 });
      }
      const { error: deleteError } = await supabase
        .from('system_settings')
        .delete()
        .eq('setting_key', settingKey);
      if (deleteError) {
        return Response.json({ error: deleteError.message }, { status: 500 });
      }
      return Response.json({ reset: true, cohortId });
    }

    // 신규 클라이언트는 defaultScheduleConfig(요일 유형별)를,
    // 구버전 클라이언트는 defaultSchedule(평일 단일)를 보냅니다. 둘 다 지원합니다.
    const rawConfig = body.defaultScheduleConfig || body.config || null;
    const legacySchedule = body.defaultSchedule || body.schedule || null;

    const validationErrors = validateDefaultScheduleInput(rawConfig, rawConfig ? null : legacySchedule);
    if (validationErrors.length) {
      return Response.json({ error: validationErrors.join(' / ') }, { status: 400 });
    }

    const normalized = rawConfig
      ? normalizeDefaultScheduleConfig(rawConfig)
      : normalizeDefaultScheduleConfig(legacySchedule || FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
    // 저장값 안에는 기수 목록을 넣지 않습니다. (읽을 때 기수 기간을 붙여 조립합니다)
    const settingValue = { ...normalized };
    delete settingValue.cohortSchedules;

    const { data, error } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: settingKey,
        setting_value: settingValue,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_key' })
      .select()
      .single();

    if (error) {
      return Response.json({
        error: `${error.message} / Supabase에서 beyond-os-supabase-operating-rules-v40-6.sql을 먼저 실행하세요.`,
      }, { status: 500 });
    }

    return Response.json({
      cohortId: cohortId || null,
      defaultSchedule: normalizeDefaultScheduleSettings(data.setting_value),
      defaultScheduleConfig: normalizeDefaultScheduleConfig(data.setting_value),
      saved: true,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
