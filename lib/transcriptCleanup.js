// Beyond OS v41-147
// 음성 전사 결과에서 흔히 나타나는 "환각(hallucination)" 산출물을 정리합니다.
//
// 배경
//   Whisper 계열 모델은 무음·잡음·말끝 흐림 구간에서 같은 문장을 수십~수백 번 반복하거나
//   '###', '♪', '[음악]' 같은 의미 없는 토큰을 뱉는 known issue가 있습니다.
//   그대로 두면 전사문이 오염되고, 그 텍스트를 다음 구간의 힌트(prompt)로 넘길 경우
//   반복이 계속 되먹임되어 이후 구간까지 전부 망가집니다.
//
// 그래서 (1) 반복 구간을 접고 (2) 의미 없는 토큰을 지운 뒤,
// 정리된 텍스트만 화면에 넣고 다음 구간 힌트로도 정리본만 사용합니다.

// 전사 모델이 무음 구간에서 자주 만들어내는 잡음 토큰
const ARTIFACT_LINE_PATTERN = /^[\s#*_~\-–—.·•=+<>|/\\^"'`]+$/;
const ARTIFACT_TOKEN_PATTERN = /(#{2,}|\*{2,}|_{2,}|~{2,}|={2,})/g;
const BRACKET_NOISE_PATTERN = /[\[(（【]\s*(음악|박수|웃음|침묵|무음|잡음|배경음|music|applause|silence|blank[_\s]?audio|inaudible)\s*[\])）】]/gi;

// 비교용 정규화: 공백과 문장부호를 지우고 소문자로
function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s.,!?~…"'`·’”“()\[\]{}\-–—]/g, '');
}

// 문장 단위로 자르되 구분자를 유지합니다.
function splitSentences(text) {
  const parts = String(text || '').match(/[^.!?。？！\n]+[.!?。？！\n]*/g);
  return (parts || []).map((item) => item.trim()).filter(Boolean);
}

/**
 * 같은 문장이 연속으로 반복되는 구간을 접습니다.
 * (예: "아니면 집에서 한다고?" × 200회 → 1회)
 */
function collapseRepeatedSentences(text, { keep = 1, minRun = 3 } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length < minRun) return { text: String(text || '').trim(), removed: 0 };

  const kept = [];
  let removed = 0;
  let runKey = '';
  let runCount = 0;

  for (const sentence of sentences) {
    const key = normalizeForCompare(sentence);
    if (!key) continue;
    if (key === runKey) {
      runCount += 1;
      if (runCount <= keep) kept.push(sentence);
      else removed += 1;
      continue;
    }
    runKey = key;
    runCount = 1;
    kept.push(sentence);
  }

  return { text: kept.join(' ').trim(), removed };
}

/**
 * 문장부호 없이 같은 어절 묶음이 반복되는 경우를 접습니다.
 * (예: "네 네 네 네 네 ..." 또는 "그래서 그래서 그래서 ...")
 */
function collapseRepeatedPhrases(text, { maxUnitWords = 8, minRun = 4 } = {}) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (words.length < minRun * 2) return { text: String(text || '').trim(), removed: 0 };

  const out = [];
  let removed = 0;
  let index = 0;

  while (index < words.length) {
    let collapsed = false;

    // 긴 묶음부터 검사해야 "A B A B A B"를 낱말 단위로 잘못 접지 않습니다.
    for (let unit = maxUnitWords; unit >= 1; unit -= 1) {
      if (index + unit * minRun > words.length) continue;
      const base = words.slice(index, index + unit).map(normalizeForCompare).join('|');
      if (!base.replace(/\|/g, '')) continue;

      let repeats = 1;
      while (
        index + unit * (repeats + 1) <= words.length
        && words.slice(index + unit * repeats, index + unit * (repeats + 1)).map(normalizeForCompare).join('|') === base
      ) {
        repeats += 1;
      }

      if (repeats >= minRun) {
        out.push(...words.slice(index, index + unit));
        removed += (repeats - 1) * unit;
        index += unit * repeats;
        collapsed = true;
        break;
      }
    }

    if (!collapsed) {
      out.push(words[index]);
      index += 1;
    }
  }

  return { text: out.join(' ').trim(), removed };
}

// 의미 없는 기호/괄호 토큰을 제거합니다.
function stripArtifacts(text) {
  let out = String(text || '');
  out = out.replace(BRACKET_NOISE_PATTERN, ' ');
  out = out.replace(ARTIFACT_TOKEN_PATTERN, ' ');
  out = out
    .split('\n')
    .filter((line) => !ARTIFACT_LINE_PATTERN.test(line))
    .join('\n');
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/**
 * 전사 한 구간을 정리합니다.
 * @returns {{ text: string, removedWords: number, degenerate: boolean, note: string }}
 */
export function cleanTranscriptSegment(rawText) {
  const raw = String(rawText || '').trim();
  if (!raw) return { text: '', removedWords: 0, degenerate: false, note: '' };

  const stripped = stripArtifacts(raw);
  const bySentence = collapseRepeatedSentences(stripped);
  const byPhrase = collapseRepeatedPhrases(bySentence.text);

  const text = byPhrase.text.trim();
  const rawWordCount = raw.split(/\s+/).filter(Boolean).length;
  const keptWordCount = text.split(/\s+/).filter(Boolean).length;
  const removedWords = Math.max(0, rawWordCount - keptWordCount);

  // 원문의 대부분이 반복이었다면 그 사실을 알려 사용자가 직접 확인하도록 합니다.
  const degenerate = rawWordCount >= 40 && keptWordCount > 0 && keptWordCount / rawWordCount < 0.25;

  let note = '';
  if (removedWords > 0) {
    note = degenerate
      ? '이 구간은 같은 말이 반복 인식되어 대부분을 정리했습니다. 실제 대화와 다르면 직접 수정하세요.'
      : '반복 인식된 부분을 정리했습니다.';
  }

  return { text, removedWords, degenerate, note };
}

/**
 * 이어붙일 때 구간 경계에서 같은 문장이 겹치는 경우를 제거합니다.
 * (앞 구간 끝 문장 = 뒤 구간 첫 문장)
 */
export function appendTranscriptChunk(previous, next) {
  const prev = String(previous || '').trim();
  const add = String(next || '').trim();
  if (!prev) return add;
  if (!add) return prev;

  const prevSentences = splitSentences(prev);
  const addSentences = splitSentences(add);
  if (!prevSentences.length || !addSentences.length) return `${prev} ${add}`.trim();

  // 뒤 구간 앞머리가 앞 구간 꼬리와 같으면(최대 3문장) 겹친 만큼 잘라냅니다.
  const maxOverlap = Math.min(3, prevSentences.length, addSentences.length);
  for (let size = maxOverlap; size >= 1; size -= 1) {
    const tail = prevSentences.slice(-size).map(normalizeForCompare).join('|');
    const head = addSentences.slice(0, size).map(normalizeForCompare).join('|');
    if (tail && tail === head) {
      const rest = addSentences.slice(size).join(' ').trim();
      return rest ? `${prev} ${rest}`.trim() : prev;
    }
  }

  return `${prev} ${add}`.trim();
}

/**
 * 다음 구간에 넘길 힌트를 만듭니다.
 * 반복이 남아 있는 텍스트를 힌트로 주면 반복이 계속 되먹임되므로,
 * 정리된 텍스트에서 서로 다른 마지막 문장들만 추립니다.
 */
export function buildPromptHint(transcript, limit = 240) {
  const cleaned = cleanTranscriptSegment(transcript).text;
  const sentences = splitSentences(cleaned);
  const unique = [];
  const seen = new Set();
  for (let i = sentences.length - 1; i >= 0 && unique.length < 3; i -= 1) {
    const key = normalizeForCompare(sentences[i]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.unshift(sentences[i]);
  }
  return unique.join(' ').slice(-limit).trim();
}
