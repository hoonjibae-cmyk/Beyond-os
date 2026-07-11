export const REQUIRED_TEMPLATE_VARIABLES = {
  daily: ['#{학생명}', '#{날짜}', '#{출결상태}', '#{순공시간}', '#{확인사항}', '#{리포트링크}'],
  weekly: ['#{학생명}', '#{기간}', '#{주간순공시간}', '#{확인사항}', '#{리포트링크}'],
  attendance: ['#{학생명}', '#{날짜}', '#{출결구분}', '#{출결시간}', '#{기록방식}'],
  parent_confirmation: ['#{학생명}', '#{예정학습시간}', '#{예정외출시간}', '#{현재상태}'],
};

function normalizeReportType(value) {
  if (value === 'weekly') return 'weekly';
  if (value === 'attendance') return 'attendance';
  if (value === 'parent_confirmation') return 'parent_confirmation';
  return 'daily';
}

export function getKakaoVariables(payload = {}, reportType = 'daily') {
  const type = normalizeReportType(reportType);
  const templateVariables = payload.templateVariables || {};
  const source = templateVariables.kakaoVariables || {};

  if (Object.keys(source).length) return source;

  if (type === 'weekly') {
    return {
      '#{학생명}': templateVariables.studentName || payload.studentName || '',
      '#{기간}': templateVariables.period || [payload.startDate, payload.endDate].filter(Boolean).join(' ~ '),
      '#{주간순공시간}': templateVariables.weeklyStudyTime || '',
      '#{확인사항}': templateVariables.mainCheckSummary || '',
      '#{리포트링크}': templateVariables.reportLink || payload.reportLink || '',
    };
  }

  if (type === 'attendance') {
    return {
      '#{학생명}': templateVariables.studentName || payload.studentName || '',
      '#{날짜}': templateVariables.date || payload.reportDate || '',
      '#{출결구분}': templateVariables.attendanceEventType || templateVariables.eventTypeLabel || payload.attendanceEventType || '',
      '#{출결시간}': templateVariables.attendanceTime || payload.attendanceTime || '',
      '#{기록방식}': templateVariables.attendanceSource || payload.attendanceSource || '',
    };
  }

  if (type === 'parent_confirmation') {
    return {
      '#{학생명}': templateVariables.studentName || payload.studentName || '',
      '#{예정학습시간}': templateVariables.plannedStudyTime || payload.plannedStudyTime || '',
      '#{예정외출시간}': templateVariables.plannedBreakTime || payload.plannedBreakTime || '없음',
      '#{현재상태}': templateVariables.currentStatusText || payload.currentStatusText || '',
    };
  }

  return {
    '#{학생명}': templateVariables.studentName || payload.studentName || '',
    '#{날짜}': templateVariables.date || payload.reportDate || '',
    '#{출결상태}': templateVariables.attendanceStatus || '',
    '#{순공시간}': templateVariables.pureStudyTime || '',
    '#{확인사항}': templateVariables.mainCheckSummary || '',
    '#{리포트링크}': templateVariables.reportLink || payload.reportLink || '',
  };
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

export function validateKakaoTemplateVariables(payload = {}, reportType = 'daily') {
  const type = normalizeReportType(reportType);
  const required = REQUIRED_TEMPLATE_VARIABLES[type];
  const variables = getKakaoVariables(payload, type);
  const missing = required.filter((key) => isBlank(variables[key]));
  const warnings = [];

  const reportLink = String(variables['#{리포트링크}'] || '');
  if (reportLink && !/^https?:\/\//i.test(reportLink)) {
    warnings.push('#{리포트링크}가 http/https URL 형식이 아닙니다.');
  }

  const checkSummary = String(variables['#{확인사항}'] || '');
  if (checkSummary.length > 80) {
    warnings.push('#{확인사항}이 80자를 초과합니다. 알림톡 심사/가독성을 위해 짧게 유지하세요.');
  }

  const studentName = String(variables['#{학생명}'] || '');
  if (studentName.length > 20) {
    warnings.push('#{학생명}이 20자를 초과합니다.');
  }

  if (type === 'daily') {
    const pureStudy = String(variables['#{순공시간}'] || '');
    if (pureStudy.length > 20) warnings.push('#{순공시간}이 20자를 초과합니다.');
  }

  if (type === 'attendance') {
    const attendanceTime = String(variables['#{출결시간}'] || '');
    const sourceText = String(variables['#{기록방식}'] || '');
    if (attendanceTime.length > 20) warnings.push('#{출결시간}이 20자를 초과합니다.');
    if (sourceText.length > 30) warnings.push('#{기록방식}이 30자를 초과합니다.');
  }

  if (type === 'weekly') {
    const period = String(variables['#{기간}'] || '');
    if (period.length > 30) warnings.push('#{기간}이 30자를 초과합니다.');
  }

  if (type === 'parent_confirmation') {
    const studyRange = String(variables['#{예정학습시간}'] || '');
    const breakRange = String(variables['#{예정외출시간}'] || '');
    const statusText = String(variables['#{현재상태}'] || '');
    if (studyRange.length > 40) warnings.push('#{예정학습시간}이 40자를 초과합니다.');
    if (breakRange.length > 60) warnings.push('#{예정외출시간}이 60자를 초과합니다.');
    if (statusText.length > 50) warnings.push('#{현재상태}가 50자를 초과합니다.');
  }

  return {
    ok: missing.length === 0,
    reportType: type,
    required,
    missing,
    warnings,
    variables,
  };
}
