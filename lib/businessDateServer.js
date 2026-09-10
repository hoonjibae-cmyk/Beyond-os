// Beyond OS v41-246 — 운영 마감 시각(자정 이후 분)을 읽습니다.
//
// 설정 · 키오스크 브리지 설정의 autoCheckoutAfterMidnightMinutes 한 칸만 씁니다.
// normalizeKioskBridgeSettings 는 이미 두 라우트에 복사돼 있어, 사본을 더 늘리지
// 않으려고 필요한 값만 직접 읽습니다.

import { getOperatingDayString, getDayBoundaryMinutes } from './businessDate';

export const KIOSK_BRIDGE_SETTINGS_KEY = 'kiosk_bridge_settings';

export async function getClosingOffsetMinutes(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', KIOSK_BRIDGE_SETTINGS_KEY)
      .maybeSingle();
    if (error) throw error;
    const raw = data?.setting_value || {};
    const value = Number(raw.autoCheckoutAfterMidnightMinutes ?? raw.auto_checkout_after_midnight_minutes);
    return Number.isFinite(value) && value >= 0 && value <= 360 ? Math.round(value) : 0;
  } catch {
    // 설정을 못 읽으면 자정 마감으로 둡니다. (예전 동작)
    return 0;
  }
}

/**
 * 운영일 + 마감 분 + 날짜가 바뀌는 경계 분을 함께 돌려줍니다.
 *
 * offsetMinutes  자동 퇴실이 도는 마감 시각 (자정 이후 분)
 * boundaryMinutes 화면·기록의 하루가 바뀌는 시각 (마감 + 1시간)
 */
export async function getBusinessDate(supabase, now = new Date()) {
  const offsetMinutes = await getClosingOffsetMinutes(supabase);
  return {
    businessDate: getOperatingDayString(offsetMinutes, now),
    offsetMinutes,
    boundaryMinutes: getDayBoundaryMinutes(offsetMinutes),
  };
}
