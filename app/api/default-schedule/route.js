import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { DEFAULT_SCHEDULE_SETTING_KEY, FALLBACK_DEFAULT_SCHEDULE_SETTINGS, normalizeDefaultScheduleSettings, timeToMinutes24, isFiveMinuteTime24 } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';


function validateRawDefaultSchedule(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const errors = [];
  const plannedCheckIn = source.plannedCheckIn || source.planned_check_in || FALLBACK_DEFAULT_SCHEDULE_SETTINGS.plannedCheckIn;
  const plannedCheckOut = source.plannedCheckOut || source.planned_check_out || FALLBACK_DEFAULT_SCHEDULE_SETTINGS.plannedCheckOut;
  const inMinute = timeToMinutes24(plannedCheckIn);
  const outMinute = timeToMinutes24(plannedCheckOut);

  if (!isFiveMinuteTime24(plannedCheckIn) || inMinute === 24 * 60) errors.push('기본 예정 등원은 5분 단위 HH:MM 형식으로 선택하세요.');
  if (!isFiveMinuteTime24(plannedCheckOut)) errors.push('기본 예정 하원은 5분 단위 HH:MM 형식으로 선택하세요.');
  if (inMinute !== null && outMinute !== null && outMinute <= inMinute) errors.push('기본 예정 하원은 기본 예정 등원보다 늦어야 합니다.');

  const windows = Array.isArray(source.studyWindows || source.study_windows)
    ? (source.studyWindows || source.study_windows)
    : [];

  windows.forEach((item, index) => {
    const start = item?.start;
    const end = item?.end;
    const startMinute = timeToMinutes24(start);
    const endMinute = timeToMinutes24(end);
    if (!String(item?.label || '').trim()) errors.push(`${index + 1}번째 구간: 이름을 입력하세요.`);
    if (!isFiveMinuteTime24(start) || startMinute === 24 * 60) errors.push(`${index + 1}번째 구간: 시작시간은 5분 단위 HH:MM 형식으로 선택하세요.`);
    if (!isFiveMinuteTime24(end)) errors.push(`${index + 1}번째 구간: 종료시간은 5분 단위 HH:MM 형식으로 선택하세요.`);
    if (startMinute !== null && endMinute !== null && endMinute <= startMinute) errors.push(`${index + 1}번째 구간: 종료시간은 시작시간보다 늦어야 합니다.`);
  });

  return errors;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .eq('setting_key', DEFAULT_SCHEDULE_SETTING_KEY)
      .maybeSingle();

    if (error) {
      return Response.json({
        defaultSchedule: normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
        warning: 'system_settings 테이블이 없어 기본 시간표 fallback을 사용합니다. v40-6 SQL을 실행하면 저장 기능을 사용할 수 있습니다.',
      });
    }

    return Response.json({ defaultSchedule: normalizeDefaultScheduleSettings(data?.setting_value || FALLBACK_DEFAULT_SCHEDULE_SETTINGS) });
  } catch (error) {
    return Response.json({
      defaultSchedule: normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS),
      warning: error.message || '기본 시간표 fallback을 사용합니다.',
    });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const rawSchedule = body.defaultSchedule || body.schedule || {};
    const validationErrors = validateRawDefaultSchedule(rawSchedule);
    if (validationErrors.length) {
      return Response.json({ error: validationErrors.join(' / ') }, { status: 400 });
    }
    const defaultSchedule = normalizeDefaultScheduleSettings(rawSchedule);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: DEFAULT_SCHEDULE_SETTING_KEY,
        setting_value: defaultSchedule,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_key' })
      .select()
      .single();

    if (error) {
      return Response.json({
        error: `${error.message} / Supabase에서 beyond-os-supabase-operating-rules-v40-6.sql을 먼저 실행하세요.`,
      }, { status: 500 });
    }

    return Response.json({ defaultSchedule: normalizeDefaultScheduleSettings(data.setting_value), saved: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
