// Beyond OS v41-241
// 주간 순공 자동 상점 · 상품 지급 기준 설정을 DB에서 읽습니다.
//
// system_settings 한 줄(setting_key = 'point_auto_rules')에 담습니다.
// 표가 없거나 아직 저장한 적이 없으면 기본값으로 떨어집니다.

import { DEFAULT_POINT_AUTO_RULES, normalizePointAutoRules } from './pointAutoRules';

export const POINT_AUTO_RULES_KEY = 'point_auto_rules';

export async function getPointAutoRules(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', POINT_AUTO_RULES_KEY)
      .maybeSingle();
    if (error) throw error;
    return normalizePointAutoRules(data?.setting_value || DEFAULT_POINT_AUTO_RULES);
  } catch {
    return normalizePointAutoRules(DEFAULT_POINT_AUTO_RULES);
  }
}
