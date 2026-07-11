import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { formatMinutes } from '../../../../lib/date';

export const dynamic = 'force-dynamic';

function compactIssueSummary(summary = {}) {
  return summary.issueSummary && summary.issueSummary !== '특이사항 없음'
    ? summary.issueSummary
    : '특이사항 없음';
}

function fallbackInterviewDraft({ rawInterview = '', summary = {} }) {
  const raw = String(rawInterview || '').trim();
  if (raw) {
    return raw
      .replace(/\s+/g, ' ')
      .replace(/([.!?。])\s*/g, '$1 ')
      .trim();
  }

  const issueSummary = compactIssueSummary(summary);
  const studyLine = `이번 주 순공시간은 총 ${formatMinutes(summary.totalStudyMinutes || 0)}, 일평균 ${formatMinutes(summary.averageStudyMinutes || 0)}로 확인되었습니다.`;
  const issueLine = issueSummary === '특이사항 없음'
    ? '면담에서는 현재 학습 흐름을 유지하면서 다음 주에도 루틴이 흔들리지 않도록 점검하겠습니다.'
    : `면담에서는 ${issueSummary} 항목을 중심으로 생활 리듬과 학습 지속 시간을 함께 점검하겠습니다.`;
  return `${studyLine} ${issueLine}`;
}

function buildDailyRows(detailRows = []) {
  return (detailRows || []).slice(0, 7).map((row) => {
    const flags = Array.isArray(row.flags) && row.flags.length ? row.flags.join('/') : '정상';
    return `${row.date || '-'}: 순공 ${formatMinutes(row.pureStudyMinutes || 0)}, 외출 ${row.awayCount || 0}회/${formatMinutes(row.awayMinutes || 0)}, 상태 ${flags}`;
  }).join('\n');
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

    if (!apiKey) {
      return Response.json({
        draft: fallbackInterviewDraft(body),
        fallback: true,
        message: 'OPENAI_API_KEY가 없어 규칙 기반 면담 초안을 생성했습니다.',
      });
    }

    const student = body.student || {};
    const summary = body.summary || {};
    const rawInterview = String(body.rawInterview || '').trim();
    const dailyRows = buildDailyRows(body.detailRows || []);
    const pointSummary = summary.pointSummary?.label || '상벌점 기록 없음';

    const prompt = [
      '역할: 당신은 관리형 학습공간의 원장 또는 학습관리 책임자가 학부모용 주간 리포트에 들어갈 "주간면담 내용"을 다듬는다.',
      '',
      '작성 원칙:',
      '- 한국어 존댓말로 작성한다.',
      '- 사용자가 작성한 면담 메모의 의미를 유지하되, 학부모가 읽기 좋은 문장으로 정리한다.',
      '- 학생을 탓하거나 단정적으로 비난하지 않는다.',
      '- 확인되지 않은 사실을 새로 만들지 않는다.',
      '- 주간 총평이 아니라 "면담에서 확인된 내용" 중심으로 쓴다.',
      '- 제목, 번호, 불릿, 따옴표 없이 본문만 출력한다.',
      '- 분량은 2~4문장, 350자 이내로 작성한다.',
      '',
      '학생 및 주간 데이터:',
      `학생: ${student.name || '-'}`,
      `학교/학년: ${[student.school, student.grade].filter(Boolean).join(' ') || '-'}`,
      `기간: ${body.start || '-'} ~ ${body.end || '-'}`,
      `등원일수: ${summary.attendanceDays || 0}일`,
      `총 순공시간: ${formatMinutes(summary.totalStudyMinutes || 0)}`,
      `일평균 순공시간: ${formatMinutes(summary.averageStudyMinutes || 0)}`,
      `외출: ${summary.awayCount || 0}회 / 총 ${formatMinutes(summary.awayMinutes || 0)}`,
      `주요 확인사항: ${compactIssueSummary(summary)}`,
      `상벌점: ${pointSummary}`,
      '',
      '일별 요약:',
      dailyRows || '일별 기록 없음',
      '',
      `사용자 면담 초안: ${rawInterview || '미입력'}`,
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '학부모용 주간 리포트의 주간면담 내용만 작성한다. 입력 메모를 정돈하되 사실을 새로 만들지 않는다.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!response.ok) {
      return Response.json({
        draft: fallbackInterviewDraft(body),
        fallback: true,
        message: json?.error?.message || text || 'AI 호출 실패로 규칙 기반 면담 초안을 생성했습니다.',
      });
    }

    const draft = json?.choices?.[0]?.message?.content?.trim();
    return Response.json({
      draft: draft || fallbackInterviewDraft(body),
      fallback: !draft,
      model,
    });
  } catch (error) {
    return Response.json({
      draft: fallbackInterviewDraft({}),
      fallback: true,
      message: error.message || 'AI 면담 내용 다듬기 중 오류가 발생했습니다.',
    });
  }
}
