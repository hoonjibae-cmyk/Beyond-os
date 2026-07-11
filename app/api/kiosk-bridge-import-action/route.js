import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

const KIOSK_ALIAS_SOURCE = 'kiosk_alimtalk';

function safeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getBaseUrl(request) {
  const envUrl = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (envUrl) return envUrl.replace(/\/$/, '');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  if (host) return `${proto}://${host}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

async function getImportEvent(supabase, importEventId) {
  const { data, error } = await supabase
    .from('attendance_import_events')
    .select('*')
    .eq('id', importEventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureActiveStudent(supabase, studentId) {
  if (!studentId) return null;
  const { data, error } = await supabase
    .from('students')
    .select('id, name, status, default_seat_no')
    .eq('id', studentId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'inactive') return null;
  return data;
}

async function createOrUpdateAlias(supabase, { aliasName, studentId }) {
  const cleanAlias = safeText(aliasName);
  if (!cleanAlias) throw new Error('연결할 문자 학생명이 비어 있습니다.');
  const student = await ensureActiveStudent(supabase, studentId);
  if (!student) throw new Error('연결할 활성 학생을 찾을 수 없습니다.');

  const { data: existing, error: existingError } = await supabase
    .from('kiosk_student_aliases')
    .select('*')
    .eq('alias_name', cleanAlias)
    .eq('source', KIOSK_ALIAS_SOURCE)
    .eq('is_active', true)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { data, error } = await supabase
      .from('kiosk_student_aliases')
      .update({ student_id: student.id, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return { alias: data, student };
  }

  const { data, error } = await supabase
    .from('kiosk_student_aliases')
    .insert({ alias_name: cleanAlias, student_id: student.id, source: KIOSK_ALIAS_SOURCE, is_active: true })
    .select('*')
    .single();
  if (error) throw error;
  return { alias: data, student };
}

async function updateImportEvent(supabase, id, patch = {}) {
  const { data, error } = await supabase
    .from('attendance_import_events')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function reprocessImportEvent(request, supabase, importEvent, memo = '') {
  const secret = process.env.KIOSK_BRIDGE_SECRET || '';
  if (!secret) throw new Error('KIOSK_BRIDGE_SECRET 환경변수가 없어 재처리를 실행할 수 없습니다.');
  if (!importEvent?.raw_text) throw new Error('재처리할 키오스크 원문이 없습니다.');

  const baseUrl = getBaseUrl(request);
  if (!baseUrl) throw new Error('앱 URL을 확인할 수 없어 내부 재처리 요청을 보낼 수 없습니다. PUBLIC_APP_URL 또는 NEXT_PUBLIC_APP_URL 설정을 확인하세요.');

  const reprocessKey = `reprocess-${importEvent.id}-${Date.now()}`;
  const response = await fetch(`${baseUrl}/api/kiosk-attendance-bridge`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'x-kiosk-secret': secret,
      'x-source-device-id': importEvent.source_device_id || 'sms-bridge-phone-01',
    },
    body: JSON.stringify({
      rawText: importEvent.raw_text,
      sourceDeviceId: importEvent.source_device_id || 'sms-bridge-phone-01',
      receivedAt: importEvent.received_at || undefined,
      idempotencyKey: reprocessKey,
    }),
  });

  const data = await response.json().catch(() => ({}));
  const newImportId = data?.importEvent?.id || null;

  if (!response.ok || data.ok === false) {
    await updateImportEvent(supabase, importEvent.id, {
      operator_action: 'reprocess_failed',
      operator_memo: safeText(memo || data.error || '관리자 재처리 실패'),
      linked_import_event_id: newImportId,
      resolved_at: new Date().toISOString(),
      error_message: data.error || importEvent.error_message || '관리자 재처리 실패',
      processed_at: new Date().toISOString(),
    });
    return { ok: false, bridgeStatus: response.status, bridgeResponse: data, linkedImportEventId: newImportId };
  }

  const updatedOriginal = await updateImportEvent(supabase, importEvent.id, {
    status: 'reprocessed',
    operator_action: 'reprocessed',
    operator_memo: safeText(memo || '관리자 재처리 완료'),
    linked_import_event_id: newImportId,
    resolved_at: new Date().toISOString(),
    error_message: null,
    processed_at: new Date().toISOString(),
  });

  return { ok: true, bridgeStatus: response.status, bridgeResponse: data, linkedImportEventId: newImportId, originalImportEvent: updatedOriginal };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const importEventId = safeText(body.importEventId || body.id);
    const supabase = getSupabaseAdmin();

    if (action === 'delete_alias') {
      const aliasId = safeText(body.aliasId);
      if (!aliasId) return Response.json({ ok: false, error: '삭제할 연결 규칙 ID가 없습니다.' }, { status: 400 });
      const { data, error } = await supabase
        .from('kiosk_student_aliases')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', aliasId)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return Response.json({ ok: true, action, alias: data, toastMessage: '학생명 연결 규칙을 비활성화했습니다.' });
    }

    if (action === 'create_alias') {
      const result = await createOrUpdateAlias(supabase, { aliasName: body.aliasName, studentId: body.studentId });
      return Response.json({ ok: true, action, ...result, toastMessage: `${result.alias.alias_name} → ${result.student.name} 연결 규칙을 저장했습니다.` });
    }

    if (!importEventId) return Response.json({ ok: false, error: '처리할 수신 로그 ID가 없습니다.' }, { status: 400 });
    const importEvent = await getImportEvent(supabase, importEventId);
    if (!importEvent) return Response.json({ ok: false, error: '처리할 수신 로그를 찾을 수 없습니다.' }, { status: 404 });

    if (action === 'ignore') {
      const updated = await updateImportEvent(supabase, importEvent.id, {
        status: 'ignored',
        operator_action: 'ignored',
        operator_memo: safeText(body.memo || '관리자 무시 처리'),
        resolved_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
      });
      return Response.json({ ok: true, action, importEvent: updated, toastMessage: '키오스크 수신 로그를 무시 처리했습니다.' });
    }

    let aliasResult = null;
    if (action === 'alias_and_reprocess') {
      aliasResult = await createOrUpdateAlias(supabase, {
        aliasName: body.aliasName || importEvent.parsed_student_name,
        studentId: body.studentId,
      });
    }

    if (action === 'reprocess' || action === 'alias_and_reprocess') {
      const result = await reprocessImportEvent(request, supabase, importEvent, body.memo || '관리자 재처리');
      if (!result.ok) {
        return Response.json({
          ok: false,
          action,
          aliasResult,
          ...result,
          error: result.bridgeResponse?.error || '재처리 요청은 전송되었지만 자동반영에 실패했습니다.',
          toastMessage: result.bridgeResponse?.toastMessage || result.bridgeResponse?.error || '재처리 실패',
        }, { status: result.bridgeStatus || 500 });
      }
      return Response.json({
        ok: true,
        action,
        aliasResult,
        ...result,
        toastMessage: aliasResult
          ? `${aliasResult.alias.alias_name} → ${aliasResult.student.name} 연결 후 재처리했습니다.`
          : '키오스크 수신 로그를 재처리했습니다.',
      });
    }

    return Response.json({ ok: false, error: '지원하지 않는 키오스크 로그 처리 작업입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({
      ok: false,
      error: `${error.message || '키오스크 수신 로그 처리 실패'} / v41-05 SQL(beyond-os-supabase-kiosk-bridge-v41-05.sql) 실행 여부를 확인하세요.`,
    }, { status: 500 });
  }
}
