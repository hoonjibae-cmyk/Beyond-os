// Beyond OS v41-280 — 상벌점 발생 슬랙 알림 (비욘드 봇)
//
// 설정 (Vercel 환경변수)
//   SLACK_POINT_WEBHOOK_URL  : 채널 '비욘드-학습관리센터'에 연결된 Incoming Webhook URL (가장 간단)
//   또는
//   SLACK_BOT_TOKEN          : 비욘드 봇의 xoxb- 토큰 (chat:write 권한, 채널에 봇 초대 필요)
//   SLACK_POINT_CHANNEL      : 채널 이름 또는 ID. 기본 '#비욘드-학습관리센터'
//
// 둘 다 없으면 조용히 건너뜁니다. 발송 실패는 상벌점 저장을 막지 않습니다.

const SLACK_TIMEOUT_MS = 5000;
export const SLACK_DEFAULT_POINT_CHANNEL = '#비욘드-학습관리센터';
export const SLACK_BOT_DISPLAY_NAME = '비욘드 봇';

export function getSlackPointConfig(env = process.env) {
  const webhookUrl = String(env.SLACK_POINT_WEBHOOK_URL || '').trim();
  const botToken = String(env.SLACK_BOT_TOKEN || '').trim();
  const channel = String(env.SLACK_POINT_CHANNEL || '').trim() || SLACK_DEFAULT_POINT_CHANNEL;
  return { webhookUrl, botToken, channel, configured: Boolean(webhookUrl || botToken), mode: webhookUrl ? 'webhook' : botToken ? 'bot' : 'none' };
}

/**
 * 메시지 본문을 만듭니다. (테스트 가능하도록 순수 함수)
 *   제목  : 상점 발생 / 벌점 발생
 *   내용  : xxx 학생 | 사유 | 상세 | 상점 N점 | 누적 …
 *   부여자: 입력한 사람 또는 '시스템'
 */
export function buildPointSlackMessage({ studentName, pointType, points, category, detail, reason, totals, actorName, pointDate, isSystem = false }) {
  const isPenalty = pointType === 'penalty';
  const title = isPenalty ? '벌점 발생' : '상점 발생';
  const kindLabel = isPenalty ? '벌점' : '상점';
  const safeCategory = String(category || reason || '-').trim() || '-';
  const safeDetail = String(detail || '').trim() || '-';
  const cumulative = totals && !totals.unavailable
    ? `누적 순점수 ${totals.net > 0 ? '+' : ''}${totals.net}점 (상 ${totals.reward} · 벌 ${totals.penalty})`
    : '누적 집계 불가';
  const line = `${studentName || '학생'} 학생 | ${safeCategory} | ${safeDetail} | ${kindLabel} ${Number(points || 0)}점 | ${cumulative}`;
  const giver = isSystem ? '시스템' : (String(actorName || '').trim() || '관리자');
  const text = `[${title}] ${line} | 부여자: ${giver}${pointDate ? ` | ${pointDate}` : ''}`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${studentName || '학생'}* 학생 | ${safeCategory} | ${safeDetail} | *${kindLabel} ${Number(points || 0)}점* | ${cumulative}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `부여자: ${giver}${pointDate ? ` · 일자: ${pointDate}` : ''}` }] },
  ];
  return { text, blocks, title };
}

async function postWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SLACK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 실제 발송. 실패해도 throw 하지 않고 { ok:false, message } 를 돌려줍니다. */
export async function sendPointSlackNotice(input = {}) {
  const config = getSlackPointConfig();
  if (!config.configured) return { ok: false, skipped: true, message: '슬랙 설정 없음 (SLACK_POINT_WEBHOOK_URL 또는 SLACK_BOT_TOKEN)' };
  const message = buildPointSlackMessage(input);
  try {
    if (config.mode === 'webhook') {
      const response = await postWithTimeout(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text, blocks: message.blocks, username: SLACK_BOT_DISPLAY_NAME }),
      });
      if (!response.ok) return { ok: false, message: `슬랙 웹훅 응답 ${response.status}` };
      return { ok: true, mode: 'webhook' };
    }
    const response = await postWithTimeout('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${config.botToken}` },
      body: JSON.stringify({ channel: config.channel, text: message.text, blocks: message.blocks, username: SLACK_BOT_DISPLAY_NAME }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) return { ok: false, message: `슬랙 API 오류: ${json?.error || response.status}` };
    return { ok: true, mode: 'bot' };
  } catch (error) {
    return { ok: false, message: error?.name === 'AbortError' ? '슬랙 응답 시간 초과' : (error?.message || '슬랙 발송 오류') };
  }
}

// ─────────────────────────────────────────────────────────────
// v41-280.1: 여러 명이 한 번에 생기면(일괄 부여 · 주간 자동 상점) 메시지 하나에 학생별 한 줄씩 담습니다.
// ─────────────────────────────────────────────────────────────
const SLACK_SECTION_LIMIT = 2800; // 섹션 하나의 글자 한도(3000)보다 여유 있게

function formatTotals(totals) {
  return totals && !totals.unavailable
    ? `누적 순점수 ${totals.net > 0 ? '+' : ''}${totals.net}점 (상 ${totals.reward} · 벌 ${totals.penalty})`
    : '누적 집계 불가';
}

/**
 * @param {object} input
 *   pointType  'reward' | 'penalty'
 *   items      [{ studentName, category, detail, points, totals }]
 *   actorName / isSystem / pointDate / subtitle(선택: "자주 주는 상점 · 모범태도" 같은 묶음 설명)
 */
export function buildPointSlackBatchMessage({ pointType, items = [], actorName, isSystem = false, pointDate, subtitle = '' }) {
  const isPenalty = pointType === 'penalty';
  const title = `${isPenalty ? '벌점 발생' : '상점 발생'} · ${items.length}명`;
  const kindLabel = isPenalty ? '벌점' : '상점';
  const giver = isSystem ? '시스템' : (String(actorName || '').trim() || '관리자');
  const lines = items.map((item) => {
    const category = String(item.category || item.reason || '-').trim() || '-';
    const detail = String(item.detail || '').trim() || '-';
    return `${item.studentName || '학생'} 학생 | ${category} | ${detail} | ${kindLabel} ${Number(item.points || 0)}점 | ${formatTotals(item.totals)}`;
  });
  const text = `[${title}]${subtitle ? ` ${subtitle}` : ''}\n${lines.join('\n')}\n부여자: ${giver}${pointDate ? ` | ${pointDate}` : ''}`;

  // 섹션 글자 한도에 맞춰 줄을 나눠 담습니다.
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const bold = line.replace(/^([^|]+?) 학생 \|/, '*$1* 학생 |');
    if (current && (current.length + bold.length + 1) > SLACK_SECTION_LIMIT) { chunks.push(current); current = ''; }
    current = current ? `${current}\n${bold}` : bold;
  }
  if (current) chunks.push(current);

  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
    ...(subtitle ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: subtitle }] }] : []),
    ...chunks.slice(0, 45).map((chunk) => ({ type: 'section', text: { type: 'mrkdwn', text: chunk } })),
    { type: 'context', elements: [{ type: 'mrkdwn', text: `부여자: ${giver}${pointDate ? ` · 일자: ${pointDate}` : ''}` }] },
  ];
  return { text, blocks, title, lineCount: lines.length };
}

/** 묶음 발송. 1명이면 단건 형식으로 보냅니다. */
export async function sendPointSlackBatch(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length) return { ok: false, skipped: true, message: '보낼 항목 없음' };
  if (items.length === 1) {
    const only = items[0];
    return sendPointSlackNotice({ ...input, ...only, studentName: only.studentName, totals: only.totals });
  }
  const config = getSlackPointConfig();
  if (!config.configured) return { ok: false, skipped: true, message: '슬랙 설정 없음 (SLACK_POINT_WEBHOOK_URL 또는 SLACK_BOT_TOKEN)' };
  const message = buildPointSlackBatchMessage(input);
  try {
    if (config.mode === 'webhook') {
      const response = await postWithTimeout(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text, blocks: message.blocks, username: SLACK_BOT_DISPLAY_NAME }),
      });
      if (!response.ok) return { ok: false, message: `슬랙 웹훅 응답 ${response.status}` };
      return { ok: true, mode: 'webhook', count: items.length };
    }
    const response = await postWithTimeout('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${config.botToken}` },
      body: JSON.stringify({ channel: config.channel, text: message.text, blocks: message.blocks, username: SLACK_BOT_DISPLAY_NAME }),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) return { ok: false, message: `슬랙 API 오류: ${json?.error || response.status}` };
    return { ok: true, mode: 'bot', count: items.length };
  } catch (error) {
    return { ok: false, message: error?.name === 'AbortError' ? '슬랙 응답 시간 초과' : (error?.message || '슬랙 발송 오류') };
  }
}
