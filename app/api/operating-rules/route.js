import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

const SETTINGS_KEY = 'operating_rules';

const DEFAULT_RULES = {
  lowStudyMinutes: 300,
  lateThresholdMinutes: 1,
  earlyLeaveThresholdMinutes: 10,
  excessiveAwayCount: 2,
  excessiveAwayMinutes: 60,
  attentionKeywords: ['수면', '비학습', '주의', '집중', '졸', '태도', '휴대폰', '잡담'],
};

function normalizeRules(value = {}) {
  const merged = { ...DEFAULT_RULES, ...(value || {}) };
  const toNumber = (input, fallback) => {
    const n = Number(input);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const keywords = Array.isArray(merged.attentionKeywords)
    ? merged.attentionKeywords
    : String(merged.attentionKeywords || '').split(/[,\n]/);

  return {
    lowStudyMinutes: toNumber(merged.lowStudyMinutes, DEFAULT_RULES.lowStudyMinutes),
    lateThresholdMinutes: toNumber(merged.lateThresholdMinutes, DEFAULT_RULES.lateThresholdMinutes),
    earlyLeaveThresholdMinutes: toNumber(merged.earlyLeaveThresholdMinutes, DEFAULT_RULES.earlyLeaveThresholdMinutes),
    excessiveAwayCount: toNumber(merged.excessiveAwayCount, DEFAULT_RULES.excessiveAwayCount),
    excessiveAwayMinutes: toNumber(merged.excessiveAwayMinutes, DEFAULT_RULES.excessiveAwayMinutes),
    attentionKeywords: keywords.map((item) => String(item || '').trim()).filter(Boolean),
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .eq('setting_key', SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      return Response.json({
        rules: DEFAULT_RULES,
        warning: 'system_settings 테이블이 없어 기본 운영 기준을 사용합니다. v40-6 SQL을 실행하면 저장 기능을 사용할 수 있습니다.',
      });
    }

    return Response.json({ rules: normalizeRules(data?.setting_value || DEFAULT_RULES) });
  } catch (error) {
    return Response.json({ rules: DEFAULT_RULES, warning: error.message || '기본 운영 기준을 사용합니다.' });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json();
    const rules = normalizeRules(body.rules || {});
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from('system_settings')
      .upsert({
        setting_key: SETTINGS_KEY,
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

    return Response.json({ rules: normalizeRules(data.setting_value), saved: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
