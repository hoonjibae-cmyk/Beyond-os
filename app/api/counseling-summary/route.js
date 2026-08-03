// Beyond OS v41-138
// 코칭/면담 녹음 전사문을 상담 기록용으로 요약합니다.
//
//   mode=daily  : 학습 관리의 "오늘 학습멘토 코멘트"에 넣을 코칭 요약 (학부모 리포트에 노출됨)
//   mode=weekly : 위클리 리포트의 "주간면담 내용"에 넣을 면담 요약 (학부모 리포트에 노출됨)
//   mode=internal: 내부 기록용 상세 요약 (학부모에게 보내지 않음)
//
// 전사문에 없는 사실을 만들어내지 않는 것이 가장 중요한 원칙입니다.

import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_TRANSCRIPT_CHARS = 24000;

const MODE_GUIDE = {
  daily: {
    label: '데일리 코칭 요약',
    audience: '학부모가 데일리 리포트에서 함께 읽습니다.',
    rules: [
      '- 분량은 3~5문장, 500자 이내로 작성한다.',
      '- 오늘 코칭에서 실제로 다룬 내용과 학생에게 안내한 방향을 중심으로 쓴다.',
      '- 제목, 번호, 불릿, 따옴표 없이 본문만 출력한다.',
    ],
  },
  weekly: {
    label: '주간면담 요약',
    audience: '학부모가 위클리 리포트에서 함께 읽습니다.',
    rules: [
      '- 분량은 4~7문장, 800자 이내로 작성한다.',
      '- 면담에서 확인된 학습 상태, 학생의 이야기, 합의한 다음 주 방향을 순서대로 정리한다.',
      '- 제목, 번호, 불릿, 따옴표 없이 본문만 출력한다.',
    ],
  },
  internal: {
    label: '내부 상담 기록',
    audience: '내부 관리자만 봅니다. 학부모에게 보내지 않습니다.',
    rules: [
      '- "상담 요지 / 학생이 말한 내용 / 확인된 문제 / 다음 조치" 4개 소제목으로 나누어 정리한다.',
      '- 각 소제목 아래는 "- "로 시작하는 짧은 문장으로 쓴다.',
      '- 전체 1200자 이내로 작성한다.',
    ],
  },
};

function normalizeMode(value) {
  const mode = String(value || 'daily').trim();
  return MODE_GUIDE[mode] ? mode : 'daily';
}

function buildFallbackSummary(transcript = '') {
  // AI를 쓸 수 없을 때는 전사문을 문장 단위로 정리한 뒤 앞부분만 돌려줍니다.
  const clean = String(transcript || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const sentences = clean.split(/(?<=[.!?。？！])\s+/).filter(Boolean);
  const picked = sentences.slice(0, 6).join(' ');
  return picked.length > 700 ? `${picked.slice(0, 700)}…` : picked;
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json();
    const transcriptRaw = String(body.transcript || '').trim();
    const mode = normalizeMode(body.mode);
    const guide = MODE_GUIDE[mode];
    const student = body.student || {};
    const extraInstruction = String(body.instruction || '').trim();

    if (!transcriptRaw) {
      return Response.json({ error: '요약할 녹음 내용이 없습니다. 먼저 녹음하거나 전사문을 입력하세요.' }, { status: 400 });
    }

    // 너무 긴 전사문은 뒷부분(최근 대화)을 우선 남깁니다.
    const transcript = transcriptRaw.length > MAX_TRANSCRIPT_CHARS
      ? `…(앞부분 생략)\n${transcriptRaw.slice(-MAX_TRANSCRIPT_CHARS)}`
      : transcriptRaw;

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';

    if (!apiKey) {
      return Response.json({
        summary: buildFallbackSummary(transcript),
        fallback: true,
        mode,
        message: 'OPENAI_API_KEY가 없어 전사문 앞부분만 정리해 표시했습니다.',
      });
    }

    const prompt = [
      `역할: 관리형 학습공간(The Place 26)의 코치/센터장이 학생과 진행한 상담 녹음을 "${guide.label}"으로 정리한다.`,
      `읽는 사람: ${guide.audience}`,
      '',
      '작성 원칙:',
      '- 한국어 존댓말로 작성한다.',
      '- 녹음에 실제로 나온 내용만 사용한다. 추측하거나 없는 사실을 만들지 않는다.',
      '- 전사 과정에서 잘못 인식된 단어는 문맥에 맞게 자연스럽게 바로잡되, 내용을 바꾸지 않는다.',
      '- 잡담, 인사말, 말버릇, 반복은 제외하고 상담의 핵심만 남긴다.',
      '- 학생을 비난하거나 단정하지 않는다. 관찰된 사실과 합의된 방향 위주로 쓴다.',
      '- 녹음 내용이 상담과 무관하거나 너무 짧아 정리할 수 없으면 그 사실을 한 문장으로 밝힌다.',
      ...guide.rules,
      extraInstruction ? `- 추가 지시: ${extraInstruction}` : '',
      '',
      '학생 정보:',
      `이름: ${student.name || '-'}`,
      `학교/학년: ${[student.school, student.grade].filter(Boolean).join(' ') || '-'}`,
      `상담일: ${body.date || '-'}`,
      body.context ? `참고 정보: ${String(body.context).slice(0, 800)}` : '',
      '',
      '상담 녹음 전사문:',
      transcript,
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: '상담 녹음 전사문을 요약한다. 전사문에 없는 사실은 절대 만들지 않는다. 요청된 형식의 본문만 출력한다.' },
      { role: 'user', content: prompt },
    ];

    const callOpenAi = (withTemperature) => fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, ...(withTemperature ? { temperature: 0.2 } : {}) }),
    });

    let response = await callOpenAi(true);
    let text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}

    // 일부 최신 모델은 사용자 지정 temperature를 거부하므로 temperature 없이 1회 재시도합니다.
    if (!response.ok && /temperature/i.test(json?.error?.message || text || '')) {
      response = await callOpenAi(false);
      text = await response.text();
      json = null;
      try { json = JSON.parse(text); } catch {}
    }

    if (!response.ok) {
      return Response.json({
        summary: buildFallbackSummary(transcript),
        fallback: true,
        mode,
        message: json?.error?.message || text || 'AI 호출에 실패해 전사문 앞부분만 정리했습니다.',
      });
    }

    const summary = String(json?.choices?.[0]?.message?.content || '').trim();
    return Response.json({
      ok: true,
      mode,
      model,
      summary: summary || buildFallbackSummary(transcript),
      fallback: !summary,
    });
  } catch (error) {
    return Response.json({
      error: error?.message || '상담 요약 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
