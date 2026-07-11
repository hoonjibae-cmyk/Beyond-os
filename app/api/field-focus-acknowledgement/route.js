import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function toNullableNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const date = searchParams.get('date') || getKstDateString();

    let query = supabase
      .from('field_focus_acknowledgements')
      .select('*')
      .eq('is_active', true);

    if (start || end) {
      if (start) query = query.gte('ack_date', String(start).slice(0, 10));
      if (end) query = query.lte('ack_date', String(end).slice(0, 10));
      query = query.order('ack_date', { ascending: false }).order('dismissed_at', { ascending: false });
    } else {
      query = query.eq('ack_date', date).order('dismissed_at', { ascending: false });
    }

    const { data, error } = await query;

    if (error) throw error;
    return Response.json({ ok: true, date, start: start || date, end: end || date, acknowledgements: data || [] });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || '관리필요 확인 이력 조회 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const alertId = cleanString(body.alertId);
    if (!alertId) {
      return Response.json({ ok: false, error: 'alertId가 필요합니다.' }, { status: 400 });
    }

    const ackDate = cleanString(body.scheduleDate, getKstDateString()).slice(0, 10);
    const nowIso = new Date().toISOString();
    const supabase = getSupabaseAdmin();

    const payload = {
      ack_date: ackDate,
      alert_id: alertId,
      alert_type: cleanString(body.alertType, 'unknown'),
      alert_title: cleanString(body.alertTitle, '관리필요 확인'),
      alert_body: cleanString(body.alertBody),
      student_id: cleanString(body.studentId) || null,
      student_name: cleanString(body.studentName) || null,
      seat_no: toNullableNumber(body.seatNo),
      planned_time: cleanString(body.plannedTime) || null,
      current_status: cleanString(body.currentStatus) || null,
      memo: cleanString(body.memo, '현장 확인 완료'),
      admin_name: cleanString(body.adminName, '관리자'),
      dismissed_at: nowIso,
      is_active: true,
      updated_at: nowIso,
    };

    const { data, error } = await supabase
      .from('field_focus_acknowledgements')
      .upsert(payload, { onConflict: 'ack_date,alert_id' })
      .select()
      .single();

    if (error) throw error;

    return Response.json({
      ok: true,
      acknowledgement: data,
      message: '집중관리대상 확인/해제 이력이 저장되었습니다.',
    });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || '집중관리대상 해제 저장 실패' }, { status: 500 });
  }
}
