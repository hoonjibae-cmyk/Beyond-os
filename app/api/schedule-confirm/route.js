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
import { DAY_KEYS, DAY_LABELS, expandPatternToDates, applySpecialToDates } from '../../../lib/scheduleImport';
import { buildSpecialOverrides } from '../../../lib/specialScheduleParse';
import { normalizeCohort } from '../../../lib/cohorts';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

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

const SPECIAL_TYPES = ['absent', 'away', 'start_from', 'unknown'];

/**
 * v41-152: 특별 일정 항목을 저장/전송 전에 다듬습니다.
 * 학부모 화면에서 되돌아온 값도 같은 함수로 검증합니다.
 */
export function normalizeSpecialItems(items = [], { periodStart = '', periodEnd = '' } = {}) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    const type = SPECIAL_TYPES.includes(item.type) ? item.type : 'unknown';
    const dates = [...new Set((Array.isArray(item.dates) ? item.dates : [])
      .map((date) => String(date || ''))
      .filter((date) => isValidDate(date))
      // 기간 밖 날짜는 보여주지도, 반영하지도 않습니다.
      .filter((date) => (!periodStart || date >= periodStart) && (!periodEnd || date <= periodEnd)))]
      .sort()
      .slice(0, 60);
    out.push({
      type,
      dates,
      start: isValidTime(item.start) ? item.start : '',
      end: isValidTime(item.end) ? item.end : '',
      reason: String(item.reason || '').slice(0, 120),
      raw: String(item.raw || '').slice(0, 200),
      needsReview: Boolean(item.needsReview),
      include: item.include === false ? false : true,
    });
    if (out.length >= 30) break;
  }
  return out;
}

// ── v41-195: 저장된 개인 시간표 → 주간 루틴 + 특별 일정 ──────────────────────
//
// 설문으로 자동 등록한 뒤 손으로 고친 결과가 지금의 개인 시간표입니다.
// 학부모에게 보여줄 때는 날짜 60개를 나열할 것이 아니라
// "월 17:30~22:30, 화 …" 같은 주간 루틴 한 장과, 거기서 벗어나는 날짜만 필요합니다.
//
// 같은 요일에 가장 많이 나온 (등원·하원·외출) 조합을 그 요일의 루틴으로 보고,
// 조합이 다른 날짜만 특별 일정으로 떼어 냅니다.
const ROUTINE_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function addDaysLocal(dateString, amount) {
  const d = new Date(`${dateString}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function dayKeyOfDate(dateString) {
  return ROUTINE_DAY_KEYS[new Date(`${dateString}T12:00:00+09:00`).getUTCDay()];
}

function clockOf(value) {
  return String(value || '').slice(0, 5);
}

function breakListOf(rows = []) {
  return rows
    .map((item) => ({
      start: clockOf(item.leave_start),
      end: clockOf(item.return_time),
      reason: [item.reason, item.reason_detail].filter(Boolean).join(' · ').slice(0, 60),
    }))
    .filter((item) => item.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function signatureOf(entry) {
  if (entry.absent) return 'ABSENT';
  const breaks = entry.breaks.map((item) => `${item.start}-${item.end}-${item.reason}`).join(',');
  return `${entry.checkIn}|${entry.checkOut}|${breaks}`;
}

// v41-196: 일정 메모에는 사람이 적은 사유('타학원', '수학과외')와
// 등록 출처('비욘드2기 설문 응답 기준 자동 등록')가 섞여 있습니다.
// 사유로 보여줄 수 있는 것만 남깁니다. (화면 쪽 formatAbsenceLabel 과 같은 기준)
const AUTO_NOTE_PATTERN = /(자동\s*등록|일괄\s*생성|기본\s*시간표|학부모\s*확인\s*시간표|설문\s*응답)/;
function reasonNoteOf(value) {
  const note = String(value || '').trim();
  if (!note || AUTO_NOTE_PATTERN.test(note)) return '';
  return note.slice(0, 60);
}

function buildRoutineForStudent(dayEntries) {
  const days = {};
  const exceptions = [];

  for (const dayKey of ROUTINE_DAY_KEYS) {
    const list = (dayEntries[dayKey] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) { days[dayKey] = null; continue; }

    // 결석일은 루틴 후보에서 뺍니다. (그 요일 전부가 결석이면 등원하지 않는 요일)
    const attending = list.filter((item) => !item.absent);
    if (!attending.length) {
      days[dayKey] = null;
      for (const item of list) exceptions.push(item);
      continue;
    }

    const countBySignature = new Map();
    for (const item of attending) {
      const key = signatureOf(item);
      if (!countBySignature.has(key)) countBySignature.set(key, { count: 0, sample: item });
      countBySignature.get(key).count += 1;
    }
    let dominant = null;
    for (const value of countBySignature.values()) {
      if (!dominant || value.count > dominant.count) dominant = value;
    }
    const dominantKey = signatureOf(dominant.sample);
    days[dayKey] = {
      checkIn: dominant.sample.checkIn,
      checkOut: dominant.sample.checkOut,
      breaks: dominant.sample.breaks,
      // v41-196: 늦은 등원 / 이른 하원의 사유로 보여줄 메모
      note: dominant.sample.note || '',
    };
    for (const item of list) {
      if (!item.absent && signatureOf(item) === dominantKey) continue;
      exceptions.push(item);
    }
  }

  exceptions.sort((a, b) => a.date.localeCompare(b.date));
  return { days, exceptions };
}

// 특별 일정을 학부모 확인 링크가 이해하는 형태로 바꿉니다.
// 결석과 외출은 그대로 담기고, 그 날만 등하원 시각이 다른 경우는
// 링크 스키마에 자리가 없어 안내 문구(specialRaw)로 함께 보냅니다.
function splitExceptions(exceptions) {
  const absentByReason = new Map();
  const away = [];
  const customLines = [];

  for (const item of exceptions) {
    if (item.absent) {
      const reason = String(item.absentReason || '').trim();
      if (!absentByReason.has(reason)) absentByReason.set(reason, []);
      absentByReason.get(reason).push(item.date);
      continue;
    }
    customLines.push(
      `${item.date} 등하원 ${item.checkIn}~${item.checkOut}`
      + (item.breaks.length ? ` · 외출 ${item.breaks.map((b) => `${b.start}~${b.end}`).join(', ')}` : ''),
    );
    for (const brk of item.breaks) {
      away.push({ type: 'away', dates: [item.date], start: brk.start, end: brk.end, reason: brk.reason });
    }
  }

  const special = [];
  for (const [reason, dates] of absentByReason) {
    special.push({ type: 'absent', dates, start: '', end: '', reason: reason || '결석' });
  }
  special.push(...away);
  return { special, customLines };
}

async function buildRoutineFromSaved(supabase, body) {
  const cohortId = String(body.cohortId || '').trim();
  const today = getKstDateString();
  let cohort = null;
  if (cohortId) {
    const { data: cohortRow } = await supabase.from('cohorts').select('*').eq('id', cohortId).maybeSingle();
    if (cohortRow) cohort = normalizeCohort(cohortRow);
  }
  const startDate = isValidDate(body.startDate) ? body.startDate : (cohort?.startDate || today);
  const endDate = isValidDate(body.endDate) ? body.endDate : (cohort?.endDate || startDate);
  if (endDate < startDate) {
    return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });
  }

  // 대상 학생: 지정한 학생 → 기수 명단 → 활성 학생 전원
  let studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(String).filter(Boolean) : [];
  if (!studentIds.length && cohort) {
    const { data: rosterRows } = await supabase
      .from('cohort_students').select('student_id').eq('cohort_id', cohort.id).eq('is_active', true);
    studentIds = (rosterRows || []).map((row) => String(row.student_id));
  }
  let studentQuery = supabase.from('students').select('id, name, school, grade, status').order('name', { ascending: true });
  if (studentIds.length) studentQuery = studentQuery.in('id', studentIds);
  const { data: studentRows, error: studentError } = await studentQuery;
  if (studentError) throw studentError;
  const students = (studentRows || []).filter((student) => student.status !== 'inactive');
  if (!students.length) {
    return Response.json({ error: '대상 학생이 없습니다. 기수 수강 명단을 확인하세요.' }, { status: 400 });
  }

  const { data: scheduleRows, error: scheduleError } = await supabase
    .from('student_daily_schedules')
    .select('id, student_id, schedule_date, planned_check_in, planned_check_out, planned_absent, absent_reason, schedule_note')
    .in('student_id', students.map((student) => student.id))
    .gte('schedule_date', startDate)
    .lte('schedule_date', endDate);
  if (scheduleError) throw scheduleError;

  const scheduleIds = (scheduleRows || []).map((row) => row.id);
  const breaksBySchedule = {};
  for (let index = 0; index < scheduleIds.length; index += 300) {
    const part = scheduleIds.slice(index, index + 300);
    if (!part.length) continue;
    const { data: breakRows } = await supabase
      .from('student_schedule_breaks').select('*').in('schedule_id', part);
    for (const item of breakRows || []) {
      if (!breaksBySchedule[item.schedule_id]) breaksBySchedule[item.schedule_id] = [];
      breaksBySchedule[item.schedule_id].push(item);
    }
  }

  const byStudent = new Map();
  for (const row of scheduleRows || []) {
    const key = String(row.student_id);
    if (!byStudent.has(key)) byStudent.set(key, {});
    const date = String(row.schedule_date).slice(0, 10);
    const dayKey = dayKeyOfDate(date);
    const entry = {
      date,
      absent: Boolean(row.planned_absent),
      absentReason: row.absent_reason || '',
      checkIn: clockOf(row.planned_check_in),
      checkOut: clockOf(row.planned_check_out),
      breaks: breakListOf(breaksBySchedule[row.id] || []),
      note: reasonNoteOf(row.schedule_note),
    };
    const bucket = byStudent.get(key);
    if (!bucket[dayKey]) bucket[dayKey] = [];
    bucket[dayKey].push(entry);
  }

  // v41-196: 요일별 기준 시간표(기본 시간표)를 함께 내려 줍니다.
  // 이미지에서 '늦은 등원 / 이른 하원'을 판정하고, 요일 유형으로 자율학습 시간을 고릅니다.
  const scheduleConfig = await getDefaultScheduleConfig(supabase);
  const baseByDay = {};
  {
    let cursor = startDate;
    let guard = 0;
    while (cursor <= endDate && guard < 14 && Object.keys(baseByDay).length < 7) {
      const dayKey = dayKeyOfDate(cursor);
      if (!baseByDay[dayKey]) {
        const resolved = resolveScheduleForDate(scheduleConfig, cursor);
        baseByDay[dayKey] = {
          dayType: resolved.dayType,
          operating: Boolean(resolved.operating),
          checkIn: clockOf(resolved.plannedCheckIn),
          checkOut: clockOf(resolved.plannedCheckOut),
        };
      }
      cursor = addDaysLocal(cursor, 1);
      guard += 1;
    }
  }

  const entries = students.map((student) => {
    const dayEntries = byStudent.get(String(student.id)) || {};
    const { days, exceptions } = buildRoutineForStudent(dayEntries);
    const { special, customLines } = splitExceptions(exceptions);
    const scheduledDays = Object.values(days).filter(Boolean).length;
    return {
      studentId: String(student.id),
      studentName: student.name || '',
      school: student.school || '',
      grade: student.grade || '',
      days,
      special,
      specialRaw: customLines.slice(0, 8).join('\n'),
      exceptions,
      scheduledDays,
      hasSchedule: scheduledDays > 0 || exceptions.length > 0,
    };
  });

  return Response.json({
    ok: true,
    startDate,
    endDate,
    cohort: cohort ? { id: cohort.id, name: cohort.name } : null,
    baseByDay,
    entries,
  });
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

    // v41-195: 저장된 개인 시간표에서 주간 루틴을 뽑아 돌려줍니다.
    // 시간표 이미지와 학부모 확인 링크가 같은 값을 씁니다.
    if (action === 'routine_from_saved') {
      return await buildRoutineFromSaved(supabase, body);
    }

    // ── 확인 링크 생성 ────────────────────────────────────────
    if (action === 'create_links') {
      // v41-154: 기수를 지정하면 확인 링크에 담기는 기간도 기수 일정으로 맞춥니다.
      const cohortId = String(body.cohortId || '').trim();
      let cohort = null;
      if (cohortId) {
        const { data: cohortRow } = await supabase.from('cohorts').select('*').eq('id', cohortId).maybeSingle();
        if (cohortRow) cohort = normalizeCohort(cohortRow);
      }

      let startDate = isValidDate(body.startDate) ? body.startDate : (cohort?.startDate || today);
      let endDate = isValidDate(body.endDate) ? body.endDate : (cohort?.endDate || startDate);
      if (cohort?.startDate && cohort?.endDate) {
        if (startDate < cohort.startDate) startDate = cohort.startDate;
        if (endDate > cohort.endDate) endDate = cohort.endDate;
      }
      if (endDate < startDate) return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });

      const entries = Array.isArray(body.entries) ? body.entries : [];
      if (!entries.length) return Response.json({ error: '대상 학생이 없습니다.' }, { status: 400 });

      const base = getPublicBaseUrl(request);
      const created = [];

      for (const entry of entries) {
        const studentId = String(entry.studentId || '').trim();
        if (!studentId) continue;
        const snapshot = {
          days: normalizeWeekPattern(entry.days || {}),
          special: normalizeSpecialItems(entry.special, { periodStart: startDate, periodEnd: endDate }),
          specialRaw: String(entry.specialRaw || '').slice(0, 500),
        };

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
            .update({ snapshot, cohort_id: cohort?.id || null, updated_at: new Date().toISOString() })
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
              cohort_id: cohort?.id || null,
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
      const changed = row.status === 'change_requested' && row.response;
      const source = changed && row.response.days ? row.response.days : row.snapshot?.days;
      const days = normalizeWeekPattern(source || {});

      // v41-152: 특별 일정(결석·외출·등원 시작일)도 함께 반영합니다.
      const specialSource = changed && Array.isArray(row.response.special)
        ? row.response.special
        : (row.snapshot?.special || []);
      const specialItems = normalizeSpecialItems(specialSource, { periodStart: row.start_date, periodEnd: row.end_date });
      const overrides = buildSpecialOverrides(specialItems, { periodStart: row.start_date, periodEnd: row.end_date });

      let absenceSupported = true;
      try {
        const { error } = await supabase.from('student_daily_schedules').select('planned_absent').limit(1);
        if (error) absenceSupported = false;
      } catch {
        absenceSupported = false;
      }

      const baseDates = expandPatternToDates({ days }, row.start_date, row.end_date, MAX_RANGE_DAYS + 1);
      const dates = applySpecialToDates(baseDates, overrides);
      if (!dates.length) {
        return Response.json({ error: '반영할 등원일이 없습니다.' }, { status: 400 });
      }

      const payloads = dates.map((item) => {
        const payload = {
          student_id: row.student_id,
          schedule_date: item.date,
          planned_check_in: item.checkIn || '09:00',
          planned_check_out: item.checkOut || '22:00',
          schedule_note: '학부모 확인 시간표',
          // v41-186: student_daily_schedules 에는 created_by 컬럼이 없습니다.
          // 반영한 사람은 아래 user_action_logs 와 schedule_confirmations.applied_by 에 남습니다.
        };
        if (absenceSupported) {
          payload.planned_absent = Boolean(item.absent);
          payload.absent_reason = item.absent ? String(item.absentReason || '').slice(0, 100) || '학부모 확인 특별일정' : null;
        }
        return payload;
      });
      const absentDays = dates.filter((item) => item.absent).length;

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
          if (!scheduleId || item.absent) continue;
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
        payload: { dates: dates.length, absentDays },
      }).catch(() => {});

      return Response.json({
        ok: true,
        row: updated,
        message: `${dates.length}일치 시간표에 반영했습니다.${absentDays ? ` (특별일정 결석 ${absentDays}일 포함)` : ''}`
          + `${overrides.startFrom ? ` 등원 시작일 ${overrides.startFrom} 이전은 제외했습니다.` : ''}`,
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
