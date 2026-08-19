// Beyond OS v41-211 — 길어질 수 있는 .in(...) 조회를 찾아냅니다.
//
// 왜 필요한가
//   Supabase(PostgREST)는 .in('col', [a, b, c]) 를 조회 주소로 보냅니다.
//     GET /rest/v1/표?col=in.(uuid,uuid,...)
//   uuid 하나가 37자라, 목록이 200개만 넘어도 주소가 7KB를 넘고
//   앞단 게이트웨이가 400(Bad Request)으로 끊습니다.
//   v41-210 의 랭킹보드 장애가 이것이었고, 화면에는 원인을 알 수 없는
//   'Bad Request' 한 줄만 떴습니다. 빌드도 ESLint 도 이걸 잡지 못합니다.
//
// 무엇을 잡는가
//   .in('컬럼', 변수) 중에서 그 변수가 '나눠진 조각'이 아닌 것.
//   나눈 조각으로 인정하는 이름: part / chunk / group / batch / slice
//   (lib/supabaseChunk.js 의 selectInChunks · runInChunks 가 넘겨주는 이름)
//
// 무엇을 봐주는가
//   - 값이 코드에 직접 적힌 목록:  .in('event_type', ['away', 'check_out'])
//   - 아래 SAFE 목록에 적어 둔 곳 (크기가 확실히 작은 경우, 이유를 함께 적습니다)
//
// 새로 걸리면 lib/supabaseChunk.js 의 헬퍼를 쓰거나,
// 크기가 작다는 근거를 SAFE 에 이유와 함께 적으세요.

import fs from 'fs';
import path from 'path';

const ROOTS = ['app', 'lib'];
const CHUNK_NAMES = /^(part|chunk|group|batch|slice)$/;

// 목록 크기가 구조적으로 작은 곳. [파일:컬럼] → 이유
const SAFE = {
  'app/api/auto-checkout/route.js:seat_status': '좌석 상태 값 몇 개',
  'app/api/kiosk-attendance-bridge/route.js:event_type': '이벤트 종류 몇 개',
  'app/api/kakao-send-webhook/route.js:action_type': '로그 종류 몇 개',
  'app/api/report-activity/route.js:action_type': '로그 종류 몇 개',
  'app/api/mentoring/route.js:setting_key': '설정 키 2개',
  'app/api/dashboard/route.js:setting_key': '설정 키 2개',
  'app/api/report-send-config/route.js:setting_key': '설정 키 몇 개',

  // 좌석 26석 기준 명단 크기(수십 명)
  'app/api/schedules/coverage/route.js:student_id': '기수 명단(수십 명)',
  'app/api/schedules/bulk-generate/route.js:id': '기수 명단(수십 명)',
  'app/api/schedules/bulk-generate/route.js:student_id': '기수 명단(수십 명)',
  'app/api/schedules/route.js:student_id': '기수 명단(수십 명)',
  'app/api/schedule-import/route.js:student_id': '업로드한 명단(수십 명)',
  'app/api/schedule-confirm/route.js:id': '기수 명단(수십 명)',
  'app/api/schedule-confirm/route.js:student_id': '기수 명단(수십 명)',
  'app/api/schedule-confirm-send/route.js:id': '기수 명단(수십 명)',
  'app/api/mentoring/route.js:id': '기수 명단(수십 명)',
  'app/api/mentoring/route.js:student_id': '기수 명단(수십 명)',
  'app/api/student-point-rewards/route.js:id': '화면에서 고른 학생들',
  'app/api/student-nicknames/route.js:id': '화면에서 고른 학생들',
  'app/api/cohorts/route.js:id': '기수 명단(수십 명)',
  'app/api/default-schedule/route.js:id': '기수 목록(몇 개)',
  'app/api/default-schedule/route.js:student_id': '기수 명단(수십 명)',

  // 날짜 목록 — 한 번에 다루는 기간이 기수 단위(최대 120일)
  'app/api/schedules/route.js:schedule_date': '기간 내 날짜(최대 수십 개)',
  'app/api/mentoring/route.js:schedule_date': '기간 내 날짜(최대 수십 개)',
  'app/api/default-schedule/route.js:schedule_date': '휴무일 목록(수십 개)',

  // 하루치 세션·리포트 (좌석 26석)
  'app/api/dashboard/route.js:session_id': '오늘 세션(수십 건)',
  'app/api/dashboard-version/route.js:session_id': '오늘 세션(수십 건)',
  'app/api/daily-report-targets/route.js:session_id': '하루치 세션(수십 건)',
  'app/api/weekly-report-send/route.js:session_id': '한 학생의 한 주(7건)',
  'app/api/report-share-link/route.js:id': '한 번에 보내는 리포트(수십 건)',
  'app/api/report-share-link/route.js:report_id': '한 번에 보내는 리포트(수십 건)',
  'app/api/kiosk-attendance-holds/route.js:id': '화면에서 고른 보류 건',
  'app/api/mentoring/route.js:slot_id': '요일별 차시(몇 개)',
  'app/api/mentoring/route.js:date_slot_id': '하루 차시(몇 개)',
  'app/api/dashboard/route.js:date_slot_id': '하루 차시(몇 개)',
  'app/api/dashboard/route.js:id': '좌석 26석 · 오늘 세션 · 차시(수십 건)',
  'app/api/dashboard/route.js:slot_id': '하루 차시(몇 개)',
  'app/api/dashboard/route.js:student_id': '오늘 예약결석 세션의 학생(수십 명)',
  'app/api/notice-send/route.js:id': '기수 명단(수십 명)',
  'app/api/student-points/route.js:id': '상벌점 기록의 학생(중복 제거, 수십 명)',
  'app/api/weekly-report/route.js:id': '리포트의 학생(중복 제거, 수십 명)',
  'lib/defaultScheduleServer.js:id': '기수 목록(몇 개)',
  'app/r/[token]/page.jsx:session_id': '학생 한 명의 리포트 기간(1주, 7건)',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const findings = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      // .in('컬럼', 값)  —  값이 그 줄에서 끝나는 형태만 봅니다.
      const match = line.match(/\.in\(\s*['"]([\w.]+)['"]\s*,\s*([^)]+)\)/);
      if (!match) return;
      const [, column, rawValue] = match;
      const value = rawValue.trim();

      // 코드에 직접 적은 목록은 크기가 눈에 보입니다.
      if (value.startsWith('[')) return;

      // 나눠진 조각을 넘기는 형태는 안전합니다.
      const base = value.replace(/^Array\.from\(/, '').replace(/[)\s]+$/, '').split(/[.[]/)[0];
      if (CHUNK_NAMES.test(base)) return;

      const key = `${file}:${column}`;
      if (SAFE[key]) return;

      findings.push({ file, line: index + 1, column, value, text: line.trim() });
    });
  }
}

if (!findings.length) {
  console.log('길어질 수 있는 .in(...) 조회 없음');
  process.exit(0);
}

console.log(`나누지 않은 .in(...) 조회 ${findings.length}건:`);
for (const item of findings) {
  console.log(`  ${item.file}:${item.line}  .in('${item.column}', ${item.value})`);
}
console.log('\nlib/supabaseChunk.js 의 selectInChunks / runInChunks 를 쓰거나,');
console.log('목록이 확실히 작으면 scripts/check-in-chunks.mjs 의 SAFE 에 이유와 함께 적어 주세요.');
process.exit(1);
