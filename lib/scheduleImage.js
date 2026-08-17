// Beyond OS v41-195 — 학생 개인 시간표를 이미지(PNG)로 그립니다.
//
// 학부모에게 보낼 한 장짜리 확인용 시간표입니다.
//   상단: 학생 이름 · 학교/학년 · 기수와 기간
//   중단: 주간 루틴 표 (월~일 × 등원 / 하원 / 외출)
//   하단: 특별 일정 (결석일, 그 날만 시간이 다른 날)
//
// 외부 라이브러리 없이 캔버스에 직접 그립니다.
// (SVG → 이미지 변환은 브라우저마다 한글 글꼴 처리가 달라 깨질 수 있습니다)

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABEL = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일' };

const COLORS = {
  ink: '#1d1d1f',
  sub: '#6e6e73',
  line: '#e3e3e6',
  headBg: '#f5f5f7',
  accent: '#0071e3',
  restBg: '#fafafa',
  restInk: '#a1a1a6',
  awayInk: '#b26a00',
  absentInk: '#a33a3a',
  cardBg: '#ffffff',
};

const FONT = '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';

function font(size, weight = 400) {
  return `${weight} ${size}px ${FONT}`;
}

function formatPeriod(startDate, endDate) {
  const short = (value) => String(value || '').slice(2).replace(/-/g, '.');
  return `${short(startDate)} ~ ${short(endDate)}`;
}

function weekdayOf(dateString) {
  const index = new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
  return ['일', '월', '화', '수', '목', '금', '토'][index];
}

function formatExceptionLine(item) {
  const head = `${String(item.date).slice(5).replace('-', '/')}(${weekdayOf(item.date)})`;
  if (item.absent) {
    return { head, body: `결석${item.absentReason ? ` · ${item.absentReason}` : ''}`, tone: 'absent' };
  }
  const away = (item.breaks || []).map((brk) => {
    const range = brk.end ? `${brk.start}~${brk.end}` : `${brk.start}~`;
    return brk.reason ? `${range} ${brk.reason}` : range;
  });
  const parts = [`등하원 ${item.checkIn}~${item.checkOut}`];
  if (away.length) parts.push(`외출 ${away.join(', ')}`);
  return { head, body: parts.join(' · '), tone: 'away' };
}

// 캔버스에 그린 뒤 PNG Blob 을 돌려줍니다.
export async function renderScheduleImage(entry, meta = {}) {
  const {
    brandName = 'BEYOND 학습집중관리센터',
    cohortName = '',
    startDate = '',
    endDate = '',
    scale = 2,
  } = meta;

  const exceptions = Array.isArray(entry.exceptions) ? entry.exceptions : [];
  const shownExceptions = exceptions.slice(0, 14);
  const hiddenCount = exceptions.length - shownExceptions.length;

  // ── 레이아웃 계산 ─────────────────────────────────────────────
  const width = 900;
  const padding = 36;
  const headerHeight = 132;
  const tableHeadHeight = 40;
  const rowHeight = 58;
  const tableHeight = tableHeadHeight + rowHeight * DAY_ORDER.length;
  const specialRowHeight = 30;
  // 제목 위 여백 26 + 제목 줄 24 + 항목들 + 아래 여백 8
  const specialBlockHeight = exceptions.length
    ? 50 + specialRowHeight * shownExceptions.length + (hiddenCount > 0 ? specialRowHeight : 0) + 8
    : 12;
  const footerHeight = 60;
  const height = headerHeight + tableHeight + specialBlockHeight + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';

  ctx.fillStyle = COLORS.cardBg;
  ctx.fillRect(0, 0, width, height);

  // ── 머리글 ────────────────────────────────────────────────────
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, 0, width, 6);

  let y = 40;
  ctx.fillStyle = COLORS.sub;
  ctx.font = font(13, 600);
  ctx.fillText(brandName, padding, y);

  y += 30;
  ctx.fillStyle = COLORS.ink;
  ctx.font = font(26, 800);
  const nameText = `${entry.studentName || '학생'} 학생 시간표`;
  ctx.fillText(nameText, padding, y);

  const info = [entry.school, entry.grade].filter(Boolean).join(' ');
  if (info) {
    const nameWidth = measureWidth(ctx, nameText, font(26, 800));
    ctx.font = font(14, 500);
    ctx.fillStyle = COLORS.sub;
    ctx.fillText(info, padding + nameWidth + 12, y + 3);
  }

  y += 28;
  ctx.font = font(14, 600);
  ctx.fillStyle = COLORS.accent;
  const periodText = [cohortName, formatPeriod(startDate, endDate)].filter(Boolean).join(' · ');
  ctx.fillText(periodText, padding, y);

  // ── 주간 루틴 표 ──────────────────────────────────────────────
  let tableTop = headerHeight;
  const tableLeft = padding;
  const tableWidth = width - padding * 2;
  const colDay = 78;
  const colTime = 190;
  const colAway = tableWidth - colDay - colTime;

  ctx.fillStyle = COLORS.headBg;
  ctx.fillRect(tableLeft, tableTop, tableWidth, tableHeadHeight);
  ctx.fillStyle = COLORS.sub;
  ctx.font = font(13, 700);
  ctx.fillText('요일', tableLeft + 16, tableTop + tableHeadHeight / 2);
  ctx.fillText('등원 ~ 하원', tableLeft + colDay + 16, tableTop + tableHeadHeight / 2);
  ctx.fillText('외출 (정기)', tableLeft + colDay + colTime + 16, tableTop + tableHeadHeight / 2);

  let rowTop = tableTop + tableHeadHeight;
  for (const dayKey of DAY_ORDER) {
    const day = entry.days?.[dayKey] || null;
    const isRest = !day;

    if (isRest) {
      ctx.fillStyle = COLORS.restBg;
      ctx.fillRect(tableLeft, rowTop, tableWidth, rowHeight);
    }

    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tableLeft, rowTop + 0.5);
    ctx.lineTo(tableLeft + tableWidth, rowTop + 0.5);
    ctx.stroke();

    const midY = rowTop + rowHeight / 2;
    ctx.fillStyle = isRest ? COLORS.restInk : COLORS.ink;
    ctx.font = font(16, 800);
    ctx.fillText(DAY_LABEL[dayKey], tableLeft + 16, midY);

    if (isRest) {
      ctx.font = font(14, 500);
      ctx.fillStyle = COLORS.restInk;
      ctx.fillText('등원 없음', tableLeft + colDay + 16, midY);
    } else {
      ctx.font = font(17, 700);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(`${day.checkIn} ~ ${day.checkOut}`, tableLeft + colDay + 16, midY);

      const away = (day.breaks || []).map((brk) => {
        const range = brk.end ? `${brk.start}~${brk.end}` : `${brk.start}~`;
        return brk.reason ? `${range} ${brk.reason}` : range;
      });
      ctx.font = font(13, 500);
      ctx.fillStyle = away.length ? COLORS.awayInk : COLORS.restInk;
      const awayLines = away.length ? away.slice(0, 2) : ['-'];
      if (awayLines.length === 1) {
        ctx.fillText(clip(ctx, awayLines[0], colAway - 32), tableLeft + colDay + colTime + 16, midY);
      } else {
        ctx.fillText(clip(ctx, awayLines[0], colAway - 32), tableLeft + colDay + colTime + 16, midY - 10);
        const rest = away.length > 2 ? `${awayLines[1]} 외 ${away.length - 2}건` : awayLines[1];
        ctx.fillText(clip(ctx, rest, colAway - 32), tableLeft + colDay + colTime + 16, midY + 10);
      }
    }
    rowTop += rowHeight;
  }

  ctx.strokeStyle = COLORS.line;
  ctx.strokeRect(tableLeft + 0.5, tableTop + 0.5, tableWidth - 1, tableHeight - 1);
  for (const x of [tableLeft + colDay, tableLeft + colDay + colTime]) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, tableTop);
    ctx.lineTo(x + 0.5, tableTop + tableHeight);
    ctx.stroke();
  }

  // ── 특별 일정 ─────────────────────────────────────────────────
  let cursorY = tableTop + tableHeight;
  if (exceptions.length) {
    cursorY += 26;
    ctx.fillStyle = COLORS.ink;
    ctx.font = font(15, 800);
    ctx.fillText(`특별 일정 (${exceptions.length}건)`, padding, cursorY);
    ctx.fillStyle = COLORS.sub;
    ctx.font = font(12, 500);
    ctx.fillText('위 주간 루틴과 다른 날입니다.', padding + measureWidth(ctx, `특별 일정 (${exceptions.length}건)`, font(15, 800)) + 10, cursorY + 1);
    cursorY += 24;

    for (const item of shownExceptions) {
      const line = formatExceptionLine(item);
      ctx.font = font(13, 700);
      ctx.fillStyle = line.tone === 'absent' ? COLORS.absentInk : COLORS.accent;
      ctx.fillText(line.head, padding, cursorY + specialRowHeight / 2);
      ctx.font = font(13, 500);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(clip(ctx, line.body, tableWidth - 110), padding + 92, cursorY + specialRowHeight / 2);
      cursorY += specialRowHeight;
    }
    if (hiddenCount > 0) {
      ctx.font = font(12, 500);
      ctx.fillStyle = COLORS.sub;
      ctx.fillText(`… 외 ${hiddenCount}건`, padding, cursorY + specialRowHeight / 2);
      cursorY += specialRowHeight;
    }
  }

  // ── 꼬리말 ────────────────────────────────────────────────────
  const footerY = height - footerHeight + 12;
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  ctx.moveTo(padding, footerY + 0.5);
  ctx.lineTo(width - padding, footerY + 0.5);
  ctx.stroke();
  ctx.font = font(12, 500);
  ctx.fillStyle = COLORS.sub;
  ctx.fillText('시간표가 실제와 다르면 센터로 알려 주세요. 확인해 주신 내용으로 등·하원과 출결을 관리합니다.', padding, footerY + 24);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function measureWidth(ctx, text, withFont) {
  const previous = ctx.font;
  if (withFont) ctx.font = withFont;
  const width = ctx.measureText(text).width;
  ctx.font = previous;
  return width;
}

// 칸을 넘치면 말줄임합니다.
function clip(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export function scheduleImageFileName(entry, meta = {}) {
  const cohort = String(meta.cohortName || '').replace(/\s+/g, '');
  const name = String(entry.studentName || '학생').replace(/\s+/g, '');
  return [cohort, name, '시간표'].filter(Boolean).join('_') + '.png';
}
