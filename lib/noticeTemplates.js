// Beyond OS 공지 알림톡 카테고리(목적별 템플릿) 설정 — 클라이언트/서버 공용
//
// 카카오 알림톡은 "형식화된 정보성 메시지"만 허용하므로, 포괄적인 "공지사항"
// 템플릿 하나로는 심사를 통과할 수 없습니다. 목적별로 승인받은 템플릿을 등록하고
// 여기서 카테고리 → SOLAPI 템플릿 ID/코드 + 변수 스키마를 매핑합니다.
//
// input 유형
//   - 'link'  : 상세 내용을 웹링크(인앱 /n/{token} 또는 외부 URL)로 안내. 변수 #{링크}
//   - 'fields': 기간/사유/내용 등 정해진 항목을 알림톡 본문에 직접 표기. (링크 불필요)

export const NOTICE_CATEGORIES = [
  {
    key: 'operating_rules',
    label: '운영규정',
    desc: '운영규정·이용안내 등 상세 내용을 웹링크로 안내합니다.',
    input: 'link',
    fields: [],
    kakaoVars: ['#{링크}'],
    required: ['#{링크}'],
    // 앞의 값부터 우선 사용, 없으면 다음 값으로 폴백 (기존 SOLAPI_TEMPLATE_ID_NOTICE 호환)
    templateIdEnvs: ['SOLAPI_TEMPLATE_ID_NOTICE_OPERATING', 'SOLAPI_TEMPLATE_ID_NOTICE'],
    templateCodeEnvs: ['KAKAO_TEMPLATE_CODE_NOTICE_OPERATING', 'KAKAO_TEMPLATE_CODE_NOTICE'],
    sample:
      '[The Place 26 · 비욘드 학습관리센터]\nThe Place 26 운영 안내\n\n안녕하세요, 학부모님.\nThe Place 26 학습관리센터 운영 관련 안내를 전해드립니다.\n자세한 일정과 운영규정은 아래 링크에서 확인해 주세요.\n\n▶ #{링크}\n\n문의: The Place 26 비욘드 학습관리센터 (031-795-3306)',
  },
  {
    key: 'hours_change',
    label: '운영시간 변동 안내',
    desc: '적용 기간·사유·변동 내용을 알림톡 본문에 직접 표기합니다. (웹링크 불필요)',
    input: 'fields',
    fields: [
      { key: 'period', label: '변동 적용 기간', kakao: '#{기간}', placeholder: '예: 7/28(월) ~ 8/1(금)', max: 40 },
      { key: 'reason', label: '변동 사유', kakao: '#{사유}', placeholder: '예: 여름 특별방학', max: 40 },
      { key: 'detail', label: '변동 내용', kakao: '#{내용}', placeholder: '예: 오전 9시 개원 → 오전 10시 개원', max: 200 },
    ],
    kakaoVars: ['#{기간}', '#{사유}', '#{내용}'],
    required: ['#{기간}', '#{사유}', '#{내용}'],
    templateIdEnvs: ['SOLAPI_TEMPLATE_ID_NOTICE_HOURS'],
    templateCodeEnvs: ['KAKAO_TEMPLATE_CODE_NOTICE_HOURS'],
    sample:
      '[The Place 26 · 비욘드 학습관리센터]\n운영시간 변동 안내\n\n안녕하세요, 학부모님.\n아래와 같이 운영시간이 변동되어 안내드립니다.\n\n- 적용 기간: #{기간}\n- 변동 사유: #{사유}\n- 변동 내용: #{내용}\n\n문의: The Place 26 비욘드 학습관리센터 (031-795-3306)',
  },
  {
    key: 'refund_policy',
    label: '환불규정',
    desc: '환불규정 안내를 웹링크로 발송합니다.',
    input: 'link',
    fields: [],
    kakaoVars: ['#{링크}'],
    required: ['#{링크}'],
    templateIdEnvs: ['SOLAPI_TEMPLATE_ID_NOTICE_REFUND'],
    templateCodeEnvs: ['KAKAO_TEMPLATE_CODE_NOTICE_REFUND'],
    sample:
      '[The Place 26 · 비욘드 학습관리센터]\n수강 등록 환불규정 안내\n\n안녕하세요, 학부모님.\nThe Place 26에 수강 등록해주신 자녀의 환불규정을 안내드립니다.\n자세한 내용은 아래 링크에서 확인해 주세요.\n\n▶ #{링크}\n\n문의: The Place 26 비욘드 학습관리센터 (031-795-3306)',
  },
];

// v41-271: 좌석번호·닉네임 안내 — 학생마다 값이 다른 '학생별' 유형입니다.
// v41-271.1: 심사 기준 검토 반영 — 수강 등록(계약 관계) 근거와 발송 대상을 본문에 명시, 문구 정돈.
//
// input 'per_student': 본문 입력이 없습니다. 학생 정보(기본 좌석·닉네임)에서 변수를 채워
// 그 학생의 보호자(또는 학생 본인)에게 각각 다른 알림톡이 나갑니다.
export const SEAT_NICKNAME_TEMPLATE_TEXT = [
  '[The Place 26 · 비욘드 학습관리센터]',
  '비욘드 좌석번호 및 닉네임 안내',
  '',
  '안녕하세요, 학부모님.',
  '비욘드 학기 중 프로그램에 수강 등록하신 #{학생이름} 학생의 좌석번호와 닉네임을 안내드립니다.',
  '',
  '[개별 안내]',
  '▶ 학생 이름: #{학생이름}',
  '▶ 좌석번호: #{좌석번호}',
  '▶ 닉네임: #{닉네임}',
  '',
  '[닉네임 안내]',
  '닉네임은 프로그램 기간 중 순공시간 랭킹을 공개할 때만 사용됩니다.',
  '타인에게 공개하지 마시고 본인 닉네임을 꼭 기억해 주세요.',
  '※ 닉네임 공개에 동의하지 않으신 경우 랭킹에는 닉네임 대신 ♥♥♥로 표기됩니다.',
  '',
  '[태블릿 준비 안내]',
  '인강 시청용 태블릿은 등원 전 반드시 정리해 주세요.',
  '학습 관련 앱을 제외한 모든 앱(인스타그램, 카카오톡, 유튜브, 게임 등)은 삭제 부탁드립니다.',
  '프로그램 기간 중에는 센터의 차단앱으로 비학습 앱 사용을 제한합니다.',
  '다만 기술적인 차단만으로는 한계가 있습니다.',
  '학습 환경을 지키는 가장 확실한 방법은 학생 본인의 자발적인 실천입니다.',
  '가정에서도 함께 점검해 주시면 아이가 훨씬 수월하게 집중할 수 있습니다.',
  '',
  '감사합니다.',
  '',
  '※ 이 메시지는 비욘드 학기 중 프로그램에 수강 등록한 학생의 보호자께 발송되는 안내입니다.',
  '문의: The Place 26 비욘드 학습관리센터 (031-795-3306)',
].join('\n');

NOTICE_CATEGORIES.push({
  key: 'seat_nickname',
  label: '좌석번호·닉네임 안내',
  desc: '기수 시작 전에 보냅니다. 본문 입력 없이 학생 정보의 기본 좌석번호와 닉네임이 학생마다 자동으로 들어갑니다.',
  input: 'per_student',
  fields: [],
  kakaoVars: ['#{학생이름}', '#{좌석번호}', '#{닉네임}'],
  required: ['#{학생이름}', '#{좌석번호}', '#{닉네임}'],
  templateIdEnvs: ['SOLAPI_TEMPLATE_ID_NOTICE_SEAT_NICKNAME'],
  templateCodeEnvs: ['KAKAO_TEMPLATE_CODE_NOTICE_SEAT_NICKNAME'],
  sample: SEAT_NICKNAME_TEMPLATE_TEXT,
});

// 닉네임 공개에 동의하지 않은 학생의 닉네임 칸에 넣는 값
export const NICKNAME_PRIVATE_TEXT = '비공개 (랭킹에 ♥♥♥로 표기)';

/**
 * 학생 한 명의 좌석·닉네임 변수를 만듭니다.
 *
 * 보낼 수 없는 경우(ok=false)와 사유
 *   - 기본 좌석이 없음           → '좌석 미배정'
 *   - 랭킹 공개 동의인데 닉네임 없음 → '닉네임 미입력'
 * 랭킹 공개에 동의하지 않은 학생은 닉네임이 없어도 보냅니다. (랭킹에 ♥♥♥로만 나가므로)
 */
export function buildSeatNicknameVariables(student = {}) {
  const name = String(student?.name || '').trim();
  const seatRaw = student?.default_seat_no ?? student?.defaultSeatNo ?? student?.seat_no ?? student?.seatNo;
  const seat = Number(seatRaw);
  const nickname = String(student?.nickname || '').trim();
  const optIn = student?.ranking_opt_in === true || student?.rankingOptIn === true;

  if (!name) return { ok: false, reason: '이름 없음', variables: null };
  if (!Number.isFinite(seat) || seat <= 0) return { ok: false, reason: '좌석 미배정', variables: null };
  if (!nickname && optIn) return { ok: false, reason: '닉네임 미입력', variables: null };

  return {
    ok: true,
    reason: '',
    variables: {
      '#{학생이름}': name,
      '#{좌석번호}': `${seat}번`,
      '#{닉네임}': nickname || NICKNAME_PRIVATE_TEXT,
    },
  };
}

// 테스트 수신번호 모드처럼 학생이 특정되지 않을 때 쓰는 견본 변수
export const SEAT_NICKNAME_SAMPLE_VARIABLES = {
  '#{학생이름}': '홍길동',
  '#{좌석번호}': '1번',
  '#{닉네임}': '견본닉네임',
};

export function noticeCategoryIsPerStudent(key) {
  return getNoticeCategory(key).input === 'per_student';
}

export const NOTICE_CATEGORY_MAP = Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.key, c]));
export const DEFAULT_NOTICE_CATEGORY = 'operating_rules';

export function getNoticeCategory(key) {
  return NOTICE_CATEGORY_MAP[key] || NOTICE_CATEGORY_MAP[DEFAULT_NOTICE_CATEGORY];
}

export function noticeCategoryUsesLink(key) {
  return getNoticeCategory(key).input === 'link';
}

// 카테고리 + 입력값 → 카카오 변수 객체 ({ '#{링크}': ..., '#{기간}': ... })
export function buildNoticeKakaoVariables(key, { link = '', title = '', data = {}, sample = null } = {}) {
  const cat = getNoticeCategory(key);
  // 학생별 유형: 수신자마다 변수가 다릅니다(recipient.variables). 여기서는 공용 견본만 돌려줍니다.
  if (cat.input === 'per_student') return { ...(sample || SEAT_NICKNAME_SAMPLE_VARIABLES) };
  if (cat.input === 'fields') {
    const out = {};
    for (const f of cat.fields) out[f.kakao] = String((data && data[f.key]) ?? '');
    return out;
  }
  return { '#{링크}': String(link || ''), '#{공지제목}': String(title || '') };
}
