// Beyond OS v41-151
// 학부모 시간표 최종 확인 링크 관리 API (관리자용).
//
//   GET  : 기간별 확인 요청 목록과 상태
//   POST : create_links(링크 생성) / apply(학부모 수정 요청을 시간표에 반영) / delete
//
// 학부모가 제출한 수정 내용은 자동 반영하지 않습니다.
// 관리자가 화면에서 확인한 뒤 [반영]을 눌러야 개인 시간표가 바뀝니다.

import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import { DAY_KEYS, DAY_LABELS, expandPatternToDates } from '../../../lib/scheduleImport';

export const dynamic = 'force-dynamic';

const SQL_HINT = 'beyond-os-supabase-schedule-confirmations-v41-151.sql 실행 여부를 확인하세요.';
const MAX_RANGE_DAYS = 120;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}
function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
}
function createToken() {
  return crypto.randomBytes(18).toString('base64url');
}
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function getPublicBaseUrl(request) {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host') || process.env.VERCEL_URL || '';
  if (!host) return '';
  const proto = request?.headers?.get?.('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

// 저장/전송 전에 요일 시간표를 안전한 형태로 다듬습니다.
export function normalizeWeekPattern(days = {}) {
  const out = {};
  for (const dayKey of DAY_KEYS) {
    const config = days?.[dayKey];
    if (!config) { out[dayKey] = null; continue; }
    if (config.absent) { out[dayKey] = { absent: true }; continue; }
    const checkIn = isValidTime(config.checkIn) ? config.checkIn : '';
    const checkOut = isValidTime(config.checkOut) ? config.checkOut : '';
    if (!checkIn && !checkOut) { out[dayKey] = null; continue; }
    const breaks = (Array.isArray(config.breaks) ? config.breaks : [])
      .filter((item) => isValidTime(item?.start))
      .slice(0, 4)
      .map((item) => ({
        start: item.start,
        end: isValidTime(item.end) ? item.end : '',
        reason: String(item.reason || '').slice(0, 60),
      }));
    out[dayKey] = { checkIn, checkOut, breaks };
  }
  return out;
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    let query = supabase
      .from('schedule_confirmations')
      .select('*, students(id, name, school, grade, status)')
      .order('updated_at', { ascending: false })
      .limit(300);
    if (isValidDate(startDate)) query = query.eq('start_date', startDate);
    if (isValidDate(endDate)) query = query.eq('end_date', endDate);

    const { data, error } = await query;
    if (error) throw error;

    const base = getPublicBaseUrl(request);
    const rows = (data || []).map((row) => ({
      ...row,
      url: base && row.token ? `${base}/s/${row.token}` : '',
    }));

    return Response.json({
      ok: true,
      rows,
      summary: {
        total: rows.length,
        pending: rows.filter((row) => row.status === 'pending').length,
        confirmed: rows.filter((row) => row.status === 'confirmed').length,
        changeRequested: rows.filter((row) => row.status === 'change_requested').length,
        applied: rows.filter((row) => row.applied_at).length,
      },
      dayLabels: DAY_LABELS,
    });
  } catch (error) {
    return Response.json({ error: `${error.message || '확인 요청 조회 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'schedules');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';
    const today = getKstDateString();

    // ── 확인 링크 생성 ────────────────────────────────────────
    if (action === 'create_links') {
      const startDate = isValidDate(body.startDate) ? body.startDate : today;
      const endDate = isValidDate(body.endDate) ? body.endDate : startDate;
      if (endDate < startDate) return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });

      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (!entries.length) return Response.json({ error: '대상 학생이 없습니다.' }, { status: 400 });

      const base = getPublicBaseUrl(request);
      const created = [];

      for (const entry of entries) {
        const studentId = String(entry.studentId || '').trim();
        if (!studentId) continue;
        const snapshot = { days: normalizeWeekPattern(entry.days || {}) };

        // 같은 학생·같은 기간 요청이 이미 있으면 시간표만 갱신하고 링크는 유지합니다.
        const { data: existing } = await supabase
          .from('schedule_confirmations')
          .select('id, token, status')
          .eq('student_id', studentId)
          .eq('start_date', startDate)
          .eq('end_date', endDate)
          .maybeSingle();

        let row = null;
        if (existing?.id) {
          const { data, error } = await supabase
            .from('schedule_confirmations')
            .update({ snapshot, cohort_id: body.cohortId || null, updated_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select()
            .single();
          if (error) throw error;
          row = data;
        } else {
          const { data, error } = await supabase
            .from('schedule_confirmations')
            .insert({
              token: createToken(),
              student_id: studentId,
              cohort_id: body.cohortId || null,
              start_date: startDate,
              end_date: endDate,
              status: 'pending',
              snapshot,
              created_by: actorName,
            })
            .select()
            .single();
          if (error) throw error;
          row = data;
        }

        created.push({
          id: row.id,
          studentId,
          studentName: entry.studentName || '',
          token: row.token,
          url: base ? `${base}/s/${row.token}` : '',
          status: row.status,
        });
      }

      await writeUserActionLog(supabase, request, {
        actionType: 'schedule_confirm.create',
        targetType: 'schedule_confirmation',
        targetName: `${startDate}~${endDate}`,
        payload: { count: created.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        created,
        message: `학부모 확인 링크 ${created.length}건을 만들었습니다.`,
      });
    }

    // ── 학부모 수정 요청을 실제 시간표에 반영 ─────────────────
    if (action === 'apply') {
      const id = String(body.id || '').trim();
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data: row, error: rowError } = await supabase
        .from('schedule_confirmations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (rowError) throw rowError;
      if (!row) return Response.json({ error: '확인 요청을 찾지 못했습니다.' }, { status: 404 });

      // 수정 요청이면 학부모가 낸 값을, 그대로 확인이면 원래 시간표를 씁니다.
      const source = row.status === 'change_requested' && row.response?.days ? row.response.days : row.snapshot?.days;
      const days = normalizeWeekPattern(source || {});

      const dates = expandPatternToDates({ days }, row.start_date, row.end_date, MAX_RANGE_DAYS + 1);
      if (!dates.length) {
        return Response.json({ error: '반영할 등원일이 없습니다.' }, { status: 400 });
      }

      const payloads = dates.map((item) => ({
        student_id: row.student_id,
        schedule_date: item.date,
        planned_check_in: item.checkIn || '09:00',
        planned_check_out: item.checkOut || '22:00',
        schedule_note: '학부모 확인 시간표',
        created_by: actorName,
      }));

      for (const group of chunk(payloads, 300)) {
        const { error } = await supabase
          .from('student_daily_schedules')
          .upsert(group, { onConflict: 'student_id,schedule_date' });
        if (error) throw error;
      }

      // 외출도 함께 반영합니다.
      try {
        const { data: scheduleRows } = await supabase
          .from('student_daily_schedules')
          .select('id, schedule_date')
          .eq('student_id', row.student_id)
          .gte('schedule_date', row.start_date)
          .lte('schedule_date', row.end_date);
        const idByDate = {};
        for (const item of scheduleRows || []) idByDate[item.schedule_date] = item.id;

        const breakRows = [];
        for (const item of dates) {
          const scheduleId = idByDate[item.date];
          if (!scheduleId) continue;
          for (const gap of item.breaks || []) {
            if (!gap?.start) continue;
            breakRows.push({
              schedule_id: scheduleId,
              leave_start: gap.start,
              return_time: gap.end || null,
              reason: '학원',
              reason_detail: String(gap.reason || '').slice(0, 100) || null,
            });
          }
        }
        const touchedIds = dates.map((item) => idByDate[item.date]).filter(Boolean);
        if (touchedIds.length) {
          await supabase.from('student_schedule_breaks').delete().in('schedule_id', touchedIds);
        }
        if (breakRows.length) {
          for (const group of chunk(breakRows, 300)) {
            await supabase.from('student_schedule_breaks').insert(group);
          }
        }
      } catch {
        // 외출 반영 실패는 등하원 반영을 되돌리지 않습니다.
      }

      const { data: updated, error: updateError } = await supabase
        .from('schedule_confirmations')
        .update({ applied_at: new Date().toISOString(), applied_by: actorName })
        .eq('id', id)
        .select()
        .single();
      if (updateError) throw updateError;

      await writeUserActionLog(supabase, request, {
        actionType: 'schedule_confirm.apply',
        targetType: 'schedule_confirmation',
        targetId: id,
        payload: { dates: dates.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        row: updated,
        message: `${dates.length}일치 시간표에 반영했습니다.`,
      });
    }

    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
      const { error } = await supabase.from('schedule_confirmations').delete().eq('id', id);
      if (error) throw error;
      return Response.json({ ok: true, message: '확인 요청을 삭제했습니다.' });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: `${error.message || '확인 요청 처리 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}
