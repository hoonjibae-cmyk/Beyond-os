// Beyond OS v41-158
// 리포트 예약 발송 관리 API입니다.
//
//   GET  : 예약 목록 (기본은 대기 중 + 최근 처리분)
//   POST : create(예약 생성) / cancel(예약 취소) / delete(기록 삭제) / run_now(지금 바로 실행)
//
// 실제 발송은 /api/cron/report-send 가 예약 시각에 처리합니다.
// 이 라우트는 큐에 넣고 빼는 일만 합니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import {
  REPORT_SCHEDULE_TYPES,
  SCHEDULE_STATUS_LABELS,
  normalizeReportScheduleType,
  normalizeTargets,
  validateScheduledAt,
  buildScheduleLabel,
} from '../../../lib/reportSchedules';
import { runDueReportSchedules } from '../cron/report-send/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SQL_HINT = 'beyond-os-supabase-report-send-schedules-v41-158.sql 실행 여부를 확인하세요.';

// 예약 종류에 따라 필요한 탭 권한이 다릅니다.
function permissionKeyFor(reportType) {
  return reportType === 'weekly' ? 'weeklyReports' : 'dailyReports';
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const reportType = normalizeReportScheduleType(searchParams.get('reportType'));

    let query = supabase
      .from('report_send_schedules')
      .select('*')
      .order('scheduled_at', { ascending: true })
      .limit(200);
    if (reportType) query = query.eq('report_type', reportType);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    return Response.json({
      ok: true,
      rows,
      statusLabels: SCHEDULE_STATUS_LABELS,
      types: REPORT_SCHEDULE_TYPES,
      summary: {
        pending: rows.filter((row) => row.status === 'pending').length,
        processing: rows.filter((row) => row.status === 'processing').length,
        done: rows.filter((row) => row.status === 'done').length,
        failed: rows.filter((row) => row.status === 'failed').length,
      },
      // Cron 미설정 환경에서 화면에 안내를 띄우기 위한 표시
      cronConfigured: Boolean(String(process.env.CRON_SECRET || '').trim()),
    });
  } catch (error) {
    return Response.json({ error: `${error.message || '예약 목록 조회 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const action = String(body.action || '').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    // ── 예약 생성 ────────────────────────────────────────────
    if (action === 'create') {
      const reportType = normalizeReportScheduleType(body.reportType);
      if (!reportType) return Response.json({ error: 'reportType은 daily 또는 weekly여야 합니다.' }, { status: 400 });

      const denied = requireTabPermission(request, permissionKeyFor(reportType));
      if (denied) return denied;

      const targets = normalizeTargets(body.targets);
      if (!targets.length) return Response.json({ error: '예약할 대상이 없습니다.' }, { status: 400 });

      const check = validateScheduledAt(body.scheduledAt);
      if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

      const { data, error } = await supabase
        .from('report_send_schedules')
        .insert({
          report_type: reportType,
          scheduled_at: check.iso,
          status: 'pending',
          targets,
          target_count: targets.length,
          label: buildScheduleLabel(reportType, targets, String(body.periodLabel || '').slice(0, 60)),
          memo: String(body.memo || '').slice(0, 300) || null,
          created_by: actorName,
        })
        .select()
        .single();
      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'report_schedule.create',
        targetType: 'report_schedule',
        targetId: data.id,
        targetName: data.label || '',
        payload: { reportType, scheduledAt: check.iso, count: targets.length },
      }).catch(() => {});

      return Response.json({
        ok: true,
        row: data,
        message: `${targets.length}건을 예약했습니다. 예약 시각에 자동 발송됩니다.`,
      });
    }

    // ── 예약 취소 ────────────────────────────────────────────
    if (action === 'cancel') {
      const id = String(body.id || '').trim();
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data: row, error: rowError } = await supabase
        .from('report_send_schedules').select('*').eq('id', id).maybeSingle();
      if (rowError) throw rowError;
      if (!row) return Response.json({ error: '예약을 찾지 못했습니다.' }, { status: 404 });

      const denied = requireTabPermission(request, permissionKeyFor(row.report_type));
      if (denied) return denied;

      // 이미 발송이 시작된 예약은 되돌리지 않습니다.
      if (row.status !== 'pending') {
        return Response.json({
          error: `이미 ${SCHEDULE_STATUS_LABELS[row.status] || row.status} 상태여서 취소할 수 없습니다.`,
        }, { status: 400 });
      }

      const { data, error } = await supabase
        .from('report_send_schedules')
        .update({ status: 'canceled', canceled_by: actorName })
        .eq('id', id)
        .eq('status', 'pending')
        .select()
        .single();
      if (error) throw error;

      await writeUserActionLog(supabase, request, {
        actionType: 'report_schedule.cancel',
        targetType: 'report_schedule',
        targetId: id,
        targetName: row.label || '',
        payload: {},
      }).catch(() => {});

      return Response.json({ ok: true, row: data, message: '예약을 취소했습니다.' });
    }

    // ── 기록 삭제 ────────────────────────────────────────────
    if (action === 'delete') {
      const id = String(body.id || '').trim();
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data: row } = await supabase
        .from('report_send_schedules').select('report_type, status').eq('id', id).maybeSingle();
      if (row) {
        const denied = requireTabPermission(request, permissionKeyFor(row.report_type));
        if (denied) return denied;
        if (row.status === 'processing') {
          return Response.json({ error: '발송 중인 예약은 삭제할 수 없습니다.' }, { status: 400 });
        }
      }

      const { error } = await supabase.from('report_send_schedules').delete().eq('id', id);
      if (error) throw error;
      return Response.json({ ok: true, message: '예약 기록을 삭제했습니다.' });
    }

    // ── 지금 바로 실행 ───────────────────────────────────────
    // Cron을 기다리지 않고 즉시 처리합니다. (예약 시각이 지났는지와 무관)
    if (action === 'run_now') {
      const id = String(body.id || '').trim();
      if (!id) return Response.json({ error: 'id is required' }, { status: 400 });

      const { data: row } = await supabase
        .from('report_send_schedules').select('report_type, status').eq('id', id).maybeSingle();
      if (!row) return Response.json({ error: '예약을 찾지 못했습니다.' }, { status: 404 });
      const denied = requireTabPermission(request, permissionKeyFor(row.report_type));
      if (denied) return denied;
      if (row.status !== 'pending') {
        return Response.json({
          error: `${SCHEDULE_STATUS_LABELS[row.status] || row.status} 상태여서 실행할 수 없습니다.`,
        }, { status: 400 });
      }

      const result = await runDueReportSchedules({ supabase, scheduleId: id, ignoreSchedule: true, actorName });
      return Response.json({
        ok: true,
        ...result,
        message: result.message || '예약을 지금 실행했습니다.',
      });
    }

    return Response.json({ error: `Unknown action: ${action || '-'}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: `${error.message || '예약 처리 실패'} / ${SQL_HINT}` }, { status: 500 });
  }
}
