import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function toDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function compactJson(value, max = 12000) {
  const text = JSON.stringify(value || {}, null, 2);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... [데이터 일부 생략]`;
}

function formatMinutesKo(minutes) {
  const total = Math.max(0, Math.round(Number(minutes || 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours <= 0) return `${rest}분`;
  if (rest === 0) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
}

function getInclusiveRangeDays(range = {}) {
  const start = toDate(range.start);
  const end = toDate(range.end);
  if (!start || !end) return 0;
  const startMs = new Date(`${start}T00:00:00+09:00`).getTime();
  const endMs = new Date(`${end}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
}

function buildStudyVolumeGuide(source = {}) {
  const existing = source.studyVolumeGuide || source.summary?.studyVolumeGuide;
  if (existing?.evaluation) return existing;

  const totalStudyMinutes = Math.max(0, Number(source.summary?.totalStudyMinutes || 0));
  const rangeDays = getInclusiveRangeDays(source.range || {}) || 7;
  const weeklyEquivalentStudyMinutes = Math.round((totalStudyMinutes / Math.max(rangeDays, 1)) * 7);
  const basisLabel = rangeDays >= 6 && rangeDays <= 8 ? '조회기간 총 순공시간' : '1주 환산 순공시간';

  let evaluation = '개선 필요';
  if (weeklyEquivalentStudyMinutes > 40 * 60) evaluation = '학습량 충분';
  else if (weeklyEquivalentStudyMinutes >= 30 * 60) evaluation = '보통';

  return {
    target: '방학기간 목표: 1주 순공시간 40시간',
    rule: '1주 기준 순공시간 40시간 초과=학습량 충분, 30시간~40시간=보통, 30시간 미만=개선 필요',
    rangeDays,
    basisLabel,
    totalStudyMinutes,
    totalStudyLabel: formatMinutesKo(totalStudyMinutes),
    weeklyEquivalentStudyMinutes,
    weeklyEquivalentStudyLabel: formatMinutesKo(weeklyEquivalentStudyMinutes),
    evaluation,
    comment: `${basisLabel} ${formatMinutesKo(weeklyEquivalentStudyMinutes)} 기준으로 ${evaluation}`,
  };
}

function withStudyVolumeGuide(source = {}) {
  const studyVolumeGuide = buildStudyVolumeGuide(source || {});
  return {
    ...(source || {}),
    studyVolumeGuide,
    summary: {
      ...((source || {}).summary || {}),
      studyVolumeGuide,
    },
  };
}

async function callOpenAiForSummary({ source, summaryType = 'internal_weekly' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.');
  }

  const model = process.env.GPT_SUMMARY_MODEL || process.env.STUDENT_SUMMARY_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const enrichedSource = withStudyVolumeGuide(source || {});
  const studyVolumeGuide = enrichedSource.studyVolumeGuide;
  const isParent = summaryType === 'parent_counseling';
  const typeTitle = isParent ? '학부모 상담용' : '학생 피드백용';
  const toneGuide = isParent
    ? [
      '학부모 상담에서 구두로 활용할 수 있도록 완화된 표현을 사용합니다.',
      '문제점을 숨기지는 말되, 학생의 노력과 다음 개선 방향을 함께 제시합니다.',
      '학부모가 불필요하게 불안해하지 않도록 과도한 단정이나 비난 표현은 피합니다.',
    ]
    : [
      '학생에게 직접 피드백할 때 사용할 수 있도록 직설적이고 구체적으로 작성합니다.',
      '태도, 실행력, 플래너, 복귀 지연, 비학습 등 개선 포인트를 명확히 지적합니다.',
      '단, 인격 평가가 아니라 관찰된 행동과 다음 실천 과제 중심으로 말합니다.',
    ];
  const systemPrompt = [
    '당신은 관리형 스터디카페/학원 원장의 구두 상담 준비를 돕는 한국어 기록 요약 도우미입니다.',
    '입력 데이터만 근거로 하며, 없는 사실을 추측하지 않습니다.',
    '학부모 전화번호 등 민감한 연락처 정보는 언급하지 않습니다.',
    '순공시간 학습량 평가는 반드시 제공된 1주 기준 순공시간 운영 기준을 따릅니다.',
    ...toneGuide,
  ].join('\n');

  const userPrompt = [
    `요약 유형: ${typeTitle}`,
    '다음 학생 관리 데이터를 바탕으로 구두 상담용 요약을 작성하세요.',
    '',
    '형식:',
    `[${typeTitle} 상담 요약]`,
    '1) 조회기간 핵심 요약 3~5문장',
    '2) 학습 태도/집중도 관찰',
    '3) 과목/학습 내용 흐름',
    '4) 플래너 및 실행력',
    '5) 다음 관리 포인트 3가지',
    '',
    '작성 규칙:',
    '- 불릿 중심으로 간결하게 작성합니다.',
    '- 데이터가 부족한 항목은 “기록 부족”이라고 표시합니다.',
    '- 리포트 삽입 문구가 아니라 구두 상담 참고자료로 작성합니다.',
    '- 방학기간 목표는 1주 순공시간 40시간입니다.',
    '- 1주 기준 순공시간이 40시간을 넘으면 “학습량 충분”, 30시간~40시간이면 “보통”, 30시간 미만이면 “개선 필요”로 코멘트합니다.',
    '- 조회기간 핵심 요약에 순공시간 판정과 근거 시간을 반드시 1회 포함합니다.',
    '- 조회기간이 1주가 아니면 아래 “1주 환산 순공시간” 기준으로 판단하되, 실제 조회기간 총 순공시간과 혼동하지 않도록 표현합니다.',
    '- 학부모 상담용에서는 판정을 완화해 표현하더라도 “학습량 충분/보통/개선 필요” 기준 자체는 바꾸지 않습니다.',
    '',
    '순공시간 운영 기준:',
    compactJson(studyVolumeGuide, 3000),
    '',
    '데이터:',
    compactJson(enrichedSource),
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const callOpenAi = (withTemperature) => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, ...(withTemperature ? { temperature: 0.25 } : {}) }),
  });

  let response = await callOpenAi(true);
  let data = await response.json().catch(() => ({}));
  // 일부 최신 모델(gpt-5 계열 등)은 사용자 지정 temperature를 거부하므로 temperature 없이 1회 재시도합니다.
  if (!response.ok && /temperature/i.test(data?.error?.message || '')) {
    response = await callOpenAi(false);
    data = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI 요약 생성 실패 (${response.status})`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('GPT 응답이 비어 있습니다.');
  return { text, model, usage: data?.usage || null, source: enrichedSource };
}

async function upsertSummary(supabase, request, {
  studentId,
  startDate,
  endDate,
  summaryType,
  generatedSummary,
  editedSummary,
  sourcePayload,
  modelName,
  status = 'saved',
}) {
  const actor = getAuthorizedUser(request);
  const actorName = actor?.displayName || '관리자';
  const payload = {
    student_id: studentId,
    start_date: startDate,
    end_date: endDate,
    summary_type: summaryType || 'internal_weekly',
    generated_summary: generatedSummary || null,
    edited_summary: editedSummary || generatedSummary || null,
    source_payload: sourcePayload || {},
    model_name: modelName || null,
    status,
    created_by: actorName,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('student_counseling_summaries')
    .upsert(payload, { onConflict: 'student_id,start_date,end_date,summary_type' })
    .select()
    .single();

  if (error) throw new Error(`${error.message} / beyond-os-supabase-student-counseling-summaries-v41-28.sql 실행 여부를 확인하세요.`);

  await writeUserActionLog(supabase, request, {
    actionType: status === 'generated' ? 'student_history.summary_generate' : 'student_history.summary_save',
    targetType: 'student_counseling_summary',
    targetId: data.id,
    targetName: studentId,
    payload: {
      studentId,
      startDate,
      endDate,
      summaryType: payload.summary_type,
      modelName,
      status,
    },
  });

  return data;
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'generate';
    const studentId = String(body.studentId || '').trim();
    const startDate = toDate(body.startDate);
    const endDate = toDate(body.endDate);
    const summaryType = body.summaryType || 'internal_weekly';

    if (!studentId || !startDate || !endDate) {
      return Response.json({ error: 'studentId, startDate, endDate가 필요합니다.' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    if (action === 'save') {
      const text = String(body.summaryText || '').trim();
      if (!text) return Response.json({ error: '저장할 요약 내용이 없습니다.' }, { status: 400 });
      const saved = await upsertSummary(supabase, request, {
        studentId,
        startDate,
        endDate,
        summaryType,
        generatedSummary: body.generatedSummary || text,
        editedSummary: text,
        sourcePayload: body.sourcePayload || {},
        modelName: body.modelName || null,
        status: 'saved',
      });
      return Response.json({ ok: true, summary: saved, message: '상담 요약을 저장했습니다.' });
    }

    const source = body.sourcePayload || body.counselingSource || {};
    if (!Array.isArray(source.dailyRows) || source.dailyRows.length === 0) {
      return Response.json({ error: '요약 생성에 충분한 학생 관리 기록이 없습니다.' }, { status: 400 });
    }
    const enrichedSource = withStudyVolumeGuide(source);
    const generated = await callOpenAiForSummary({ source: enrichedSource, summaryType });
    const saved = await upsertSummary(supabase, request, {
      studentId,
      startDate,
      endDate,
      summaryType,
      generatedSummary: generated.text,
      editedSummary: generated.text,
      sourcePayload: generated.source || enrichedSource,
      modelName: generated.model,
      status: 'generated',
    });

    return Response.json({ ok: true, summary: saved, text: generated.text, model: generated.model, usage: generated.usage, studyVolumeGuide: enrichedSource.studyVolumeGuide });
  } catch (error) {
    return Response.json({ error: error.message || '상담 요약 처리 실패' }, { status: 500 });
  }
}
