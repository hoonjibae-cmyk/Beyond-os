import { isAuthorized, unauthorizedResponse } from '../../../../lib/auth';
import { formatMinutes } from '../../../../lib/date';

export const dynamic = 'force-dynamic';

function compactIssueSummary(summary = {}) {
  return summary.issueSummary && summary.issueSummary !== '특이사항 없음'
    ? summary.issueSummary
    : '특이사항 없음';
}

function fallbackDraft({ summary = {}, directorInterview = '' }) {
  const issueSummary = compactIssueSummary(summary);
  const studyLine = `이번 주는 총 ${formatMinutes(summary.totalStudyMinutes || 0)}, 일평균 ${formatMinutes(summary.averageStudyMinutes || 0)}의 순공시간을 기록했습니다.`;
  const issueLine = issueSummary === '특이사항 없음'
    ? '출결과 학습 흐름에서 크게 반복되는 관리 이슈는 두드러지지 않았습니다.'
    : `${issueSummary} 항목은 다음 주에도 우선적으로 관리가 필요합니다.`;
  const interviewText = String(directorInterview || '').trim();
  const interviewLine = interviewText
    ? '주간면담에서 확인한 내용을 바탕으로 다음 주에는 실천 가능한 학습 루틴과 집중 유지 시간을 구체적으로 점검하겠습니다.'
    : '다음 주에는 학생의 학습 루틴, 집중 유지 시간, 과목별 우선순위를 중심으로 점검하겠습니다.';

  return `${studyLine} ${issueLine} ${interviewLine}`;
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
        draft: fallbackDraft(body),
        fallback: true,
        message: 'OPENAI_API_KEY가 없어 규칙 기반 초안을 생성했습니다.',
      });
    }

    const student = body.student || {};
    const summary = body.summary || {};
    const directorInterview = String(body.directorInterview || '').trim();
    const dailyRows = buildDailyRows(body.detailRows || []);

    const prompt = [
      '역할: 당신은 목동유쌤영어학원/비욘드 관리형 학습공간의 원장 또는 학습관리 책임자가 학부모에게 보내는 주간 리포트의 "주간 총평"만 작성한다.',
      '',
      '작성 원칙:',
      '- 한국어 존댓말로 작성한다.',
      '- 학부모가 받아들이기 편한 신뢰감 있는 상담 톤으로 쓴다.',
      '- 첫 문장에 "안녕하세요", 마지막 문장에 "부탁드립니다" 같은 인사/마무리 문구를 넣지 않는다.',
      '- 이미 리포트에 표시되는 숫자를 그대로 길게 반복하지 않는다. 숫자는 필요한 경우에만 자연스럽게 언급한다.',
      '- 주간면담 내용이 있으면 반드시 반영하되, 면담 내용을 그대로 복사하지 말고 학습 관리 방향으로 정리한다.',
      '- 부정적 지표가 있어도 학생을 탓하지 말고, 현재 단계와 다음 주 관리 포인트 중심으로 완곡하게 표현한다.',
      '- 과장된 칭찬, 막연한 응원, 광고성 문구는 피한다.',
      '- 데일리 학습멘토 코멘트 요약은 넣지 않는다.',
      '- 출력은 주간 총평 본문만 작성한다. 제목, 번호, 불릿, 따옴표는 쓰지 않는다.',
      '- 분량은 3~5문장, 450자 이내로 작성한다.',
      '',
      '총평에 반드시 포함할 내용:',
      '1) 이번 주 학습 흐름에 대한 객관적 판단',
      '2) 주간면담에서 확인된 핵심 내용',
      '3) 다음 주 관리 방향 또는 실천 포인트',
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
      '',
      '일별 요약:',
      dailyRows || '일별 기록 없음',
      '',
      `원장님 주간면담 내용: ${directorInterview || '미입력'}`,
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
          {
            role: 'system',
            content: '학부모용 주간 학습 리포트의 주간 총평만 작성한다. 정중하고 구체적이며, 숫자 나열보다 학습 관리 방향을 명확히 정리한다.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.35,
      }),
    });

    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!response.ok) {
      return Response.json({
        draft: fallbackDraft(body),
        fallback: true,
        message: json?.error?.message || text || 'AI 호출 실패로 규칙 기반 초안을 생성했습니다.',
      });
    }

    const draft = json?.choices?.[0]?.message?.content?.trim();
    return Response.json({
      draft: draft || fallbackDraft(body),
      fallback: !draft,
      model,
    });
  } catch (error) {
    return Response.json({
      draft: fallbackDraft({}),
      fallback: true,
      message: error.message || 'AI 초안 생성 중 오류가 발생했습니다.',
    });
  }
}
