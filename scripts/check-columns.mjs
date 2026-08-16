// Beyond OS v41-186 — DB에 없는 컬럼에 쓰는 곳 찾기
//
// 왜 필요한가
//   v41-149 부터 [설문 시간표 일괄 등록]이 조용히 실패하고 있었습니다.
//   student_daily_schedules 에 없는 created_by 를 payload 에 넣고 있었는데
//   (created_by 는 parent_notification_logs 쪽 컬럼입니다),
//   빌드도 ESLint 도 이런 오류를 잡지 못합니다. 실제로 버튼을 눌러야 드러납니다.
//
// 어떻게 찾는가
//   payload 가 변수·배열·chunk 를 거쳐 전달되는 경로를 따라가는 것은 정확하지 않습니다.
//   대신 '생김새'로 찾습니다. 어떤 객체 리터럴의 snake_case 키가 특정 테이블의
//   식별 컬럼(unique 인덱스 구성 컬럼)을 모두 갖고 있으면 그 테이블의 행으로 보고,
//   나머지 키가 실제 컬럼인지 확인합니다.
//
//   대상은 저장소 SQL 에 create table 정의가 있는 테이블뿐입니다.
//   (students, daily_sessions 처럼 초기 스키마가 저장소에 없는 테이블은 컬럼 목록을
//    믿을 수 없으므로 검사하지 않습니다)
//
// 실행: npm run check:columns
//
// 알려진 오검출 9건 (v41-186 기준) — 모두 app/api/mentoring/route.js 입니다.
//   467 / 1312 : 개인 시간표가 없을 때 쓰는 임시 객체 (is_default_schedule)
//   687 / 697  : 요일 템플릿을 날짜 화면용으로 바꾼 표시용 객체
//                (is_virtual_date · is_date_slot · source_scope · mentoring_slots)
// DB 에 쓰지 않는 화면용 객체라 문제가 없습니다. 이 9건보다 늘어나면 확인하세요.

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const CODE_DIRS = ['app', 'lib'];

// ── SQL → 테이블별 컬럼 / 식별 컬럼 ─────────────────────────────────────────
function splitTopLevel(body) {
  const parts = [];
  let level = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') level += 1;
    else if (ch === ')') level -= 1;
    if (ch === ',' && level === 0) { parts.push(current); current = ''; }
    else current += ch;
  }
  parts.push(current);
  return parts;
}

function buildSchema() {
  const tables = new Map(); // name -> { columns:Set, identities:[Set] , declared:boolean }
  const ensure = (name) => {
    const key = name.replace(/["']/g, '').split('.').pop().toLowerCase();
    if (!tables.has(key)) tables.set(key, { columns: new Set(), identities: [], declared: false });
    return tables.get(key);
  };

  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');

    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql))) {
      const table = ensure(m[1]);
      table.declared = true;
      let depth = 1;
      let i = createRe.lastIndex;
      const start = i;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '(') depth += 1;
        else if (sql[i] === ')') depth -= 1;
        i += 1;
      }
      for (const raw of splitTopLevel(sql.slice(start, i - 1))) {
        const line = raw.split('\n').map((l) => l.replace(/--.*$/, '')).join(' ').trim();
        if (!line) continue;
        const unique = line.match(/^unique\s*\(([^)]*)\)/i);
        if (unique) {
          table.identities.push(new Set(unique[1].split(',').map((c) => c.trim().toLowerCase())));
          continue;
        }
        if (/^(primary\s+key|check|foreign\s+key|constraint|exclude|unique)\b/i.test(line)) continue;
        const name = line.match(/^([a-z_][a-z0-9_]*)/i);
        if (name) table.columns.add(name[1].toLowerCase());
      }
    }

    const alterRe = /alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_."]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
    while ((m = alterRe.exec(sql))) ensure(m[1]).columns.add(m[2].toLowerCase());

    // create unique index ... on T (a, b) — 식별 컬럼 후보
    const idxRe = /create\s+unique\s+index[^;]*?\son\s+([a-z0-9_."]+)\s*\(([^)]*)\)/gi;
    while ((m = idxRe.exec(sql))) {
      const cols = m[2].split(',').map((c) => c.trim().toLowerCase()).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
      if (cols.length >= 2) ensure(m[1]).identities.push(new Set(cols));
    }
  }
  return tables;
}

// ── 코드에서 객체 리터럴 훑기 ───────────────────────────────────────────────
function listCodeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of CODE_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

function readObjectBody(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(openIndex + 1, i);
    }
  }
  return null;
}

function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let i = 0;
  let atKeyPosition = true;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') { depth += 1; atKeyPosition = false; i += 1; continue; }
    if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; i += 1; continue; }
    if (ch === ',' && depth === 0) { atKeyPosition = true; i += 1; continue; }
    if (depth === 0 && atKeyPosition) {
      const m = body.slice(i).match(/^\s*(?:\/\/[^\n]*\n\s*)*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/);
      if (m) { keys.push(m[1]); i += m[0].length; atKeyPosition = false; continue; }
      if (/\s/.test(ch)) { i += 1; continue; }
      atKeyPosition = false;
    }
    i += 1;
  }
  return keys;
}

function main() {
  const schema = buildSchema();
  // 검사 대상: create table 정의가 저장소에 있고 식별 컬럼을 아는 테이블
  const targets = [...schema.entries()]
    .filter(([, t]) => t.declared && t.identities.length)
    .map(([name, t]) => ({ name, columns: t.columns, identities: t.identities }));

  const problems = [];
  for (const file of listCodeFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < src.length; i += 1) {
      if (src[i] !== '{') continue;
      const body = readObjectBody(src, i);
      if (body === null || body.length > 4000) continue;
      const keys = topLevelKeys(body);
      const snake = keys.filter((k) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(k));
      if (snake.length < 2) continue;
      const keySet = new Set(snake);

      // 식별 컬럼이 맞아떨어지는 테이블 후보를 모읍니다.
      const candidates = targets
        .filter((table) => table.identities.some((ident) => [...ident].every((c) => keySet.has(c))))
        .map((table) => ({ table, unknown: snake.filter((k) => !table.columns.has(k)) }));
      if (!candidates.length) continue;

      // 여러 테이블이 같은 식별 컬럼을 쓰면(예: student_id + schedule_date) 가장 잘 맞는
      // 테이블 하나만 봅니다. 동점이면 어느 쪽인지 단정할 수 없으므로 넘어갑니다.
      const best = Math.min(...candidates.map((c) => c.unknown.length));
      if (best === 0) continue;
      const bestOnes = candidates.filter((c) => c.unknown.length === best);
      if (bestOnes.length !== 1) continue;

      // 식별 컬럼을 모르는(unique 제약이 없는) 테이블 중에 모든 키를 담는 곳이 있으면
      // 그 테이블 행일 가능성이 높으므로 넘어갑니다.
      const fitsSomeTable = [...schema.values()].some((t) => t.declared && snake.every((k) => t.columns.has(k)));
      if (fitsSomeTable) continue;

      const { table, unknown } = bestOnes[0];
      const line = src.slice(0, i).split('\n').length;
      for (const key of unknown) {
        problems.push({ file: path.relative(ROOT, file), line, table: table.name, key });
      }
    }
  }

  if (!problems.length) {
    console.log(`OK — 검사 대상 ${targets.length}개 테이블, 없는 컬럼에 쓰는 곳이 없습니다.`);
    return;
  }
  console.log(`없는 컬럼에 쓰는 곳 ${problems.length}건:`);
  for (const p of problems) {
    console.log(`  ${p.file}:${p.line}  ${p.table} 에 '${p.key}' 컬럼이 없습니다.`);
  }
  process.exitCode = 1;
}

main();
