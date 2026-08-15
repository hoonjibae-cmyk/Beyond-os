import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

const SCHEMA_HINT = 'student_surveys 테이블이 없으면 beyond-os-supabase-student-surveys-v41-57.sql을 먼저 실행하세요.';
const COHORT_HINT = '기수 컬럼이 없으면 beyond-os-supabase-student-surveys-cohort-v41-182.sql을 실행하세요.';

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

// ── v41-182: 설문의 기수 구분 ────────────────────────────────────────────────
// 사전 설문은 기수마다 다시 받습니다. 같은 학생이라도 1기 응답과 2기 응답은
// 별개로 남아야 하므로, 업로드/조회 모두 [기수 보기]를 기준으로 삼습니다.
async function listCohortRows(supabase) {
  try {
    const { data } = await supabase
      .from('cohorts')
      .select('id, name, start_date, end_date')
      .order('start_date', { ascending: true });
    return data || [];
  } catch {
    return [];
  }
}

// 화면의 [기수 보기]가 모든 요청에 이 헤더를 실어 보냅니다.
function getCohortIdFromRequest(request) {
  try {
    return String(request?.headers?.get?.('x-beyond-cohort-id') || '').trim();
  } catch {
    return '';
  }
}

// 요청에 기수가 없으면(=전체 보기) 오늘이 속한 기수를, 그것도 없으면 가장 최근 기수를 씁니다.
// 기수를 아직 하나도 만들지 않았다면 null 을 돌려주고 기수 구분 없이 동작합니다.
async function resolveSurveyCohort(supabase, requested) {
  const cohorts = await listCohortRows(supabase);
  if (!cohorts.length) return { id: null, name: '' };

  const wanted = String(requested || '').trim();
  const picked = wanted ? cohorts.find((row) => String(row.id) === wanted) : null;
  if (picked) return { id: String(picked.id), name: picked.name || '' };

  // 기간이 겹치면 나중에 시작한 기수를 씁니다. (cohorts 는 시작일 오름차순)
  const today = getKstDateString();
  const current = [...cohorts].reverse().find((row) => (
    String(row.start_date || '').slice(0, 10) <= today && today <= String(row.end_date || '').slice(0, 10)
  ));
  if (current) return { id: String(current.id), name: current.name || '' };

  const latest = cohorts[cohorts.length - 1];
  return { id: String(latest.id), name: latest.name || '' };
}

// 기수 명단(활성)만 모읍니다. 이름이 겹칠 때 그 기수 학생을 먼저 고르기 위한 것입니다.
async function loadCohortStudentIds(supabase, cohortId) {
  if (!cohortId) return null;
  try {
    const { data, error } = await supabase
      .from('cohort_students')
      .select('student_id')
      .eq('cohort_id', cohortId)
      .eq('is_active', true);
    if (error) throw error;
    return new Set((data || []).map((row) => String(row.student_id)));
  } catch {
    return null;
  }
}

// 설문의 학생 이름(+학교/학년)으로 기존 학생을 찾습니다.
// v41-182: 동명이인이 여러 기수에 흩어져 있으면 업로드 대상 기수의 학생을 먼저 봅니다.
function matchStudent(students, name, schoolGrade, cohortStudentIds) {
  const target = normalizeName(name);
  if (!target) return null;
  const all = (students || []).filter((s) => normalizeName(s.name) === target);
  if (!all.length) return null;

  const inCohort = cohortStudentIds ? all.filter((s) => cohortStudentIds.has(String(s.id))) : [];
  const candidates = inCohort.length ? inCohort : all;

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1 && schoolGrade) {
    const sg = normalizeName(schoolGrade);
    const bySchool = candidates.find((s) => s.school && sg.includes(normalizeName(s.school)));
    if (bySchool) return bySchool;
  }
  return candidates[0] || null;
}

// 같은 기수 안에서 같은 사람인지 판정하는 키입니다.
// NULL 끼리는 서로 다른 값으로 취급되는 DB 특성 때문에 학교/학년이 비면 중복이 새므로,
// 여기서도 DB의 유니크 인덱스와 똑같이 빈 문자열로 눕혀서 비교합니다.
function dedupeKey(surveyType, studentName, schoolGrade) {
  return `${surveyType}|${normalizeName(studentName)}|${String(schoolGrade || '').trim()}`;
}

function isMissingCohortColumn(error) {
  const message = String(error?.message || '');
  return /cohort_id/.test(message) && /column|does not exist/i.test(message);
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const studentId = searchParams.get('studentId');
    const requestedCohortId = String(searchParams.get('cohortId') || '').trim() || getCohortIdFromRequest(request);

    // v41-182: 기수를 고른 상태면 그 기수 응답만 보여줍니다.
    // 전체 보기(기수 미지정)에서는 모든 기수의 응답을 그대로 내려주고,
    // 화면에서 기수 배지로 구분합니다.
    const cohortId = String(requestedCohortId || '').trim();

    async function runQuery({ withCohort }) {
      let query = supabase
        .from('student_surveys')
        .select('*')
        .order('survey_type', { ascending: true })
        .order('updated_at', { ascending: false });
      if (studentId && studentId !== 'all') query = query.eq('student_id', studentId);
      if (withCohort && cohortId) query = query.eq('cohort_id', cohortId);
      return query;
    }

    let { data, error } = await runQuery({ withCohort: Boolean(cohortId) });
    if (error && cohortId && isMissingCohortColumn(error)) {
      // 마이그레이션 전이라도 화면이 죽지 않도록 기수 필터 없이 한 번 더 시도합니다.
      const retry = await runQuery({ withCohort: false });
      if (!retry.error) {
        return Response.json({ surveys: retry.data || [], warning: COHORT_HINT });
      }
      error = retry.error;
    }
    if (error) {
      return Response.json({ surveys: [], warning: `${error.message} / ${SCHEMA_HINT}` });
    }
    return Response.json({ surveys: data || [], cohortId: cohortId || null });
  } catch (error) {
    return Response.json({ surveys: [], warning: error.message || 'Unknown error' });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const surveyType = body.surveyType === 'parent' ? 'parent' : 'student';
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return Response.json({ error: '업로드할 설문 응답이 없습니다.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const cohort = await resolveSurveyCohort(supabase, body.cohortId || getCohortIdFromRequest(request));

    const { data: students, error: studentsError } = await supabase.from('students').select('id,name,school,grade');
    if (studentsError) throw studentsError;
    const cohortStudentIds = await loadCohortStudentIds(supabase, cohort.id);

    // 같은 파일 안에 같은 사람이 두 번 들어 있으면 마지막(=최신) 응답만 남깁니다.
    // 구글폼 응답은 시간순이라 뒤쪽이 최신이고, DB 유니크 인덱스가 한 번의 insert
    // 안에서도 충돌하기 때문에 여기서 먼저 접어야 합니다.
    // Map 은 같은 키에 다시 넣어도 처음 자리를 지키므로 파일 순서가 그대로 유지됩니다.
    const rowByKey = new Map();
    for (const row of rows) {
      const studentName = String(row.studentName || '').trim();
      if (!studentName) continue;
      const schoolGrade = String(row.schoolGrade || '').trim() || null;
      rowByKey.set(dedupeKey(surveyType, studentName, schoolGrade), { row, studentName, schoolGrade });
    }

    let matchedCount = 0;
    const unmatchedNames = [];
    const payload = [];
    const stamp = new Date().toISOString();
    for (const [key, { row, studentName, schoolGrade }] of rowByKey) {
      const matched = matchStudent(students || [], studentName, schoolGrade, cohortStudentIds);
      if (matched) matchedCount += 1;
      else unmatchedNames.push(studentName);

      payload.push({
        key,
        record: {
          student_id: matched?.id || null,
          cohort_id: cohort.id,
          survey_type: surveyType,
          student_name: studentName,
          school_grade: schoolGrade,
          respondent_name: String(row.respondentName || '').trim() || null,
          submitted_at: row.submittedAt || null,
          answers: Array.isArray(row.answers) ? row.answers : [],
          matched: Boolean(matched),
          updated_at: stamp,
        },
      });
    }

    if (!payload.length) {
      return Response.json({ error: '업로드할 설문 응답이 없습니다.' }, { status: 400 });
    }

    // 기존 행 조회 → 있으면 갱신, 없으면 추가.
    // 유니크 인덱스가 coalesce() 식이라 PostgREST 의 on_conflict 로는 지목할 수 없어
    // 여기서 직접 나눠서 씁니다.
    let existingQuery = supabase
      .from('student_surveys')
      .select('id, student_name, school_grade, cohort_id')
      .eq('survey_type', surveyType);
    existingQuery = cohort.id ? existingQuery.eq('cohort_id', cohort.id) : existingQuery.is('cohort_id', null);
    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) {
      const hint = isMissingCohortColumn(existingError) ? COHORT_HINT : SCHEMA_HINT;
      return Response.json({ error: `${existingError.message} / ${hint}` }, { status: 500 });
    }

    const existingIdByKey = new Map();
    for (const row of existing || []) {
      existingIdByKey.set(dedupeKey(surveyType, row.student_name, row.school_grade), row.id);
    }

    const toUpdate = [];
    const toInsert = [];
    for (const item of payload) {
      const id = existingIdByKey.get(item.key);
      if (id) toUpdate.push({ id, ...item.record });
      else toInsert.push(item.record);
    }

    if (toUpdate.length) {
      const { error } = await supabase.from('student_surveys').upsert(toUpdate, { onConflict: 'id' });
      if (error) return Response.json({ error: `${error.message} / ${SCHEMA_HINT}` }, { status: 500 });
    }
    if (toInsert.length) {
      const { error } = await supabase.from('student_surveys').insert(toInsert);
      if (error) {
        const hint = isMissingCohortColumn(error) ? COHORT_HINT : SCHEMA_HINT;
        return Response.json({ error: `${error.message} / ${hint}` }, { status: 500 });
      }
    }

    await writeUserActionLog(supabase, request, {
      actionType: 'survey.bulk_upload',
      targetType: 'student_survey',
      targetName: `${cohort.name ? `${cohort.name} ` : ''}${surveyType === 'parent' ? '학부모' : '학생'} 설문 ${payload.length}건`,
      payload: {
        surveyType,
        cohortId: cohort.id,
        cohortName: cohort.name,
        total: payload.length,
        added: toInsert.length,
        updated: toUpdate.length,
        matched: matchedCount,
        unmatched: unmatchedNames.length,
      },
    });

    return Response.json({
      saved: payload.length,
      total: payload.length,
      added: toInsert.length,
      updated: toUpdate.length,
      matched: matchedCount,
      unmatched: unmatchedNames.length,
      unmatchedNames: [...new Set(unmatchedNames)],
      cohortId: cohort.id,
      cohortName: cohort.name,
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
