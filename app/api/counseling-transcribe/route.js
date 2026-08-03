// Beyond OS v41-138
// 코칭/면담 녹음 조각을 받아 텍스트로 전사합니다.
//
// 운영 메모
//   - 녹음 파일은 서버나 Supabase에 저장하지 않습니다. 전사에만 사용하고 즉시 버립니다.
//     (학생 상담 음성은 민감 정보라 보관하지 않는 것을 기본값으로 둡니다.)
//   - Vercel 요청 본문 한도(4.5MB)를 넘지 않도록 클라이언트가 녹음을 조각내어 보냅니다.
//     이 라우트는 조각 하나를 전사해 텍스트만 돌려줍니다.

import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 최신 전사 모델을 우선 시도하고, 계정에서 지원하지 않으면 whisper-1로 자동 대체합니다.
const TRANSCRIBE_MODELS = [
  process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
  'whisper-1',
];

const MAX_SEGMENT_BYTES = 24 * 1024 * 1024;

function uniqueModels(list = []) {
  const seen = new Set();
  return list.filter((item) => {
    const key = String(item || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({
        error: 'OPENAI_API_KEY 환경변수가 설정되어 있지 않아 음성 전사를 사용할 수 없습니다. Vercel 환경변수를 확인하세요.',
        code: 'OPENAI_KEY_MISSING',
      }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get('audio');
    const segmentIndex = Number(form.get('segmentIndex') || 0);
    const language = String(form.get('language') || 'ko').trim() || 'ko';
    // 앞 조각의 끝부분을 힌트로 넘기면 이어지는 말의 표기가 안정적입니다.
    const promptHint = String(form.get('promptHint') || '').trim().slice(-400);

    if (!file || typeof file.arrayBuffer !== 'function') {
      return Response.json({ error: '녹음 파일(audio)이 필요합니다.' }, { status: 400 });
    }
    if (Number(file.size || 0) > MAX_SEGMENT_BYTES) {
      return Response.json({ error: '녹음 조각이 너무 큽니다. 더 짧게 나누어 전송하세요.' }, { status: 400 });
    }
    if (!Number(file.size || 0)) {
      return Response.json({ ok: true, text: '', segmentIndex, empty: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = String(file.name || `segment-${segmentIndex}.webm`);
    const fileType = String(file.type || 'audio/webm');

    const models = uniqueModels(TRANSCRIBE_MODELS);
    let lastError = '';

    for (const model of models) {
      const payload = new FormData();
      payload.append('file', new Blob([buffer], { type: fileType }), fileName);
      payload.append('model', model);
      payload.append('language', language);
      payload.append('response_format', 'json');
      if (promptHint) payload.append('prompt', promptHint);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: payload,
      });

      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}

      if (response.ok) {
        return Response.json({
          ok: true,
          segmentIndex,
          model,
          text: String(json?.text || '').trim(),
        });
      }

      lastError = json?.error?.message || text || `전사 실패 (${response.status})`;
      // 모델을 못 쓰는 경우에만 다음 후보로 넘어가고, 그 외 오류는 즉시 반환합니다.
      const modelIssue = response.status === 404
        || /model/i.test(lastError) && /(not found|does not exist|unsupported|access)/i.test(lastError);
      if (!modelIssue) break;
    }

    return Response.json({
      error: `음성 전사에 실패했습니다: ${lastError}`,
      segmentIndex,
    }, { status: 502 });
  } catch (error) {
    return Response.json({
      error: error?.message || '음성 전사 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
