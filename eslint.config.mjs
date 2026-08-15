// Beyond OS: 미정의 참조 / 선언 전 사용만 잡는 최소 린트 설정입니다.
//
// next build 는 이 두 가지를 잡지 못합니다. 그래서 배포 후에야
// 화면 전체가 "This page couldn't load" 로 죽는 사고가 반복됐습니다.
//   v41-164.1  loadSettingsStudents  (다른 컴포넌트의 함수 참조)
//   v41-177.1  inCohortScope         (다른 컴포넌트의 헬퍼 참조)
//   v41-180.1  selectedDate          (선언보다 위에서 사용 = TDZ)
//
// 실행: npm run lint:refs
//
// 참고: no-use-before-define 은 '나중에 실행되는 함수 본문에서 위쪽 const 를
// 참조'하는 안전한 경우도 함께 잡습니다. 2026-08 기준 그런 항목이 8건 있습니다
// (effectiveMentorStudentEditorId 5, rows 1, styles 2). 새로 늘어난 항목만 보면 됩니다.
export default [
  {
    files: ['**/*.js', '**/*.jsx'],
    // 파일 안의 eslint-disable 주석은 react-hooks 규칙을 가리키는데 그 플러그인을 안 씁니다.
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: false },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', fetch: 'readonly', alert: 'readonly',
        confirm: 'readonly', prompt: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly', Response: 'readonly', Request: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', FormData: 'readonly', Blob: 'readonly',
        File: 'readonly', FileReader: 'readonly', Image: 'readonly', Audio: 'readonly',
        MediaRecorder: 'readonly', AbortController: 'readonly', TextDecoder: 'readonly',
        TextEncoder: 'readonly', btoa: 'readonly', atob: 'readonly', structuredClone: 'readonly',
        process: 'readonly', Buffer: 'readonly', crypto: 'readonly', performance: 'readonly',
        HTMLElement: 'readonly', Event: 'readonly', CustomEvent: 'readonly', DOMParser: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-use-before-define': ['error', { functions: false, classes: false, variables: true }],
    },
  },
];
