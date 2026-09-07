// Beyond OS v41-241
// 주간 순공 자동 상점 구간표 / 상품 지급 기준 설정 API입니다.
//
// 상벌점 관리 탭 안에서 바로 고칠 수 있게 별도 주소로 뺐습니다.
// (설정 탭의 운영 기준과 성격이 달라 섞지 않았습니다)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { DEFAULT_POINT_AUTO_RULES, normalizePointAutoRules } from '../../../lib/pointAutoRules';
import { POINT_AUTO_RULES_KEY, getPointAutoRules } from '../../../lib/pointAutoRulesServer';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    return Response.json({ rules: await getPointAutoRules(supabase) });
  } catch (error) {
    return Response.json({
      rules: normalizePointAutoRules(DEFAULT_POINT_AUTO_RULES),
      warning: error.message || '기본 기준을 사용합니다.',
    });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'points');
  if (denied) return denied;

  try {
    const body = await request.json();
    const rules = normalizePointAutoRules(body.rules || {});
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: POINT_AUTO_RULES_KEY,
        setting_value: rules,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'setting_key' })
      .select()
      .single();

    if (error) {
      return Response.json({
        error: `${error.message} / Supabase에서 beyond-os-supabase-operating-rules-v40-6.sql을 먼저 실행하세요.`,
      }, { status: 500 });
    }

    return Response.json({ rules: normalizePointAutoRules(data.setting_value), saved: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
