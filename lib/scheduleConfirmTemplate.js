// Beyond OS v41-203 — 학부모 시간표 확인 링크 알림톡 템플릿 (클라이언트/서버 공용)
//
// 학생 시간표 화면에서 만든 학부모 확인 링크(/s/{token})를 카카오 알림톡으로 보냅니다.
//
// 이미 있는 'parent_confirmation'(출결 확인 요청)과는 다른 템플릿입니다.
//   - parent_confirmation : 그날 출결이 이상할 때 보내는 확인 요청
//                           (#{학생명} #{예정학습시간} #{예정외출시간} #{현재상태})
//   - schedule_confirm    : 기수 시작 전에 주간 시간표를 확인받는 링크
//                           (#{학생명} #{기간} #{확인링크})
// 변수 구성이 겹치지 않으므로 SOLAPI 에 새 템플릿을 따로 등록해야 합니다.
//
// 알림톡 심사 메모
//   - 링크는 학생마다 다르므로 본문 변수(#{확인링크})로 넣습니다.
//   - "안내/공지" 같은 포괄적 말머리는 반려되므로 목적을 구체적으로 적습니다.
//   - 수신자가 확인·수정해야 하는 정보성 메시지이므로 광고성 문구를 넣지 않습니다.

export const SCHEDULE_CONFIRM_REPORT_TYPE = 'schedule_confirm';

export const SCHEDULE_CONFIRM_TEMPLATE = {
  key: SCHEDULE_CONFIRM_REPORT_TYPE,
  label: '학생 시간표 확정 요청',
  desc: '학생별 주간 시간표 확정 링크를 학부모에게 보냅니다. 학부모가 링크에서 확인하거나 고쳐서 제출해야 확정됩니다.',
  kakaoVars: ['#{학생명}', '#{기간}', '#{확인링크}'],
  required: ['#{학생명}', '#{기간}', '#{확인링크}'],
  // 앞의 값부터 우선 사용합니다.
  templateIdEnvs: ['SOLAPI_TEMPLATE_ID_SCHEDULE_CONFIRM'],
  templateCodeEnvs: ['KAKAO_TEMPLATE_CODE_SCHEDULE_CONFIRM'],
  // v41-204: '확인'만 하고 끝내는 것으로 읽히지 않도록, 학부모가 눌러야 하는 버튼을
  // 그대로 적고 '최종 확정'이라는 말로 마무리 행동을 분명히 했습니다.
  // ('컨펌' 같은 외래어 대신 학부모가 바로 알아듣는 말로 씁니다)
  sample:
    '[The Place 26 · 비욘드 학습관리센터]\n'
    + '학생 시간표 확정 요청\n\n'
    + '안녕하세요, 학부모님.\n'
    + '#{학생명} 학생의 주간 시간표를 아래와 같이 정리했습니다.\n'
    + '적용 기간은 #{기간} 입니다.\n\n'
    + '아래 링크에서 등·하원 및 외출 시간과 특별 일정을 확인해 주세요.\n'
    + '맞으면 [이대로 확인합니다], 다른 부분이 있으면 [수정이 필요합니다]를\n'
    + '눌러 제출해 주셔야 시간표가 최종 확정됩니다.\n\n'
    + '▶ #{확인링크}\n\n'
    + '확정해 주신 내용으로 등·하원과 출결을 관리합니다.\n'
    + '문의: The Place 26 비욘드 학습관리센터 (031-795-3306)',
};

// 기간 표기는 알림톡 변수 길이를 줄이려고 짧게 씁니다. (2026-08-18 ~ 2026-10-17 → 26.08.18~26.10.17)
export function formatConfirmPeriod(startDate, endDate) {
  const short = (value) => String(value || '').slice(2).replace(/-/g, '.');
  const from = short(startDate);
  const to = short(endDate);
  if (from && to) return `${from}~${to}`;
  return from || to || '';
}

export function buildScheduleConfirmKakaoVariables({ studentName = '', period = '', link = '' } = {}) {
  return {
    '#{학생명}': String(studentName || '학생'),
    '#{기간}': String(period || ''),
    '#{확인링크}': String(link || ''),
  };
}

// 알림톡이 막혔을 때(문자 대체 등) 쓰는 본문. 템플릿 본문과 같은 내용입니다.
export function buildScheduleConfirmMessage({ studentName = '', period = '', link = '' } = {}) {
  return SCHEDULE_CONFIRM_TEMPLATE.sample
    .replace('#{학생명}', studentName || '학생')
    .replace('#{기간}', period || '')
    .replace('#{확인링크}', link || '');
}
