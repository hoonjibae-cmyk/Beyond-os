import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString, diffMinutes } from '../../../lib/date';
import { calculateScheduledPureStudyMinutes } from '../../../lib/studyTime';
import { getDefaultScheduleSettings } from '../../../lib/defaultScheduleServer';
import { sendAttendanceNotification } from '../../../lib/attendanceNotifications';

export const dynamic = 'force-dynamic';

const EVENT_LABELS = { check_in: '입실', away: '외출', return: '복귀', check_out: '퇴실' };
const UNDO_WINDOW_MINUTES = 10;

function buildNextSession(existingSession, eventType, nowIso) {
  let awayTotalMinutes = Number(existingSession?.away_total_minutes || 0);
  let awayStartedAt = existingSession?.away_started_at || null;
  let checkInAt = existingSession?.check_in_at || null;
  let checkOutAt = existingSession?.check_out_at || null;
  let seatStatus = existingSession?.seat_status || 'not_arrived';

  if (eventType === 'check_in') {
    if (!checkInAt) checkInAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    }
    checkOutAt = null;
    seatStatus = 'occupied';
  } else if (eventType === 'away') {
    if (!checkInAt) checkInAt = nowIso;
    if (!awayStartedAt) awayStartedAt = nowIso;
    checkOutAt = null;
    seatStatus = 'away';
  } else if (eventType === 'return') {
    if (!checkInAt) checkInAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    }
    checkOutAt = null;
    seatStatus = 'occupied';
  } else if (eventType === 'check_out') {
    if (!checkInAt) checkInAt = nowIso;
    if (awayStartedAt) {
      awayTotalMinutes += diffMinutes(awayStartedAt, nowIso);
      awayStartedAt = null;
    }
    checkOutAt = nowIso;
    seatStatus = 'out';
  }

  return { awayTotalMinutes, awayStartedAt, checkInAt, checkOutAt, seatStatus };
}

// 세션 상태에 출결 이벤트 1건을 반영하고, notify=true 인 경우에만 학부모 알림을 발송합니다.
async function applySessionEvent({
  supabase,
  request,
  student,
  seatNo,
  eventType,
  eventAt,
  memo,
  sourceType = 'kiosk',
  sourceLabel = '키오스크 HOLD 관리자 승인',
  actorName,
  notify = true,
  importEventId = null,
}) {
  if (!student?.id) throw new Error('학생 정보를 찾을 수 없습니다.');
  const sessionDate = getKstDateString(new Date(eventAt));
  const { data: existingSession, error: existingError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', student.id)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (existingError) throw existingError;

  const next = buildNextSession(existingSession, eventType, eventAt);
  const defaultSchedule = await getDefaultScheduleSettings(supabase, sessionDate);
  const pureStudyMinutes = calculateScheduledPureStudyMinutes({
    check_in_at: next.checkInAt,
    check_out_at: next.checkOutAt,
    away_started_at: next.awayStartedAt,
    away_total_minutes: next.awayTotalMinutes,
  }, { nowIso: eventAt, studyWindows: defaultSchedule.studyWindows });

  const { data: session, error: sessionError } = await supabase
    .from('daily_sessions')
    .upsert({
      student_id: student.id,
      seat_no: seatNo || existingSession?.seat_no || student.default_seat_no,
      session_date: sessionDate,
      seat_status: next.seatStatus,
      check_in_at: next.checkInAt,
      check_out_at: next.checkOutAt,
      away_started_at: next.awayStartedAt,
      away_total_minutes: next.awayTotalMinutes,
      pure_study_minutes: pureStudyMinutes,
      pure_study_manual_text: null,
      attendance_memo: existingSession?.attendance_memo || null,
      current_study_status: existingSession?.current_study_status || null,
      current_subject: existingSession?.current_subject || null,
    }, { onConflict: 'student_id,session_date' })
    .select('*, students(*)')
    .single();
  if (sessionError) throw sessionError;

  const { data: attendanceEvent, error: eventError } = await supabase
    .from('attendance_events')
    .insert({
      session_id: session.id,
      student_id: student.id,
      seat_no: session.seat_no,
      event_type: eventType,
      event_at: eventAt,
      memo: memo || `쉬는 시간 HOLD에서 관리자 승인 (${actorName})`,
      created_by: actorName,
      source_type: sourceType,
      source_label: sourceLabel,
      import_event_id: importEventId,
    })
    .select()
    .single();
  if (eventError) throw eventError;

  let notification = null;
  if (notify) {
    try {
      notification = await sendAttendanceNotification({
        supabase,
        request,
        attendanceEvent,
        session,
        student,
        sourceType,
        sourceLabel,
        createdBy: actorName,
      });
    } catch (error) {
      notification = { ok: false, error: error.message || '출결 알림 처리 실패' };
    }
  }

  return { session, attendanceEvent, notification };
}

async function applyHeldEvent({ supabase, hold, request, actorName, notify = true }) {
  const student = hold.students;
  if (!student?.id) throw new Error('학생 정보를 찾을 수 없습니다.');
  return applySessionEvent({
    supabase,
    request,
    student,
    seatNo: hold.seat_no,
    eventType: hold.event_type,
    eventAt: hold.event_at,
    memo: hold.parsed_reason || `쉬는 시간 HOLD에서 관리자 승인 (${actorName})`,
    sourceType: 'kiosk',
    sourceLabel: '키오스크 HOLD 관리자 승인',
    actorName,
    notify,
    importEventId: hold.import_event_id,
  });
}

async function recordHoldAction(supabase, {
  hold,
  actionType,
  previousStatus,
  nextStatus,
  actorName,
  memo,
  attendanceEventId = null,
  batchId = null,
  payload = {},
}) {
  const { data, error } = await supabase
    .from('kiosk_attendance_hold_actions')
    .insert({
      hold_id: hold.id,
      batch_id: batchId || crypto.randomUUID(),
      action_type: actionType,
      previous_status: previousStatus || hold.status || null,
      next_status: nextStatus || null,
      actor_name: actorName,
      action_memo: memo || null,
      attendance_event_id: attendanceEventId || null,
      action_payload: payload || {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateImportForDiscard(supabase, hold, actorName, memo) {
  if (!hold.import_event_id) return;
  const { error } = await supabase
    .from('attendance_import_events')
    .update({
      status: 'ignored',
      operator_action: 'break_hold_discard',
      operator_memo: memo || '쉬는 시간 HOLD 삭제',
      resolved_at: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      error_message: `쉬는 시간 이동으로 처리 (${actorName})`,
    })
    .eq('id', hold.import_event_id);
  if (error) throw error;
}

async function updateImportForApply(supabase, hold, applied, memo) {
  if (!hold.import_event_id) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('attendance_import_events')
    .update({
      status: 'processed',
      session_id: applied.session.id,
      attendance_event_id: applied.attendanceEvent.id,
      seat_no: applied.session.seat_no,
      operator_action: 'break_hold_apply',
      operator_memo: memo || 'HOLD에서 실제 출결 반영',
      resolved_at: nowIso,
      processed_at: nowIso,
      error_message: null,
    })
    .eq('id', hold.import_event_id);
  if (error) throw error;
}

async function discardHold({ supabase, hold, actorName, memo, batchId }) {
  const nowIso = new Date().toISOString();
  const actionMemo = memo || '쉬는 시간 이동으로 판단하여 삭제';
  const { error } = await supabase
    .from('kiosk_attendance_holds')
    .update({
      status: 'discarded',
      operator_action: 'discard',
      operator_memo: actionMemo,
      resolved_by: actorName,
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', hold.id)
    .eq('status', 'pending');
  if (error) throw error;
  await updateImportForDiscard(supabase, hold, actorName, actionMemo);
  const action = await recordHoldAction(supabase, {
    hold,
    actionType: 'discard',
    previousStatus: 'pending',
    nextStatus: 'discarded',
    actorName,
    memo: actionMemo,
    batchId,
  });
  return { holdId: hold.id, action };
}

async function applyHold({ supabase, hold, request, actorName, memo, batchId, notify = true }) {
  const applied = await applyHeldEvent({ supabase, hold, request, actorName, notify });
  const nowIso = new Date().toISOString();
  const actionMemo = memo || (notify
    ? '관리자 판단으로 실제 출결 반영 (알림 발송)'
    : '관리자 판단으로 실제 출결 반영 (알림 미발송)');
  const { error: updateError } = await supabase
    .from('kiosk_attendance_holds')
    .update({
      status: 'applied',
      attendance_event_id: applied.attendanceEvent.id,
      session_id: applied.session.id,
      operator_action: 'apply',
      operator_memo: actionMemo,
      resolved_by: actorName,
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', hold.id)
    .eq('status', 'pending');
  if (updateError) throw updateError;
  await updateImportForApply(supabase, hold, applied, actionMemo);
  const action = await recordHoldAction(supabase, {
    hold,
    actionType: 'apply',
    previousStatus: 'pending',
    nextStatus: 'applied',
    actorName,
    memo: actionMemo,
    attendanceEventId: applied.attendanceEvent.id,
    batchId,
    payload: { session_id: applied.session.id, notified: Boolean(notify), notification: applied.notification || null },
  });
  return { holdId: hold.id, action, applied };
}

// 키오스크 신호가 불완전한 경우, 관리자가 최종 출결 상태를 직접 지정합니다.
async function applyManualFinalStatus({ supabase, request, actorName, holds, manual, batchId }) {
  const eventType = String(manual?.eventType || '').trim();
  const ALLOWED = ['check_in', 'away', 'return', 'check_out'];
  if (!ALLOWED.includes(eventType)) throw new Error('수동 지정할 최종 출결 상태를 선택하세요.');

  const anchor = holds[0];
  const student = anchor?.students;
  if (!student?.id) throw new Error('수동 지정 대상 학생 정보를 찾을 수 없습니다.');

  const sessionDate = getKstDateString(new Date(anchor.event_at));
  const rawTime = String(manual?.time || '').trim();
  let eventAt;
  if (/^\d{2}:\d{2}$/.test(rawTime)) {
    eventAt = new Date(`${sessionDate}T${rawTime}:00+09:00`).toISOString();
  } else {
    eventAt = new Date().toISOString();
  }

  const notify = manual?.notify !== false;
  const memo = String(manual?.memo || '').trim() || `관리자 최종 출결 수동 지정 (${actorName})`;

  const applied = await applySessionEvent({
    supabase,
    request,
    student,
    seatNo: anchor.seat_no,
    eventType,
    eventAt,
    memo,
    sourceType: 'manual',
    sourceLabel: '키오스크 HOLD 최종 출결 수동 지정',
    actorName,
    notify,
    importEventId: null,
  });

  const action = await recordHoldAction(supabase, {
    hold: anchor,
    actionType: 'manual_apply',
    previousStatus: anchor.status || 'pending',
    nextStatus: anchor.status || 'pending',
    actorName,
    memo,
    attendanceEventId: applied.attendanceEvent.id,
    batchId,
    payload: {
      manual: true,
      event_type: eventType,
      event_at: eventAt,
      notified: Boolean(notify),
      session_id: applied.session.id,
      notification: applied.notification || null,
    },
  });

  return { holdId: anchor.id, action, applied };
}

async function loadPendingHolds(supabase, ids) {
  let query = supabase
    .from('kiosk_attendance_holds')
    .select('*, students(*)')
    .eq('status', 'pending')
    .order('event_at', { ascending: true });
  if (ids?.length) query = query.in('id', ids);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

function rebuildStateFromEvents(events = []) {
  let awayTotalMinutes = 0;
  let awayStartedAt = null;
  let checkInAt = null;
  let checkOutAt = null;
  let seatStatus = 'not_arrived';

  for (const event of [...events].sort((a, b) => new Date(a.event_at) - new Date(b.event_at))) {
    const eventAt = event.event_at;
    if (!eventAt) continue;
    if (event.event_type === 'absent') {
      awayTotalMinutes = 0;
      awayStartedAt = null;
      checkInAt = null;
      checkOutAt = null;
      seatStatus = 'absent';
      continue;
    }
    if (event.event_type === 'needs_attention') {
      seatStatus = 'needs_attention';
      continue;
    }
    const next = buildNextSession({
      away_total_minutes: awayTotalMinutes,
      away_started_at: awayStartedAt,
      check_in_at: checkInAt,
      check_out_at: checkOutAt,
      seat_status: seatStatus,
    }, event.event_type, eventAt);
    awayTotalMinutes = next.awayTotalMinutes;
    awayStartedAt = next.awayStartedAt;
    checkInAt = next.checkInAt;
    checkOutAt = next.checkOutAt;
    seatStatus = next.seatStatus;
  }

  return { awayTotalMinutes, awayStartedAt, checkInAt, checkOutAt, seatStatus };
}

async function rebuildSessionAfterUndo({ supabase, hold }) {
  const sessionDate = getKstDateString(new Date(hold.event_at));
  const { data: existingSession, error: sessionError } = await supabase
    .from('daily_sessions')
    .select('*')
    .eq('student_id', hold.student_id)
    .eq('session_date', sessionDate)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!existingSession?.id) return null;

  const { data: events, error: eventsError } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('session_id', existingSession.id)
    .order('event_at', { ascending: true });
  if (eventsError) throw eventsError;

  const state = rebuildStateFromEvents(events || []);
  const defaultSchedule = await getDefaultScheduleSettings(supabase, existingSession.session_date || getKstDateString());
  const nowIso = new Date().toISOString();
  const pureStudyMinutes = state.seatStatus === 'absent'
    ? 0
    : calculateScheduledPureStudyMinutes({
      check_in_at: state.checkInAt,
      check_out_at: state.checkOutAt,
      away_started_at: state.awayStartedAt,
      away_total_minutes: state.awayTotalMinutes,
    }, { nowIso, studyWindows: defaultSchedule.studyWindows });

  const { data: rebuilt, error: rebuildError } = await supabase
    .from('daily_sessions')
    .update({
      seat_status: state.seatStatus,
      check_in_at: state.checkInAt,
      check_out_at: state.checkOutAt,
      away_started_at: state.awayStartedAt,
      away_total_minutes: state.awayTotalMinutes,
      pure_study_minutes: pureStudyMinutes,
      pure_study_manual_text: null,
    })
    .eq('id', existingSession.id)
    .select()
    .single();
  if (rebuildError) throw rebuildError;
  return rebuilt;
}

async function undoHoldAction({ supabase, action, actorName, batchId }) {
  const { data: hold, error: holdError } = await supabase
    .from('kiosk_attendance_holds')
    .select('*, students(*)')
    .eq('id', action.hold_id)
    .single();
  if (holdError) throw holdError;

  const ageMinutes = (Date.now() - new Date(action.created_at).getTime()) / 60000;
  if (!Number.isFinite(ageMinutes) || ageMinutes > UNDO_WINDOW_MINUTES) {
    throw new Error(`처리 후 ${UNDO_WINDOW_MINUTES}분이 지나 되돌릴 수 없습니다.`);
  }
  if (!['apply', 'discard'].includes(action.action_type)) throw new Error('이 처리 이력은 되돌릴 수 없습니다.');

  const { data: latestActions, error: latestError } = await supabase
    .from('kiosk_attendance_hold_actions')
    .select('id,action_type,created_at')
    .eq('hold_id', hold.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (latestError) throw latestError;
  if (latestActions?.[0]?.id !== action.id) throw new Error('이미 후속 처리가 있어 이 작업은 되돌릴 수 없습니다.');

  const nowIso = new Date().toISOString();
  let rebuiltSession = null;
  if (action.action_type === 'apply') {
    const attendanceEventId = action.attendance_event_id || hold.attendance_event_id;
    if (attendanceEventId) {
      const { error: deleteError } = await supabase.from('attendance_events').delete().eq('id', attendanceEventId);
      if (deleteError) throw deleteError;
    }
    rebuiltSession = await rebuildSessionAfterUndo({ supabase, hold });
  }

  const { error: restoreError } = await supabase
    .from('kiosk_attendance_holds')
    .update({
      status: 'pending',
      attendance_event_id: null,
      operator_action: null,
      operator_memo: null,
      resolved_by: null,
      resolved_at: null,
      updated_at: nowIso,
    })
    .eq('id', hold.id);
  if (restoreError) throw restoreError;

  if (hold.import_event_id) {
    const { error: importError } = await supabase
      .from('attendance_import_events')
      .update({
        status: 'held',
        attendance_event_id: null,
        session_id: rebuiltSession?.id || hold.session_id || null,
        operator_action: 'break_hold_undo',
        operator_memo: `${action.action_type === 'apply' ? '실제 출결 반영' : '쉬는 시간 처리'} 되돌리기 (${actorName})`,
        error_message: '쉬는 시간 HOLD 판정 대기로 복원됨',
        resolved_at: null,
        processed_at: nowIso,
      })
      .eq('id', hold.import_event_id);
    if (importError) throw importError;
  }

  const undoAction = await recordHoldAction(supabase, {
    hold,
    actionType: action.action_type === 'apply' ? 'undo_apply' : 'undo_discard',
    previousStatus: action.next_status || hold.status,
    nextStatus: 'pending',
    actorName,
    memo: `${action.action_type === 'apply' ? '실제 출결 반영' : '쉬는 시간 처리'} 되돌리기`,
    batchId,
    payload: { original_action_id: action.id, original_batch_id: action.batch_id || null },
  });
  return { holdId: hold.id, undoAction, rebuiltSession };
}

async function loadActionHistory(supabase, limit = 60) {
  const normalizedLimit = Math.max(10, Math.min(200, Number(limit) || 60));
  const { data: actions, error } = await supabase
    .from('kiosk_attendance_hold_actions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(normalizedLimit);
  if (error) throw error;
  const holdIds = Array.from(new Set((actions || []).map((item) => item.hold_id).filter(Boolean)));
  let holds = [];
  if (holdIds.length) {
    const { data, error: holdsError } = await supabase
      .from('kiosk_attendance_holds')
      .select('*, students(id,name,grade,school,default_seat_no)')
      .in('id', holdIds);
    if (holdsError) throw holdsError;
    holds = data || [];
  }
  const holdById = Object.fromEntries(holds.map((item) => [item.id, item]));
  const latestActionByHold = {};
  for (const action of actions || []) {
    if (!latestActionByHold[action.hold_id]) latestActionByHold[action.hold_id] = action.id;
  }
  return (actions || []).map((action) => {
    const ageMinutes = (Date.now() - new Date(action.created_at).getTime()) / 60000;
    return {
      ...action,
      hold: holdById[action.hold_id] || null,
      undoable: ['apply', 'discard'].includes(action.action_type)
        && latestActionByHold[action.hold_id] === action.id
        && Number.isFinite(ageMinutes)
        && ageMinutes <= UNDO_WINDOW_MINUTES,
      undo_window_minutes: UNDO_WINDOW_MINUTES,
    };
  });
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  const supabase = getSupabaseAdmin();
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';
    const includeHistory = url.searchParams.get('includeHistory') === '1' || status === 'history';
    const limit = Math.max(10, Math.min(200, Number(url.searchParams.get('limit')) || 100));

    let holds = [];
    if (status !== 'history') {
      let query = supabase
        .from('kiosk_attendance_holds')
        .select('*, students(id, name, grade, school, default_seat_no)')
        .order('event_at', { ascending: false })
        .limit(limit);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      holds = data || [];
    }

    const history = includeHistory ? await loadActionHistory(supabase, 80) : [];
    return Response.json({ holds, history, undoWindowMinutes: UNDO_WINDOW_MINUTES });
  } catch (error) {
    return Response.json({ error: error.message || 'HOLD 목록 조회 실패' }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  const supabase = getSupabaseAdmin();
  const actor = getAuthorizedUser(request);
  const actorName = actor?.displayName || '관리자';
  try {
    const body = await request.json();
    const action = String(body.action || '');
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [body.id].filter(Boolean);
    const batchId = body.batchId || crypto.randomUUID();

    if (action === 'undo' || action === 'undo_batch') {
      const actionIds = Array.isArray(body.actionIds) ? body.actionIds.filter(Boolean) : [body.actionId].filter(Boolean);
      if (!actionIds.length) return Response.json({ error: '되돌릴 처리 이력을 선택하세요.' }, { status: 400 });
      const { data: actions, error: actionsError } = await supabase
        .from('kiosk_attendance_hold_actions')
        .select('*')
        .in('id', actionIds)
        .order('created_at', { ascending: true });
      if (actionsError) throw actionsError;
      const results = [];
      for (const historyAction of actions || []) {
        results.push(await undoHoldAction({ supabase, action: historyAction, actorName, batchId }));
      }
      return Response.json({
        ok: true,
        undone: results.length,
        results,
        message: `${results.length}건의 HOLD 처리를 판정 대기로 되돌렸습니다. 이미 발송된 학부모 알림은 취소되지 않습니다.`,
      });
    }

    if (!ids.length) return Response.json({ error: '처리할 HOLD 항목을 선택하세요.' }, { status: 400 });
    const holds = await loadPendingHolds(supabase, ids);
    if (!holds.length) return Response.json({ error: '판정 대기 중인 HOLD 항목을 찾을 수 없습니다.' }, { status: 404 });

    if (action === 'discard' || action === 'bulk_discard' || action === 'discard_group') {
      const results = [];
      for (const hold of holds) results.push(await discardHold({ supabase, hold, actorName, memo: body.memo, batchId }));
      return Response.json({ ok: true, discarded: results.length, results, message: `${results.length}건을 쉬는 시간 이동으로 처리했습니다.` });
    }

    if (action === 'apply' || action === 'apply_group') {
      if (action === 'apply' && holds.length !== 1) return Response.json({ error: '단일 출결 반영은 한 건씩 처리하세요.' }, { status: 400 });
      const results = [];
      for (const hold of holds) results.push(await applyHold({ supabase, hold, request, actorName, memo: body.memo, batchId }));
      return Response.json({
        ok: true,
        appliedCount: results.length,
        results,
        message: `${results.length}건을 실제 출결로 반영했습니다.`,
      });
    }

    // v41-107: 실제 출결 반영 취사선택 — 신호별로 (반영+알림 / 반영만 / 제외) 를 지정하고,
    // 키오스크 기록이 불완전하면 관리자가 최종 출결 상태를 직접 수동 지정할 수 있습니다.
    if (action === 'apply_selective') {
      const signalModes = (body.signalModes && typeof body.signalModes === 'object') ? body.signalModes : {};
      const orderedHolds = [...holds].sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
      const applied = [];
      const notified = [];
      const discarded = [];
      for (const hold of orderedHolds) {
        const mode = signalModes[hold.id] || 'apply_silent';
        if (mode === 'discard') {
          const result = await discardHold({ supabase, hold, actorName, memo: body.memo, batchId });
          discarded.push(result);
        } else {
          const notify = mode === 'apply_notify';
          const result = await applyHold({ supabase, hold, request, actorName, memo: body.memo, batchId, notify });
          applied.push(result);
          if (notify) notified.push(result);
        }
      }

      let manualResult = null;
      if (body.manual && String(body.manual.eventType || '').trim()) {
        manualResult = await applyManualFinalStatus({ supabase, request, actorName, holds: orderedHolds, manual: body.manual, batchId });
      }

      const parts = [];
      if (applied.length) parts.push(`반영 ${applied.length}건`);
      if (notified.length) parts.push(`알림 ${notified.length}건`);
      if (discarded.length) parts.push(`쉬는 시간 처리 ${discarded.length}건`);
      if (manualResult) parts.push('최종 상태 수동 지정 1건');
      return Response.json({
        ok: true,
        appliedCount: applied.length,
        notifiedCount: notified.length + (manualResult && manualResult.action?.action_payload?.notified ? 1 : 0),
        discardedCount: discarded.length,
        manual: Boolean(manualResult),
        message: parts.length ? `${parts.join(' · ')} 처리했습니다.` : '처리할 항목이 없습니다.',
      });
    }

    return Response.json({ error: '지원하지 않는 action입니다.' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message || 'HOLD 처리 실패' }, { status: 500 });
  }
}
