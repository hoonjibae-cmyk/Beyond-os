import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const DEFAULT_USER_PERMISSIONS = {
  dashboard: true,
  schedules: true,
  planner: true,
  dailyReports: true,
  weeklyReports: true,
  ranking: true,
  attendance: true,
  attention: true,
  settings: false,
  userManagement: false,
};

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

function safeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

export async function POST(request) {
  try {
    const body = await request.json();
    const username = normalizeUsername(body.username);
    const displayName = safeText(body.displayName || body.display_name, 80);
    const email = safeText(body.email, 160);
    const phone = safeText(body.phone, 40);
    const memo = safeText(body.memo, 500);
    const privacyAgreed = Boolean(body.privacyAgreed || body.privacy_agreed);
    const termsAgreed = Boolean(body.termsAgreed || body.terms_agreed);

    if (!displayName) return Response.json({ error: '이름을 입력하세요.' }, { status: 400 });
    if (!username) return Response.json({ error: '아이디를 입력하세요. 영문, 숫자, 점, 하이픈, 밑줄만 사용할 수 있습니다.' }, { status: 400 });
    if (username.length < 3) return Response.json({ error: '아이디는 3자 이상으로 입력하세요.' }, { status: 400 });
    if (!email) return Response.json({ error: '이메일을 입력하세요.' }, { status: 400 });
    if (!phone) return Response.json({ error: '휴대폰번호를 입력하세요.' }, { status: 400 });
    if (!privacyAgreed || !termsAgreed) return Response.json({ error: '개인정보 수집·이용 동의와 프로그램 사용 동의가 모두 필요합니다.' }, { status: 400 });

    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from('app_users')
      .select('id, username, status')
      .eq('username', username)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
      return Response.json({ error: '이미 사용 중이거나 승인 대기 중인 아이디입니다.' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const { data: saved, error } = await supabase
      .from('app_users')
      .insert({
        username,
        display_name: displayName,
        email,
        phone,
        role: 'user',
        status: 'pending',
        permissions: DEFAULT_USER_PERMISSIONS,
        privacy_agreed_at: now,
        terms_agreed_at: now,
        memo,
      })
      .select()
      .single();

    if (error) throw error;

    try {
      await supabase.from('user_action_logs').insert({
        user_id: saved.id,
        actor_name: displayName,
        action_type: 'user.signup.request',
        target_type: 'app_user',
        target_id: saved.id,
        target_name: displayName,
        payload: {
          username,
          email,
          phone,
          memo,
          privacyAgreed,
          termsAgreed,
        },
      });
    } catch {
      // 로그 저장 실패가 계정 신청 자체를 막지는 않습니다.
    }

    return Response.json({
      ok: true,
      user: {
        id: saved.id,
        username: saved.username,
        displayName: saved.display_name,
        status: saved.status,
      },
      message: '계정 생성 신청이 완료되었습니다. 관리자 승인 후 프로그램 접속이 가능합니다.',
    });
  } catch (error) {
    return Response.json({
      error: error.message || '계정 생성 신청 중 오류가 발생했습니다.',
      hint: 'v40-59 SQL(beyond-os-supabase-user-access-v40-59.sql)이 실행되어 있어야 합니다.',
    }, { status: 500 });
  }
}
