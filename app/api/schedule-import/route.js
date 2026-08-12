// Beyond OS v41-149
// 설문 응답(엑셀)에서 뽑아낸 "요일별 등하원 패턴"을 기간 내 개인 시간표로 일괄 등록합니다.
//
// 엑셀 파싱과 컬럼 매핑은 브라우저에서 끝내고, 이 라우트는 확정된 패턴만 받습니다.
// (파일을 서버로 올리지 않으므로 Vercel 요청 본문 한도에 걸리지 않습니다.)

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse, requireTabPermission, getAuthorizedUser } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';
import { expandPatternToDates, DAY_KEYS } from '../../../lib/scheduleImport';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_RANGE_DAYS = 120;
const CHUNK_SIZE = 300;

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTime(value) {
  return /^\d{2}:\d{2}$/.test(String(value || ''));
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

    const startDate = isValidDate(body.startDate) ? body.startDate : today;
    const endDate = isValidDate(body.endDate) ? body.endDate : startDate;
    if (endDate < startDate) {
      return Response.json({ error: '종료일은 시작일보다 빠를 수 없습니다.' }, { status: 400 });
    }
    if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) {
      return Response.json({ error: `한 번에 등록 가능한 기간은 최대 ${MAX_RANGE_DAYS}일입니다.` }, { status: 400 });
    }

    // 이미 저장된 개인 시간표를 어떻게 할지: 'skip'(보존) | 'overwrite'(덮어쓰기)
    const conflictMode = body.conflictMode === 'overwrite' ? 'overwrite' : 'skip';

    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) {
      return Response.json({ error: '등록할 학생이 없습니다.' }, { status: 400 });
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

    const payloads = [];
    const perStudent = [];
    const breakPlans = [];

    for (const entry of entries) {
      const studentId = String(entry.studentId || '').trim();
      if (!studentId) continue;

      // 요일 패턴 정규화 (신뢰할 수 없는 값은 여기서 걸러냅니다)
      const days = {};
      for (const dayKey of DAY_KEYS) {
        const config = entry.days?.[dayKey];
        if (!config) continue;
        const checkIn = isValidTime(config.checkIn) ? config.checkIn : '';
        const checkOut = isValidTime(config.checkOut) ? config.checkOut : '';
        if (!checkIn && !checkOut) continue;
        days[dayKey] = { checkIn, checkOut };
      }

      const dates = expandPatternToDates({ days }, startDate, endDate, MAX_RANGE_DAYS + 1);
      let created = 0;
      let skipped = 0;

      for (const item of dates) {
        const key = `${studentId}|${item.date}`;
        if (existingKeys.has(key) && conflictMode === 'skip') { skipped += 1; continue; }
        payloads.push({
          student_id: studentId,
          schedule_date: item.date,
          planned_check_in: item.checkIn || '09:00',
          planned_check_out: item.checkOut || '22:00',
          schedule_note: String(body.scheduleNote || '설문 응답 기준 자동 등록').slice(0, 200),
          created_by: actorName,
        });
        // 정기 외출(학원 등)은 별도 테이블에 저장하므로 날짜와 함께 모아둡니다.
        if (Array.isArray(item.breaks) && item.breaks.length) {
          breakPlans.push({ studentId, date: item.date, breaks: item.breaks });
        }
        created += 1;
      }

      perStudent.push({
        studentId,
        studentName: entry.studentName || '',
        created,
        skipped,
        totalDates: dates.length,
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

    let created = 0;
    for (const group of chunk(payloads, CHUNK_SIZE)) {
      const { error } = await supabase
        .from('student_daily_schedules')
        .upsert(group, { onConflict: 'student_id,schedule_date' });
      if (error) throw error;
      created += group.length;
    }

    // 정기 외출 저장: 방금 만든 시간표의 id를 찾아 연결합니다.
    let breakCount = 0;
    if (breakPlans.length) {
      try {
        const targetStudentIds = [...new Set(breakPlans.map((item) => item.studentId))];
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

        if (breakRows.length) {
          // 같은 시간표에 기존 외출이 있으면 지우고 새로 넣습니다.
          const scheduleIds = [...new Set(breakRows.map((row) => row.schedule_id))];
          await supabase.from('student_schedule_breaks').delete().in('schedule_id', scheduleIds);
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
      targetName: `${startDate}~${endDate}`,
      payload: {
        startDate,
        endDate,
        students: perStudent.length,
        created,
        conflictMode,
      },
    }).catch(() => {});

    const skipped = perStudent.reduce((sum, item) => sum + item.skipped, 0);
    return Response.json({
      ok: true,
      created,
      skipped,
      breakCount,
      students: perStudent.length,
      perStudent,
      message: `학생 ${perStudent.length}명 · 시간표 ${created}건${breakCount ? ` · 정기 외출 ${breakCount}건` : ''}을 등록했습니다.${skipped ? ` (기존 시간표가 있어 ${skipped}건 건너뜀)` : ''}`,
    });
  } catch (error) {
    return Response.json({ error: error.message || '시간표 일괄 등록 실패' }, { status: 500 });
  }
}
