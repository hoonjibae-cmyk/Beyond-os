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

export const NOTICE_CATEGORY_MAP = Object.fromEntries(NOTICE_CATEGORIES.map((c) => [c.key, c]));
export const DEFAULT_NOTICE_CATEGORY = 'operating_rules';

export function getNoticeCategory(key) {
  return NOTICE_CATEGORY_MAP[key] || NOTICE_CATEGORY_MAP[DEFAULT_NOTICE_CATEGORY];
}

export function noticeCategoryUsesLink(key) {
  return getNoticeCategory(key).input === 'link';
}

// 카테고리 + 입력값 → 카카오 변수 객체 ({ '#{링크}': ..., '#{기간}': ... })
export function buildNoticeKakaoVariables(key, { link = '', title = '', data = {} } = {}) {
  const cat = getNoticeCategory(key);
  if (cat.input === 'fields') {
    const out = {};
    for (const f of cat.fields) out[f.kakao] = String((data && data[f.key]) ?? '');
    return out;
  }
  return { '#{링크}': String(link || ''), '#{공지제목}': String(title || '') };
}
