import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { createNoticeToken as createToken, getNoticeLink } from '../../../lib/noticeShare';
import { getNoticeCategory, DEFAULT_NOTICE_CATEGORY } from '../../../lib/noticeTemplates';

export const dynamic = 'force-dynamic';

function withLink(request, notice) {
  return { ...notice, publicUrl: getNoticeLink(request, notice) };
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('notices')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      return Response.json({ notices: [], warning: `${error.message} / notices 테이블이 없으면 beyond-os-supabase-notices-v41-66.sql을 먼저 실행하세요.` });
    }
    return Response.json({ notices: (data || []).map((row) => withLink(request, row)) });
  } catch (error) {
    return Response.json({ notices: [], warning: error.message || 'Unknown error' });
  }
}

export async function POST(request) {
  // 공지 작성/저장은 설정(총괄관리자) 권한으로 제한
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;
  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    if (!title) return Response.json({ error: '공지 제목을 입력하세요.' }, { status: 400 });

    const category = String(body.category || DEFAULT_NOTICE_CATEGORY);
    const cat = getNoticeCategory(category);
    const templateData = (body.templateData && typeof body.templateData === 'object') ? body.templateData : {};

    const externalUrl = String(body.externalUrl || '').trim() || null;
    const content = String(body.body || '').trim() || null;

    if (cat.input === 'fields') {
      // 링크 없이 항목값(기간/사유/내용)을 알림톡 본문에 직접 표기하는 유형
      const missing = cat.fields.filter((f) => !String(templateData[f.key] || '').trim());
      if (missing.length) {
        return Response.json({ error: `다음 항목을 입력하세요: ${missing.map((f) => f.label).join(', ')}` }, { status: 400 });
      }
    } else {
      if (!externalUrl && !content) {
        return Response.json({ error: '공지 본문을 작성하거나 외부 웹링크 URL을 입력하세요.' }, { status: 400 });
      }
      if (externalUrl && !/^https?:\/\//i.test(externalUrl)) {
        return Response.json({ error: '외부 웹링크는 http:// 또는 https:// 로 시작해야 합니다.' }, { status: 400 });
      }
    }

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const noticeId = body.id || null;

    const payload = {
      title,
      body: cat.input === 'fields' ? null : content,
      external_url: cat.input === 'fields' ? null : externalUrl,
      category: cat.key,
      template_data: cat.input === 'fields' ? templateData : null,
      updated_at: new Date().toISOString(),
    };

    let saved;
    if (noticeId) {
      const { data, error } = await supabase.from('notices').update(payload).eq('id', noticeId).select().single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase
        .from('notices')
        .insert({ ...payload, token: createToken(), status: 'draft', created_by: actor?.displayName || '관리자' })
        .select()
        .single();
      if (error) throw error;
      saved = data;
    }

    // 토큰이 없던 기존 행 보정
    if (!saved.token) {
      const { data } = await supabase.from('notices').update({ token: createToken() }).eq('id', saved.id).select().single();
      if (data) saved = data;
    }

    await writeUserActionLog(supabase, request, {
      actionType: noticeId ? 'notice.update' : 'notice.create',
      targetType: 'notice',
      targetId: saved.id,
      targetName: saved.title,
      payload: { category: cat.key, hasExternalUrl: Boolean(externalUrl) },
    });

    return Response.json({ notice: withLink(request, saved) });
  } catch (error) {
    return Response.json({ error: `${error.message || 'Unknown error'} / notices 테이블/컬럼이 없으면 beyond-os-supabase-notices-v41-66.sql 및 beyond-os-supabase-notices-categories-v41-70.sql을 먼저 실행하세요.` }, { status: 500 });
  }
}

export async function DELETE(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;
  try {
    const body = await request.json();
    const id = body.id;
    if (!id) return Response.json({ error: 'id가 필요합니다.' }, { status: 400 });
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('notices').delete().eq('id', id);
    if (error) throw error;
    await writeUserActionLog(supabase, request, { actionType: 'notice.delete', targetType: 'notice', targetId: id });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
