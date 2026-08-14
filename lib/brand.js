// Beyond OS v41-156
// 학부모에게 보이는 리포트의 브랜드 표기를 한 곳에서 관리합니다.
//
// 배경
//   BEYOND 학습집중관리센터는 목동유쌤영어학원과 공간을 함께 쓰지만
//   학부모에게는 별개 브랜드로 안내합니다. 리포트에 학원명이 그대로 나가면
//   두 브랜드가 섞여 보이므로 리포트는 센터 브랜드로 통일합니다.
//
// 주의 — 여기서 바꾸면 안 되는 것
//   학부모에게 실제로 발송되는 알림톡 본문은 카카오에 등록·승인된 템플릿과
//   변수(#{학생명} 등)로 만들어집니다. 그 본문 글자는 이 파일과 무관하며,
//   바꾸려면 카카오 템플릿을 다시 등록·승인받아야 합니다.
//   이 파일이 영향을 주는 곳은 리포트 웹페이지와 앱 안에서 보고 복사하는
//   리포트 텍스트입니다.

export const BRAND_NAME = 'BEYOND 학습집중관리센터';

// 로고 옆 보조 표기(공간명). 리포트 상단 배지에 함께 씁니다.
export const BRAND_SPACE_NAME = 'The Place 26';

export const BRAND_CONTACT_PHONE = '031-794-3306';

// 리포트 상단 한 줄: "BEYOND 학습집중관리센터 · Beyond Report"
export function brandLine(suffix = '') {
  return [BRAND_NAME, suffix].filter(Boolean).join(' · ');
}

// 리포트 하단 문의 한 줄: "문의: BEYOND 학습집중관리센터 031-794-3306"
export function brandContactLine() {
  return `문의: ${BRAND_NAME} ${BRAND_CONTACT_PHONE}`;
}

// tel: 링크용 (숫자만)
export const BRAND_CONTACT_TEL = `tel:${BRAND_CONTACT_PHONE.replace(/[^0-9]/g, '')}`;
