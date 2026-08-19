// Beyond OS v41-149
// 설문 응답(엑셀)에서 뽑아낸 "요일별 등하원 패턴"을 기간 내 개인 시간표로 일괄 등록합니다.
//
// 엑셀 파싱과 컬럼 매핑은 브라우저에서 끝내고, 이 라우트는 확정된 패턴만 받습니다.
// (파일을 서버로 올리지 않으므로 Vercel 요청 본문 한도에 걸리지 않습니다.)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { runInChunks } from '../../../lib/supabaseChunk';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import {
  expandPatternToDates,
  applySpecialToDates,
  normalizeSpecialOverrides,
  DAY_KEYS,
  DAY_LABELS,
} from '../../../lib/scheduleImport';
import { normalizeCohort, formatCohortLabel } from '../../../lib/cohorts';
import { getDefaultScheduleConfig } from '../../../lib/defaultScheduleServer';
import { resolveScheduleForDate } from '../../../lib/defaultSchedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RANGE_DAYS = 120;
const CHUNK_SIZE = 300;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

// v41-188: 자리수만 보던 것을 실제 시각인지까지 봅니다.
// "17:75" 처럼 자리수는 맞지만 시각이 아닌 값이 그대로 DB 로 넘어가면
// 그 행이 든 묶음(최대 300건)이 통째로 실패해 다른 학생 시간표까지 날아갔습니다.
function isValidTime(value) {
  const raw = String(value || '');
  if (!/^\d{2}:\d{2}$/.test(raw)) return false;
  const hour = Number(raw.slice(0, 2));
  const minute = Number(raw.slice(3, 5));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  if (minute < 0 || minute > 59) return false;
  if (hour < 0 || hour > 24) return false;
  // 24시는 하루의 끝(24:00)만 허용됩니다.
  if (hour === 24 && minute !== 0) return false;
  return true;
}

function timeToMinutes(value) {
  if (!isValidTime(value)) return null;
  return Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5));
}

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T12:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const a = new Date(`${start}T12:00:00+09:00`);
  const b = new Date(`${end}T12:00:00+09:00`);
  return Math.floor((b - a) / 86400000) + 1;
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'schedules');
  if (denied) return denied;

  try {
    const body = await request.json();
    const action = String(body.action || 'apply').trim();
    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.createdBy || '관리자';
    const today = getKstDateString();

    if (action !== 'apply') {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // v41-154: 기수를 지정하면 그 기수의 기간·명단을 기준으로 등록합니다.
    // 화면에서 기간을 잘못 건드려도 기수 기간 밖으로는 나가지 않도록 서버에서 자릅니다.
    const cohortId = String(body.cohortId || '').trim();
    let cohort = null;
    if (cohortId) {
      const { data: cohortRow, error: cohortError } = await supabase
        .from('cohorts')
        .select('*')
        .eq('id', cohortId)
        .maybeSingle();
      if (cohortError || !cohortRow) {
        return Response.json({ error: '선택한 기수를 찾지 못했습니다. 설정 · 기수 관리에서 기수를 확인하세요.' }, { status: 400 });
      }
      cohort = normalizeCohort(cohortRow);
    }

    let startDate = isValidDate(body.startDate) ? body.startDate : (cohort?.startDate || today);
    let endDate = isValidDate(body.endDate) ? body.endDate : (cohort?.endDate || startDate);
    let clampedToCohort = false;
    if (cohort?.startDate && cohort?.endDate) {
      const clampedStart = startDate < cohort.startDate ? cohort.startDate : startDate;
      const clampedEnd = endDate > cohort.endDate ? cohort.endDate : endDate;
      if (clampedStart !== startDate || clampedEnd !== endDate) clampedToCohort = true;
      startDate = clampedStart;
      endDate = clampedEnd;
    }
    if (endDate < startDate) {
      return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });
    }
    if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) {
      return Response.json({ error: `한 번에 등록 가능한 기간은 최대 ${MAX_RANGE_DAYS}일입니다.` }, { status: 400 });
    }

    // 이미 저장된 개인 시간표를 어떻게 할지: 'skip'(보존) | 'overwrite'(덮어쓰기)
    const conflictMode = body.conflictMode === 'overwrite' ? 'overwrite' : 'skip';

    const allEntries = Array.isArray(body.entries) ? body.entries : [];
    if (!allEntries.length) {
      return Response.json({ error: '등록할 학생이 없습니다.' }, { status: 400 });
    }

    // 기수를 지정했다면 그 기수 명단에 있는 학생만 등록합니다.
    // 명단 밖 학생은 조용히 빼지 않고 응답에 이름을 담아 돌려줍니다.
    let entries = allEntries;
    const notInRoster = [];
    if (cohort) {
      const { data: rosterRows, error: rosterError } = await supabase
        .from('cohort_students')
        .select('student_id')
        .eq('cohort_id', cohort.id)
        .eq('is_active', true);
      if (rosterError) {
        return Response.json({ error: `기수 명단을 읽지 못했습니다: ${rosterError.message}` }, { status: 500 });
      }
      const roster = new Set((rosterRows || []).map((row) => String(row.student_id)));
      entries = [];
      for (const entry of allEntries) {
        if (roster.has(String(entry.studentId || ''))) entries.push(entry);
        else notInRoster.push(entry.studentName || String(entry.studentId || ''));
      }
      if (!entries.length) {
        return Response.json({
          error: `${formatCohortLabel(cohort)} 명단에 있는 학생이 없습니다.`
            + ` 설정 · 기수 관리에서 명단을 먼저 만들어 주세요.`
            + (notInRoster.length ? ` (명단 밖: ${notInRoster.slice(0, 10).join(', ')}${notInRoster.length > 10 ? ' 외' : ''})` : ''),
        }, { status: 400 });
      }
    }

    // 기존 시간표를 한 번에 읽어 (학생,날짜) 중복 여부를 판단합니다.
    const studentIds = [...new Set(entries.map((item) => String(item.studentId || '')).filter(Boolean))];
    if (!studentIds.length) {
      return Response.json({ error: '학생이 매칭되지 않았습니다.' }, { status: 400 });
    }

    const existingKeys = new Set();
    try {
      const { data: existingRows } = await supabase
        .from('student_daily_schedules')
        .select('student_id, schedule_date')
        .in('student_id', studentIds)
        .gte('schedule_date', startDate)
        .lte('schedule_date', endDate);
      for (const row of existingRows || []) {
        existingKeys.add(`${row.student_id}|${row.schedule_date}`);
      }
    } catch {
      // 조회 실패 시에는 보수적으로 전부 신규로 간주하지 않고 그대로 진행합니다.
    }

    // v41-152: 결석일을 기록하려면 planned_absent 컬럼(v41-73 마이그레이션)이 필요합니다.
    // 없으면 결석 표시는 건너뛰고 등하원 시간표만 등록합니다.
    let absenceSupported = true;
    try {
      const { error } = await supabase.from('student_daily_schedules').select('planned_absent').limit(1);
      if (error) absenceSupported = false;
    } catch {
      absenceSupported = false;
    }

    // v41-193: 기간 안에서 운영하지 않는 날(공휴일·휴무 지정, 토·일 미운영 등)을 미리 모읍니다.
    const closedDateSet = new Set();
    try {
      const scheduleConfig = await getDefaultScheduleConfig(supabase);
      let cursor = startDate;
      let guard = 0;
      while (cursor <= endDate && guard <= MAX_RANGE_DAYS + 1) {
        if (!resolveScheduleForDate(scheduleConfig, cursor).operating) closedDateSet.add(cursor);
        cursor = addDays(cursor, 1);
        guard += 1;
      }
    } catch {
      // 설정을 못 읽으면 예전처럼 전부 등록합니다.
    }

    const payloads = [];
    const perStudent = [];
    const breakPlans = [];
    const absentPlans = [];
    let absentCount = 0;
    let specialSkipped = 0;

    for (const entry of entries) {
      const studentId = String(entry.studentId || '').trim();
      if (!studentId) continue;

      // 요일 패턴 정규화 (신뢰할 수 없는 값은 여기서 걸러냅니다)
      const days = {};
      const invalidDayNotes = [];
      for (const dayKey of DAY_KEYS) {
        const config = entry.days?.[dayKey];
        if (!config) continue;
        const checkIn = isValidTime(config.checkIn) ? config.checkIn : '';
        const checkOut = isValidTime(config.checkOut) ? config.checkOut : '';

        // v41-188: 자리수는 맞지만 시각이 아닌 값(예: 17:75)은 여기서 걸러 냅니다.
        if (config.checkIn && !checkIn) invalidDayNotes.push(`${DAY_LABELS[dayKey]} 등원 시각을 읽지 못했습니다(${config.checkIn})`);
        if (config.checkOut && !checkOut) invalidDayNotes.push(`${DAY_LABELS[dayKey]} 하원 시각을 읽지 못했습니다(${config.checkOut})`);

        if (!checkIn && !checkOut) continue;

        // v41-188: 하원이 등원보다 빠르거나 같은 시간표는 만들지 않습니다.
        // 설문에 시각이 하나만 적혀 있어 하원으로 추정하는 과정에서 생기며,
        // 그대로 저장하면 순공시간과 출결 판정이 그 날만 어긋납니다.
        const inMinutes = timeToMinutes(checkIn);
        const outMinutes = timeToMinutes(checkOut);
        if (inMinutes !== null && outMinutes !== null && outMinutes <= inMinutes) {
          invalidDayNotes.push(`${DAY_LABELS[dayKey]} 하원(${checkOut})이 등원(${checkIn})보다 빠릅니다`);
          continue;
        }

        days[dayKey] = { checkIn, checkOut };
      }

      // 특정 날짜 예외(가족여행 결석 · 병원 외출 · 늦은 등원 시작일)를 덮어씌웁니다.
      const special = normalizeSpecialOverrides(entry.special, { periodStart: startDate, periodEnd: endDate });
      const baseDates = expandPatternToDates({ days }, startDate, endDate, MAX_RANGE_DAYS + 1);
      // v41-193: 공휴일·휴무로 지정한 날에는 시간표를 만들지 않습니다.
      // 설정 · 기본 시간표의 휴무 지정이 설문 응답보다 우선입니다.
      const dates = applySpecialToDates(baseDates, special).filter((item) => !closedDateSet.has(item.date));
      if (!absenceSupported) specialSkipped += special.absent.length;

      let created = 0;
      let skipped = 0;
      let absentDays = 0;

      for (const item of dates) {
        const key = `${studentId}|${item.date}`;
        if (existingKeys.has(key) && conflictMode === 'skip') { skipped += 1; continue; }
        const payload = {
          student_id: studentId,
          schedule_date: item.date,
          planned_check_in: item.checkIn || '09:00',
          planned_check_out: item.checkOut || '22:00',
          schedule_note: String(
            body.scheduleNote || (cohort ? `${cohort.name} 설문 응답 기준 자동 등록` : '설문 응답 기준 자동 등록'),
          ).slice(0, 200),
          // v41-186: student_daily_schedules 에는 created_by 컬럼이 없습니다.
          // (v15 스키마에서 created_by 는 parent_notification_logs 쪽 컬럼입니다)
          // 누가 등록했는지는 아래 user_action_logs 에 남습니다.
        };
        if (absenceSupported) {
          payload.planned_absent = Boolean(item.absent);
          payload.absent_reason = item.absent ? String(item.absentReason || '').slice(0, 100) || '설문 특별일정' : null;
        }
        if (item.absent) {
          absentDays += 1;
          absentCount += 1;
          absentPlans.push({ studentId, date: item.date });
        }
        payloads.push(payload);
        // 정기 외출(학원 등)은 별도 테이블에 저장하므로 날짜와 함께 모아둡니다.
        if (!item.absent && Array.isArray(item.breaks) && item.breaks.length) {
          breakPlans.push({ studentId, date: item.date, breaks: item.breaks });
        }
        created += 1;
      }

      perStudent.push({
        studentId,
        studentName: entry.studentName || '',
        created,
        skipped,
        absentDays,
        startFrom: special.startFrom || '',
        totalDates: dates.length,
        // v41-188: 시각이 이상해서 만들지 않은 요일
        invalidDays: invalidDayNotes,
      });
    }

    if (!payloads.length) {
      return Response.json({
        ok: true,
        created: 0,
        skipped: perStudent.reduce((sum, item) => sum + item.skipped, 0),
        perStudent,
        message: '새로 등록할 날짜가 없습니다. (이미 개인 시간표가 있는 날짜는 건너뜁니다)',
      });
    }

    // v41-188: 한 건이 실패해도 나머지는 살립니다.
    //
    // 지금까지는 묶음(최대 300건) 저장이 실패하면 그 자리에서 throw 해서,
    // 앞 묶음은 이미 저장되고 뒤 묶음은 시도조차 못 한 채 오류만 떴습니다.
    // 학생 단위로 payload 를 쌓기 때문에 "앞쪽 몇 명만 반영되고 나머지는 통째로 누락"
    // 되는 결과가 나옵니다. 이제 실패한 묶음은 한 건씩 다시 넣어 원인을 가려내고,
    // 문제 있는 건만 빼고 계속 진행합니다.
    const nameByStudentId = new Map(entries.map((entry) => [String(entry.studentId || ''), entry.studentName || '']));
    const failedRows = [];
    let created = 0;

    for (const group of chunk(payloads, CHUNK_SIZE)) {
      const { error } = await supabase
        .from('student_daily_schedules')
        .upsert(group, { onConflict: 'student_id,schedule_date' });
      if (!error) {
        created += group.length;
        continue;
      }
      // 묶음이 실패하면 어느 건이 문제인지 한 건씩 확인합니다.
      for (const row of group) {
        const { error: rowError } = await supabase
          .from('student_daily_schedules')
          .upsert([row], { onConflict: 'student_id,schedule_date' });
        if (rowError) {
          failedRows.push({
            studentId: row.student_id,
            studentName: nameByStudentId.get(String(row.student_id)) || '',
            date: row.schedule_date,
            checkIn: row.planned_check_in,
            checkOut: row.planned_check_out,
            reason: rowError.message || '알 수 없는 오류',
          });
          continue;
        }
        created += 1;
      }
    }

    const failedByStudent = new Map();
    for (const row of failedRows) {
      const key = String(row.studentId);
      if (!failedByStudent.has(key)) failedByStudent.set(key, 0);
      failedByStudent.set(key, failedByStudent.get(key) + 1);
    }
    for (const item of perStudent) {
      item.failed = failedByStudent.get(String(item.studentId)) || 0;
      item.created = Math.max(0, item.created - item.failed);
    }

    // 정기 외출 저장: 방금 만든 시간표의 id를 찾아 연결합니다.
    let breakCount = 0;
    if (breakPlans.length || absentPlans.length) {
      try {
        const targetStudentIds = [...new Set([
          ...breakPlans.map((item) => item.studentId),
          ...absentPlans.map((item) => item.studentId),
        ])];
        const { data: scheduleRows } = await supabase
          .from('student_daily_schedules')
          .select('id, student_id, schedule_date')
          .in('student_id', targetStudentIds)
          .gte('schedule_date', startDate)
          .lte('schedule_date', endDate);

        const idByKey = {};
        for (const row of scheduleRows || []) idByKey[`${row.student_id}|${row.schedule_date}`] = row.id;

        const breakRows = [];
        for (const plan of breakPlans) {
          const scheduleId = idByKey[`${plan.studentId}|${plan.date}`];
          if (!scheduleId) continue;
          for (const item of plan.breaks) {
            if (!item?.start) continue;
            breakRows.push({
              schedule_id: scheduleId,
              leave_start: item.start,
              return_time: item.end || null,
              reason: '학원',
              reason_detail: String(item.reason || '').slice(0, 100) || null,
            });
          }
        }

        // 결석으로 바뀐 날짜에 남아 있던 외출도 함께 지웁니다.
        const absentScheduleIds = absentPlans
          .map((plan) => idByKey[`${plan.studentId}|${plan.date}`])
          .filter(Boolean);

        const scheduleIds = [...new Set([...breakRows.map((row) => row.schedule_id), ...absentScheduleIds])];
        if (scheduleIds.length) {
          // 같은 시간표에 기존 외출이 있으면 지우고 새로 넣습니다.
          // v41-211: 기수 전체 기간 × 학생이면 수백 건이라 나눠서 지웁니다.
      await runInChunks(scheduleIds, (part) => supabase
        .from('student_schedule_breaks').delete().in('schedule_id', part));
        }
        if (breakRows.length) {
          for (const group of chunk(breakRows, CHUNK_SIZE)) {
            const { error } = await supabase.from('student_schedule_breaks').insert(group);
            if (error) throw error;
          }
          breakCount = breakRows.length;
        }
      } catch {
        // 외출 저장에 실패해도 등하원 시간표는 이미 저장된 상태로 둡니다.
      }
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'schedule.survey_import',
      targetType: 'schedule',
      targetId: null,
      targetName: cohort ? `${cohort.name} ${startDate}~${endDate}` : `${startDate}~${endDate}`,
      payload: {
        cohortId: cohort?.id || null,
        cohortName: cohort?.name || '',
        startDate,
        endDate,
        students: perStudent.length,
        created,
        absentCount,
        conflictMode,
        notInRoster: notInRoster.length,
      },
    }).catch(() => {});

    const skipped = perStudent.reduce((sum, item) => sum + item.skipped, 0);
    const zeroStudents = perStudent.filter((item) => !item.created).map((item) => item.studentName || item.studentId);
    const failedNames = [...new Set(failedRows.map((row) => row.studentName).filter(Boolean))];

    return Response.json({
      ok: true,
      created,
      skipped,
      failed: failedRows.length,
      failedRows: failedRows.slice(0, 50),
      failedNames,
      zeroStudents,
      breakCount,
      absentCount,
      students: perStudent.length,
      perStudent,
      cohort: cohort ? { id: cohort.id, name: cohort.name, startDate: cohort.startDate, endDate: cohort.endDate } : null,
      startDate,
      endDate,
      notInRoster,
      message: `${cohort ? `${cohort.name} · ` : ''}${startDate}~${endDate} 기간에 `
        + `학생 ${perStudent.length}명 · 시간표 ${created}건${breakCount ? ` · 외출 ${breakCount}건` : ''}${absentCount ? ` · 결석 ${absentCount}일` : ''}을 등록했습니다.`
        + `${skipped ? ` (기존 시간표가 있어 ${skipped}건 건너뜀)` : ''}`
        + `${clampedToCohort ? ` ※ 기간이 기수 일정(${cohort.startDate}~${cohort.endDate})에 맞춰 조정되었습니다.` : ''}`
        + `${notInRoster.length ? ` ※ 기수 명단에 없어 제외: ${notInRoster.slice(0, 5).join(', ')}${notInRoster.length > 5 ? ` 외 ${notInRoster.length - 5}명` : ''}` : ''}`
        + `${specialSkipped ? ` ※ 결석 ${specialSkipped}건은 beyond-os-supabase-planned-absence-v41-73.sql 미실행으로 반영되지 않았습니다.` : ''}`
        + `${failedRows.length ? ` ※ 저장에 실패한 ${failedRows.length}건이 있습니다(${failedNames.slice(0, 5).join(', ')}${failedNames.length > 5 ? ` 외 ${failedNames.length - 5}명` : ''}). 아래 목록에서 사유를 확인하세요.` : ''}`
        + `${zeroStudents.length ? ` ※ 한 건도 등록되지 않은 학생 ${zeroStudents.length}명: ${zeroStudents.slice(0, 8).join(', ')}${zeroStudents.length > 8 ? ' 외' : ''}` : ''}`,
    });
  } catch (error) {
    return Response.json({ error: error.message || '시간표 일괄 등록 실패' }, { status: 500 });
  }
}
