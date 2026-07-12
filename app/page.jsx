'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { calculateScheduledPureStudyMinutes } from '../lib/studyTime';
import { APP_VERSION, APP_VERSION_NAME, APP_VERSION_DESCRIPTION, APP_VERSION_SUBTITLE } from '../lib/appVersion';
import { FALLBACK_DEFAULT_SCHEDULE_SETTINGS, normalizeDefaultScheduleSettings, normalizeDefaultScheduleConfig, resolveScheduleForDate, normalizeHolidayList, getDayTypeForDate, DEFAULT_SCHEDULE_DAY_TYPES, DEFAULT_SCHEDULE_DAY_TYPE_LABELS, timeToMinutes24, minutesToTime24, isFiveMinuteTime24 } from '../lib/defaultSchedule';

const STUDY_STATUS_OPTIONS = ['인강', '문제풀이', '암기', '독서', '수면', '비학습'];
const SUBJECT_OPTIONS = ['수학', '영어', '국어', '사탐', '과탐', '기타'];
const BREAK_REASON_OPTIONS = ['식사', '병원', '타학원 수업', '학교 일정', '가정 사유', '기타'];
const REPEAT_OPTIONS = [
  ['none', '반복 없음'],
  ['daily', '매일'],
  ['weekdays', '평일만'],
  ['weekly', '매주'],
  ['monthly', '매월'],
];

const DEFAULT_SCHEDULE_SETTINGS = normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
const DEFAULT_SCHEDULE_CONFIG = normalizeDefaultScheduleConfig(FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
const DEFAULT_SCHEDULE_PERIODS = DEFAULT_SCHEDULE_SETTINGS.studyWindows;
const DEFAULT_SCHEDULE_CHECK_IN = DEFAULT_SCHEDULE_SETTINGS.plannedCheckIn;
const DEFAULT_SCHEDULE_CHECK_OUT = DEFAULT_SCHEDULE_SETTINGS.plannedCheckOut;
const DEFAULT_SCHEDULE_LABEL = DEFAULT_SCHEDULE_SETTINGS.scheduleLabel;

function mentoringSlotNumberFromLabel(label = '') {
  const match = String(label || '').match(/(\d+)\s*차시/);
  const number = match ? Number(match[1]) : null;
  return Number.isFinite(number) ? number : null;
}

function buildDefaultMentoringSlotOptions(defaultSchedule = DEFAULT_SCHEDULE_SETTINGS) {
  const settings = normalizeDefaultScheduleSettings(defaultSchedule || DEFAULT_SCHEDULE_SETTINGS);
  const byNumber = new Map();
  const orderedWindows = (settings.studyWindows || [])
    .map((window, index) => {
      const label = String(window?.label || `${index + 1}차시`).trim() || `${index + 1}차시`;
      const startTime = String(window?.start || '').slice(0, 5);
      const endTime = String(window?.end || '').slice(0, 5);
      const startMinute = timeToMinutes24(startTime);
      const endMinute = timeToMinutes24(endTime);
      if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;
      const number = mentoringSlotNumberFromLabel(label);
      if (number >= 1 && number <= 8 && !byNumber.has(number)) {
        byNumber.set(number, { label, startTime, endTime });
      }
      return { label, startTime, endTime, startMinute };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute)
    .slice(0, 8);

  return Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const direct = byNumber.get(number);
    const ordered = orderedWindows[index];
    const fallback = DEFAULT_SCHEDULE_SETTINGS.studyWindows[index] || { label: `${number}차시`, start: '09:00', end: '09:50' };
    const source = direct || ordered || { label: `${number}차시`, startTime: String(fallback.start || '').slice(0, 5), endTime: String(fallback.end || '').slice(0, 5) };
    const label = direct ? direct.label : `${number}차시`;
    return {
      key: `${label}|${source.startTime}|${source.endTime}`,
      label,
      startTime: source.startTime,
      endTime: source.endTime,
    };
  });
}

const STATIC_SEATS = [
  [1,50,70],[2,50,145],[3,50,220],[4,50,295],[5,50,370],
  [6,175,110],[7,175,185],[8,175,260],[9,175,335],
  [10,300,145],[11,300,220],[12,300,295],[13,300,370],
  [14,425,185],[15,425,260],[16,425,335],
  [17,550,220],[18,550,295],[19,550,370],
  [20,675,295],[21,675,370],[22,675,445],
  [23,800,335],[24,800,410],[25,800,485],[26,800,560],
].map(([seat_no, x, y]) => ({
  seat_no,
  display_label: String(seat_no).padStart(2, '0'),
  x,
  y,
  width: 72,
  height: 54,
  zone: 'FOCUS ROOM',
  is_active: true,
}));

const STATUS_LABELS = {
  not_arrived: '미입실',
  occupied: '입실',
  away: '외출',
  out: '퇴실',
  absent: '결석',
  needs_attention: '관리필요',
};

const BUTTON_STATUS = [
  ['occupied', '입실'],
  ['away', '외출'],
  ['out', '퇴실'],
  ['absent', '결석'],
];

const TABS = [
  ['dashboard', '메인 대시보드'],
  ['schedules', '학생 시간표'],
  ['planner', '데일리 플래너 업로드'],
  ['dailyReports', '데일리 리포트'],
  ['weeklyReports', '위클리 리포트'],
  ['ranking', '순공시간 랭킹보드'],
  ['studentHistory', '출결·관리 이력'],
  ['points', '상벌점 관리'],
  ['mentoring', '멘토링 시간표'],
  ['attention', '관리주의 이력'],
  ['settings', '설정'],
];

const USER_PERMISSION_TABS = [
  ['dashboard', '메인 대시보드'],
  ['schedules', '학생 시간표'],
  ['planner', '데일리 플래너 업로드'],
  ['dailyReports', '데일리 리포트'],
  ['weeklyReports', '위클리 리포트'],
  ['ranking', '순공시간 랭킹보드'],
  ['studentHistory', '출결·관리 이력'],
  ['points', '상벌점 관리'],
  ['mentoring', '멘토링 시간표'],
  ['attention', '관리주의 이력'],
];

const USER_ROLE_LABELS = {
  super_admin: '총괄관리자',
  user: '일반유저',
};

const USER_STATUS_LABELS = {
  pending: '승인 대기',
  active: '활성',
  paused: '일시정지',
  inactive: '비활성',
  rejected: '거절',
};

const ACTION_LOG_LABELS = {
  'user.signup.request': '계정 생성 신청',
  'user.login': '개인 계정 로그인',
  'user.create': '유저 추가',
  'user.update': '유저 정보/권한 수정',
  'user.password.set': '임시 비밀번호 설정',
  'user.password.change': '비밀번호 변경',
  'user.password.reset_request': '비밀번호 재설정 요청',
  'daily_report.preview': '데일리 리포트 미리보기',
  'daily_report.prepare': '데일리 리포트 발송대기',
  'daily_report.send': '데일리 리포트 발송 요청',
  'daily_report.manual_sent': '데일리 리포트 수동 발송완료',
  'daily_report.failed': '데일리 리포트 발송 실패',
  'daily_report.test': '데일리 리포트 테스트 payload',
  'daily_report.webhook_test': '데일리 Webhook 연결 테스트',
  'daily_report.template_validate': '데일리 템플릿 변수 검증',
  'weekly_report.save': '위클리 리포트 저장',
  'weekly_report.preview': '위클리 리포트 발송 미리보기',
  'weekly_report.send': '위클리 리포트 발송 요청',
  'weekly_report.failed': '위클리 리포트 발송 실패',
  'weekly_report.test': '위클리 리포트 테스트 payload',
  'weekly_report.webhook_test': '위클리 Webhook 연결 테스트',
  'weekly_report.template_validate': '위클리 템플릿 변수 검증',
  'weekly_report.bulk_compose': '위클리 리포트 일괄 자동 구성',
  'student_history.summary_generate': '학생 관리 이력 GPT 상담요약 생성',
  'student_history.summary_save': '학생 관리 이력 상담요약 저장',
  'mentoring.seedDefaults': '멘토링 기본 시간표 세팅',
  'mentoring.saveMentor': '멘토링 멘토 저장',
  'mentoring.saveSlot': '멘토링 차시 저장',
  'mentoring.assignStudent': '멘토링 학생 배정',
  'mentoring.assignStudents': '멘토링 학생 복수 배정',
  'mentoring.validateAssignments': '멘토링 배정 시간표 검증',
  'mentoring.deleteAssignment': '멘토링 배정 삭제',
  'mentoring.deleteSlot': '멘토링 차시 비활성화',
  'mentoring.saveMentorStudents': '멘토링 멘토별 담당학생 저장',
  'mentoring.saveDateSlot': '멘토링 날짜별 차시 저장',
  'mentoring.materializeDateSchedule': '멘토링 날짜별 일정 수정 시작',
  'mentoring.resetDateSchedule': '멘토링 날짜별 일정 기본값 재반영',
  'mentoring.assignDateStudents': '멘토링 날짜별 학생 배정',
  'mentoring.validateDateAssignments': '멘토링 날짜별 배정 시간표 검증',
  'mentoring.deleteDateAssignment': '멘토링 날짜별 배정 삭제',
  'mentoring.deleteDateSlot': '멘토링 날짜별 차시 비활성화',
  'mentoring.moveDateAssignment': '멘토링 날짜별 학생 차시 이동',
  'mentoring.validatePersonalScheduleConflicts': '개인일정 저장 시 멘토링 충돌 검증',
  'attendance_notification.test': '출결 알림 테스트 payload',
  'parent_confirmation.test': '학부모 확인 요청 테스트 payload',
  'kakao_webhook.test_received': 'Webhook 테스트 수신',
  'kakao_webhook.received': 'Webhook 요청 접수',
  'kakao_webhook.forwarded': 'Webhook 외부 발송 전달',
  'kakao_webhook.fail_safe': 'Webhook Fail-safe 차단',
  'kakao_webhook.recipient_override': '테스트 수신번호 대체',
  'kakao_webhook.recipient_blocked': '수신번호 제한 차단',
  'kakao_webhook.retry_after_safe_request': '안전모드 이후 재시도',
  'kakao_webhook.duplicate': 'Webhook 중복 요청 차단',
  'kakao_webhook.failed': 'Webhook 발송 실패',
  'attendance.status': '출결 상태 변경',
  'study_check.create': '순찰 체크 저장',
  'study_check.update': '순찰 체크 수정',
  'mentor_comment.save': '학습멘토 코멘트 저장',
  'student_points.create': '상벌점 기록',
  'student_points.delete': '상벌점 삭제',
  'planner.upload': '플래너 업로드',
  'student.create': '학생 추가',
  'student.update': '학생 정보 수정',
  'student.deactivate': '학생 비활성화',
  'student.delete': '학생 삭제',
  'schedule.save': '학생 시간표 저장',
  'schedule.delete': '학생 시간표 삭제',
  'schedule.bulk_generate': '학생 시간표 일괄 생성',
  'daily_report.share_link': '데일리 공개 리포트 링크 생성',
  'weekly_report.share_link': '위클리 공개 리포트 링크 생성',
  'report_share_link.revoke': '공개 리포트 링크 비활성화',
  'report_share_link.extend': '공개 리포트 링크 연장',
};

function getActionLogLabel(type) {
  return ACTION_LOG_LABELS[type] || type || '작업 기록';
}

function getActionLogSummary(log = {}) {
  const payload = log.payload || {};
  const parts = [
    log.actor_name || '관리자',
    log.target_name || payload.studentName || payload.reportType || log.target_type || '-',
    formatKstTimeWithSeconds(log.created_at),
  ].filter(Boolean);
  return parts.join(' · ');
}

function getReportActivityRecipientRows(log = {}) {
  const payload = log.payload || {};
  if (Array.isArray(payload.recipientResults) && payload.recipientResults.length) {
    return payload.recipientResults.map((item, index) => ({
      name: item.name || item.relationship || `수신자 ${index + 1}`,
      relationship: item.relationship || '',
      phone: item.phone || '',
      status: item.status || payload.status || 'received',
      providerStatus: item.providerStatus || payload.providerStatus || payload.status || '',
      errorMessage: item.errorMessage || '',
      messageId: item.messageId || '',
    }));
  }

  const phones = payload.recipientPolicy?.finalPhones
    || payload.recipientPolicy?.finalRecipientPhones
    || payload.recipientPhones
    || payload.recipientPhone
    || payload.recipient_phone
    || [];
  const list = Array.isArray(phones) ? phones : String(phones || '').split(/[,,\s]+/).filter(Boolean);
  return list.map((phone, index) => ({
    name: `수신자 ${index + 1}`,
    relationship: '',
    phone,
    status: payload.status || (String(log.action_type || '').includes('failed') ? 'failed' : 'received'),
    providerStatus: payload.providerStatus || payload.status || '',
    errorMessage: payload.errorMessage || payload.reason || '',
    messageId: payload.requestId || '',
  }));
}

function getReportActivityRecipientStats(log = {}) {
  const payload = log.payload || {};
  if (payload.recipientStats) return payload.recipientStats;
  const rows = getReportActivityRecipientRows(log);
  const failed = rows.filter((item) => item.status === 'failed').length;
  const sent = rows.filter((item) => item.status === 'sent').length;
  const received = rows.filter((item) => item.status === 'received').length;
  return { total: rows.length, sent, received, failed, successLike: sent + received, partialSuccess: failed > 0 && sent + received > 0 };
}

function getReportActivityStatus(log = {}) {
  const payload = log.payload || {};
  const type = String(log.action_type || '');
  const rawStatus = String(payload.status || '').toLowerCase();
  const stats = getReportActivityRecipientStats(log);

  if (type.includes('manual_sent')) return { label: '수동 발송완료', className: 'done' };
  if (payload.partialSuccess || stats.partialSuccess) return { label: '부분 성공', className: 'partial' };
  if (rawStatus === 'sent') return { label: '발송완료', className: 'done' };
  if (rawStatus === 'failed' || type.includes('failed') || type.includes('recipient_blocked')) return { label: '발송실패', className: 'failed' };
  if (type.includes('recipient_override')) return { label: '테스트 대체', className: 'test' };
  if (['received', 'queued', 'accepted'].includes(rawStatus)) return { label: '발송요청 접수', className: 'pending' };
  if (rawStatus === 'ready' || type.includes('prepare')) return { label: '발송대기', className: 'pending' };
  if (type.includes('webhook_test')) return rawStatus === 'failed' ? { label: '연결실패', className: 'failed' } : { label: '연결테스트', className: 'neutral' };
  if (type.includes('preview')) return { label: '미리보기', className: 'neutral' };
  if (type.includes('save')) return { label: '저장', className: 'neutral' };
  return { label: '기록', className: 'neutral' };
}

function getReportActivitySummary(log = {}) {
  const payload = log.payload || {};
  const rows = getReportActivityRecipientRows(log);
  const stats = getReportActivityRecipientStats(log);
  const phoneText = rows.length
    ? rows.map((row) => maskPhoneForDisplay(row.phone)).join(', ')
    : '';
  const reason = payload.errorMessage || payload.reason || payload.sendError || payload.message || '';
  const webhookStatus = payload.webhookStatus || payload.providerStatus || '';
  const requestId = payload.requestId || '';
  const bits = [
    log.actor_name ? `작업자: ${log.actor_name}` : null,
    log.target_name ? `대상: ${log.target_name}` : null,
    webhookStatus ? `Provider: ${webhookStatus}` : null,
    requestId ? `ID: ${requestId}` : null,
    rows.length ? `수신 ${stats.total || rows.length}명 / 실패 ${stats.failed || 0}명` : null,
    phoneText ? `번호: ${phoneText}` : null,
    reason ? `사유: ${reason}` : null,
  ].filter(Boolean);
  return bits.join(' · ') || '상세 정보 없음';
}

function getDeliveryStatusLabel(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'sent') return { label: '성공', className: 'done' };
  if (normalized === 'received') return { label: '접수', className: 'pending' };
  if (normalized === 'failed') return { label: '실패', className: 'failed' };
  return { label: normalized || '확인 필요', className: 'neutral' };
}

function canRetryReportActivity(log = {}) {
  const payload = log.payload || {};
  const type = String(log.action_type || '');
  const status = getReportActivityStatus(log).label;
  if (!['발송실패', '부분 성공'].includes(status)) return false;
  if (type.startsWith('daily_report') && payload.sessionId) return true;
  if (type.startsWith('weekly_report') && (log.target_id || payload.weeklyReportId || payload.reportId)) return true;
  return false;
}

function makeDefaultPermissions(role = 'user') {
  const permissions = {};
  for (const [key] of USER_PERMISSION_TABS) permissions[key] = true;
  permissions.settings = role === 'super_admin';
  permissions.userManagement = role === 'super_admin';
  return permissions;
}

function getEffectivePermissions(user = null) {
  const role = user?.role || 'user';
  return { ...makeDefaultPermissions(role), ...(user?.permissions || {}) };
}

function hasPagePermission(user, key) {
  if (!key) return false;
  if (user?.role === 'super_admin') return true;
  const permissions = getEffectivePermissions(user);
  if (key === 'settings') return Boolean(permissions.settings);
  if (key === 'studentHistory') return Boolean(permissions.studentHistory || permissions.attendance);
  return Boolean(permissions[key]);
}

function hasUserManagementPermission(user) {
  if (user?.role === 'super_admin') return true;
  const permissions = getEffectivePermissions(user);
  return Boolean(permissions.userManagement);
}

const ATTENDANCE_EVENT_LABELS = {
  check_in: '등원',
  away: '외출',
  return: '복귀',
  check_out: '하원',
  absent: '결석',
  needs_attention: '관리필요',
  manual_edit: '수동수정',
};

function getAttendanceEventLabel(type) {
  return ATTENDANCE_EVENT_LABELS[type] || type || '-';
}

function getAttendanceHistoryLabel(event = {}) {
  const type = event.event_type || event.type || '';
  const status = event.seat_status || event.status || '';

  const memo = getAttendanceHistoryMemo(event);

  if (type === 'check_in' || status === 'occupied' || type === 'occupied') return '입실 처리';
  if (type === 'away' || status === 'away') {
    if (String(memo || '').includes('퇴실')) return '퇴실 기록을 외출로 전환';
    return '외출 처리';
  }
  if (type === 'return') {
    if (String(memo || '').includes('재입실')) return '재입실 처리';
    return '복귀/입실 처리';
  }
  if (type === 'check_out' || status === 'out' || type === 'out') return '퇴실 처리';
  if (type === 'absent' || status === 'absent') return '결석 처리';
  if (type === 'manual_edit') return '수동수정';
  if (type === 'needs_attention' || status === 'needs_attention') return '관리주의 처리';

  return getAttendanceEventLabel(type) || '출결 변경';
}

function getAttendanceHistoryMemo(event = {}) {
  return event.memo || event.attendance_memo || event.note || '';
}

function sortAttendanceEventsDesc(events = []) {
  return [...(events || [])].sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));
}

function PanelSection({ title, children, defaultMobileOpen = false, desktopOpen = true, className = '' }) {
  const [isMobilePanel, setIsMobilePanel] = useState(false);
  const [isOpen, setIsOpen] = useState(desktopOpen);

  const panelStorageKey = useMemo(() => {
    const mode = isMobilePanel ? 'mobile' : 'desktop';
    const classKey = String(className || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join('.');
    return `beyond-os:v40-108:seat-panel:${mode}:${classKey || title}`;
  }, [className, isMobilePanel, title]);

  const defaultOpen = true; // v40-108: 최초 진입 시 모든 좌석 상세 카드를 펼친 상태로 시작

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setIsMobilePanel(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsOpen(defaultOpen);
      return;
    }
    const stored = window.localStorage.getItem(panelStorageKey);
    if (stored === 'open') {
      setIsOpen(true);
    } else if (stored === 'closed') {
      setIsOpen(false);
    } else {
      setIsOpen(defaultOpen);
    }
  }, [defaultOpen, panelStorageKey]);

  const handleToggle = (event) => {
    const nextOpen = event.currentTarget.open;
    setIsOpen(nextOpen);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(panelStorageKey, nextOpen ? 'open' : 'closed');
    }
  };

  return (
    <details className={`panel-section info-card ${isOpen ? 'is-open' : 'is-closed'} ${className}`.trim()} open={isOpen} onToggle={handleToggle}>
      <summary className="panel-section-summary" aria-label={`${title} ${isOpen ? '접기' : '펼치기'}`}>
        <span className="panel-section-title">{title}</span>
        <span className="panel-section-toggle" aria-hidden="true">
          <span className="panel-section-toggle-text">{isOpen ? '접기' : '펼치기'}</span>
          <span className="panel-section-chevron"></span>
        </span>
      </summary>
      <div className="panel-section-body">
        {children}
      </div>
    </details>
  );
}

function getAttendanceSummaryNote(session = {}) {
  if (!session?.id) return '오늘 출결 기록이 아직 없습니다.';
  if (['away', 'out'].includes(session.seat_status) && !session.check_in_at) {
    return '입실 시간이 누락되었습니다. 출결시간 조정에서 실제 입실 시간을 입력하세요.';
  }
  if (session.seat_status === 'absent') return '결석으로 처리된 상태입니다.';
  if (session.seat_status === 'away') return '외출 중입니다. 복귀 시 입실 버튼을 눌러 주세요.';
  if (session.seat_status === 'out') return '퇴실 처리된 상태입니다. 다시 등원하면 입실 버튼으로 재입실 처리할 수 있습니다.';
  return '출결 흐름이 정상 기록 중입니다.';
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function normalizeGuardiansForEditor(student = {}) {
  const rows = Array.isArray(student.student_guardians)
    ? student.student_guardians
    : Array.isArray(student.guardians)
      ? student.guardians
      : [];

  const normalized = rows.map((item, index) => ({
    id: item.id || `local-${index}`,
    guardianName: item.guardian_name || item.guardianName || '',
    relationship: normalizeGuardianRelationship(item.relationship || '모'),
    phone: item.phone || '',
    isPrimary: Boolean(item.is_primary ?? item.isPrimary ?? index === 0),
    receiveDailyReport: Boolean(item.receive_daily_report ?? item.receiveDailyReport ?? true),
    receiveWeeklyReport: Boolean(item.receive_weekly_report ?? item.receiveWeeklyReport ?? true),
    isActive: Boolean(item.is_active ?? item.isActive ?? true),
    memo: item.memo || '',
  }));

  if (!normalized.length && student.parent_phone) {
    normalized.push({
      id: 'legacy-parent-phone',
      guardianName: '',
      relationship: '모',
      phone: student.parent_phone,
      isPrimary: true,
      receiveDailyReport: true,
      receiveWeeklyReport: true,
      isActive: true,
      memo: '기존 학부모 연락처에서 불러옴',
    });
  }

  if (!normalized.length) {
    normalized.push({
      id: 'new-guardian-1',
      guardianName: '',
      relationship: '모',
      phone: '',
      isPrimary: true,
      receiveDailyReport: true,
      receiveWeeklyReport: true,
      isActive: true,
      memo: '',
    });
  }

  return normalized;
}

function getActiveGuardians(student = {}, reportType = 'daily') {
  const rows = normalizeGuardiansForEditor(student)
    .filter((guardian) => guardian.isActive !== false && normalizePhoneDigits(guardian.phone));

  const filtered = rows.filter((guardian) => {
    if (reportType === 'weekly') return guardian.receiveWeeklyReport !== false;
    return guardian.receiveDailyReport !== false;
  });

  return (filtered.length ? filtered : rows)
    .map((guardian, index) => ({
      ...guardian,
      phoneDigits: normalizePhoneDigits(guardian.phone),
      displayName: guardian.guardianName || guardian.relationship || `보호자 ${index + 1}`,
    }));
}

function getGuardianDisplayText(student = {}, reportType = 'daily') {
  const guardians = getActiveGuardians(student, reportType);
  if (!guardians.length) return '-';
  return guardians.map((guardian) => `${guardian.relationship || guardian.displayName} ${guardian.phone}`).join(' / ');
}


function maskPhoneForDisplay(phone = '') {
  const digits = normalizePhoneDigits(phone);
  if (!digits) return '번호 없음';
  if (digits.length >= 10) return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  if (digits.length >= 4) return `****-${digits.slice(-4)}`;
  return '번호 확인 필요';
}

function getReportSendSafetySummary(sendConfig = {}) {
  const provider = sendConfig?.provider || {};
  const recipientPolicy = sendConfig?.recipientPolicy || {};
  const actualSendEnabled = Boolean(provider.actualSendEnabled);
  const failSafe = Boolean(provider.failSafe);
  const testMode = Boolean(recipientPolicy.testMode);
  const allowlistCount = Number(recipientPolicy.allowlistCount || 0);
  const testRecipientCount = Number(recipientPolicy.testRecipientCount || 0);
  const method = provider.actualSendMethod || provider.mode || 'disabled';
  const common = {
    actualSendEnabled,
    failSafe,
    testMode,
    allowlistCount,
    testRecipientCount,
    method,
    providerMode: provider.mode || '-',
    requiresAcknowledgement: false,
    requiresTypedConfirmation: false,
    confirmPhrase: '발송확인',
  };

  if (!actualSendEnabled) {
    return {
      ...common,
      level: 'safe',
      className: 'safe',
      badge: failSafe ? 'Fail-safe ON' : '발송 차단/대기',
      title: '실제 발송 차단 상태',
      description: failSafe
        ? 'Fail-safe가 켜져 있어 실제 알림톡 발송 없이 요청 접수 또는 발송대기 중심으로 기록됩니다.'
        : '제공자 설정이 미완료되었거나 실제 발송 가능 조건이 충족되지 않았습니다.',
    };
  }

  if (testMode) {
    return {
      ...common,
      level: 'test',
      className: 'test',
      badge: '테스트 수신번호 적용',
      title: '테스트 수신번호 모드',
      description: `SOLAPI 실제 발송은 시도하지만 모든 수신번호가 설정된 테스트 번호 ${testRecipientCount || 0}개로 대체됩니다.`,
      requiresAcknowledgement: true,
    };
  }

  if (allowlistCount > 0) {
    return {
      ...common,
      level: 'allowlist',
      className: 'allowlist',
      badge: 'Allowlist 제한',
      title: '제한된 실전 발송 모드',
      description: `실제 알림톡 발송 가능 상태입니다. 단, Allowlist에 등록된 번호 ${allowlistCount}개 외 수신자는 차단됩니다.`,
      requiresAcknowledgement: true,
    };
  }

  return {
    ...common,
    level: 'live-unrestricted',
    className: 'live',
    badge: '전체 실전 발송 가능',
    title: '실제 학부모 발송 모드',
    description: '테스트 수신번호/Allowlist 제한이 꺼져 있어 발송 대상 보호자에게 실제 알림톡이 전송됩니다.',
    requiresAcknowledgement: true,
    requiresTypedConfirmation: true,
  };
}

function buildStudentRecipientPreviewRows(items = [], reportType = 'daily', getStudent = (item) => item) {
  return (items || []).map((item, index) => {
    const student = getStudent(item) || {};
    const guardians = getActiveGuardians(student, reportType);
    return {
      id: String(item?.id || student?.id || `${reportType}-${index}`),
      name: student?.name || item?.name || '학생',
      subtitle: [student?.school, student?.grade].filter(Boolean).join(' ') || '학교/학년 미입력',
      recipientCount: guardians.length,
      recipients: guardians.map((guardian) => `${guardian.relationship || guardian.displayName || '보호자'} ${maskPhoneForDisplay(guardian.phone)}`),
    };
  });
}

function getRecipientPreviewCount(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row.recipientCount || 0), 0);
}

function getRecipientPolicyProjection(sendConfig = {}, originalRecipientCount = 0) {
  const safety = getReportSendSafetySummary(sendConfig);
  const count = Math.max(0, Number(originalRecipientCount || 0));
  const testCount = Math.max(0, Number(safety.testRecipientCount || 0));
  const allowlistCount = Math.max(0, Number(safety.allowlistCount || 0));

  if (!safety.actualSendEnabled) {
    return {
      className: 'safe',
      title: '실제 발송 없음',
      description: 'Fail-safe 또는 제공자 미설정 상태이므로 등록 보호자는 확인용으로만 표시되고 실제 알림톡은 발송되지 않습니다.',
      rows: [
        ['등록 보호자', `${count}명`],
        ['실제 SOLAPI 수신', '0명'],
        ['정책', safety.badge || '발송 차단'],
      ],
    };
  }

  if (safety.testMode) {
    return {
      className: 'test',
      title: '테스트 번호 대체 발송',
      description: `등록 보호자 ${count}명에게 바로 보내지 않고, 설정된 테스트 번호 ${testCount || 0}개로 대체됩니다. 다중 연락처 운영 테스트에서는 이 값이 원장님 테스트 번호 수와 일치해야 합니다.`,
      rows: [
        ['등록 보호자', `${count}명`],
        ['실제 SOLAPI 수신', `${testCount || 0}명`],
        ['정책', '테스트 수신번호 대체'],
      ],
    };
  }

  if (allowlistCount > 0) {
    return {
      className: 'allowlist',
      title: 'Allowlist 제한 발송',
      description: `등록 보호자 ${count}명 중 Allowlist에 포함된 번호만 실제 발송됩니다. Allowlist 번호는 보안상 화면에 노출하지 않으므로, 최종 차단 여부는 발송 결과와 SOLAPI 내역을 함께 확인하세요.`,
      rows: [
        ['등록 보호자', `${count}명`],
        ['Allowlist 등록', `${allowlistCount}개`],
        ['실제 SOLAPI 수신', '발송 시 서버 검증'],
      ],
    };
  }

  return {
    className: 'live',
    title: '실제 보호자 발송',
    description: `테스트/Allowlist 제한 없이 등록된 수신 보호자 ${count}명에게 실제 알림톡이 발송됩니다.`,
    rows: [
      ['등록 보호자', `${count}명`],
      ['실제 SOLAPI 수신', `${count}명`],
      ['정책', '제한 없음'],
    ],
  };
}

function RecipientPolicyProjectionCard({ projection }) {
  if (!projection) return null;
  return (
    <div className={`recipient-policy-projection-card ${projection.className || 'safe'}`}>
      <div className="recipient-policy-projection-head">
        <strong>{projection.title}</strong>
        <span>{projection.description}</span>
      </div>
      <div className="recipient-policy-projection-grid">
        {(projection.rows || []).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function mergeStudentGuardianSource(student = {}, studentList = []) {
  if (!student?.id) return student || {};
  const source = (studentList || []).find((item) => String(item.id) === String(student.id));
  if (!source) return student;
  const sourceGuardians = Array.isArray(source.student_guardians) ? source.student_guardians : [];
  const currentGuardians = Array.isArray(student.student_guardians) ? student.student_guardians : [];
  if (sourceGuardians.length >= currentGuardians.length) {
    return { ...student, ...source, student_guardians: sourceGuardians };
  }
  return student;
}

function getPrimaryGuardianPhone(student = {}) {
  const guardians = normalizeGuardiansForEditor(student)
    .filter((guardian) => guardian.isActive !== false && normalizePhoneDigits(guardian.phone));
  const primary = guardians.find((guardian) => guardian.isPrimary) || guardians[0];
  return primary?.phone || student.parent_phone || '';
}

const SEND_STATUS_LABELS = {
  draft: '초안',
  ready: '발송대기',
  sent: '발송완료',
  failed: '발송실패',
};

function getSendStatusLabel(status) {
  return SEND_STATUS_LABELS[status || 'draft'] || status || '초안';
}

function getSendStatusClass(status) {
  if (status === 'sent') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'ready') return 'neutral';
  return 'pending';
}

const REPORT_FILTER_OPTIONS = [
  ['all', '전체'],
  ['recommended', '발송 가능'],
  ['decision', '확인 필요'],
  ['blocked', '발송 불가'],
  ['excluded', '발송 제외'],
  ['no_session', '입실 기록 없음'],
  ['ready', '발송대기'],
  ['sent', '발송완료'],
  ['failed', '발송실패'],
];

const REPORT_ISSUE_OPTIONS = [
  ['all', '전체'],
  ['missing_parent_phone', '학부모 연락처 없음'],
  ['no_session', '입실 기록 없음'],
  ['missing_checkin', '입실시간 누락'],
  ['missing_planner', '플래너 미제출'],
  ['missing_mentor', '오늘 코멘트 미입력'],
  ['no_checks', '순찰 체크 없음'],
  ['attendance_absent', '결석'],
  ['attendance_late', '지각'],
  ['attendance_early_leave', '조퇴'],
  ['attendance_excessive_away', '외출과다'],
  ['attendance_low_study', '순공부족'],
  ['attendance_attention', '관리주의'],
];

const DEFAULT_OPERATING_RULES = {
  lowStudyMinutes: 300,
  lateThresholdMinutes: 1,
  earlyLeaveThresholdMinutes: 10,
  excessiveAwayCount: 2,
  excessiveAwayMinutes: 60,
  attentionKeywords: ['수면', '비학습', '주의', '집중', '졸', '태도', '휴대폰', '잡담'],
};

const GUARDIAN_RELATIONSHIP_OPTIONS = ['모', '부', '조부모', '기타'];

function normalizeGuardianRelationship(value) {
  const raw = String(value || '').trim();
  if (['모', '어머니', '엄마', '대표 보호자', '대표보호자', '보호자'].includes(raw)) return '모';
  if (['부', '아버지', '아빠'].includes(raw)) return '부';
  if (['조부모', '조부', '조모', '할아버지', '할머니'].includes(raw)) return '조부모';
  if (['기타'].includes(raw)) return '기타';
  return raw && GUARDIAN_RELATIONSHIP_OPTIONS.includes(raw) ? raw : '모';
}


function normalizeOperatingRules(value = {}) {
  const merged = { ...DEFAULT_OPERATING_RULES, ...(value || {}) };
  const toNumber = (input, fallback) => {
    const n = Number(input);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const keywords = Array.isArray(merged.attentionKeywords)
    ? merged.attentionKeywords
    : String(merged.attentionKeywords || '').split(/[,\n]/);
  return {
    lowStudyMinutes: toNumber(merged.lowStudyMinutes, DEFAULT_OPERATING_RULES.lowStudyMinutes),
    lateThresholdMinutes: toNumber(merged.lateThresholdMinutes, DEFAULT_OPERATING_RULES.lateThresholdMinutes),
    earlyLeaveThresholdMinutes: toNumber(merged.earlyLeaveThresholdMinutes, DEFAULT_OPERATING_RULES.earlyLeaveThresholdMinutes),
    excessiveAwayCount: toNumber(merged.excessiveAwayCount, DEFAULT_OPERATING_RULES.excessiveAwayCount),
    excessiveAwayMinutes: toNumber(merged.excessiveAwayMinutes, DEFAULT_OPERATING_RULES.excessiveAwayMinutes),
    attentionKeywords: keywords.map((item) => String(item || '').trim()).filter(Boolean),
  };
}

function getReportWorkflowStatus(report) {
  if (!report) return 'not_generated';
  if (report.send_status === 'ready') return 'ready';
  if (report.send_status === 'sent') return 'sent';
  if (report.send_status === 'failed') return 'failed';
  return 'generated';
}

function getReportWorkflowLabel(report) {
  const status = getReportWorkflowStatus(report);
  if (status === 'not_generated') return '발송 시 자동생성';
  if (status === 'generated') return '생성완료';
  return getSendStatusLabel(report?.send_status);
}

function getReportWorkflowClass(report) {
  const status = getReportWorkflowStatus(report);
  if (status === 'sent') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'ready') return 'neutral';
  if (status === 'generated') return 'done';
  return 'pending';
}

function formatKstTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatKstTimeWithSeconds(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function getKioskEventLabel(eventType = '') {
  const map = {
    check_in: '입실',
    away: '외출',
    return: '복귀',
    return_overdue: '복귀 지연',
    check_out: '퇴실',
  };
  if (eventType === 'heartbeat') return 'Heartbeat';
  return map[eventType] || eventType || '출결';
}

function getAttendanceNotificationStatusLabel(status = '') {
  const map = {
    ready: '발송대기',
    received: '요청접수',
    sent: '발송완료',
    failed: '발송실패',
    skipped: '건너뜀',
  };
  return map[status] || status || '-';
}

function getAttendanceNotificationStatusClass(status = '') {
  const raw = String(status || '').toLowerCase();
  if (raw === 'sent') return 'done';
  if (raw === 'failed') return 'failed';
  if (raw === 'received' || raw === 'ready') return 'neutral';
  return 'pending';
}

function getAttendanceNotificationSourceLabel(row = {}) {
  const sourceType = String(row.source_type || row.attendance_events?.source_type || '').toLowerCase();
  if (sourceType === 'kiosk') return '키오스크 자동기록';
  return row.source_label || row.attendance_events?.source_label || '관리자 수동기록';
}

function getKioskImportFailureTitle(item = {}) {
  const eventLabel = getKioskEventLabel(item.parsed_event_type);
  const studentName = item.parsed_student_name || '학생';
  return `${studentName} ${eventLabel} 자동반영 실패`;
}

function getKioskImportFailureMessage(item = {}) {
  const error = item.error_message || '처리 실패 사유를 확인하세요.';
  const raw = compactKioskRawText(item.raw_text || '');
  return `${error}${raw && raw !== '-' ? ` · 원문: ${raw}` : ''}`;
}

function getAttendanceEventSourceLabel(event = {}) {
  const sourceType = event.source_type || event.sourceType || '';
  const sourceLabel = event.source_label || event.sourceLabel || '';
  if (sourceType === 'kiosk') return sourceLabel || '키오스크 자동 기록';
  if (sourceType === 'manual' || !sourceType) return sourceLabel || '관리자 수동 기록';
  return sourceLabel || sourceType;
}

function createDashboardSignature(data = {}) {
  const seatSignature = (data.seats || [])
    .map((seat) => [
      seat.seat_no,
      seat.current_student_id || '',
      seat.is_active === false ? 'inactive' : 'active',
    ].join('|'))
    .sort()
    .join(';;');

  const sessionSignature = (data.sessions || [])
    .map((session) => [
      session.id || '',
      session.seat_no || '',
      session.student_id || '',
      session.seat_status || '',
      session.check_in_at || '',
      session.check_out_at || '',
      session.away_started_at || '',
      session.away_total_minutes || 0,
      session.current_study_status || '',
      session.current_subject || '',
    ].join('|'))
    .sort()
    .join(';;');

  const focusAckSignature = (data.fieldFocusAcknowledgements || [])
    .map((item) => [
      item.alert_id || '',
      item.student_id || '',
      item.ack_date || '',
      item.dismissed_at || item.acknowledged_at || '',
    ].join('|'))
    .sort()
    .join(';;');

  const mentoringSignature = (data.todayMentoringAssignments || [])
    .map((item) => [
      item.id || '',
      item.student_id || '',
      item.slot_id || '',
      item.mentor_id || '',
      item.mentoring_slots?.start_time || '',
      item.mentoring_slots?.end_time || '',
    ].join('|'))
    .sort()
    .join(';;');

  return `${seatSignature}::${sessionSignature}::${focusAckSignature}::${mentoringSignature}`;
}

const LOCAL_MUTATION_SUPPRESS_MS = 12000;
const REMOTE_NOTICE_DEDUPE_MS = 18000;
const REMOTE_NOTICE_AUTO_DISMISS_MS = 5200;
const ATTENDANCE_ACTION_UNLOCK_MS = 450;

function isMutationMethod(method = 'GET') {
  return !['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase());
}

function getOrCreateClientId() {
  if (typeof window === 'undefined') return 'server-render';
  const key = 'beyond_os_client_id_v41';
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const generated = `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(key, generated);
  return generated;
}

function getSyncStatusLabel(syncStatus, lastSyncAt) {
  if (syncStatus === 'failed') return '동기화 실패 · 네트워크/비밀번호/Supabase 확인';
  if (lastSyncAt) return `실시간 동기화 중 · 마지막 동기화: ${formatKstTimeWithSeconds(lastSyncAt)}`;
  return '실시간 동기화 중';
}

function renderSyncStatusContent(syncStatus, lastSyncAt) {
  if (syncStatus === 'failed') {
    return (
      <>
        <span>동기화 실패</span>
        <span className="sync-signal-dot red" aria-hidden="true"></span>
        <span>네트워크/비밀번호/Supabase 확인</span>
      </>
    );
  }

  return (
    <>
      <span>실시간 동기화 중</span>
      <span className="sync-signal-dot green" aria-hidden="true"></span>
      <span>{lastSyncAt ? `마지막 동기화: ${formatKstTimeWithSeconds(lastSyncAt)}` : '동기화 준비 중'}</span>
    </>
  );
}

function formatAttendanceDate(value) {
  if (!value) return '-';
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}. ${mm}. ${dd}.${weekdays[date.getDay()]}`;
}

function formatAttendanceCell(value) {
  return value && String(value).trim() ? value : '-';
}

function formatAttendanceAway(row) {
  const parts = [];
  const count = Number(row?.awayCount || 0);
  if (count > 0) parts.push(`${count}회`);
  if (Number(row?.awayMinutes || 0) > 0) parts.push(formatMinutes(row.awayMinutes));
  const summary = row?.awaySummary && row.awaySummary !== '-' ? row.awaySummary : '';
  if (summary) parts.push(summary);
  return parts.length ? parts.join(' · ') : '-';
}

function timeTextToMinutes(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/(\d{1,2})[:시]\s*(\d{1,2})?/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (/오후|PM/i.test(raw) && hour < 12) hour += 12;
  if (/오전|AM/i.test(raw) && hour === 12) hour = 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatClockFromMinutes(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '-';
  const total = Math.max(0, Math.round(Number(minutes)));
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function averageClock(rows, key) {
  const values = (rows || [])
    .map((row) => timeTextToMinutes(row?.[key]))
    .filter((value) => value !== null);
  if (!values.length) return '-';
  return formatClockFromMinutes(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getAttendanceFlags(row, rulesInput = DEFAULT_OPERATING_RULES) {
  const rules = normalizeOperatingRules(rulesInput);
  const flags = [];
  const checkInMinutes = timeTextToMinutes(row?.checkInTime);
  const checkOutMinutes = timeTextToMinutes(row?.checkOutTime);
  // v41-42: 개인 시간표가 없는 행은 예정 등하원이 비어 있고, 이 경우 지각/조퇴 판정을 하지 않습니다.
  const plannedCheckIn = timeTextToMinutes(row?.plannedCheckInTime || row?.plannedCheckIn);
  const plannedCheckOut = timeTextToMinutes(row?.plannedCheckOutTime || row?.plannedCheckOut);
  const pureStudyMinutes = Number(row?.pureStudyMinutes || 0);
  const awayMinutes = Number(row?.awayMinutes || 0);
  const awayCount = Number(row?.awayCount || 0);
  const memoText = [row?.mentorComment, row?.attendanceMemo, row?.eventSummary].filter(Boolean).join(' ');

  if (row?.status === 'absent') flags.push({ type: 'danger', label: '결석', reason: getRowIssueReason(row, '결석') });
  else if (!row?.checkInAt) flags.push({ type: 'danger', label: '미등원' });
  if (checkInMinutes !== null && plannedCheckIn !== null && checkInMinutes > plannedCheckIn && checkInMinutes - plannedCheckIn >= rules.lateThresholdMinutes) flags.push({ type: 'warn', label: '지각', reason: getRowIssueReason(row, '지각') });
  if (checkOutMinutes !== null && plannedCheckOut !== null && checkOutMinutes < plannedCheckOut && plannedCheckOut - checkOutMinutes >= rules.earlyLeaveThresholdMinutes) flags.push({ type: 'warn', label: '조퇴', reason: getRowIssueReason(row, '조퇴') });
  if (awayCount >= rules.excessiveAwayCount || awayMinutes >= rules.excessiveAwayMinutes) flags.push({ type: 'warn', label: '외출과다' });
  if (row?.checkInAt && pureStudyMinutes > 0 && pureStudyMinutes < rules.lowStudyMinutes) flags.push({ type: 'warn', label: '순공부족' });

  const keywordHit = (rules.attentionKeywords || []).some((keyword) => keyword && memoText.includes(keyword));
  if (keywordHit) flags.push({ type: 'danger', label: '관리주의' });

  if (!flags.length) flags.push({ type: 'good', label: '정상' });
  return flags;
}

function countAttendanceFlag(rows, label, rules = DEFAULT_OPERATING_RULES) {
  return (rows || []).filter((row) => getAttendanceFlags(row, rules).some((flag) => flag.label === label)).length;
}

function getLatestEventMemoReason(events = [], eventType = '', label = '') {
  const rows = (events || [])
    .filter((event) => event?.event_type === eventType && String(event.memo || '').trim())
    .sort((a, b) => new Date(b.event_at || b.created_at || 0) - new Date(a.event_at || a.created_at || 0));
  return cleanAttendanceReason(rows[0]?.memo || '', label);
}

function escapeCsvCell(value) {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsvFile(filename, rows) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadAttendanceCsv({ rows, student, start, end, rules }) {
  if (!student || !rows?.length) return;
  const header = ['날짜', '등원시간', '하원시간', '외출현황', '순공시간', '상태', '학습멘토 코멘트', '특이사항'];
  const body = rows.map((row) => [
    formatAttendanceDate(row.date),
    row.checkInTime || '-',
    row.checkOutTime || (row.checkInAt ? '아직 학습중' : '-'),
    formatAttendanceAway(row),
    formatMinutes(row.pureStudyMinutes),
    getAttendanceFlags(row, rules).map((flag) => flag.label).join(' / '),
    row.mentorComment || '-',
    row.attendanceMemo || row.eventSummary || '-',
  ]);
  const safeName = String(student.name || 'student').replace(/[\\/:*?"<>|\s]+/g, '-');
  downloadCsvFile(`beyond-os-attendance-${safeName}-${start}-${end}.csv`, [header, ...body]);
}

function formatMinutes(minutes) {
  const m = Math.max(0, Number(minutes || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r}분`;
  if (r === 0) return `${h}시간`;
  return `${h}시간 ${r}분`;
}

function diffMinutesIso(startIso, endDate = new Date()) {
  if (!startIso) return 0;
  const start = new Date(startIso).getTime();
  const end = endDate instanceof Date ? endDate.getTime() : new Date(endDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function makeKstIso(dateString, timeValue) {
  if (!dateString || !timeValue) return null;
  return new Date(`${dateString}T${timeValue}:00+09:00`).toISOString();
}

function getKstMinutesFromIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
  } catch {}
  return null;
}

function getSchedulePeriodForMinutes(checkedMinute, settings = DEFAULT_SCHEDULE_SETTINGS) {
  const windows = normalizeDefaultScheduleSettings(settings || DEFAULT_SCHEDULE_SETTINGS).studyWindows || [];
  if (checkedMinute === null || checkedMinute === undefined || Number.isNaN(Number(checkedMinute))) return null;

  const matched = windows
    .map((period, index) => {
      const startMinute = timeToMinutes24(period.start);
      const endMinute = timeToMinutes24(period.end);
      if (startMinute === null || endMinute === null || endMinute <= startMinute) return null;
      return {
        ...period,
        index,
        startMinute,
        endMinute,
      };
    })
    .filter(Boolean)
    .find((period) => checkedMinute >= period.startMinute && checkedMinute < period.endMinute);

  if (!matched) return null;
  return {
    label: matched.label || `${matched.index + 1}차시`,
    start: matched.start,
    end: matched.end,
    range: `${matched.start}~${matched.end}`,
    startMinute: matched.startMinute,
    endMinute: matched.endMinute,
    isMatched: true,
  };
}

function getSchedulePeriodMetaForIso(value, settings = DEFAULT_SCHEDULE_SETTINGS) {
  const checkedMinute = getKstMinutesFromIso(value);
  const matched = getSchedulePeriodForMinutes(checkedMinute, settings);
  if (matched) return matched;
  return { label: formatKstTime(value), range: '', isMatched: false, startMinute: null, endMinute: null };
}

function getCurrentSchedulePeriodMeta(settings = DEFAULT_SCHEDULE_SETTINGS, nowDate = new Date()) {
  const checkedMinute = getKstMinutesFromIso(nowDate);
  return getSchedulePeriodForMinutes(checkedMinute, settings);
}

function getStudyCheckForSchedulePeriod(rows = [], period = null) {
  if (!period?.isMatched) return null;
  return [...(rows || [])]
    .filter((item) => {
      const checkedMinute = getKstMinutesFromIso(item?.checked_at);
      return checkedMinute !== null && checkedMinute >= period.startMinute && checkedMinute < period.endMinute;
    })
    .sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0))[0] || null;
}

function getLatestStudyCheckFromRows(rows = []) {
  return [...(rows || [])]
    .filter((item) => item?.id || item?.checked_at)
    .sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0))[0] || null;
}

function formatStudyCheckSeatLabel(check = {}, settings = DEFAULT_SCHEDULE_SETTINGS) {
  if (!check) return '';
  const meta = getSchedulePeriodMetaForIso(check.checked_at, settings);
  const status = [check.subject, check.study_status].filter(Boolean).join('/');
  return [meta.label, status || '학습상태 미입력'].filter(Boolean).join(' ');
}

function getCurrentKstTime() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

const FIVE_MINUTE_TIME_OPTIONS = Array.from({ length: 24 * 12 }, (_, index) => minutesToTime24(index * 5));
const FIVE_MINUTE_TIME_OPTIONS_WITH_24 = [...FIVE_MINUTE_TIME_OPTIONS, '24:00'];

function normalizeTimeSelectValue(value, { allow24 = false } = {}) {
  const raw = String(value || '').trim().slice(0, 5);
  const minutes = timeToMinutes24(raw);
  if (minutes === null) return '';
  if (minutes >= 24 * 60) return allow24 ? '24:00' : '';
  if (minutes % 5 !== 0) return '';
  return minutesToTime24(minutes);
}

function snapTimeToFiveMinute(value, { allow24 = false, mode = 'nearest' } = {}) {
  const minutes = timeToMinutes24(value);
  if (minutes === null) return '';
  const quotient = minutes / 5;
  const rounded = mode === 'floor'
    ? Math.floor(quotient) * 5
    : mode === 'ceil'
      ? Math.ceil(quotient) * 5
      : Math.round(quotient) * 5;
  const max = allow24 ? 24 * 60 : (24 * 60 - 5);
  return minutesToTime24(Math.max(0, Math.min(max, rounded)));
}

function getCurrentKstTimeFiveMinute() {
  return snapTimeToFiveMinute(getCurrentKstTime(), { mode: 'nearest' }) || getCurrentKstTime();
}

function toFiveMinuteInputValue(value, { allow24 = false } = {}) {
  return normalizeTimeSelectValue(value, { allow24 }) || snapTimeToFiveMinute(value, { allow24, mode: 'nearest' });
}

function TimeSelect({ value, onChange, allow24 = false, placeholder = '시간 선택', disabled = false }) {
  const raw = String(value || '').trim().slice(0, 5);
  const normalized = normalizeTimeSelectValue(raw, { allow24 });
  const hasLegacyValue = Boolean(raw && !normalized);
  const options = allow24 ? FIVE_MINUTE_TIME_OPTIONS_WITH_24 : FIVE_MINUTE_TIME_OPTIONS;
  const selectValue = normalized || (hasLegacyValue ? raw : '');

  return (
    <select
      className={`time-select${hasLegacyValue ? ' has-legacy-time' : ''}`}
      value={selectValue}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {!selectValue ? <option value="">{placeholder}</option> : null}
      {hasLegacyValue ? <option value={raw}>{raw} · 5분 단위 아님</option> : null}
      {options.map((time) => <option key={time} value={time}>{time}</option>)}
    </select>
  );
}

function calculateLivePureStudyMinutes(session, nowDate = new Date(), events = [], defaultSchedule = DEFAULT_SCHEDULE_SETTINGS) {
  const nowIso = nowDate instanceof Date ? nowDate.toISOString() : new Date(nowDate).toISOString();
  const settings = normalizeDefaultScheduleSettings(defaultSchedule);
  return calculateScheduledPureStudyMinutes(session, { nowIso, events, studyWindows: settings.studyWindows });
}

function getTotalAwayMinutes(session, nowDate = new Date()) {
  return Math.max(0, Number(session?.away_total_minutes || 0) + (session?.away_started_at ? diffMinutesIso(session.away_started_at, nowDate) : 0));
}

function getKstDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(dateString, amount) {
  const d = new Date(`${dateString}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return getKstDateString(d);
}

function getDayOfWeekFromDateString(dateString = getKstDateString()) {
  return new Date(`${dateString}T12:00:00+09:00`).getUTCDay();
}

// v41-42 이후: 등원 예정/출결 알림은 개인 시간표(student_daily_schedules)가
// 저장된 날짜에만 발생합니다. 요일 유형별 운영/휴무 토글(defaultSchedule.operating)은
// '일괄 생성' 대상 날짜만 통제할 뿐, 대시보드 알림 판정에는 관여하지 않습니다.

function startOfWeek(dateString) {
  const d = new Date(`${dateString}T00:00:00`);
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  return getKstDateString(d);
}

function startOfMonth(dateString) {
  return `${dateString.slice(0, 8)}01`;
}

function endOfMonth(dateString) {
  const d = new Date(`${dateString.slice(0, 8)}01T00:00:00`);
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return getKstDateString(d);
}

function timeToMinutes(timeValue) {
  return timeToMinutes24(timeValue);
}

function minutesToTime(minutes) {
  return minutesToTime24(minutes);
}

function getSchedulePeriods(settings = DEFAULT_SCHEDULE_SETTINGS) {
  return normalizeDefaultScheduleSettings(settings).studyWindows;
}

function getDefaultScheduleSegments(startValue = DEFAULT_SCHEDULE_CHECK_IN, endValue = DEFAULT_SCHEDULE_CHECK_OUT, settings = DEFAULT_SCHEDULE_SETTINGS) {
  const normalized = normalizeDefaultScheduleSettings(settings);
  const rangeStart = timeToMinutes(startValue) ?? timeToMinutes(normalized.plannedCheckIn);
  const rangeEnd = timeToMinutes(endValue) ?? timeToMinutes(normalized.plannedCheckOut);
  return getSchedulePeriods(normalized)
    .map((period) => {
      const periodStart = timeToMinutes(period.start);
      const periodEnd = timeToMinutes(period.end);
      if (periodStart === null || periodEnd === null) return null;
      const startMinute = Math.max(rangeStart, periodStart);
      const endMinute = Math.min(rangeEnd, periodEnd);
      if (endMinute <= startMinute) return null;
      return { ...period, startMinute, endMinute, detail: `${minutesToTime(startMinute)}~${minutesToTime(endMinute)}` };
    })
    .filter(Boolean);
}

function getBreakIntervalsForSchedule(breaks = [], rangeStart = 0, rangeEnd = 24 * 60) {
  return (breaks || [])
    .map((item) => {
      const leave = timeToMinutes(item.leave_start || item.leaveStart);
      const ret = timeToMinutes(item.return_time || item.returnTime);
      if (leave === null || ret === null) return null;
      const startMinute = Math.max(rangeStart, Math.min(rangeEnd, leave));
      const endMinute = Math.max(startMinute, Math.min(rangeEnd, ret));
      if (endMinute <= startMinute) return null;
      return { startMinute, endMinute };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}

function subtractIntervalsFromRange(startMinute, endMinute, intervals = []) {
  let ranges = [{ startMinute, endMinute }];

  for (const interval of intervals || []) {
    ranges = ranges.flatMap((range) => {
      if (interval.endMinute <= range.startMinute || interval.startMinute >= range.endMinute) return [range];

      const remaining = [];
      if (interval.startMinute > range.startMinute) {
        remaining.push({ startMinute: range.startMinute, endMinute: Math.min(interval.startMinute, range.endMinute) });
      }
      if (interval.endMinute < range.endMinute) {
        remaining.push({ startMinute: Math.max(interval.endMinute, range.startMinute), endMinute: range.endMinute });
      }
      return remaining.filter((item) => item.endMinute > item.startMinute);
    });
  }

  return ranges;
}

function getDefaultScheduleSegmentsExcludingBreaks(startValue = DEFAULT_SCHEDULE_CHECK_IN, endValue = DEFAULT_SCHEDULE_CHECK_OUT, breaks = [], settings = DEFAULT_SCHEDULE_SETTINGS) {
  const normalized = normalizeDefaultScheduleSettings(settings);
  const rangeStart = timeToMinutes(startValue) ?? timeToMinutes(normalized.plannedCheckIn);
  const rangeEnd = timeToMinutes(endValue) ?? timeToMinutes(normalized.plannedCheckOut);
  const breakIntervals = getBreakIntervalsForSchedule(breaks, rangeStart, rangeEnd);

  return getDefaultScheduleSegments(startValue, endValue, normalized)
    .flatMap((segment) => subtractIntervalsFromRange(segment.startMinute, segment.endMinute, breakIntervals)
      .map((range, splitIndex) => ({
        ...segment,
        startMinute: range.startMinute,
        endMinute: range.endMinute,
        splitIndex,
        detail: `${minutesToTime(range.startMinute)}~${minutesToTime(range.endMinute)}`,
      })))
    .filter((segment) => segment.endMinute > segment.startMinute);
}

function getDefaultScheduleSummaryLines(startValue = DEFAULT_SCHEDULE_CHECK_IN, endValue = DEFAULT_SCHEDULE_CHECK_OUT, breaks = [], settings = DEFAULT_SCHEDULE_SETTINGS) {
  const segments = getDefaultScheduleSegmentsExcludingBreaks(startValue, endValue, breaks, settings);
  if (!segments.length) return [`${startValue}~${endValue} 외출 또는 예외 일정`];
  return segments.map((segment) => `${segment.detail} ${segment.label}`);
}

function isFiveMinuteTime(timeValue) {
  const minutes = timeToMinutes(timeValue);
  return minutes === null || minutes % 5 === 0;
}

function validateSchedulePayload(payload) {
  const errors = [];
  const checkIn = timeToMinutes(payload.plannedCheckIn || '09:00');
  const checkOut = timeToMinutes(payload.plannedCheckOut || '22:00');

  if (!isFiveMinuteTime(payload.plannedCheckIn || '09:00')) errors.push('예정 등원은 5분 단위로 입력하세요.');
  if (!isFiveMinuteTime(payload.plannedCheckOut || '22:00')) errors.push('예정 하원은 5분 단위로 입력하세요.');
  if (checkIn !== null && checkOut !== null && checkOut <= checkIn) errors.push('예정 하원은 예정 등원보다 늦어야 합니다.');

  const ranges = [];
  for (const [index, item] of (payload.breaks || []).entries()) {
    const hasAny = Boolean(item.leaveStart || item.returnTime || item.reasonDetail || item.breakNote);
    if (!hasAny) continue;

    const leave = timeToMinutes(item.leaveStart);
    const ret = timeToMinutes(item.returnTime);

    if (leave === null) errors.push(`외출 ${index + 1}: 외출 시작 시간을 입력하세요.`);
    if (ret === null) errors.push(`외출 ${index + 1}: 복귀 예정 시간을 입력하세요.`);
    if (item.leaveStart && !isFiveMinuteTime(item.leaveStart)) errors.push(`외출 ${index + 1}: 외출 시작은 5분 단위로 입력하세요.`);
    if (item.returnTime && !isFiveMinuteTime(item.returnTime)) errors.push(`외출 ${index + 1}: 복귀 예정은 5분 단위로 입력하세요.`);
    if (leave !== null && ret !== null && ret <= leave) errors.push(`외출 ${index + 1}: 복귀 예정은 외출 시작보다 늦어야 합니다.`);
    if (checkIn !== null && leave !== null && leave < checkIn) errors.push(`외출 ${index + 1}: 외출 시작이 예정 등원보다 빠릅니다.`);
    if (checkOut !== null && ret !== null && ret > checkOut) errors.push(`외출 ${index + 1}: 복귀 예정이 예정 하원보다 늦습니다.`);
    if (leave !== null && ret !== null && ret > leave) ranges.push({ index, leave, ret });
  }

  ranges.sort((a, b) => a.leave - b.leave);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].leave < ranges[i - 1].ret) {
      errors.push(`외출 ${ranges[i - 1].index + 1}과 외출 ${ranges[i].index + 1} 시간이 겹칩니다.`);
    }
  }

  return errors;
}

function openNativePicker(event) {
  if (typeof event.currentTarget.showPicker === 'function') {
    try {
      event.currentTarget.showPicker();
    } catch {
      event.currentTarget.focus();
    }
  } else {
    event.currentTarget.focus();
  }
}

function currentKstMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date()).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function groupBySession(rows) {
  const grouped = {};
  for (const row of rows || []) {
    if (!grouped[row.session_id]) grouped[row.session_id] = [];
    grouped[row.session_id].push(row);
  }
  return grouped;
}

function groupBreaksBySchedule(breaks) {
  const grouped = {};
  for (const row of breaks || []) {
    if (!grouped[row.schedule_id]) grouped[row.schedule_id] = [];
    grouped[row.schedule_id].push(row);
  }
  return grouped;
}

function getThisWeekRange() {
  const start = startOfWeek(getKstDateString());
  return { start, end: getKstDateString() };
}

function getFullWeekRange(baseDate = getKstDateString()) {
  const start = startOfWeek(baseDate);
  return { start, end: addDays(start, 6) };
}

function getPreviousFullWeekRange(baseDate = getKstDateString()) {
  const current = getFullWeekRange(baseDate);
  const start = addDays(current.start, -7);
  return { start, end: addDays(start, 6) };
}

function getWeekMonthGroupLabel(dateString) {
  if (!dateString) return '기간 미확인';
  return `${dateString.slice(0, 4)}년 ${Number(dateString.slice(5, 7))}월`;
}

function formatWeeklyRangeLabel(startValue, endValue) {
  const startText = formatAttendanceDate(startValue).replace(/^\d{4}\.\s*/, '');
  const endText = formatAttendanceDate(endValue).replace(/^\d{4}\.\s*/, '');
  return `${startText} ~ ${endText}`;
}

function buildWeeklyRangePickerOptions(baseDate = getKstDateString(), weeksBefore = 16, weeksAfter = 2) {
  const selectedWeek = getFullWeekRange(baseDate || getKstDateString());
  const currentWeek = getFullWeekRange();
  const firstStart = addDays(selectedWeek.start, -7 * weeksBefore);
  const totalWeeks = weeksBefore + weeksAfter + 1;
  const grouped = [];
  const groupMap = new Map();

  for (let index = totalWeeks - 1; index >= 0; index -= 1) {
    const start = addDays(firstStart, index * 7);
    const end = addDays(start, 6);
    const groupLabel = getWeekMonthGroupLabel(start);
    if (!groupMap.has(groupLabel)) {
      const group = { label: groupLabel, weeks: [] };
      groupMap.set(groupLabel, group);
      grouped.push(group);
    }
    groupMap.get(groupLabel).weeks.push({
      start,
      end,
      label: formatWeeklyRangeLabel(start, end),
      isCurrent: start === currentWeek.start,
      isSelected: start === selectedWeek.start,
    });
  }

  return grouped;
}

function cleanAttendanceReason(value = '', label = '') {
  let raw = String(value || '').trim();
  if (!raw) return '';
  const cleanLabel = String(label || '').trim();
  if (cleanLabel) {
    for (const prefix of [`${cleanLabel} 사유:`, `${cleanLabel} 사유：`, `${cleanLabel}:`, `${cleanLabel}：`]) {
      if (raw.startsWith(prefix)) return raw.slice(prefix.length).trim();
    }
  }
  if (raw.startsWith('결석 사유:')) return raw.slice('결석 사유:'.length).trim();
  return raw;
}

function getRowIssueReason(row = {}, label = '') {
  const reasonMap = row.attendanceIssueReasons || {};
  if (label === '지각') return cleanAttendanceReason(row.lateReason || reasonMap.지각 || '', '지각');
  if (label === '조퇴') return cleanAttendanceReason(row.earlyLeaveReason || reasonMap.조퇴 || '', '조퇴');
  if (label === '결석') return cleanAttendanceReason(row.absentReason || reasonMap.결석 || '', '결석');
  return '';
}

function formatAttendanceFlagDisplay(flag = {}) {
  const label = String(flag.label || flag || '').trim();
  const reason = cleanAttendanceReason(flag.reason || '', label);
  return reason ? `${label}(${reason})` : label;
}

function isParentReportIssueVisible(value = '') {
  const label = String(value?.label || value || '').trim().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+\d+일$/, '');
  return !['관리주의', '관리필요'].includes(label);
}

function filterParentReportFlags(flags = []) {
  return (flags || []).filter(isParentReportIssueVisible);
}

function sanitizeParentIssueSummary(value = '') {
  const issues = String(value || '')
    .replace(/외출 확인 필요/g, '외출 관리 필요')
    .replace(/순공시간 확인 필요/g, '순공시간 부족')
    .split(/\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter(isParentReportIssueVisible);
  return issues.length ? issues.join(', ') : '특이사항 없음';
}


const DAILY_KAKAO_VARIABLE_ORDER = ['#{학생명}', '#{날짜}', '#{출결상태}', '#{순공시간}', '#{확인사항}', '#{리포트링크}'];
const WEEKLY_KAKAO_VARIABLE_ORDER = ['#{학생명}', '#{기간}', '#{주간순공시간}', '#{확인사항}', '#{리포트링크}'];
const ATTENDANCE_KAKAO_VARIABLE_ORDER = ['#{학생명}', '#{날짜}', '#{출결구분}', '#{출결시간}', '#{기록방식}'];

function getKakaoVariables(templateVariables = {}) {
  if (!templateVariables || typeof templateVariables !== 'object') return {};
  if (templateVariables.kakaoVariables && typeof templateVariables.kakaoVariables === 'object') return templateVariables.kakaoVariables;
  return templateVariables;
}

function getKakaoTemplateVariableRows(templateVariables = {}, reportType = 'daily') {
  const kakaoVariables = getKakaoVariables(templateVariables);
  const order = reportType === 'weekly' ? WEEKLY_KAKAO_VARIABLE_ORDER : reportType === 'attendance' ? ATTENDANCE_KAKAO_VARIABLE_ORDER : DAILY_KAKAO_VARIABLE_ORDER;
  const seen = new Set();
  const rows = [];

  for (const key of order) {
    seen.add(key);
    rows.push([key, kakaoVariables[key] || '']);
  }

  for (const [key, value] of Object.entries(kakaoVariables)) {
    if (seen.has(key)) continue;
    rows.push([key, value]);
  }

  return rows;
}

function getTemplateValidationLabel(validation = {}) {
  if (!validation) return '검증 정보 없음';
  if (validation.ok === true) return '필수 변수 정상';
  if (Array.isArray(validation.missing) && validation.missing.length) return `누락 변수: ${validation.missing.join(', ')}`;
  return '변수 확인 필요';
}

function getKakaoReportTypeLabel(reportType = 'daily') {
  if (reportType === 'weekly') return '위클리';
  if (reportType === 'attendance') return '출결';
  if (reportType === 'parent_confirmation') return '학부모 확인 요청';
  return '데일리';
}

function formatIssueReasonBreakdown(reasonCounts = {}) {
  const entries = Object.entries(reasonCounts || {})
    .filter(([, count]) => Number(count || 0) > 0)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  if (!entries.length) return '';
  return entries.map(([reason, count]) => `${reason} ${count}일`).join(', ');
}

function formatIssueSummary(counts = {}, reasonCounts = {}) {
  const labels = ['결석', '지각', '조퇴', '외출과다', '순공부족', '미등원'];
  const parts = labels
    .filter((label) => Number(counts[label] || 0) > 0)
    .map((label) => {
      const breakdown = formatIssueReasonBreakdown(reasonCounts[label]);
      return `${label} ${counts[label]}일${breakdown ? `(${breakdown})` : ''}`;
    });
  return parts.length ? parts.join(', ') : '특이사항 없음';
}

function getScheduleRange(view, baseDate) {
  if (view === 'day') return { start: baseDate, end: baseDate };
  if (view === 'week') {
    const start = startOfWeek(baseDate);
    return { start, end: addDays(start, 6) };
  }
  return { start: startOfMonth(baseDate), end: endOfMonth(baseDate) };
}

function makeDateRange(start, end) {
  const dates = [];
  let cursor = start;
  while (cursor <= end) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function getCurrentScheduleBreak(scheduleBreaks = [], nowMinutes = currentKstMinutes()) {
  return (scheduleBreaks || []).find((item) => {
    const leave = timeToMinutes(item.leave_start || item.leaveStart);
    const ret = timeToMinutes(item.return_time || item.returnTime);
    return leave !== null && ret !== null && nowMinutes >= leave && nowMinutes < ret;
  }) || null;
}

function createPresenceMismatchAlert({ schedule, session, scheduleBreaks = [], seat = {}, nowMinutes = currentKstMinutes() }) {
  const student = schedule?.students;
  const studentName = student?.name || '학생';
  const checkIn = timeToMinutes(schedule?.planned_check_in);
  const checkOut = timeToMinutes(schedule?.planned_check_out);
  if (checkIn === null || checkOut === null || checkOut <= checkIn) return null;
  if (nowMinutes < checkIn || nowMinutes >= checkOut) return null;

  const activeBreak = getCurrentScheduleBreak(scheduleBreaks, nowMinutes);
  if (activeBreak) return null;

  const status = session?.seat_status || 'not_arrived';
  if (status === 'occupied' || status === 'absent') return null;

  const seatNo = seat.seat_no || student?.default_seat_no;
  const plannedRange = `${schedule.planned_check_in?.slice(0, 5) || '-'}~${schedule.planned_check_out?.slice(0, 5) || '-'}`;
  const actualLabel = STATUS_LABELS[status] || (session?.check_out_at ? '퇴실' : '미입실');
  const statusText = status === 'away'
    ? '외출 상태'
    : status === 'out'
      ? '퇴실 상태'
      : '미입실 상태';
  const issue = status === 'away'
    ? '개인시간표 중 외출 상태'
    : status === 'out'
      ? '개인시간표 중 퇴실 상태'
      : '시간표상 있어야 하나 미입실';

  return {
    id: `presence-mismatch-${schedule.id}-${status}`,
    type: 'attendance_mismatch',
    mode: 'check',
    issue,
    title: `${studentName} 출결상태 확인 필요`,
    body: `개인시간표 ${plannedRange} 기준 현재 참여해야 하는 시간이나 ${statusText}입니다. 현재 상태: ${actualLabel}.`,
    student,
    schedule,
    seatNo,
    plannedTime: schedule.planned_check_in?.slice(0, 5),
    currentStatus: status,
  };
}

// v41-42: 기본 시간표 자동 폴백 제거.
// 등원 예정(결석/지각 판정 대상)은 개인 시간표가 '명시적으로' 저장된 학생만 포함합니다.
// 개인 시간표가 없는 학생/날짜는 등원 예정 없음으로 처리되며,
// 초기 입력은 학생 시간표 탭의 '기본 시간표로 일괄 생성' 도구를 사용합니다.
function buildEffectiveSchedulesForPresence({ schedules = [] }) {
  const today = getKstDateString();
  const explicitSchedules = [];
  for (const schedule of schedules || []) {
    if (schedule?.schedule_date !== today || !schedule?.student_id) continue;
    explicitSchedules.push(schedule);
  }
  return explicitSchedules;
}

function createScheduleAlerts({ schedules, scheduleBreaks, sessions, seats, students = [], defaultSchedule = DEFAULT_SCHEDULE_SETTINGS }) {
  const today = getKstDateString();
  const now = currentKstMinutes();
  const breaksBySchedule = groupBreaksBySchedule(scheduleBreaks);
  const effectiveSchedules = buildEffectiveSchedulesForPresence({ schedules, students, sessions, seats, defaultSchedule });
  const sessionByStudentId = {};
  for (const session of sessions || []) sessionByStudentId[session.student_id] = session;

  const seatByStudentId = {};
  for (const seat of seats || []) {
    if (seat.current_student_id) seatByStudentId[seat.current_student_id] = seat;
    if (seat.current_student?.id) seatByStudentId[seat.current_student.id] = seat;
  }

  const alerts = [];

  for (const schedule of effectiveSchedules || []) {
    if (schedule.schedule_date !== today) continue;
    const student = schedule.students;
    const session = sessionByStudentId[schedule.student_id];
    const seat = seatByStudentId[schedule.student_id] || {};
    const studentName = student?.name || '학생';
    const scheduleBreakList = breaksBySchedule[schedule.id] || [];

    const presenceMismatch = createPresenceMismatchAlert({
      schedule,
      session,
      scheduleBreaks: scheduleBreakList,
      seat,
      nowMinutes: now,
    });
    if (presenceMismatch) alerts.push(presenceMismatch);

    const checkIn = timeToMinutes(schedule.planned_check_in);
    const plannedCheckOutForMismatch = timeToMinutes(schedule.planned_check_out);
    const checkInMismatchWindowEnd = plannedCheckOutForMismatch !== null && plannedCheckOutForMismatch > checkIn
      ? plannedCheckOutForMismatch
      : Math.min(24 * 60 - 1, (checkIn || 0) + 180);
    if (!presenceMismatch && checkIn !== null && now >= checkIn && now <= checkInMismatchWindowEnd && !session?.check_in_at) {
      alerts.push({
        id: `checkin-${schedule.id}`,
        type: 'check_in_check',
        mode: 'check',
        title: `${studentName} 등원 확인 필요`,
        body: `예정 등원 ${schedule.planned_check_in.slice(0, 5)} · 시간표상 있어야 하나 아직 입실 확인이 없습니다.`,
        student,
        schedule,
        seatNo: seat.seat_no || student?.default_seat_no,
        plannedTime: schedule.planned_check_in.slice(0, 5),
      });
    }

    const checkOut = timeToMinutes(schedule.planned_check_out);
    if (checkOut !== null && checkOut < 22 * 60 && now >= checkOut - 5 && now <= checkOut) {
      alerts.push({
        id: `checkout-preview-${schedule.id}`,
        type: 'early_checkout_preview',
        mode: 'preview',
        title: `${studentName} 조기 하원 예정`,
        body: `${schedule.planned_check_out.slice(0, 5)} 하원 예정입니다.`,
        student,
        schedule,
        seatNo: seat.seat_no || student?.default_seat_no,
        plannedTime: schedule.planned_check_out.slice(0, 5),
      });
    }

    for (const item of scheduleBreakList) {
      const leave = timeToMinutes(item.leave_start);
      const ret = timeToMinutes(item.return_time);
      const reason = [item.reason, item.reason_detail].filter(Boolean).join(' · ');

      if (leave !== null && now >= leave - 5 && now <= leave) {
        alerts.push({
          id: `leave-preview-${item.id}`,
          type: 'leave_preview',
          mode: 'preview',
          title: `${studentName} 외출 예정`,
          body: `${item.leave_start.slice(0, 5)} 외출 예정 · 사유: ${reason || '-'}`,
          student,
          schedule,
          breakItem: item,
          seatNo: seat.seat_no || student?.default_seat_no,
          plannedTime: item.leave_start.slice(0, 5),
          reason,
        });
      }

      const returnMismatchWindowEnd = checkOut !== null && checkOut > ret ? checkOut : 24 * 60 - 1;
      if (ret !== null && now >= ret && now <= returnMismatchWindowEnd && session?.seat_status !== 'occupied') {
        alerts.push({
          id: `return-${item.id}`,
          type: 'return_check',
          mode: 'check',
          title: `${studentName} 복귀 확인 필요`,
          body: `예정 복귀 ${item.return_time.slice(0, 5)} · 사유: ${reason || '-'} · 복귀 확인이 필요합니다.`,
          student,
          schedule,
          breakItem: item,
          seatNo: seat.seat_no || student?.default_seat_no,
          plannedTime: item.return_time.slice(0, 5),
          reason,
        });
      }
    }
  }

  return alerts;
}

export default function Page() {
  const [adminPassword, setAdminPassword] = useState('');
  const [appSessionToken, setAppSessionToken] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordStatus, setPasswordStatus] = useState(null);
  const [accountLoginForm, setAccountLoginForm] = useState({ username: '', password: '' });
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [studentHistoryFocusStudentId, setStudentHistoryFocusStudentId] = useState('');
  const [mentorCommentFocusRequest, setMentorCommentFocusRequest] = useState(null);
  const [studentCareMentoringContext, setStudentCareMentoringContext] = useState(null);
  const [seats, setSeats] = useState(STATIC_SEATS);
  const [students, setStudents] = useState([]);
  const [settingsStudents, setSettingsStudents] = useState([]);
  const [studentEditor, setStudentEditor] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [checks, setChecks] = useState([]);
  const [events, setEvents] = useState([]);
  const [reports, setReports] = useState([]);
  const [kioskImportEvents, setKioskImportEvents] = useState([]);
  const [sendExclusions, setSendExclusions] = useState([]);
  const [planners, setPlanners] = useState([]);
  const [plannerDate, setPlannerDate] = useState(getKstDateString());
  const [sendPreview, setSendPreview] = useState(null);
  const [sendActionNotice, setSendActionNotice] = useState(null);
  const [parentAlertPopup, setParentAlertPopup] = useState(null);
  const [attendanceActionNotice, setAttendanceActionNotice] = useState(null);
  const [remoteChangeNotice, setRemoteChangeNotice] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [attendanceSavingStatus, setAttendanceSavingStatus] = useState(null);
  const [awayPopup, setAwayPopup] = useState(null);
  const [attendanceAdjustPopup, setAttendanceAdjustPopup] = useState(null);
  const [nowTick, setNowTick] = useState(new Date());
  const [todaySchedules, setTodaySchedules] = useState([]);
  const [todayScheduleBreaks, setTodayScheduleBreaks] = useState([]);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [scheduleBreakRows, setScheduleBreakRows] = useState([]);
  const [scheduleCoverage, setScheduleCoverage] = useState(null);
  const [fieldFocusAcknowledgements, setFieldFocusAcknowledgements] = useState([]);
  const [mentoringTodayAssignments, setMentoringTodayAssignments] = useState([]);
  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const [dismissedAlertMemos, setDismissedAlertMemos] = useState({});
  const [selectedSeatNo, setSelectedSeatNo] = useState(null);
  const [view, setView] = useState('map');
  const [message, setMessage] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginMode, setLoginMode] = useState('account');
  const [signupForm, setSignupForm] = useState({
    username: '',
    displayName: '',
    email: '',
    phone: '',
    memo: '',
    privacyAgreed: false,
    termsAgreed: false,
  });
  const [signupStatus, setSignupStatus] = useState(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [resetForm, setResetForm] = useState({ identifier: '', memo: '' });
  const [resetStatus, setResetStatus] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [ranking, setRanking] = useState([]);
  const defaultRange = getThisWeekRange();
  const [rankingStart, setRankingStart] = useState(defaultRange.start);
  const [rankingEnd, setRankingEnd] = useState(defaultRange.end);
  const [scheduleView, setScheduleView] = useState('day');
  const [scheduleBaseDate, setScheduleBaseDate] = useState(getKstDateString());
  const [scheduleStudentFilter, setScheduleStudentFilter] = useState('all');
  const [scheduleQuickPopup, setScheduleQuickPopup] = useState(null);
  const [activityPopup, setActivityPopup] = useState(null);
  const [seatIntegrity, setSeatIntegrity] = useState(null);
  const [seatIntegrityLoading, setSeatIntegrityLoading] = useState(false);
  const [settingsView, setSettingsView] = useState('students');
  const [attendanceStart, setAttendanceStart] = useState(defaultRange.start);
  const [attendanceEnd, setAttendanceEnd] = useState(defaultRange.end);
  const [attendanceStudentFilter, setAttendanceStudentFilter] = useState('');
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceStatusFilter, setAttendanceStatusFilter] = useState('all');
  const [attendanceSummaryCollapsed, setAttendanceSummaryCollapsed] = useState(false);
  const [studyCheckEditor, setStudyCheckEditor] = useState(null);
  const [studyCheckEditSaving, setStudyCheckEditSaving] = useState(false);
  const [operatingRules, setOperatingRules] = useState(DEFAULT_OPERATING_RULES);
  const [rulesDraft, setRulesDraft] = useState(DEFAULT_OPERATING_RULES);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [defaultSchedule, setDefaultSchedule] = useState(DEFAULT_SCHEDULE_SETTINGS);
  const [defaultScheduleConfig, setDefaultScheduleConfig] = useState(DEFAULT_SCHEDULE_CONFIG);
  const [defaultScheduleConfigDraft, setDefaultScheduleConfigDraft] = useState(DEFAULT_SCHEDULE_CONFIG);
  const [defaultScheduleLoading, setDefaultScheduleLoading] = useState(false);
  const [sendConfig, setSendConfig] = useState(null);
  const mobileNavDragRef = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const dashboardSyncRef = useRef(false);
  const dashboardSignatureRef = useRef('');
  const kioskImportSeenRef = useRef(new Set());
  const attendanceSaveLockRef = useRef(false);
  const clientIdRef = useRef('');
  const localMutationRef = useRef({ until: 0, reason: '', url: '' });
  const lastRemoteNoticeRef = useRef({ at: 0, signature: '' });

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    navigator.serviceWorker.register('/sw.js').catch(() => null);
    return undefined;
  }, []);

  useEffect(() => {
    clientIdRef.current = getOrCreateClientId();
  }, []);

  useEffect(() => {
    if (!attendanceActionNotice || attendanceActionNotice.type === 'loading') return undefined;
    const timer = window.setTimeout(() => setAttendanceActionNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [attendanceActionNotice]);

  useEffect(() => {
    if (!remoteChangeNotice) return undefined;
    const timer = window.setTimeout(() => setRemoteChangeNotice(null), REMOTE_NOTICE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [remoteChangeNotice]);

  useEffect(() => {
    if (currentUser?.requirePasswordChange) {
      setAccountModalOpen(true);
      setPasswordStatus({ type: 'neutral', message: '임시 비밀번호로 로그인했습니다. 보안을 위해 비밀번호를 변경하세요.' });
    }
  }, [currentUser?.requirePasswordChange]);


  const [scheduleForm, setScheduleForm] = useState({
    studentId: '',
    scheduleDate: getKstDateString(),
    plannedCheckIn: DEFAULT_SCHEDULE_CHECK_IN,
    plannedCheckOut: DEFAULT_SCHEDULE_CHECK_OUT,
    parentConfirmed: true,
    confirmationNote: '',
    scheduleNote: '',
    breaks: [],
  });

  const [form, setForm] = useState({
    studentId: '',
    name: '',
    school: '',
    grade: '',
    parentPhone: '',
    studentPhone: '',
    studyStatus: '인강',
    subject: '수학',
    studyContent: '',
    reportMentorComment: '',
    reportText: '',
    reportPlannerImageUrl: '',
    reportPlannerFileName: '',
  });

  const checksBySession = useMemo(() => groupBySession(checks), [checks]);
  const eventsBySession = useMemo(() => groupBySession(events), [events]);
  const reportsBySession = useMemo(() => {
    const grouped = {};
    for (const report of reports || []) grouped[report.session_id] = report;
    return grouped;
  }, [reports]);

  const exclusionsBySession = useMemo(() => {
    const grouped = {};
    for (const item of sendExclusions || []) {
      if (item.is_excluded) grouped[item.session_id] = item;
    }
    return grouped;
  }, [sendExclusions]);
  const scheduleBreaksBySchedule = useMemo(() => groupBreaksBySchedule(scheduleBreakRows), [scheduleBreakRows]);

  const sessionBySeat = useMemo(() => {
    const map = {};
    for (const session of sessions) map[session.seat_no] = session;
    return map;
  }, [sessions]);

  const seatsForDisplay = seats?.length ? seats : STATIC_SEATS;
  const selectedSession = selectedSeatNo ? sessionBySeat[selectedSeatNo] : null;
  const selectedSeat = selectedSeatNo ? seatsForDisplay.find((item) => Number(item.seat_no) === Number(selectedSeatNo)) : null;
  const selectedSeatStudent = selectedSession?.students || selectedSeat?.current_student || null;
  const selectedStudentForPanel = selectedSeatStudent ? mergeStudentGuardianSource(selectedSeatStudent, students) : null;
  const selectedPanelGuardians = selectedStudentForPanel ? getActiveGuardians(selectedStudentForPanel, 'daily') : [];
  const selectedReport = selectedSession ? reportsBySession[selectedSession.id] : null;
  const selectedChecks = selectedSession ? (checksBySession[selectedSession.id] || []) : [];
  const selectedEvents = selectedSession ? (eventsBySession[selectedSession.id] || []) : [];
  const selectedRecentAttendanceEvents = sortAttendanceEventsDesc(selectedEvents).slice(0, 6);
  const selectedStudentKioskFailures = useMemo(() => {
    const studentName = selectedStudentForPanel?.name || selectedSession?.students?.name || '';
    if (!studentName) return [];
    return (kioskImportEvents || [])
      .filter((item) => {
        const status = String(item?.status || '').toLowerCase();
        if (status !== 'failed') return false;
        const parsedName = String(item?.parsed_student_name || '').trim();
        const rawText = String(item?.raw_text || '');
        return parsedName === studentName || rawText.includes(studentName);
      })
      .sort((a, b) => new Date(b.processed_at || b.received_at || 0) - new Date(a.processed_at || a.received_at || 0))
      .slice(0, 3);
  }, [kioskImportEvents, selectedStudentForPanel?.name, selectedSession?.students?.name]);

  const selectedReportPreflight = useMemo(() => {
    if (!selectedSession) {
      return { label: '발송 불가', className: 'failed', issues: ['먼저 학생 출결 상태를 저장하세요.'] };
    }

    const issues = [];
    const blockers = [];
    const planner = (planners || []).find((item) => item.student_id === selectedSession.student_id);
    const pureMinutes = calculateLivePureStudyMinutes(selectedSession, nowTick, selectedEvents, defaultSchedule);

    if (!getActiveGuardians(selectedStudentForPanel || selectedSession.students, 'daily').length) blockers.push('데일리 리포트 수신 보호자 없음');
    if (exclusionsBySession?.[selectedSession.id]) blockers.push('오늘 발송 제외 상태');
    if (!planner) issues.push('플래너 미제출');
    if (!selectedReport?.mentor_comment) issues.push('학습멘토 코멘트 미입력');
    if (!selectedChecks.length) issues.push('순찰 체크 없음');
    if (selectedSession.seat_status === 'absent') issues.push('결석 상태');
    if (['away', 'out'].includes(selectedSession.seat_status) && !selectedSession.check_in_at) issues.push('입실시간 누락');
    if (selectedSession.check_in_at && pureMinutes > 0 && pureMinutes < normalizeOperatingRules(operatingRules).lowStudyMinutes) issues.push('순공시간 부족');

    if (blockers.length) return { label: '발송 불가', className: 'failed', issues: blockers };
    if (issues.length) return { label: '확인 필요', className: 'neutral', issues };
    return { label: '발송 가능', className: 'done', issues: ['누락 항목 없음'] };
  }, [selectedSession, selectedStudentForPanel, selectedReport, selectedChecks, planners, exclusionsBySession, operatingRules, nowTick, defaultSchedule]);


  const scheduleAlerts = useMemo(() => {
    return createScheduleAlerts({
      schedules: todaySchedules,
      scheduleBreaks: todayScheduleBreaks,
      sessions,
      seats: seatsForDisplay,
      students,
      defaultSchedule,
    }).filter((alert) => !dismissedAlerts.includes(alert.id));
  }, [todaySchedules, todayScheduleBreaks, sessions, seatsForDisplay, students, defaultSchedule, dismissedAlerts, nowTick]);

  const summary = useMemo(() => {
    const values = Object.values(sessionBySeat);
    return {
      todayIn: values.filter((s) => s.check_in_at).length,
      currentIn: values.filter((s) => s.seat_status === 'occupied').length,
      away: values.filter((s) => s.seat_status === 'away').length,
      out: values.filter((s) => s.seat_status === 'out').length,
      absent: values.filter((s) => s.seat_status === 'absent').length,
      needs: values.filter((s) => s.seat_status === 'needs_attention').length,
    };
  }, [sessionBySeat]);

  const reportReadySessions = useMemo(() => {
    return sessions.filter((session) => session.students).sort((a, b) => a.seat_no - b.seat_no);
  }, [sessions]);

  const attentionSessions = useMemo(() => {
    const issueCheckSessionIds = new Set(
      (checks || [])
        .filter((check) => ['수면', '비학습'].includes(check.study_status))
        .map((check) => check.session_id)
    );

    return sessions.filter((session) =>
      session.seat_status === 'needs_attention'
        || session.seat_status === 'absent'
        || issueCheckSessionIds.has(session.id)
    );
  }, [sessions, checks]);

  const effectivePermissions = useMemo(() => getEffectivePermissions(currentUser), [currentUser]);
  const allowedTabs = useMemo(() => TABS.filter(([key]) => hasPagePermission(currentUser, key)), [currentUser]);
  const canUseUserManagement = hasUserManagementPermission(currentUser);
  const isActiveTabAllowed = allowedTabs.some(([key]) => key === activeTab);

  useEffect(() => {
    if (activeTab === 'attendance') {
      setActiveTab('studentHistory');
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isLoggedIn) return;
    if (activeTab === 'attendance') return;
    if (!allowedTabs.length) return;
    if (!isActiveTabAllowed) {
      setActiveTab(allowedTabs[0][0]);
      setMessage('현재 계정에 허용된 첫 페이지로 이동했습니다.');
    }
  }, [isLoggedIn, isActiveTabAllowed, allowedTabs, activeTab]);

  useEffect(() => {
    const savedToken = window.localStorage.getItem('beyond_app_session_token');
    const savedUser = window.localStorage.getItem('beyond_app_user');

    if (savedToken) {
      setAppSessionToken(savedToken);
      try {
        setCurrentUser(savedUser ? JSON.parse(savedUser) : null);
      } catch {
        setCurrentUser(null);
      }
      setIsLoggedIn(true);
      return;
    }

    const savedPassword = window.localStorage.getItem('beyond_admin_password');
    if (savedPassword) {
      setAdminPassword(savedPassword);
      verifyAndEnter(savedPassword, { silent: true });
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      loadDashboard();
      loadOperatingRules();
      loadDefaultSchedule();
      loadSendConfig();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const syncDashboard = async () => {
      if (dashboardSyncRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      dashboardSyncRef.current = true;
      try {
        await loadDashboard({ silent: true, runAutoCheckout: false });
      } finally {
        dashboardSyncRef.current = false;
      }
    };

    const interval = window.setInterval(syncDashboard, 3000);
    const handleVisibilityChange = () => {
      if (!document.hidden) syncDashboard();
    };
    const handleFocus = () => syncDashboard();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isLoggedIn, adminPassword]);

  useEffect(() => {
    if (isLoggedIn && activeTab === 'schedules') loadSchedules();
  }, [isLoggedIn, activeTab, scheduleView, scheduleBaseDate]);

  useEffect(() => {
    if (isLoggedIn && ['planner', 'dailyReports'].includes(activeTab)) {
      loadPlanners(plannerDate);
    }
    if (isLoggedIn && activeTab === 'dailyReports') {
      loadReportExclusions(plannerDate);
    }
  }, [isLoggedIn, activeTab, plannerDate]);

  useEffect(() => {
    if (isLoggedIn && activeTab === 'studentHistory' && !attendanceStudentFilter) {
      setAttendanceRows([]);
    }
  }, [isLoggedIn, activeTab, attendanceStudentFilter]);

  function markLocalMutation(reason = 'local', url = '') {
    const now = Date.now();
    localMutationRef.current = {
      until: now + LOCAL_MUTATION_SUPPRESS_MS,
      reason,
      url,
    };
  }

  function shouldShowRemoteChangeNotice(nextSignature) {
    if (!nextSignature) return false;
    const now = Date.now();
    const localMutation = localMutationRef.current || {};
    if (localMutation.until && now < localMutation.until) return false;

    const lastNotice = lastRemoteNoticeRef.current || {};
    if (lastNotice.signature === nextSignature && now - Number(lastNotice.at || 0) < REMOTE_NOTICE_DEDUPE_MS) {
      return false;
    }

    lastRemoteNoticeRef.current = { at: now, signature: nextSignature };
    return true;
  }

  async function apiFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const mutation = isMutationMethod(method);
    if (mutation) markLocalMutation('api', url);

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(adminPassword ? { 'x-admin-password': adminPassword } : {}),
        ...(appSessionToken ? { 'x-app-session-token': appSessionToken } : {}),
        ...(clientIdRef.current ? { 'x-beyond-client-id': clientIdRef.current } : {}),
        ...(options.headers || {}),
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        window.localStorage.removeItem('beyond_admin_password');
        window.localStorage.removeItem('beyond_app_session_token');
        window.localStorage.removeItem('beyond_app_user');
        setAdminPassword('');
        setAppSessionToken('');
        setCurrentUser(null);
        setIsLoggedIn(false);
        throw new Error('로그인이 만료되었거나 인증 정보가 올바르지 않습니다.');
      }
      if (response.status === 403) {
        const error = new Error(data.error || '현재 계정에는 이 작업을 수행할 권한이 없습니다.');
        Object.assign(error, data || {});
        error.status = response.status;
        throw error;
      }
      const error = new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
      Object.assign(error, data || {});
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function loadOperatingRules() {
    try {
      const data = await apiFetch('/api/operating-rules');
      const rules = normalizeOperatingRules(data.rules || DEFAULT_OPERATING_RULES);
      setOperatingRules(rules);
      setRulesDraft(rules);
    } catch {
      const rules = normalizeOperatingRules(DEFAULT_OPERATING_RULES);
      setOperatingRules(rules);
      setRulesDraft(rules);
    }
  }

  async function saveOperatingRules(nextRules = rulesDraft) {
    try {
      setRulesLoading(true);
      const normalized = normalizeOperatingRules(nextRules);
      const data = await apiFetch('/api/operating-rules', {
        method: 'POST',
        body: JSON.stringify({ rules: normalized }),
      });
      const saved = normalizeOperatingRules(data.rules || normalized);
      setOperatingRules(saved);
      setRulesDraft(saved);
      setMessage(data.warning || '운영 기준 저장 완료');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setRulesLoading(false);
    }
  }


  function applyDefaultScheduleConfig(config) {
    const normalizedConfig = normalizeDefaultScheduleConfig(config || DEFAULT_SCHEDULE_CONFIG);
    setDefaultScheduleConfig(normalizedConfig);
    setDefaultScheduleConfigDraft(normalizedConfig);
    // 대시보드(오늘 화면)는 오늘 날짜의 요일 유형에 맞는 시간표를 사용합니다.
    setDefaultSchedule(resolveScheduleForDate(normalizedConfig, getKstDateString()));
    return normalizedConfig;
  }

  async function loadDefaultSchedule() {
    try {
      const data = await apiFetch('/api/default-schedule');
      applyDefaultScheduleConfig(data.defaultScheduleConfig || data.defaultSchedule || DEFAULT_SCHEDULE_CONFIG);
    } catch {
      applyDefaultScheduleConfig(DEFAULT_SCHEDULE_CONFIG);
    }
  }

  async function saveDefaultSchedule(nextConfig = defaultScheduleConfigDraft) {
    try {
      setDefaultScheduleLoading(true);
      const normalizedConfig = normalizeDefaultScheduleConfig(nextConfig);
      const data = await apiFetch('/api/default-schedule', {
        method: 'POST',
        body: JSON.stringify({ defaultScheduleConfig: normalizedConfig }),
      });
      applyDefaultScheduleConfig(data.defaultScheduleConfig || normalizedConfig);
      setMessage(data.warning || '기본 시간표 저장 완료');
      // v41-34.1: 멘토링 차시 드롭다운/요일 템플릿도 설정 탭의 기본 시간표를 기준으로 쓰도록 동기화합니다.
      await apiFetch('/api/mentoring', { method: 'POST', body: JSON.stringify({ action: 'seedDefaults', scheduleDate: getKstDateString() }) }).catch(() => null);
      await Promise.allSettled([loadDashboard({ silent: true, runAutoCheckout: false }), loadSchedules()]);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setDefaultScheduleLoading(false);
    }
  }

  async function loadDashboard(options = {}) {
    const { silent = false, runAutoCheckout = true, suppressChangeNotice = false } = options;
    try {
      if (!silent) setMessage('불러오는 중...');
      if (!lastSyncAt && syncStatus !== 'synced') setSyncStatus('idle');

      if (runAutoCheckout) await fetch('/api/auto-checkout').catch(() => null);
      const data = await apiFetch('/api/dashboard');
      const nextSignature = createDashboardSignature(data);
      const previousSignature = dashboardSignatureRef.current;
      const hasRemoteChange = Boolean(silent && !suppressChangeNotice && previousSignature && previousSignature !== nextSignature);
      const kioskImports = Array.isArray(data.kioskImportEvents) ? data.kioskImportEvents : [];
      setKioskImportEvents(kioskImports);

      if (!previousSignature) {
        for (const item of kioskImports) {
          if (item?.id) kioskImportSeenRef.current.add(item.id);
        }
      } else {
        const newKioskImport = kioskImports
          .filter((item) => item?.id && !kioskImportSeenRef.current.has(item.id))
          .sort((a, b) => new Date(b.processed_at || b.received_at || 0) - new Date(a.processed_at || a.received_at || 0))[0];

        for (const item of kioskImports) {
          if (item?.id) kioskImportSeenRef.current.add(item.id);
        }

        if (newKioskImport?.status === 'processed') {
          setAttendanceActionNotice({
            type: 'success',
            title: '키오스크 출결 자동 반영',
            message: `${newKioskImport.parsed_student_name || '학생'} ${getKioskEventLabel(newKioskImport.parsed_event_type)} 기록이 Beyond OS에 자동 반영되었습니다.`,
          });
        } else if (newKioskImport?.status === 'failed') {
          setAttendanceActionNotice({
            type: 'failed',
            title: getKioskImportFailureTitle(newKioskImport),
            message: getKioskImportFailureMessage(newKioskImport),
          });
        }
      }

      dashboardSignatureRef.current = nextSignature;
      setSeats(data.seats?.length ? data.seats : STATIC_SEATS);
      setStudents(data.students || []);
      setSettingsStudents((prev) => prev?.length ? prev : (data.students || []));
      setSessions(data.sessions || []);
      setChecks(data.checks || []);
      setEvents(data.events || []);
      setReports(data.reports || []);
      setMentoringTodayAssignments(data.todayMentoringAssignments || []);
      const serverFocusAcks = Array.isArray(data.fieldFocusAcknowledgements) ? data.fieldFocusAcknowledgements : [];
      setFieldFocusAcknowledgements(serverFocusAcks);
      setDismissedAlerts(serverFocusAcks.map((item) => item.alert_id).filter(Boolean));
      setDismissedAlertMemos(serverFocusAcks.reduce((acc, item) => {
        if (item.alert_id) {
          acc[item.alert_id] = {
            memo: item.memo || '현장 확인 완료',
            dismissedAt: item.dismissed_at || item.acknowledged_at || item.created_at,
            adminName: item.admin_name || '관리자',
            title: item.alert_title || item.alert_type || '관리필요 확인',
          };
        }
        return acc;
      }, {}));

      const today = getKstDateString();
      try {
        const scheduleData = await apiFetch(`/api/schedules?start=${today}&end=${today}`);
        setTodaySchedules(scheduleData.schedules || []);
        setTodayScheduleBreaks(scheduleData.breaks || []);
      } catch {
        setTodaySchedules([]);
        setTodayScheduleBreaks([]);
      }

      setSyncStatus('synced');
      setLastSyncAt(new Date());

      if (
        hasRemoteChange
        && typeof window !== 'undefined'
        && window.innerWidth > 900
        && shouldShowRemoteChangeNotice(nextSignature)
      ) {
        setRemoteChangeNotice({
          id: `${Date.now()}-${nextSignature.slice(0, 18)}`,
          title: '다른 기기 변경 반영',
          message: '다른 기기에서 변경된 좌석 상태가 현재 화면에 반영되었습니다.',
        });
      }

      if (!silent) setMessage(data.warning || '');
    } catch (error) {
      setSyncStatus('failed');
      if (!silent) {
        setSeats(STATIC_SEATS);
        setSessions([]);
        setChecks([]);
        setEvents([]);
        setReports([]);
        setMessage(error.message);
      }
    }
  }

  async function loadSendConfig() {
    try {
      const data = await apiFetch('/api/report-send-config');
      setSendConfig(data || null);
    } catch {
      setSendConfig(null);
    }
  }

  async function loadSettingsStudents() {
    try {
      const data = await apiFetch('/api/students');
      setSettingsStudents(data.students || []);
    } catch {
      setSettingsStudents((prev) => prev?.length ? prev : students);
    }
  }

  async function runSeatIntegrityCheck() {
    try {
      setSeatIntegrityLoading(true);
      setMessage('좌석 데이터 점검 중...');
      const data = await apiFetch('/api/seat-integrity');
      setSeatIntegrity(data);
      setMessage('좌석 데이터 점검 완료');
      return data;
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSeatIntegrityLoading(false);
    }
  }

  async function cleanupSeatIntegrity() {
    const current = seatIntegrity || await runSeatIntegrityCheck();
    const count = current?.summary?.cleanupCount || current?.cleanupPlan?.length || 0;
    if (!count) {
      alert('정리할 좌석 데이터가 없습니다.');
      return;
    }

    const ok = confirm(`좌석 데이터 ${count}건을 학생 기본 좌석 기준으로 정리할까요?\n\n정리 전/후 계획을 확인한 뒤 실행하는 기능입니다.`);
    if (!ok) return;

    try {
      setSeatIntegrityLoading(true);
      setMessage('좌석 데이터 정리 중...');
      const data = await apiFetch('/api/seat-integrity', {
        method: 'POST',
        body: JSON.stringify({ action: 'cleanup' }),
      });
      setSeatIntegrity(data.after || data);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage(`좌석 데이터 정리 완료: ${data.appliedCount || 0}건`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSeatIntegrityLoading(false);
    }
  }


  async function loadSchedules() {
    const range = getScheduleRange(scheduleView, scheduleBaseDate);
    try {
      setMessage('시간표 조회 중...');
      const data = await apiFetch(`/api/schedules?start=${range.start}&end=${range.end}`);
      setScheduleRows(data.schedules || []);
      setScheduleBreakRows(data.breaks || []);
      setMessage('시간표 조회 완료');
    } catch (error) {
      setMessage(error.message);
    }
    loadScheduleCoverage();
  }

  async function loadScheduleCoverage() {
    try {
      const data = await apiFetch('/api/schedules/coverage');
      setScheduleCoverage(data);
    } catch {
      setScheduleCoverage(null);
    }
  }

  async function bulkGenerateSchedules({ studentIds = null, startDate, endDate }) {
    try {
      setMessage('기본 시간표로 개인 시간표 일괄 생성 중...');
      const data = await apiFetch('/api/schedules/bulk-generate', {
        method: 'POST',
        body: JSON.stringify({ studentIds, startDate, endDate }),
      });
      setMessage(`일괄 생성 완료: 학생 ${data.studentCount}명 × 운영일 ${data.operatingDayCount}일 → ${data.created}건 생성 (기존 ${data.skippedExisting}건 보존${data.skippedRestDays ? ` · 휴무일 ${data.skippedRestDays}일 제외` : ''})`);
      await loadSchedules();
      await loadDashboard({ silent: true, suppressChangeNotice: true });
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadPlanners(date = plannerDate) {
    try {
      const data = await apiFetch(`/api/planner?date=${date}`);
      setPlanners(data.planners || []);
    } catch (error) {
      setPlanners([]);
      setMessage(`플래너 조회 오류: ${error.message}`);
    }
  }

  async function loadReportExclusions(date = plannerDate) {
    try {
      const data = await apiFetch(`/api/report-exclusion?date=${date}`);
      setSendExclusions(data.exclusions || []);
    } catch {
      setSendExclusions([]);
    }
  }

  async function updateReportExclusion(sessionId, isExcluded, reason = '') {
    try {
      const data = await apiFetch('/api/report-exclusion', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          isExcluded,
          reason,
          adminName: currentUser?.displayName || '관리자',
        }),
      });

      setSendExclusions((prev) => {
        const others = (prev || []).filter((item) => item.session_id !== sessionId);
        if (data.exclusion?.is_excluded) return [...others, data.exclusion];
        return others;
      });

      setMessage(isExcluded ? '발송 제외 저장 완료' : '발송 제외 해제 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }


  async function runPlannerDiagnostics() {
    try {
      setMessage('플래너 연결진단 중...');
      const data = await apiFetch('/api/planner-diagnostics');
      const lines = Object.entries(data.checks || {}).map(([key, value]) => `${key}: ${value.ok ? '정상' : '오류'} - ${value.message}`);
      setMessage(`플래너 연결진단 ${data.ok ? '완료' : '오류'}\n${lines.join('\n')}`);
    } catch (error) {
      setMessage(`플래너 연결진단 오류: ${error.message}`);
    }
  }

  async function compressImageFile(file) {
    if (!file || !file.type?.startsWith('image/')) return file;
    if (file.size <= 2.8 * 1024 * 1024) return file;

    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxSize = 1600;
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, '') + '_compressed.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.78);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  async function uploadPlannerFile({ studentId, date, file, memo }) {
    if (!studentId) return alert('학생을 선택하세요.');
    if (!file) return alert('업로드할 플래너 사진을 선택하세요.');

    try {
      setMessage('플래너 업로드 중...');
      const uploadFile = await compressImageFile(file);
      const formData = new FormData();
      formData.append('studentId', studentId);
      formData.append('plannerDate', date);
      formData.append('memo', memo || '');
      formData.append('uploadedBy', currentUser?.displayName || '관리자');
      formData.append('file', uploadFile);

      const response = await fetch('/api/planner', {
        method: 'POST',
        headers: {
          'x-admin-password': adminPassword,
        },
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = data.hint ? `\n${data.hint}` : '';
        throw new Error(`${data.error || '플래너 업로드 중 오류가 발생했습니다.'}${hint}`);
      }

      await loadPlanners(date);
      setMessage('플래너 업로드 완료');
      return data.planner;
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function verifyAndEnter(password, options = {}) {
    const trimmed = (password || '').trim();
    if (!trimmed) {
      setLoginError('관리자 비밀번호를 입력하세요.');
      return;
    }

    try {
      setLoginError('');
      const response = await fetch('/api/auth', {
        headers: { 'x-admin-password': trimmed },
      });

      if (!response.ok) throw new Error('관리자 비밀번호가 맞지 않습니다.');

      window.localStorage.removeItem('beyond_app_session_token');
      window.localStorage.removeItem('beyond_app_user');
      window.localStorage.setItem('beyond_admin_password', trimmed);
      setAppSessionToken('');
      setCurrentUser({ displayName: '공용 관리자', username: 'admin', role: 'super_admin' });
      setAdminPassword(trimmed);
      setIsLoggedIn(true);
    } catch (error) {
      window.localStorage.removeItem('beyond_admin_password');
      setIsLoggedIn(false);
      if (!options.silent) setLoginError(error.message);
    }
  }

  function handleLogin() {
    verifyAndEnter(adminPassword);
  }

  async function handleAccountLogin() {
    const username = accountLoginForm.username.trim();
    const password = accountLoginForm.password;
    if (!username || !password) {
      setLoginError('아이디와 비밀번호를 입력하세요.');
      return;
    }

    try {
      setLoginError('');
      const response = await fetch('/api/account-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '로그인에 실패했습니다.');

      window.localStorage.removeItem('beyond_admin_password');
      window.localStorage.setItem('beyond_app_session_token', data.token);
      window.localStorage.setItem('beyond_app_user', JSON.stringify(data.user || null));
      setAdminPassword('');
      setAppSessionToken(data.token);
      setCurrentUser(data.user || null);
      setIsLoggedIn(true);
      setAccountLoginForm({ username: '', password: '' });
    } catch (error) {
      window.localStorage.removeItem('beyond_app_session_token');
      window.localStorage.removeItem('beyond_app_user');
      setAppSessionToken('');
      setCurrentUser(null);
      setLoginError(error.message);
    }
  }

  async function submitSignupRequest() {
    if (!signupForm.displayName.trim()) return setSignupStatus({ type: 'error', message: '이름을 입력하세요.' });
    if (!signupForm.username.trim()) return setSignupStatus({ type: 'error', message: '아이디를 입력하세요.' });
    if (!signupForm.email.trim()) return setSignupStatus({ type: 'error', message: '승인/비밀번호 설정 안내를 받을 이메일을 입력하세요.' });
    if (!signupForm.phone.trim()) return setSignupStatus({ type: 'error', message: '휴대폰번호를 입력하세요.' });
    if (!signupForm.privacyAgreed || !signupForm.termsAgreed) return setSignupStatus({ type: 'error', message: '개인정보 수집·이용 동의와 프로그램 사용 동의가 모두 필요합니다.' });

    try {
      setSignupLoading(true);
      setSignupStatus(null);
      const response = await fetch('/api/signup-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signupForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '계정 생성 신청 중 오류가 발생했습니다.');

      setSignupStatus({
        type: 'success',
        message: '계정 생성 신청이 완료되었습니다. 관리자 승인 후 프로그램 접속이 가능합니다.',
      });
      setSignupForm({
        username: '',
        displayName: '',
        email: '',
        phone: '',
        memo: '',
        privacyAgreed: false,
        termsAgreed: false,
      });
    } catch (error) {
      setSignupStatus({ type: 'error', message: error.message });
    } finally {
      setSignupLoading(false);
    }
  }

  async function submitPasswordResetRequest() {
    if (!resetForm.identifier.trim()) {
      setResetStatus({ type: 'error', message: '아이디 또는 이메일을 입력하세요.' });
      return;
    }

    try {
      setResetLoading(true);
      setResetStatus(null);
      const response = await fetch('/api/password-reset-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetForm),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '비밀번호 재설정 요청 중 오류가 발생했습니다.');
      setResetStatus({ type: 'success', message: data.message || '비밀번호 재설정 요청이 접수되었습니다. 관리자 확인 후 임시 비밀번호를 안내받으세요.' });
      setResetForm({ identifier: '', memo: '' });
    } catch (error) {
      setResetStatus({ type: 'error', message: error.message });
    } finally {
      setResetLoading(false);
    }
  }

  async function changeOwnPassword() {
    if (!appSessionToken || currentUser?.username === 'admin') {
      setPasswordStatus({ type: 'error', message: '공용 관리자 접속 상태에서는 개인 비밀번호를 변경할 수 없습니다.' });
      return;
    }
    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: '현재 비밀번호와 새 비밀번호를 모두 입력하세요.' });
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordStatus({ type: 'error', message: '새 비밀번호는 8자 이상으로 입력하세요.' });
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordStatus({ type: 'error', message: '새 비밀번호 확인이 일치하지 않습니다.' });
      return;
    }

    try {
      setPasswordStatus({ type: 'neutral', message: '비밀번호 변경 중...' });
      const data = await apiFetch('/api/account-password', {
        method: 'POST',
        body: JSON.stringify(passwordForm),
      });
      if (data.token) {
        window.localStorage.setItem('beyond_app_session_token', data.token);
        setAppSessionToken(data.token);
      }
      if (data.user) {
        window.localStorage.setItem('beyond_app_user', JSON.stringify(data.user));
        setCurrentUser(data.user);
      }
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordStatus({ type: 'success', message: data.message || '비밀번호가 변경되었습니다.' });
      setMessage('비밀번호 변경 완료');
    } catch (error) {
      setPasswordStatus({ type: 'error', message: error.message });
    }
  }

  function isMobileNavEvent() {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 900;
  }

  function handleNavPointerDown(event) {
    if (!isMobileNavEvent()) return;
    const target = event.currentTarget;
    mobileNavDragRef.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: target.scrollLeft,
      moved: false,
    };
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {}
  }

  function handleNavPointerMove(event) {
    const drag = mobileNavDragRef.current;
    if (!drag.active || !isMobileNavEvent()) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 4) drag.moved = true;
    event.currentTarget.scrollLeft = drag.scrollLeft - dx;
    if (drag.moved) event.preventDefault();
  }

  function handleNavPointerEnd(event) {
    if (!isMobileNavEvent()) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {}
    window.setTimeout(() => {
      mobileNavDragRef.current.active = false;
      mobileNavDragRef.current.moved = false;
    }, 80);
  }

  function handleNavTouchStart(event) {
    if (!isMobileNavEvent()) return;
    const touch = event.touches?.[0];
    if (!touch) return;
    mobileNavDragRef.current = {
      active: true,
      startX: touch.clientX,
      startY: touch.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
  }

  function handleNavTouchMove(event) {
    const drag = mobileNavDragRef.current;
    if (!drag.active || !isMobileNavEvent()) return;
    const touch = event.touches?.[0];
    if (!touch) return;

    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - (drag.startY || touch.clientY);
    if (Math.abs(dx) > 3 && Math.abs(dx) > Math.abs(dy)) {
      drag.moved = true;
      event.currentTarget.scrollLeft = drag.scrollLeft - dx;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function handleNavTouchEnd() {
    if (!isMobileNavEvent()) return;
    window.setTimeout(() => {
      mobileNavDragRef.current.active = false;
      mobileNavDragRef.current.moved = false;
    }, 90);
  }

  function scrollMobileNav(direction) {
    if (!isMobileNavEvent()) return;
    const nav = document.querySelector('.sidebar .nav');
    if (!nav) return;
    nav.scrollBy({
      left: direction * Math.max(160, Math.floor(window.innerWidth * 0.55)),
      behavior: 'smooth',
    });
  }


  function handleNavClickCapture(event) {
    if (!isMobileNavEvent()) return;
    if (mobileNavDragRef.current.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function logout() {
    window.localStorage.removeItem('beyond_admin_password');
    window.localStorage.removeItem('beyond_app_session_token');
    window.localStorage.removeItem('beyond_app_user');
    setIsLoggedIn(false);
    setAdminPassword('');
    setAppSessionToken('');
    setCurrentUser(null);
    setSeats(STATIC_SEATS);
    setStudents([]);
    setSessions([]);
    setChecks([]);
    setEvents([]);
  }

  function selectSeat(seatNo) {
    setSelectedSeatNo(seatNo);
    setStudyCheckEditor(null);
    const session = sessionBySeat[seatNo];
    const seat = seatsForDisplay.find((item) => item.seat_no === seatNo);
    const student = mergeStudentGuardianSource(session?.students || seat?.current_student || {}, students);
    const latestStudyCheck = session?.id ? getLatestStudyCheckFromRows(checksBySession[session.id] || []) : null;

    setForm({
      studentId: student.id || '',
      name: student.name || '',
      school: student.school || '',
      grade: student.grade || '',
      parentPhone: student.parent_phone || '',
      studentPhone: student.student_phone || '',
      studyStatus: latestStudyCheck?.study_status || '인강',
      subject: latestStudyCheck?.subject || '수학',
      studyContent: '',
      reportMentorComment: session ? (reportsBySession[session.id]?.mentor_comment || '') : '',
      reportText: '',
      reportPlannerImageUrl: '',
      reportPlannerFileName: '',
    });

    if (window.matchMedia('(max-width: 760px)').matches) {
      document.body.classList.add('panel-open');
    }
  }

  function closePanel() {
    document.body.classList.remove('panel-open');
    setSelectedSeatNo(null);
  }


  function getSessionForSeat(seatNo) {
    return sessionBySeat[seatNo] || null;
  }

  function openManualCheckInAdjustPopup(session, desiredSeatStatus) {
    if (!session) return;

    const targetStatus = desiredSeatStatus || session.seat_status;
    setAttendanceAdjustPopup({
      sessionDate: session.session_date || getKstDateString(),
      checkInTime: session.check_in_at ? toFiveMinuteInputValue(formatKstTime(session.check_in_at)) : getCurrentKstTimeFiveMinute(),
      checkOutTime: targetStatus === 'out'
        ? (session.check_out_at ? toFiveMinuteInputValue(formatKstTime(session.check_out_at)) : getCurrentKstTimeFiveMinute())
        : '',
      awayTotalMinutes: session.away_total_minutes || 0,
      note: '누락된 입실 시간 수동 입력',
      requiredManualCheckIn: true,
      desiredSeatStatus: targetStatus,
    });
  }

  function getTransitionOverride(seatStatus, currentSession, studentName) {
    const currentStatus = currentSession?.seat_status || 'not_arrived';
    const hasTodaySession = Boolean(currentSession?.id);
    const nextLabel = STATUS_LABELS[seatStatus] || seatStatus;
    const currentLabel = STATUS_LABELS[currentStatus] || currentStatus || '미입실';

    if (!hasTodaySession && ['away', 'out'].includes(seatStatus)) {
      const ok = confirm(`현재 이 학생은 오늘 입실 기록이 없습니다.\n\n${nextLabel} 상태로 변경하면 먼저 출결에 반영됩니다.\n\n단, 실제 입실 시간이 누락되므로 이어서 입실 시간을 반드시 입력해야 합니다.\n\n계속 진행할까요?`);
      if (!ok) return null;
      return {
        transitionAction: 'missing_checkin_required',
        requireManualCheckIn: true,
        desiredSeatStatus: seatStatus,
      };
    }

    if (['occupied', 'away', 'out'].includes(currentStatus) && seatStatus === 'absent') {
      const ok = confirm(`현재 이 학생은 ${currentLabel} 상태입니다.\n\n결석으로 변경하면 오늘 남아 있던 입실/외출/퇴실 관련 기록은 정리되고, 결석 상태로 다시 반영됩니다.\n\n계속 진행할까요?`);
      if (!ok) return null;
      return { transitionAction: 'reset_to_absent' };
    }

    if (currentStatus === 'absent' && seatStatus === 'occupied') {
      const ok = confirm(`현재 이 학생은 결석 상태입니다.\n\n입실로 변경하면 결석 기록은 정리되고, 입실 상태로 다시 반영됩니다.\n\n계속 진행할까요?`);
      if (!ok) return null;
      return { transitionAction: 'absent_to_occupied' };
    }

    if (currentStatus === 'absent' && ['away', 'out'].includes(seatStatus)) {
      const ok = confirm(`현재 이 학생은 결석 상태입니다.\n\n${nextLabel} 상태로 변경하면 결석 기록은 정리되고, ${nextLabel} 상태로 다시 반영됩니다.\n\n단, 입실 기록이 없으므로 이후 실제 입실 시간을 입력해야 합니다.\n\n계속 진행할까요?`);
      if (!ok) return null;
      return {
        transitionAction: 'absent_to_manual_checkin',
        requireManualCheckIn: true,
        desiredSeatStatus: seatStatus,
      };
    }

    if (currentStatus === 'out' && seatStatus === 'occupied') {
      const ok = confirm(`현재 이 학생은 퇴실 상태입니다.\n\n입실로 다시 변경하면 기존 퇴실 시각은 외출 시작으로 전환되고, 지금 시간은 복귀/재입실로 기록됩니다.\n\n계속 진행할까요?`);
      if (!ok) return null;
      return { transitionAction: 'reentry_from_out' };
    }

    return {};
  }


  function getTodayScheduleForStudent(studentId) {
    const schedule = (todaySchedules || []).find((item) => String(item.student_id) === String(studentId));
    return {
      plannedCheckIn: schedule?.planned_check_in?.slice(0, 5) || normalizeDefaultScheduleSettings(defaultSchedule).plannedCheckIn,
      plannedCheckOut: schedule?.planned_check_out?.slice(0, 5) || normalizeDefaultScheduleSettings(defaultSchedule).plannedCheckOut,
    };
  }

  function getTimingIssueForStatus(seatStatus, currentSession, studentId, eventTimeValue) {
    const rules = normalizeOperatingRules(operatingRules);
    const schedule = getTodayScheduleForStudent(studentId);
    const eventMinutes = timeToMinutes(eventTimeValue || getCurrentKstTime());
    if (eventMinutes === null) return null;

    if (seatStatus === 'occupied') {
      const currentStatus = currentSession?.seat_status || 'not_arrived';
      const isReturnOrReentry = ['away', 'out'].includes(currentStatus);
      const alreadyCheckedIn = Boolean(currentSession?.check_in_at) && currentStatus !== 'absent';
      if (isReturnOrReentry || alreadyCheckedIn) return null;

      const plannedMinutes = timeToMinutes(schedule.plannedCheckIn);
      if (plannedMinutes !== null && eventMinutes - plannedMinutes >= rules.lateThresholdMinutes) {
        return {
          label: '지각',
          plannedTime: schedule.plannedCheckIn,
          actualTime: eventTimeValue || getCurrentKstTime(),
          threshold: rules.lateThresholdMinutes,
        };
      }
    }

    if (seatStatus === 'out') {
      if (!currentSession?.check_in_at || currentSession?.seat_status === 'absent') return null;
      const plannedMinutes = timeToMinutes(schedule.plannedCheckOut);
      if (plannedMinutes !== null && plannedMinutes - eventMinutes >= rules.earlyLeaveThresholdMinutes) {
        return {
          label: '조퇴',
          plannedTime: schedule.plannedCheckOut,
          actualTime: eventTimeValue || getCurrentKstTime(),
          threshold: rules.earlyLeaveThresholdMinutes,
        };
      }
    }

    return null;
  }

  function promptAbsenceReason(studentName) {
    const input = window.prompt(`${studentName} 학생의 결석 사유를 입력하세요.

예: 병결, 가정 사유, 학교 일정, 무단결석 등

취소를 누르면 결석 처리가 중단됩니다.`, '');
    if (input === null) return null;
    const reason = String(input || '').trim();
    return reason ? `결석 사유: ${reason}` : '';
  }

  function promptOptionalTimingReason(studentName, issue) {
    if (!issue?.label) return '';
    const input = window.prompt(`${studentName} 학생은 운영 기준상 ${issue.label}에 해당합니다.

예정 시간: ${issue.plannedTime}
실제 처리 시간: ${issue.actualTime}
기준: ${issue.threshold}분 이상

사유가 있으면 입력하세요.
입력하지 않고 진행하려면 빈칸으로 확인하거나 취소를 누르세요.`, '');
    if (input === null) return '';
    const reason = String(input || '').trim();
    return reason ? `${issue.label} 사유: ${reason}` : '';
  }

  function getAttendanceReasonMemoForStatus(seatStatus, currentSession, studentData, finalOverride = {}) {
    const studentName = studentData.name?.trim() || '선택 학생';

    if (seatStatus === 'absent') {
      return promptAbsenceReason(studentName);
    }

    const eventTimeText = finalOverride.eventTime ? formatKstTime(finalOverride.eventTime) : getCurrentKstTime();
    const issue = getTimingIssueForStatus(seatStatus, currentSession, studentData.id, eventTimeText);
    if (!issue) return '';
    return promptOptionalTimingReason(studentName, issue);
  }

  function handleStatusButtonClick(status) {
    if (status === 'away') {
      openAwayDetailPopup();
      return;
    }
    saveStatus(status);
  }


  async function saveStatus(seatStatus, override = {}) {
    if (attendanceSaveLockRef.current) return;

    const seatNo = override.seatNo || selectedSeatNo;
    const studentData = override.student || {
      id: form.studentId || undefined,
      name: form.name,
      school: form.school,
      grade: form.grade,
      parentPhone: form.parentPhone,
      studentPhone: form.studentPhone,
    };
    const statusLabel = STATUS_LABELS[seatStatus] || seatStatus || '출결';
    const studentName = studentData.name?.trim() || '선택 학생';
    const currentSession = getSessionForSeat(seatNo);

    if (!seatNo) {
      setAttendanceActionNotice({
        type: 'failed',
        title: '출결 상태 반영 실패',
        message: '좌석을 먼저 선택하세요.',
      });
      return alert('좌석을 먼저 선택하세요.');
    }
    if (!studentData.name?.trim()) {
      setAttendanceActionNotice({
        type: 'failed',
        title: '출결 상태 반영 실패',
        message: '학생명을 입력하거나 좌석에 학생을 배정하세요.',
      });
      return alert('학생명을 입력하세요.');
    }

    if (currentSession?.seat_status === seatStatus && !override.allowSameStatus) {
      const duplicateMessage = `${studentName} 학생은 이미 ${statusLabel} 상태입니다. 동일한 상태는 중복 저장하지 않았습니다.`;
      setMessage(duplicateMessage);
      setAttendanceActionNotice({
        type: 'neutral',
        title: '동일 상태 입력',
        message: duplicateMessage,
      });
      return;
    }

    let transitionOverride = {};
    if (!override.skipTransitionCheck) {
      transitionOverride = getTransitionOverride(seatStatus, currentSession, studentName);
      if (transitionOverride === null) return;
    }

    const finalOverride = { ...transitionOverride, ...override };
    if (!Object.prototype.hasOwnProperty.call(finalOverride, 'attendanceMemo')) {
      const reasonMemo = getAttendanceReasonMemoForStatus(seatStatus, currentSession, studentData, finalOverride);
      if (reasonMemo === null) return;
      if (reasonMemo) finalOverride.attendanceMemo = reasonMemo;
      if (seatStatus === 'absent') finalOverride.attendanceMemo = reasonMemo || '';
    }

    attendanceSaveLockRef.current = true;
    setAttendanceSavingStatus(seatStatus);

    try {
      setMessage('저장 중...');
      setAttendanceActionNotice({
        type: 'loading',
        title: '출결 상태 반영 중',
        message: `${studentName} 학생의 ${statusLabel} 상태를 저장하고 있습니다.`,
      });
      const data = await apiFetch('/api/session', {
        method: 'POST',
        body: JSON.stringify({
          seatNo,
          seatStatus,
          student: studentData,
          ...(Object.prototype.hasOwnProperty.call(finalOverride, 'attendanceMemo') ? { attendanceMemo: finalOverride.attendanceMemo || '' } : {}),
          eventTime: finalOverride.eventTime || undefined,
          transitionAction: finalOverride.transitionAction || undefined,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      const completedAt = formatKstTime(new Date());
      setMessage(`${statusLabel} 처리 완료`);
      setAttendanceActionNotice({
        type: 'success',
        title: '출결 상태 반영 완료',
        message: `${studentName} 학생 / ${seatNo}번 좌석 / ${statusLabel} 상태가 반영되었습니다. (${completedAt})`,
      });

      if (finalOverride.requireManualCheckIn) {
        openManualCheckInAdjustPopup(data.session, finalOverride.desiredSeatStatus || seatStatus);
      }
    } catch (error) {
      setMessage(error.message);
      setAttendanceActionNotice({
        type: 'failed',
        title: '출결 상태 반영 실패',
        message: error.message || `${studentName} 학생의 ${statusLabel} 상태 저장에 실패했습니다.`,
      });
    } finally {
      window.setTimeout(() => {
        attendanceSaveLockRef.current = false;
        setAttendanceSavingStatus(null);
      }, ATTENDANCE_ACTION_UNLOCK_MS);
    }
  }

  async function editAttendanceEventMemo(event) {
    if (!event?.id) return alert('수정할 출결 이력을 찾을 수 없습니다.');
    const currentMemo = getAttendanceHistoryMemo(event);
    const label = getAttendanceHistoryLabel(event).replace(/\s*처리$/, '');
    const input = window.prompt(`${label} 사유/메모를 수정하세요.\n\n비워두고 확인하면 사유가 삭제됩니다.`, currentMemo || '');
    if (input === null) return;

    try {
      setMessage('출결 사유 수정 중...');
      await apiFetch('/api/attendance-event-reason', {
        method: 'POST',
        body: JSON.stringify({
          eventId: event.id,
          memo: String(input || '').trim(),
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage('출결 사유가 수정되었습니다.');
      setAttendanceActionNotice({
        type: 'success',
        title: '출결 사유 수정 완료',
        message: `${label} 사유/메모가 리포트에 반영될 수 있도록 수정되었습니다.`,
      });
    } catch (error) {
      setMessage(error.message || '출결 사유 수정 실패');
      setAttendanceActionNotice({
        type: 'failed',
        title: '출결 사유 수정 실패',
        message: error.message || '출결 사유를 수정하지 못했습니다.',
      });
    }
  }

  function openAwayDetailPopup() {
    if (!selectedSeatNo || !form.studentId) {
      alert('좌석과 학생을 먼저 선택하세요.');
      return;
    }

    const studentName = form.name?.trim() || '선택 학생';
    const currentStatus = selectedSession?.seat_status || 'not_arrived';

    if (currentStatus === 'away') {
      const duplicateMessage = `${studentName} 학생은 이미 외출 상태입니다. 동일한 상태는 중복 저장하지 않았습니다.`;
      setMessage(duplicateMessage);
      setAttendanceActionNotice({
        type: 'neutral',
        title: '동일 상태 입력',
        message: duplicateMessage,
      });
      return;
    }

    if (!selectedSession?.id) {
      const ok = confirm(`현재 이 학생은 오늘 입실 기록이 없습니다.\n\n외출 상태로 변경하면 외출 사유 입력 후 출결에 반영됩니다.\n\n단, 실제 입실 시간이 누락되므로 이어서 입실 시간을 반드시 입력해야 합니다.\n\n계속 진행할까요?`);
      if (!ok) return;
      setAwayPopup({
        detail: '',
        eventTime: getCurrentKstTimeFiveMinute(),
        transitionAction: 'missing_checkin_required',
        requireManualCheckIn: true,
        desiredSeatStatus: 'away',
      });
      return;
    }

    if (currentStatus === 'absent') {
      const ok = confirm(`현재 이 학생은 결석 상태입니다.\n\n외출로 변경하면 결석 기록은 정리되고, 외출 상태로 다시 반영됩니다.\n\n단, 입실 기록이 없으므로 이후 실제 입실 시간을 입력해야 합니다.\n\n계속 진행할까요?`);
      if (!ok) return;
      setAwayPopup({
        detail: '',
        eventTime: getCurrentKstTimeFiveMinute(),
        transitionAction: 'absent_to_manual_checkin',
        requireManualCheckIn: true,
        desiredSeatStatus: 'away',
      });
      return;
    }

    if (currentStatus === 'out') {
      const ok = confirm(`현재 이 학생은 퇴실 상태입니다.\n\n외출로 변경하면 기존 퇴실 기록은 외출 기록으로 전환됩니다.\n\n이후 외출 사유를 입력합니다.\n\n계속 진행할까요?`);
      if (!ok) return;
      setAwayPopup({
        detail: '',
        eventTime: selectedSession?.check_out_at ? toFiveMinuteInputValue(formatKstTime(selectedSession.check_out_at)) : getCurrentKstTimeFiveMinute(),
        transitionAction: 'out_to_away',
        desiredSeatStatus: 'away',
      });
      return;
    }

    setAwayPopup({
      detail: '',
      eventTime: getCurrentKstTimeFiveMinute(),
    });
  }

  async function saveAwayDetail() {
    if (!awayPopup?.detail?.trim()) {
      alert('외출 상세 사유를 입력하세요.');
      return;
    }
    if (!awayPopup.eventTime || !isFiveMinuteTime(awayPopup.eventTime)) {
      alert('외출 시작 시간은 5분 단위로 선택하세요.');
      return;
    }

    const eventTime = makeKstIso(getKstDateString(), awayPopup.eventTime || getCurrentKstTimeFiveMinute());
    await saveStatus('away', {
      attendanceMemo: awayPopup.detail.trim(),
      eventTime,
      transitionAction: awayPopup.transitionAction,
      requireManualCheckIn: awayPopup.requireManualCheckIn,
      desiredSeatStatus: awayPopup.desiredSeatStatus || 'away',
      skipTransitionCheck: true,
      allowSameStatus: awayPopup.transitionAction === 'out_to_away',
    });
    setAwayPopup(null);
  }

  function openAttendanceAdjustPopup() {
    if (!selectedSession) {
      alert('먼저 입실/출결 상태를 저장하세요.');
      return;
    }

    setAttendanceAdjustPopup({
      sessionDate: selectedSession.session_date || getKstDateString(),
      checkInTime: selectedSession.check_in_at ? toFiveMinuteInputValue(formatKstTime(selectedSession.check_in_at)) : getCurrentKstTimeFiveMinute(),
      checkOutTime: selectedSession.check_out_at ? toFiveMinuteInputValue(formatKstTime(selectedSession.check_out_at)) : '',
      awayTotalMinutes: selectedSession.away_total_minutes || 0,
      note: '',
    });
  }

  async function saveAttendanceAdjust() {
    if (!selectedSession || !attendanceAdjustPopup) return;

    if (attendanceAdjustPopup.requiredManualCheckIn && !attendanceAdjustPopup.checkInTime) {
      alert('누락된 입실 시간을 입력해야 합니다.');
      return;
    }
    if (attendanceAdjustPopup.checkInTime && !isFiveMinuteTime(attendanceAdjustPopup.checkInTime)) {
      alert('입실 시간은 5분 단위로 선택하세요.');
      return;
    }
    if (attendanceAdjustPopup.checkOutTime && !isFiveMinuteTime(attendanceAdjustPopup.checkOutTime)) {
      alert('퇴실 시간은 5분 단위로 선택하세요.');
      return;
    }

    try {
      setMessage(attendanceAdjustPopup.requiredManualCheckIn ? '누락 입실시간 저장 중...' : '출결시간 조정 중...');
      await apiFetch('/api/attendance-adjust', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: selectedSession.id,
          studentId: selectedSession.student_id,
          seatNo: selectedSession.seat_no,
          sessionDate: attendanceAdjustPopup.sessionDate,
          checkInTime: attendanceAdjustPopup.checkInTime,
          checkOutTime: attendanceAdjustPopup.checkOutTime,
          awayTotalMinutes: attendanceAdjustPopup.awayTotalMinutes,
          note: attendanceAdjustPopup.note,
          desiredSeatStatus: attendanceAdjustPopup.desiredSeatStatus || undefined,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      setAttendanceAdjustPopup(null);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      const successTitle = attendanceAdjustPopup.requiredManualCheckIn ? '입실시간 보정 완료' : '출결시간 조정 완료';
      const successMessage = attendanceAdjustPopup.requiredManualCheckIn
        ? `${form.name || '선택 학생'} 학생의 누락된 입실 시간이 저장되었습니다.`
        : `${form.name || '선택 학생'} 학생의 출결 시간이 조정되었습니다.`;
      setMessage(successTitle);
      setAttendanceActionNotice({
        type: 'success',
        title: successTitle,
        message: successMessage,
      });
    } catch (error) {
      setMessage(error.message);
      setAttendanceActionNotice({
        type: 'failed',
        title: '출결시간 조정 실패',
        message: error.message || '출결시간 조정에 실패했습니다.',
      });
    }
  }

  async function saveMentorComment() {
    if (!selectedSession) {
      alert('먼저 학생의 출결 상태를 저장하세요.');
      return;
    }

    try {
      setMessage('학습멘토 코멘트 저장 중...');
      const data = await apiFetch('/api/mentor-comment', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: selectedSession.id,
          mentorComment: form.reportMentorComment,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      setReports((prev) => {
        const others = (prev || []).filter((report) => report.session_id !== selectedSession.id);
        return [...others, data.report];
      });
      setMessage('학습멘토 코멘트 저장 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function confirmScheduleAlert(alert) {
    if (alert.mode === 'preview') {
      setDismissedAlerts((prev) => [...prev, alert.id]);
      setMessage('알림 확인 완료');
      return;
    }

    if (!alert.seatNo) {
      setMessage('해당 학생의 좌석 배정이 없어 입실확인을 처리할 수 없습니다. 좌석 배정 관리에서 좌석을 먼저 지정하세요.');
      return;
    }

    await saveStatus('occupied', {
      seatNo: alert.seatNo,
      student: {
        id: alert.student?.id,
        name: alert.student?.name,
        school: alert.student?.school,
        grade: alert.student?.grade,
        parentPhone: alert.student?.parent_phone,
        studentPhone: alert.student?.student_phone,
      },
    });

    setDismissedAlerts((prev) => [...prev, alert.id]);
  }

  function getParentAlertPayload(alert, patch = {}) {
    const plannedCheckIn = alert.schedule?.planned_check_in?.slice(0, 5) || DEFAULT_SCHEDULE_CHECK_IN;
    const plannedCheckOut = alert.schedule?.planned_check_out?.slice(0, 5) || DEFAULT_SCHEDULE_CHECK_OUT;
    const breakStart = alert.breakItem?.leave_start?.slice(0, 5);
    const breakEnd = alert.breakItem?.return_time?.slice(0, 5);
    const breakReason = [alert.breakItem?.reason, alert.breakItem?.reason_detail, alert.reason].filter(Boolean).join(' · ');
    const currentStatusText = alert.type === 'return_check'
      ? '외출 후 미복귀'
      : alert.type === 'check_in_check'
        ? '예정 시간 내 미입실'
        : alert.type === 'attendance_mismatch'
          ? alert.currentStatus === 'away'
            ? '예정 학습 시간 중 외출 상태'
            : alert.currentStatus === 'out'
              ? '예정 학습 시간 중 퇴실 상태'
              : '예정 학습 시간 중 미입실 상태'
          : '출결 상태 확인 필요';

    return {
      action: 'preview',
      studentId: alert.student?.id,
      studentName: alert.student?.name,
      student: alert.student,
      parentPhone: alert.student?.parent_phone || alert.student?.parentPhone,
      scheduleId: alert.schedule?.id,
      schedule: alert.schedule,
      breakId: alert.breakItem?.id,
      breakItem: alert.breakItem,
      alertType: alert.type,
      currentStatus: alert.currentStatus,
      currentStatusText,
      plannedCheckIn,
      plannedCheckOut,
      plannedStudyTime: `${plannedCheckIn} ~ ${plannedCheckOut}`,
      plannedBreakTime: breakStart && breakEnd ? `${breakStart} ~ ${breakEnd}${breakReason ? ` (${breakReason})` : ''}` : '없음',
      breakReason,
      reason: alert.reason,
      adminName: currentUser?.displayName || '관리자',
      ...patch,
    };
  }

  async function notifyParent(alert) {
    try {
      setMessage('학부모 확인 요청 알림톡 미리보기 생성 중...');
      const payload = getParentAlertPayload(alert);
      const data = await apiFetch('/api/parent-alert', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setParentAlertPopup({
        alert,
        payload,
        preview: data,
        messageText: data.messageText || '',
        currentStatusText: data.currentStatusText || payload.currentStatusText,
        plannedStudyTime: data.plannedStudyTime || payload.plannedStudyTime,
        plannedBreakTime: data.plannedBreakTime || payload.plannedBreakTime,
        sending: false,
      });
      setMessage('학부모 확인 요청 알림톡 미리보기를 확인하세요.');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function sendParentConfirmationAlert({ saveDraft = false } = {}) {
    if (!parentAlertPopup) return;
    try {
      setParentAlertPopup((prev) => ({ ...prev, sending: true, error: '', result: null }));
      const action = saveDraft ? 'draft' : 'send';
      const data = await apiFetch('/api/parent-alert', {
        method: 'POST',
        body: JSON.stringify(getParentAlertPayload(parentAlertPopup.alert, {
          action,
          messageText: parentAlertPopup.messageText,
          plannedStudyTime: parentAlertPopup.plannedStudyTime,
          plannedBreakTime: parentAlertPopup.plannedBreakTime,
          currentStatusText: parentAlertPopup.currentStatusText,
        })),
      });
      if (!saveDraft && data.ok !== false) {
        setDismissedAlerts((prev) => prev.includes(parentAlertPopup.alert.id) ? prev : [...prev, parentAlertPopup.alert.id]);
      }
      const resultTitle = saveDraft
        ? '초안 저장 완료'
        : data.ok === false
          ? '발송 실패'
          : '발송 요청 완료';
      const resultMessage = data.message || (saveDraft ? '학부모 확인 요청 초안을 저장했습니다.' : '학부모 확인 요청 알림톡 발송 요청이 접수되었습니다.');
      setParentAlertPopup((prev) => prev ? ({
        ...prev,
        sending: false,
        error: '',
        result: {
          ok: data.ok !== false,
          title: resultTitle,
          message: resultMessage,
          detail: `${data.mode === 'draft' ? '로그 상태: draft' : `발송 상태: ${data.status || data.sendResult?.status || 'received'}`} · 수신자 ${data.recipientCount ?? prev.preview?.recipientCount ?? 0}명`,
        },
      }) : prev);
      setMessage(resultMessage);
    } catch (error) {
      setParentAlertPopup((prev) => prev ? ({ ...prev, sending: false, error: error.message, result: { ok: false, title: '발송 실패', message: error.message, detail: '설정, 수신번호, 템플릿 상태를 확인하세요.' } }) : prev);
      setMessage(error.message);
    }
  }

  async function dismissFocusAlert(alert, memo = '') {
    if (!alert?.id) return;
    const cleanMemo = String(memo || '').trim() || '현장 확인 완료';
    const fallbackItem = {
      alert_id: alert.id,
      student_id: alert.student?.id || alert.schedule?.student_id || null,
      ack_date: getKstDateString(),
      alert_type: alert.type || 'unknown',
      alert_title: alert.title || '',
      alert_body: alert.body || '',
      memo: cleanMemo,
      admin_name: currentUser?.displayName || '관리자',
      dismissed_at: new Date().toISOString(),
    };

    setDismissedAlerts((prev) => prev.includes(alert.id) ? prev : [...prev, alert.id]);
    setDismissedAlertMemos((prev) => ({
      ...prev,
      [alert.id]: {
        memo: cleanMemo,
        dismissedAt: fallbackItem.dismissed_at,
        adminName: fallbackItem.admin_name,
        title: alert.title || '',
      },
    }));

    try {
      const data = await apiFetch('/api/field-focus-acknowledgement', {
        method: 'POST',
        body: JSON.stringify({
          alertId: alert.id,
          alertType: alert.type || 'unknown',
          alertTitle: alert.title || '',
          alertBody: alert.body || '',
          studentId: alert.student?.id || alert.schedule?.student_id || null,
          studentName: alert.student?.name || '',
          seatNo: alert.seatNo || null,
          scheduleDate: alert.schedule?.schedule_date || getKstDateString(),
          plannedTime: alert.plannedTime || null,
          currentStatus: alert.currentStatus || null,
          memo: cleanMemo,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      const saved = data?.acknowledgement || fallbackItem;
      setFieldFocusAcknowledgements((prev) => {
        const next = [saved, ...prev.filter((item) => item.alert_id !== alert.id)];
        return next.slice(0, 100);
      });
      setMessage(`집중관리대상 해제: ${alert.student?.name || '학생'} · ${cleanMemo}`);
      await loadDashboard({ silent: true, runAutoCheckout: false, suppressChangeNotice: true });
    } catch (error) {
      setMessage(`집중관리대상 해제는 현재 화면에만 반영되었습니다. Supabase SQL 적용 여부를 확인하세요: ${error.message}`);
    }
  }

  async function saveCheck() {
    if (!selectedSeatNo || !selectedSession) return alert('먼저 학생 정보와 출결 상태를 저장하세요.');

    try {
      setMessage('순찰 체크 저장 중...');
      await apiFetch('/api/check', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: selectedSession.id,
          studentId: selectedSession.student_id,
          seatNo: selectedSeatNo,
          studyStatus: form.studyStatus,
          subject: form.subject,
          studyContent: form.studyContent,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      setForm((prev) => ({ ...prev, studyContent: '' }));
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage('순찰 체크 저장 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  function startEditStudyCheck(check) {
    if (!check?.id) return;
    setStudyCheckEditor({
      id: check.id,
      sessionId: check.session_id || selectedSession?.id || '',
      studentId: check.student_id || selectedSession?.student_id || '',
      seatNo: check.seat_no || selectedSeatNo || '',
      checkedDate: selectedSession?.session_date || getKstDateString(),
      checkedTime: formatKstTime(check.checked_at) !== '-' ? formatKstTime(check.checked_at) : getCurrentKstTime(),
      subject: check.subject || '수학',
      studyStatus: check.study_status || '문제풀이',
      studyContent: check.study_content || '',
    });
  }

  function cancelEditStudyCheck() {
    setStudyCheckEditor(null);
  }

  async function saveStudyCheckEdit() {
    if (!studyCheckEditor?.id) return;
    if (!studyCheckEditor.subject || !studyCheckEditor.studyStatus) {
      alert('과목과 학습상태를 선택하세요.');
      return;
    }

    try {
      setStudyCheckEditSaving(true);
      setMessage('순찰 기록 수정 중...');
      await apiFetch('/api/check', {
        method: 'PUT',
        body: JSON.stringify({
          checkId: studyCheckEditor.id,
          checkedDate: studyCheckEditor.checkedDate || selectedSession?.session_date || getKstDateString(),
          checkedTime: studyCheckEditor.checkedTime,
          subject: studyCheckEditor.subject,
          studyStatus: studyCheckEditor.studyStatus,
          studyContent: studyCheckEditor.studyContent,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      setStudyCheckEditor(null);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage('순찰 기록 수정 완료');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setStudyCheckEditSaving(false);
    }
  }

  async function copyPlannerImageLink() {
    if (!form.reportPlannerImageUrl) return alert('복사할 플래너 이미지 링크가 없습니다.');
    try {
      await navigator.clipboard.writeText(form.reportPlannerImageUrl);
      setMessage('플래너 이미지 링크 복사 완료');
    } catch {
      setMessage('자동 복사에 실패했습니다. 이미지 링크를 직접 열어 복사하세요.');
    }
  }

  async function reportSendAction(action, sessionId = selectedSession?.id) {
    if (!sessionId) {
      alert('먼저 학생을 선택하세요.');
      return { ok: false, error: '먼저 학생을 선택하세요.' };
    }

    try {
      setMessage(action === 'preview' ? '최신 리포트 취합 후 미리보기 생성 중...' : action === 'send' ? '최신 리포트 취합 후 카카오 발송 요청 중...' : '최신 리포트 취합 후 발송대기 저장 중...');

      // v36: 리포트는 발송/미리보기 시점에 최신 데이터로 자동 생성·갱신합니다.
      await generateReport(sessionId);

      const data = await apiFetch('/api/report-send', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          action,
          adminName: currentUser?.displayName || '관리자',
        }),
      });

      if (data.report) {
        setReports((prev) => {
          const others = (prev || []).filter((report) => report.session_id !== data.report.session_id);
          return [...others, data.report];
        });
      }

      if (action === 'preview') {
        setSendPreview(data);
        setMessage('발송 미리보기 생성 완료');
      } else if (action === 'manual_sent') {
        setSendPreview(null);
        const notice = { type: 'success', title: '수동 발송완료 처리', message: data.message || '수동 발송완료 처리 완료' };
        setSendActionNotice(notice);
        setMessage(notice.message);
      } else {
        setSendPreview(data);
        const sendStatus = data.report?.send_status || data.status || data.providerResult?.status;
        const noticeType = sendStatus === 'sent' ? 'success' : sendStatus === 'failed' ? 'failed' : 'neutral';
        const noticeTitle = action === 'send'
          ? (sendStatus === 'sent' ? '카카오 발송 완료' : sendStatus === 'failed' ? '카카오 발송 실패' : '발송대기 저장')
          : '발송대기 저장';
        const notice = {
          type: noticeType,
          title: noticeTitle,
          message: data.message || '발송 상태 저장 완료',
        };
        setSendActionNotice(notice);
        setMessage(notice.message);
      }

      return data;
    } catch (error) {
      const notice = { type: 'failed', title: '발송 처리 실패', message: error.message || '알 수 없는 오류가 발생했습니다.' };
      setSendActionNotice(notice);
      setMessage(notice.message);
      return { ok: false, error: notice.message };
    }
  }

  async function openSendPreview(sessionId = selectedSession?.id) {
    return reportSendAction('preview', sessionId);
  }

  async function prepareReportSend(sessionId = selectedSession?.id) {
    return reportSendAction('prepare', sessionId);
  }

  async function sendReportToParent(sessionId = selectedSession?.id) {
    return reportSendAction('send', sessionId);
  }

  async function markReportManualSent(sessionId = selectedSession?.id) {
    return reportSendAction('manual_sent', sessionId);
  }

  async function copyDailyReportText() {
    if (!form.reportText?.trim()) return alert('복사할 데일리 보고서 문구가 없습니다.');
    try {
      await navigator.clipboard.writeText(form.reportText);
      setMessage('데일리 보고서 문구 복사 완료');
    } catch {
      setMessage('자동 복사에 실패했습니다. 보고서 내용을 직접 선택해 복사하세요.');
    }
  }

  async function generateReport(sessionId = selectedSession?.id) {
    if (!sessionId) return alert('먼저 학생 정보와 출결 상태를 저장하세요.');

    try {
      setMessage('보고서 생성 중...');
      const data = await apiFetch('/api/report', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          mentorComment: sessionId === selectedSession?.id ? form.reportMentorComment : undefined,
          adminName: currentUser?.displayName || '관리자',
        }),
      });

      if (sessionId === selectedSession?.id) {
        setForm((prev) => ({
          ...prev,
          reportText: data.reportText || '',
          reportPlannerImageUrl: data.plannerImageUrl || '',
          reportPlannerFileName: data.plannerFileName || '',
        }));
      }
      if (data.report) {
        setReports((prev) => {
          const others = (prev || []).filter((report) => report.session_id !== data.report.session_id);
          return [...others, data.report];
        });
      }
      setMessage('보고서 생성 완료');
      return data.reportText;
    } catch (error) {
      setMessage(error.message);
    }
  }


  async function generateAllReports() {
    if (!reportReadySessions.length) {
      alert('리포트 생성 대상 학생이 없습니다.');
      return;
    }

    try {
      setMessage('전체 리포트 생성 중...');
      const newReports = [];

      for (const session of reportReadySessions) {
        const data = await apiFetch('/api/report', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: session.id,
            adminName: currentUser?.displayName || '관리자',
          }),
        });
        if (data.report) newReports.push(data.report);
      }

      if (newReports.length) {
        setReports((prev) => {
          const newIds = new Set(newReports.map((report) => report.session_id));
          const others = (prev || []).filter((report) => !newIds.has(report.session_id));
          return [...others, ...newReports];
        });
      }

      setMessage(`전체 리포트 생성 완료: ${newReports.length}건`);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadRanking(start = rankingStart, end = rankingEnd) {
    try {
      setMessage('랭킹 조회 중...');
      const data = await apiFetch(`/api/ranking?start=${start}&end=${end}`);
      setRanking(data.ranking || []);
      setMessage('랭킹 조회 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function loadAttendanceHistory(start = attendanceStart, end = attendanceEnd, studentId = attendanceStudentFilter) {
    if (!studentId) {
      setAttendanceRows([]);
      setMessage('출결 현황은 학생을 선택한 뒤 조회할 수 있습니다.');
      return;
    }

    try {
      setAttendanceLoading(true);
      setMessage('출결 현황 조회 중...');
      const params = new URLSearchParams({ start, end, studentId });
      const data = await apiFetch(`/api/attendance-history?${params.toString()}`);
      setAttendanceRows(data.rows || []);
      setMessage('출결 현황 조회 완료');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAttendanceLoading(false);
    }
  }

  async function saveAttendanceMentorComment(sessionId, mentorComment) {
    if (!sessionId) return false;

    try {
      setMessage('학습멘토 코멘트 저장 중...');
      const data = await apiFetch('/api/attendance-history', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          mentorComment,
          adminName: currentUser?.displayName || '관리자',
        }),
      });

      setAttendanceRows((prev) => (prev || []).map((row) => (
        row.id === sessionId ? { ...row, mentorComment: data.report?.mentor_comment || mentorComment || '' } : row
      )));

      if (data.report) {
        setReports((prev) => {
          const others = (prev || []).filter((report) => report.session_id !== data.report.session_id);
          return [...others, data.report];
        });
      }

      setMessage('학습멘토 코멘트 저장 완료');
      return true;
    } catch (error) {
      setMessage(error.message);
      return false;
    }
  }

  function setAttendancePreset(type) {
    const today = getKstDateString();
    if (type === 'today') {
      setAttendanceStart(today);
      setAttendanceEnd(today);
      if (attendanceStudentFilter) loadAttendanceHistory(today, today, attendanceStudentFilter);
      return;
    }
    if (type === 'week') {
      const range = getThisWeekRange();
      setAttendanceStart(range.start);
      setAttendanceEnd(range.end);
      if (attendanceStudentFilter) loadAttendanceHistory(range.start, range.end, attendanceStudentFilter);
      return;
    }
    if (type === 'month') {
      const firstDay = today.slice(0, 8) + '01';
      setAttendanceStart(firstDay);
      setAttendanceEnd(today);
      if (attendanceStudentFilter) loadAttendanceHistory(firstDay, today, attendanceStudentFilter);
    }
  }

  function openStudentCareFromMentoring(studentOrId, mentoringContext = null) {
    const rawStudentId = typeof studentOrId === 'object' ? (studentOrId?.id || studentOrId?.student_id || studentOrId?.students?.id) : studentOrId;
    if (!rawStudentId) return;
    const studentId = String(rawStudentId);
    const today = getKstDateString();
    const oneWeekRange = { start: addDays(today, -6), end: today };
    const nextContext = mentoringContext
      ? { ...mentoringContext, source: 'mentoring', studentId }
      : null;
    setActiveTab('studentHistory');
    setAttendanceStudentFilter(studentId);
    setAttendanceStatusFilter('all');
    setAttendanceSummaryCollapsed(false);
    setAttendanceStart(oneWeekRange.start);
    setAttendanceEnd(oneWeekRange.end);
    setStudentHistoryFocusStudentId(studentId);
    setStudentCareMentoringContext(nextContext);
    setMentorCommentFocusRequest({ studentId, nonce: Date.now(), source: 'mentoring' });
    setMessage('멘토링 시간표에서 선택한 학생의 통합 출결·관리 이력으로 이동했습니다. 기본 조회기간은 최근 1주로 설정했습니다.');
    loadAttendanceHistory(oneWeekRange.start, oneWeekRange.end, studentId);
  }

  function returnToMentoringScheduleFromCare() {
    setActiveTab('mentoring');
    setMessage('멘토링 시간표로 돌아왔습니다. 다음 학생을 선택해 코멘트를 이어서 입력하세요.');
  }

  function navigateMentoringCareStudent(studentId, nextContext = null) {
    if (!studentId) return;
    openStudentCareFromMentoring(
      { id: studentId },
      nextContext || (studentCareMentoringContext ? { ...studentCareMentoringContext, studentId } : null)
    );
  }

  function setRankingPreset(type) {
    const today = getKstDateString();
    if (type === 'today') {
      setRankingStart(today);
      setRankingEnd(today);
      loadRanking(today, today);
      return;
    }
    if (type === 'week') {
      const range = getThisWeekRange();
      setRankingStart(range.start);
      setRankingEnd(range.end);
      loadRanking(range.start, range.end);
      return;
    }
    if (type === 'month') {
      const firstDay = today.slice(0, 8) + '01';
      setRankingStart(firstDay);
      setRankingEnd(today);
      loadRanking(firstDay, today);
    }
  }

  function openScheduleForm(schedule = null) {
    if (!schedule) {
      // 새 시간표의 기본 등하원은 기준 날짜의 요일 유형(평일/토/일/공휴일) 시간표를 따릅니다.
      const baseDateDefaults = resolveScheduleForDate(defaultScheduleConfig, scheduleBaseDate);
      setScheduleForm({
        studentId: scheduleStudentFilter !== 'all' ? scheduleStudentFilter : (students[0]?.id || ''),
        scheduleDate: scheduleBaseDate,
        plannedCheckIn: baseDateDefaults.plannedCheckIn,
        plannedCheckOut: baseDateDefaults.plannedCheckOut,
        parentConfirmed: true,
        confirmationNote: '',
        scheduleNote: '',
        breaks: [],
      });
      return;
    }

    setScheduleForm({
      studentId: schedule.student_id,
      scheduleDate: schedule.schedule_date,
      plannedCheckIn: schedule.planned_check_in?.slice(0, 5) || '',
      plannedCheckOut: schedule.planned_check_out?.slice(0, 5) || '',
      parentConfirmed: Boolean(schedule.parent_confirmed),
      confirmationNote: schedule.confirmation_note || '',
      scheduleNote: schedule.schedule_note || '',
      breaks: (scheduleBreaksBySchedule[schedule.id] || []).map((item) => ({
        leaveStart: item.leave_start?.slice(0, 5) || '',
        returnTime: item.return_time?.slice(0, 5) || '',
        reason: item.reason || '기타',
        reasonDetail: item.reason_detail || '',
        breakNote: item.break_note || '',
      })),
    });
  }

  function updateBreak(index, key, value) {
    setScheduleForm((prev) => ({
      ...prev,
      breaks: prev.breaks.map((item, i) => i === index ? { ...item, [key]: value } : item),
    }));
  }

  function addBreak() {
    setScheduleForm((prev) => ({
      ...prev,
      breaks: [...prev.breaks, { leaveStart: '', returnTime: '', reason: '기타', reasonDetail: '', breakNote: '' }],
    }));
  }

  function removeBreak(index) {
    setScheduleForm((prev) => ({
      ...prev,
      breaks: prev.breaks.filter((_, i) => i !== index),
    }));
  }

  function formatMentoringScheduleConflictMessage(conflicts = []) {
    const lines = (conflicts || []).slice(0, 5).map((conflict, index) => [
      `${index + 1}. ${conflict.studentName || '학생'} · ${conflict.date || ''} ${conflict.dayLabel || ''} ${conflict.slotLabel || ''}`.trim(),
      `   멘토링: ${conflict.slotTime || '-'}`,
      `   개인일정: ${conflict.plannedRange || '-'}`,
      `   사유: ${conflict.reason || '멘토링 시간과 개인 일정이 맞지 않습니다.'}`,
    ].join('\n'));
    const more = conflicts.length > 5 ? `\n외 ${conflicts.length - 5}건 추가` : '';
    return `${lines.join('\n\n')}${more}`;
  }

  async function confirmMentoringConflictsBeforeScheduleSave(payload) {
    if (!payload?.studentId || !payload?.scheduleDate) return true;
    try {
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action: 'validatePersonalScheduleConflicts',
          studentId: payload.studentId,
          scheduleDate: payload.scheduleDate,
          plannedCheckIn: payload.plannedCheckIn,
          plannedCheckOut: payload.plannedCheckOut,
          scheduleNote: payload.scheduleNote,
          breaks: payload.breaks || [],
        }),
      });
      const conflicts = data.result?.conflicts || data.conflicts || [];
      if (!conflicts.length) return true;
      return window.confirm(`수정하려는 개인 일정이 이미 배정된 멘토링 일정과 맞지 않습니다.\n\n${formatMentoringScheduleConflictMessage(conflicts)}\n\n그래도 개인일정을 저장하시겠습니까?`);
    } catch (error) {
      return window.confirm(`멘토링 일정 충돌 검증에 실패했습니다.\n${error.message || ''}\n\n그래도 개인일정을 저장하시겠습니까?`);
    }
  }

  async function saveSchedule() {
    if (!scheduleForm.studentId) return alert('학생을 선택하세요.');
    if (!scheduleForm.scheduleDate) return alert('날짜를 선택하세요.');

    const validationErrors = validateSchedulePayload(scheduleForm);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      return;
    }

    const canSaveAfterMentoringCheck = await confirmMentoringConflictsBeforeScheduleSave(scheduleForm);
    if (!canSaveAfterMentoringCheck) {
      setMessage('개인일정 저장을 취소했습니다. 멘토링 시간표 또는 개인일정을 조정해 주세요.');
      return;
    }

    try {
      setMessage('시간표 저장 중...');
      await apiFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(scheduleForm),
      });
      await loadSchedules();
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage('시간표 저장 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openQuickSchedulePopup(payload) {
    setScheduleQuickPopup({
      date: payload.date,
      time: payload.time,
      studentId: scheduleStudentFilter !== 'all' ? scheduleStudentFilter : '',
      type: 'break',
      returnTime: minutesToTime(timeToMinutes(payload.time) + 40),
      reason: '기타',
      reasonDetail: '',
      note: '',
    });
  }

  function applyQuickSchedulePopup() {
    if (!scheduleQuickPopup?.studentId) {
      alert('학생을 선택하세요.');
      return;
    }

    const clickedTime = scheduleQuickPopup.time || '09:00';

    setScheduleForm((prev) => {
      const base = {
        ...prev,
        studentId: scheduleQuickPopup.studentId,
        scheduleDate: scheduleQuickPopup.date,
        parentConfirmed: true,
      };

      if (scheduleQuickPopup.type === 'checkin') {
        return {
          ...base,
          plannedCheckIn: clickedTime,
        };
      }

      if (scheduleQuickPopup.type === 'checkout') {
        return {
          ...base,
          plannedCheckOut: clickedTime,
        };
      }

      return {
        ...base,
        breaks: [
          ...(base.breaks || []),
          {
            leaveStart: clickedTime,
            returnTime: scheduleQuickPopup.returnTime || minutesToTime(timeToMinutes(clickedTime) + 40),
            reason: scheduleQuickPopup.reason || '기타',
            reasonDetail: scheduleQuickPopup.reasonDetail || '',
            breakNote: scheduleQuickPopup.note || '',
          },
        ],
      };
    });

    setScheduleBaseDate(scheduleQuickPopup.date);
    if (scheduleQuickPopup.studentId) setScheduleStudentFilter(scheduleQuickPopup.studentId);
    setScheduleQuickPopup(null);

    window.setTimeout(() => {
      const el = document.getElementById('schedule-editor-anchor');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  function updateActivityPopupBreak(index, key, value) {
    setActivityPopup((prev) => ({
      ...prev,
      breaks: (prev.breaks || []).map((item, i) => i === index ? { ...item, [key]: value } : item),
    }));
  }

  function addActivityPopupBreak() {
    setActivityPopup((prev) => ({
      ...prev,
      breaks: [
        ...(prev.breaks || []),
        { leaveStart: '', returnTime: '', reason: '기타', reasonDetail: '', breakNote: '' },
      ],
    }));
  }

  function removeActivityPopupBreak(index) {
    setActivityPopup((prev) => ({
      ...prev,
      breaks: (prev.breaks || []).filter((_, i) => i !== index),
    }));
  }

  async function saveActivityPopup() {
    if (!activityPopup?.studentId) return alert('학생 정보가 없습니다.');

    const payload = {
      studentId: activityPopup.studentId,
      scheduleDate: activityPopup.scheduleDate,
      plannedCheckIn: activityPopup.plannedCheckIn,
      plannedCheckOut: activityPopup.plannedCheckOut,
      parentConfirmed: activityPopup.parentConfirmed,
      confirmationNote: activityPopup.confirmationNote,
      scheduleNote: activityPopup.scheduleNote,
      breaks: activityPopup.breaks || [],
      commuteRepeat: activityPopup.commuteRepeat || 'none',
      commuteRepeatUntil: activityPopup.commuteRepeatUntil || activityPopup.scheduleDate,
      breakRepeat: activityPopup.breakRepeat || 'none',
      breakRepeatUntil: activityPopup.breakRepeatUntil || activityPopup.scheduleDate,
    };

    const validationErrors = validateSchedulePayload(payload);
    if (validationErrors.length) {
      alert(validationErrors.join('\n'));
      return;
    }

    const canSaveAfterMentoringCheck = await confirmMentoringConflictsBeforeScheduleSave(payload);
    if (!canSaveAfterMentoringCheck) {
      setMessage('액티비티 시간표 저장을 취소했습니다. 멘토링 시간표 또는 개인일정을 조정해 주세요.');
      return;
    }

    try {
      setMessage('액티비티 시간표 저장 중...');
      await apiFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setActivityPopup(null);
      await loadSchedules();
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage('액티비티 시간표 저장 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteActivitySchedule() {
    if (!activityPopup?.studentId || !activityPopup?.scheduleDate) return alert('학생/날짜 정보가 없습니다.');
    const repeat = activityPopup.deleteRepeat || 'none';
    const repeatUntil = activityPopup.deleteRepeatUntil || activityPopup.scheduleDate;
    const repeatLabel = (REPEAT_OPTIONS.find(([value]) => value === repeat) || [])[1] || '반복 없음';
    const rangeText = repeat === 'none'
      ? `${activityPopup.scheduleDate} 개인 시간표를 삭제할까요?`
      : `${activityPopup.scheduleDate}부터 ${repeatUntil}까지 (${repeatLabel}) 개인 시간표를 반복 삭제할까요?`;
    const confirmed = window.confirm(
      `${activityPopup.studentName || '학생'} · ${rangeText}\n\n삭제된 날짜는 빈 날(등원 예정 없음)이 되고, 결석/지각 판정 대상에서 제외됩니다.\n외출 일정도 함께 삭제됩니다.`
    );
    if (!confirmed) return;

    try {
      setMessage('개인 시간표 삭제 중...');
      const data = await apiFetch('/api/schedules', {
        method: 'DELETE',
        body: JSON.stringify({
          studentId: activityPopup.studentId,
          scheduleDate: activityPopup.scheduleDate,
          repeat,
          repeatUntil,
          studentName: activityPopup.studentName,
        }),
      });
      setActivityPopup(null);
      await loadSchedules();
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage(data.deleted
        ? `개인 시간표 ${data.deletedCount || 1}건 삭제 완료 (빈 날로 처리)`
        : (data.message || '삭제할 개인 시간표가 없습니다.'));
    } catch (error) {
      setMessage(error.message);
    }
  }

  // 학생 한 명의 개인 시간표를 기간 단위로 삭제합니다. (mode: 'from' = fromDate 이후, 'all' = 전체)
  async function deleteStudentSchedulesRange({ student, mode, fromDate }) {
    if (!student?.id) return alert('학생을 먼저 선택하세요.');
    const rangeLabel = mode === 'all' ? '전체 기간' : `${fromDate} 이후`;
    const confirmed = window.confirm(
      `${student.name} 학생의 개인 시간표를 ${rangeLabel} 모두 삭제할까요?\n\n삭제된 날짜는 빈 날(등원 예정 없음)이 되어 결석/지각 판정에서 제외되며, 되돌릴 수 없습니다.\n외출 일정도 함께 삭제됩니다.`
    );
    if (!confirmed) return;

    try {
      setMessage('개인 시간표 일괄 삭제 중...');
      const data = await apiFetch('/api/schedules', {
        method: 'DELETE',
        body: JSON.stringify({ studentId: student.id, mode, fromDate, studentName: student.name }),
      });
      await loadSchedules();
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      setMessage(data.deleted
        ? `${student.name}: 개인 시간표 ${data.deletedCount}건 삭제 완료 (${rangeLabel})`
        : (data.message || '삭제할 개인 시간표가 없습니다.'));
    } catch (error) {
      setMessage(error.message);
    }
  }

  function openStudentEditor(student = null) {
    if (student) {
      setStudentEditor({
        id: student.id,
        name: student.name || '',
        school: student.school || '',
        grade: student.grade || '',
        parentPhone: getPrimaryGuardianPhone(student),
        studentPhone: student.student_phone || '',
        status: student.status || 'active',
        seatNo: student.default_seat_no || '',
        guardians: normalizeGuardiansForEditor(student),
      });
      return;
    }

    setStudentEditor({
      id: null,
      name: '',
      school: '',
      grade: '',
      parentPhone: '',
      studentPhone: '',
      status: 'active',
      seatNo: '',
      guardians: normalizeGuardiansForEditor({}),
    });
  }

  async function saveStudentEditor() {
    if (!studentEditor?.name?.trim()) {
      alert('학생명을 입력하세요.');
      return;
    }

    try {
      setMessage('학생 정보 저장 중...');
      const primaryGuardian = normalizeGuardiansForEditor(studentEditor).find((guardian) => guardian.isPrimary && guardian.phone) || normalizeGuardiansForEditor(studentEditor).find((guardian) => guardian.phone);
      await apiFetch('/api/students', {
        method: 'POST',
        body: JSON.stringify({
          ...studentEditor,
          parentPhone: primaryGuardian?.phone || studentEditor.parentPhone || '',
          guardians: normalizeGuardiansForEditor(studentEditor),
        }),
      });
      setStudentEditor(null);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      await loadSettingsStudents();
      setMessage('학생 정보 저장 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deactivateStudentEditor() {
    if (!studentEditor?.id) return;
    const ok = confirm(`${studentEditor.name || '학생'} 학생을 비활성화할까요?\n\n- 현재 좌석 배정이 해제됩니다.\n- 데일리/위클리 운영 대상에서 제외됩니다.\n- 과거 출결/리포트/시간표 기록은 삭제되지 않습니다.\n- 나중에 다시 활성화할 수 있습니다.`);
    if (!ok) return;

    try {
      setMessage('학생 비활성화 처리 중...');
      await apiFetch('/api/students', {
        method: 'DELETE',
        body: JSON.stringify({ id: studentEditor.id, mode: 'deactivate' }),
      });
      setStudentEditor(null);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      await loadSettingsStudents();
      setMessage('학생 비활성화 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteStudentEditor() {
    if (!studentEditor?.id) return;
    if (studentEditor.status !== 'inactive') {
      alert('완전 삭제는 비활성 학생에게만 사용할 수 있습니다. 먼저 비활성화한 뒤 다시 시도하세요.');
      return;
    }
    const ok = confirm(`${studentEditor.name || '학생'} 학생 DB를 완전히 삭제할까요?\n\n완전 삭제는 잘못 입력한 학생 DB를 정리할 때만 사용하세요. 출결/리포트/시간표 기록과 연결되어 있으면 삭제가 실패할 수 있습니다.`);
    if (!ok) return;
    const ok2 = confirm('완전 삭제는 되돌릴 수 없습니다. 정말 삭제할까요?');
    if (!ok2) return;

    try {
      setMessage('학생 DB 삭제 중...');
      await apiFetch('/api/students', {
        method: 'DELETE',
        body: JSON.stringify({ id: studentEditor.id, mode: 'delete' }),
      });
      setStudentEditor(null);
      await loadDashboard({ silent: true, suppressChangeNotice: true });
      await loadSettingsStudents();
      setMessage('학생 DB 삭제 완료');
    } catch (error) {
      setMessage(error.message);
    }
  }

  // 오늘 시간표를 배지(chip) 목록으로 요약합니다.
  // - 기본 시간표와 부합하는 연속 차시는 하나의 파란색(match) 배지로 병합
  // - 외출은 별도 배지(break) + 다른 색
  // - 기본 등하원보다 늦게 오거나 일찍 가는 편차 구간은 별도 배지(adjusted) + 다른 색
  function getTodayScheduleSummary(studentId) {
    if (!studentId) return [{ label: '배정된 학생이 없습니다.', kind: 'info' }];
    const schedule = (todaySchedules || []).find((item) => item.student_id === studentId);
    if (!schedule) {
      return [{ label: '오늘은 개인 시간표가 없습니다. (등원 예정 없음 · 학생 시간표 탭에서 추가)', kind: 'info' }];
    }

    const scheduleDefaults = normalizeDefaultScheduleSettings(defaultSchedule);
    const start = schedule?.planned_check_in?.slice(0, 5) || scheduleDefaults.plannedCheckIn;
    const end = schedule?.planned_check_out?.slice(0, 5) || scheduleDefaults.plannedCheckOut;
    const startMin = timeToMinutes(start);
    const endMin = timeToMinutes(end);
    const baseInMin = timeToMinutes(scheduleDefaults.plannedCheckIn);
    const baseOutMin = timeToMinutes(scheduleDefaults.plannedCheckOut);

    const rawBreaks = (todayScheduleBreaks || [])
      .filter((item) => item.schedule_id === schedule.id);

    const segments = getDefaultScheduleSegmentsExcludingBreaks(start, end, rawBreaks, defaultSchedule)
      .map((seg) => ({ startMinute: seg.startMinute, endMinute: seg.endMinute, label: seg.label, kind: 'seg' }));

    const breakItems = rawBreaks
      .map((item) => ({
        startMinute: timeToMinutes(item.leave_start),
        endMinute: timeToMinutes(item.return_time),
        reason: [item.reason, item.reason_detail].filter(Boolean).join(' · '),
        kind: 'break',
      }))
      .filter((item) => item.startMinute !== null && item.endMinute !== null && item.endMinute > item.startMinute);

    // 부재(늦은 등원/이른 하원) 사유: 일정 메모(schedule_note)를 사용
    const absenceReason = String(schedule.schedule_note || '').trim();
    const absenceLabel = absenceReason ? `부재_${absenceReason}` : '부재';

    // 학습 세그먼트 + 외출을 시간순으로 병합. 외출을 만나면 그 전까지의 연속 차시를 한 배지로 flush.
    const events = [...segments, ...breakItems]
      .sort((a, b) => a.startMinute - b.startMinute || (a.kind === 'break' ? 1 : -1));

    const chips = [];
    let run = [];
    const flushRun = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      const label = run.length === 1
        ? `${minutesToTime(first.startMinute)}~${minutesToTime(first.endMinute)} ${first.label}`
        : `${minutesToTime(first.startMinute)} ${first.label} ~ ${minutesToTime(last.endMinute)} ${last.label}`;
      chips.push({ label, kind: 'match' });
      run = [];
    };
    for (const ev of events) {
      if (ev.kind === 'break') {
        flushRun();
        const breakLabel = ev.reason ? `외출_${ev.reason}` : '외출';
        chips.push({ label: `${minutesToTime(ev.startMinute)}~${minutesToTime(ev.endMinute)} ${breakLabel}`, kind: 'deviation' });
      } else {
        run.push(ev);
      }
    }
    flushRun();

    // 기본 등원보다 늦게 옴 / 기본 하원보다 일찍 감 → '부재' 구간 배지
    if (startMin !== null && baseInMin !== null && startMin > baseInMin) {
      chips.unshift({ label: `${minutesToTime(baseInMin)}~${minutesToTime(startMin)} ${absenceLabel}`, kind: 'deviation' });
    }
    if (endMin !== null && baseOutMin !== null && endMin < baseOutMin) {
      chips.push({ label: `${minutesToTime(endMin)}~${minutesToTime(baseOutMin)} ${absenceLabel}`, kind: 'deviation' });
    }

    if (!chips.length) return [{ label: `${start}~${end} 등원 예정`, kind: 'match' }];
    return chips;
  }

  if (!isLoggedIn) {
    return (
      <main className="login account-login">
        <div className="login-card account-login-card">
          <h1>Beyond OS</h1>
          <p>개인 계정으로 로그인하거나, 비상용 관리자 비밀번호로 접속합니다.</p>

          <div className="login-mode-tabs four">
            <button className={loginMode === 'account' ? 'active' : ''} onClick={() => setLoginMode('account')}>개인 계정 로그인</button>
            <button className={loginMode === 'login' ? 'active' : ''} onClick={() => setLoginMode('login')}>관리자 비밀번호</button>
            <button className={loginMode === 'signup' ? 'active' : ''} onClick={() => setLoginMode('signup')}>계정 생성 신청</button>
            <button className={loginMode === 'reset' ? 'active' : ''} onClick={() => setLoginMode('reset')}>비번 찾기</button>
          </div>

          {loginMode === 'account' ? (
            <div className="login-panel">
              <label className="login-label">아이디</label>
              <input
                value={accountLoginForm.username}
                onChange={(e) => setAccountLoginForm({ ...accountLoginForm, username: e.target.value })}
                placeholder="예: teacher01"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAccountLogin();
                }}
              />
              <label className="login-label">비밀번호</label>
              <input
                type="password"
                value={accountLoginForm.password}
                onChange={(e) => setAccountLoginForm({ ...accountLoginForm, password: e.target.value })}
                placeholder="비밀번호"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAccountLogin();
                }}
              />
              <button onClick={handleAccountLogin}>개인 계정으로 로그인</button>
              {loginError ? <div className="error">{loginError}</div> : null}
              <div className="hint">승인된 계정 중 비밀번호가 설정된 유저만 접속할 수 있습니다.</div>
            </div>
          ) : null}

          {loginMode === 'login' ? (
            <div className="login-panel">
              <label className="login-label">관리자 비밀번호</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="ADMIN_PASSWORD"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLogin();
                }}
              />
              <button onClick={handleLogin}>비상용 관리자 접속</button>
              {loginError ? <div className="error">{loginError}</div> : null}
              <div className="hint">개인 계정 전환 안정화 전까지 Vercel 환경변수 ADMIN_PASSWORD 접속을 유지합니다.</div>
            </div>
          ) : null}

          {loginMode === 'reset' ? (
            <div className="signup-panel">
              <div className="signup-notice">
                <strong>비밀번호 재설정 요청</strong>
                <span>이메일 자동 발송은 아직 연결되지 않았습니다. 요청 후 총괄관리자가 임시 비밀번호를 설정해 안내합니다.</span>
              </div>
              <div className="signup-grid">
                <div className="field full">
                  <label>아이디 또는 이메일</label>
                  <input value={resetForm.identifier} onChange={(e) => setResetForm({ ...resetForm, identifier: e.target.value })} placeholder="예: teacher01 또는 이메일" />
                </div>
                <div className="field full">
                  <label>요청 메모</label>
                  <input value={resetForm.memo} onChange={(e) => setResetForm({ ...resetForm, memo: e.target.value })} placeholder="예: 비밀번호를 잊어버렸습니다." />
                </div>
              </div>
              <button onClick={submitPasswordResetRequest} disabled={resetLoading}>{resetLoading ? '요청 중...' : '비밀번호 재설정 요청'}</button>
              {resetStatus ? <div className={resetStatus.type === 'success' ? 'success signup-status' : 'error signup-status'}>{resetStatus.message}</div> : null}
              <div className="hint">요청 내역은 설정 &gt; 유저 관리에서 확인할 수 있습니다.</div>
            </div>
          ) : null}

          {loginMode === 'signup' ? (
            <div className="signup-panel">
              <div className="signup-notice">
                <strong>계정 생성 신청</strong>
                <span>신청 후 관리자 승인 전까지는 프로그램에 접속할 수 없습니다. 비밀번호 설정은 개인 로그인 전환 단계에서 진행됩니다.</span>
              </div>

              <div className="signup-grid">
                <div className="field">
                  <label>이름</label>
                  <input value={signupForm.displayName} onChange={(e) => setSignupForm({ ...signupForm, displayName: e.target.value })} placeholder="예: 김OO 선생님" />
                </div>
                <div className="field">
                  <label>희망 아이디</label>
                  <input value={signupForm.username} onChange={(e) => setSignupForm({ ...signupForm, username: e.target.value })} placeholder="예: teacher01" />
                </div>
                <div className="field">
                  <label>이메일</label>
                  <input type="email" value={signupForm.email} onChange={(e) => setSignupForm({ ...signupForm, email: e.target.value })} placeholder="승인/비밀번호 설정 안내용" />
                </div>
                <div className="field">
                  <label>휴대폰번호</label>
                  <input value={signupForm.phone} onChange={(e) => setSignupForm({ ...signupForm, phone: e.target.value })} placeholder="010-0000-0000" />
                </div>
                <div className="field full">
                  <label>담당/메모</label>
                  <input value={signupForm.memo} onChange={(e) => setSignupForm({ ...signupForm, memo: e.target.value })} placeholder="예: 중등부 담당 / 데일리 리포트 발송 담당" />
                </div>
              </div>

              <div className="signup-agreement-box">
                <label>
                  <input type="checkbox" checked={signupForm.privacyAgreed} onChange={(e) => setSignupForm({ ...signupForm, privacyAgreed: e.target.checked })} />
                  <span>개인정보 수집·이용에 동의합니다. 이름, 아이디, 이메일, 휴대폰번호는 계정 승인 및 프로그램 접속 관리를 위해 사용됩니다.</span>
                </label>
                <label>
                  <input type="checkbox" checked={signupForm.termsAgreed} onChange={(e) => setSignupForm({ ...signupForm, termsAgreed: e.target.checked })} />
                  <span>Beyond OS 사용 목적과 내부 운영 기록 관리에 동의합니다.</span>
                </label>
              </div>

              <button onClick={submitSignupRequest} disabled={signupLoading}>{signupLoading ? '신청 중...' : '계정 생성 신청'}</button>
              {signupStatus ? <div className={signupStatus.type === 'success' ? 'success signup-status' : 'error signup-status'}>{signupStatus.message}</div> : null}
              <div className="hint">신청 내역은 설정 &gt; 유저 관리 &gt; 승인 대기에 표시됩니다.</div>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <div className={`app ${activeTab !== 'dashboard' ? 'report-mode' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand with-logo">
          <img src="/the-place-26-logo.png" alt="The Place 26" />
          <div className="brand-copy">
            <strong>The Place 26</strong>
            <span>Beyond OS</span>
          </div>
        </div>
        <div className="mobile-nav-shell">
          <button className="mobile-nav-arrow left" type="button" onClick={() => scrollMobileNav(-1)} aria-label="이전 메뉴">‹</button>
          <nav
            className="nav"
            onPointerDown={handleNavPointerDown}
            onPointerMove={handleNavPointerMove}
            onPointerUp={handleNavPointerEnd}
            onPointerCancel={handleNavPointerEnd}
            onTouchStart={handleNavTouchStart}
            onTouchMove={handleNavTouchMove}
            onTouchEnd={handleNavTouchEnd}
            onTouchCancel={handleNavTouchEnd}
            onClickCapture={handleNavClickCapture}
          >
            {allowedTabs.map(([key, label]) => (
              <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
                {label}
              </button>
            ))}
          </nav>
          <button className="mobile-nav-arrow right" type="button" onClick={() => scrollMobileNav(1)} aria-label="다음 메뉴">›</button>
        </div>
      </aside>

      <main className="main">
        <div className="header">
          <div>
            <h1>{allowedTabs.find(([key]) => key === activeTab)?.[1] || TABS.find(([key]) => key === activeTab)?.[1] || 'Beyond OS'}</h1>
            <div className="sub">{APP_VERSION_SUBTITLE}</div>
            <span className="app-version-badge" title={`${APP_VERSION_NAME} · ${APP_VERSION_DESCRIPTION}`}>버전 {APP_VERSION}</span>
            <div className={`sync-status-pill ${syncStatus === 'failed' ? 'failed' : 'synced'}`}>{renderSyncStatusContent(syncStatus, lastSyncAt)}</div>
            <div className="current-user-pill">{currentUser?.displayName || '공용 관리자'} · {USER_ROLE_LABELS[currentUser?.role] || currentUser?.role || '관리자'} · 접근 {allowedTabs.length}개</div>
          </div>
          <div className="toolbar utility-toolbar">
            <button type="button" className="utility-action refresh" onClick={loadDashboard} title="새로고침" aria-label="새로고침">
              <span className="utility-icon" aria-hidden="true">↻</span>
              <span className="utility-label">새로고침</span>
            </button>
            {activeTab === 'dashboard' ? (
              <button type="button" className="utility-action view-toggle" onClick={() => setView(view === 'map' ? 'list' : 'map')} title={view === 'map' ? '리스트 보기' : '배치도 보기'} aria-label={view === 'map' ? '리스트 보기' : '배치도 보기'}>
                <span className="utility-icon" aria-hidden="true">{view === 'map' ? '☷' : '▦'}</span>
                <span className="utility-label">{view === 'map' ? '리스트' : '배치도'}</span>
              </button>
            ) : null}
            <button type="button" className="utility-action account" onClick={() => setAccountModalOpen(true)} title="내 계정" aria-label="내 계정">
              <span className="utility-icon" aria-hidden="true">♙</span>
              <span className="utility-label">내 계정</span>
            </button>
            <button type="button" className="utility-action health" onClick={() => window.open('/api/health', '_blank')} title="연결진단" aria-label="연결진단">
              <span className="utility-icon" aria-hidden="true">⌁</span>
              <span className="utility-label">연결진단</span>
            </button>
            <button type="button" className="utility-action logout" onClick={logout} title="로그아웃" aria-label="로그아웃">
              <span className="utility-icon" aria-hidden="true">⇥</span>
              <span className="utility-label">로그아웃</span>
            </button>
          </div>
        </div>

        {!isActiveTabAllowed ? (
          <RestrictedAccessCard activeTab={activeTab} allowedTabs={allowedTabs} />
        ) : null}

        {isActiveTabAllowed && activeTab === 'dashboard' ? (
          <>
            <AlertCenter alerts={scheduleAlerts} nowTick={nowTick} onConfirm={confirmScheduleAlert} onNotifyParent={notifyParent} />
            <DashboardTab summary={summary} view={view} seatsForDisplay={seatsForDisplay} sessionBySeat={sessionBySeat} selectedSeatNo={selectedSeatNo} selectSeat={selectSeat} students={students} nowTick={nowTick} apiFetch={apiFetch} loadDashboard={loadDashboard} setMessage={setMessage} currentUser={currentUser} scheduleAlerts={scheduleAlerts} onDismissFocusAlert={dismissFocusAlert} dismissedAlertMemos={dismissedAlertMemos} mentoringTodayAssignments={mentoringTodayAssignments} checksBySession={checksBySession} defaultSchedule={defaultSchedule} />
          </>
        ) : null}

        {isActiveTabAllowed && activeTab === 'schedules' ? (
          <>
            <SchedulesTab
              students={students}
              scheduleView={scheduleView}
              setScheduleView={setScheduleView}
              scheduleBaseDate={scheduleBaseDate}
              setScheduleBaseDate={setScheduleBaseDate}
              scheduleStudentFilter={scheduleStudentFilter}
              setScheduleStudentFilter={setScheduleStudentFilter}
              scheduleRows={scheduleRows}
              scheduleBreakRows={scheduleBreakRows}
              scheduleBreaksBySchedule={scheduleBreaksBySchedule}
              scheduleForm={scheduleForm}
              setScheduleForm={setScheduleForm}
              openScheduleForm={openScheduleForm}
              saveSchedule={saveSchedule}
              addBreak={addBreak}
              updateBreak={updateBreak}
              removeBreak={removeBreak}
              openQuickSchedulePopup={openQuickSchedulePopup}
              setActivityPopup={setActivityPopup}
              defaultSchedule={defaultSchedule}
              defaultScheduleConfig={defaultScheduleConfig}
              deleteStudentSchedulesRange={deleteStudentSchedulesRange}
              scheduleCoverage={scheduleCoverage}
            />
            <ActivitySchedulePopup
              popup={activityPopup}
              setPopup={setActivityPopup}
              savePopup={saveActivityPopup}
              updateBreak={updateActivityPopupBreak}
              addBreak={addActivityPopupBreak}
              removeBreak={removeActivityPopupBreak}
              deletePopupSchedule={deleteActivitySchedule}
            />
          </>
        ) : null}

        {isActiveTabAllowed && activeTab === 'planner' ? (
          <PlannerTab
            students={students}
            planners={planners}
            plannerDate={plannerDate}
            setPlannerDate={setPlannerDate}
            loadPlanners={loadPlanners}
            runPlannerDiagnostics={runPlannerDiagnostics}
            uploadPlannerFile={uploadPlannerFile}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'dailyReports' ? (
          <DailyReportsTab
            sessions={reportReadySessions}
            reportsBySession={reportsBySession}
            checksBySession={checksBySession}
            eventsBySession={eventsBySession}
            nowTick={nowTick}
            planners={planners}
            plannerDate={plannerDate}
            setPlannerDate={setPlannerDate}
            generateReport={generateReport}
            generateAllReports={generateAllReports}
            openSendPreview={openSendPreview}
            sendReportToParent={sendReportToParent}
            prepareReportSend={prepareReportSend}
            markReportManualSent={markReportManualSent}
            exclusionsBySession={exclusionsBySession}
            updateReportExclusion={updateReportExclusion}
            operatingRules={operatingRules}
            todaySchedules={todaySchedules}
            apiFetch={apiFetch}
            sendConfig={sendConfig}
            currentUser={currentUser}
            defaultSchedule={defaultSchedule}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'weeklyReports' ? (
          <WeeklyReportsTab
            students={students}
            apiFetch={apiFetch}
            operatingRules={operatingRules}
            setMessage={setMessage}
            sendConfig={sendConfig}
            onActionNotice={setSendActionNotice}
            currentUser={currentUser}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'ranking' ? (
          <RankingTab ranking={ranking} rankingStart={rankingStart} rankingEnd={rankingEnd} setRankingStart={setRankingStart} setRankingEnd={setRankingEnd} loadRanking={loadRanking} setRankingPreset={setRankingPreset} />
        ) : null}

        {isActiveTabAllowed && activeTab === 'points' ? (
          <StudentPointsTab
            students={students}
            apiFetch={apiFetch}
            currentUser={currentUser}
            setMessage={setMessage}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'studentHistory' ? (
          <StudentCareTab
            attendanceProps={{
              students,
              rows: attendanceRows,
              loading: attendanceLoading,
              start: attendanceStart,
              end: attendanceEnd,
              studentFilter: attendanceStudentFilter,
              setStart: setAttendanceStart,
              setEnd: setAttendanceEnd,
              setStudentFilter: (studentId) => {
                const nextStudentId = studentId || '';
                setAttendanceStudentFilter(nextStudentId);
                setStudentHistoryFocusStudentId(nextStudentId);
                if (!nextStudentId || String(nextStudentId) !== String(studentCareMentoringContext?.studentId || '')) {
                  setStudentCareMentoringContext(null);
                }
              },
              loadHistory: loadAttendanceHistory,
              setPreset: setAttendancePreset,
              operatingRules,
              statusFilter: attendanceStatusFilter,
              setStatusFilter: setAttendanceStatusFilter,
              summaryCollapsed: attendanceSummaryCollapsed,
              setSummaryCollapsed: setAttendanceSummaryCollapsed,
              saveMentorComment: saveAttendanceMentorComment,
              focusMentorCommentRequest: mentorCommentFocusRequest,
              mentoringContext: studentCareMentoringContext,
              onReturnToMentoring: returnToMentoringScheduleFromCare,
              onNavigateMentoringStudent: navigateMentoringCareStudent,
            }}
            historyProps={{
              students,
              apiFetch,
              currentUser,
              setMessage,
              setActiveTab,
              focusStudentId: attendanceStudentFilter || studentHistoryFocusStudentId,
              externalStart: attendanceStart,
              externalEnd: attendanceEnd,
            }}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'mentoring' ? (
          <MentoringTab
            students={students}
            apiFetch={apiFetch}
            setMessage={setMessage}
            currentUser={currentUser}
            defaultSchedule={defaultScheduleConfig?.variants?.weekday || defaultSchedule}
            onMentoringChanged={() => loadDashboard({ silent: true, runAutoCheckout: false, suppressChangeNotice: true })}
            onOpenStudentCare={openStudentCareFromMentoring}
            onOpenMentoringSettings={() => { setSettingsView('mentoring'); setActiveTab('settings'); }}
            initialActiveDay={studentCareMentoringContext?.dayOfWeek || 1}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'attention' ? (
          <AttentionTab
            apiFetch={apiFetch}
            students={students}
            scheduleAlerts={scheduleAlerts}
            dismissedAlertMemos={dismissedAlertMemos}
            fieldFocusAcknowledgements={fieldFocusAcknowledgements}
            selectSeat={selectSeat}
            setActiveTab={setActiveTab}
          />
        ) : null}

        {isActiveTabAllowed && activeTab === 'settings' ? (
          <>
            <SettingsTab
              settingsView={settingsView}
              setSettingsView={setSettingsView}
              students={settingsStudents?.length ? settingsStudents : students}
              seatsForDisplay={seatsForDisplay}
              openStudentEditor={openStudentEditor}
              diagnostics={seatIntegrity}
              loading={seatIntegrityLoading}
              runCheck={runSeatIntegrityCheck}
              cleanup={cleanupSeatIntegrity}
              operatingRules={operatingRules}
              rulesDraft={rulesDraft}
              setRulesDraft={setRulesDraft}
              saveOperatingRules={saveOperatingRules}
              rulesLoading={rulesLoading}
              defaultSchedule={defaultSchedule}
              defaultScheduleConfig={defaultScheduleConfig}
              defaultScheduleConfigDraft={defaultScheduleConfigDraft}
              setDefaultScheduleConfigDraft={setDefaultScheduleConfigDraft}
              saveDefaultSchedule={saveDefaultSchedule}
              defaultScheduleLoading={defaultScheduleLoading}
              bulkGenerateSchedules={bulkGenerateSchedules}
              scheduleCoverage={scheduleCoverage}
              apiFetch={apiFetch}
              setMessage={setMessage}
              currentUser={currentUser}
              canUseUserManagement={canUseUserManagement}
              sendConfig={sendConfig}
              loadSendConfig={loadSendConfig}
              onMentoringChanged={() => loadDashboard({ silent: true, runAutoCheckout: false, suppressChangeNotice: true })}
            />
            <StudentEditorModal
              editor={studentEditor}
              setEditor={setStudentEditor}
              seatsForDisplay={seatsForDisplay}
              students={settingsStudents?.length ? settingsStudents : students}
              saveEditor={saveStudentEditor}
              deactivateEditor={deactivateStudentEditor}
              deleteEditor={deleteStudentEditor}
            />
          </>
        ) : null}

        <AccountModal
          open={accountModalOpen}
          onClose={() => setAccountModalOpen(false)}
          currentUser={currentUser}
          passwordForm={passwordForm}
          setPasswordForm={setPasswordForm}
          changeOwnPassword={changeOwnPassword}
          passwordStatus={passwordStatus}
        />

        <SendPreviewModal
          preview={sendPreview}
          setPreview={setSendPreview}
          sendReportToParent={sendReportToParent}
          prepareReportSend={prepareReportSend}
          operatingRules={operatingRules}
          onActionNotice={setSendActionNotice}
        />
        <SendActionNotice notice={sendActionNotice} onClose={() => setSendActionNotice(null)} />
        <SendActionNotice notice={attendanceActionNotice} onClose={() => setAttendanceActionNotice(null)} />
        <RemoteChangeNotice notice={remoteChangeNotice} onClose={() => setRemoteChangeNotice(null)} />
        <AwayDetailPopup popup={awayPopup} setPopup={setAwayPopup} savePopup={saveAwayDetail} />
        <AttendanceAdjustPopup popup={attendanceAdjustPopup} setPopup={setAttendanceAdjustPopup} savePopup={saveAttendanceAdjust} />
        <ParentConfirmationAlertModal
          popup={parentAlertPopup}
          setPopup={setParentAlertPopup}
          sendPopup={sendParentConfirmationAlert}
          sendConfig={sendConfig}
        />

        {message ? <div className={message.includes('완료') ? 'success' : 'error'}>{message}</div> : null}
      </main>

      <aside className={`panel ${selectedSeatNo ? 'open' : ''}`}>
        <div className="panel-mobile-head">
          <h2>{selectedSeatNo ? `${String(selectedSeatNo).padStart(2, '0')}번 좌석` : '좌석을 선택하세요'}</h2>
          <button className="mobile-panel-close" onClick={closePanel} aria-label="좌석 상세 패널 닫기">닫기 ✕</button>
        </div>
        <div className="mobile-panel-focus-note">현장 조작 우선: 출결 요약과 상태 변경을 먼저 확인하세요.</div>

        <PanelSection title="학생 기본정보" defaultMobileOpen={false} className="readonly-student-card">
{form.name ? (
            <>
              <div className="readonly-main-name">{form.name}</div>
              <div className="info-grid compact-student-info-grid">
                <div className="info-item"><span>학교</span><strong>{form.school || '-'}</strong></div>
                <div className="info-item"><span>학년</span><strong>{form.grade || '-'}</strong></div>
                <div className="info-item"><span>학생 연락처</span><strong>{form.studentPhone || '-'}</strong></div>
              </div>

              <div className="panel-guardian-list">
                <span className="panel-guardian-title">보호자 연락처</span>
                {selectedPanelGuardians.length ? selectedPanelGuardians.map((guardian, index) => (
                  <div key={guardian.id || `${guardian.phone}-${index}`} className="panel-guardian-row">
                    <span className={`guardian-relation-badge ${guardian.isPrimary ? 'primary' : ''}`}>{guardian.relationship || guardian.displayName || '보호자'}</span>
                    <strong>{guardian.phone}</strong>
                    {guardian.isPrimary ? <em>대표</em> : null}
                  </div>
                )) : form.parentPhone ? (
                  <div className="panel-guardian-row legacy">
                    <span className="guardian-relation-badge primary">모</span>
                    <strong>{form.parentPhone}</strong>
                    <em>기존</em>
                  </div>
                ) : (
                  <div className="panel-guardian-empty">등록된 데일리 수신 보호자가 없습니다.</div>
                )}
              </div>
              <div className="hint">학생 기본정보는 이 화면에서 수정하지 않습니다. 학생 정보 수정은 설정 &gt; 학생 관리 화면에서 진행합니다.</div>
            </>
          ) : (
            <div className="empty-readonly">
              <strong>배정된 학생이 없습니다.</strong>
              <span>좌석 배정 관리에서 학생을 먼저 배정하세요.</span>
            </div>
          )}
        </PanelSection>

        <PanelSection title="오늘 시간표" defaultMobileOpen={false} className="today-schedule-card">
{getTodayScheduleSummary(form.studentId).map((chip, index) => (
            <div key={index} className={`today-schedule-line ${chip.kind || 'info'}`}>
              {chip.label}
            </div>
          ))}
        </PanelSection>

        <PanelSection title="오늘 출결 요약" defaultMobileOpen={true} className="attendance-summary-card priority-panel-section">
<div className="attendance-summary-note">{getAttendanceSummaryNote(selectedSession)}</div>
          <div className="info-grid">
            <div className="info-item"><span>현재 상태</span><strong>{STATUS_LABELS[selectedSession?.seat_status] || '-'}</strong></div>
            <div className="info-item"><span>입실 시간</span><strong>{formatKstTime(selectedSession?.check_in_at)}</strong></div>
            <div className="info-item"><span>외출 시작</span><strong>{formatKstTime(selectedSession?.away_started_at)}</strong></div>
            <div className="info-item"><span>퇴실 시간</span><strong>{formatKstTime(selectedSession?.check_out_at)}</strong></div>
            <div className="info-item"><span>외출 누적</span><strong>{formatMinutes(getTotalAwayMinutes(selectedSession, nowTick))}</strong></div>
            <div className="info-item"><span>순공시간</span><strong>{formatMinutes(calculateLivePureStudyMinutes(selectedSession, nowTick, selectedEvents, defaultSchedule))}</strong></div>
            <div className="info-item"><span>체크 수</span><strong>{selectedChecks.length}회</strong></div>
          </div>
        </PanelSection>

        {selectedStudentKioskFailures.length ? (
          <PanelSection title="최근 키오스크 실패 알림" defaultMobileOpen={true} className="kiosk-panel-alert-section priority-panel-section">
            <div className="status-alert warning">자동반영에 실패한 최근 키오스크 문자가 있습니다. 필요한 경우 아래 내용을 참고해 기존 출결 상태 변경 기능으로 수동 보정하세요.</div>
            {selectedStudentKioskFailures.map((item) => (
              <div key={item.id} className="kiosk-panel-alert-item">
                <strong>{formatKioskLogDate(item.received_at || item.created_at)} · {getKioskEventLabel(item.parsed_event_type)}</strong>
                <span>{item.error_message || '처리 실패 사유 확인 필요'}</span>
                <em>{compactKioskRawText(item.raw_text)}</em>
              </div>
            ))}
          </PanelSection>
        ) : null}

        <PanelSection title="출결 상태 변경" defaultMobileOpen={true} className="attendance-action-section priority-panel-section">
<div className="btn-row" style={{ flexWrap: 'wrap' }}>
            {BUTTON_STATUS.map(([status, label]) => (
              <button
                key={status}
                className={`status-btn ${status}`}
                style={{ minWidth: 96 }}
                title={status === 'absent' ? '결석은 기존 출결 기록을 정리할 수 있으므로 확인 후 처리하세요.' : status === 'out' ? '퇴실 처리 전 현재 상태를 확인하세요.' : status === 'away' ? '외출 사유 입력 후 처리됩니다.' : '입실 또는 재입실 처리'}
                disabled={Boolean(attendanceSavingStatus)}
                onClick={() => handleStatusButtonClick(status)}
              >
                {attendanceSavingStatus === status ? '저장 중...' : label}
              </button>
            ))}
          </div>
          <div className="btn-row">
            <button className="secondary" onClick={openAttendanceAdjustPopup}>출결시간 조정</button>
          </div>
          <div className="hint">버튼을 늦게 눌렀을 때 실제 입실/퇴실/외출 시간을 보정하는 용도입니다. 외출 사유는 외출 버튼을 누르면 입력합니다.</div>
        </PanelSection>

        <PanelSection title="학습 체크 입력" defaultMobileOpen={false} className="study-check-section study-check-section-v4112">
          <div className="quick-inline-box">
            <strong>빠른 선택</strong>
            <span>태블릿 순찰 시 드롭다운 대신 버튼으로 바로 선택할 수 있습니다.</span>
          </div>
          <div className="field">
            <label>현재 학습 과목</label>
            <div className="quick-chip-row side-panel-chip-row">
              {SUBJECT_OPTIONS.map((option) => (
                <button key={option} type="button" className={form.subject === option ? 'active' : ''} onClick={() => setForm({ ...form, subject: option })}>{option}</button>
              ))}
            </div>
            <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
              {SUBJECT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>
          <div className="field">
            <label>학습 상태</label>
            <div className="quick-chip-row side-panel-chip-row">
              {STUDY_STATUS_OPTIONS.map((option) => (
                <button key={option} type="button" className={form.studyStatus === option ? 'active' : ''} onClick={() => setForm({ ...form, studyStatus: option })}>{option}</button>
              ))}
            </div>
            <select value={form.studyStatus} onChange={(e) => setForm({ ...form, studyStatus: e.target.value })}>
              {STUDY_STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
            <div className="hint">비학습: 카톡/SNS, 유튜브, 게임, 웹툰 등 학습과 무관한 행동</div>
          </div>
          <div className="field"><label>학습 내용 및 특이사항</label><textarea value={form.studyContent} onChange={(e) => setForm({ ...form, studyContent: e.target.value })} placeholder="예: 수1 지수로그 문제풀이 중. 집중도 양호." /></div>
          <div className="btn-row"><button className="primary" onClick={saveCheck}>순찰 체크 저장</button></div>
        </PanelSection>

        <PanelSection title="학습멘토 코멘트" defaultMobileOpen={false} className="mentor-comment-section">
<div className="field"><label>데일리 리포트 최종 코멘트</label><textarea value={form.reportMentorComment} onChange={(e) => setForm({ ...form, reportMentorComment: e.target.value })} placeholder="하루 1회만 입력합니다. 비워두면 리포트에서 코멘트 항목이 제외됩니다." /></div>
          <div className="btn-row"><button className="primary" onClick={saveMentorComment}>코멘트 저장</button></div>
          {selectedReport?.updated_at ? <div className="hint">저장됨: {formatKstTime(selectedReport.updated_at)}</div> : <div className="hint">저장된 코멘트가 있으면 다시 열었을 때 자동으로 불러옵니다.</div>}
        </PanelSection>

        <PanelSection title="데일리 리포트 미리보기" defaultMobileOpen={false} className="report-preview-section">
<div className={`report-preflight-box ${selectedReportPreflight.className}`}>
            <strong>리포트 점검 결과: {selectedReportPreflight.label}</strong>
            <span>{selectedReportPreflight.issues.join(' / ')}</span>
          </div>
          <div className="btn-row report-action-row">
            <button className="secondary" onClick={() => openSendPreview()}>발송 미리보기</button>
            <button className="primary" onClick={() => sendReportToParent()} disabled={selectedReportPreflight.className === 'failed'}>학부모에게 카톡 발송</button>
          </div>
          <div className="hint">미리보기와 발송 시점에 최신 출결, 순공시간, 플래너, 멘토 코멘트를 자동 취합합니다.</div>
          <div className="field"><label>발송 전 리포트 미리보기</label><textarea className="report-preview-textarea" style={{ minHeight: 170 }} value={form.reportText} onChange={(e) => setForm({ ...form, reportText: e.target.value })} placeholder="발송 미리보기를 누르면 최신 리포트 문구가 생성됩니다." /></div>
          {selectedReport ? (
            <div className="send-status-box">
              <strong>발송 상태: {getSendStatusLabel(selectedReport.send_status)}</strong>
              {selectedReport.sent_at ? <span>발송시각: {formatKstTime(selectedReport.sent_at)}</span> : null}
              {selectedReport.send_error ? <span>오류: {selectedReport.send_error}</span> : null}
            </div>
          ) : null}
          {form.reportPlannerImageUrl ? (
            <div className="planner-attachment-box">
              <strong>카톡 첨부용 플래너 이미지</strong>
              <span>{form.reportPlannerFileName || '업로드된 플래너 이미지'}</span>
              <div className="btn-row">
                <a className="secondary link-button" href={form.reportPlannerImageUrl} target="_blank" rel="noreferrer">첨부 이미지 확인</a>
                <button className="secondary emergency-only" onClick={copyPlannerImageLink}>이미지 링크 복사</button>
              </div>
              <div className="hint">카카오 API 연동 후에는 발송 버튼 클릭 시 리포트 본문과 플래너 이미지가 함께 전송됩니다.</div>
            </div>
          ) : (
            form.reportText ? <div className="hint">이 학생은 현재 보고서에 첨부할 플래너 이미지가 없습니다.</div> : null
          )}
          <details className="emergency-copy">
            <summary>비상용 수동 복사 기능</summary>
            <button className="secondary" onClick={copyDailyReportText}>보고서 문구 복사</button>
          </details>
        </PanelSection>

        <PanelSection title="최근 출결 이력" defaultMobileOpen={false} className="history attendance-history-preview">
          
          <div className="panel-section-count">{selectedEvents.length > selectedRecentAttendanceEvents.length ? <span>최근 {selectedRecentAttendanceEvents.length}건 표시</span> : null}</div>

          {selectedRecentAttendanceEvents.length ? selectedRecentAttendanceEvents.map((event) => {
            const memo = getAttendanceHistoryMemo(event);
            return (
              <div key={event.id || `${event.event_type}-${event.event_at}`} className="history-item attendance-event-item">
                <strong>{formatKstTime(event.event_at || event.created_at)} · {getAttendanceHistoryLabel(event)}</strong>
                {memo ? <span className="history-memo">사유/메모: {memo}</span> : <span className="history-memo muted">사유/메모 없음</span>}
                <span className={`attendance-source-badge ${event.source_type === 'kiosk' ? 'kiosk' : 'manual'}`}>{getAttendanceEventSourceLabel(event)}</span>
                <div className="attendance-event-actions">
                  <button type="button" className="secondary tiny-action" onClick={() => editAttendanceEventMemo(event)}>사유 수정</button>
                </div>
              </div>
            );
          }) : <div className="muted">아직 출결 기록이 없습니다.</div>}
        </PanelSection>

        <PanelSection title="오늘 순찰 기록" defaultMobileOpen={false} className="history patrol-history-section">
{selectedChecks.length ? selectedChecks.map((check) => {
            const periodMeta = getSchedulePeriodMetaForIso(check.checked_at, defaultSchedule);
            const isEditing = studyCheckEditor?.id === check.id;
            return (
              <div key={check.id} className={`history-item study-check-history-item ${isEditing ? 'editing' : ''}`}>
                {isEditing ? (
                  <div className="study-check-edit-box">
                    <div className="time-grid">
                      <div className="field">
                        <label>체크 시간</label>
                        <TimeSelect value={studyCheckEditor.checkedTime} onChange={(value) => setStudyCheckEditor((prev) => ({ ...prev, checkedTime: value }))} />
                      </div>
                      <div className="field">
                        <label>과목</label>
                        <select value={studyCheckEditor.subject} onChange={(e) => setStudyCheckEditor((prev) => ({ ...prev, subject: e.target.value }))}>
                          {SUBJECT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </div>
                      <div className="field">
                        <label>학습 상태</label>
                        <select value={studyCheckEditor.studyStatus} onChange={(e) => setStudyCheckEditor((prev) => ({ ...prev, studyStatus: e.target.value }))}>
                          {STUDY_STATUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label>학습 내용 및 특이사항</label>
                      <textarea value={studyCheckEditor.studyContent} onChange={(e) => setStudyCheckEditor((prev) => ({ ...prev, studyContent: e.target.value }))} placeholder="예: 수1 지수로그 문제풀이 중. 집중도 양호." />
                    </div>
                    <div className="btn-row">
                      <button type="button" className="secondary" onClick={cancelEditStudyCheck} disabled={studyCheckEditSaving}>취소</button>
                      <button type="button" className="primary" onClick={saveStudyCheckEdit} disabled={studyCheckEditSaving}>{studyCheckEditSaving ? '수정 중...' : '수정 저장'}</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong>{periodMeta.label} · {formatKstTime(check.checked_at)} / {check.subject || '-'} / {check.study_status || '-'}</strong><br />
                    {check.study_content || '학습 내용 및 특이사항 미입력'}
                    <div className="history-action-row">
                      <button type="button" className="secondary tiny-action" onClick={() => startEditStudyCheck(check)}>수정</button>
                    </div>
                  </>
                )}
              </div>
            );
          }) : <div className="muted">아직 기록이 없습니다.</div>}
        </PanelSection>
      </aside>
    </div>
  );
}



function SendPreviewModal({ preview, setPreview, sendReportToParent, prepareReportSend, operatingRules, onActionNotice }) {
  const [actionState, setActionState] = useState({ loading: null, type: '', title: '', message: '' });
  const previewSessionId = preview?.sendPayload?.sessionId || '';

  useEffect(() => {
    setActionState({ loading: null, type: '', title: '', message: '' });
  }, [previewSessionId]);

  if (!preview) return null;

  const payload = preview.sendPayload || {};
  const report = preview.report || {};
  const session = preview.session || {};
  const previewRow = {
    checkInAt: session.check_in_at,
    checkOutAt: session.check_out_at,
    checkInTime: formatKstTime(session.check_in_at),
    checkOutTime: session.check_out_at ? formatKstTime(session.check_out_at) : '',
    awayCount: session.away_count || 0,
    awayMinutes: session.away_minutes || session.away_total_minutes || 0,
    pureStudyMinutes: session.pure_study_minutes || 0,
    mentorComment: report.mentor_comment || '',
    attendanceMemo: session.attendance_memo || '',
    eventSummary: report.report_text || '',
  };
  const previewFlags = getAttendanceFlags(previewRow, operatingRules).filter((flag) => flag.label !== '정상');
  const templateVariableRows = getKakaoTemplateVariableRows(payload.templateVariables, 'daily');
  const templateValidationLabel = getTemplateValidationLabel(payload.templateValidation);
  const isActionLoading = Boolean(actionState.loading);

  function buildActionNotice(mode, data) {
    if (!data || data.error) {
      return {
        type: 'failed',
        title: mode === 'send' ? '카카오 발송 실패' : '발송대기 저장 실패',
        message: data?.error || '처리 중 오류가 발생했습니다.',
      };
    }

    const sendStatus = data.report?.send_status || data.status || data.providerResult?.status;
    if (mode === 'prepare') {
      return {
        type: 'neutral',
        title: '발송대기 저장 완료',
        message: data.message || '발송대기 상태로 저장했습니다.',
      };
    }

    if (sendStatus === 'sent') {
      return {
        type: 'success',
        title: '카카오 발송 완료',
        message: data.message || '학부모에게 카카오 발송 요청이 완료되었습니다.',
      };
    }

    if (sendStatus === 'failed') {
      return {
        type: 'failed',
        title: '카카오 발송 실패',
        message: data.message || data.report?.send_error || '카카오 발송 요청이 실패했습니다.',
      };
    }

    return {
      type: 'neutral',
      title: '발송대기 저장 완료',
      message: data.message || '카카오 발송 API가 아직 연결되지 않아 발송대기 상태로 저장했습니다.',
    };
  }

  async function runPreviewAction(mode) {
    setActionState({
      loading: mode,
      type: 'neutral',
      title: mode === 'send' ? '카카오 발송 요청 중...' : '발송대기 저장 중...',
      message: '최신 리포트를 다시 취합하고 발송 상태를 저장하고 있습니다. 잠시만 기다려주세요.',
    });

    const data = mode === 'send'
      ? await sendReportToParent(payload.sessionId)
      : await prepareReportSend(payload.sessionId);

    const notice = buildActionNotice(mode, data);
    setActionState({ ...notice, loading: null });
    if (onActionNotice) onActionNotice(notice);

    if (mode === 'send' && notice.type === 'success') {
      window.setTimeout(() => setPreview(null), 900);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => setPreview(null)}>
      <div className="send-preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head">
          <div>
            <h2>카톡 발송 미리보기</h2>
            <p>관리자가 내용을 확인한 뒤 발송 버튼을 누르는 단계입니다.</p>
          </div>
          <button onClick={() => setPreview(null)}>닫기</button>
        </div>

        {actionState.title ? (
          <div className={`send-action-feedback ${actionState.type || 'neutral'} ${actionState.loading ? 'loading' : ''}`}>
            <strong>{actionState.title}</strong>
            <span>{actionState.message}</span>
          </div>
        ) : null}

        <div className="send-preview-grid">
          <section className="send-preview-card">
            <h3>수신 정보</h3>
            <div className="info-item"><span>학생</span><strong>{payload.studentName || '-'}</strong></div>
            <div className="info-item"><span>학부모 연락처</span><strong>{payload.recipientPhone || '연락처 없음'}</strong></div>
            <div className="info-item"><span>발송 상태</span><strong>{getSendStatusLabel(report.send_status)}</strong></div>
            <div className="info-item"><span>플래너 이미지</span><strong>{payload.hasPlannerImage ? '첨부 예정' : '첨부 없음'}</strong></div>
          </section>

          <section className="send-preview-card">
            <h3>발송 전 확인사항</h3>
            {previewFlags.length ? (
              <div className="attendance-flag-list preview-flag-list">
                {previewFlags.map((flag) => <span key={flag.label} className={`attendance-flag ${flag.type}`}>{flag.label}</span>)}
              </div>
            ) : (
              <div className="all-clear">운영 기준상 별도 확인사항이 없습니다.</div>
            )}
            <div className="hint">지각/조퇴는 학생 시간표가 연결된 출결현황 화면에서 더 정확히 확인할 수 있습니다.</div>
          </section>

          <section className="send-preview-card full-span template-variable-preview-card">
            <h3>실제 카톡 템플릿 변수</h3>
            <div className="hint">SOLAPI 알림톡 템플릿에 실제로 들어가는 값입니다. 이 값과 학부모 공개 링크 표시값을 같은 기준으로 맞춰 확인합니다.</div>
            <div className="template-variable-grid">
              {templateVariableRows.map(([key, value]) => (
                <div key={key} className={!value ? 'missing' : ''}>
                  <span>{key}</span>
                  <strong>{value || '값 없음'}</strong>
                </div>
              ))}
            </div>
            <div className={`template-validation-line ${payload.templateValidation?.ok ? 'done' : 'warn'}`}>{templateValidationLabel}</div>
          </section>

          <section className="send-preview-card full-span">
            <h3>공개 링크 리포트 본문</h3>
            <div className="hint">카톡에는 위 템플릿 변수가 발송되고, 자세한 학습 내용은 #{'{'}리포트링크{'}'}를 통해 열리는 공개 리포트에서 확인됩니다.</div>
            <pre className="send-preview-text">{payload.messageText || report.report_text || '리포트 본문이 없습니다.'}</pre>
          </section>

          {payload.plannerImageUrl ? (
            <section className="send-preview-card full-span">
              <h3>첨부 이미지</h3>
              <a href={payload.plannerImageUrl} target="_blank" rel="noreferrer">플래너 이미지 확인</a>
              <div className="hint">실제 카카오 API 연동 시 이 이미지를 본문 URL이 아닌 첨부 이미지로 전송합니다.</div>
            </section>
          ) : null}
        </div>

        <div className="popup-bottom-actions">
          <button className="secondary" onClick={() => runPreviewAction('prepare')} disabled={isActionLoading}>
            {actionState.loading === 'prepare' ? '저장 중...' : '발송대기 저장'}
          </button>
          <button className="primary" onClick={() => runPreviewAction('send')} disabled={isActionLoading}>
            {actionState.loading === 'send' ? '발송 중...' : '학부모에게 카톡 발송'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SendActionNotice({ notice, onClose }) {
  if (!notice) return null;

  return (
    <div className={`floating-send-notice ${notice.type || 'neutral'}`}>
      <div>
        <strong>{notice.title || '발송 상태 안내'}</strong>
        <span>{notice.message || '-'}</span>
      </div>
      <button onClick={onClose}>닫기</button>
    </div>
  );
}


function RemoteChangeNotice({ notice, onClose }) {
  if (!notice) return null;

  return (
    <div className="remote-change-notice" role="status" aria-live="polite">
      <div>
        <strong>{notice.title || '다른 기기 변경 반영'}</strong>
        <span>{notice.message || '다른 기기에서 변경된 상태가 반영되었습니다.'}</span>
        <em>잠시 후 자동으로 사라집니다.</em>
      </div>
      <button onClick={onClose} aria-label="알림 닫기">닫기</button>
    </div>
  );
}

function AwayDetailPopup({ popup, setPopup, savePopup }) {
  if (!popup) return null;

  return (
    <div className="modal-backdrop" onClick={() => setPopup(null)}>
      <div className="small-action-popup" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head">
          <div>
            <h2>외출 상세 입력</h2>
            <p>외출 사유를 데일리 리포트에 반영합니다.</p>
          </div>
          <button onClick={() => setPopup(null)}>닫기</button>
        </div>
        <div className="field">
          <label>외출 시작 시간</label>
          <TimeSelect value={popup.eventTime} onChange={(value) => setPopup({ ...popup, eventTime: value })} />
        </div>
        <div className="field">
          <label>외출 상세 사유</label>
          <input value={popup.detail} onChange={(e) => setPopup({ ...popup, detail: e.target.value })} placeholder="예: 수학학원 특강" autoFocus />
        </div>
        <div className="popup-bottom-actions">
          <button className="secondary" onClick={() => setPopup(null)}>취소</button>
          <button className="primary" onClick={savePopup}>외출 처리</button>
        </div>
      </div>
    </div>
  );
}

function AttendanceAdjustPopup({ popup, setPopup, savePopup }) {
  if (!popup) return null;

  function requestClose() {
    if (popup.requiredManualCheckIn) {
      alert('누락된 입실 시간을 저장하기 전에는 닫을 수 없습니다. 실제 입실 시간을 입력한 뒤 조정 저장을 눌러 주세요.');
      return;
    }
    setPopup(null);
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <div className="small-action-popup" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head">
          <div>
            <h2>{popup.requiredManualCheckIn ? '누락 입실시간 입력' : '출결시간 조정'}</h2>
            <p>{popup.requiredManualCheckIn ? '입실 기록 없이 외출/퇴실이 먼저 반영되었습니다. 실제 입실 시간을 반드시 입력해 주세요.' : '버튼을 늦게 눌렀을 때 실제 시간 기준으로 보정합니다.'}</p>
          </div>
          <button onClick={requestClose}>{popup.requiredManualCheckIn ? '저장 필요' : '닫기'}</button>
        </div>
        <div className="field">
          <label>조정 날짜</label>
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={popup.sessionDate} onChange={(e) => setPopup({ ...popup, sessionDate: e.target.value })} />
        </div>
        <div className="time-grid">
          <div className="field">
            <label>입실 시간</label>
            <TimeSelect value={popup.checkInTime} onChange={(value) => setPopup({ ...popup, checkInTime: value })} />
          </div>
          <div className="field">
            <label>퇴실 시간</label>
            <TimeSelect value={popup.checkOutTime} onChange={(value) => setPopup({ ...popup, checkOutTime: value })} />
          </div>
          <div className="field">
            <label>외출 누적 시간(분)</label>
            <input type="number" min="0" value={popup.awayTotalMinutes} onChange={(e) => setPopup({ ...popup, awayTotalMinutes: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>조정 사유 메모</label>
          <input value={popup.note} onChange={(e) => setPopup({ ...popup, note: e.target.value })} placeholder="예: 입실 버튼을 10분 늦게 누름" />
        </div>
        <div className="popup-bottom-actions">
          <button className="secondary" onClick={requestClose}>{popup.requiredManualCheckIn ? '저장 전 닫기 불가' : '취소'}</button>
          <button className="primary" onClick={savePopup}>{popup.requiredManualCheckIn ? '입실시간 저장' : '조정 저장'}</button>
        </div>
      </div>
    </div>
  );
}



function ParentConfirmationAlertModal({ popup, setPopup, sendPopup, sendConfig }) {
  if (!popup) return null;
  const testMode = Boolean(sendConfig?.recipientPolicy?.testMode);
  const recipientCount = popup.preview?.recipientCount || popup.preview?.recipients?.length || 0;
  const templateReady = Boolean(sendConfig?.parentConfirmation?.configured || sendConfig?.provider?.solapiParentConfirmationTemplateConfigured);
  const statusText = popup.currentStatusText || popup.preview?.currentStatusText || '출결 상태 확인 필요';
  const plannedStudyTime = popup.plannedStudyTime || popup.preview?.plannedStudyTime || '-';
  const plannedBreakTime = popup.plannedBreakTime || popup.preview?.plannedBreakTime || '없음';
  const studentName = popup.preview?.studentName || popup.payload?.studentName || '학생';
  const templateEnvName = sendConfig?.parentConfirmation?.solapiTemplateEnvName || sendConfig?.parentConfirmation?.templateEnvName || 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION';
  const sendMethod = sendConfig?.provider?.actualSendMethod || sendConfig?.provider?.mode || '-';
  const lastResult = popup.result;

  function closeModal() {
    if (!popup.sending) setPopup(null);
  }

  function updateField(patch) {
    setPopup((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch, result: null, error: '' };
      const nextMessage = `[The Place 26 학부모 확인 요청]\n\n${studentName} 학생의 비욘드 썸머스쿨 출결 확인이 필요한 상황이 발생했습니다.\n\n- 금일 예정 학습 시간: ${next.plannedStudyTime || '-'}\n- 금일 예정 외출 시간: ${next.plannedBreakTime || '없음'}\n- 현재 상태: ${next.currentStatusText || '출결 상태 확인 필요'}\n\n담당자가 학생 확인을 진행한 뒤, 필요 시 학부모님께 추가 연락드리겠습니다.\n\n목동유쌤영어학원`;
      return { ...next, messageText: nextMessage };
    });
  }

  return (
    <div className="modal-backdrop" onClick={closeModal}>
      <div className="parent-confirmation-modal" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head parent-confirmation-head">
          <div>
            <h2>학부모 확인 요청 알림톡</h2>
            <p>발송 전 문구와 수신 상태를 확인한 뒤 발송하세요.</p>
          </div>
          <button className="parent-confirmation-close-button" type="button" onClick={closeModal} disabled={popup.sending} aria-label="학부모 확인 요청 알림톡 닫기" title="닫기">
            <span aria-hidden="true">×</span>
            <em>닫기</em>
          </button>
        </div>

        <div className={`attendance-notification-safety-banner ${testMode ? 'test' : 'live'}`}>
          <div>
            <strong>{testMode ? '현재 테스트모드 ON' : '현재 테스트모드 OFF'}</strong>
            <span>{testMode ? '실제 학부모 번호 대신 테스트 수신번호로 발송됩니다.' : '실제 보호자 연락처로 발송될 수 있습니다.'}</span>
          </div>
          <em>{templateReady ? '템플릿 확인됨' : '템플릿 미설정 확인 필요'}</em>
        </div>

        <div className="parent-confirmation-grid">
          <div className="field">
            <label>학생</label>
            <input value={studentName} readOnly />
          </div>
          <div className="field">
            <label>예정 학습 시간</label>
            <input value={plannedStudyTime} onChange={(e) => updateField({ plannedStudyTime: e.target.value })} />
          </div>
          <div className="field">
            <label>예정 외출 시간</label>
            <input value={plannedBreakTime} onChange={(e) => updateField({ plannedBreakTime: e.target.value })} placeholder="없음" />
          </div>
          <div className="field">
            <label>현재 상태</label>
            <input value={statusText} onChange={(e) => updateField({ currentStatusText: e.target.value })} />
          </div>
        </div>

        <div className="field">
          <label>발송 문구 미리보기</label>
          <textarea className="parent-confirmation-preview-textarea" value={popup.messageText || ''} onChange={(e) => setPopup({ ...popup, messageText: e.target.value, result: null, error: '' })} />
          <div className="hint parent-confirmation-template-hint">실제 알림톡은 승인된 템플릿의 변수값 기준으로 발송됩니다. 문구 구조를 크게 바꾸려면 SOLAPI 템플릿도 동일하게 승인되어 있어야 합니다.</div>
        </div>

        <div className="parent-confirmation-status-grid">
          <div><span>보호자 수신자</span><strong>{recipientCount ? `${recipientCount}명` : '없음'}</strong></div>
          <div><span>학부모 확인 요청 템플릿</span><strong>{templateReady ? '설정됨' : '미설정'}</strong><small>{templateEnvName}</small></div>
          <div><span>발송 방식</span><strong>{sendMethod}</strong><small>{testMode ? '테스트 수신번호 적용' : '실제 보호자 번호 적용'}</small></div>
        </div>

        {popup.preview?.recipients?.length ? (
          <div className="parent-confirmation-recipients">
            {popup.preview.recipients.map((recipient, index) => (
              <span key={`${recipient.phoneMasked || recipient.phone}-${index}`}>{recipient.relationship || recipient.name || '보호자'} · {recipient.phoneMasked || '-'}</span>
            ))}
          </div>
        ) : <div className="status-alert warning">등록된 보호자 연락처가 없습니다. 학생 관리에서 연락처를 확인하세요.</div>}

        {lastResult ? (
          <div className={`parent-confirmation-result ${lastResult.ok ? 'success' : 'failed'}`}>
            <strong>{lastResult.title}</strong>
            <span>{lastResult.message}</span>
            <small>{lastResult.detail}</small>
          </div>
        ) : null}

        {popup.error ? <div className="status-alert failed">{popup.error}</div> : null}

        <div className="popup-bottom-actions">
          <button className="secondary" onClick={() => sendPopup({ saveDraft: true })} disabled={popup.sending}>초안만 저장</button>
          <button className="secondary" onClick={closeModal} disabled={popup.sending}>{lastResult?.ok ? '닫기' : '취소'}</button>
          <button className="danger" onClick={() => sendPopup({ saveDraft: false })} disabled={popup.sending || !recipientCount}>{popup.sending ? '발송 중...' : testMode ? '테스트 수신번호로 발송' : '학부모에게 실제 발송'}</button>
        </div>
      </div>
    </div>
  );
}

function AlertCenter({ alerts, nowTick, onConfirm, onNotifyParent }) {
  return (
    <section className="alert-center">
      <div className="alert-center-head">
        <h2>오늘의 시간표 알림센터</h2>
        <span>자동 갱신: {formatKstTime(nowTick)}</span>
      </div>
      {alerts.length ? (
        <div className="alert-list">
          {alerts.map((alert) => (
            <div className="alert-card" key={alert.id}>
              <div>
                <strong>{alert.title}</strong>
                <span>{alert.body}</span>
              </div>
              <div className="alert-actions">
                {alert.mode === 'preview' ? (
                  <button className="secondary" onClick={() => onConfirm(alert)}>확인</button>
                ) : (
                  <>
                    <button className="primary" onClick={() => onConfirm(alert)}>입실확인</button>
                    <button className="danger" onClick={() => onNotifyParent(alert)}>학부모 알림</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : <div className="muted">현재 확인이 필요한 시간표 알림이 없습니다.</div>}
    </section>
  );
}



function ActivitySchedulePopup({ popup, setPopup, savePopup, updateBreak, addBreak, removeBreak, deletePopupSchedule }) {
  if (!popup) return null;
  return <div className="modal-backdrop" onClick={() => setPopup(null)}><div className="activity-popup" onClick={(event) => event.stopPropagation()}><div className="popup-head"><div><h2>액티비티 블록 수정</h2><p>{popup.studentName} / {popup.studentInfo || '학생 정보 없음'} / {popup.scheduleDate}</p></div><button onClick={() => setPopup(null)}>닫기</button></div><div className="activity-popup-grid"><section className="activity-popup-card"><h3>기본 등하원 조정</h3><div className="student-fixed-name"><span>학생</span><strong>{popup.studentName}</strong></div><div className="time-grid"><div className="field"><label>날짜</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={popup.scheduleDate} onChange={(e) => setPopup({ ...popup, scheduleDate: e.target.value })} /></div><div className="field"><label>학부모 확인</label><select value={popup.parentConfirmed ? 'yes' : 'no'} onChange={(e) => setPopup({ ...popup, parentConfirmed: e.target.value === 'yes' })}><option value="yes">확인 완료</option><option value="no">미확인</option></select></div><div className="field"><label>예정 등원</label><TimeSelect value={popup.plannedCheckIn} onChange={(value) => setPopup({ ...popup, plannedCheckIn: value })} /></div><div className="field"><label>예정 하원</label><TimeSelect value={popup.plannedCheckOut} onChange={(value) => setPopup({ ...popup, plannedCheckOut: value })} /></div></div><div className="repeat-box"><h4>등하원 반복 설정</h4><div className="time-grid"><div className="field"><label>반복</label><select value={popup.commuteRepeat} onChange={(e) => setPopup({ ...popup, commuteRepeat: e.target.value })}>{REPEAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label>반복 종료일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={popup.commuteRepeatUntil} onChange={(e) => setPopup({ ...popup, commuteRepeatUntil: e.target.value })} /></div></div></div><div className="field"><label>학부모 확인 메모</label><input value={popup.confirmationNote} onChange={(e) => setPopup({ ...popup, confirmationNote: e.target.value })} placeholder="예: 6/25 어머니 확인 완료" /></div><div className="field"><label>일정 메모</label><textarea value={popup.scheduleNote} onChange={(e) => setPopup({ ...popup, scheduleNote: e.target.value })} placeholder="예: 학교 행사로 10시 등원" /></div></section><section className="activity-popup-card"><h3>외출 일정 입력</h3>{(popup.breaks || []).map((item, index) => <div className="break-row" key={index}><div className="time-grid"><div className="field"><label>외출 시작</label><TimeSelect value={item.leaveStart} onChange={(value) => updateBreak(index, 'leaveStart', value)} /></div><div className="field"><label>복귀 예정</label><TimeSelect value={item.returnTime} onChange={(value) => updateBreak(index, 'returnTime', value)} /></div><div className="field"><label>외출 사유</label><select value={item.reason} onChange={(e) => updateBreak(index, 'reason', e.target.value)}>{BREAK_REASON_OPTIONS.map((reason) => <option key={reason}>{reason}</option>)}</select></div><div className="field"><label>상세 사유</label><input value={item.reasonDetail} onChange={(e) => updateBreak(index, 'reasonDetail', e.target.value)} placeholder="예: 고수학 특강" /></div></div><div className="field"><label>외출 메모</label><input value={item.breakNote} onChange={(e) => updateBreak(index, 'breakNote', e.target.value)} placeholder="예: 학부모 확인 완료" /></div><button className="danger" onClick={() => removeBreak(index)}>외출 항목 삭제</button></div>)}<button className="secondary add-break-button" onClick={addBreak}>외출 항목 추가</button><div className="repeat-box"><h4>외출 반복 설정</h4><div className="time-grid"><div className="field"><label>반복</label><select value={popup.breakRepeat} onChange={(e) => setPopup({ ...popup, breakRepeat: e.target.value })}>{REPEAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label>반복 종료일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={popup.breakRepeatUntil} onChange={(e) => setPopup({ ...popup, breakRepeatUntil: e.target.value })} /></div></div></div><div className="activity-preview"><strong>반영 후 액티비티 구조</strong><span>차시 구간은 설정 탭의 요일 유형별 기본 시간표 기준으로 표시되며, 외출과 겹치는 학습 구간은 자동으로 제외됩니다. 저장하면 이 날짜가 등원 예정으로 처리됩니다.</span></div></section></div><div className="popup-bottom-actions">{deletePopupSchedule ? <div className="delete-repeat-group"><select value={popup.deleteRepeat || 'none'} onChange={(e) => setPopup({ ...popup, deleteRepeat: e.target.value })} title="삭제 반복">{REPEAT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{value === 'none' ? '이 날짜만' : `${label} 삭제`}</option>)}</select>{(popup.deleteRepeat || 'none') !== 'none' ? <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={popup.deleteRepeatUntil || popup.scheduleDate} onChange={(e) => setPopup({ ...popup, deleteRepeatUntil: e.target.value })} title="삭제 반복 종료일" /> : null}<button className="danger" onClick={deletePopupSchedule}>{(popup.deleteRepeat || 'none') !== 'none' ? '반복 삭제' : '이 날짜 삭제'}</button></div> : null}<button className="secondary" onClick={() => setPopup(null)}>취소</button><button className="primary" onClick={savePopup}>확인 및 시간표 반영</button></div></div></div>;
}


function ScheduleQuickPopup({ popup, students, setPopup, applyPopup }) {
  if (!popup) return null;

  const selectedStudent = students.find((student) => student.id === popup.studentId);

  return (
    <div className="modal-backdrop" onClick={() => setPopup(null)}>
      <div className="schedule-popup" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head">
          <div>
            <h2>새 일정 빠른 입력</h2>
            <p>{popup.date} · {popup.time} 기준</p>
          </div>
          <button onClick={() => setPopup(null)}>닫기</button>
        </div>

        <div className="field">
          <label>학생</label>
          <select value={popup.studentId} onChange={(e) => setPopup({ ...popup, studentId: e.target.value })}>
            <option value="">학생 선택</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} / {[student.school, student.grade].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="time-grid">
          <div className="field">
            <label>일정 유형</label>
            <select value={popup.type} onChange={(e) => setPopup({ ...popup, type: e.target.value })}>
              <option value="checkin">등원</option>
              <option value="break">외출</option>
              <option value="checkout">하원</option>
            </select>
          </div>
          <div className="field">
            <label>기준 시간</label>
            <TimeSelect value={popup.time} onChange={(value) => setPopup({ ...popup, time: value })} />
          </div>
        </div>

        {popup.type === 'break' ? (
          <>
            <div className="time-grid">
              <div className="field">
                <label>복귀 예정</label>
                <TimeSelect value={popup.returnTime} onChange={(value) => setPopup({ ...popup, returnTime: value })} />
              </div>
              <div className="field">
                <label>외출 사유</label>
                <select value={popup.reason} onChange={(e) => setPopup({ ...popup, reason: e.target.value })}>
                  {BREAK_REASON_OPTIONS.map((reason) => <option key={reason}>{reason}</option>)}
                </select>
              </div>
            </div>
            <div className="field">
              <label>상세 사유</label>
              <input value={popup.reasonDetail} onChange={(e) => setPopup({ ...popup, reasonDetail: e.target.value })} placeholder="예: 고수학 특강" />
            </div>
            <div className="field">
              <label>외출 메모</label>
              <input value={popup.note} onChange={(e) => setPopup({ ...popup, note: e.target.value })} placeholder="예: 학부모 확인 완료" />
            </div>
          </>
        ) : null}

        <div className="popup-preview">
          <strong>반영 대상</strong>
          <span>
            {selectedStudent ? selectedStudent.name : '학생 미선택'} · {popup.type === 'checkin' ? '등원' : popup.type === 'checkout' ? '하원' : '외출'} · {popup.time}
          </span>
        </div>

        <div className="btn-row">
          <button className="secondary" onClick={() => setPopup(null)}>취소</button>
          <button className="primary" onClick={applyPopup}>입력폼에 반영</button>
        </div>
        <div className="hint">입력폼에 반영한 뒤, 아래의 “시간표 저장” 버튼을 눌러야 DB에 저장됩니다.</div>
      </div>
    </div>
  );
}



function getKstDateOnly(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

function getHoldSignalDirection(eventType) {
  if (eventType === 'away' || eventType === 'check_out') return 'exit';
  if (eventType === 'return' || eventType === 'check_in') return 'entry';
  return 'other';
}

function buildKioskHoldBreakGroups(holds = []) {
  const periodMap = new Map();
  for (const item of holds || []) {
    const date = getKstDateOnly(item.event_at) || '날짜 미확인';
    const periodKey = [date, item.break_start_time || '', item.break_end_time || '', item.break_label || '쉬는 시간'].join('|');
    if (!periodMap.has(periodKey)) {
      periodMap.set(periodKey, {
        key: periodKey,
        date,
        label: item.break_label || '쉬는 시간',
        startTime: item.break_start_time || '-',
        endTime: item.break_end_time || '-',
        items: [],
      });
    }
    periodMap.get(periodKey).items.push(item);
  }

  return Array.from(periodMap.values())
    .map((period) => {
      const studentMap = new Map();
      for (const item of period.items) {
        const studentKey = item.student_id || item.students?.id || `unknown-${item.id}`;
        if (!studentMap.has(studentKey)) {
          studentMap.set(studentKey, {
            key: `${period.key}|${studentKey}`,
            studentId: studentKey,
            student: item.students || null,
            seatNo: item.seat_no || item.students?.default_seat_no || null,
            signals: [],
          });
        }
        studentMap.get(studentKey).signals.push(item);
      }

      const students = Array.from(studentMap.values()).map((group) => {
        const signals = [...group.signals].sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
        let openExits = 0;
        let pairCount = 0;
        let unmatchedEntries = 0;
        for (const signal of signals) {
          const direction = getHoldSignalDirection(signal.event_type);
          if (direction === 'exit') openExits += 1;
          else if (direction === 'entry') {
            if (openExits > 0) {
              openExits -= 1;
              pairCount += 1;
            } else unmatchedEntries += 1;
          }
        }
        const unmatchedExits = openExits;
        const complete = pairCount > 0 && unmatchedExits === 0 && unmatchedEntries === 0;
        const partial = pairCount > 0 && !complete;
        const status = complete ? 'complete' : partial ? 'partial' : 'unmatched';
        const ids = signals.map((item) => item.id);
        return {
          ...group,
          signals,
          ids,
          pairCount,
          unmatchedExits,
          unmatchedEntries,
          status,
          sequenceLabel: signals.map((item) => `${formatKstTime(item.event_at)} ${getKioskEventLabel(item.event_type)}`).join(' → '),
        };
      }).sort((a, b) => {
        const rank = { unmatched: 0, partial: 1, complete: 2 };
        const statusDiff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        if (statusDiff) return statusDiff;
        return String(a.student?.name || '').localeCompare(String(b.student?.name || ''), 'ko');
      });

      return {
        ...period,
        students,
        ids: period.items.map((item) => item.id),
        completeCount: students.filter((item) => item.status === 'complete').length,
        incompleteCount: students.filter((item) => item.status !== 'complete').length,
      };
    })
    .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
}

function buildKioskHoldHistoryGroups(history = []) {
  const map = new Map();
  for (const item of history || []) {
    const key = `${item.batch_id || item.id}|${item.action_type}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        batchId: item.batch_id || item.id,
        actionType: item.action_type,
        createdAt: item.created_at,
        actorName: item.actor_name || '관리자',
        actions: [],
      });
    }
    const group = map.get(key);
    group.actions.push(item);
    if (new Date(item.created_at) > new Date(group.createdAt)) group.createdAt = item.created_at;
  }
  return Array.from(map.values()).map((group) => {
    const holds = group.actions.map((item) => item.hold).filter(Boolean);
    const undoableActionIds = group.actions.filter((item) => item.undoable).map((item) => item.id);
    const orderedHolds = [...holds].sort((a, b) => new Date(a.event_at) - new Date(b.event_at));
    const studentNames = Array.from(new Set(orderedHolds.map((item) => item.students?.name || '학생 미확인'))).join(', ');
    const signalSummary = orderedHolds.map((item) => `${formatKstTime(item.event_at)} ${getKioskEventLabel(item.event_type)}`).join(' → ');
    return {
      ...group,
      holds: orderedHolds,
      studentNames,
      signalSummary,
      breakLabel: orderedHolds[0]?.break_label || '쉬는 시간',
      undoableActionIds,
      canUndo: ['apply', 'discard'].includes(group.actionType) && undoableActionIds.length === group.actions.length,
    };
  }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function DashboardTab({ summary, view, seatsForDisplay, sessionBySeat, selectedSeatNo, selectSeat, students, nowTick, apiFetch, loadDashboard, setMessage, currentUser, scheduleAlerts = [], onDismissFocusAlert, dismissedAlertMemos = {}, mentoringTodayAssignments = [], checksBySession = {}, defaultSchedule = DEFAULT_SCHEDULE_SETTINGS }) {
  const [seatFilter, setSeatFilter] = useState('all');
  const [seatSearch, setSeatSearch] = useState('');
  const [quickMode, setQuickMode] = useState(false);
  const [selectedQuickSeats, setSelectedQuickSeats] = useState([]);
  const [quickSubject, setQuickSubject] = useState('수학');
  const [quickStudyStatus, setQuickStudyStatus] = useState('문제풀이');
  const [quickStudyContent, setQuickStudyContent] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickNotice, setQuickNotice] = useState('');
  const [recentQuickCombos, setRecentQuickCombos] = useState([]);
  const [kioskHolds, setKioskHolds] = useState([]);
  const [kioskHoldLoading, setKioskHoldLoading] = useState(false);
  const [selectedKioskHoldIds, setSelectedKioskHoldIds] = useState([]);
  const [kioskHoldHistory, setKioskHoldHistory] = useState([]);
  const [kioskHoldView, setKioskHoldView] = useState('pending');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('beyond_quick_study_combos_v41_12');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setRecentQuickCombos(parsed.slice(0, 8));
      }
    } catch {
      setRecentQuickCombos([]);
    }
  }, []);

  async function loadKioskHolds({ silent = false } = {}) {
    if (!apiFetch) return;
    if (!silent) setKioskHoldLoading(true);
    try {
      const data = await apiFetch('/api/kiosk-attendance-holds?status=pending&includeHistory=1');
      setKioskHolds(Array.isArray(data.holds) ? data.holds : []);
      setKioskHoldHistory(Array.isArray(data.history) ? data.history : []);
      setSelectedKioskHoldIds((prev) => prev.filter((id) => (data.holds || []).some((item) => item.id === id)));
    } catch (error) {
      if (!silent) setMessage?.(error.message || '키오스크 HOLD 목록을 불러오지 못했습니다.');
    } finally {
      if (!silent) setKioskHoldLoading(false);
    }
  }

  useEffect(() => {
    loadKioskHolds({ silent: true });
    const timer = window.setInterval(() => loadKioskHolds({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [apiFetch]);

  function toggleKioskHoldSelection(id) {
    setSelectedKioskHoldIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  async function runKioskHoldAction(item, action) {
    const labelMap = { check_in: '입실', away: '외출', return: '복귀', check_out: '퇴실' };
    const studentName = item?.students?.name || '학생';
    if (action === 'apply' && !window.confirm(`${studentName} 학생의 ${labelMap[item.event_type] || item.event_type} 신호를 실제 출결로 반영할까요?`)) return;
    if (action === 'discard' && !window.confirm(`${studentName} 학생의 HOLD 신호를 쉬는 시간 이동으로 보고 삭제할까요?`)) return;
    setKioskHoldLoading(true);
    try {
      const data = await apiFetch('/api/kiosk-attendance-holds', {
        method: 'POST',
        body: JSON.stringify({ action, id: item.id, importEventIds: item.import_event_id ? [item.import_event_id] : [] }),
      });
      setMessage?.(data.message || (action === 'apply' ? '실제 출결로 반영했습니다.' : 'HOLD 목록에서 삭제했습니다.'));
      await Promise.all([loadKioskHolds({ silent: true }), loadDashboard?.({ silent: true, suppressChangeNotice: true })]);
    } catch (error) {
      setMessage?.(error.message || 'HOLD 처리에 실패했습니다.');
    } finally {
      setKioskHoldLoading(false);
    }
  }

  function toggleKioskHoldGroupSelection(ids = []) {
    const normalized = ids.filter(Boolean);
    if (!normalized.length) return;
    setSelectedKioskHoldIds((prev) => {
      const allSelected = normalized.every((id) => prev.includes(id));
      if (allSelected) return prev.filter((id) => !normalized.includes(id));
      return Array.from(new Set([...prev, ...normalized]));
    });
  }

  async function runKioskHoldGroupAction(group, action) {
    const ids = Array.isArray(group?.ids) ? group.ids.filter(Boolean) : [];
    if (!ids.length) return;
    const studentName = group?.student?.name || '선택 학생';
    const actionLabel = action === 'apply_group' ? '실제 출결로 반영' : '쉬는 시간 이동으로 처리';
    const warning = action === 'apply_group'
      ? `${studentName} 학생의 ${group.sequenceLabel || `${ids.length}건 신호`}를 시간순으로 실제 출결에 반영할까요?

출결 알림이 발송된 뒤 되돌려도 이미 전송된 알림은 취소되지 않습니다.`
      : `${studentName} 학생의 ${ids.length}건 신호를 쉬는 시간 이동으로 처리할까요?`;
    if (!window.confirm(warning)) return;
    setKioskHoldLoading(true);
    try {
      const data = await apiFetch('/api/kiosk-attendance-holds', {
        method: 'POST',
        body: JSON.stringify({ action, ids }),
      });
      setMessage?.(data.message || `${ids.length}건을 ${actionLabel}했습니다.`);
      setSelectedKioskHoldIds((prev) => prev.filter((id) => !ids.includes(id)));
      await Promise.all([loadKioskHolds({ silent: true }), loadDashboard?.({ silent: true, suppressChangeNotice: true })]);
    } catch (error) {
      setMessage?.(error.message || `HOLD ${actionLabel}에 실패했습니다.`);
    } finally {
      setKioskHoldLoading(false);
    }
  }

  async function discardKioskHoldPeriod(period) {
    const ids = Array.isArray(period?.ids) ? period.ids.filter(Boolean) : [];
    if (!ids.length) return;
    if (!window.confirm(`${period.date} ${period.label}의 HOLD ${ids.length}건을 모두 쉬는 시간 이동으로 처리할까요?`)) return;
    setKioskHoldLoading(true);
    try {
      const data = await apiFetch('/api/kiosk-attendance-holds', {
        method: 'POST',
        body: JSON.stringify({ action: 'discard_group', ids }),
      });
      setMessage?.(data.message || `${ids.length}건을 쉬는 시간 이동으로 처리했습니다.`);
      setSelectedKioskHoldIds((prev) => prev.filter((id) => !ids.includes(id)));
      await loadKioskHolds({ silent: true });
    } catch (error) {
      setMessage?.(error.message || '쉬는 시간 구간 일괄 처리에 실패했습니다.');
    } finally {
      setKioskHoldLoading(false);
    }
  }

  async function undoKioskHoldHistoryGroup(group) {
    const actionIds = Array.isArray(group?.undoableActionIds) ? group.undoableActionIds.filter(Boolean) : [];
    if (!actionIds.length) return;
    const actionLabel = group.actionType === 'apply' ? '실제 출결 반영' : '쉬는 시간 처리';
    if (!window.confirm(`${actionLabel} ${actionIds.length}건을 판정 대기로 되돌릴까요?

이미 발송된 학부모 알림은 취소되지 않습니다.`)) return;
    setKioskHoldLoading(true);
    try {
      const data = await apiFetch('/api/kiosk-attendance-holds', {
        method: 'POST',
        body: JSON.stringify({ action: 'undo_batch', actionIds }),
      });
      setMessage?.(data.message || `${actionIds.length}건을 되돌렸습니다.`);
      await Promise.all([loadKioskHolds({ silent: true }), loadDashboard?.({ silent: true, suppressChangeNotice: true })]);
      setKioskHoldView('pending');
    } catch (error) {
      setMessage?.(error.message || 'HOLD 처리 되돌리기에 실패했습니다.');
    } finally {
      setKioskHoldLoading(false);
    }
  }

  async function discardSelectedKioskHolds() {
    const selected = kioskHolds.filter((item) => selectedKioskHoldIds.includes(item.id));
    if (!selected.length) return;
    if (!window.confirm(`선택한 ${selected.length}건을 쉬는 시간 이동으로 보고 HOLD 목록에서 일괄 삭제할까요?`)) return;
    setKioskHoldLoading(true);
    try {
      await apiFetch('/api/kiosk-attendance-holds', {
        method: 'POST',
        body: JSON.stringify({
          action: 'bulk_discard',
          ids: selected.map((item) => item.id),
          importEventIds: selected.map((item) => item.import_event_id).filter(Boolean),
        }),
      });
      setMessage?.(`${selected.length}건을 HOLD 목록에서 삭제했습니다.`);
      setSelectedKioskHoldIds([]);
      await loadKioskHolds({ silent: true });
    } catch (error) {
      setMessage?.(error.message || 'HOLD 일괄 삭제에 실패했습니다.');
    } finally {
      setKioskHoldLoading(false);
    }
  }

  const defaultSeatStudentByNo = useMemo(() => {
    const rows = {};
    for (const student of students || []) {
      if (!student?.id || (student.status || 'active') !== 'active') continue;
      const seatNo = Number(student.default_seat_no || student.defaultSeatNo || 0);
      if (!seatNo || !Number.isFinite(seatNo)) continue;
      if (!rows[seatNo]) rows[seatNo] = student;
    }
    return rows;
  }, [students]);

  const assignedSeatNoByStudentId = {};

  // 학생 DB의 기본 좌석이 있으면 그것을 1순위 기준으로 사용합니다.
  for (const student of students || []) {
    if (student.id && student.default_seat_no) {
      assignedSeatNoByStudentId[student.id] = Number(student.default_seat_no);
    }
  }

  // default_seat_no가 없는 경우에는 seats 테이블의 현재 배정값을 사용합니다.
  // 같은 학생이 여러 좌석에 잘못 남아 있으면 뒤쪽 좌석값으로 덮어써 중복 표시를 방지합니다.
  for (const seat of seatsForDisplay || []) {
    const assignedId = seat.current_student_id || seat.current_student?.id;
    if (assignedId && !assignedSeatNoByStudentId[assignedId]) {
      assignedSeatNoByStudentId[assignedId] = Number(seat.seat_no);
    } else if (assignedId && assignedSeatNoByStudentId[assignedId] !== Number(seat.seat_no)) {
      const existing = Number(assignedSeatNoByStudentId[assignedId]);
      assignedSeatNoByStudentId[assignedId] = Math.max(existing, Number(seat.seat_no));
    }
  }

  function getSeatDisplay(seat) {
    const rawSession = sessionBySeat[seat.seat_no];
    const rawAssignedStudent = seat.current_student || null;
    const assignedStudentId = seat.current_student_id || rawAssignedStudent?.id;
    const sessionStudentId = rawSession?.student_id || rawSession?.students?.id;

    const assignedSeatNo = sessionStudentId ? assignedSeatNoByStudentId[sessionStudentId] : null;
    const currentStudentSeatNo = assignedStudentId ? assignedSeatNoByStudentId[assignedStudentId] : null;

    // v39: 세션 중복뿐 아니라 좌석 배정값(current_student) 자체가 여러 좌석에 남아 있는 경우도 제거합니다.
    const session = assignedSeatNo && assignedSeatNo !== Number(seat.seat_no) ? null : rawSession;
    const assignedStudent = currentStudentSeatNo && currentStudentSeatNo !== Number(seat.seat_no) ? null : rawAssignedStudent;

    const defaultSeatStudent = defaultSeatStudentByNo[Number(seat.seat_no)] || null;
    const student = session?.students || assignedStudent || defaultSeatStudent;
    const status = session?.seat_status || 'not_arrived';

    return { seat, session, student, status };
  }

  function getSeatTimeLabel(row) {
    const { session, status } = row;
    if (!session) return '오늘 기록 없음';
    if (status === 'occupied') return session.check_in_at ? `입실 ${formatKstTime(session.check_in_at)}` : '입실시간 없음';
    if (status === 'away') return session.away_started_at ? `외출 ${formatKstTime(session.away_started_at)}` : '외출 중';
    if (status === 'out') return session.check_out_at ? `퇴실 ${formatKstTime(session.check_out_at)}` : '퇴실 처리';
    if (status === 'absent') return '결석 처리';
    if (status === 'needs_attention') return '관리 확인 필요';
    return session.check_in_at ? `입실 ${formatKstTime(session.check_in_at)}` : '미입실';
  }

  function getSeatStudyChecks(row) {
    const sessionId = row?.session?.id;
    if (!sessionId) return [];
    return checksBySession[sessionId] || [];
  }

  function getLatestSeatStudyCheck(row) {
    return getLatestStudyCheckFromRows(getSeatStudyChecks(row));
  }

  const currentStudyPeriod = useMemo(() => getCurrentSchedulePeriodMeta(defaultSchedule, nowTick), [defaultSchedule, nowTick]);

  function getCurrentPeriodSeatStudyCheck(row) {
    if (!currentStudyPeriod?.isMatched) return null;
    return getStudyCheckForSchedulePeriod(getSeatStudyChecks(row), currentStudyPeriod);
  }

  function isCurrentPeriodStudyMissing(row) {
    return Boolean(row?.session?.id && row.status === 'occupied' && currentStudyPeriod?.isMatched && !getCurrentPeriodSeatStudyCheck(row));
  }

  function getCurrentPeriodMissingLabel() {
    return '학습상태 미입력';
  }

  function getSeatLearningLabel(row) {
    const { session, status } = row;
    if (!session) return '학습상태 없음';
    if (status === 'absent') return '결석';
    if (status === 'out') return '퇴실 완료';
    if (status === 'away') return '외출 중';
    const latestCheck = getLatestSeatStudyCheck(row);
    if (latestCheck) return formatStudyCheckSeatLabel(latestCheck, defaultSchedule);
    return status === 'occupied' ? '학습상태 입력 대기' : '학습상태 없음';
  }

  function getSeatSourceLabel(row) {
    const source = getAttendanceEventSourceLabel(row.session || {});
    if (!row.session) return '기록 없음';
    return source.replace(' 기록', '');
  }

  function getSeatIssue(row) {
    const { status } = row;
    if (status === 'needs_attention') return '관리필요 상태';
    if (isCurrentPeriodStudyMissing(row)) return getCurrentPeriodMissingLabel();
    return '';
  }

  function isQuickEligible(row) {
    return Boolean(row?.session?.id && row?.session?.student_id && row.status === 'occupied');
  }

  const seatRows = (seatsForDisplay || []).map(getSeatDisplay).sort((a, b) => Number(a.seat.seat_no) - Number(b.seat.seat_no));
  const statusCounts = seatRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const activeStudyRows = seatRows.filter((row) => row.status === 'occupied' && row.session);
  const studyStatusCounts = activeStudyRows.reduce((acc, row) => {
    const displayCheck = currentStudyPeriod?.isMatched ? getCurrentPeriodSeatStudyCheck(row) : getLatestSeatStudyCheck(row);
    const key = displayCheck?.study_status || (currentStudyPeriod?.isMatched ? `${currentStudyPeriod.label} 미입력` : '미입력');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const subjectCounts = activeStudyRows.reduce((acc, row) => {
    const displayCheck = currentStudyPeriod?.isMatched ? getCurrentPeriodSeatStudyCheck(row) : getLatestSeatStudyCheck(row);
    const key = displayCheck?.subject || (currentStudyPeriod?.isMatched ? `${currentStudyPeriod.label} 미입력` : '미입력');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const urgentScheduleAlerts = (scheduleAlerts || []).filter((alert) => ['return_check', 'attendance_mismatch', 'check_in_check'].includes(alert.type));
  const urgentAlertRank = { return_check: 0, attendance_mismatch: 1, check_in_check: 2 };
  const urgentAlertByStudentId = urgentScheduleAlerts.reduce((acc, alert) => {
    const studentId = alert.student?.id || alert.schedule?.student_id;
    if (!studentId) return acc;
    const nextRank = urgentAlertRank[alert.type] ?? 9;
    const currentRank = urgentAlertRank[acc[studentId]?.type] ?? 9;
    if (!acc[studentId] || nextRank < currentRank) acc[studentId] = alert;
    return acc;
  }, {});

  const mentoringCueMaps = useMemo(() => {
    const nowMinutes = currentKstMinutes();
    const byStudentId = {};
    const bySeatNo = {};

    function rememberCue({ studentId, seatNo, cue }) {
      if (!cue) return;
      if (studentId) {
        const key = String(studentId);
        const prev = byStudentId[key];
        if (!prev || cue.startMinutes < prev.startMinutes) byStudentId[key] = cue;
      }
      if (seatNo !== null && seatNo !== undefined && seatNo !== '') {
        const parsedSeatNo = Number(seatNo);
        if (Number.isFinite(parsedSeatNo)) {
          const prev = bySeatNo[parsedSeatNo];
          if (!prev || cue.startMinutes < prev.startMinutes) bySeatNo[parsedSeatNo] = cue;
        }
      }
    }

    for (const item of mentoringTodayAssignments || []) {
      const slot = item.mentoring_slots || item.slot || {};
      const start = timeToMinutes(slot.start_time || slot.startTime);
      let end = timeToMinutes(slot.end_time || slot.endTime);
      if (start === null) continue;
      if (end === null || end <= start) end = start + 50;
      if (nowMinutes < start - 10 || nowMinutes >= end) continue;

      const studentId = item.student_id || item.students?.id;
      if (!studentId) continue;

      const cue = {
        assignment: item,
        slot,
        startMinutes: start,
        endMinutes: end,
        label: `${slot.slot_label || '멘토링'} ${String(slot.start_time || '').slice(0, 5)}~${String(slot.end_time || '').slice(0, 5)}`,
      };

      const seatCandidates = [
        item.students?.default_seat_no,
        assignedSeatNoByStudentId[String(studentId)],
        assignedSeatNoByStudentId[studentId],
      ];
      const uniqueSeatCandidates = [...new Set(seatCandidates.filter((seatNo) => seatNo !== null && seatNo !== undefined && seatNo !== ''))];

      rememberCue({ studentId, seatNo: uniqueSeatCandidates[0], cue });
      uniqueSeatCandidates.slice(1).forEach((seatNo) => rememberCue({ studentId: null, seatNo, cue }));
    }

    return { byStudentId, bySeatNo };
  }, [mentoringTodayAssignments, nowTick, seatsForDisplay, sessionBySeat, students]);

  function getMentoringCue(row) {
    const defaultSeatStudent = defaultSeatStudentByNo[Number(row?.seat?.seat_no)] || null;
    const candidateStudentIds = [
      row?.session?.student_id,
      row?.session?.students?.id,
      row?.student?.id,
      row?.seat?.current_student_id,
      row?.seat?.current_student?.id,
      defaultSeatStudent?.id,
    ].filter(Boolean).map(String);

    for (const studentId of candidateStudentIds) {
      const cue = mentoringCueMaps.byStudentId[studentId];
      if (cue) return cue;
    }

    const seatNo = Number(row?.seat?.seat_no);
    return Number.isFinite(seatNo) ? mentoringCueMaps.bySeatNo[seatNo] || null : null;
  }

  function getUrgentAttention(row) {
    const studentId = row.session?.student_id || row.student?.id;
    const alert = studentId ? urgentAlertByStudentId[studentId] : null;
    if (!alert) return null;
    const issue = alert.type === 'return_check'
      ? '외출 복귀시간 경과'
      : alert.type === 'attendance_mismatch'
        ? (alert.issue || '개인시간표와 출결상태 불일치')
        : '시간표상 있어야 하나 미입실';
    return {
      alert,
      issue,
      detail: alert.body || alert.title || '',
    };
  }

  function getDashboardIssue(row) {
    const urgent = getUrgentAttention(row);
    if (urgent) return urgent.issue;
    return getSeatIssue(row);
  }

  const issueRows = seatRows
    .map((row) => {
      const urgent = getUrgentAttention(row);
      return { ...row, urgentAttention: urgent, issue: urgent?.issue || getSeatIssue(row) };
    })
    .filter((row) => row.issue)
    .sort((a, b) => {
      if (Boolean(a.urgentAttention) !== Boolean(b.urgentAttention)) return a.urgentAttention ? -1 : 1;
      const rank = { needs_attention: 0, occupied: 3, not_arrived: 4, away: 5, out: 6, absent: 7 };
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || Number(a.seat.seat_no) - Number(b.seat.seat_no);
    });

  const normalizedSearch = String(seatSearch || '').trim().toLowerCase();
  function matchesFilter(row) {
    if (seatFilter === 'needs_attention') {
      if (row.status !== 'needs_attention' && !getUrgentAttention(row)) return false;
    } else if (seatFilter === 'mentoring') {
      if (!getMentoringCue(row)) return false;
    } else if (seatFilter !== 'all' && row.status !== seatFilter) return false;
    if (!normalizedSearch) return true;
    const haystack = [
      row.seat.seat_no,
      `${row.seat.seat_no}번`,
      row.student?.name,
      row.student?.school,
      row.student?.grade,
      STATUS_LABELS[row.status],
      getSeatLearningLabel(row),
      getMentoringCue(row)?.label,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(normalizedSearch);
  }

  const visibleRows = seatRows.filter(matchesFilter);
  const quickEligibleRows = visibleRows.filter(isQuickEligible);
  const missingStudyRows = quickEligibleRows.filter((row) => isCurrentPeriodStudyMissing(row));
  const missingStudySelectLabel = currentStudyPeriod ? `${currentStudyPeriod.label} 미입력 ${missingStudyRows.length}명 선택` : `미입력 ${missingStudyRows.length}명 선택`;
  const selectedQuickSeatSet = new Set(selectedQuickSeats.map(Number));
  const selectedQuickRows = seatRows.filter((row) => selectedQuickSeatSet.has(Number(row.seat.seat_no)) && isQuickEligible(row));
  const selectedQuickCount = selectedQuickRows.length;

  const filterButtons = [
    ['all', '전체', seatRows.length],
    ['occupied', '입실', statusCounts.occupied || 0],
    ['away', '외출', statusCounts.away || 0],
    ['not_arrived', '미입실', statusCounts.not_arrived || 0],
    ['out', '퇴실', statusCounts.out || 0],
    ['absent', '결석', statusCounts.absent || 0],
    ['needs_attention', '관리필요', seatRows.filter((row) => row.status === 'needs_attention' || getUrgentAttention(row)).length],
    ['mentoring', '멘토링예정', seatRows.filter((row) => getMentoringCue(row)).length],
  ];

  const topStudyStats = Object.entries(studyStatusCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const topSubjectStats = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));

  function toggleQuickMode() {
    const next = !quickMode;
    setQuickMode(next);
    setQuickNotice(next ? '순찰 모드가 켜졌습니다. 입실 좌석을 여러 개 선택한 뒤 일괄 저장하세요.' : '순찰 모드가 꺼졌습니다.');
    if (!next) setSelectedQuickSeats([]);
  }

  function toggleQuickSeat(row) {
    if (!isQuickEligible(row)) {
      selectSeat(row.seat.seat_no);
      return;
    }
    setSelectedQuickSeats((prev) => {
      const seatNo = Number(row.seat.seat_no);
      return prev.map(Number).includes(seatNo) ? prev.filter((item) => Number(item) !== seatNo) : [...prev, seatNo];
    });
  }

  function handleSeatClick(row) {
    if (quickMode) {
      toggleQuickSeat(row);
      return;
    }
    selectSeat(row.seat.seat_no);
  }

  function selectQuickRows(rows) {
    const seatNos = rows.filter(isQuickEligible).map((row) => Number(row.seat.seat_no));
    setSelectedQuickSeats(Array.from(new Set(seatNos)).sort((a, b) => a - b));
  }

  function applyRecentCombo(combo) {
    setQuickSubject(combo.subject || '수학');
    setQuickStudyStatus(combo.studyStatus || combo.study_status || '문제풀이');
    setQuickStudyContent(combo.studyContent || combo.study_content || '');
    setQuickNotice(`최근 입력값 적용: ${combo.subject || '-'} / ${combo.studyStatus || combo.study_status || '-'}`);
  }

  function rememberQuickCombo() {
    const combo = {
      subject: quickSubject,
      studyStatus: quickStudyStatus,
      studyContent: quickStudyContent || '',
      savedAt: new Date().toISOString(),
    };
    const key = `${combo.subject}::${combo.studyStatus}::${combo.studyContent}`;
    const next = [combo, ...recentQuickCombos.filter((item) => `${item.subject}::${item.studyStatus || item.study_status}::${item.studyContent || item.study_content || ''}` !== key)].slice(0, 8);
    setRecentQuickCombos(next);
    try {
      window.localStorage.setItem('beyond_quick_study_combos_v41_12', JSON.stringify(next));
    } catch {
      // localStorage가 막혀 있어도 저장 자체는 진행합니다.
    }
  }

  async function saveQuickStudyChecks(rows = selectedQuickRows) {
    if (!rows.length) {
      setQuickNotice('저장할 입실 좌석을 먼저 선택하세요.');
      return;
    }
    if (!apiFetch) {
      setQuickNotice('API 연결 정보를 찾지 못했습니다. 우측 패널의 기존 순찰 체크 저장을 사용하세요.');
      return;
    }

    setQuickSaving(true);
    setQuickNotice(`${rows.length}개 좌석 순찰 체크 저장 중...`);
    try {
      for (const row of rows) {
        await apiFetch('/api/check', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: row.session.id,
            studentId: row.session.student_id,
            seatNo: row.seat.seat_no,
            studyStatus: quickStudyStatus,
            subject: quickSubject,
            studyContent: quickStudyContent,
            adminName: currentUser?.displayName || '관리자',
          }),
        });
      }
      rememberQuickCombo();
      setSelectedQuickSeats([]);
      await loadDashboard?.({ silent: true, suppressChangeNotice: true });
      const message = `${rows.length}개 좌석에 ${quickSubject} / ${quickStudyStatus} 순찰 체크를 저장했습니다.`;
      setQuickNotice(message);
      setMessage?.(message);
    } catch (error) {
      const message = error.message || '순찰 체크 저장에 실패했습니다.';
      setQuickNotice(message);
      setMessage?.(message);
    } finally {
      setQuickSaving(false);
    }
  }

  function resolvePriorityAttention(row) {
    const urgent = row?.urgentAttention || getUrgentAttention(row);
    if (!urgent?.alert) {
      selectSeat(row.seat.seat_no);
      return;
    }
    const studentName = row.student?.name || urgent.alert.student?.name || '학생';
    const memo = window.prompt(`${studentName} 학생 집중관리 해제 메모를 입력하세요.\n\n사유: ${urgent.issue}\n내용을 파악했거나 조치를 완료한 경우에만 해제하세요.`, '현장 확인 완료');
    if (memo === null) return;
    onDismissFocusAlert?.(urgent.alert, memo);
  }


  const kioskHoldBreakGroups = useMemo(() => buildKioskHoldBreakGroups(kioskHolds), [kioskHolds]);
  const kioskHoldHistoryGroups = useMemo(() => buildKioskHoldHistoryGroups(kioskHoldHistory), [kioskHoldHistory]);

  const dismissedFocusHistory = Object.entries(dismissedAlertMemos || {})
    .map(([id, item]) => ({ id, ...(item || {}) }))
    .sort((a, b) => new Date(b.dismissedAt || 0) - new Date(a.dismissedAt || 0))
    .slice(0, 5);

  return (
    <>
      {(kioskHolds.length || kioskHoldHistory.length) ? (
        <section className="kiosk-hold-panel kiosk-hold-panel-v41362">
          <div className="kiosk-hold-head">
            <div>
              <h3>쉬는 시간 키오스크 HOLD <b>{kioskHolds.length}</b></h3>
              <p>같은 학생의 외출·복귀 신호는 한 줄로 묶고, 쉬는 시간 구간별로 정리합니다. 미완결 신호는 먼저 표시됩니다.</p>
            </div>
            <div className="kiosk-hold-head-actions">
              <div className="kiosk-hold-view-tabs">
                <button type="button" className={kioskHoldView === 'pending' ? 'active' : ''} onClick={() => setKioskHoldView('pending')}>판정 대기 {kioskHolds.length}</button>
                <button type="button" className={kioskHoldView === 'history' ? 'active' : ''} onClick={() => setKioskHoldView('history')}>처리 이력 {kioskHoldHistoryGroups.length}</button>
              </div>
              <button type="button" className="secondary" onClick={() => loadKioskHolds()} disabled={kioskHoldLoading}>{kioskHoldLoading ? '새로고침 중' : '새로고침'}</button>
              {kioskHoldView === 'pending' ? <button type="button" className="danger" onClick={discardSelectedKioskHolds} disabled={!selectedKioskHoldIds.length || kioskHoldLoading}>선택 {selectedKioskHoldIds.length}건 쉬는 시간 처리</button> : null}
            </div>
          </div>

          {kioskHoldView === 'pending' ? (
            kioskHoldBreakGroups.length ? (
              <div className="kiosk-hold-period-list">
                {kioskHoldBreakGroups.map((period) => {
                  const periodAllSelected = period.ids.length > 0 && period.ids.every((id) => selectedKioskHoldIds.includes(id));
                  return (
                    <section key={period.key} className="kiosk-hold-period">
                      <div className="kiosk-hold-period-head">
                        <label className="kiosk-hold-check"><input type="checkbox" checked={periodAllSelected} onChange={() => toggleKioskHoldGroupSelection(period.ids)} /><span></span></label>
                        <div className="kiosk-hold-period-title">
                          <strong>{period.date} · {period.label}</strong>
                          <span>HOLD {period.startTime}~{period.endTime} · 학생 {period.students.length}명 · 신호 {period.ids.length}건</span>
                        </div>
                        <div className="kiosk-hold-period-summary">
                          {period.incompleteCount ? <em className="warning">미완결 {period.incompleteCount}명</em> : null}
                          {period.completeCount ? <em className="complete">외출·복귀 완결 {period.completeCount}명</em> : null}
                          <button type="button" className="secondary mini" onClick={() => discardKioskHoldPeriod(period)} disabled={kioskHoldLoading}>이 구간 전체 쉬는 시간 처리</button>
                        </div>
                      </div>
                      <div className="kiosk-hold-student-list">
                        {period.students.map((group) => {
                          const allSelected = group.ids.every((id) => selectedKioskHoldIds.includes(id));
                          const statusText = group.status === 'complete'
                            ? '외출·복귀 한 쌍'
                            : group.status === 'partial'
                              ? '⚠ 일부 신호가 미완결'
                              : group.unmatchedExits > 0 && group.unmatchedEntries === 0
                                ? '⚠ 외출·퇴실 신호만 있음'
                                : group.unmatchedEntries > 0 && group.unmatchedExits === 0
                                  ? '⚠ 복귀·입실 신호만 있음'
                                  : '⚠ 신호 짝이 맞지 않음';
                          return (
                            <div key={group.key} className={`kiosk-hold-student-group ${group.status} ${allSelected ? 'selected' : ''}`}>
                              <label className="kiosk-hold-check"><input type="checkbox" checked={allSelected} onChange={() => toggleKioskHoldGroupSelection(group.ids)} /><span></span></label>
                              <div className="kiosk-hold-main">
                                <strong>{group.student?.name || '학생 미확인'} <em>{group.seatNo ? `${group.seatNo}번 좌석` : ''}</em></strong>
                                <span>{group.sequenceLabel}</span>
                                <small className={`kiosk-hold-pair-status ${group.status}`}>{statusText}</small>
                              </div>
                              <div className="kiosk-hold-actions">
                                <button type="button" className="primary" onClick={() => runKioskHoldGroupAction(group, 'apply_group')} disabled={kioskHoldLoading}>실제 출결 반영</button>
                                <button type="button" className="secondary" onClick={() => runKioskHoldGroupAction(group, 'discard_group')} disabled={kioskHoldLoading}>쉬는 시간 처리</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : <div className="kiosk-hold-empty">현재 판정 대기 중인 쉬는 시간 신호가 없습니다.</div>
          ) : (
            kioskHoldHistoryGroups.length ? (
              <div className="kiosk-hold-history-list">
                {kioskHoldHistoryGroups.map((group) => {
                  const actionLabel = ({ apply: '실제 출결 반영', discard: '쉬는 시간 처리', undo_apply: '실제 출결 반영 되돌림', undo_discard: '쉬는 시간 처리 되돌림' })[group.actionType] || group.actionType;
                  const isUndo = group.actionType.startsWith('undo_');
                  return (
                    <div key={group.key} className={`kiosk-hold-history-item ${group.actionType}`}>
                      <div className="kiosk-hold-history-main">
                        <strong>{actionLabel} · {group.studentNames || '학생 미확인'}</strong>
                        <span>{group.signalSummary || '-'} · {group.breakLabel}</span>
                        <small>{formatKstTimeWithSeconds(group.createdAt)} · 처리자 {group.actorName} · {group.actions.length}건</small>
                      </div>
                      <div className="kiosk-hold-history-actions">
                        {group.canUndo ? <button type="button" className="secondary" onClick={() => undoKioskHoldHistoryGroup(group)} disabled={kioskHoldLoading}>되돌리기</button> : null}
                        {!group.canUndo && !isUndo && ['apply', 'discard'].includes(group.actionType) ? <em>되돌리기 가능 시간 종료</em> : null}
                        {isUndo ? <em>판정 대기로 복원됨</em> : null}
                      </div>
                    </div>
                  );
                })}
                <div className="hint">처리 후 10분 동안 되돌릴 수 있습니다. 실제 출결 반영을 되돌려도 이미 발송된 학부모 알림은 취소되지 않습니다.</div>
              </div>
            ) : <div className="kiosk-hold-empty">아직 HOLD 처리 이력이 없습니다.</div>
          )}
        </section>
      ) : null}
      <div className={`patrol-shell ${quickMode ? 'is-patrol' : ''}`}>
      <div className="patrol-topbar">
        <strong>순찰 모드</strong>
        <span>좌석을 눌러 선택하고, 아래에서 학습상태를 저장하세요.</span>
        <button type="button" className="patrol-close" onClick={toggleQuickMode}>순찰 종료 ✕</button>
      </div>
      <section className="map-shell dashboard-map-shell-v4111 dashboard-map-shell-v4112">
        <div className="map-head dashboard-map-head-v4111">
          <div>
            <div className="brand">The Place 26</div>
            <div className="map-subtitle">좌석을 클릭하면 우측 패널에서 출결·학습상태를 바로 조정할 수 있습니다.{quickMode ? ' 순찰 모드에서는 입실 좌석을 여러 개 선택합니다.' : ''}</div>
          </div>
          <div className="legend">
            <span><i className="chip empty-chip"></i>미입실</span>
            <span><i className="chip occupied-chip"></i>입실</span>
            <span><i className="chip away-chip"></i>외출</span>
            <span><i className="chip out-chip"></i>퇴실</span>
            <span><i className="chip absent-chip"></i>결석</span>
            <span><i className="chip warning-chip"></i>관리필요</span>
            <span><i className="chip mentoring-chip"></i>멘토링 예정</span>
          </div>
        </div>

        <div className="dashboard-seat-controls">
          <div className="seat-filter-row">
            {filterButtons.map(([key, label, count]) => (
              <button key={key} type="button" className={seatFilter === key ? 'active' : ''} onClick={() => setSeatFilter(key)}>
                {label}<b>{count}</b>
              </button>
            ))}
          </div>
          <div className="seat-search-box">
            <input value={seatSearch} onChange={(event) => setSeatSearch(event.target.value)} placeholder="학생명·좌석번호·상태 검색" />
            {(seatSearch || seatFilter !== 'all') ? <button type="button" onClick={() => { setSeatSearch(''); setSeatFilter('all'); }}>초기화</button> : null}
          </div>
        </div>

        {view === 'map' ? (
          <div className="seat-map-wrap">
            <div className={`seat-map seat-map-v4111 seat-map-v4112 ${quickMode ? 'quick-mode' : ''}`}>
              <div className="zone-label">FOCUS ROOM · 26 SEATS</div>
              {seatRows.map((row) => {
                const { seat, student, status } = row;
                const isFilteredOut = !matchesFilter(row);
                const isMissingStudy = isCurrentPeriodStudyMissing(row);
                const urgent = getUrgentAttention(row);
                const mentorCue = getMentoringCue(row);
                const mentoringStatusPriority = ['needs_attention', 'absent', 'out'].includes(status);
                const mentoringHighlight = Boolean(mentorCue && !urgent && !mentoringStatusPriority);
                const isQuickSelected = selectedQuickSeatSet.has(Number(seat.seat_no));
                const quickDisabled = quickMode && !isQuickEligible(row);
                return (
                  <button key={seat.seat_no} className={`seat ${selectedSeatNo === seat.seat_no ? 'selected' : ''} ${status} ${isFilteredOut ? 'filtered-out' : ''} ${isMissingStudy ? 'study-missing' : ''} ${urgent ? 'priority-attention' : ''} ${mentoringHighlight ? 'mentoring-upcoming' : ''} ${mentorCue && mentoringStatusPriority ? 'mentoring-status-priority' : ''} ${isQuickSelected ? 'quick-selected' : ''} ${quickDisabled ? 'quick-disabled' : ''}`} style={{ left: (Number(seat.x) || 0) * 0.82, top: (Number(seat.y) || 0) * 0.9, width: seat.width, height: seat.height }} onClick={() => handleSeatClick(row)}>
                    {quickMode && isQuickEligible(row) ? <span className="quick-select-dot">{isQuickSelected ? '✓' : '+'}</span> : null}
                    {urgent ? <span className="priority-attention-badge">확인</span> : null}
                    {mentorCue ? <span className={`mentoring-seat-badge ${mentoringStatusPriority ? 'muted' : ''}`}>멘토링</span> : null}
                    {isMissingStudy ? <span className="missing-study-badge" title={getCurrentPeriodMissingLabel()}>미입력</span> : null}
                    <div className="seat-topline"><span className="seat-no">{String(seat.seat_no).padStart(2, '0')}</span><i>{STATUS_LABELS[status]}</i></div>
                    {student?.name ? <div className="student-name">{student.name}</div> : <div className="student-name empty">미배정</div>}
                    <div className="seat-live-mini">{getSeatLearningLabel(row)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className={`list-view seat-list-v4111 seat-list-v4112 ${quickMode ? 'quick-mode' : ''}`} style={{ display: 'grid' }}>
            {visibleRows.length ? visibleRows.map((row) => {
              const { seat, session, student, status } = row;
              const issue = getDashboardIssue(row);
              const urgent = getUrgentAttention(row);
              const mentorCue = getMentoringCue(row);
              const mentoringStatusPriority = ['needs_attention', 'absent', 'out'].includes(status);
              const mentoringHighlight = Boolean(mentorCue && !urgent && !mentoringStatusPriority);
              const isQuickSelected = selectedQuickSeatSet.has(Number(seat.seat_no));
              return (
                <button key={seat.seat_no} className={`list-card ${status} ${selectedSeatNo === seat.seat_no ? 'selected' : ''} ${isCurrentPeriodStudyMissing(row) ? 'study-missing' : ''} ${urgent ? 'priority-attention' : ''} ${mentoringHighlight ? 'mentoring-upcoming' : ''} ${mentorCue && mentoringStatusPriority ? 'mentoring-status-priority' : ''} ${isQuickSelected ? 'quick-selected' : ''}`} onClick={() => handleSeatClick(row)}>
                  <div className="list-no">{quickMode && isQuickEligible(row) ? (isQuickSelected ? '✓' : '+') : String(seat.seat_no).padStart(2, '0')}</div>
                  <div className="list-main">
                    <strong>{student?.name || '미배정'}</strong>
                    <span>{STATUS_LABELS[status]} · {getSeatLearningLabel(row)}</span>
                    <small>{getSeatTimeLabel(row)} · {getSeatSourceLabel(row)}</small>
                    {mentorCue ? <em className={`mentoring-list-note ${mentoringStatusPriority ? 'muted' : ''}`}>다음 멘토링 · {mentorCue.label}{mentoringStatusPriority ? ' · 출결상태 우선' : ''}</em> : null}
                    {issue ? <em>{issue}</em> : null}
                  </div>
                </button>
              );
            }) : (
              <div className="empty-list-result">검색/필터 조건에 맞는 좌석이 없습니다.</div>
            )}
          </div>
        )}
      </section>
      <section className={`quick-patrol-console ${quickMode ? 'active' : ''}`}>
        <div className="quick-patrol-head">
          <div>
            <h3>순찰 퀵체크</h3>
            <p>좌석 카드에서 여러 학생을 선택해 같은 과목/학습상태를 한 번에 저장합니다.</p>
          </div>
          <button type="button" className={quickMode ? 'primary' : 'secondary'} onClick={toggleQuickMode}>{quickMode ? '순찰 모드 종료' : '순찰 모드 켜기'}</button>
        </div>
        {quickMode ? (
          <div className="quick-patrol-body">
            <div className="quick-patrol-selectors">
              <div>
                <strong>과목</strong>
                <div className="quick-chip-row">
                  {SUBJECT_OPTIONS.map((option) => <button key={option} type="button" className={quickSubject === option ? 'active' : ''} onClick={() => setQuickSubject(option)}>{option}</button>)}
                </div>
              </div>
              <div>
                <strong>학습상태</strong>
                <div className="quick-chip-row">
                  {STUDY_STATUS_OPTIONS.map((option) => <button key={option} type="button" className={quickStudyStatus === option ? 'active' : ''} onClick={() => setQuickStudyStatus(option)}>{option}</button>)}
                </div>
              </div>
            </div>
            <div className="quick-patrol-content-row">
              <input value={quickStudyContent} onChange={(event) => setQuickStudyContent(event.target.value)} placeholder="학습 내용/특이사항 선택 입력 예: 수1 지수로그 문제풀이" />
              <button type="button" className="secondary" onClick={() => selectQuickRows(missingStudyRows)} disabled={!missingStudyRows.length}>{missingStudySelectLabel}</button>
              <button type="button" className="secondary" onClick={() => selectQuickRows(quickEligibleRows)} disabled={!quickEligibleRows.length}>현재 표시 입실 {quickEligibleRows.length}명 선택</button>
              <button type="button" className="secondary" onClick={() => setSelectedQuickSeats([])} disabled={!selectedQuickCount}>선택 해제</button>
            </div>
            {recentQuickCombos.length ? (
              <div className="quick-recent-row">
                <span>최근 사용</span>
                {recentQuickCombos.slice(0, 5).map((combo, index) => (
                  <button key={`${combo.subject}-${combo.studyStatus}-${combo.studyContent}-${index}`} type="button" onClick={() => applyRecentCombo(combo)}>
                    {combo.subject}/{combo.studyStatus || combo.study_status}{combo.studyContent || combo.study_content ? <em> · {combo.studyContent || combo.study_content}</em> : null}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="quick-patrol-save-row">
              <div>
                <strong>{selectedQuickCount}명 선택</strong>
                <span>{selectedQuickCount ? selectedQuickRows.map((row) => `${row.seat.seat_no}번 ${row.student?.name || ''}`.trim()).join(', ') : '좌석 카드 클릭으로 선택하세요.'}</span>
              </div>
              <button type="button" className="primary" disabled={quickSaving || !selectedQuickCount} onClick={() => saveQuickStudyChecks()}>{quickSaving ? '저장 중...' : '선택 좌석 일괄 저장'}</button>
            </div>
            {quickNotice ? <div className="quick-patrol-notice">{quickNotice}</div> : null}
          </div>
        ) : (
          <div className="quick-patrol-closed">
            <span>태블릿 순찰 시 켜두면 좌석 클릭이 “상세 열기”가 아니라 “다중 선택”으로 바뀝니다.</span>
          </div>
        )}
      </section>
      </div>

      <section className="dashboard-realtime-grid">
        <div className="dashboard-insight-card live-study-card">
          <div className="insight-head">
            <div>
              <h3>실시간 학습 분포</h3>
              <p>현재 입실 학생의 학습상태와 과목을 즉시 확인합니다.</p>
            </div>
            <span className="live-sync-badge">{formatKstTime(nowTick)} 기준</span>
          </div>
          <div className="study-stat-grid">
            <div>
              <strong>학습상태</strong>
              {topStudyStats.length ? topStudyStats.slice(0, 4).map(([label, count]) => (
                <div key={label} className="study-stat-row"><span>{label}</span><b>{count}</b></div>
              )) : <div className="empty-mini">현재 입실 학생 없음</div>}
            </div>
            <div>
              <strong>과목</strong>
              {topSubjectStats.length ? topSubjectStats.slice(0, 4).map(([label, count]) => (
                <div key={label} className="study-stat-row"><span>{label}</span><b>{count}</b></div>
              )) : <div className="empty-mini">과목 기록 없음</div>}
            </div>
          </div>
        </div>

        <div className="dashboard-insight-card focus-card">
          <div className="insight-head">
            <div>
              <h3>관리 포커스</h3>
              <p>복귀 지연·시간표 불일치·학습상태 미입력 등 현장 확인이 필요한 좌석입니다.</p>
            </div>
            <span className={`focus-count ${issueRows.length ? 'warn' : 'ok'}`}>{issueRows.length ? `${issueRows.length}건` : '정상'}</span>
          </div>
          <div className="focus-list">
            {issueRows.length ? issueRows.slice(0, 6).map((row) => (
              <div key={row.seat.seat_no} className={`focus-row ${row.status} ${row.urgentAttention ? 'priority-attention' : ''}`}>
                <button type="button" className="focus-row-main" onClick={() => selectSeat(row.seat.seat_no)}>
                  <b>{String(row.seat.seat_no).padStart(2, '0')}</b>
                  <span>{row.student?.name || '미배정'}</span>
                  <em>{row.issue}</em>
                </button>
                {row.urgentAttention ? <button type="button" className="focus-resolve-button" onClick={() => resolvePriorityAttention(row)}>확인/해제</button> : null}
              </div>
            )) : <div className="empty-mini">현재 즉시 확인할 좌석이 없습니다.</div>}
          </div>
          {dismissedFocusHistory.length ? (
            <div className="focus-dismiss-history">
              <strong>오늘 확인/해제 이력</strong>
              {dismissedFocusHistory.map((item) => (
                <div key={item.id} className="focus-dismiss-history-row">
                  <span>{item.title || '관리필요 확인'}</span>
                  <em>{item.memo || '현장 확인 완료'}</em>
                  <small>{item.adminName || '관리자'} · {item.dismissedAt ? formatKstTime(item.dismissedAt) : '-'}</small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

    </>
  );
}



function MentoringTab({ students = [], apiFetch, setMessage, currentUser, defaultSchedule = DEFAULT_SCHEDULE_SETTINGS, onMentoringChanged, onOpenStudentCare, onOpenMentoringSettings, initialActiveDay = 1 }) {
  const dayOptions = [
    [1, '월요일'],
    [2, '화요일'],
    [3, '수요일'],
    [4, '목요일'],
    [5, '금요일'],
  ];
  const defaultMentoringDays = [1, 3, 5];
  const allowedMentoringDays = dayOptions.map(([day]) => day);
  const defaultSlotOptions = useMemo(() => buildDefaultMentoringSlotOptions(defaultSchedule), [defaultSchedule]);
  const firstDefaultSlotOption = defaultSlotOptions[0] || { key: '1차시|09:00|09:50', label: '1차시', startTime: '09:00', endTime: '09:50' };
  const getInitialMentoringDay = () => {
    const parsedDay = Number(initialActiveDay);
    return allowedMentoringDays.includes(parsedDay) ? parsedDay : 1;
  };
  const [mentors, setMentors] = useState([]);
  const [slots, setSlots] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [dateSlots, setDateSlots] = useState([]);
  const [dateAssignments, setDateAssignments] = useState([]);
  const [assignmentConflicts, setAssignmentConflicts] = useState([]);
  const [dateAssignmentConflicts, setDateAssignmentConflicts] = useState([]);
  const [dateOverrideActive, setDateOverrideActive] = useState(false);
  const [mentorStudentLinks, setMentorStudentLinks] = useState([]);
  const [mentorStudentEditorId, setMentorStudentEditorId] = useState('');
  const [mentorStudentDrafts, setMentorStudentDrafts] = useState({});
  const [activeDay, setActiveDay] = useState(getInitialMentoringDay);
  const appliedInitialDayRef = useRef(getInitialMentoringDay());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [mentorEdits, setMentorEdits] = useState({});
  const [slotEdit, setSlotEdit] = useState(null);
  const [slotEditScope, setSlotEditScope] = useState('template');
  const [slotForm, setSlotForm] = useState(() => ({ dayOfWeek: 1, slotPresetKey: firstDefaultSlotOption.key, slotLabel: firstDefaultSlotOption.label, startTime: firstDefaultSlotOption.startTime, endTime: firstDefaultSlotOption.endTime, minCapacity: 3, maxCapacity: 4 }));
  const [assignForm, setAssignForm] = useState(() => ({ slotId: '', studentIds: [], mentorId: '', note: '', repeatMode: 'single', repeatDays: [getInitialMentoringDay()] }));
  const [scheduleMode, setScheduleMode] = useState('date');
  const [selectedDate, setSelectedDate] = useState(() => getKstDateString());
  const [conflictReview, setConflictReview] = useState(null);
  const [conflictDetail, setConflictDetail] = useState(null);
  const [draggingAssignment, setDraggingAssignment] = useState(null);
  const [dragTargetSlotId, setDragTargetSlotId] = useState('');

  const activeStudents = useMemo(() => (students || []).filter((student) => (student.status || 'active') === 'active').sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko')), [students]);
  const activeSlots = useMemo(() => (slots || []).filter((slot) => slot.is_active !== false).sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week) || Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.start_time || '').localeCompare(String(b.start_time || ''))), [slots]);
  const activeDateSlots = useMemo(() => (dateSlots || []).filter((slot) => slot.is_active !== false).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.start_time || '').localeCompare(String(b.start_time || ''))), [dateSlots]);
  const activeMentors = useMemo(() => (mentors || []).filter((mentor) => mentor.is_active !== false).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''), 'ko')), [mentors]);

  const mentorStudentIdsByMentor = useMemo(() => {
    const grouped = {};
    for (const link of mentorStudentLinks || []) {
      if (!link.mentor_id || !link.student_id || link.is_active === false) continue;
      const mentorId = String(link.mentor_id);
      if (!grouped[mentorId]) grouped[mentorId] = new Set();
      grouped[mentorId].add(String(link.student_id));
    }
    return grouped;
  }, [mentorStudentLinks]);

  const mentorIdByResponsibleStudent = useMemo(() => {
    const map = {};
    for (const link of mentorStudentLinks || []) {
      if (link.is_active === false || !link.student_id || !link.mentor_id) continue;
      map[String(link.student_id)] = String(link.mentor_id);
    }
    return map;
  }, [mentorStudentLinks]);

  const selectedMentorResponsibleIds = useMemo(() => {
    if (!assignForm.mentorId) return new Set();
    return new Set(mentorStudentIdsByMentor[String(assignForm.mentorId)] || []);
  }, [mentorStudentIdsByMentor, assignForm.mentorId]);

  const studentPickerRows = useMemo(() => {
    const rows = [...activeStudents];
    const selectedSet = new Set((assignForm.studentIds || []).map(String));
    return rows.sort((a, b) => {
      const aSelected = selectedSet.has(String(a.id));
      const bSelected = selectedSet.has(String(b.id));
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      if (assignForm.mentorId) {
        const aResponsible = selectedMentorResponsibleIds.has(String(a.id));
        const bResponsible = selectedMentorResponsibleIds.has(String(b.id));
        if (aResponsible !== bResponsible) return aResponsible ? -1 : 1;
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
  }, [activeStudents, assignForm.mentorId, assignForm.studentIds, selectedMentorResponsibleIds]);

  const assignmentsBySlot = useMemo(() => {
    const grouped = {};
    for (const item of assignments || []) {
      if (!item.slot_id) continue;
      if (!grouped[item.slot_id]) grouped[item.slot_id] = [];
      grouped[item.slot_id].push(item);
    }
    Object.values(grouped).forEach((rows) => rows.sort((a, b) => String(a.students?.name || '').localeCompare(String(b.students?.name || ''), 'ko')));
    return grouped;
  }, [assignments]);

  const assignmentsByMentor = useMemo(() => {
    const grouped = {};
    for (const item of assignments || []) {
      if (!item.mentor_id) continue;
      grouped[item.mentor_id] = (grouped[item.mentor_id] || 0) + 1;
    }
    return grouped;
  }, [assignments]);

  const assignmentsByStudentDay = useMemo(() => {
    const map = {};
    for (const item of assignments || []) {
      const studentId = item.student_id;
      const day = item.mentoring_slots?.day_of_week;
      if (!studentId || !day) continue;
      if (!map[`${studentId}-${day}`]) map[`${studentId}-${day}`] = item;
    }
    return map;
  }, [assignments]);

  const selectedSlot = useMemo(() => {
    const sourceSlots = scheduleMode === 'date' ? activeDateSlots : activeSlots;
    return sourceSlots.find((slot) => String(slot.id) === String(assignForm.slotId)) || null;
  }, [activeSlots, activeDateSlots, assignForm.slotId, scheduleMode]);
  const selectedRepeatDays = useMemo(() => {
    const dateDay = getDayOfWeekFromDateString(selectedDate);
    if (scheduleMode === 'date') return [dateDay];
    const slotDay = Number(selectedSlot?.day_of_week || activeDay || 1);
    if (assignForm.repeatMode === 'mwf') return defaultMentoringDays;
    if (assignForm.repeatMode === 'custom') {
      const days = [...new Set((assignForm.repeatDays || []).map(Number).filter((day) => allowedMentoringDays.includes(day)))].sort((a, b) => a - b);
      return days.length ? days : [slotDay];
    }
    return [slotDay];
  }, [assignForm.repeatMode, assignForm.repeatDays, selectedSlot?.day_of_week, activeDay, scheduleMode, selectedDate]);

  function applyMentoringData(data = {}) {
    setMentors(data.mentors || []);
    setSlots(data.slots || []);
    setAssignments(data.assignments || []);
    setDateSlots(data.dateSlots || []);
    setDateAssignments(data.dateAssignments || []);
    setAssignmentConflicts(data.assignmentConflicts || []);
    setDateAssignmentConflicts(data.dateAssignmentConflicts || []);
    setDateOverrideActive(Boolean(data.dateOverrideActive));
    setMentorStudentLinks(data.mentorStudentLinks || []);
  }

  function dayOfWeekForDate(dateString = selectedDate) {
    return getDayOfWeekFromDateString(dateString);
  }

  function shortDateLabel(dateString) {
    const date = String(dateString || '').slice(5);
    return date || '-';
  }

  const selectedDateDay = dayOfWeekForDate(selectedDate);
  const isDateMode = scheduleMode === 'date';
  const displayDay = isDateMode ? selectedDateDay : activeDay;
  const dateWeekStart = startOfWeek(selectedDate);
  const dateWeekOptions = Array.from({ length: 7 }, (_, index) => addDays(dateWeekStart, index));

  async function loadMentoring(options = {}) {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (options.seed) params.set('seed', '1');
      params.set('date', options.date || selectedDate);
      if (options.materializeDate === true) params.set('materializeDate', '1');
      const data = await apiFetch(`/api/mentoring?${params.toString()}`);
      applyMentoringData(data);
      const noticeDate = options.date || selectedDate;
      setNotice(data.warning || (scheduleMode === 'date' ? `${noticeDate} 날짜별 멘토링 일정을 불러왔습니다.` : '요일별 멘토링 템플릿을 불러왔습니다.'));
    } catch (error) {
      setNotice(error.message || '멘토링 시간표를 불러오지 못했습니다. Supabase SQL 실행 여부를 확인하세요.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshSeatCueAfterMentoringChange() {
    try {
      await onMentoringChanged?.();
    } catch {
      // 좌석배치도 갱신 실패가 멘토링 저장 자체를 막지는 않습니다.
    }
  }

  useEffect(() => {
    loadMentoring({ date: selectedDate, materializeDate: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, scheduleMode]);

  useEffect(() => {
    setAssignForm((prev) => ({ ...prev, slotId: '', studentIds: [], note: '', repeatMode: 'single', repeatDays: [scheduleMode === 'date' ? selectedDateDay : activeDay] }));
    setSlotEdit(null);
    setConflictReview(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, scheduleMode]);

  useEffect(() => {
    const nextDay = getInitialMentoringDay();
    if (appliedInitialDayRef.current === nextDay) return;
    appliedInitialDayRef.current = nextDay;
    setActiveDay(nextDay);
    setAssignForm((prev) => ({ ...prev, repeatDays: [nextDay] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialActiveDay]);

  useEffect(() => {
    if (!mentorStudentEditorId && activeMentors.length) setMentorStudentEditorId(activeMentors[0].id);
  }, [mentorStudentEditorId, activeMentors]);

  function dayLabel(day) {
    if (Number(day) === 0) return '일요일';
    if (Number(day) === 6) return '토요일';
    return dayOptions.find(([value]) => Number(value) === Number(day))?.[1] || `${day}요일`;
  }

  function repeatLabel(days = selectedRepeatDays) {
    const safe = days.map(Number).sort((a, b) => a - b);
    if (safe.join(',') === '1,3,5') return '매주 월·수·금 반복';
    return `매주 ${safe.map((day) => dayLabel(day).replace('요일', '')).join('·')} 반복`;
  }

  function slotTime(slot) {
    return `${String(slot.start_time || '').slice(0, 5)}~${String(slot.end_time || '').slice(0, 5)}`;
  }

  function getSlotCapacityStatus(slot, count) {
    const min = Number(slot.min_capacity || 3);
    const max = Number(slot.max_capacity || 4);
    if (count < min) return { className: 'low', label: `배정 부족 · 권장 ${min}~${max}명` };
    if (count > max) return { className: 'over', label: `초과 · 권장 ${min}~${max}명` };
    return { className: 'ok', label: `권장 범위 · ${count}/${max}명` };
  }

  function isAssignmentActiveForSelectedDate(item = {}) {
    if (item.is_active === false) return false;
    const start = String(item.valid_from || item.start_date || '').slice(0, 10);
    const end = String(item.valid_to || item.end_date || '').slice(0, 10);
    if (start && start > selectedDate) return false;
    if (end && end < selectedDate) return false;
    return true;
  }

  function normalizeSlotMinute(value) {
    return String(value || '').slice(0, 5);
  }

  function getTemplateSlotForDateSlot(slot = {}) {
    const templateId = slot.template_slot_id || (slot.is_virtual_date ? slot.id : null);
    if (!templateId) return null;
    return activeSlots.find((item) => String(item.id) === String(templateId)) || null;
  }

  function isDateSlotConfigModified(slot = {}) {
    if (!isDateMode || !dateOverrideActive) return false;
    if (!slot.template_slot_id) return true;
    const template = getTemplateSlotForDateSlot(slot);
    if (!template) return true;
    return String(template.slot_label || '') !== String(slot.slot_label || '')
      || normalizeSlotMinute(template.start_time) !== normalizeSlotMinute(slot.start_time)
      || normalizeSlotMinute(template.end_time) !== normalizeSlotMinute(slot.end_time)
      || Number(template.min_capacity || 3) !== Number(slot.min_capacity || 3)
      || Number(template.max_capacity || 4) !== Number(slot.max_capacity || 4);
  }

  function hasDateSlotAssignmentChanges(slot = {}, rows = []) {
    if (!isDateMode || !dateOverrideActive) return false;
    if (!slot.template_slot_id) return rows.length > 0;
    const weeklyRows = (assignments || [])
      .filter((item) => String(item.slot_id) === String(slot.template_slot_id) && isAssignmentActiveForSelectedDate(item));
    const weeklyIds = new Set(weeklyRows.map((item) => String(item.id)));
    const dateTemplateIds = new Set((rows || []).map((item) => item.template_assignment_id).filter(Boolean).map(String));
    if ((rows || []).some((item) => !item.template_assignment_id)) return true;
    if (weeklyIds.size !== dateTemplateIds.size) return true;
    for (const id of weeklyIds) {
      if (!dateTemplateIds.has(id)) return true;
    }
    return false;
  }

  function getDateSlotStatusItems(slot = {}, rows = [], hasConflict = false) {
    if (!isDateMode) return [];
    const items = [];
    if (!dateOverrideActive || slot.is_virtual_date) {
      items.push({ key: 'template', label: '요일 기본값', className: 'template' });
    } else if (!slot.template_slot_id) {
      items.push({ key: 'added', label: '이 날짜에서만 추가됨', className: 'added' });
    } else if (isDateSlotConfigModified(slot)) {
      items.push({ key: 'modified', label: '날짜별 수정됨', className: 'override' });
    } else {
      items.push({ key: 'template', label: '요일 기본값 기반', className: 'template' });
    }
    if (hasDateSlotAssignmentChanges(slot, rows)) items.push({ key: 'assignment-changed', label: '배정 변경 있음', className: 'changed' });
    if (hasConflict) items.push({ key: 'conflict', label: '개인일정 주의 있음', className: 'warning' });
    return items;
  }

  function showConflictDetail(conflict, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (conflict) setConflictDetail(conflict);
  }



  function getSlotPresetKeyFromValues(label, startTime, endTime) {
    const normalizedLabel = String(label || '').trim();
    const normalizedStart = String(startTime || '').slice(0, 5);
    const normalizedEnd = String(endTime || '').slice(0, 5);
    const preset = defaultSlotOptions.find((item) => item.label === normalizedLabel && item.startTime === normalizedStart && item.endTime === normalizedEnd);
    return preset?.key || 'custom';
  }

  function getSlotPresetKey(slot = {}) {
    return getSlotPresetKeyFromValues(slot.slot_label || slot.slotLabel, slot.start_time || slot.startTime, slot.end_time || slot.endTime);
  }

  function getSlotPresetOptionsForEditor(day = selectedDateDay, currentSlotId = '') {
    const sourceSlots = isDateMode ? activeDateSlots : activeSlots;
    const usedPresetKeys = new Set((sourceSlots || [])
      .filter((slot) => Number(slot.day_of_week) === Number(day) && (!currentSlotId || String(slot.id) !== String(currentSlotId)))
      .map((slot) => getSlotPresetKey(slot))
      .filter((key) => key && key !== 'custom'));
    return defaultSlotOptions.map((item) => ({ ...item, disabled: usedPresetKeys.has(item.key) }));
  }

  function getAvailableSlotPresetOptionsForDay(day = selectedDateDay) {
    return getSlotPresetOptionsForEditor(day).filter((item) => !item.disabled);
  }

  function getNextDateSlotPreset() {
    return getAvailableSlotPresetOptionsForDay(selectedDateDay)[0] || null;
  }

  function applySlotPresetKey(presetKey) {
    if (presetKey === 'custom') {
      setSlotForm((prev) => ({ ...prev, slotPresetKey: 'custom' }));
      return;
    }
    const preset = defaultSlotOptions.find((item) => item.key === presetKey) || defaultSlotOptions[0];
    setSlotForm((prev) => ({
      ...prev,
      slotPresetKey: preset.key,
      slotLabel: preset.label,
      startTime: preset.startTime,
      endTime: preset.endTime,
    }));
  }

  function startEditSlot(slot) {
    setSlotEditScope(isDateMode ? 'date' : 'template');
    setSlotEdit(slot.id);
    setSlotForm({
      dayOfWeek: Number(slot.day_of_week || activeDay),
      slotPresetKey: getSlotPresetKey(slot),
      slotLabel: slot.slot_label || '',
      startTime: String(slot.start_time || '').slice(0, 5),
      endTime: String(slot.end_time || '').slice(0, 5),
      minCapacity: Number(slot.min_capacity || 3),
      maxCapacity: Number(slot.max_capacity || 4),
    });
  }

  function startNewSlot(day = activeDay) {
    if (isDateMode && !dateOverrideActive) {
      setNotice('선택 날짜의 차시를 추가하려면 먼저 일정 수정 시작을 눌러주세요.');
      return;
    }
    const targetDay = isDateMode ? selectedDateDay : Number(day);
    const preset = isDateMode ? getNextDateSlotPreset() : (getAvailableSlotPresetOptionsForDay(targetDay)[0] || defaultSlotOptions[0]);
    if (!preset) {
      setNotice(`${isDateMode ? selectedDate : dayLabel(targetDay)}에는 1~8차시가 이미 모두 있습니다. 기존 차시를 수정하거나 비활성화한 뒤 다시 추가하세요.`);
      return;
    }
    setSlotEditScope(isDateMode ? 'date' : 'template');
    setSlotEdit('new');
    setSlotForm({ dayOfWeek: Number(targetDay), slotPresetKey: preset.key, slotLabel: preset.label, startTime: preset.startTime, endTime: preset.endTime, minCapacity: 3, maxCapacity: 4 });
  }

  function updateRepeatMode(mode) {
    const slotDay = Number(selectedSlot?.day_of_week || activeDay || 1);
    setAssignForm((prev) => ({
      ...prev,
      repeatMode: mode,
      repeatDays: mode === 'mwf' ? defaultMentoringDays : mode === 'single' ? [slotDay] : (prev.repeatDays?.length ? prev.repeatDays : [slotDay]),
    }));
  }

  function toggleRepeatDay(day) {
    setAssignForm((prev) => {
      const set = new Set((prev.repeatDays || []).map(Number));
      if (set.has(day)) set.delete(day);
      else set.add(day);
      const days = [...set].filter((value) => allowedMentoringDays.includes(value)).sort((a, b) => a - b);
      return { ...prev, repeatMode: 'custom', repeatDays: days.length ? days : [Number(selectedSlot?.day_of_week || activeDay || 1)] };
    });
  }

  function toggleAssignStudent(studentId, disabled = false) {
    if (disabled) return;
    setAssignForm((prev) => {
      const current = new Set((prev.studentIds || []).map(String));
      const key = String(studentId);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, studentIds: Array.from(current) };
    });
  }

  function clearSelectedStudents() {
    setAssignForm((prev) => ({ ...prev, studentIds: [] }));
  }

  function conflictSummary(conflicts = []) {
    const names = [...new Set((conflicts || []).map((item) => item.studentName).filter(Boolean))];
    const slots = [...new Set((conflicts || []).map((item) => `${item.dayLabel || ''} ${item.slotLabel || ''}`.trim()).filter(Boolean))];
    return { names, slots, count: conflicts.length };
  }

  function getMentorStudentDraftIds(mentorId = mentorStudentEditorId) {
    if (!mentorId) return [];
    const draft = mentorStudentDrafts[String(mentorId)];
    if (Array.isArray(draft)) return draft.map(String);
    return Array.from(mentorStudentIdsByMentor[String(mentorId)] || []);
  }

  function toggleMentorStudentDraft(studentId) {
    if (!effectiveMentorStudentEditorId) return;
    setMentorStudentDrafts((prev) => {
      const mentorId = String(effectiveMentorStudentEditorId);
      const next = new Set((Array.isArray(prev[mentorId]) ? prev[mentorId] : getMentorStudentDraftIds(mentorId)).map(String));
      const key = String(studentId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [mentorId]: Array.from(next) };
    });
  }

  function resetMentorStudentDraft() {
    if (!effectiveMentorStudentEditorId) return;
    setMentorStudentDrafts((prev) => {
      const next = { ...prev };
      delete next[String(effectiveMentorStudentEditorId)];
      return next;
    });
  }

  async function saveMentorStudentSettings() {
    const mentorId = effectiveMentorStudentEditorId;
    if (!mentorId) {
      setNotice('담당학생을 설정할 멘토를 먼저 선택하세요.');
      return;
    }
    const studentIds = getMentorStudentDraftIds(mentorId);
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveMentorStudents', mentorId, studentIds }),
      });
      applyMentoringData(data);
      setMentorStudentDrafts((prev) => ({ ...prev, [String(mentorId)]: studentIds }));
      setNotice(`담당학생 ${studentIds.length}명을 저장했습니다.`);
      setMessage?.('멘토별 담당학생 설정을 저장했습니다.');
    } catch (error) {
      setNotice(error.message || '담당학생 설정 저장 실패');
    } finally {
      setLoading(false);
    }
  }

  function handleSlotSelect(slotId) {
    const sourceSlots = scheduleMode === 'date' ? activeDateSlots : activeSlots;
    const slot = sourceSlots.find((item) => String(item.id) === String(slotId));
    const day = Number(slot?.day_of_week || activeDay || 1);
    setAssignForm((prev) => ({ ...prev, slotId, repeatMode: 'single', repeatDays: [day] }));
    if (slot) setActiveDay(day);
  }

  async function saveSlot() {
    try {
      setLoading(true);
      const isDateSlotEdit = slotEditScope === 'date';
      setNotice(isDateSlotEdit ? '날짜별 멘토링 차시를 저장하는 중입니다...' : '요일별 멘토링 차시를 저장하는 중입니다...');
      const action = isDateSlotEdit ? 'saveDateSlot' : 'saveSlot';
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ action, id: slotEdit === 'new' ? null : slotEdit, scheduleDate: selectedDate, ...slotForm }),
      });
      applyMentoringData(data);
      setSlotEdit(null);
      setNotice(isDateSlotEdit ? `${selectedDate} 날짜별 멘토링 차시를 저장했습니다. 화면에 바로 반영되었습니다.` : '요일별 멘토링 차시를 저장했습니다.');
      setMessage?.(isDateSlotEdit ? `${selectedDate} 날짜별 차시 저장 완료` : '멘토링 차시를 저장했습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || '차시 저장 실패. 새로고침 후 다시 시도해 주세요.');
      setMessage?.(error.message || '차시 저장 실패');
    } finally {
      setLoading(false);
    }
  }

  async function saveMentor(mentor) {
    const draft = mentorEdits[mentor.id] || {};
    try {
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveMentor',
          id: mentor.id,
          mentorCode: mentor.mentor_code,
          mentorName: draft.mentorName ?? mentor.mentor_name,
          capacityTarget: draft.capacityTarget ?? mentor.capacity_target,
          sortOrder: mentor.sort_order,
          isActive: mentor.is_active,
        }),
      });
      applyMentoringData(data);
      setMentorEdits((prev) => ({ ...prev, [mentor.id]: {} }));
      setNotice('멘토 정보를 저장했습니다.');
    } catch (error) {
      setNotice(error.message || '멘토 저장 실패');
    }
  }

  async function seedDefaults() {
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', { method: 'POST', body: JSON.stringify({ action: 'seedDefaults', scheduleDate: selectedDate }) });
      applyMentoringData(data);
      setNotice('설정 탭의 기본 시간표를 기준으로 월/수/금 1~8차시 멘토링 차시와 멘토 2명을 세팅/동기화했습니다. 화/목은 필요한 경우 차시 추가로 임시 운영할 수 있습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || '기본 세팅 실패');
    } finally {
      setLoading(false);
    }
  }

  async function resetSelectedDateSchedule() {
    if (!window.confirm(`${selectedDate} 날짜별 멘토링 일정을 요일 기본값으로 되돌릴까요?

이 날짜에서만 추가·수정·제외한 차시와 학생 배정 변경이 초기화됩니다. 요일별 템플릿 자체는 변경되지 않습니다.`)) return;
    try {
      setLoading(true);
      setNotice('요일 기본값으로 되돌리는 중입니다...');
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ action: 'resetDateSchedule', scheduleDate: selectedDate }),
      });
      applyMentoringData(data);
      setNotice(`${selectedDate} 날짜별 일정을 요일 기본값으로 되돌렸습니다.`);
      setMessage?.('선택 날짜 멘토링 일정을 요일 기본값으로 되돌렸습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || '날짜별 일정 재반영 실패. 새로고침 후 다시 시도해 주세요.');
      setMessage?.(error.message || '날짜별 일정 재반영 실패');
    } finally {
      setLoading(false);
    }
  }

  async function materializeSelectedDateSchedule() {
    if (!window.confirm(`${selectedDate} 날짜의 멘토링 일정을 직접 수정할 수 있도록 별도 일정으로 전환할까요?

전환 후 차시와 배정 변경은 이 날짜에만 적용되며, 요일별 기본 템플릿에는 영향을 주지 않습니다.`)) return;
    try {
      setLoading(true);
      setNotice('선택 날짜의 별도 수정 일정을 생성하는 중입니다...');
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ action: 'materializeDateSchedule', scheduleDate: selectedDate }),
      });
      applyMentoringData(data);
      setNotice(`${selectedDate} 날짜별 수정 일정이 생성되었습니다. 이제 이 날짜에 한해 차시·배정을 바꿀 수 있습니다.`);
      setMessage?.('날짜별 수정 일정이 생성되었습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || '날짜별 일정 수정 모드 전환 실패. 새로고침 후 다시 시도해 주세요.');
      setMessage?.(error.message || '날짜별 일정 수정 모드 전환 실패');
    } finally {
      setLoading(false);
    }
  }

  async function submitAssignments(forceScheduleConflict = false, payloadOverride = null) {
    const payload = payloadOverride || {
      action: 'assignStudents',
      slotId: assignForm.slotId,
      studentIds: assignForm.studentIds || [],
      mentorId: assignForm.mentorId,
      note: assignForm.note,
      repeatDayOfWeeks: selectedRepeatDays,
      repeatLabel: repeatLabel(selectedRepeatDays),
      forceScheduleConflict,
    };
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ ...payload, forceScheduleConflict }),
      });
      applyMentoringData(data);
      const count = data.result?.insertedCount ?? payload.studentIds?.length ?? 0;
      setAssignForm((prev) => ({ ...prev, studentIds: [], note: '' }));
      setConflictReview(null);
      setNotice(`${count}건의 멘토링 배정을 저장했습니다. 화면에 바로 반영되었습니다.`);
      setMessage?.(isDateMode ? `${selectedDate} 날짜별 배정 저장 완료` : '멘토링 배정을 저장했습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      if (error?.conflicts?.length) {
        setConflictReview({ conflicts: error.conflicts, payload });
        setNotice('개인 시간표와 맞지 않는 배정이 있습니다. 내용을 확인하세요.');
      } else {
        setNotice(error.message || '학생 배정 실패. 새로고침 후 다시 시도해 주세요.');
        setMessage?.(error.message || '학생 배정 실패');
      }
    } finally {
      setLoading(false);
    }
  }

  async function assignStudents() {
    if (!assignForm.slotId || !(assignForm.studentIds || []).length || !assignForm.mentorId) {
      setNotice('차시, 학생, 멘토를 모두 선택하세요. 학생은 여러 명을 동시에 선택할 수 있습니다.');
      return;
    }
    if (isDateMode && !dateOverrideActive) {
      setNotice('선택 날짜는 아직 요일별 기본값 자동 반영 상태입니다. 먼저 일정 수정 시작을 눌러주세요.');
      return;
    }
    const payload = isDateMode
      ? {
          action: 'assignDateStudents',
          dateSlotId: assignForm.slotId,
          slotId: assignForm.slotId,
          scheduleDate: selectedDate,
          studentIds: assignForm.studentIds || [],
          mentorId: assignForm.mentorId,
          note: assignForm.note,
        }
      : {
          action: 'assignStudents',
          slotId: assignForm.slotId,
          studentIds: assignForm.studentIds || [],
          mentorId: assignForm.mentorId,
          note: assignForm.note,
          repeatDayOfWeeks: selectedRepeatDays,
          repeatLabel: repeatLabel(selectedRepeatDays),
        };
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ ...payload, action: isDateMode ? 'validateDateAssignments' : 'validateAssignments' }),
      });
      setLoading(false);
      if ((data.conflicts || []).length) {
        setConflictReview({ conflicts: data.conflicts, payload });
        setNotice('개인 시간표와 맞지 않는 배정이 있습니다. 확인 후 저장하세요.');
        return;
      }
      await submitAssignments(false, payload);
    } catch (error) {
      setLoading(false);
      if (error?.conflicts?.length) {
        setConflictReview({ conflicts: error.conflicts, payload });
      } else {
        setNotice(error.message || '학생 배정 전 검증 실패');
      }
    }
  }

  async function deleteAssignment(item) {
    const studentName = item.students?.name || '학생';
    if (isDateMode && !dateOverrideActive) {
      setNotice('요일 기본값 미리보기 상태에서는 배정을 제외할 수 없습니다. 먼저 일정 수정 시작을 눌러주세요.');
      return;
    }
    const confirmMessage = isDateMode
      ? `${selectedDate} 날짜에서 ${studentName} 학생의 멘토링 배정만 제외할까요?\n요일별 템플릿과 다른 날짜 일정에는 영향을 주지 않습니다.`
      : `${studentName} 학생의 요일별 멘토링 배정을 삭제할까요?`;
    if (!window.confirm(confirmMessage)) return;
    try {
      setLoading(true);
      setNotice(isDateMode ? `${studentName} 학생을 이 날짜 일정에서 제외하는 중입니다...` : `${studentName} 학생 배정을 삭제하는 중입니다...`);
      const action = isDateMode || item.is_date_assignment || item.is_virtual_date ? 'deleteDateAssignment' : 'deleteAssignment';
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action,
          id: isDateMode && !item.is_date_assignment ? null : item.id,
          assignmentId: item.id,
          dateAssignmentId: item.is_date_assignment ? item.id : null,
          templateAssignmentId: item.template_assignment_id || (!item.is_date_assignment ? item.id : null),
          dateSlotId: item.date_slot_id || item.slot_id,
          studentId: item.student_id || item.students?.id,
          scheduleDate: selectedDate,
        }),
      });
      applyMentoringData(data);
      setNotice(isDateMode ? `${selectedDate} 날짜에서 ${studentName} 학생을 제외했습니다. 화면에 바로 반영되었습니다.` : `${studentName} 학생의 요일별 멘토링 배정을 삭제했습니다.`);
      setMessage?.(isDateMode ? '이 날짜에서 학생을 제외했습니다.' : '멘토링 배정을 삭제했습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || (isDateMode ? '이 날짜에서 학생 제외 실패. 새로고침 후 다시 시도해 주세요.' : '배정 삭제 실패. 새로고침 후 다시 시도해 주세요.'));
      setMessage?.(error.message || '배정 변경 실패');
    } finally {
      setLoading(false);
    }
  }


  async function deleteSlot(slot) {
    if (isDateMode && !dateOverrideActive) {
      setNotice('요일 기본값 미리보기 상태에서는 차시를 제외할 수 없습니다. 먼저 일정 수정 시작을 눌러주세요.');
      return;
    }
    const label = isDateMode ? `${selectedDate} ${slot.slot_label}` : `${dayLabel(slot.day_of_week)} ${slot.slot_label}`;
    const confirmMessage = isDateMode
      ? `${label} 차시를 이 날짜에서만 제외할까요?\n해당 차시에 배정된 학생도 이 날짜 일정에서 함께 제외되며, 요일별 템플릿에는 영향을 주지 않습니다.`
      : `${label} 차시를 비활성화할까요? 해당 차시의 학생 배정도 함께 비활성화됩니다.`;
    if (!window.confirm(confirmMessage)) return;
    try {
      setLoading(true);
      setNotice(isDateMode ? `${label} 차시를 이 날짜에서 제외하는 중입니다...` : `${label} 차시를 비활성화하는 중입니다...`);
      const action = isDateMode || slot.is_date_slot || slot.is_virtual_date ? 'deleteDateSlot' : 'deleteSlot';
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action,
          id: isDateMode && !slot.is_date_slot ? null : slot.id,
          slotId: slot.id,
          dateSlotId: slot.is_date_slot ? slot.id : null,
          templateSlotId: slot.template_slot_id || (!slot.is_date_slot ? slot.id : null),
          scheduleDate: selectedDate,
        }),
      });
      applyMentoringData(data);
      setNotice(isDateMode ? `${label} 차시를 이 날짜에서 제외했습니다. 화면에 바로 반영되었습니다.` : `${label} 차시를 비활성화했습니다.`);
      setMessage?.(isDateMode ? '이 날짜 차시를 제외했습니다.' : '멘토링 차시를 비활성화했습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      setNotice(error.message || (isDateMode ? '이 날짜 차시 제외 실패. 새로고침 후 다시 시도해 주세요.' : '차시 비활성화 실패. 새로고침 후 다시 시도해 주세요.'));
      setMessage?.(error.message || '차시 변경 실패');
    } finally {
      setLoading(false);
    }
  }



  function formatMentoringConflictsForConfirm(conflicts = []) {
    const lines = (conflicts || []).slice(0, 4).map((conflict, index) => [
      `${index + 1}. ${conflict.studentName || '학생'} · ${conflict.date || selectedDate} ${conflict.slotLabel || ''}`.trim(),
      `멘토링: ${conflict.slotTime || '-'}`,
      `개인일정: ${conflict.plannedRange || '-'}`,
      `사유: ${conflict.reason || '개인 일정과 맞지 않습니다.'}`,
    ].join('\n'));
    return `${lines.join('\n\n')}${conflicts.length > 4 ? `\n\n외 ${conflicts.length - 4}건 추가` : ''}`;
  }

  function handleAssignmentDragStart(event, item, slot) {
    if (!isDateMode || !dateOverrideActive || loading) {
      event.preventDefault();
      return;
    }
    const payload = {
      dateAssignmentId: item.id,
      studentId: item.student_id || item.students?.id,
      studentName: item.students?.name || '학생',
      sourceDateSlotId: item.date_slot_id || item.slot_id || slot.id,
      mentorId: item.mentor_id || '',
      sourceSlotLabel: slot.slot_label || '',
    };
    setDraggingAssignment(payload);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.studentName);
  }

  function handleAssignmentDragEnd() {
    setDraggingAssignment(null);
    setDragTargetSlotId('');
  }

  function handleSlotDragOver(event, slot) {
    if (!isDateMode || !dateOverrideActive || loading || !draggingAssignment) return;
    if (String(draggingAssignment.sourceDateSlotId || '') === String(slot.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragTargetSlotId(String(slot.id));
  }

  async function moveDateAssignmentToSlot(slot, forceScheduleConflict = false, dragPayload = draggingAssignment) {
    if (!dragPayload || !slot?.id) return;
    if (String(dragPayload.sourceDateSlotId || '') === String(slot.id)) return;
    try {
      setLoading(true);
      setNotice(`${dragPayload.studentName || '학생'} 학생을 ${slot.slot_label}로 이동하는 중입니다...`);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action: 'moveDateAssignment',
          scheduleDate: selectedDate,
          dateAssignmentId: dragPayload.dateAssignmentId,
          studentId: dragPayload.studentId,
          targetDateSlotId: slot.id,
          mentorId: dragPayload.mentorId,
          forceScheduleConflict,
          note: '드래그로 날짜별 차시 이동',
        }),
      });
      applyMentoringData(data);
      setNotice(`${dragPayload.studentName || '학생'} 학생을 ${selectedDate} ${slot.slot_label}로 이동했습니다.`);
      setMessage?.('날짜별 멘토링 배정을 드래그로 이동했습니다.');
      await refreshSeatCueAfterMentoringChange();
    } catch (error) {
      if (error?.conflicts?.length && !forceScheduleConflict) {
        const ok = window.confirm(`이동하려는 차시가 학생 개인일정과 맞지 않습니다.\n\n${formatMentoringConflictsForConfirm(error.conflicts)}\n\n그래도 이 차시로 이동할까요?`);
        if (ok) {
          await moveDateAssignmentToSlot(slot, true, dragPayload);
          return;
        }
        setNotice('개인일정 충돌로 이동을 취소했습니다.');
      } else {
        setNotice(error.message || '학생 차시 이동 실패. 새로고침 후 다시 시도해 주세요.');
        setMessage?.(error.message || '학생 차시 이동 실패');
      }
    } finally {
      setLoading(false);
      setDraggingAssignment(null);
      setDragTargetSlotId('');
    }
  }

  async function handleSlotDrop(event, slot) {
    if (!isDateMode || !dateOverrideActive || loading) return;
    event.preventDefault();
    let payload = draggingAssignment;
    if (!payload) {
      try {
        payload = JSON.parse(event.dataTransfer.getData('application/json') || 'null');
      } catch {
        payload = null;
      }
    }
    if (!payload) return;
    await moveDateAssignmentToSlot(slot, false, payload);
  }



  const dateAssignmentsBySlot = useMemo(() => {
    const grouped = {};
    for (const item of dateAssignments || []) {
      const slotId = item.date_slot_id || item.slot_id;
      if (!slotId) continue;
      if (!grouped[slotId]) grouped[slotId] = [];
      grouped[slotId].push(item);
    }
    Object.values(grouped).forEach((rows) => rows.sort((a, b) => String(a.students?.name || '').localeCompare(String(b.students?.name || ''), 'ko')));
    return grouped;
  }, [dateAssignments]);

  const dateAssignmentsByStudent = useMemo(() => {
    const map = {};
    for (const item of dateAssignments || []) {
      if (!item.student_id || item.is_active === false) continue;
      map[String(item.student_id)] = item;
    }
    return map;
  }, [dateAssignments]);

  const conflictByAssignmentId = useMemo(() => {
    const map = {};
    for (const conflict of assignmentConflicts || []) {
      if (conflict.assignmentId) map[String(conflict.assignmentId)] = conflict;
    }
    return map;
  }, [assignmentConflicts]);

  const conflictByDateAssignmentId = useMemo(() => {
    const map = {};
    for (const conflict of dateAssignmentConflicts || []) {
      if (conflict.dateAssignmentId) map[String(conflict.dateAssignmentId)] = conflict;
      if (conflict.assignmentId) map[String(conflict.assignmentId)] = conflict;
    }
    return map;
  }, [dateAssignmentConflicts]);

  const displaySlots = isDateMode ? activeDateSlots : activeSlots;
  const displayAssignmentsBySlot = isDateMode ? dateAssignmentsBySlot : assignmentsBySlot;
  const displayConflictsByAssignmentId = isDateMode ? conflictByDateAssignmentId : conflictByAssignmentId;
  const visibleSlots = displaySlots.filter((slot) => Number(slot.day_of_week) === Number(displayDay));
  const selectedStudents = activeStudents.filter((student) => (assignForm.studentIds || []).includes(String(student.id)));
  const effectiveMentorStudentEditorId = mentorStudentEditorId || activeMentors[0]?.id || '';
  const selectedMentorForStudentConfig = activeMentors.find((mentor) => String(mentor.id) === String(effectiveMentorStudentEditorId)) || null;
  const mentorStudentDraftIds = getMentorStudentDraftIds(effectiveMentorStudentEditorId);
  const mentorStudentDraftSet = new Set(mentorStudentDraftIds.map(String));
  const useSlotPresetSelector = Boolean(slotEdit) && (slotEditScope === 'date' || slotEdit === 'new');
  const slotPresetOptions = slotEdit
    ? (slotEdit === 'new'
      ? getAvailableSlotPresetOptionsForDay(Number(slotForm.dayOfWeek || displayDay))
      : getSlotPresetOptionsForEditor(Number(slotForm.dayOfWeek || displayDay), slotEdit))
    : [];
  const slotPresetSelectValue = slotForm.slotPresetKey || getSlotPresetKey(slotForm);

  return (
    <section className="content-card mentoring-page mentoring-page-v41314 mentoring-page-v4133">
      <div className="section-head mentoring-hero">
        <div>
          <h2>멘토링 시간표</h2>
          <p>요일별 템플릿을 기준으로 날짜별 일정을 자동 반영하고, 필요한 날짜만 차시와 배정을 조정합니다. 기본 세팅과 멘토별 담당학생은 설정 탭에서 관리합니다.</p>
        </div>
        <button type="button" className="secondary" onClick={() => onOpenMentoringSettings?.()}>멘토링 설정</button>
      </div>

      <div className="mentoring-mode-bar">
        <div className="mentoring-mode-toggle">
          <button type="button" className={isDateMode ? 'active' : ''} onClick={() => setScheduleMode('date')}>날짜별 일정</button>
          <button type="button" className={!isDateMode ? 'active' : ''} onClick={() => setScheduleMode('template')}>요일별 템플릿</button>
        </div>
        {isDateMode ? (
          <div className="mentoring-date-control">
            <button type="button" className="secondary" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>이전날</button>
            <label>
              <span>기준 날짜</span>
              <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
            </label>
            <button type="button" className="secondary" onClick={() => setSelectedDate(getKstDateString())}>오늘</button>
            <button type="button" className="secondary" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>다음날</button>
            <span className={`mentoring-date-status ${dateOverrideActive ? 'override' : 'template'}`}>{dateOverrideActive ? '이 날짜만 별도 수정 중' : '요일 기본값 자동 반영 중'}</span>
            <button type="button" className="primary" onClick={materializeSelectedDateSchedule} disabled={loading || dateOverrideActive}>일정 수정 시작</button>
            <button type="button" className="secondary" onClick={resetSelectedDateSchedule} disabled={loading || !dateOverrideActive}>기본값 되돌리기</button>
            <button type="button" className="primary" onClick={() => startNewSlot(selectedDateDay)} disabled={loading || !dateOverrideActive || !allowedMentoringDays.includes(Number(selectedDateDay))} title={!dateOverrideActive ? '먼저 일정 수정 시작을 눌러주세요.' : ''}>차시 추가</button>
          </div>
        ) : (
          <div className="mentoring-day-tabs">
            {dayOptions.map(([day, label]) => (
              <button key={day} type="button" className={Number(activeDay) === Number(day) ? 'active' : ''} onClick={() => setActiveDay(day)}>{label}{[2, 4].includes(day) ? <em>임시</em> : null}</button>
            ))}
            <button type="button" className="secondary" onClick={() => startNewSlot(activeDay)}>{[2, 4].includes(Number(activeDay)) ? '임시 차시 추가' : '차시 추가'}</button>
          </div>
        )}
      </div>

      {isDateMode ? (
        <div className="mentoring-date-strip">
          {dateWeekOptions.map((date) => {
            const day = dayOfWeekForDate(date);
            const isWeekend = day === 0 || day === 6;
            return (
              <button key={date} type="button" className={`${date === selectedDate ? 'active' : ''} ${date === getKstDateString() ? 'today' : ''} ${isWeekend ? 'weekend' : ''}`} onClick={() => setSelectedDate(date)}>
                <strong>{shortDateLabel(date)}</strong>
                <span>{isWeekend ? (day === 0 ? '일' : '토') : dayLabel(day).replace('요일', '')}</span>
              </button>
            );
          })}
          <em>{dateOverrideActive ? `${selectedDate} 날짜별 별도 수정 일정입니다. 차시·배정 변경은 이 날짜에만 적용됩니다.` : `${selectedDate} · ${dayLabel(selectedDateDay)} 요일 기본 설정을 자동으로 보여주는 상태입니다. 당일 변경이 필요하면 먼저 일정 수정 시작을 누르세요.`}</em>
        </div>
      ) : null}

      {slotEdit ? (
        <div className={`mentoring-slot-editor mentoring-slot-editor-v41331 mentoring-slot-editor-v41332 ${slotEdit === 'new' ? 'is-new-slot' : 'is-edit-slot'}`}>
          <label className="mentoring-slot-editor-field date-field">
            <span>{slotEditScope === 'date' ? '적용 날짜' : '적용 요일'}</span>
            {slotEditScope === 'date' ? (
              <input value={`${selectedDate} · ${dayLabel(selectedDateDay)}`} disabled readOnly />
            ) : (
              <select value={slotForm.dayOfWeek} onChange={(event) => setSlotForm((prev) => ({ ...prev, dayOfWeek: Number(event.target.value) }))}>
                {dayOptions.map(([day, label]) => <option key={day} value={day}>{label}</option>)}
              </select>
            )}
          </label>

          {useSlotPresetSelector ? (
            <>
              <label className="mentoring-slot-editor-field preset-field new-slot-preset-field">
                <span>{slotEdit === 'new' ? '추가할 차시' : '변경할 차시'}</span>
                <select value={slotPresetSelectValue} onChange={(event) => applySlotPresetKey(event.target.value)}>
                  {slotPresetSelectValue === 'custom' ? <option value="custom">현재 설정 · {slotForm.slotLabel || '차시'} · {slotForm.startTime}~{slotForm.endTime}</option> : null}
                  {slotPresetOptions.map((preset) => <option key={preset.key} value={preset.key} disabled={preset.disabled}>{preset.label} · {preset.startTime}~{preset.endTime}{preset.disabled ? ' · 이미 있음' : ''}</option>)}
                </select>
              </label>
              <div className="mentoring-slot-editor-summary" aria-label="선택된 차시 시간">
                <span>선택 시간</span>
                <strong>{slotForm.slotLabel} · {slotForm.startTime}~{slotForm.endTime}</strong>
              </div>
            </>
          ) : (
            <>
              <label className="mentoring-slot-editor-field preset-field">
                <span>차시명</span>
                <input value={slotForm.slotLabel} onChange={(event) => setSlotForm((prev) => ({ ...prev, slotLabel: event.target.value, slotPresetKey: getSlotPresetKeyFromValues(event.target.value, prev.startTime, prev.endTime) }))} placeholder="차시명" />
              </label>
              <label className="mentoring-slot-editor-field time-field">
                <span>시작 시간</span>
                <input type="time" step="300" value={slotForm.startTime} onChange={(event) => setSlotForm((prev) => ({ ...prev, startTime: event.target.value, slotPresetKey: getSlotPresetKeyFromValues(prev.slotLabel, event.target.value, prev.endTime) }))} />
              </label>
              <label className="mentoring-slot-editor-field time-field">
                <span>종료 시간</span>
                <input type="time" step="300" value={slotForm.endTime} onChange={(event) => setSlotForm((prev) => ({ ...prev, endTime: event.target.value, slotPresetKey: getSlotPresetKeyFromValues(prev.slotLabel, prev.startTime, event.target.value) }))} />
              </label>
            </>
          )}

          <label className="mentoring-slot-editor-field capacity-field">
            <span>권장 최소 인원</span>
            <input type="number" min="1" max="20" value={slotForm.minCapacity} onChange={(event) => setSlotForm((prev) => ({ ...prev, minCapacity: Number(event.target.value) }))} aria-label="권장 최소 인원" />
          </label>
          <label className="mentoring-slot-editor-field capacity-field">
            <span>권장 최대 인원</span>
            <input type="number" min="1" max="20" value={slotForm.maxCapacity} onChange={(event) => setSlotForm((prev) => ({ ...prev, maxCapacity: Number(event.target.value) }))} aria-label="권장 최대 인원" />
          </label>
          <button type="button" className="primary" onClick={saveSlot} disabled={loading || (slotEditScope === 'date' && !dateOverrideActive)}>{slotEdit === 'new' ? '선택 차시 추가' : '차시 저장'}</button>
          <button type="button" className="secondary" onClick={() => setSlotEdit(null)}>취소</button>
          <em className="mentoring-slot-editor-help">권장 최소/최대 인원은 차시 카드의 배정 부족·권장 범위·초과 표시 기준입니다. 기본값은 3~4명이며, 수업 운영상 한 차시에 권장하는 학생 수를 의미합니다.</em>
        </div>
      ) : null}

      <div className="mentoring-layout-grid">
        <div className="mentoring-slot-grid mentoring-slot-grid-v4131">
          {visibleSlots.length ? visibleSlots.map((slot) => {
            const rows = displayAssignmentsBySlot[slot.id] || [];
            const capacity = getSlotCapacityStatus(slot, rows.length);
            const studentSequence = rows.map((assignment, sequenceIndex) => ({
              assignmentId: assignment.id,
              studentId: String(assignment.student_id || assignment.students?.id || ''),
              studentName: assignment.students?.name || '학생',
              mentorId: assignment.mentor_id || '',
              mentorName: assignment.mentoring_mentors?.mentor_name || '멘토 미지정',
              sequenceIndex,
            })).filter((item) => item.studentId);
            const hasSlotConflict = rows.some((item) => Boolean(displayConflictsByAssignmentId[String(item.id)] || (item.template_assignment_id ? displayConflictsByAssignmentId[String(item.template_assignment_id)] : null)));
            const slotStatusItems = getDateSlotStatusItems(slot, rows, hasSlotConflict);
            return (
              <div
                key={slot.id}
                className={`mentoring-slot-card ${capacity.className} ${isDateMode && !dateOverrideActive ? 'date-template' : ''} ${dragTargetSlotId && String(dragTargetSlotId) === String(slot.id) ? 'drag-over' : ''}`}
                onDragOver={(event) => handleSlotDragOver(event, slot)}
                onDragLeave={() => { if (String(dragTargetSlotId) === String(slot.id)) setDragTargetSlotId(''); }}
                onDrop={(event) => handleSlotDrop(event, slot)}
              >
                <div className="mentoring-slot-head">
                  <div>
                    <strong>{slot.slot_label}</strong>
                    <span>{isDateMode ? `${selectedDate} · ${dayLabel(slot.day_of_week)}` : dayLabel(slot.day_of_week)} · {slotTime(slot)}</span>
                  </div>
                  <em>{capacity.label}</em>
                  {isDateMode && slotStatusItems.length ? (
                    <div className="mentoring-date-badge-stack">
                      {slotStatusItems.map((status) => <i key={status.key} className={`mentoring-date-mini-badge ${status.className}`}>{status.label}</i>)}
                    </div>
                  ) : null}
                </div>
                <div className="mentoring-assignment-list">
                  {rows.length ? rows.map((item, index) => {
                    const scheduleConflict = displayConflictsByAssignmentId[String(item.id)] || (item.template_assignment_id ? displayConflictsByAssignmentId[String(item.template_assignment_id)] : null);
                    const careContext = {
                      source: 'mentoring',
                      slotId: slot.id,
                      slotLabel: slot.slot_label || '',
                      dayOfWeek: Number(slot.day_of_week),
                      dayLabel: dayLabel(slot.day_of_week),
                      slotTime: slotTime(slot),
                      scheduleDate: isDateMode ? selectedDate : null,
                      scheduleMode: isDateMode ? 'date' : 'template',
                      assignmentId: item.id,
                      mentorId: item.mentor_id || '',
                      mentorName: item.mentoring_mentors?.mentor_name || '멘토 미지정',
                      studentId: String(item.student_id || item.students?.id || ''),
                      currentIndex: index,
                      studentSequence,
                    };
                    return (
                    <div key={item.id} className={`mentoring-assignment-row ${scheduleConflict ? 'schedule-conflict has-conflict' : ''} ${isDateMode && dateOverrideActive ? 'drag-enabled' : ''}`}>
                      {isDateMode && dateOverrideActive ? (
                        <span
                          className="mentoring-drag-handle"
                          draggable={!loading}
                          onDragStart={(event) => handleAssignmentDragStart(event, item, slot)}
                          onDragEnd={handleAssignmentDragEnd}
                          title="잡고 다른 차시로 이동"
                        >
                          이동
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="mentoring-assignment-student-button"
                        onClick={() => onOpenStudentCare?.(item.students || { id: item.student_id }, careContext)}
                        title="출결·관리 이력에서 오늘 멘토 코멘트 입력"
                      >
                        <b>{item.students?.name || '학생'}</b>
                        <span>{item.mentoring_mentors?.mentor_name || '멘토 미지정'}{item.students?.school ? ` · ${item.students.school}` : ''} · 관리이력 열기</span>
                      </button>
                      {scheduleConflict ? (
                        <button
                          type="button"
                          className="mentoring-conflict-pill"
                          onClick={(event) => showConflictDetail(scheduleConflict, event)}
                          title="개인일정 주의 상세 보기"
                        >
                          <span aria-hidden="true">⚠</span>
                          <b>주의 상세</b>
                        </button>
                      ) : null}
                      <button type="button" onClick={() => deleteAssignment(item)} disabled={loading || (isDateMode && !dateOverrideActive)} title={isDateMode && !dateOverrideActive ? '먼저 일정 수정 시작을 눌러주세요.' : ''}>{isDateMode ? '이 날짜에서 제외' : '삭제'}</button>
                    </div>
                    );
                  }) : <div className="empty-mini">아직 배정된 학생이 없습니다.</div>}
                </div>
                <div className="mentoring-slot-actions">
                  <button type="button" className="secondary" disabled={isDateMode && !dateOverrideActive} title={isDateMode && !dateOverrideActive ? '먼저 일정 수정 시작을 눌러주세요.' : ''} onClick={() => { setAssignForm((prev) => ({ ...prev, slotId: slot.id, mentorId: prev.mentorId || activeMentors[0]?.id || '', repeatMode: 'single', repeatDays: [Number(slot.day_of_week)] })); setActiveDay(slot.day_of_week); }}>이 차시에 배정</button>
                  <button type="button" className="secondary" disabled={isDateMode && !dateOverrideActive} title={isDateMode && !dateOverrideActive ? '먼저 일정 수정 시작을 눌러주세요.' : ''} onClick={() => startEditSlot(slot)}>수정</button>
                  <button type="button" className="danger-lite" disabled={isDateMode && !dateOverrideActive} title={isDateMode && !dateOverrideActive ? '먼저 일정 수정 시작을 눌러주세요.' : ''} onClick={() => deleteSlot(slot)}>{isDateMode ? '이 날짜 차시 제외' : '비활성화'}</button>
                </div>
              </div>
            );
          }) : <div className="content-card empty-student-list">{isDateMode ? '선택 날짜의 멘토링 차시가 없습니다. 요일 템플릿 다시 반영 또는 날짜별 차시 추가를 사용하세요.' : '선택한 요일의 멘토링 차시가 없습니다. 기본 세팅 또는 차시 추가를 사용하세요.'}</div>}
        </div>

        <aside className="mentoring-assign-panel">
          <h3>학생 배정</h3>
          <label>
            <span>차시</span>
            <select value={assignForm.slotId} onChange={(event) => handleSlotSelect(event.target.value)}>
              <option value="">차시 선택</option>
              {displaySlots.map((slot) => <option key={slot.id} value={slot.id}>{isDateMode ? selectedDate : dayLabel(slot.day_of_week)} · {slot.slot_label} · {slotTime(slot)}</option>)}
            </select>
          </label>
          <label>
            <span>멘토</span>
            <select value={assignForm.mentorId} onChange={(event) => setAssignForm((prev) => ({ ...prev, mentorId: event.target.value }))}>
              <option value="">멘토 선택</option>
              {activeMentors.map((mentor) => <option key={mentor.id} value={mentor.id}>{mentor.mentor_name}</option>)}
            </select>
          </label>
          {!isDateMode ? (
            <div className="mentoring-repeat-box">
              <span>반복 설정</span>
              <div className="mentoring-repeat-buttons">
                <button type="button" className={assignForm.repeatMode === 'single' ? 'active' : ''} onClick={() => updateRepeatMode('single')}>선택 요일만</button>
                <button type="button" className={assignForm.repeatMode === 'mwf' ? 'active' : ''} onClick={() => updateRepeatMode('mwf')}>월·수·금</button>
                <button type="button" className={assignForm.repeatMode === 'custom' ? 'active' : ''} onClick={() => updateRepeatMode('custom')}>직접 선택</button>
              </div>
              <div className="mentoring-repeat-days">
                {dayOptions.map(([day, label]) => (
                  <label key={day}>
                    <input type="checkbox" checked={selectedRepeatDays.includes(day)} onChange={() => toggleRepeatDay(day)} /> {label.replace('요일', '')}
                  </label>
                ))}
              </div>
              <em>{repeatLabel(selectedRepeatDays)}</em>
            </div>
          ) : (
            <div className="mentoring-repeat-box date-only">
              <span>날짜별 배정</span>
              <em>{dateOverrideActive ? `${selectedDate} 하루 일정에만 반영됩니다. 반복 배정은 요일별 템플릿 화면에서 설정하세요.` : '현재는 요일 기본값 미리보기 상태입니다. 배정 변경은 일정 수정 시작 후 가능합니다.'}</em>
            </div>
          )}
          {isDateMode && !dateOverrideActive ? <div className="mentoring-date-locked-note">일정 수정 시작 전에는 학생 배정을 저장할 수 없습니다.</div> : null}
          <div className="mentoring-student-picker-wrap">
            <div className="mentoring-picker-head">
              <span>학생 복수 선택</span>
              <button type="button" className="text-mini-button" onClick={clearSelectedStudents} disabled={!selectedStudents.length}>선택 해제</button>
            </div>
            <div className="mentoring-student-picker" role="listbox" aria-multiselectable="true">
              {studentPickerRows.map((student) => {
                const assignedSomeDay = isDateMode ? Boolean(dateAssignmentsByStudent[String(student.id)]) : selectedRepeatDays.some((day) => assignmentsByStudentDay[`${student.id}-${day}`]);
                const assignmentLocked = isDateMode && !dateOverrideActive;
                const selected = (assignForm.studentIds || []).map(String).includes(String(student.id));
                const hasMentorSelected = Boolean(assignForm.mentorId);
                const isResponsible = hasMentorSelected && selectedMentorResponsibleIds.has(String(student.id));
                const isNonResponsible = hasMentorSelected && !isResponsible;
                return (
                  <button
                    key={student.id}
                    type="button"
                    className={`mentoring-student-chip ${hasMentorSelected ? 'responsibility-mode' : ''} ${isResponsible ? 'responsible' : ''} ${isNonResponsible ? 'non-responsible' : ''} ${selected ? 'selected' : ''} ${(assignedSomeDay || assignmentLocked) ? 'disabled' : ''}`}
                    onClick={() => toggleAssignStudent(student.id, assignedSomeDay || assignmentLocked)}
                    aria-pressed={selected}
                    disabled={Boolean(assignedSomeDay || assignmentLocked)}
                  >
                    <strong>{student.name}</strong>
                    <span>{student.school || student.grade || '학생'}{assignmentLocked ? ' · 날짜 수정 시작 필요' : assignedSomeDay ? (isDateMode ? ' · 선택 날짜 배정 있음' : ' · 선택 요일 중 배정 있음') : hasMentorSelected ? (isResponsible ? ' · 담당학생' : ' · 비담당학생') : ''}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mentoring-selected-students">
            <strong>선택 {selectedStudents.length}명</strong>
            {selectedStudents.length ? selectedStudents.map((student) => <span key={student.id}>{student.name}</span>) : <em>학생 카드를 클릭하면 선택/해제됩니다.</em>}
          </div>
          <label>
            <span>메모</span>
            <input value={assignForm.note} onChange={(event) => setAssignForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="변경 사유/특이사항" />
          </label>
          <button type="button" className="primary" onClick={assignStudents} disabled={loading || (isDateMode && !dateOverrideActive) || !assignForm.slotId || !assignForm.mentorId || !(assignForm.studentIds || []).length}>배정 저장</button>
          <div className="mentoring-panel-note">
            <b>배정 기준</b>
            <span>{isDateMode ? '날짜별 화면에서는 한 학생이 선택 날짜에 한 차시만 배정됩니다.' : '요일별 템플릿에서는 한 학생이 같은 요일에 한 차시만 배정됩니다.'}</span>
            <span>저장 전 학생 개인 시간표와 멘토링 차시가 충돌하면 상세 경고를 표시합니다.</span>
            <span>나중에 학생 개인 일정이 바뀌어도 기존 멘토링 카드에 개인일정 주의 표시가 남습니다.</span>
            <span>{isDateMode ? '오늘만 바꾸는 일정 조정은 날짜별 화면에서 처리합니다.' : '반복 운영 기준은 요일별 템플릿에서 관리합니다.'}</span>
            <span>멘토를 선택하면 담당학생은 흰색, 비담당학생은 회색으로 보이며 비담당학생도 선택할 수 있습니다.</span>
          </div>
        </aside>
      </div>

      {conflictReview ? (
        <div className="mentoring-conflict-inline">
          <div>
            <strong>개인 시간표와 맞지 않는 배정 {conflictReview.conflicts?.length || 0}건</strong>
            <span>아래 팝업에서 학생별 충돌 차시와 개인 시간표를 확인한 뒤 저장 여부를 결정하세요.</span>
          </div>
          <button type="button" onClick={() => setConflictReview((prev) => prev ? { ...prev, reopenKey: Date.now() } : prev)}>경고 팝업 다시 보기</button>
        </div>
      ) : null}

      {notice ? <div className="form-notice mentoring-notice">{notice}</div> : null}

      {conflictDetail ? (
        <div className="modal-backdrop mentoring-conflict-backdrop">
          <div className="modal-card mentoring-conflict-modal mentoring-conflict-detail-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>개인일정 주의 상세</h3>
                <p>멘토링 시간과 학생 개인 일정이 맞지 않는 이유를 확인하세요.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setConflictDetail(null)}>×</button>
            </div>
            <div className="mentoring-conflict-list">
              <div className="mentoring-conflict-item">
                <strong>{conflictDetail.studentName || '학생'} · {conflictDetail.dayLabel || ''} {conflictDetail.slotLabel || ''}</strong>
                <dl>
                  <div><dt>기준일</dt><dd>{conflictDetail.date || selectedDate}</dd></div>
                  <div><dt>멘토링 시간</dt><dd>{conflictDetail.slotTime || '-'}</dd></div>
                  <div><dt>학생 개인 일정</dt><dd>{conflictDetail.plannedRange || '확인 불가'}{conflictDetail.isDefaultSchedule ? ' · 기본 시간표 적용' : ''}</dd></div>
                  {conflictDetail.scheduleNote ? <div><dt>시간표 메모</dt><dd>{conflictDetail.scheduleNote}</dd></div> : null}
                </dl>
                <em>{conflictDetail.reason || '학생 개인 일정과 멘토링 시간이 맞지 않습니다.'}</em>
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={() => setConflictDetail(null)}>확인</button>
            </div>
          </div>
        </div>
      ) : null}

      {conflictReview ? (
        <div className="modal-backdrop mentoring-conflict-backdrop">
          <div className="modal-card mentoring-conflict-modal" role="dialog" aria-modal="true">
            <div className="modal-head">
              <div>
                <h3>개인 시간표와 맞지 않는 배정이 있습니다</h3>
                <p>배정 저장 전에 학생별 충돌 내용을 확인하세요. 실제 학생 사정상 필요한 경우에만 “그래도 배정”을 선택하세요.</p>
              </div>
              <button type="button" className="modal-close" onClick={() => setConflictReview(null)}>×</button>
            </div>
            <div className="mentoring-conflict-summary">
              <span>충돌 {conflictSummary(conflictReview.conflicts).count}건</span>
              <span>학생 {conflictSummary(conflictReview.conflicts).names.length}명</span>
              <span>차시 {conflictSummary(conflictReview.conflicts).slots.length}개</span>
            </div>
            <div className="mentoring-conflict-list">
              {(conflictReview.conflicts || []).map((conflict, index) => (
                <div key={`${conflict.studentId}-${conflict.slotId}-${index}`} className="mentoring-conflict-item">
                  <strong>{conflict.studentName} · {conflict.dayLabel} {conflict.slotLabel}</strong>
                  <dl>
                    <div><dt>기준일</dt><dd>{conflict.date}</dd></div>
                    <div><dt>멘토링 차시</dt><dd>{conflict.slotTime}</dd></div>
                    <div><dt>개인 시간표</dt><dd>{conflict.plannedRange}{conflict.isDefaultSchedule ? ' · 기본 시간표 적용' : ''}</dd></div>
                    {conflict.scheduleNote ? <div><dt>시간표 메모</dt><dd>{conflict.scheduleNote}</dd></div> : null}
                  </dl>
                  <em>{conflict.reason}</em>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setConflictReview(null)}>취소하고 다시 선택</button>
              <button type="button" className="danger" onClick={() => submitAssignments(true, conflictReview.payload)}>경고 확인 후 그래도 배정</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StudentsTab({ students, seatsForDisplay, openStudentEditor }) {
  const [statusFilter, setStatusFilter] = useState('active');
  const [searchText, setSearchText] = useState('');

  const seatByStudentId = {};
  for (const seat of seatsForDisplay || []) {
    const studentId = seat.current_student_id || seat.current_student?.id;
    if (studentId) seatByStudentId[studentId] = seat;
  }

  const sortedStudents = [...(students || [])].sort((a, b) => {
    const rank = { active: 0, paused: 1, inactive: 2 };
    const ar = rank[a.status || 'active'] ?? 3;
    const br = rank[b.status || 'active'] ?? 3;
    if (ar !== br) return ar - br;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  });

  const activeCount = sortedStudents.filter((student) => student.status === 'active').length;
  const pausedCount = sortedStudents.filter((student) => student.status === 'paused').length;
  const inactiveCount = sortedStudents.filter((student) => student.status === 'inactive').length;
  const unassignedCount = sortedStudents.filter((student) => student.status !== 'inactive' && !student.default_seat_no && !seatByStudentId[student.id]).length;

  const normalizedSearch = String(searchText || '').trim().toLowerCase();
  const filteredStudents = sortedStudents.filter((student) => {
    const seat = seatByStudentId[student.id];
    const status = student.status || 'active';

    if (statusFilter === 'active' && status !== 'active') return false;
    if (statusFilter === 'paused' && status !== 'paused') return false;
    if (statusFilter === 'inactive' && status !== 'inactive') return false;
    if (statusFilter === 'unassigned' && (status === 'inactive' || student.default_seat_no || seat)) return false;

    if (!normalizedSearch) return true;

    const haystack = [
      student.name,
      student.school,
      student.grade,
      student.parent_phone,
      student.student_phone,
      status === 'active' ? '활성' : status === 'paused' ? '휴원 대기' : '비활성',
      seat ? `${seat.seat_no}번 좌석` : '미배정',
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(normalizedSearch);
  });

  function setQuickFilter(nextFilter) {
    setStatusFilter(nextFilter);
  }

  return (
    <section className="content-card">
      <div className="section-head">
        <div>
          <h2>학생 전체 카드</h2>
          <p>학생 기본 DB와 기본 좌석, 연락처 정보를 한 화면에서 관리합니다. 비활성 학생은 DB와 과거 기록을 보존한 상태로 운영 대상에서 제외됩니다.</p>
        </div>
        <button className="primary section-action" onClick={() => openStudentEditor(null)}>학생 추가</button>
      </div>

      <div className="student-db-summary clickable-summary">
        <button className={statusFilter === 'all' ? 'active' : ''} onClick={() => setQuickFilter('all')}><span>전체</span><strong>{sortedStudents.length}명</strong></button>
        <button className={statusFilter === 'active' ? 'active' : ''} onClick={() => setQuickFilter('active')}><span>활성</span><strong>{activeCount}명</strong></button>
        <button className={statusFilter === 'paused' ? 'active' : ''} onClick={() => setQuickFilter('paused')}><span>휴원/대기</span><strong>{pausedCount}명</strong></button>
        <button className={statusFilter === 'inactive' ? 'active' : ''} onClick={() => setQuickFilter('inactive')}><span>비활성</span><strong>{inactiveCount}명</strong></button>
        <button className={statusFilter === 'unassigned' ? 'active' : ''} onClick={() => setQuickFilter('unassigned')}><span>좌석 미배정</span><strong>{unassignedCount}명</strong></button>
      </div>

      <div className="student-management-filter clean-panel">
        <div className="field">
          <label>학생 검색</label>
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="학생명, 학교, 학년, 연락처, 좌석번호 검색" />
        </div>
        <div className="field">
          <label>상태 필터</label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">전체</option>
            <option value="active">활성</option>
            <option value="paused">휴원/대기</option>
            <option value="inactive">비활성</option>
            <option value="unassigned">좌석 미배정</option>
          </select>
        </div>
        <div className="filter-help">
          <strong>{filteredStudents.length}명 표시 중</strong>
          <span>완전 삭제는 비활성 학생에게만 표시됩니다. 일반 퇴원/휴원 학생은 비활성화를 권장합니다.</span>
        </div>
      </div>

      <div className="student-card-grid">
        {filteredStudents.map((student) => {
          const seat = seatByStudentId[student.id];
          const status = student.status || 'active';
          return (
            <button key={student.id} className={`student-db-card ${status === 'inactive' ? 'inactive' : status === 'paused' ? 'paused' : 'active'}`} onClick={() => openStudentEditor(student)}>
              <div className="student-card-top">
                <strong>{student.name}</strong>
                <span>{status === 'active' ? '활성' : status === 'paused' ? '휴원/대기' : '비활성'}</span>
              </div>
              <div className="student-card-meta">
                {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}
              </div>
              <div className="student-card-info">
                <span>보호자: {getGuardianDisplayText(student, 'daily')}</span>
                <span>학생: {student.student_phone || '-'}</span>
              </div>
              <div className={seat ? 'seat-badge assigned' : 'seat-badge unassigned'}>
                {seat ? `${String(seat.seat_no).padStart(2, '0')}번 좌석` : '미배정'}
              </div>
              {status === 'inactive' ? (
                <div className="student-inactive-note">
                  <strong>운영 대상 제외</strong>
                  <span>DB/과거 기록 보존 · 좌석 해제됨</span>
                </div>
              ) : null}
            </button>
          );
        })}

        {(!filteredStudents || filteredStudents.length === 0) ? (
          <div className="empty-student-list">
            <strong>조건에 맞는 학생이 없습니다.</strong>
            <span>검색어를 지우거나 상태 필터를 전체로 변경하세요.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function StudentEditorModal({ editor, setEditor, seatsForDisplay, students, saveEditor, deactivateEditor, deleteEditor }) {
  if (!editor) return null;

  const assignedStudentNameBySeat = {};
  for (const seat of seatsForDisplay || []) {
    const assignedId = seat.current_student_id || seat.current_student?.id;
    if (!assignedId) continue;
    const student = students.find((item) => item.id === assignedId) || seat.current_student;
    assignedStudentNameBySeat[seat.seat_no] = {
      id: assignedId,
      name: student?.name || '배정 학생',
    };
  }

  return (
    <div className="modal-backdrop" onClick={() => setEditor(null)}>
      <div className="student-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="popup-head">
          <div>
            <h2>{editor.id ? '학생 정보 수정' : '학생 추가'}</h2>
            <p>학생 기본정보와 기본 좌석을 함께 관리합니다.</p>
          </div>
          <button onClick={() => setEditor(null)}>닫기</button>
        </div>

        <div className="student-editor-grid">
          <section className="student-editor-card basic-editor-card">
            <h3>학생 기본정보</h3>
            <div className="field">
              <label>학생명</label>
              <input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="예: 김민준" />
              <div className="hint">키오스크 자동 출결 매칭을 위해 동명이인은 이름 뒤에 구분표시를 붙여 저장하세요. 예: 김민준A, 김민준①, 김민준(중1)</div>
            </div>
            <div className="time-grid">
              <div className="field">
                <label>학교</label>
                <input value={editor.school} onChange={(e) => setEditor({ ...editor, school: e.target.value })} placeholder="예: 미사고" />
              </div>
              <div className="field">
                <label>학년</label>
                <input value={editor.grade} onChange={(e) => setEditor({ ...editor, grade: e.target.value })} placeholder="예: 고1" />
              </div>
              <div className="field">
                <label>학생 연락처</label>
                <input value={editor.studentPhone} onChange={(e) => setEditor({ ...editor, studentPhone: e.target.value })} placeholder="010-0000-0000" />
              </div>
              <div className="field">
                <label>상태</label>
                <select value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value })}>
                  <option value="active">활성</option>
                  <option value="paused">휴원/대기</option>
                  <option value="inactive">비활성</option>
                </select>
                <div className="hint">비활성은 DB와 과거 기록을 남겨두되 운영 대상에서 제외하는 상태입니다.</div>
              </div>
              <div className="field">
                <label>현재 좌석</label>
                <input readOnly value={editor.seatNo ? `${String(editor.seatNo).padStart(2, '0')}번 좌석` : '미배정'} />
              </div>
            </div>
            {editor.status === 'inactive' ? (
              <div className="student-inactive-editor-note">
                <strong>비활성 학생</strong>
                <span>운영 대상에서 제외되어 데일리/위클리 리포트 대상에 포함되지 않습니다. 다시 운영하려면 상태를 활성으로 바꾸고 좌석을 배정한 뒤 저장하세요.</span>
              </div>
            ) : null}
          </section>

          <section className="student-editor-card guardian-editor-card">
            <div className="guardian-section-head">
              <div>
                <h3>보호자 연락처</h3>
                <p>데일리/위클리 리포트를 받을 보호자를 여러 명 등록할 수 있습니다.</p>
              </div>
              <button
                className="secondary"
                onClick={() => setEditor({
                  ...editor,
                  guardians: [
                    ...normalizeGuardiansForEditor(editor),
                    {
                      id: `new-guardian-${Date.now()}`,
                      guardianName: '',
                      relationship: '모',
                      phone: '',
                      isPrimary: false,
                      receiveDailyReport: true,
                      receiveWeeklyReport: true,
                      isActive: true,
                      memo: '',
                    },
                  ],
                })}
              >
                + 보호자 추가
              </button>
            </div>

            <div className="guardian-list">
              {normalizeGuardiansForEditor(editor).map((guardian, index) => (
                <div key={guardian.id || index} className={`guardian-row ${guardian.isActive === false ? 'inactive' : ''}`}>
                  <div className="guardian-row-head">
                    <strong>{guardian.isPrimary ? '대표 보호자' : `보호자 ${index + 1}`}</strong>
                    <div className="guardian-row-actions">
                      <button
                        className="secondary"
                        onClick={() => setEditor({
                          ...editor,
                          guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => ({
                            ...item,
                            isPrimary: targetIndex === index,
                          })),
                        })}
                      >
                        대표 지정
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setEditor({
                          ...editor,
                          guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                            targetIndex === index ? { ...item, isActive: item.isActive === false } : item
                          )),
                        })}
                      >
                        {guardian.isActive === false ? '활성화' : '비활성'}
                      </button>
                      <button
                        className="danger-lite"
                        onClick={() => {
                          const next = normalizeGuardiansForEditor(editor).filter((_, targetIndex) => targetIndex !== index);
                          setEditor({ ...editor, guardians: next.length ? next : normalizeGuardiansForEditor({}) });
                        }}
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="guardian-grid">
                    <div className="field">
                      <label>관계</label>
                      <select value={normalizeGuardianRelationship(guardian.relationship)} onChange={(e) => setEditor({
                        ...editor,
                        guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                          targetIndex === index ? { ...item, relationship: e.target.value } : item
                        )),
                      })}>
                        {GUARDIAN_RELATIONSHIP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>성함</label>
                      <input value={guardian.guardianName} onChange={(e) => setEditor({
                        ...editor,
                        guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                          targetIndex === index ? { ...item, guardianName: e.target.value } : item
                        )),
                      })} placeholder="선택 입력" />
                    </div>
                    <div className="field">
                      <label>연락처</label>
                      <input value={guardian.phone} onChange={(e) => setEditor({
                        ...editor,
                        guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                          targetIndex === index ? { ...item, phone: e.target.value } : item
                        )),
                      })} placeholder="010-0000-0000" />
                    </div>
                    <div className="field">
                      <label>수신 설정</label>
                      <div className="guardian-checks">
                        <label><input type="checkbox" checked={guardian.receiveDailyReport !== false} onChange={(e) => setEditor({
                          ...editor,
                          guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                            targetIndex === index ? { ...item, receiveDailyReport: e.target.checked } : item
                          )),
                        })} /> 데일리</label>
                        <label><input type="checkbox" checked={guardian.receiveWeeklyReport !== false} onChange={(e) => setEditor({
                          ...editor,
                          guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                            targetIndex === index ? { ...item, receiveWeeklyReport: e.target.checked } : item
                          )),
                        })} /> 위클리</label>
                      </div>
                    </div>
                  </div>
                  <div className="field">
                    <label>메모</label>
                    <input value={guardian.memo} onChange={(e) => setEditor({
                      ...editor,
                      guardians: normalizeGuardiansForEditor(editor).map((item, targetIndex) => (
                        targetIndex === index ? { ...item, memo: e.target.value } : item
                      )),
                    })} placeholder="예: 데일리는 어머니/위클리는 아버지에게 발송" />
                  </div>
                </div>
              ))}
            </div>
            <div className="hint">대표 보호자는 기존 학부모 연락처(parent_phone)와 호환용으로도 저장됩니다. 실제 리포트 발송 대상은 수신 설정이 켜진 활성 보호자 기준입니다.</div>
          </section>

          <section className="student-editor-card seat-editor-card">
            <h3>좌석 배정</h3>
            <button
              className={`unassign-seat ${!editor.seatNo ? 'selected' : ''}`}
              onClick={() => setEditor({ ...editor, seatNo: '' })}
            >
              미배정으로 두기
            </button>

            <div className="seat-picker-scroll">
              <div className="seat-picker-map">
                <div className="zone-label">FOCUS ROOM · 좌석 선택</div>
                {(seatsForDisplay || []).map((seat) => {
                  const assigned = assignedStudentNameBySeat[seat.seat_no];
                  const isMine = assigned?.id && assigned.id === editor.id;
                  const isDisabled = Boolean(assigned && !isMine);
                  const isSelected = Number(editor.seatNo) === Number(seat.seat_no);

                  return (
                    <button
                      key={seat.seat_no}
                      className={`seat-picker-seat ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
                      style={{ left: seat.x, top: seat.y, width: seat.width, height: seat.height }}
                      disabled={isDisabled}
                      onClick={() => setEditor({ ...editor, seatNo: seat.seat_no })}
                      title={isDisabled ? `${assigned.name} 배정됨` : `${seat.seat_no}번 좌석`}
                    >
                      <strong>{String(seat.seat_no).padStart(2, '0')}</strong>
                      <span>{isDisabled ? assigned.name : isSelected ? '선택' : '가능'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="hint">이미 다른 학생에게 배정된 좌석은 선택할 수 없습니다. 자리 교체가 필요한 경우 먼저 한 학생을 미배정 상태로 저장하세요.</div>
          </section>
        </div>

        <div className="popup-bottom-actions student-editor-actions">
          <div className="student-danger-actions">
            {editor.id && editor.status !== 'inactive' ? (
              <button className="danger-lite" onClick={deactivateEditor}>비활성화(DB 보존)</button>
            ) : null}
            {editor.id && editor.status === 'inactive' ? (
              <button className="secondary" onClick={() => setEditor({ ...editor, status: 'active' })}>활성으로 변경</button>
            ) : null}
            {editor.id && editor.status === 'inactive' ? (
              <button className="danger" onClick={deleteEditor}>완전 삭제</button>
            ) : null}
          </div>
          <div className="student-save-actions">
            <button className="secondary" onClick={() => setEditor(null)}>취소</button>
            <button className="primary" onClick={saveEditor}>학생 정보 저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SchedulesTab(props) {
  const {
    students, scheduleView, setScheduleView, scheduleBaseDate, setScheduleBaseDate,
    scheduleStudentFilter, setScheduleStudentFilter,
    scheduleRows, scheduleBreakRows, scheduleBreaksBySchedule,
    setActivityPopup,
    defaultSchedule = DEFAULT_SCHEDULE_SETTINGS,
    defaultScheduleConfig = null,
    deleteStudentSchedulesRange,
    scheduleCoverage = null,
  } = props;

  const range = getScheduleRange(scheduleView, scheduleBaseDate);
  const dates = makeDateRange(range.start, range.end);
  const selectedFilterStudent = students.find((student) => student.id === scheduleStudentFilter);
  const filteredStudents = selectedFilterStudent ? [selectedFilterStudent] : students;
  const TIMELINE_START = 9 * 60;
  const TIMELINE_END = 23 * 60;
  const TIMELINE_TOTAL = TIMELINE_END - TIMELINE_START;
  const HOURS = Array.from({ length: 15 }, (_, index) => 9 + index);

  function normalizeTime(timeValue) { return timeValue ? timeValue.slice(0, 5) : ''; }
  // v41-40.1: 시간표 탭은 '오늘'의 시간표가 아니라 각 날짜의 요일 유형(평일/토/일/공휴일)에 맞는
  // 기본 시간표를 날짜별로 resolve 해서 사용합니다. (오늘이 일요일이라고 해서 주중 날짜에
  // 일요일 시간표가 적용되지 않도록)
  function resolveForDate(date) {
    if (defaultScheduleConfig?.variants) return resolveScheduleForDate(defaultScheduleConfig, date);
    const flat = normalizeDefaultScheduleSettings(defaultSchedule);
    return { ...flat, dayType: null, operating: defaultSchedule?.operating !== false };
  }
  function findSchedule(studentId, date) { return (scheduleRows || []).find((schedule) => schedule.student_id === studentId && schedule.schedule_date === date); }
  function makeDefaultSchedule(student, date) {
    const settings = resolveForDate(date);
    return { id: `default-${student.id}-${date}`, isDefault: true, student_id: student.id, schedule_date: date, planned_check_in: `${settings.plannedCheckIn}:00`, planned_check_out: `${settings.plannedCheckOut}:00`, parent_confirmed: true, confirmation_note: '', schedule_note: settings.scheduleLabel, students: student };
  }
  function getScheduleForStudentDate(student, date) { return findSchedule(student.id, date) || makeDefaultSchedule(student, date); }
  function getBreaks(schedule) { if (!schedule || schedule.isDefault) return []; return scheduleBreaksBySchedule[schedule.id] || []; }

  // 기준 날짜를 보기 단위(일/주/월)에 맞춰 앞뒤로 이동합니다. (useEffect가 자동 재조회)
  function shiftBaseDate(direction) {
    if (scheduleView === 'month') {
      const d = new Date(`${scheduleBaseDate}T00:00:00`);
      d.setMonth(d.getMonth() + direction);
      setScheduleBaseDate(getKstDateString(d));
      return;
    }
    const step = scheduleView === 'week' ? 7 : 1;
    setScheduleBaseDate(addDays(scheduleBaseDate, step * direction));
  }
  const baseDateNavLabels = scheduleView === 'day'
    ? { prev: '전날', next: '다음날' }
    : scheduleView === 'week'
      ? { prev: '지난주', next: '다음주' }
      : { prev: '지난달', next: '다음달' };

  // 주간/월별에서 날짜 칸의 공백을 클릭하면 그 날짜의 일별 보기로 이동합니다.
  // (차시 칩 등 시간표 버튼 클릭은 stopPropagation으로 수정 팝업을 유지)
  function goToDayView(date) {
    setScheduleBaseDate(date);
    setScheduleView('day');
  }

  function buildActivityBlocks(schedule) {
    const blocks = [];
    const settings = resolveForDate(schedule.schedule_date);
    const start = timeToMinutes(schedule.planned_check_in || settings.plannedCheckIn) ?? timeToMinutes(settings.plannedCheckIn);
    const end = timeToMinutes(schedule.planned_check_out || settings.plannedCheckOut) ?? timeToMinutes(settings.plannedCheckOut);
    // v41-42: 개인 시간표가 저장되지 않은 날짜는 빈 날(등원 예정 없음)로 표시합니다.
    // (기본 시간표는 신규 입력 기본값과 일괄 생성 템플릿으로만 사용)
    if (schedule.isDefault) return blocks;
    // v41-48: 2색 표기 — 기본 시간표 부합(match)=회색, 외출/부재(deviation)=연한 파랑
    const baseInMin = timeToMinutes(settings.plannedCheckIn);
    const baseOutMin = timeToMinutes(settings.plannedCheckOut);
    const absenceReason = String(schedule.schedule_note || '').trim();
    const absenceLabel = absenceReason ? `부재_${absenceReason}` : '부재';
    const breaks = getBreaks(schedule);
    const periodBlocks = getDefaultScheduleSegmentsExcludingBreaks(minutesToTime(start), minutesToTime(end), breaks, settings).map((segment) => ({
      id: `period-${schedule.student_id}-${schedule.schedule_date}-${segment.label}-${segment.startMinute}-${segment.endMinute}-${segment.splitIndex || 0}`,
      type: 'match',
      startMinute: segment.startMinute,
      endMinute: segment.endMinute,
      title: segment.label,
      detail: segment.detail,
      schedule,
    }));
    const breakBlocks = breaks
      .map((item, index) => {
        const startMinute = timeToMinutes(item.leave_start);
        if (startMinute === null) return null;
        const endMinute = timeToMinutes(item.return_time) ?? startMinute + 40;
        const leave = Math.max(start, Math.min(end, startMinute));
        const ret = Math.max(leave, Math.min(end, endMinute));
        if (ret <= leave) return null;
        const reasonText = [item.reason, item.reason_detail].filter(Boolean).join(' · ');
        return {
          id: `break-${item.id || index}`,
          type: 'deviation',
          startMinute: leave,
          endMinute: ret,
          title: reasonText ? `외출_${reasonText}` : '외출',
          detail: `${minutesToTime(leave)}~${minutesToTime(ret)}`,
          schedule,
        };
      })
      .filter(Boolean);

    // 늦은 등원 / 이른 하원 → '부재' 구간(연한 파랑)
    const absenceBlocks = [];
    if (start !== null && baseInMin !== null && start > baseInMin) {
      absenceBlocks.push({ id: `absence-in-${schedule.student_id}-${schedule.schedule_date}`, type: 'deviation', startMinute: baseInMin, endMinute: start, title: absenceLabel, detail: `${minutesToTime(baseInMin)}~${minutesToTime(start)}`, schedule });
    }
    if (end !== null && baseOutMin !== null && end < baseOutMin) {
      absenceBlocks.push({ id: `absence-out-${schedule.student_id}-${schedule.schedule_date}`, type: 'deviation', startMinute: end, endMinute: baseOutMin, title: absenceLabel, detail: `${minutesToTime(end)}~${minutesToTime(baseOutMin)}`, schedule });
    }

    blocks.push(...periodBlocks, ...breakBlocks, ...absenceBlocks);
    blocks.sort((a, b) => a.startMinute - b.startMinute || (a.type === 'deviation' ? 1 : -1));
    if (!blocks.length) blocks.push({ id: `study-${schedule.student_id}-${schedule.schedule_date}-empty`, type: 'match', startMinute: start, endMinute: end, title: '자율학습', detail: `${minutesToTime(start)}~${minutesToTime(end)}`, schedule });
    return blocks;
  }

  function currentTimeLineStyle(date) {
    if (date !== getKstDateString()) return null;
    const current = currentKstMinutes();
    if (current < TIMELINE_START || current > TIMELINE_END) return null;
    return { top: `${((current - TIMELINE_START) / TIMELINE_TOTAL) * 100}%` };
  }
  function activityStyle(block, index, compact = false) {
    const start = Math.max(TIMELINE_START, block.startMinute);
    const end = Math.min(TIMELINE_END, block.endMinute || block.startMinute + 15);
    const top = ((start - TIMELINE_START) / TIMELINE_TOTAL) * 100;
    const height = Math.max(((end - start) / TIMELINE_TOTAL) * 100, compact ? 2.8 : 4);
    const lane = index % (compact ? 2 : 3);
    const left = compact ? 6 + lane * 8 : 110 + lane * 18;
    const right = compact ? 6 : 18;
    return { top: `${top}%`, height: `${height}%`, left: `${left}px`, right: `${right}px` };
  }
  function openActivityPopup(schedule) {
    const student = schedule.students;
    const dayDefaults = resolveForDate(schedule.schedule_date);
    const breaks = getBreaks(schedule).map((item) => ({ leaveStart: item.leave_start?.slice(0, 5) || '', returnTime: item.return_time?.slice(0, 5) || '', reason: item.reason || '기타', reasonDetail: item.reason_detail || '', breakNote: item.break_note || '' }));
    setActivityPopup({ studentId: schedule.student_id, studentName: student?.name || '학생', studentInfo: [student?.school, student?.grade].filter(Boolean).join(' '), scheduleDate: schedule.schedule_date, plannedCheckIn: normalizeTime(schedule.planned_check_in) || dayDefaults.plannedCheckIn, plannedCheckOut: normalizeTime(schedule.planned_check_out) || dayDefaults.plannedCheckOut, parentConfirmed: Boolean(schedule.parent_confirmed), confirmationNote: schedule.confirmation_note || '', scheduleNote: schedule.schedule_note || '', breaks, commuteRepeat: 'none', commuteRepeatUntil: schedule.schedule_date, breakRepeat: 'none', breakRepeatUntil: schedule.schedule_date });
  }
  function renderDayTimeline(date, student) {
    const schedule = getScheduleForStudentDate(student, date);
    const blocks = buildActivityBlocks(schedule);
    const nowStyle = currentTimeLineStyle(date);
    return <div className="activity-timeline-wrap"><div className="timeline-title"><strong>{student.name} 학생 시간표 · {date}</strong><span>{blocks.length}개 액티비티 블록</span></div><div className="day-timeline activity-mode"><div className="timeline-hour-labels">{HOURS.map((hour) => <div key={hour} style={{ top: `${((hour * 60 - TIMELINE_START) / TIMELINE_TOTAL) * 100}%` }}>{hour < 12 ? `오전 ${hour}시` : hour === 12 ? '오후 12시' : `오후 ${hour - 12}시`}</div>)}</div><div className="timeline-grid-lines">{HOURS.map((hour) => <div key={hour} style={{ top: `${((hour * 60 - TIMELINE_START) / TIMELINE_TOTAL) * 100}%` }} />)}</div>{nowStyle ? <div className="now-line" style={nowStyle}><span>현재 시간</span></div> : null}{blocks.map((block, index) => <button key={block.id} className={`activity-block ${block.type}`} style={activityStyle(block, index)} onClick={() => openActivityPopup(schedule)}><b>{block.title}</b><span>{block.detail}</span><em>클릭하여 수정</em></button>)}</div></div>;
  }

  return <section className="content-card"><h2>학생 시간표</h2><p>개인 시간표가 저장된 날짜만 등원 예정으로 처리됩니다. 기본 시간표 일괄 생성은 설정 &gt; 기본 시간표 설정에서 총괄 관리자가 실행하며, 예외 일정은 블록을 클릭해 수정하거나 삭제하세요.</p>{scheduleCoverage?.warnings?.length ? <div className="template-validation-list failed"><strong>개인 시간표 공백 경고 ({scheduleCoverage.warnings.length}명)</strong><span>{scheduleCoverage.warnings.map((warning) => warning.kind === 'missing' ? `${warning.name}: 시간표 없음` : `${warning.name}: ${warning.lastDate}까지만 있음`).join(' · ')} — 이 학생들은 시간표가 없는 날 결석해도 감지되지 않습니다. 설정 &gt; 기본 시간표 설정의 일괄 생성으로 채워주세요.</span></div> : null}<div className="schedule-target-bar"><div><span>보기 대상</span><strong>{selectedFilterStudent ? `${selectedFilterStudent.name} 학생 시간표` : '전체 학생 시간표'}</strong></div><select value={scheduleStudentFilter} onChange={(e) => setScheduleStudentFilter(e.target.value)}><option value="all">전체 학생</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ')}</option>)}</select></div>{selectedFilterStudent && deleteStudentSchedulesRange ? <div className="repeat-box student-schedule-purge-box"><h4>{selectedFilterStudent.name} 학생 시간표 일괄 삭제</h4><div className="planner-head-actions" style={{ flexWrap: 'wrap' }}><button className="danger section-action" onClick={() => deleteStudentSchedulesRange({ student: selectedFilterStudent, mode: 'from', fromDate: scheduleBaseDate })}>기준 날짜({scheduleBaseDate}) 이후 삭제</button><button className="danger section-action" onClick={() => deleteStudentSchedulesRange({ student: selectedFilterStudent, mode: 'all' })}>전체 기간 삭제</button></div><div className="hint">삭제된 날짜는 빈 날(등원 예정 없음)이 됩니다. 아래 &apos;기준 날짜&apos;를 바꾸면 삭제 시작일을 지정할 수 있습니다.</div></div> : null}<div className="calendar-controls"><div className="view-buttons"><button className={scheduleView === 'day' ? 'active' : ''} onClick={() => setScheduleView('day')}>일별</button><button className={scheduleView === 'week' ? 'active' : ''} onClick={() => setScheduleView('week')}>주간</button><button className={scheduleView === 'month' ? 'active' : ''} onClick={() => setScheduleView('month')}>월별</button></div><div className="base-date-nav"><button className="secondary" onClick={() => shiftBaseDate(-1)}>◀ {baseDateNavLabels.prev}</button><div className="field"><label>기준 날짜</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={scheduleBaseDate} onChange={(e) => setScheduleBaseDate(e.target.value)} /></div><button className="secondary" onClick={() => shiftBaseDate(1)}>{baseDateNavLabels.next} ▶</button></div><button className="primary" onClick={() => selectedFilterStudent ? openActivityPopup(getScheduleForStudentDate(selectedFilterStudent, scheduleBaseDate)) : alert('개별 학생을 먼저 선택하세요.')}>선택 학생 시간표 수정</button></div><div className="timeline-legend"><span><i className="event-dot match"></i>기본 시간표 부합</span><span><i className="event-dot deviation"></i>외출 · 부재(늦은 등원/이른 하원)</span></div>{scheduleView === 'day' ? (selectedFilterStudent ? renderDayTimeline(scheduleBaseDate, selectedFilterStudent) : <div className="student-timeline-overview">{students.map((student) => { const schedule = getScheduleForStudentDate(student, scheduleBaseDate); const blocks = buildActivityBlocks(schedule); return <button key={student.id} className="student-activity-row" onClick={() => { setScheduleStudentFilter(student.id); openActivityPopup(schedule); }}><strong>{student.name}</strong><div>{blocks.length ? blocks.map((block) => <span key={block.id} className={`mini-activity ${block.type}`}>{block.title} {block.detail}</span>) : <span className="mini-activity">시간표 없음 · 클릭하여 추가</span>}</div></button>; })}</div>) : null}{scheduleView === 'week' ? <div className="week-nav-wrap"><button className="week-nav-btn secondary" onClick={() => shiftBaseDate(-1)} aria-label="지난주">◀</button><div className="week-activity-grid">{dates.map((date) => <div key={date} className={`calendar-day clickable-blank-day ${date === getKstDateString() ? 'today' : ''}`} onClick={() => goToDayView(date)} title={`${date} 일별 시간표 보기`}><strong>{date.slice(5)}</strong>{selectedFilterStudent ? (() => { const schedule = getScheduleForStudentDate(selectedFilterStudent, date); const blocks = buildActivityBlocks(schedule); if (!blocks.length) return <button className="schedule-chip activity-chip" onClick={(e) => { e.stopPropagation(); openActivityPopup(schedule); }}><b>시간표 없음</b>클릭하여 추가</button>; return blocks.map((block) => <button key={block.id} className={`schedule-chip activity-chip ${block.type}`} onClick={(e) => { e.stopPropagation(); openActivityPopup(schedule); }}><b>{block.title}</b>{block.detail}</button>); })() : <div className="muted">학생을 선택하면 주간 액티비티가 표시됩니다.</div>}</div>)}</div><button className="week-nav-btn secondary" onClick={() => shiftBaseDate(1)} aria-label="다음주">▶</button></div> : null}{scheduleView === 'month' ? <div className="calendar-grid month-grid month-calendar">{['일', '월', '화', '수', '목', '금', '토'].map((dowLabel) => <div key={`dow-${dowLabel}`} className="month-weekday-head">{dowLabel}</div>)}{Array.from({ length: dates.length ? getDayOfWeekFromDateString(dates[0]) : 0 }, (_, padIndex) => <div key={`month-pad-${padIndex}`} className="month-pad-cell" aria-hidden="true" />)}{dates.map((date) => { const dayDefaults = resolveForDate(date); const dateSchedules = filteredStudents.map((student) => getScheduleForStudentDate(student, date)).filter((schedule) => !schedule.isDefault); const breakCount = dateSchedules.reduce((sum, schedule) => sum + getBreaks(schedule).length, 0); const lateCount = dateSchedules.filter((schedule) => normalizeTime(schedule.planned_check_in) !== dayDefaults.plannedCheckIn).length; const earlyCount = dateSchedules.filter((schedule) => normalizeTime(schedule.planned_check_out) !== dayDefaults.plannedCheckOut).length; return <div key={date} role="button" tabIndex={0} className={`calendar-day clickable-month-day clickable-blank-day ${date === getKstDateString() ? 'today' : ''}`} onClick={() => goToDayView(date)} title={`${date} 일별 시간표 보기`}><strong>{date.slice(5)}</strong>{selectedFilterStudent ? (() => { const hasSchedule = dateSchedules.length > 0; const deviation = Boolean(breakCount || lateCount || earlyCount); const tone = hasSchedule ? (deviation ? 'deviation' : 'match') : 'empty'; const chipLabel = hasSchedule ? (deviation ? '변동 · 수정' : '부합 · 수정') : '시간표 없음 · 추가'; return <button className={`month-summary-chip month-chip-button ${tone}`} onClick={(e) => { e.stopPropagation(); openActivityPopup(getScheduleForStudentDate(selectedFilterStudent, date)); }}>{chipLabel}</button>; })() : <div className="month-summary-chip">개인 시간표 {dateSchedules.length}명</div>}{breakCount ? <div className="month-summary-chip deviation">외출 {breakCount}건</div> : null}{lateCount ? <div className="month-summary-chip deviation">늦은 등원 {lateCount}건</div> : null}{earlyCount ? <div className="month-summary-chip deviation">등하원 조정 {earlyCount}건</div> : null}</div>; })}</div> : null}</section>;
}



function PlannerTab({ students, planners, plannerDate, setPlannerDate, loadPlanners, runPlannerDiagnostics, uploadPlannerFile }) {
  const [studentId, setStudentId] = useState('');
  const [memo, setMemo] = useState('');
  const [file, setFile] = useState(null);

  const plannerByStudentId = {};
  for (const planner of planners || []) plannerByStudentId[planner.student_id] = planner;

  async function submitUpload() {
    const saved = await uploadPlannerFile({ studentId, date: plannerDate, file, memo });
    if (saved) {
      setMemo('');
      setFile(null);
      const input = document.getElementById('planner-file-input');
      if (input) input.value = '';
      const cameraInput = document.getElementById('planner-camera-input');
      if (cameraInput) cameraInput.value = '';
    }
  }

  return (
    <section className="content-card">
      <div className="section-head">
        <div>
          <h2>데일리 플래너 업로드</h2>
          <p>학생별 날짜별 플래너 사진을 저장하고, 미제출 학생을 바로 확인합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={() => loadPlanners(plannerDate)}>새로고침</button>
          <button className="secondary section-action" onClick={runPlannerDiagnostics}>플래너 진단</button>
        </div>
      </div>

      <div className="planner-layout">
        <section className="planner-upload-card">
          <h3>플래너 사진 업로드</h3>
          <div className="field">
            <label>날짜</label>
            <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={plannerDate} onChange={(e) => setPlannerDate(e.target.value)} />
          </div>
          <div className="field">
            <label>학생</label>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">학생 선택</option>
              {(students || []).map((student) => (
                <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ')}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>플래너 사진 가져오기</label>
            <input id="planner-file-input" type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <div className="field">
            <label>기기에서 바로 촬영</label>
            <input id="planner-camera-input" type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          {file ? <div className="selected-file-name">선택된 파일: {file.name}</div> : null}
          <div className="field">
            <label>메모</label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 플래너 작성 상태 양호" />
          </div>
          <button className="primary full-width-btn" onClick={submitUpload}>플래너 업로드</button>
          <div className="hint">같은 날짜/학생으로 다시 업로드하면 기존 사진이 교체됩니다.</div>
        </section>

        <section className="planner-status-card">
          <h3>{plannerDate} 제출 현황</h3>
          <div className="planner-status-summary">
            <div><span>전체</span><strong>{students.length}</strong></div>
            <div><span>업로드</span><strong>{Object.keys(plannerByStudentId).length}</strong></div>
            <div><span>미제출</span><strong>{Math.max(0, students.length - Object.keys(plannerByStudentId).length)}</strong></div>
          </div>

          <table className="data-table planner-table">
            <thead>
              <tr>
                <th>학생</th>
                <th>상태</th>
                <th>메모</th>
                <th>사진</th>
                <th>업로드</th>
              </tr>
            </thead>
            <tbody>
              {(students || []).map((student) => {
                const planner = plannerByStudentId[student.id];
                return (
                  <tr key={student.id}>
                    <td>{student.name}<br /><span className="muted-small">{[student.school, student.grade].filter(Boolean).join(' ')}</span></td>
                    <td>
                      <span className={planner ? 'status-pill done' : 'status-pill pending'}>
                        {planner ? '업로드 완료' : '미제출'}
                      </span>
                    </td>
                    <td>{planner?.memo || '-'}</td>
                    <td>
                      {planner?.signedUrl ? (
                        <a href={planner.signedUrl} target="_blank" rel="noreferrer">사진 보기</a>
                      ) : '-'}
                    </td>
                    <td><button onClick={() => setStudentId(student.id)}>선택</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </section>
  );
}

function DailyReportsTab({ sessions, reportsBySession, checksBySession, eventsBySession, nowTick, planners, plannerDate, setPlannerDate, generateReport, generateAllReports, openSendPreview, sendReportToParent, prepareReportSend, markReportManualSent, exclusionsBySession, updateReportExclusion, operatingRules, todaySchedules, apiFetch, sendConfig, currentUser, defaultSchedule = DEFAULT_SCHEDULE_SETTINGS }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [issueFilter, setIssueFilter] = useState('all');
  const [confirmSend, setConfirmSend] = useState(null);
  const [openCards, setOpenCards] = useState({});
  const [copyNotice, setCopyNotice] = useState('');
  const [reportView, setReportView] = useState('main');
  const rules = normalizeOperatingRules(operatingRules);
  const [targetSessions, setTargetSessions] = useState([]);
  const [targetChecks, setTargetChecks] = useState([]);
  const [targetEvents, setTargetEvents] = useState([]);
  const [targetReports, setTargetReports] = useState([]);
  const [targetSchedules, setTargetSchedules] = useState([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  const [reportActivityLogs, setReportActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [bulkSendRun, setBulkSendRun] = useState(null);
  const [dailyShareLinksByReportId, setDailyShareLinksByReportId] = useState({});
  const [shareLinkWorking, setShareLinkWorking] = useState(false);

  const dailyChecksBySession = useMemo(() => groupBySession(targetChecks), [targetChecks]);
  const dailyEventsBySession = useMemo(() => groupBySession(targetEvents), [targetEvents]);
  const dailyReportsBySession = useMemo(() => {
    const grouped = {};
    for (const report of targetReports || []) grouped[report.session_id] = report;
    return grouped;
  }, [targetReports]);

  const sessionsForReport = targetsLoaded ? targetSessions : sessions;
  const checksBySessionForReport = targetsLoaded ? dailyChecksBySession : checksBySession;
  const eventsBySessionForReport = targetsLoaded ? dailyEventsBySession : eventsBySession;
  const reportsBySessionForReport = targetsLoaded ? dailyReportsBySession : reportsBySession;

  useEffect(() => {
    loadDailyReportTargets(plannerDate);
    loadDailyReportActivity(plannerDate);
  }, [plannerDate]);

  async function loadDailyReportTargets(date = plannerDate) {
    try {
      setTargetLoading(true);
      const data = await apiFetch(`/api/daily-report-targets?date=${date}`);
      setTargetSessions(data.sessions || []);
      setTargetChecks(data.checks || []);
      setTargetEvents(data.events || []);
      const reports = data.reports || [];
      setTargetReports(reports);
      setTargetSchedules(data.schedules || []);
      setTargetsLoaded(true);
      await loadDailyShareLinkStatuses(reports);
    } catch (error) {
      setTargetSessions([]);
      setTargetChecks([]);
      setTargetEvents([]);
      setTargetReports([]);
      setTargetSchedules([]);
      setTargetsLoaded(false);
    } finally {
      setTargetLoading(false);
    }
  }

  async function loadDailyReportActivity(date = plannerDate) {
    try {
      setActivityLoading(true);
      const data = await apiFetch(`/api/report-activity?type=daily&date=${date}`);
      setReportActivityLogs(data.logs || []);
    } catch {
      setReportActivityLogs([]);
    } finally {
      setActivityLoading(false);
    }
  }

  async function loadDailyShareLinkStatuses(reports = targetReports) {
    const reportIds = (reports || []).map((report) => report.id).filter(Boolean);
    if (!reportIds.length) {
      setDailyShareLinksByReportId({});
      return {};
    }
    try {
      const data = await apiFetch(`/api/report-share-link?status=all&reportType=daily&reportIds=${encodeURIComponent(reportIds.join(','))}`);
      const map = data.linksByReportId || {};
      setDailyShareLinksByReportId(map);
      return map;
    } catch {
      setDailyShareLinksByReportId({});
      return {};
    }
  }

  async function ensureDailyReportSession(session) {
    if (!session?.is_virtual) return session;
    try {
      const data = await apiFetch('/api/daily-report-targets', {
        method: 'POST',
        body: JSON.stringify({
          studentId: session.student_id,
          date: plannerDate,
        }),
      });
      await loadDailyReportTargets(plannerDate);
      return data.session;
    } catch (error) {
      alert(error.message || '세션 생성에 실패했습니다.');
      return null;
    }
  }

  const scheduleByStudentId = {};
  for (const schedule of (targetsLoaded ? targetSchedules : todaySchedules) || []) {
    scheduleByStudentId[schedule.student_id] = schedule;
  }

  function getSessionRowForRules(session) {
    const sessionEvents = eventsBySessionForReport[session.id] || [];
    const awayEvents = sessionEvents.filter((event) => event.event_type === 'away');
    const report = reportsBySessionForReport[session.id] || {};
    const checks = checksBySessionForReport[session.id] || [];
    const schedule = scheduleByStudentId[session.student_id] || {};
    return {
      status: session.seat_status,
      checkInAt: session.check_in_at,
      checkOutAt: session.check_out_at,
      checkInTime: formatKstTime(session.check_in_at),
      checkOutTime: session.check_out_at ? formatKstTime(session.check_out_at) : '',
      plannedCheckInTime: schedule.planned_check_in || '',
      plannedCheckOutTime: schedule.planned_check_out || '',
      awayCount: awayEvents.length,
      awayMinutes: getTotalAwayMinutes(session, nowTick),
      pureStudyMinutes: calculateLivePureStudyMinutes(session, nowTick, eventsBySessionForReport[session.id] || [], defaultSchedule),
      mentorComment: report.mentor_comment || '',
      attendanceMemo: session.attendance_memo || '',
      eventSummary: checks.map((check) => [check.study_status, check.subject, check.study_content].filter(Boolean).join(' ')).join(' / '),
      attendanceIssueReasons: {
        결석: getLatestEventMemoReason(sessionEvents, 'absent', '결석'),
        지각: getLatestEventMemoReason(sessionEvents, 'check_in', '지각'),
        조퇴: getLatestEventMemoReason(sessionEvents, 'check_out', '조퇴'),
      },
      absentReason: getLatestEventMemoReason(sessionEvents, 'absent', '결석'),
      lateReason: getLatestEventMemoReason(sessionEvents, 'check_in', '지각'),
      earlyLeaveReason: getLatestEventMemoReason(sessionEvents, 'check_out', '조퇴'),
    };
  }

  function getOperationalIssues(session) {
    const map = {
      '결석': 'attendance_absent',
      '지각': 'attendance_late',
      '조퇴': 'attendance_early_leave',
      '외출과다': 'attendance_excessive_away',
      '순공부족': 'attendance_low_study',
      '미등원': 'no_session',
    };
    const issues = [];
    const missingCheckIn = ['away', 'out'].includes(session.seat_status) && !session.check_in_at;

    if (session.seat_status === 'absent') {
      issues.push({ key: 'attendance_absent', label: '결석', type: 'danger' });
    }
    if (missingCheckIn) {
      issues.push({ key: 'missing_checkin', label: '입실시간 누락', type: 'danger' });
    }

    for (const flag of getAttendanceFlags(getSessionRowForRules(session), rules).filter((item) => item.label !== '정상')) {
      if (flag.label === '결석' && session.seat_status === 'absent') continue;
      if (flag.label === '미등원' && (session.seat_status === 'absent' || missingCheckIn)) continue;
      issues.push({ key: map[flag.label] || `attendance_${flag.label}`, label: flag.label, type: flag.type });
    }

    const seen = new Set();
    return issues.filter((issue) => {
      if (seen.has(issue.key)) return false;
      seen.add(issue.key);
      return true;
    });
  }

  function getAwaySummary(session) {
    const awayEvents = (eventsBySessionForReport[session.id] || []).filter((event) => event.event_type === 'away');
    const details = [...new Set(awayEvents.map((event) => String(event.memo || '').trim()).filter(Boolean))];
    const total = getTotalAwayMinutes(session, nowTick);
    if (!awayEvents.length) return '외출 없음';
    return `총 ${formatMinutes(total)}, ${awayEvents.length}회${details.length ? `, ${details.join(', ')}` : ''}`;
  }

  const plannerByStudentId = {};
  for (const planner of planners || []) plannerByStudentId[planner.student_id] = planner;

  function getPlannerAttachStatus(session) {
    const planner = plannerByStudentId[session.student_id];
    if (!planner) return '미제출';
    return planner.signedUrl ? '첨부 가능' : '업로드 확인';
  }

  function getBlockingIssues(session) {
    const issues = [];
    if (!getActiveGuardians(session.students, 'daily').length) issues.push({ key: 'missing_parent_phone', label: '수신 보호자 없음' });
    return issues;
  }

  function getWarningIssues(session) {
    const report = reportsBySessionForReport[session.id];
    const issues = [];
    if (!plannerByStudentId[session.student_id]) issues.push({ key: 'missing_planner', label: '플래너 미제출' });
    if (!session.is_virtual && !report?.mentor_comment) issues.push({ key: 'missing_mentor', label: '오늘 코멘트 미입력' });
    if (!session.is_virtual && !(checksBySessionForReport[session.id] || []).length) issues.push({ key: 'no_checks', label: '순찰 없음' });
    if (!session.is_virtual) {
      for (const issue of getOperationalIssues(session)) issues.push(issue);
    }
    return issues;
  }

  function getAllIssues(session) {
    return [...getBlockingIssues(session), ...getWarningIssues(session)];
  }

  function isExcluded(session) {
    return Boolean(exclusionsBySession?.[session.id]);
  }

  function canSendBase(session) {
    return getBlockingIssues(session).length === 0 && !isExcluded(session);
  }

  function isRecommended(session) {
    return canSendBase(session) && getWarningIssues(session).length === 0;
  }

  function getDecisionStatus(session) {
    if (session.is_virtual) return 'no_session';
    if (isExcluded(session)) return 'excluded';
    if (getBlockingIssues(session).length) return 'blocked';
    if (isRecommended(session)) return 'recommended';
    return 'decision';
  }

  function getDecisionLabel(session) {
    const status = getDecisionStatus(session);
    if (status === 'recommended') return '발송 가능';
    if (status === 'decision') return '확인 필요';
    if (status === 'no_session') return '입실 기록 없음';
    if (status === 'excluded') return '발송 제외';
    return '발송 불가';
  }

  function getDecisionClass(session) {
    const status = getDecisionStatus(session);
    if (status === 'recommended') return 'done';
    if (status === 'decision') return 'neutral';
    if (status === 'no_session') return 'pending';
    if (status === 'excluded') return 'pending';
    return 'failed';
  }

  function passesStatusFilter(session) {
    if (statusFilter === 'all') return true;
    if (['recommended', 'decision', 'blocked', 'excluded', 'no_session'].includes(statusFilter)) return getDecisionStatus(session) === statusFilter;
    const report = reportsBySessionForReport[session.id];
    return getReportWorkflowStatus(report) === statusFilter;
  }

  function passesIssueFilter(session) {
    if (issueFilter === 'all') return true;
    return getAllIssues(session).some((issue) => issue.key === issueFilter);
  }

  const recommendedTargets = sessionsForReport.filter((session) => !session.is_virtual && isRecommended(session) && reportsBySessionForReport[session.id]?.send_status !== 'sent');
  const decisionTargets = sessionsForReport.filter((session) => !session.is_virtual && canSendBase(session) && reportsBySessionForReport[session.id]?.send_status !== 'sent');
  const filteredSessions = sessionsForReport.filter((session) => passesStatusFilter(session) && passesIssueFilter(session));

  const summary = sessionsForReport.reduce((acc, session) => {
    const report = reportsBySessionForReport[session.id];
    const workflowStatus = getReportWorkflowStatus(report);
    const decisionStatus = getDecisionStatus(session);
    acc.total += 1;
    acc[workflowStatus] = (acc[workflowStatus] || 0) + 1;
    acc[decisionStatus] = (acc[decisionStatus] || 0) + 1;
    if (getWarningIssues(session).length) acc.warnings += 1;
    return acc;
  }, { total: 0, recommended: 0, decision: 0, no_session: 0, blocked: 0, excluded: 0, warnings: 0, not_generated: 0, generated: 0, ready: 0, sent: 0, failed: 0 });

  const failedRetryTargets = sessionsForReport.filter((session) => !session.is_virtual && canSendBase(session) && reportsBySessionForReport[session.id]?.send_status === 'failed');

  function buildCloseoutIssueSummary() {
    const issueMap = new Map();
    for (const session of sessionsForReport) {
      for (const issue of getAllIssues(session)) {
        const current = issueMap.get(issue.key) || {
          key: issue.key,
          label: issue.label,
          count: 0,
          type: issue.type || (issue.key === 'missing_parent_phone' ? 'danger' : 'warning'),
        };
        current.count += 1;
        issueMap.set(issue.key, current);
      }
    }
    return Array.from(issueMap.values()).sort((a, b) => {
      const rank = (item) => item.type === 'danger' || item.key === 'missing_parent_phone' ? 0 : 1;
      return rank(a) - rank(b) || b.count - a.count || a.label.localeCompare(b.label, 'ko');
    });
  }

  const closeoutIssueSummary = buildCloseoutIssueSummary();
  const closeoutReadyPercent = summary.total ? Math.round((summary.recommended / summary.total) * 100) : 0;

  function getDailyReportForSession(session) {
    return reportsBySessionForReport[session.id] || null;
  }

  function getDailyShareLinkForSession(session) {
    const report = getDailyReportForSession(session);
    if (!report?.id) return null;
    return dailyShareLinksByReportId[String(report.id)] || dailyShareLinksByReportId[report.id] || null;
  }

  function getShareLinkState(session) {
    if (session?.is_virtual) return { key: 'no_session', label: '세션 필요', cls: 'pending', detail: '오늘 리포트 대상 생성 필요' };
    const report = getDailyReportForSession(session);
    if (!report?.id || !report?.report_text) return { key: 'missing_report', label: '리포트 생성 필요', cls: 'pending', detail: '미리보기 또는 링크 생성 시 자동 생성' };
    const link = getDailyShareLinkForSession(session);
    if (!link) return { key: 'missing_link', label: '링크 생성 필요', cls: 'neutral', detail: '발송 전 자동 생성 가능' };
    if (link.expired) return { key: 'expired', label: '링크 만료', cls: 'failed', detail: '재생성 필요' };
    if (link.is_active === false) return { key: 'revoked', label: '링크 비활성', cls: 'failed', detail: '재생성 필요' };
    return { key: 'ready', label: '링크 정상', cls: 'done', detail: link.url || '' };
  }

  const shareLinkSummary = sessionsForReport.reduce((acc, session) => {
    const state = getShareLinkState(session).key;
    acc.total += 1;
    acc[state] = (acc[state] || 0) + 1;
    if (['ready'].includes(state)) acc.ready += 1;
    if (['missing_link', 'expired', 'revoked'].includes(state)) acc.needsLink += 1;
    if (['missing_report', 'no_session'].includes(state)) acc.needsReport += 1;
    return acc;
  }, { total: 0, ready: 0, needsLink: 0, needsReport: 0, missing_link: 0, expired: 0, revoked: 0, missing_report: 0, no_session: 0 });

  async function ensureDailyReportAndShareLink(session, { open = false, silent = false } = {}) {
    if (!session || session.is_virtual) throw new Error('먼저 오늘 리포트 대상을 생성해야 합니다.');
    let report = reportsBySessionForReport[session.id];
    if (!report?.id || !report?.report_text) {
      if (!silent) setCopyNotice(`${session.students?.name || '학생'} 리포트 생성 중...`);
      const data = await apiFetch('/api/report', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: session.id,
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      report = data.report;
      if (data.report) {
        setTargetReports((prev) => {
          const others = (prev || []).filter((item) => item.session_id !== data.report.session_id);
          return [...others, data.report];
        });
      }
    }

    if (!report?.id) throw new Error('리포트 생성 후 다시 시도하세요.');

    const data = await apiFetch('/api/report-share-link', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        reportType: 'daily',
        reportId: report.id,
      }),
    });
    if (!data.url) throw new Error(data.error || '공개 리포트 링크를 생성하지 못했습니다.');
    setDailyShareLinksByReportId((prev) => ({
      ...(prev || {}),
      [String(report.id)]: { ...(data.link || {}), report_id: report.id, report_type: 'daily', url: data.url, token: data.token, expired: false, is_active: true },
    }));
    if (open) window.open(data.url, '_blank');
    if (!silent) {
      setCopyNotice(`${session.students?.name || '학생'} 공개 리포트 링크가 준비되었습니다.`);
      window.setTimeout(() => setCopyNotice(''), 2800);
    }
    return { report, url: data.url, token: data.token };
  }

  async function copyDailyPublicLink(session) {
    try {
      const result = await ensureDailyReportAndShareLink(session, { silent: true });
      await navigator.clipboard.writeText(result.url);
      setCopyNotice(`${session.students?.name || '학생'} 공개 링크 복사 완료`);
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch (error) {
      alert(error.message || '공개 링크 복사에 실패했습니다.');
    }
  }

  async function bulkEnsureDailyShareLinks(targets, title = '리포트 링크 생성') {
    const safeTargets = (targets || []).filter((session) => session && !session.is_virtual);
    if (!safeTargets.length) return alert('링크를 생성할 대상이 없습니다.');
    try {
      setShareLinkWorking(true);
      let success = 0;
      let failed = 0;
      setCopyNotice(`${title} 진행 중...`);
      for (const session of safeTargets) {
        try {
          await ensureDailyReportAndShareLink(session, { silent: true });
          success += 1;
        } catch {
          failed += 1;
        }
      }
      await loadDailyReportTargets(plannerDate);
      setCopyNotice(`${title} 완료 · 성공 ${success}명${failed ? ` / 실패 ${failed}명` : ''}`);
      window.setTimeout(() => setCopyNotice(''), 3500);
    } finally {
      setShareLinkWorking(false);
    }
  }

  function isDirectorReviewWindowEnded(session, schedule = {}) {
    const today = getKstDateString();
    if (plannerDate < today) return true;
    if (plannerDate > today) return false;
    const plannedOut = String(schedule?.planned_check_out || normalizeDefaultScheduleSettings(defaultSchedule).plannedCheckOut || '').slice(0, 5);
    const plannedOutMinute = timeToMinutes(plannedOut);
    const nowMinute = timeToMinutes(getCurrentKstTime());
    if (plannedOutMinute === null || nowMinute === null) return false;
    return nowMinute >= plannedOutMinute;
  }

  function isCheckoutMissingForDirector(session, schedule = {}) {
    if (!session?.check_in_at || session.check_out_at || session.seat_status === 'absent') return false;
    if (session.seat_status === 'out') return false;
    const today = getKstDateString();
    if (plannerDate < today) return true;
    if (plannerDate > today) return false;
    const plannedOut = String(schedule?.planned_check_out || normalizeDefaultScheduleSettings(defaultSchedule).plannedCheckOut || '').slice(0, 5);
    const plannedOutMinute = timeToMinutes(plannedOut);
    const nowMinute = timeToMinutes(getCurrentKstTime());
    if (plannedOutMinute === null || nowMinute === null) return false;
    return nowMinute >= plannedOutMinute + 10;
  }

  function getDirectorCheckSummary(checks = []) {
    if (!checks.length) return ['순찰 체크 기록 없음'];
    return [...checks]
      .sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0))
      .slice(0, 4)
      .map((check) => `${formatKstTime(check.checked_at)} · ${[check.subject, check.study_status].filter(Boolean).join(' / ') || '학습상태 미입력'}${check.study_content ? ` · ${check.study_content}` : ''}`);
  }

  const directorRows = sessionsForReport
    .filter((session) => !session.is_virtual)
    .map((session) => {
      const checks = checksBySessionForReport[session.id] || [];
      const events = eventsBySessionForReport[session.id] || [];
      const schedule = scheduleByStudentId[session.student_id] || {};
      const report = reportsBySessionForReport[session.id] || {};
      const awayEvents = events.filter((event) => event.event_type === 'away');
      const awayMinutes = getTotalAwayMinutes(session, nowTick);
      const pureStudyMinutes = calculateLivePureStudyMinutes(session, nowTick, events, defaultSchedule);
      const nonStudyChecks = checks.filter((check) => {
        const text = [check.study_status, check.subject, check.study_content].filter(Boolean).join(' ');
        return ['수면', '비학습'].includes(check.study_status) || /수면|비학습|휴대폰|유튜브|게임|웹툰|잡담|졸/.test(text);
      });
      const issues = [];
      const dayEnded = isDirectorReviewWindowEnded(session, schedule);
      const missingCheckIn = ['away', 'out'].includes(session.seat_status) && !session.check_in_at;

      if (session.seat_status === 'absent') issues.push({ key: 'absent', label: '결석', type: 'danger' });
      if (missingCheckIn) issues.push({ key: 'missing_checkin', label: '입실시간 누락', type: 'danger' });
      if (isCheckoutMissingForDirector(session, schedule)) issues.push({ key: 'missing_checkout', label: '하원 미처리', type: 'danger' });
      if (session.seat_status === 'away') issues.push({ key: 'currently_away', label: '외출 중', type: 'warning' });
      if (session.check_in_at && dayEnded && pureStudyMinutes < rules.lowStudyMinutes) issues.push({ key: 'low_study', label: '순공시간 부족', type: 'warning' });
      if (awayEvents.length >= rules.excessiveAwayCount || awayMinutes >= rules.excessiveAwayMinutes) issues.push({ key: 'excessive_away', label: '외출 과다', type: 'warning' });
      if (!checks.length && session.seat_status !== 'absent') issues.push({ key: 'no_checks', label: '학습 상태 기록 없음', type: 'warning' });
      if (nonStudyChecks.length >= 2) issues.push({ key: 'non_study_repeat', label: '수면/비학습 반복', type: 'danger' });
      else if (nonStudyChecks.length === 1) issues.push({ key: 'non_study_once', label: '수면/비학습 1회', type: 'warning' });
      if (!report.mentor_comment && session.seat_status !== 'absent') issues.push({ key: 'missing_mentor', label: '코멘트 없음', type: 'neutral' });

      const seen = new Set();
      const uniqueIssues = issues.filter((issue) => {
        if (seen.has(issue.key)) return false;
        seen.add(issue.key);
        return true;
      });

      return {
        id: session.id,
        studentName: session.students?.name || '학생',
        studentInfo: [session.students?.school, session.students?.grade].filter(Boolean).join(' ') || '학교/학년 미입력',
        seatNo: session.seat_no,
        checkIn: formatKstTime(session.check_in_at),
        checkOut: session.check_out_at ? formatKstTime(session.check_out_at) : (session.seat_status === 'away' ? '외출 중' : session.seat_status === 'absent' ? '결석' : '학습중/미처리'),
        pureStudyMinutes,
        awayCount: awayEvents.length,
        awayMinutes,
        checkCount: checks.length,
        nonStudyCount: nonStudyChecks.length,
        mentorComment: report.mentor_comment || '',
        issues: uniqueIssues,
        checkSummary: getDirectorCheckSummary(checks),
      };
    })
    .sort((a, b) => b.issues.length - a.issues.length || Number(a.seatNo || 999) - Number(b.seatNo || 999));

  const directorAttentionRows = directorRows.filter((row) => row.issues.length);
  const directorSummary = directorRows.reduce((acc, row) => {
    acc.total += 1;
    if (row.issues.length) acc.attention += 1;
    if (row.issues.some((issue) => issue.key === 'low_study')) acc.lowStudy += 1;
    if (row.issues.some((issue) => issue.key === 'excessive_away')) acc.excessiveAway += 1;
    if (row.issues.some((issue) => issue.key === 'missing_checkout')) acc.missingCheckout += 1;
    if (row.issues.some((issue) => issue.key === 'no_checks')) acc.noChecks += 1;
    if (row.issues.some((issue) => issue.key === 'non_study_repeat' || issue.key === 'non_study_once')) acc.nonStudy += 1;
    if (row.issues.some((issue) => issue.key === 'missing_mentor')) acc.missingMentor += 1;
    return acc;
  }, { total: 0, attention: 0, lowStudy: 0, excessiveAway: 0, missingCheckout: 0, noChecks: 0, nonStudy: 0, missingMentor: 0 });

  function buildWarningRows(targets) {
    return targets
      .map((session) => {
        const warnings = getWarningIssues(session);
        if (!warnings.length) return null;
        return {
          id: session.id,
          name: session.students?.name || `${session.seat_no}번`,
          warnings: warnings.map((issue) => issue.label),
        };
      })
      .filter(Boolean);
  }

  function buildShareLinkRows(targets) {
    return (targets || []).map((session) => {
      const state = getShareLinkState(session);
      const report = getDailyReportForSession(session);
      const link = getDailyShareLinkForSession(session);
      return {
        id: session.id,
        name: session.students?.name || `${session.seat_no}번`,
        reportId: report?.id || null,
        label: state.label,
        cls: state.cls,
        url: link?.url || '',
      };
    });
  }

  function openSendConfirm(title, targets, mode) {
    if (!targets.length) return alert('발송 대상이 없습니다.');

    const duplicateTargets = targets.filter((session) => ['ready', 'sent'].includes(reportsBySessionForReport[session.id]?.send_status));
    if (duplicateTargets.length) {
      const labels = duplicateTargets.slice(0, 5).map((session) => `${session.students?.name || '학생'}(${getSendStatusLabel(reportsBySessionForReport[session.id]?.send_status)})`).join(', ');
      const ok = confirm(`이미 발송대기 또는 발송완료 상태인 리포트가 ${duplicateTargets.length}건 포함되어 있습니다.\n\n${labels}${duplicateTargets.length > 5 ? ' 외' : ''}\n\n중복 발송 가능성이 있습니다. 계속 진행할까요?`);
      if (!ok) return;
    }

    const warningRows = buildWarningRows(targets);
    const shareLinkRows = buildShareLinkRows(targets);
    const recipientRows = buildStudentRecipientPreviewRows(targets, 'daily', (session) => session.students || {});
    const safety = getReportSendSafetySummary(sendConfig);
    setConfirmSend({
      title,
      mode,
      targets,
      warningRows,
      shareLinkRows,
      shareLinkReadyCount: shareLinkRows.filter((row) => row.cls === 'done').length,
      warningCount: warningRows.length,
      blockedCount: sessionsForReport.filter((session) => getBlockingIssues(session).length).length,
      excludedCount: sessionsForReport.filter((session) => isExcluded(session)).length,
      recipientRows,
      recipientCount: getRecipientPreviewCount(recipientRows),
      safety,
      acknowledged: !safety.requiresAcknowledgement,
      confirmPhrase: '',
    });
  }

  function getBulkSendResultStatus(data) {
    if (!data || data.ok === false) return 'failed';
    const status = String(data.report?.send_status || data.status || data.providerResult?.status || '').toLowerCase();
    if (status === 'failed' || status === 'error') return 'failed';
    if (status === 'ready' || status === 'queued' || status === 'accepted') return 'ready';
    if (status === 'sent' || status === 'received' || status === 'success') return 'sent';
    return 'sent';
  }

  function getBulkSendResultLabel(status) {
    if (status === 'sent') return '발송완료';
    if (status === 'ready') return '발송대기';
    if (status === 'failed') return '발송실패';
    return status || '처리됨';
  }

  async function runBulkSendBatch(targets, title = '데일리 리포트 전체 발송', mode = 'bulk') {
    const safeTargets = (targets || []).filter(Boolean);
    if (!safeTargets.length) return alert('발송 대상이 없습니다.');

    const runId = `${Date.now()}-${mode}`;
    const startedAt = new Date().toISOString();
    setBulkSendRun({
      id: runId,
      title,
      mode,
      status: 'running',
      total: safeTargets.length,
      completed: 0,
      sent: 0,
      ready: 0,
      failed: 0,
      results: [],
      startedAt,
      endedAt: '',
    });

    for (const session of safeTargets) {
      const rowBase = {
        sessionId: session.id,
        studentId: session.student_id,
        name: session.students?.name || `${session.seat_no || '-'}번 학생`,
        seatNo: session.seat_no,
        startedAt: new Date().toISOString(),
      };

      let row;
      try {
        await ensureDailyReportAndShareLink(session, { silent: true });
        const data = await sendReportToParent(session.id);
        const status = getBulkSendResultStatus(data);
        row = {
          ...rowBase,
          status,
          label: getBulkSendResultLabel(status),
          message: data?.message || data?.error || '',
          endedAt: new Date().toISOString(),
        };
      } catch (error) {
        row = {
          ...rowBase,
          status: 'failed',
          label: '발송실패',
          message: error.message || '발송 중 오류가 발생했습니다.',
          endedAt: new Date().toISOString(),
        };
      }

      setBulkSendRun((prev) => {
        if (!prev || prev.id !== runId) return prev;
        const nextResults = [...(prev.results || []), row];
        return {
          ...prev,
          completed: nextResults.length,
          sent: nextResults.filter((item) => item.status === 'sent').length,
          ready: nextResults.filter((item) => item.status === 'ready').length,
          failed: nextResults.filter((item) => item.status === 'failed').length,
          results: nextResults,
        };
      });
    }

    await loadDailyReportTargets(plannerDate);
    await loadDailyReportActivity(plannerDate);
    setBulkSendRun((prev) => prev && prev.id === runId ? { ...prev, status: 'done', endedAt: new Date().toISOString() } : prev);
  }

  async function executeConfirmSend() {
    if (!confirmSend?.targets?.length) return;
    const safety = confirmSend.safety || getReportSendSafetySummary(sendConfig);
    if (safety.requiresAcknowledgement && !confirmSend.acknowledged) {
      alert('발송 전 확인 체크를 완료해야 합니다.');
      return;
    }
    if (safety.requiresTypedConfirmation && String(confirmSend.confirmPhrase || '').trim() !== safety.confirmPhrase) {
      alert(`실전 발송 확인 문구로 "${safety.confirmPhrase}"를 입력해야 합니다.`);
      return;
    }
    const { targets, title, mode } = confirmSend;
    setConfirmSend(null);
    await runBulkSendBatch(targets, title, mode);
  }

  async function retryBulkFailedResults() {
    const failedSessionIds = new Set((bulkSendRun?.results || []).filter((row) => row.status === 'failed').map((row) => String(row.sessionId)));
    const targets = sessionsForReport.filter((session) => failedSessionIds.has(String(session.id)) && !session.is_virtual && canSendBase(session));
    if (!targets.length) return alert('재발송할 실패 대상이 없습니다. 발송 이력 또는 학생 상태를 새로고침해 주세요.');
    const ok = confirm(`실패한 데일리 리포트 ${targets.length}건을 다시 발송할까요?

중복 수신 방지를 위해 실제 수신 결과를 확인한 뒤 진행하세요.`);
    if (!ok) return;
    await runBulkSendBatch(targets, '실패 건 재발송', 'retry_failed');
  }

  async function bulkGenerateAll() {
    if (!sessionsForReport.filter((session) => !session.is_virtual).length) return alert('리포트 생성 대상 학생이 없습니다.');
    if (!confirm(`전체 ${sessionsForReport.length}명의 리포트를 생성할까요?`)) return;
    for (const session of sessionsForReport.filter((item) => !item.is_virtual)) {
      await generateReport(session.id);
    }
    await loadDailyReportTargets(plannerDate);
  }

  function toggleCard(sessionId) {
    setOpenCards((prev) => ({ ...prev, [sessionId]: !prev[sessionId] }));
  }

  async function toggleExclusion(session) {
    if (isExcluded(session)) {
      await updateReportExclusion(session.id, false, '');
      return;
    }

    const reason = prompt(`${session.students?.name || '학생'}을(를) 오늘 발송 제외 처리합니다.\n사유를 입력하세요.`, '발송 제외');
    if (reason === null) return;
    await updateReportExclusion(session.id, true, reason);
  }

  async function copyReportText(session) {
    if (session.is_virtual) return alert('먼저 리포트 대상 포함 버튼으로 세션을 생성하세요.');
    let reportText = reportsBySessionForReport[session.id]?.report_text || '';
    if (!reportText.trim()) {
      reportText = await generateReport(session.id) || '';
      await loadDailyReportTargets(plannerDate);
    }
    if (!reportText.trim()) return alert('복사할 리포트 본문이 없습니다.');
    try {
      await navigator.clipboard.writeText(reportText);
      setCopyNotice(`${session.students?.name || '학생'} 리포트 복사 완료`);
      window.setTimeout(() => setCopyNotice(''), 2500);
    } catch {
      alert('자동 복사에 실패했습니다. 미리보기에서 본문을 직접 복사하세요.');
    }
  }

  async function previewDailyPublicLink(session) {
    try {
      const result = await ensureDailyReportAndShareLink(session, { open: true });
      setCopyNotice(`${session.students?.name || '학생'} 공개 리포트 링크를 새 탭에서 열었습니다.`);
      window.setTimeout(() => setCopyNotice(''), 2800);
      return result;
    } catch (error) {
      alert(error.message || '공개 리포트 링크 미리보기를 열 수 없습니다.');
      return null;
    }
  }


  async function markManualSent(session) {
    if (session.is_virtual) return alert('먼저 리포트 대상 포함 버튼으로 세션을 생성하세요.');
    if (isExcluded(session)) return alert('발송 제외 상태입니다. 먼저 제외를 해제하세요.');
    if (!getActiveGuardians(session.students, 'daily').length) return alert('데일리 리포트 수신 보호자가 없어 발송완료 처리할 수 없습니다.');
    const ok = confirm(`${session.students?.name || '학생'} 리포트를 수동 발송완료로 표시할까요?\n\n카카오톡/문자로 이미 직접 보낸 경우에만 사용하세요.`);
    if (!ok) return;
    await markReportManualSent(session.id);
    await loadDailyReportTargets(plannerDate);
    await loadDailyReportActivity(plannerDate);
  }

  async function sendSingleWithDecision(session) {
    if (session.is_virtual) return alert('먼저 리포트 대상 포함 버튼으로 세션을 생성하세요.');
    if (isExcluded(session)) return alert('발송 제외 상태입니다. 먼저 제외를 해제하세요.');
    if (!getActiveGuardians(session.students, 'daily').length) return alert('데일리 리포트 수신 보호자가 없어 발송할 수 없습니다.');

    const warnings = getWarningIssues(session);
    const title = warnings.length
      ? `${session.students?.name || '학생'} 확인 필요 항목 검토`
      : `${session.students?.name || '학생'} 개별 발송`;
    openSendConfirm(title, [session], 'single');
  }

  function setQuickFilter(status, issue = 'all') {
    setStatusFilter(status);
    setIssueFilter(issue);
  }

  const confirmSafety = confirmSend?.safety || null;
  const confirmRecipientRows = confirmSend?.recipientRows || [];
  async function retryDailyActivityLog(log) {
    const sessionId = log?.payload?.sessionId;
    if (!sessionId) {
      alert('재발송할 데일리 세션 정보를 찾지 못했습니다. 해당 학생 리포트 카드에서 직접 발송해 주세요.');
      return;
    }
    await sendReportToParent(sessionId);
    await loadDailyReportActivity(plannerDate);
  }

  const confirmPreviewLimit = 10;
  const confirmFinalDisabled = Boolean(confirmSend && confirmSafety && (
    (confirmSafety.requiresAcknowledgement && !confirmSend.acknowledged)
    || (confirmSafety.requiresTypedConfirmation && String(confirmSend.confirmPhrase || '').trim() !== confirmSafety.confirmPhrase)
  ));

  return (
    <section className={`content-card report-control-card report-view-${reportView}`}>
      <div className="section-head report-section-head">
        <div>
          <h2>데일리 리포트</h2>
          <p>{plannerDate} 기준 데일리 리포트 대상입니다. 선택 날짜의 활성 학생과 출결 세션을 함께 표시합니다.</p>
        </div>
        <div className="report-head-actions compact-actions">
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={plannerDate} onChange={(e) => { setPlannerDate(e.target.value); loadDailyReportTargets(e.target.value); }} />
        </div>
      </div>

      <div className="report-page-tabs clean-panel">
        <button type="button" className={reportView === 'main' ? 'active' : ''} onClick={() => setReportView('main')}>리포트 대상</button>
        <button type="button" className={reportView === 'director' ? 'active' : ''} onClick={() => setReportView('director')}>원장 내부 확인 <span>{directorSummary.attention}</span></button>
        <button type="button" className={reportView === 'activity' ? 'active' : ''} onClick={() => { setReportView('activity'); loadDailyReportActivity(plannerDate); }}>발송 이력 <span>{reportActivityLogs.length}</span></button>
      </div>

      <ReportSendStatusBanner sendConfig={sendConfig} reportType="daily" />

      <section className="daily-closeout-console clean-panel">
        <div className="daily-closeout-head">
          <div>
            <h3>마감 발송 콘솔</h3>
            <p>정해진 마감시간에 전체 학생 리포트를 발송하기 전, 발송 가능 여부와 확인 필요 항목을 한 번에 점검합니다.</p>
          </div>
        </div>

        <div className="closeout-score-row">
          <div className="closeout-score-card primary-score">
            <span>발송 준비율</span>
            <strong>{closeoutReadyPercent}%</strong>
            <small>{summary.recommended}명 / 전체 {summary.total}명</small>
          </div>
          <button type="button" className="closeout-score-card ready" onClick={() => setQuickFilter('recommended')}>
            <span>발송 가능</span>
            <strong>{summary.recommended}</strong>
            <small>즉시 전체 발송 권장</small>
          </button>
          <button type="button" className="closeout-score-card caution" onClick={() => setQuickFilter('decision')}>
            <span>확인 필요</span>
            <strong>{summary.decision}</strong>
            <small>품질 확인 후 포함 가능</small>
          </button>
          <button type="button" className="closeout-score-card blocked" onClick={() => setQuickFilter('blocked')}>
            <span>발송 불가</span>
            <strong>{summary.blocked}</strong>
            <small>보호자 연락처 등 확인</small>
          </button>
          <button type="button" className="closeout-score-card failed" onClick={() => setQuickFilter('failed')}>
            <span>실패 재발송 후보</span>
            <strong>{failedRetryTargets.length}</strong>
            <small>최근 실패 상태</small>
          </button>
          <div className="closeout-score-card link-score">
            <span>리포트 링크 정상</span>
            <strong>{shareLinkSummary.ready}</strong>
            <small>생성/재생성 필요 {shareLinkSummary.needsLink + shareLinkSummary.needsReport}명</small>
          </div>
        </div>

        <div className="closeout-link-row">
          <div>
            <strong>발송 링크 점검</strong>
            <span>전체 발송 전 학부모 공개 리포트 링크를 미리 생성·재생성할 수 있습니다.</span>
          </div>
          <div>
            <button className="secondary" onClick={() => loadDailyShareLinkStatuses(targetReports)} disabled={shareLinkWorking}>링크 상태 새로고침</button>
            <button className="secondary" onClick={() => bulkEnsureDailyShareLinks(recommendedTargets, '발송 가능 학생 링크 생성')} disabled={shareLinkWorking || !recommendedTargets.length}>발송 가능 링크 생성</button>
            <button className="primary" onClick={() => bulkEnsureDailyShareLinks(decisionTargets, '전체 발송 대상 링크 생성')} disabled={shareLinkWorking || !decisionTargets.length}>{shareLinkWorking ? '링크 처리 중...' : '전체 발송 대상 링크 생성'}</button>
          </div>
        </div>

        <div className="closeout-action-row">
          <button className="secondary" onClick={() => setQuickFilter('recommended')}>발송 가능 학생만 보기</button>
          <button className="secondary" onClick={() => setQuickFilter('decision')}>확인 필요 학생 보기</button>
          <button className="secondary" onClick={() => setQuickFilter('blocked')}>발송 불가 학생 보기</button>
          <button className="secondary" onClick={() => openSendConfirm('실패 건 재발송', failedRetryTargets, 'retry_failed')} disabled={!failedRetryTargets.length}>실패 건만 재발송</button>
          <button className="secondary" onClick={() => openSendConfirm('발송 가능 대상 전체 발송', recommendedTargets, 'recommended')}>발송 가능 전체 발송</button>
          <button className="primary" onClick={() => openSendConfirm('확인 필요 포함 전체 발송', decisionTargets, 'decision')}>확인 필요 포함 전체 발송</button>
        </div>

        <div className="closeout-check-grid">
          <div className="closeout-check-card">
            <strong>발송 전 점검 항목</strong>
            <div className="closeout-issue-list">
              {closeoutIssueSummary.length ? closeoutIssueSummary.slice(0, 8).map((issue) => (
                <button key={issue.key} type="button" className={`closeout-issue-chip ${issue.type === 'danger' || issue.key === 'missing_parent_phone' ? 'danger' : 'warning'}`} onClick={() => setQuickFilter('all', issue.key)}>
                  <span>{issue.label}</span>
                  <b>{issue.count}</b>
                </button>
              )) : <span className="all-clear inline-clear">확인 필요 항목 없음</span>}
            </div>
          </div>
          <div className="closeout-check-card muted">
            <strong>마감 발송 권장 흐름</strong>
            <ol>
              <li>확인 필요 학생의 리포트 미리보기와 코멘트를 먼저 점검</li>
              <li>테스트모드 ON/OFF 상태를 확인</li>
              <li>마감시간에 발송 가능 전체 또는 확인 필요 포함 전체 발송</li>
              <li>결과 요약에서 실패 학생만 재발송</li>
            </ol>
          </div>
        </div>

        {bulkSendRun ? (
          <div className={`bulk-send-progress-card ${bulkSendRun.status}`}>
            <div className="bulk-send-progress-head">
              <div>
                <strong>{bulkSendRun.title}</strong>
                <span>{bulkSendRun.status === 'running' ? '발송 진행 중입니다. 화면을 닫지 말고 완료 결과를 확인하세요.' : '마감 발송 결과가 정리되었습니다.'}</span>
              </div>
              <button className="secondary" onClick={() => setBulkSendRun(null)} disabled={bulkSendRun.status === 'running'}>{bulkSendRun.status === 'running' ? '진행 중' : '결과 닫기'}</button>
            </div>
            <div className="bulk-progress-bar"><span style={{ width: `${bulkSendRun.total ? Math.round((bulkSendRun.completed / bulkSendRun.total) * 100) : 0}%` }} /></div>
            <div className="bulk-send-summary">
              <div><strong>{bulkSendRun.completed}</strong><span>처리 / {bulkSendRun.total}</span></div>
              <div><strong>{bulkSendRun.sent}</strong><span>발송완료</span></div>
              <div><strong>{bulkSendRun.ready}</strong><span>발송대기</span></div>
              <div><strong>{bulkSendRun.failed}</strong><span>발송실패</span></div>
            </div>
            {bulkSendRun.results?.length ? (
              <div className="bulk-result-list">
                {bulkSendRun.results.slice(-12).map((row) => (
                  <div key={`${bulkSendRun.id}-${row.sessionId}`} className={`bulk-result-row ${row.status}`}>
                    <b>{String(row.seatNo || '-').padStart(2, '0')} · {row.name}</b>
                    <span>{row.label}</span>
                    <small>{row.message || formatKstTimeWithSeconds(row.endedAt)}</small>
                  </div>
                ))}
              </div>
            ) : null}
            {bulkSendRun.status === 'done' && bulkSendRun.failed > 0 ? (
              <div className="bulk-retry-bar">
                <span>실패 학생만 다시 발송할 수 있습니다. 중복 수신 가능성을 확인한 뒤 실행하세요.</span>
                <button className="secondary" onClick={retryBulkFailedResults}>실패 건 재발송</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <ReportActivityPanel
        title="데일리 리포트 발송 이력"
        logs={reportActivityLogs}
        loading={activityLoading}
        onRefresh={() => loadDailyReportActivity(plannerDate)}
        onRetry={retryDailyActivityLog}
        reportType="daily"
      />

      <div className="director-daily-panel clean-panel">
        <div className="director-report-head">
          <div>
            <h3>원장 내부 확인용 리포트</h3>
            <p>{plannerDate} 기준 관리 확인이 필요한 학생만 모아봅니다. 이 화면은 Beyond OS 내부 점검용이며 학부모에게 발송되지 않습니다.</p>
          </div>
          <span className="status-pill neutral">내부 확인용</span>
        </div>
        <div className="director-summary-grid">
          <div><strong>{directorSummary.total}</strong><span>전체 세션</span></div>
          <div><strong>{directorSummary.attention}</strong><span>확인 필요</span></div>
          <div><strong>{directorSummary.lowStudy}</strong><span>순공부족</span></div>
          <div><strong>{directorSummary.excessiveAway}</strong><span>외출과다</span></div>
          <div><strong>{directorSummary.missingCheckout}</strong><span>하원 미처리</span></div>
          <div><strong>{directorSummary.noChecks}</strong><span>학습기록 없음</span></div>
          <div><strong>{directorSummary.nonStudy}</strong><span>수면/비학습</span></div>
          <div><strong>{directorSummary.missingMentor}</strong><span>코멘트 없음</span></div>
        </div>
        {directorAttentionRows.length ? (
          <div className="director-report-list">
            {directorAttentionRows.map((row) => (
              <details key={row.id} className="director-report-row">
                <summary>
                  <div className="director-student-title">
                    <b>{String(row.seatNo || '-').padStart(2, '0')} · {row.studentName}</b>
                    <span>{row.studentInfo}</span>
                  </div>
                  <div className="director-issue-chips">
                    {row.issues.map((issue) => <span key={issue.key} className={`issue-chip ${issue.type === 'danger' ? 'blocker' : 'warning'}`}>{issue.label}</span>)}
                  </div>
                  <div className="director-row-metrics">
                    <span>순공 {formatMinutes(row.pureStudyMinutes)}</span>
                    <span>외출 {row.awayCount}회/{formatMinutes(row.awayMinutes)}</span>
                    <span>순찰 {row.checkCount}회</span>
                  </div>
                </summary>
                <div className="director-row-detail">
                  <div className="director-detail-grid">
                    <div><span>입실/하원</span><strong>{row.checkIn} / {row.checkOut}</strong></div>
                    <div><span>수면/비학습</span><strong>{row.nonStudyCount}회</strong></div>
                    <div><span>멘토 코멘트</span><strong>{row.mentorComment ? '작성됨' : '미작성'}</strong></div>
                  </div>
                  <div className="director-check-summary">
                    <strong>최근 순찰/학습 상태</strong>
                    {row.checkSummary.map((item, index) => <span key={`${row.id}-check-${index}`}>{item}</span>)}
                  </div>
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="all-clear director-all-clear">현재 기준으로 원장 확인이 필요한 학생이 없습니다.</div>
        )}
      </div>

      <div className="report-dashboard-strip">
        <button type="button" className="mini-stat" onClick={() => setQuickFilter('all')}>
          <strong>{summary.total}</strong><span>전체</span>
        </button>
        <button type="button" className="mini-stat green" onClick={() => setQuickFilter('recommended')}>
          <strong>{summary.recommended}</strong><span>발송 가능</span>
        </button>
        <button type="button" className="mini-stat gold" onClick={() => setQuickFilter('decision')}>
          <strong>{summary.decision}</strong><span>확인 필요</span>
        </button>
        <button type="button" className="mini-stat muted-stat" onClick={() => setQuickFilter('no_session')}>
          <strong>{summary.no_session}</strong><span>입실 기록 없음</span>
        </button>
        <button type="button" className="mini-stat red" onClick={() => setQuickFilter('blocked')}>
          <strong>{summary.blocked}</strong><span>발송 불가</span>
        </button>
        <button type="button" className="mini-stat muted-stat" onClick={() => setQuickFilter('excluded')}>
          <strong>{summary.excluded}</strong><span>발송 제외</span>
        </button>
        <button type="button" className="mini-stat" onClick={() => setQuickFilter('sent')}>
          <strong>{summary.sent}</strong><span>발송 완료</span>
        </button>
      </div>

      <div className="report-filter-panel clean-panel">
        <div className="report-filter-bar compact-filter">
          <label>
            처리 기준
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {REPORT_FILTER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            확인 항목
            <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value)}>
              {REPORT_ISSUE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <div className="filter-help">
            <strong>{targetLoading ? '대상 조회 중...' : `${filteredSessions.length}명 표시 중`}</strong>
            <span>세션 없음은 입실 전 상태입니다. 필요한 학생은 오늘 리포트 대상 만들기를 먼저 눌러주세요.</span>
          </div>
        </div>

        <div className="quick-issue-buttons compact-chip-buttons">
          <button onClick={() => setQuickFilter('recommended')}>발송 가능</button>
          <button onClick={() => setQuickFilter('decision')}>확인 필요</button>
          <button onClick={() => setQuickFilter('no_session')}>입실 기록 없음</button>
          <button onClick={() => setQuickFilter('all', 'missing_checkin')}>입실시간 누락</button>
          <button onClick={() => setQuickFilter('excluded')}>발송 제외</button>
          <button onClick={() => setQuickFilter('all', 'missing_planner')}>플래너 미제출</button>
          <button onClick={() => setQuickFilter('all', 'missing_mentor')}>오늘 코멘트 미입력</button>
          <button onClick={() => setQuickFilter('all', 'no_checks')}>순찰 없음</button>
          <button onClick={() => setQuickFilter('all', 'attendance_absent')}>결석</button>
          <button onClick={() => setQuickFilter('all', 'attendance_low_study')}>순공부족</button>
          <button onClick={() => setQuickFilter('all', 'attendance_excessive_away')}>외출과다</button>
          <button onClick={() => setQuickFilter('all', 'attendance_late')}>지각</button>
        </div>
      </div>

      <div className="report-card-list">
        {filteredSessions.map((session) => {
          const report = reportsBySessionForReport[session.id];
          const blockers = getBlockingIssues(session);
          const warnings = getWarningIssues(session);
          const excluded = isExcluded(session);
          const canSend = canSendBase(session);
          const isOpen = Boolean(openCards[session.id]);
          const shareLinkState = getShareLinkState(session);
          const shareLink = getDailyShareLinkForSession(session);
          return (
            <article key={session.id} className={`report-student-card ${getDecisionStatus(session)} ${isOpen ? 'expanded' : ''}`}>
              <div className="report-card-head">
                <div>
                  <div className="seat-name">
                    <span>{String(session.seat_no).padStart(2, '0')}</span>
                    <strong>{session.students?.name}</strong>
                  </div>
                  <p>{[session.students?.school, session.students?.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</p>
                </div>
                <span className={`status-pill ${getDecisionClass(session)}`}>{getDecisionLabel(session)}</span>
              </div>

              {(blockers.length || warnings.length || excluded || session.is_virtual || ['ready', 'sent', 'failed'].includes(report?.send_status)) ? (
                <div className="report-card-statuses compact-statuses unified-report-chips">
                  {['ready', 'sent', 'failed'].includes(report?.send_status) ? (
                    <span className={`status-pill ${getSendStatusClass(report?.send_status)}`}>{getSendStatusLabel(report?.send_status)}</span>
                  ) : null}
                  {excluded ? <span className="issue-chip excluded">오늘 발송 제외: {exclusionsBySession[session.id]?.reason || '사유 없음'}</span> : null}
                  {session.is_virtual ? <span className="issue-chip blocker">오늘 리포트 대상 미생성</span> : null}
                  {blockers.map((issue) => <span key={issue.key} className="issue-chip blocker">{issue.label}</span>)}
                  {warnings.slice(0, isOpen ? warnings.length : 3).map((issue) => <span key={issue.key} className="issue-chip warning">{issue.label}</span>)}
                  {!isOpen && warnings.length > 3 ? <span className="issue-chip">+{warnings.length - 3}</span> : null}
                </div>
              ) : <div className="all-clear compact-all-clear">발송 준비 완료</div>}

              {!session.is_virtual ? (
                <div className={`report-link-status-row ${shareLinkState.cls}`}>
                  <span>리포트 링크</span>
                  <strong>{shareLinkState.label}</strong>
                  {shareLink?.url ? <button className="text-button" onClick={() => window.open(shareLink.url, '_blank')}>새 창 열기</button> : null}
                  {shareLink?.url ? <button className="text-button" onClick={() => copyDailyPublicLink(session)}>링크 복사</button> : null}
                </div>
              ) : null}

              {isOpen ? (
                <div className="report-card-details-wrap">
                  <div className="report-card-details">
                    <div><span>입실/퇴실</span><strong>{formatKstTime(session.check_in_at)} / {session.check_out_at ? formatKstTime(session.check_out_at) : '학습중'}</strong></div>
                    <div><span>순공시간</span><strong>{formatMinutes(calculateLivePureStudyMinutes(session, nowTick, eventsBySession[session.id] || [], defaultSchedule))}</strong></div>
                    <div><span>외출</span><strong>{getAwaySummary(session)}</strong></div>
                    <div><span>순찰</span><strong>{(checksBySessionForReport[session.id] || []).length}회</strong></div>
                    <div><span>발송 대상 보호자</span><strong>{getGuardianDisplayText(session.students, 'daily')}</strong></div>
                  </div>
                  <div className="report-auto-generate-note">
                    리포트 본문은 미리보기 또는 발송 버튼을 누를 때 최신 정보 기준으로 자동 생성됩니다.
                  </div>
                  <div className="manual-send-helper">
                    <span>직접 발송한 경우에만 사용</span>
                    <button className="secondary" onClick={() => markManualSent(session)} disabled={!canSend}>수동 발송완료 처리</button>
                  </div>
                </div>
              ) : null}

              <div className="report-card-actions send-focused-actions">
                {session.is_virtual ? (
                  <button className="primary send-button create-session-button" onClick={() => ensureDailyReportSession(session)}>오늘 리포트 대상 만들기</button>
                ) : (
                  <>
                    <button onClick={() => openSendPreview(session.id)} disabled={excluded}>미리보기</button>
                    <button className="secondary link-preview-button" onClick={() => previewDailyPublicLink(session)} disabled={excluded}>링크 미리보기</button>
                    <button className="secondary" onClick={() => copyDailyPublicLink(session)} disabled={excluded}>링크 복사</button>
                    <button className="secondary exclude-button" onClick={() => toggleExclusion(session)}>{excluded ? '제외 해제' : '발송 제외'}</button>
                    <button className="secondary detail-button" onClick={() => toggleCard(session.id)}>{isOpen ? '접기' : '상세 보기'}</button>
                    <button className="primary send-button" onClick={() => sendSingleWithDecision(session)} disabled={!canSend}>발송하기</button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {filteredSessions.length === 0 ? (
        <div className="empty-student-list">
          <strong>현재 조건에 해당하는 리포트 대상이 없습니다.</strong>
          <span>필터를 전체로 변경하거나 선택 날짜의 학생/시간표/세션 상태를 확인하세요.</span>
        </div>
      ) : null}

      {confirmSend ? (
        <div className="modal-backdrop" onClick={() => setConfirmSend(null)}>
          <div className="send-preview-modal compact-send-modal" onClick={(event) => event.stopPropagation()}>
            <div className="popup-head">
              <div>
                <h2>{confirmSend.title}</h2>
                <p>{confirmSend.mode === 'single' ? '개별 발송 전 최종 확인입니다.' : '전체 발송 전 대상과 제외/불가 인원을 확인하세요.'}</p>
              </div>
              <button onClick={() => setConfirmSend(null)}>닫기</button>
            </div>

            <div className={`send-live-safety-card ${confirmSafety?.className || 'safe'}`}>
              <div>
                <strong>{confirmSafety?.title || '발송 상태 확인'}</strong>
                <span>{confirmSafety?.description || '발송 전 현재 제공자/수신번호 제한 상태를 확인하세요.'}</span>
              </div>
              <em>{confirmSafety?.badge || '확인 필요'}</em>
            </div>

            <div className="send-confirm-summary-grid v40-95-summary">
              <div><strong>{confirmSend.targets.length}</strong><span>발송 대상 학생</span></div>
              <div><strong>{confirmSend.recipientCount || 0}</strong><span>예상 수신 보호자</span></div>
              <div><strong>{confirmSend.warningCount || 0}</strong><span>확인 필요</span></div>
              <div><strong>{confirmSend.excludedCount}</strong><span>발송 제외</span></div>
              <div><strong>{confirmSend.blockedCount}</strong><span>발송 불가</span></div>
              <div><strong>{confirmSend.shareLinkReadyCount || 0}</strong><span>링크 정상</span></div>
            </div>

            {confirmSend.shareLinkRows?.length ? (
              <div className="send-recipient-preview-box share-link-confirm-box">
                <strong>리포트 링크 상태</strong>
                <p>링크가 없거나 만료된 학생은 발송 직전에 자동 생성/재생성 후 발송합니다.</p>
                <div className="recipient-preview-list">
                  {confirmSend.shareLinkRows.slice(0, confirmPreviewLimit).map((row) => (
                    <div key={row.id}>
                      <b>{row.name}</b>
                      <span>{row.label}{row.url ? ' · 공개 링크 준비됨' : ''}</span>
                    </div>
                  ))}
                  {confirmSend.shareLinkRows.length > confirmPreviewLimit ? <div>외 {confirmSend.shareLinkRows.length - confirmPreviewLimit}명</div> : null}
                </div>
              </div>
            ) : null}

            <RecipientPolicyProjectionCard projection={getRecipientPolicyProjection(sendConfig, confirmSend.recipientCount || 0)} />

            <div className="send-recipient-preview-box">
              <strong>발송 대상 보호자 확인</strong>
              <p>개인정보 보호를 위해 전화번호는 일부만 표시됩니다. 실제 수신자는 보호자 수신 설정과 테스트/Allowlist 정책에 따라 결정됩니다.</p>
              <div className="recipient-preview-list">
                {confirmRecipientRows.slice(0, confirmPreviewLimit).map((row) => (
                  <div key={row.id}>
                    <b>{row.name}</b>
                    <span>{row.recipients.length ? row.recipients.join(' / ') : '수신 보호자 없음'}</span>
                  </div>
                ))}
                {confirmRecipientRows.length > confirmPreviewLimit ? <div>외 {confirmRecipientRows.length - confirmPreviewLimit}명</div> : null}
              </div>
            </div>

            {confirmSend.warningRows.length ? (
              <div className="send-warning-box">
                <strong>확인 필요 항목이 있습니다</strong>
                <p>{confirmSend.mode === 'single' ? '이 학생은 아래 항목을 확인한 뒤 발송하는 것이 좋습니다.' : '아래 학생은 플래너/오늘 코멘트/순찰 등 일부 항목 확인이 필요합니다.'}</p>
                <div className="warning-list">
                  {confirmSend.warningRows.slice(0, 12).map((row) => (
                    <div key={row.id}><b>{row.name}</b><span>{row.warnings.join(', ')}</span></div>
                  ))}
                  {confirmSend.warningRows.length > 12 ? <div>외 {confirmSend.warningRows.length - 12}명</div> : null}
                </div>
              </div>
            ) : (
              <div className="all-clear">보완/누락 경고 없이 발송 가능한 대상입니다.</div>
            )}

            {confirmSafety?.requiresAcknowledgement ? (
              <div className="send-acknowledgement-box">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(confirmSend.acknowledged)}
                    onChange={(event) => setConfirmSend((prev) => prev ? { ...prev, acknowledged: event.target.checked } : prev)}
                  />
                  <span>{confirmSafety.level === 'live-unrestricted' ? '테스트 모드/Allowlist 없이 실제 보호자에게 발송되는 것을 확인했습니다.' : '현재 발송 제한/테스트 정책을 확인했습니다.'}</span>
                </label>
                {confirmSafety.requiresTypedConfirmation ? (
                  <div className="field confirm-phrase-field">
                    <label>실전 발송 확인 문구</label>
                    <input
                      value={confirmSend.confirmPhrase || ''}
                      onChange={(event) => setConfirmSend((prev) => prev ? { ...prev, confirmPhrase: event.target.value } : prev)}
                      placeholder={`${confirmSafety.confirmPhrase} 입력`}
                    />
                    <small>전체 실전 발송 모드에서는 오발송 방지를 위해 <b>{confirmSafety.confirmPhrase}</b> 입력이 필요합니다.</small>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="popup-bottom-actions">
              <button className="secondary" onClick={() => setConfirmSend(null)}>취소</button>
              <button className="primary send-final-button" onClick={executeConfirmSend} disabled={confirmFinalDisabled}>{confirmFinalDisabled ? '확인 필요' : confirmSend.warningRows.length ? "확인 후 발송" : "바로 발송"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}


function WeeklyReportsTab({ students, apiFetch, operatingRules, setMessage, sendConfig, onActionNotice, currentUser }) {
  const initialRange = getFullWeekRange();
  const [studentId, setStudentId] = useState('');
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [rows, setRows] = useState([]);
  const [weeklyPoints, setWeeklyPoints] = useState([]);
  const [weeklyReports, setWeeklyReports] = useState([]);
  const [lastSavedReport, setLastSavedReport] = useState(null);
  const [saveState, setSaveState] = useState('new');
  const [aiSourceMessage, setAiSourceMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [directorInterview, setDirectorInterview] = useState('');
  const [aiWeeklyComment, setAiWeeklyComment] = useState('');
  const [finalWeeklyComment, setFinalWeeklyComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [interviewAiLoading, setInterviewAiLoading] = useState(false);
  const [interviewAiMessage, setInterviewAiMessage] = useState('');
  const [interviewAiComparison, setInterviewAiComparison] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [weeklySendLoading, setWeeklySendLoading] = useState(false);
  const [weeklySendNotice, setWeeklySendNotice] = useState(null);
  const [weeklySendConfirm, setWeeklySendConfirm] = useState(null);
  const [weeklyView, setWeeklyView] = useState('main');
  const [weeklyActivityLogs, setWeeklyActivityLogs] = useState([]);
  const [weeklyActivityLoading, setWeeklyActivityLoading] = useState(false);
  const [weeklyBulkLoading, setWeeklyBulkLoading] = useState(false);
  const [weeklyBulkNotice, setWeeklyBulkNotice] = useState(null);
  const [weeklyBulkResult, setWeeklyBulkResult] = useState(null);
  const [historyStart, setHistoryStart] = useState(initialRange.start);
  const [historyEnd, setHistoryEnd] = useState(initialRange.end);
  const [historyStudentFilter, setHistoryStudentFilter] = useState('all');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [weeklyHistoryReports, setWeeklyHistoryReports] = useState([]);
  const [weeklyHistoryLoading, setWeeklyHistoryLoading] = useState(false);
  const [weeklyHistoryNotice, setWeeklyHistoryNotice] = useState('이번 주를 기본 기간으로 조회합니다. 상단의 기간 검색에서 과거 주간을 선택할 수 있습니다.');
  const [weeklyRangePickerOpen, setWeeklyRangePickerOpen] = useState(false);
  const [weeklyRangePickerDate, setWeeklyRangePickerDate] = useState(initialRange.start);
  const rules = normalizeOperatingRules(operatingRules);
  const activeStudents = (students || []).filter((student) => student.status !== 'inactive');
  const selectedStudent = activeStudents.find((student) => String(student.id) === String(studentId));
  const studentLookup = useMemo(() => {
    const map = {};
    for (const student of students || []) map[student.id] = student;
    return map;
  }, [students]);

  const weeklyRangePickerSelectedRange = useMemo(() => getFullWeekRange(weeklyRangePickerDate || start || getKstDateString()), [weeklyRangePickerDate, start]);
  const weeklyRangePickerOptions = useMemo(() => buildWeeklyRangePickerOptions(weeklyRangePickerDate || start || getKstDateString()), [weeklyRangePickerDate, start]);

  const reportsByStudentId = useMemo(() => {
    const map = {};
    for (const report of weeklyReports || []) map[report.student_id] = report;
    return map;
  }, [weeklyReports]);

  const progress = useMemo(() => {
    const total = activeStudents.length;
    let saved = 0;
    let inProgress = 0;
    let interviewMissing = 0;
    let aiDraft = 0;
    let sendReady = 0;
    let sendSent = 0;
    let sendFailed = 0;
    for (const student of activeStudents) {
      const report = reportsByStudentId[student.id];
      if (report?.report_text) saved += 1;
      else if (report) inProgress += 1;
      if (!report?.director_interview) interviewMissing += 1;
      if (report?.ai_weekly_comment) aiDraft += 1;
      if (report?.send_status === 'ready') sendReady += 1;
      if (report?.send_status === 'sent') sendSent += 1;
      if (report?.send_status === 'failed') sendFailed += 1;
    }
    return {
      total,
      saved,
      inProgress,
      notStarted: Math.max(0, total - saved - inProgress),
      interviewMissing,
      aiDraft,
      sendReady,
      sendSent,
      sendFailed,
    };
  }, [activeStudents, reportsByStudentId]);

  const weeklyHistoryFilteredReports = useMemo(() => {
    const keyword = String(historySearch || '').trim().toLowerCase();
    return (weeklyHistoryReports || []).filter((report) => {
      const student = report.student || studentLookup[report.student_id] || {};
      const studentText = [student.name, student.school, student.grade, report.student_id].filter(Boolean).join(' ').toLowerCase();
      if (historyStudentFilter !== 'all' && String(report.student_id) !== String(historyStudentFilter)) return false;
      if (keyword && !studentText.includes(keyword) && !String(report.report_text || '').toLowerCase().includes(keyword)) return false;
      if (historyStatusFilter === 'saved' && !report.report_text) return false;
      if (historyStatusFilter === 'sent' && report.send_status !== 'sent') return false;
      if (historyStatusFilter === 'failed' && report.send_status !== 'failed') return false;
      if (historyStatusFilter === 'ready' && report.send_status !== 'ready') return false;
      if (historyStatusFilter === 'draft' && report.report_text) return false;
      return true;
    });
  }, [weeklyHistoryReports, historyStudentFilter, historyStatusFilter, historySearch, studentLookup]);

  const weeklyHistorySummary = useMemo(() => {
    const rows = weeklyHistoryReports || [];
    return {
      total: rows.length,
      saved: rows.filter((report) => report.report_text).length,
      sent: rows.filter((report) => report.send_status === 'sent').length,
      failed: rows.filter((report) => report.send_status === 'failed').length,
      ready: rows.filter((report) => report.send_status === 'ready').length,
    };
  }, [weeklyHistoryReports]);

  const weeklyStats = useMemo(() => {
    const safeRows = rows || [];
    const totalStudy = safeRows.reduce((sum, row) => sum + Number(row.pureStudyMinutes || 0), 0);
    const attendanceDays = safeRows.filter((row) => row.checkInAt).length;
    const totalAwayCount = safeRows.reduce((sum, row) => sum + Number(row.awayCount || 0), 0);
    const totalAwayMinutes = safeRows.reduce((sum, row) => sum + Number(row.awayMinutes || 0), 0);
    const averageStudy = attendanceDays ? Math.round(totalStudy / attendanceDays) : 0;
    const averageCheckIn = averageClock(safeRows, 'checkInTime');
    const averageCheckOut = averageClock(safeRows, 'checkOutTime');
    const issueCounts = { 결석: 0, 지각: 0, 조퇴: 0, 외출과다: 0, 순공부족: 0, 미등원: 0 };
    const issueReasons = { 결석: {}, 지각: {}, 조퇴: {} };
    const detailRows = safeRows.map((row) => {
      const flags = filterParentReportFlags(getAttendanceFlags(row, rules));
      for (const flag of flags) {
        if (Object.prototype.hasOwnProperty.call(issueCounts, flag.label)) issueCounts[flag.label] += 1;
        const reason = cleanAttendanceReason(flag.reason || '', flag.label);
        if (reason && issueReasons[flag.label]) issueReasons[flag.label][reason] = Number(issueReasons[flag.label][reason] || 0) + 1;
      }
      return { ...row, flags };
    });

    return {
      totalStudy,
      attendanceDays,
      totalAwayCount,
      totalAwayMinutes,
      averageStudy,
      averageCheckIn,
      averageCheckOut,
      issueCounts,
      issueReasons,
      issueSummary: formatIssueSummary(issueCounts, issueReasons),
      detailRows,
    };
  }, [rows, rules]);

  const weeklyPointSummary = useMemo(() => {
    const rows = weeklyPoints || [];
    const reward = rows.filter((row) => row.point_type === 'reward').reduce((sum, row) => sum + Number(row.points || 0), 0);
    const penalty = rows.filter((row) => row.point_type === 'penalty').reduce((sum, row) => sum + Number(row.points || 0), 0);
    const net = reward - penalty;
    const recent = rows.slice(0, 5).map((row) => `${row.point_type === 'reward' ? '상점' : '벌점'} ${row.points}점 · ${row.reason || '-'}`);
    return {
      reward,
      penalty,
      net,
      count: rows.length,
      recent,
      label: rows.length ? `상점 ${reward}점 / 벌점 ${penalty}점 / 순점수 ${net > 0 ? '+' : ''}${net}점` : '상벌점 기록 없음',
    };
  }, [weeklyPoints]);

  const reportText = useMemo(() => {
    if (!selectedStudent) return '';
    const comment = String(finalWeeklyComment || aiWeeklyComment || '').trim() || '이번 주 학습 흐름을 바탕으로 다음 주 관리 방향을 지속적으로 점검하겠습니다.';
    const interview = String(directorInterview || '').trim() || '이번 주 주간면담 내용이 아직 입력되지 않았습니다.';

    return `[비욘드 주간 리포트]\n\n학생: ${selectedStudent.name}\n기간: ${start} ~ ${end}\n\n이번 주 학습 요약\n- 등원일수: ${weeklyStats.attendanceDays}일\n- 총 순공시간: ${formatMinutes(weeklyStats.totalStudy)}\n- 일평균 순공시간: ${formatMinutes(weeklyStats.averageStudy)}\n- 외출: ${weeklyStats.totalAwayCount}회 / 총 ${formatMinutes(weeklyStats.totalAwayMinutes)}\n- 주요 확인사항: ${weeklyStats.issueSummary}\n- 상벌점: ${weeklyPointSummary.label}\n\n주간면담 내용\n${interview}\n\n주간 총평\n${comment}\n\n목동유쌤영어학원`;
  }, [selectedStudent, start, end, weeklyStats, weeklyPointSummary, finalWeeklyComment, aiWeeklyComment, directorInterview]);

  useEffect(() => {
    loadWeeklyStatus(start, end);
    loadWeeklyActivity(start, end);
  }, [start, end]);

  function formatSavedAt(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value));
    } catch {
      return '';
    }
  }

  function getSaveStateLabel() {
    if (saveState === 'saved') return '저장 완료';
    if (saveState === 'dirty') return '수정 후 미저장';
    return '저장 전';
  }

  function getSaveStateClass() {
    if (saveState === 'saved') return 'done';
    if (saveState === 'dirty') return 'neutral';
    return 'pending';
  }

  function markDirty() {
    setSaveState((prev) => (prev === 'saved' ? 'dirty' : prev));
  }

  function setReportFields(report) {
    setLastSavedReport(report || null);
    setDirectorInterview(report?.director_interview || '');
    setAiWeeklyComment(report?.ai_weekly_comment || '');
    setFinalWeeklyComment(report?.final_weekly_comment || '');
    setAiSourceMessage(report?.ai_weekly_comment ? '저장된 AI 초안을 불러왔습니다.' : '');
    setInterviewAiMessage('');
    setInterviewAiComparison(null);
    setSaveState(report?.report_text ? 'saved' : 'new');
  }

  async function loadWeeklyStatus(nextStart = start, nextEnd = end) {
    try {
      setStatusLoading(true);
      const params = new URLSearchParams({ start: nextStart, end: nextEnd });
      const data = await apiFetch(`/api/weekly-report?${params.toString()}`);
      setWeeklyReports(data.reports || []);
    } catch {
      setWeeklyReports([]);
    } finally {
      setStatusLoading(false);
    }
  }

  function applyWeeklyRangeSelection(range, options = {}) {
    if (!range?.start || !range?.end) return;
    setStart(range.start);
    setEnd(range.end);
    setHistoryStart(range.start);
    setHistoryEnd(range.end);
    setWeeklyRangePickerDate(range.start);
    loadWeeklyStatus(range.start, range.end);
    loadWeeklyHistory(range.start, range.end);
    if (studentId) loadWeeklyData(studentId, range.start, range.end);
    if (weeklyView === 'activity') loadWeeklyActivity(range.start, range.end);
    if (options.closePicker) setWeeklyRangePickerOpen(false);
  }

  function setPreset(type) {
    const range = type === 'previous' ? getPreviousFullWeekRange() : getFullWeekRange();
    applyWeeklyRangeSelection(range, { closePicker: true });
  }

  function getWeeklyHistoryPresetRange(type) {
    const current = getFullWeekRange();
    if (type === 'current') return current;
    if (type === 'previous') return getPreviousFullWeekRange();
    if (type === 'recent4') return { start: addDays(current.start, -21), end: current.end };
    if (type === 'recent8') return { start: addDays(current.start, -49), end: current.end };
    if (type === 'month') {
      const today = getKstDateString();
      const monthStart = `${today.slice(0, 7)}-01`;
      return { start: monthStart, end: today };
    }
    return { start: historyStart, end: historyEnd };
  }

  async function loadWeeklyHistory(nextStart = historyStart, nextEnd = historyEnd) {
    if (!nextStart || !nextEnd) return alert('조회할 시작일과 종료일을 입력하세요.');
    if (nextStart > nextEnd) return alert('시작일은 종료일보다 늦을 수 없습니다.');
    try {
      setWeeklyHistoryLoading(true);
      setWeeklyHistoryNotice('과거 위클리 리포트 조회 중...');
      const params = new URLSearchParams({ mode: 'history', start: nextStart, end: nextEnd });
      const data = await apiFetch(`/api/weekly-report?${params.toString()}`);
      const reports = data.reports || [];
      setWeeklyHistoryReports(reports);
      setWeeklyHistoryNotice(`${nextStart} ~ ${nextEnd} 기간에서 저장된 위클리 리포트 ${reports.length}건을 조회했습니다.`);
    } catch (error) {
      setWeeklyHistoryReports([]);
      setWeeklyHistoryNotice(error.message || '과거 위클리 리포트 조회 중 오류가 발생했습니다.');
    } finally {
      setWeeklyHistoryLoading(false);
    }
  }

  function applyWeeklyHistoryPreset(type) {
    const range = getWeeklyHistoryPresetRange(type);
    applyWeeklyRangeSelection(range, { closePicker: true });
  }

  function openWeeklyHistoryReport(report) {
    if (!report?.student_id || !report?.start_date || !report?.end_date) return;
    setWeeklyView('main');
    setStudentId(report.student_id);
    setStart(report.start_date);
    setEnd(report.end_date);
    setHistoryStart(report.start_date);
    setHistoryEnd(report.end_date);
    setWeeklyRangePickerDate(report.start_date);
    setRows([]);
    setReportFields(null);
    setWeeklySendNotice(null);
    loadWeeklyStatus(report.start_date, report.end_date);
    loadWeeklyActivity(report.start_date, report.end_date);
    loadWeeklyData(report.student_id, report.start_date, report.end_date);
  }


  async function loadWeeklyActivity(rangeStart = start, rangeEnd = end) {
    try {
      setWeeklyActivityLoading(true);
      const data = await apiFetch(`/api/report-activity?type=weekly&start=${rangeStart}&end=${rangeEnd}`);
      setWeeklyActivityLogs(data.logs || []);
    } catch {
      setWeeklyActivityLogs([]);
    } finally {
      setWeeklyActivityLoading(false);
    }
  }

  async function loadWeeklyData(nextStudentId = studentId, nextStart = start, nextEnd = end) {
    if (!nextStudentId) return alert('학생을 먼저 선택하세요.');
    try {
      setLoading(true);
      setMessage('위클리 리포트 조회 중...');
      const params = new URLSearchParams({ studentId: nextStudentId, start: nextStart, end: nextEnd });
      const history = await apiFetch(`/api/attendance-history?${params.toString()}`);
      setRows(history.rows || []);

      try {
        const pointParams = new URLSearchParams({ studentId: nextStudentId, start: nextStart, end: nextEnd });
        const pointData = await apiFetch(`/api/student-points?${pointParams.toString()}`);
        setWeeklyPoints(pointData.rows || []);
      } catch {
        setWeeklyPoints([]);
      }

      try {
        const saved = await apiFetch(`/api/weekly-report?${params.toString()}`);
        setReportFields(saved.report || null);
      } catch {
        setReportFields(null);
      }

      setMessage('위클리 리포트 조회 완료');
    } catch (error) {
      setRows([]);
      setWeeklyPoints([]);
      setReportFields(null);
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  function handleStudentChange(event) {
    const value = event.target.value;
    setStudentId(value);
    setRows([]);
    setReportFields(null);
    setWeeklySendNotice(null);
    if (value) loadWeeklyData(value, start, end);
  }

  function openStudentReport(student) {
    setStudentId(student.id);
    setRows([]);
    setReportFields(null);
    setWeeklySendNotice(null);
    loadWeeklyData(student.id, start, end);
  }


  function showWeeklyBulkNotice(notice) {
    setWeeklyBulkNotice(notice);
    if (onActionNotice) onActionNotice(notice);
    if (notice?.message) setMessage(notice.message);
  }

  async function runWeeklyBulkCompose(mode = 'missing') {
    const isAll = mode === 'all';
    const message = isAll
      ? '전체 활성 학생의 위클리 리포트를 현재 주간 데이터 기준으로 다시 구성합니다. 기존 주간 총평/면담은 유지하되, 리포트 본문과 요약이 갱신될 수 있습니다. 계속할까요?'
      : '아직 저장된 위클리 리포트가 없는 학생을 대상으로 자동 구성합니다. 계속할까요?';
    if (!confirm(message)) return;

    try {
      setWeeklyBulkLoading(true);
      setWeeklyBulkResult(null);
      showWeeklyBulkNotice({
        type: 'neutral',
        title: isAll ? '전체 위클리 리포트 자동 구성 중...' : '미작성 위클리 리포트 자동 구성 중...',
        message: `${start} ~ ${end} 기간의 출결·순공시간·상벌점 데이터를 집계하고 있습니다.`,
      });
      const data = await apiFetch('/api/weekly-report-bulk-compose', {
        method: 'POST',
        body: JSON.stringify({
          startDate: start,
          endDate: end,
          mode,
          createdBy: currentUser?.displayName || '관리자',
        }),
      });
      setWeeklyBulkResult(data);
      const summary = data.summary || {};
      showWeeklyBulkNotice({
        type: summary.failed ? 'warning' : 'success',
        title: '위클리 리포트 자동 구성 완료',
        message: `신규 ${summary.created || 0}명 · 갱신 ${summary.updated || 0}명 · 건너뜀 ${summary.skipped || 0}명 · 실패 ${summary.failed || 0}명`,
      });
      await loadWeeklyStatus(start, end);
      await loadWeeklyActivity(start, end);
      if (studentId) await loadWeeklyData(studentId, start, end);
    } catch (error) {
      showWeeklyBulkNotice({
        type: 'failed',
        title: '위클리 리포트 자동 구성 실패',
        message: error.message || '자동 구성 중 오류가 발생했습니다.',
      });
    } finally {
      setWeeklyBulkLoading(false);
    }
  }

  function getStudentReportStatus(student) {
    const report = reportsByStudentId[student.id];
    if (report?.report_text) return { label: '저장 완료', cls: 'done' };
    if (report) return { label: '작성 중', cls: 'neutral' };
    return { label: '미작성', cls: 'pending' };
  }

  function getWeeklySendStatus(report, student) {
    if (!student?.parent_phone) return { label: '연락처 없음', cls: 'failed' };
    if (!report?.report_text) return { label: '발송 전', cls: 'pending' };
    if (report.send_status === 'sent') return { label: '발송완료', cls: 'done' };
    if (report.send_status === 'failed') return { label: '발송실패', cls: 'failed' };
    if (report.send_status === 'ready') return { label: '발송대기', cls: 'neutral' };
    return { label: '발송 가능', cls: 'pending' };
  }

  async function refineInterviewDraft() {
    if (!selectedStudent) return alert('학생을 먼저 선택하세요.');
    const rawDraft = String(directorInterview || '').trim();
    if (!rawDraft) {
      const ok = confirm('입력된 주간면담 초안이 없습니다. 주간 데이터만 기준으로 면담 내용 초안을 생성할까요?');
      if (!ok) return;
    }

    try {
      setInterviewAiLoading(true);
      setInterviewAiMessage('');
      setInterviewAiComparison(null);
      setMessage('AI가 주간면담 내용을 다듬는 중...');
      const data = await apiFetch('/api/weekly-report/interview-ai', {
        method: 'POST',
        body: JSON.stringify({
          student: {
            id: selectedStudent.id,
            name: selectedStudent.name,
            school: selectedStudent.school,
            grade: selectedStudent.grade,
          },
          start,
          end,
          rawInterview: rawDraft,
          summary: {
            attendanceDays: weeklyStats.attendanceDays,
            totalStudyMinutes: weeklyStats.totalStudy,
            averageStudyMinutes: weeklyStats.averageStudy,
            awayCount: weeklyStats.totalAwayCount,
            awayMinutes: weeklyStats.totalAwayMinutes,
            issueCounts: weeklyStats.issueCounts,
            issueReasons: weeklyStats.issueReasons,
            issueSummary: weeklyStats.issueSummary,
            pointSummary: weeklyPointSummary,
          },
          detailRows: weeklyStats.detailRows.map((row) => ({
            date: row.date,
            checkInTime: row.checkInTime,
            checkOutTime: row.checkOutTime,
            pureStudyMinutes: row.pureStudyMinutes,
            awayCount: row.awayCount,
            awayMinutes: row.awayMinutes,
            flags: row.flags.map(formatAttendanceFlagDisplay),
          })),
        }),
      });

      const draft = String(data.draft || rawDraft || '').trim();
      setInterviewAiComparison({
        original: rawDraft || '입력된 원문 없이 주간 데이터 기준으로 생성되었습니다.',
        draft,
        fallback: Boolean(data.fallback),
        model: data.model || '',
      });
      setInterviewAiMessage(data.fallback ? '규칙 기반 면담 초안이 생성되었습니다. 원문과 비교 후 적용 여부를 선택하세요.' : `AI가 다듬은 문장이 생성되었습니다${data.model ? ` · ${data.model}` : ''}. 원문과 비교 후 적용 여부를 선택하세요.`);
      setMessage(data.fallback ? '규칙 기반 면담 초안을 생성했습니다.' : 'AI 면담 내용 다듬기 초안 생성 완료');
    } catch (error) {
      setInterviewAiMessage(error.message || 'AI 면담 내용 다듬기 중 오류가 발생했습니다.');
      setMessage(error.message);
    } finally {
      setInterviewAiLoading(false);
    }
  }

  function applyInterviewAiDraft() {
    if (!interviewAiComparison?.draft) return;
    setDirectorInterview(interviewAiComparison.draft);
    setInterviewAiComparison(null);
    setInterviewAiMessage('AI가 다듬은 글을 주간면담 내용에 반영했습니다.');
    markDirty();
    setMessage('AI 면담 내용 반영 완료');
  }

  function discardInterviewAiDraft() {
    setInterviewAiComparison(null);
    setInterviewAiMessage('AI가 다듬은 글 적용을 취소했습니다. 원문은 그대로 유지됩니다.');
  }

  async function generateAiDraft() {
    if (!selectedStudent) return alert('학생을 먼저 선택하세요.');
    try {
      setAiLoading(true);
      setAiSourceMessage('');
      setMessage('AI 주간 총평 초안 생성 중...');
      const data = await apiFetch('/api/weekly-report/ai', {
        method: 'POST',
        body: JSON.stringify({
          student: {
            id: selectedStudent.id,
            name: selectedStudent.name,
            school: selectedStudent.school,
            grade: selectedStudent.grade,
          },
          start,
          end,
          summary: {
            attendanceDays: weeklyStats.attendanceDays,
            totalStudyMinutes: weeklyStats.totalStudy,
            averageStudyMinutes: weeklyStats.averageStudy,
            awayCount: weeklyStats.totalAwayCount,
            awayMinutes: weeklyStats.totalAwayMinutes,
            issueCounts: weeklyStats.issueCounts,
            issueReasons: weeklyStats.issueReasons,
            issueSummary: weeklyStats.issueSummary,
          },
          directorInterview,
          detailRows: weeklyStats.detailRows.map((row) => ({
            date: row.date,
            checkInTime: row.checkInTime,
            checkOutTime: row.checkOutTime,
            pureStudyMinutes: row.pureStudyMinutes,
            awayCount: row.awayCount,
            awayMinutes: row.awayMinutes,
            flags: row.flags.map(formatAttendanceFlagDisplay),
          })),
        }),
      });
      setAiWeeklyComment(data.draft || '');
      setFinalWeeklyComment(data.draft || '');
      setAiSourceMessage(data.fallback ? 'AI 호출 실패 또는 미연동으로 규칙 기반 초안이 생성되었습니다.' : `AI 초안 생성 완료${data.model ? ` · ${data.model}` : ''}`);
      markDirty();
      setMessage(data.fallback ? '규칙 기반 초안을 생성했습니다.' : 'AI 주간 총평 초안 생성 완료');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setAiLoading(false);
    }
  }

  async function saveWeeklyReport() {
    if (!selectedStudent) return alert('학생을 먼저 선택하세요.');
    try {
      setSaveLoading(true);
      setMessage('위클리 리포트 저장 중...');
      const data = await apiFetch('/api/weekly-report', {
        method: 'POST',
        body: JSON.stringify({
          studentId: selectedStudent.id,
          startDate: start,
          endDate: end,
          summaryPayload: {
            attendanceDays: weeklyStats.attendanceDays,
            totalStudyMinutes: weeklyStats.totalStudy,
            averageStudyMinutes: weeklyStats.averageStudy,
            averageCheckIn: weeklyStats.averageCheckIn,
            averageCheckOut: weeklyStats.averageCheckOut,
            awayCount: weeklyStats.totalAwayCount,
            awayMinutes: weeklyStats.totalAwayMinutes,
            issueCounts: weeklyStats.issueCounts,
            issueReasons: weeklyStats.issueReasons,
            issueSummary: weeklyStats.issueSummary,
            pointSummary: weeklyPointSummary,
            rows: weeklyStats.detailRows.map((row) => ({
              id: row.id,
              date: row.date,
              checkInTime: row.checkInTime,
              checkOutTime: row.checkOutTime,
              pureStudyMinutes: row.pureStudyMinutes,
              awayCount: row.awayCount,
              awayMinutes: row.awayMinutes,
              flags: row.flags.map(formatAttendanceFlagDisplay),
            })),
          },
          directorInterview,
          aiWeeklyComment,
          finalWeeklyComment,
          reportText,
          createdBy: currentUser?.displayName || '관리자',
        }),
      });
      if (data.report) {
        setLastSavedReport(data.report);
        setWeeklyReports((prev) => {
          const others = (prev || []).filter((report) => report.id !== data.report.id && String(report.student_id) !== String(data.report.student_id));
          return [...others, data.report];
        });
        setSaveState('saved');
      }
      setMessage(data.warning || '위클리 리포트 저장 완료');
      return data.report || null;
    } catch (error) {
      setMessage(error.message);
      return null;
    } finally {
      setSaveLoading(false);
    }
  }

  function showWeeklySendNotice(notice) {
    setWeeklySendNotice(notice);
    if (onActionNotice) onActionNotice(notice);
    if (notice?.message) setMessage(notice.message);
  }

  function buildWeeklySendNotice(data) {
    if (!data || data.error) {
      return {
        type: 'failed',
        title: '위클리 리포트 발송 실패',
        message: data?.error || '위클리 리포트 발송 처리 중 오류가 발생했습니다.',
      };
    }

    const status = data.report?.send_status || data.status;
    if (status === 'sent') {
      return {
        type: 'success',
        title: '위클리 리포트 발송 완료',
        message: data.message || '학부모에게 위클리 리포트 발송 요청이 완료되었습니다.',
      };
    }

    if (status === 'failed') {
      return {
        type: 'failed',
        title: '위클리 리포트 발송 실패',
        message: data.message || data.report?.send_error || '위클리 리포트 발송 요청이 실패했습니다.',
      };
    }

    return {
      type: 'neutral',
      title: '위클리 리포트 발송대기 저장 완료',
      message: data.message || '카카오 발송 API가 아직 연결되지 않아 발송대기 상태로 저장했습니다.',
    };
  }

  async function previewWeeklyPublicLink() {
    if (!selectedStudent) {
      showWeeklySendNotice({ type: 'failed', title: '링크 미리보기 불가', message: '학생을 먼저 선택하세요.' });
      return;
    }
    if (!reportText.trim()) {
      showWeeklySendNotice({ type: 'failed', title: '링크 미리보기 불가', message: '미리보기할 위클리 리포트 본문이 없습니다.' });
      return;
    }

    let reportToPreview = lastSavedReport;
    if (saveState !== 'saved' || !lastSavedReport?.id || lastSavedReport.report_text !== reportText) {
      const ok = confirm('최신 위클리 리포트를 저장한 뒤 학부모 공개 링크를 미리볼까요?');
      if (!ok) return;
      reportToPreview = await saveWeeklyReport();
      if (!reportToPreview?.id) {
        showWeeklySendNotice({ type: 'failed', title: '링크 미리보기 불가', message: '위클리 리포트 저장에 실패했습니다.' });
        return;
      }
    }

    try {
      const data = await apiFetch('/api/report-share-link', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          reportType: 'weekly',
          reportId: reportToPreview.id,
        }),
      });
      if (!data.url) throw new Error(data.error || '공개 리포트 링크를 생성하지 못했습니다.');
      window.open(data.url, '_blank');
      showWeeklySendNotice({
        type: 'neutral',
        title: '위클리 리포트 링크 미리보기',
        message: '학부모 공개 리포트 링크를 새 탭에서 열었습니다.',
      });
    } catch (error) {
      showWeeklySendNotice({ type: 'failed', title: '링크 미리보기 실패', message: error.message });
    }
  }

  async function sendWeeklyReport() {
    if (!selectedStudent) {
      showWeeklySendNotice({ type: 'failed', title: '위클리 리포트 발송 불가', message: '학생을 먼저 선택하세요.' });
      return;
    }
    if (!reportText.trim()) {
      showWeeklySendNotice({ type: 'failed', title: '위클리 리포트 발송 불가', message: '발송할 위클리 리포트 본문이 없습니다.' });
      return;
    }
    if (!getActiveGuardians(selectedStudent, 'weekly').length) {
      showWeeklySendNotice({ type: 'failed', title: '위클리 리포트 발송 불가', message: '위클리 리포트 수신 보호자가 없어 발송할 수 없습니다.' });
      return;
    }

    let reportToSend = lastSavedReport;
    if (saveState !== 'saved' || !lastSavedReport?.id || lastSavedReport.report_text !== reportText) {
      const ok = confirm('최신 위클리 리포트를 저장한 뒤 학부모 발송을 준비할까요?');
      if (!ok) return;
      showWeeklySendNotice({
        type: 'neutral',
        title: '최신 위클리 리포트 저장 중...',
        message: '발송 전 최신 리포트 본문을 먼저 저장하고 있습니다.',
      });
      reportToSend = await saveWeeklyReport();
      if (!reportToSend?.id) {
        showWeeklySendNotice({ type: 'failed', title: '위클리 리포트 발송 불가', message: '위클리 리포트 저장에 실패해 발송을 진행할 수 없습니다.' });
        return;
      }
    }

    if (['ready', 'sent'].includes(reportToSend?.send_status)) {
      const ok = confirm(`이 위클리 리포트는 이미 ${getWeeklySendStatus(reportToSend, selectedStudent).label} 상태입니다.\n\n중복 발송 가능성이 있습니다. 계속 발송하시겠습니까?`);
      if (!ok) return;
    }

    let previewData = null;
    try {
      showWeeklySendNotice({
        type: 'neutral',
        title: '위클리 리포트 발송 미리보기 생성 중...',
        message: '서버 기준 템플릿 변수와 공개 링크를 확인하고 있습니다.',
      });
      previewData = await apiFetch('/api/weekly-report-send', {
        method: 'POST',
        body: JSON.stringify({
          reportId: reportToSend.id,
          action: 'preview',
          adminName: currentUser?.displayName || '관리자',
        }),
      });
    } catch (error) {
      showWeeklySendNotice({
        type: 'failed',
        title: '위클리 리포트 발송 미리보기 실패',
        message: error.message || '템플릿 변수 미리보기 생성 중 오류가 발생했습니다.',
      });
      return;
    }

    const safety = getReportSendSafetySummary(sendConfig);
    const recipientRows = buildStudentRecipientPreviewRows([selectedStudent], 'weekly', (student) => student || {});
    setWeeklySendConfirm({
      report: previewData?.report || reportToSend,
      student: selectedStudent,
      safety,
      recipientRows,
      recipientCount: getRecipientPreviewCount(recipientRows),
      sendPayload: previewData?.sendPayload || null,
      shareLink: previewData?.shareLink || null,
      acknowledged: !safety.requiresAcknowledgement,
      confirmPhrase: '',
    });
    showWeeklySendNotice({
      type: 'neutral',
      title: '위클리 리포트 발송 전 확인',
      message: '템플릿 변수와 수신자를 확인한 뒤 최종 발송하세요.',
    });
  }

  async function executeWeeklySendConfirm() {
    if (!weeklySendConfirm?.report?.id) return;
    const safety = weeklySendConfirm.safety || getReportSendSafetySummary(sendConfig);
    if (safety.requiresAcknowledgement && !weeklySendConfirm.acknowledged) {
      alert('발송 전 확인 체크를 완료해야 합니다.');
      return;
    }
    if (safety.requiresTypedConfirmation && String(weeklySendConfirm.confirmPhrase || '').trim() !== safety.confirmPhrase) {
      alert(`실전 발송 확인 문구로 "${safety.confirmPhrase}"를 입력해야 합니다.`);
      return;
    }

    const reportToSend = weeklySendConfirm.report;
    setWeeklySendConfirm(null);
    try {
      setWeeklySendLoading(true);
      showWeeklySendNotice({
        type: 'neutral',
        title: '위클리 리포트 발송 요청 중...',
        message: '저장된 위클리 리포트를 기준으로 카카오 발송 상태를 저장하고 있습니다. 잠시만 기다려주세요.',
      });
      const data = await apiFetch('/api/weekly-report-send', {
        method: 'POST',
        body: JSON.stringify({
          reportId: reportToSend.id,
          action: 'send',
          adminName: currentUser?.displayName || '관리자',
        }),
      });

      if (data.report) {
        setLastSavedReport(data.report);
        setWeeklyReports((prev) => {
          const others = (prev || []).filter((report) => report.id !== data.report.id && String(report.student_id) !== String(data.report.student_id));
          return [...others, data.report];
        });
      }
      showWeeklySendNotice(buildWeeklySendNotice(data));
      await loadWeeklyActivity(start, end);
    } catch (error) {
      showWeeklySendNotice({
        type: 'failed',
        title: '위클리 리포트 발송 실패',
        message: error.message || '위클리 리포트 발송 처리 중 오류가 발생했습니다.',
      });
    } finally {
      setWeeklySendLoading(false);
    }
  }

  async function retryWeeklyActivityLog(log) {
    const reportId = log?.target_id || log?.payload?.weeklyReportId || log?.payload?.reportId;
    if (!reportId) {
      alert('재발송할 위클리 리포트 정보를 찾지 못했습니다. 해당 학생의 위클리 리포트 화면에서 직접 발송해 주세요.');
      return;
    }
    try {
      setWeeklySendLoading(true);
      showWeeklySendNotice({ type: 'neutral', title: '위클리 실패 건 재발송 요청 중...', message: '기존 저장 리포트를 기준으로 다시 발송합니다.' });
      const data = await apiFetch('/api/weekly-report-send', {
        method: 'POST',
        body: JSON.stringify({
          reportId,
          action: 'send',
          adminName: currentUser?.displayName || '관리자',
        }),
      });
      if (data.report) {
        setLastSavedReport(data.report);
        setWeeklyReports((prev) => {
          const others = (prev || []).filter((report) => report.id !== data.report.id && String(report.student_id) !== String(data.report.student_id));
          return [...others, data.report];
        });
      }
      showWeeklySendNotice(buildWeeklySendNotice(data));
      await loadWeeklyActivity(start, end);
    } catch (error) {
      showWeeklySendNotice({ type: 'failed', title: '위클리 재발송 실패', message: error.message || '재발송 처리 중 오류가 발생했습니다.' });
    } finally {
      setWeeklySendLoading(false);
    }
  }

  const weeklyConfirmSafety = weeklySendConfirm?.safety || null;
  const weeklyConfirmRows = weeklySendConfirm?.recipientRows || [];
  const weeklyTemplateVariableRows = getKakaoTemplateVariableRows(weeklySendConfirm?.sendPayload?.templateVariables, 'weekly');
  const weeklyTemplateValidationLabel = getTemplateValidationLabel(weeklySendConfirm?.sendPayload?.templateValidation);
  const weeklyConfirmFinalDisabled = Boolean(weeklySendConfirm && weeklyConfirmSafety && (
    (weeklyConfirmSafety.requiresAcknowledgement && !weeklySendConfirm.acknowledged)
    || (weeklyConfirmSafety.requiresTypedConfirmation && String(weeklySendConfirm.confirmPhrase || '').trim() !== weeklyConfirmSafety.confirmPhrase)
  ));

  return (
    <section className={`content-card weekly-report-builder weekly-view-${weeklyView}`}>
      <div className="section-head">
        <div>
          <h2>위클리 리포트</h2>
          <p>월요일부터 일요일까지의 출결·순공시간·운영 기준 확인사항을 집계하고, 주간면담 내용을 반영해 학부모용 리포트를 작성합니다.</p>
        </div>
        <div className="planner-head-actions weekly-head-actions">
          <button className="secondary section-action" onClick={() => setPreset('current')}>이번 주</button>
          <button className="secondary section-action" onClick={() => setPreset('previous')}>지난 주</button>
          <button className="secondary section-action weekly-period-search-button" onClick={() => setWeeklyRangePickerOpen(true)}>기간 검색</button>
          <button className="primary section-action" onClick={() => { loadWeeklyStatus(start, end); loadWeeklyHistory(start, end); if (studentId) loadWeeklyData(studentId, start, end); }} disabled={loading}>{loading ? '조회 중...' : '조회'}</button>
        </div>
      </div>

      {weeklyRangePickerOpen ? (
        <div className="modal-backdrop" onClick={() => setWeeklyRangePickerOpen(false)}>
          <div className="small-action-popup weekly-range-picker-popup" onClick={(event) => event.stopPropagation()}>
            <div className="popup-head">
              <div>
                <h2>위클리 리포트 기간 검색</h2>
                <p>달력에서 날짜를 선택하면 해당 날짜가 속한 월~일 주간으로 자동 묶입니다. 아래 주간 선택지에서 과거 리포트 기간을 바로 선택할 수 있습니다.</p>
              </div>
              <button type="button" onClick={() => setWeeklyRangePickerOpen(false)}>닫기</button>
            </div>
            <div className="weekly-range-picker-current">
              <div className="field">
                <label>기준 날짜 선택</label>
                <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={weeklyRangePickerDate} onChange={(event) => setWeeklyRangePickerDate(event.target.value)} />
              </div>
              <div className="weekly-range-picker-preview">
                <span>선택 날짜가 속한 주간</span>
                <strong>{weeklyRangePickerSelectedRange.start} ~ {weeklyRangePickerSelectedRange.end}</strong>
                <button className="primary" type="button" onClick={() => applyWeeklyRangeSelection(weeklyRangePickerSelectedRange, { closePicker: true })}>이 주간 적용</button>
              </div>
            </div>
            <div className="weekly-range-picker-groups">
              {weeklyRangePickerOptions.map((group) => (
                <div className="weekly-range-picker-group" key={group.label}>
                  <strong>{group.label}</strong>
                  <div className="weekly-range-picker-options">
                    {group.weeks.map((week) => (
                      <button
                        type="button"
                        key={week.start}
                        className={`${week.isSelected ? 'selected' : ''} ${week.isCurrent ? 'current' : ''}`}
                        onClick={() => applyWeeklyRangeSelection(week, { closePicker: true })}
                      >
                        <span>{week.label}</span>
                        {week.isCurrent ? <em>이번 주</em> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="popup-bottom-actions">
              <button className="secondary" type="button" onClick={() => setWeeklyRangePickerOpen(false)}>취소</button>
              <button className="primary" type="button" onClick={() => applyWeeklyRangeSelection(weeklyRangePickerSelectedRange, { closePicker: true })}>선택 주간 조회</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="report-page-tabs clean-panel">
        <button type="button" className={weeklyView === 'main' ? 'active' : ''} onClick={() => setWeeklyView('main')}>리포트 작성</button>
        <button type="button" className={weeklyView === 'activity' ? 'active' : ''} onClick={() => { setWeeklyView('activity'); loadWeeklyActivity(start, end); }}>발송 이력 <span>{weeklyActivityLogs.length}</span></button>
        <button type="button" className={weeklyView === 'history' ? 'active' : ''} onClick={() => { setWeeklyView('history'); if (!weeklyHistoryReports.length) loadWeeklyHistory(historyStart, historyEnd); }}>과거 리포트 검색 <span>{weeklyHistoryReports.length}</span></button>
      </div>

      <ReportSendStatusBanner sendConfig={sendConfig} reportType="weekly" />

      <section className="weekly-history-console clean-panel">
        <div className="weekly-auto-compose-head">
          <div>
            <strong>선택 주간 저장·발송 이력</strong>
            <span>상단의 이번 주/지난 주/기간 검색에서 선택한 주간에 저장·발송된 위클리 리포트를 확인합니다.</span>
          </div>
          <div className="weekly-history-range-summary">
            <span>현재 선택 주간</span>
            <strong>{historyStart} ~ {historyEnd}</strong>
            <button className="secondary" type="button" onClick={() => loadWeeklyHistory(historyStart, historyEnd)} disabled={weeklyHistoryLoading}>{weeklyHistoryLoading ? '새로고침 중...' : '이력 새로고침'}</button>
          </div>
        </div>

        <div className="weekly-history-filter-grid compact">
          <div className="field">
            <label>학생 필터</label>
            <select value={historyStudentFilter} onChange={(event) => setHistoryStudentFilter(event.target.value)}>
              <option value="all">전체 학생</option>
              {(students || []).map((student) => (
                <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>상태 필터</label>
            <select value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value)}>
              <option value="all">전체 상태</option>
              <option value="saved">저장된 리포트</option>
              <option value="sent">발송완료</option>
              <option value="ready">발송대기</option>
              <option value="failed">발송실패</option>
              <option value="draft">본문 미작성</option>
            </select>
          </div>
          <div className="field weekly-history-search-field">
            <label>검색어</label>
            <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="학생명, 학교, 리포트 내용 검색" />
          </div>
        </div>

        <div className="weekly-bulk-result-grid weekly-history-summary-grid">
          <div><span>조회 전체</span><strong>{weeklyHistorySummary.total}건</strong></div>
          <div><span>저장 완료</span><strong>{weeklyHistorySummary.saved}건</strong></div>
          <div><span>발송완료</span><strong>{weeklyHistorySummary.sent}건</strong></div>
          <div><span>발송대기</span><strong>{weeklyHistorySummary.ready}건</strong></div>
          <div><span>발송실패</span><strong>{weeklyHistorySummary.failed}건</strong></div>
          <div><span>필터 결과</span><strong>{weeklyHistoryFilteredReports.length}건</strong></div>
        </div>

        {weeklyHistoryNotice ? <div className="send-action-feedback weekly-bulk-feedback neutral"><strong>조회 안내</strong><span>{weeklyHistoryNotice}</span></div> : null}

        <div className="weekly-history-list">
          {weeklyHistoryFilteredReports.length ? weeklyHistoryFilteredReports.map((report) => {
            const student = report.student || studentLookup[report.student_id] || {};
            const sendStatus = getWeeklySendStatus(report, student);
            const summary = report.summary_payload || {};
            const preview = String(report.report_text || report.final_weekly_comment || report.ai_weekly_comment || '저장된 리포트 본문이 없습니다.').replace(/\s+/g, ' ').trim();
            return (
              <article key={report.id} className="weekly-history-row">
                <div className="weekly-history-row-head">
                  <div>
                    <strong>{student.name || '학생명 미확인'}</strong>
                    <span>{[student.school, student.grade].filter(Boolean).join(' ') || report.student_id || '-'}</span>
                  </div>
                  <em className={`status-pill ${sendStatus.cls}`}>{sendStatus.label}</em>
                </div>
                <div className="weekly-history-meta-grid">
                  <div><span>기간</span><strong>{report.start_date} ~ {report.end_date}</strong></div>
                  <div><span>저장/수정</span><strong>{formatSavedAt(report.updated_at) || '-'}</strong></div>
                  <div><span>총 순공</span><strong>{formatMinutes(summary.totalStudyMinutes || 0)}</strong></div>
                  <div><span>등원일수</span><strong>{summary.attendanceDays || 0}일</strong></div>
                </div>
                <p>{preview.slice(0, 220)}{preview.length > 220 ? '...' : ''}</p>
                <div className="weekly-history-actions">
                  <button className="secondary" onClick={() => openWeeklyHistoryReport(report)}>이 기간 리포트 열기</button>
                  {report.report_text ? <button className="secondary" onClick={() => navigator.clipboard?.writeText(report.report_text).then(() => setMessage('위클리 리포트 본문을 복사했습니다.')).catch(() => alert('복사에 실패했습니다.'))}>본문 복사</button> : null}
                </div>
              </article>
            );
          }) : (
            <div className="all-clear">조회 조건에 맞는 과거 위클리 리포트가 없습니다. 기간을 넓히거나 학생/상태 필터를 조정해 보세요.</div>
          )}
        </div>
      </section>

      <section className="weekly-auto-compose-console clean-panel">
        <div className="weekly-auto-compose-head">
          <div>
            <strong>주간 리포트 자동 구성 콘솔</strong>
            <span>출결·순공시간·외출·상벌점 데이터를 기준으로 위클리 리포트 초안을 일괄 생성합니다.</span>
          </div>
          <div className="weekly-auto-compose-actions">
            <button className="secondary section-action" onClick={() => runWeeklyBulkCompose('missing')} disabled={weeklyBulkLoading}>{weeklyBulkLoading ? '구성 중...' : '미작성 자동 구성'}</button>
            <button className="primary section-action" onClick={() => runWeeklyBulkCompose('all')} disabled={weeklyBulkLoading}>{weeklyBulkLoading ? '구성 중...' : '전체 갱신 구성'}</button>
          </div>
        </div>
        <div className="weekly-auto-compose-guide">
          <span>미작성 자동 구성은 기존 저장 리포트를 보존합니다.</span>
          <span>전체 갱신 구성은 저장된 면담/최종 코멘트는 유지하되, 주간 요약과 본문을 최신 데이터로 다시 정리합니다.</span>
        </div>
        {weeklyBulkNotice ? (
          <div className={`send-action-feedback weekly-bulk-feedback ${weeklyBulkNotice.type || 'neutral'} ${weeklyBulkLoading ? 'loading' : ''}`}>
            <strong>{weeklyBulkNotice.title}</strong>
            <span>{weeklyBulkNotice.message}</span>
          </div>
        ) : null}
        {weeklyBulkResult?.summary ? (
          <div className="weekly-bulk-result-grid">
            <div><span>처리 대상</span><strong>{weeklyBulkResult.summary.total || 0}명</strong></div>
            <div><span>신규 생성</span><strong>{weeklyBulkResult.summary.created || 0}명</strong></div>
            <div><span>기존 갱신</span><strong>{weeklyBulkResult.summary.updated || 0}명</strong></div>
            <div><span>건너뜀</span><strong>{weeklyBulkResult.summary.skipped || 0}명</strong></div>
            <div><span>실패</span><strong>{weeklyBulkResult.summary.failed || 0}명</strong></div>
          </div>
        ) : null}
        {weeklyBulkResult?.results?.filter((row) => !row.ok).length ? (
          <div className="weekly-bulk-error-list">
            <strong>자동 구성 실패 학생</strong>
            {weeklyBulkResult.results.filter((row) => !row.ok).slice(0, 8).map((row) => (
              <div key={row.studentId}><b>{row.studentName || row.studentId}</b><span>{row.error}</span></div>
            ))}
          </div>
        ) : null}
      </section>

      <ReportActivityPanel
        title="위클리 리포트 발송 이력"
        logs={weeklyActivityLogs}
        loading={weeklyActivityLoading}
        onRefresh={() => loadWeeklyActivity(start, end)}
        onRetry={retryWeeklyActivityLog}
        reportType="weekly"
      />

      <div className="weekly-progress-grid">
        <div><span>대상 학생</span><strong>{progress.total}명</strong></div>
        <div><span>저장 완료</span><strong>{progress.saved}명</strong></div>
        <div><span>작성 중</span><strong>{progress.inProgress}명</strong></div>
        <div><span>미작성</span><strong>{progress.notStarted}명</strong></div>
        <div><span>주간면담 미입력</span><strong>{progress.interviewMissing}명</strong></div>
        <div><span>AI 초안 있음</span><strong>{progress.aiDraft}명</strong></div>
        <div><span>발송대기</span><strong>{progress.sendReady}명</strong></div>
        <div><span>발송완료</span><strong>{progress.sendSent}명</strong></div>
        <div><span>발송실패</span><strong>{progress.sendFailed}명</strong></div>
      </div>

      <div className="weekly-student-board clean-panel">
        <div className="weekly-board-head">
          <strong>학생별 작성 상태</strong>
          <span>{statusLoading ? '상태 조회 중...' : `${start} ~ ${end}`}</span>
        </div>
        <div className="weekly-student-card-grid">
          {activeStudents.map((student) => {
            const report = reportsByStudentId[student.id];
            const status = getStudentReportStatus(student);
            const sendStatus = getWeeklySendStatus(report, student);
            const isSelected = String(student.id) === String(studentId);
            return (
              <button key={student.id} className={`weekly-student-card ${status.cls} ${isSelected ? 'selected' : ''}`} onClick={() => openStudentReport(student)}>
                <div className="weekly-student-name-line">
                  <strong>{student.name}</strong>
                  <em className={`status-pill ${sendStatus.cls} weekly-send-chip name-send-chip`}>{sendStatus.label}</em>
                </div>
                <span>{[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</span>
                <div className="weekly-status-chip-row weekly-main-status-row">
                  <em className={`status-pill ${status.cls}`}>{status.label}</em>
                  {report?.director_interview ? <em className="status-pill done">면담 입력</em> : <em className="status-pill pending">면담 미입력</em>}
                  {report?.ai_weekly_comment ? <em className="status-pill neutral">AI 초안</em> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="weekly-filter-panel clean-panel">
        <div className="field">
          <label>학생 선택</label>
          <select value={studentId} onChange={handleStudentChange}>
            <option value="">학생을 선택하세요</option>
            {activeStudents.map((student) => (
              <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>시작일</label>
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={start} onChange={(event) => { setStart(event.target.value); loadWeeklyStatus(event.target.value, end); }} />
        </div>
        <div className="field">
          <label>종료일</label>
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={end} onChange={(event) => { setEnd(event.target.value); loadWeeklyStatus(start, event.target.value); }} />
        </div>
      </div>

      {!selectedStudent ? (
        <div className="attendance-blank-hint clean-panel">
          <strong>학생을 먼저 선택하세요.</strong>
          <span>위클리 리포트는 학생별로 월요일~일요일 기간을 기준으로 생성합니다.</span>
        </div>
      ) : null}

      {selectedStudent ? (
        <>
          <div className="weekly-status-bar">
            <span className={`status-pill ${getSaveStateClass()}`}>{getSaveStateLabel()}</span>
            {lastSavedReport?.updated_at ? <span>마지막 저장: {formatSavedAt(lastSavedReport.updated_at)}</span> : <span>저장된 위클리 리포트가 아직 없습니다.</span>}
            {lastSavedReport?.send_status ? <span>발송상태: {getSendStatusLabel(lastSavedReport.send_status)}</span> : null}
            {lastSavedReport?.send_error ? <span>발송오류: {lastSavedReport.send_error}</span> : null}
            {aiSourceMessage ? <span>{aiSourceMessage}</span> : null}
          </div>

          <div className="weekly-summary-grid">
            <div className="student-profile-card">
              <span>학생</span>
              <strong>{selectedStudent.name}</strong>
              <em>{[selectedStudent.school, selectedStudent.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</em>
            </div>
            <div><span>기간</span><strong>{start} ~ {end}</strong></div>
            <div><span>등원일수</span><strong>{weeklyStats.attendanceDays}일</strong></div>
            <div><span>총 순공시간</span><strong>{formatMinutes(weeklyStats.totalStudy)}</strong></div>
            <div><span>일평균 순공</span><strong>{formatMinutes(weeklyStats.averageStudy)}</strong></div>
            <div><span>외출</span><strong>{weeklyStats.totalAwayCount}회 · {formatMinutes(weeklyStats.totalAwayMinutes)}</strong></div>
            <div><span>주요 확인사항</span><strong>{weeklyStats.issueSummary}</strong></div>
          </div>

          <div className="weekly-detail-layout">
            <section className="weekly-panel">
              <h3>이번 주 학습 요약</h3>
              <ul className="weekly-summary-list">
                <li>등원일수: <b>{weeklyStats.attendanceDays}일</b></li>
                <li>총 순공시간: <b>{formatMinutes(weeklyStats.totalStudy)}</b></li>
                <li>일평균 순공시간: <b>{formatMinutes(weeklyStats.averageStudy)}</b></li>
                <li>외출: <b>{weeklyStats.totalAwayCount}회 / 총 {formatMinutes(weeklyStats.totalAwayMinutes)}</b></li>
                <li>주요 확인사항: <b>{weeklyStats.issueSummary}</b></li>
                <li>상벌점: <b>{weeklyPointSummary.label}</b></li>
              </ul>

              <div className="weekly-table-wrap">
                <table className="weekly-detail-table">
                  <thead>
                    <tr><th>날짜</th><th>등원</th><th>하원</th><th>순공</th><th>외출</th><th>상태</th></tr>
                  </thead>
                  <tbody>
                    {weeklyStats.detailRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatAttendanceDate(row.date)}</td>
                        <td>{row.checkInTime || '-'}</td>
                        <td>{row.checkOutTime || (row.checkInAt ? '학습중' : '-')}</td>
                        <td>{formatMinutes(row.pureStudyMinutes)}</td>
                        <td>{row.awayCount ? `${row.awayCount}회 · ${formatMinutes(row.awayMinutes)}` : '-'}</td>
                        <td>
                          <div className="attendance-flag-list">
                            {row.flags.map((flag) => <span key={`${row.id}-${formatAttendanceFlagDisplay(flag)}`} className={`attendance-flag ${flag.type}`}>{formatAttendanceFlagDisplay(flag)}</span>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!weeklyStats.detailRows.length ? <div className="today-comment-empty">선택한 기간의 출결 기록이 없습니다.</div> : null}
              </div>
            </section>

            <section className="weekly-panel">
              <h3>주간면담 내용</h3>
              <p>원장님이 토요일에 학생과 심층 면담한 내용을 입력합니다. 학습 루틴, 집중도, 과목별 고민, 정서 상태, 다음 주 목표 등을 기록하세요.</p>
              <textarea value={directorInterview} onChange={(event) => { setDirectorInterview(event.target.value); setInterviewAiComparison(null); markDirty(); }} placeholder="예: 이번 주 면담에서는 자습 시작 후 집중 유지 시간, 단어 복습 루틴, 다음 주 목표를 중심으로 점검했습니다." />
              <div className="weekly-interview-ai-row">
                <span>입력한 면담 메모를 학부모용 문장으로 정리합니다. 원문은 바로 바뀌지 않고 비교 화면에서 적용 여부를 선택합니다.</span>
                <button className="secondary section-action" onClick={refineInterviewDraft} disabled={interviewAiLoading}>{interviewAiLoading ? 'AI 다듬는 중...' : 'AI 면담 내용 다듬기'}</button>
              </div>

              {interviewAiComparison ? (
                <div className="weekly-interview-ai-comparison">
                  <div className="interview-compare-card original">
                    <strong>원문</strong>
                    <pre>{interviewAiComparison.original}</pre>
                  </div>
                  <div className="interview-compare-card ai">
                    <strong>AI 다듬은 글</strong>
                    <pre>{interviewAiComparison.draft}</pre>
                  </div>
                  <div className="interview-compare-actions">
                    <button className="secondary section-action" onClick={discardInterviewAiDraft}>원문 유지</button>
                    <button className="primary section-action" onClick={applyInterviewAiDraft}>AI 글로 반영</button>
                  </div>
                </div>
              ) : null}

              {interviewAiMessage ? <div className={interviewAiMessage.includes('오류') || interviewAiMessage.includes('취소') ? 'hint warning-hint' : 'hint success-hint'}>{interviewAiMessage}</div> : null}

              <div className="weekly-ai-box">
                <div>
                  <h3>주간 총평</h3>
                  <p>주간 학습 요약과 주간면담 내용을 바탕으로 학부모용 주간 총평 초안을 생성합니다.</p>
                </div>
                <button className="secondary section-action" onClick={generateAiDraft} disabled={aiLoading}>{aiLoading ? 'AI 작성 중...' : 'AI 주간 총평 초안 생성'}</button>
              </div>
              <textarea value={finalWeeklyComment} onChange={(event) => { setFinalWeeklyComment(event.target.value); markDirty(); }} placeholder="학부모님께 전달할 주간 총평을 입력하거나 AI 초안을 수정하세요." />
              {aiSourceMessage ? <div className={aiSourceMessage.includes('규칙 기반') ? 'hint warning-hint' : 'hint success-hint'}>{aiSourceMessage}</div> : null}
            </section>
          </div>

          <section className="weekly-report-output">
            <div className="section-head">
              <div>
                <h3>학부모용 위클리 리포트</h3>
                <p>주간면담 내용을 먼저 제시한 뒤, 이를 반영한 주간 총평이 이어지도록 구성합니다. 저장 후 학부모 발송 흐름으로 운영합니다.</p>
              </div>
              <div className="planner-head-actions weekly-send-actions">
                <button className="secondary section-action" onClick={saveWeeklyReport} disabled={saveLoading}>{saveLoading ? '저장 중...' : '저장'}</button>
                <button className="secondary section-action link-preview-button" onClick={previewWeeklyPublicLink} disabled={saveLoading || !selectedStudent}>링크 미리보기</button>
                <button className="primary section-action" onClick={sendWeeklyReport} disabled={weeklySendLoading || saveLoading}>{weeklySendLoading ? '발송 중...' : '발송'}</button>
              </div>
            </div>
            {weeklySendNotice ? (
              <div className={`send-action-feedback weekly-send-feedback ${weeklySendNotice.type || 'neutral'} ${weeklySendLoading ? 'loading' : ''}`}>
                <strong>{weeklySendNotice.title}</strong>
                <span>{weeklySendNotice.message}</span>
              </div>
            ) : (
              <div className="hint weekly-send-hint">위클리 리포트도 복사 없이 저장 후 학부모 발송 버튼으로 보내는 흐름을 기준으로 운영합니다.</div>
            )}
            <pre className="weekly-report-text">{reportText}</pre>
          </section>
        </>
      ) : null}

      {weeklySendConfirm ? (
        <div className="modal-backdrop" onClick={() => setWeeklySendConfirm(null)}>
          <div className="send-preview-modal compact-send-modal weekly-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="popup-head">
              <div>
                <h2>위클리 리포트 발송 최종 확인</h2>
                <p>{weeklySendConfirm.student?.name || '학생'} 학생의 위클리 리포트를 발송하기 전 수신자와 실전 발송 상태를 확인하세요.</p>
              </div>
              <button onClick={() => setWeeklySendConfirm(null)}>닫기</button>
            </div>

            <div className={`send-live-safety-card ${weeklyConfirmSafety?.className || 'safe'}`}>
              <div>
                <strong>{weeklyConfirmSafety?.title || '발송 상태 확인'}</strong>
                <span>{weeklyConfirmSafety?.description || '발송 전 현재 제공자/수신번호 제한 상태를 확인하세요.'}</span>
              </div>
              <em>{weeklyConfirmSafety?.badge || '확인 필요'}</em>
            </div>

            <div className="send-confirm-summary-grid v40-95-summary weekly-confirm-summary">
              <div><strong>1</strong><span>발송 대상 학생</span></div>
              <div><strong>{weeklySendConfirm.recipientCount || 0}</strong><span>예상 수신 보호자</span></div>
              <div><strong>{start}</strong><span>시작일</span></div>
              <div><strong>{end}</strong><span>종료일</span></div>
            </div>

            <RecipientPolicyProjectionCard projection={getRecipientPolicyProjection(sendConfig, weeklySendConfirm.recipientCount || 0)} />

            <div className="send-recipient-preview-box">
              <strong>발송 대상 보호자 확인</strong>
              <p>개인정보 보호를 위해 전화번호는 일부만 표시됩니다. 실제 수신자는 보호자 수신 설정과 테스트/Allowlist 정책에 따라 결정됩니다.</p>
              <div className="recipient-preview-list">
                {weeklyConfirmRows.map((row) => (
                  <div key={row.id}>
                    <b>{row.name}</b>
                    <span>{row.recipients.length ? row.recipients.join(' / ') : '수신 보호자 없음'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="send-recipient-preview-box template-variable-preview-card weekly-template-preview">
              <strong>실제 카톡 템플릿 변수 확인</strong>
              <p>발송 서버가 계산한 SOLAPI 위클리 템플릿 변수입니다. 공개 링크 리포트와 같은 기준으로 표시됩니다.</p>
              <div className="template-variable-grid">
                {weeklyTemplateVariableRows.map(([key, value]) => (
                  <div key={key} className={!value ? 'missing' : ''}>
                    <span>{key}</span>
                    <strong>{value || '값 없음'}</strong>
                  </div>
                ))}
              </div>
              <div className={`template-validation-line ${weeklySendConfirm?.sendPayload?.templateValidation?.ok ? 'done' : 'warn'}`}>{weeklyTemplateValidationLabel}</div>
            </div>

            {weeklyConfirmSafety?.requiresAcknowledgement ? (
              <div className="send-acknowledgement-box">
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(weeklySendConfirm.acknowledged)}
                    onChange={(event) => setWeeklySendConfirm((prev) => prev ? { ...prev, acknowledged: event.target.checked } : prev)}
                  />
                  <span>{weeklyConfirmSafety.level === 'live-unrestricted' ? '테스트 모드/Allowlist 없이 실제 보호자에게 발송되는 것을 확인했습니다.' : '현재 발송 제한/테스트 정책을 확인했습니다.'}</span>
                </label>
                {weeklyConfirmSafety.requiresTypedConfirmation ? (
                  <div className="field confirm-phrase-field">
                    <label>실전 발송 확인 문구</label>
                    <input
                      value={weeklySendConfirm.confirmPhrase || ''}
                      onChange={(event) => setWeeklySendConfirm((prev) => prev ? { ...prev, confirmPhrase: event.target.value } : prev)}
                      placeholder={`${weeklyConfirmSafety.confirmPhrase} 입력`}
                    />
                    <small>전체 실전 발송 모드에서는 오발송 방지를 위해 <b>{weeklyConfirmSafety.confirmPhrase}</b> 입력이 필요합니다.</small>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="popup-bottom-actions">
              <button className="secondary" onClick={() => setWeeklySendConfirm(null)}>취소</button>
              <button className="primary send-final-button" onClick={executeWeeklySendConfirm} disabled={weeklyConfirmFinalDisabled}>{weeklyConfirmFinalDisabled ? '확인 필요' : '위클리 발송'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StudentPointsTab({ students, apiFetch, currentUser, setMessage }) {
  const today = getKstDateString();
  const week = getThisWeekRange();
  const activeStudents = (students || []).filter((student) => student.status !== 'inactive');
  const [studentId, setStudentId] = useState('');
  const [start, setStart] = useState(week.start);
  const [end, setEnd] = useState(week.end);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ reward: 0, penalty: 0, net: 0, count: 0 });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ pointDate: today, pointType: 'reward', points: 1, reason: '', memo: '' });

  useEffect(() => {
    loadPoints();
  }, []);

  async function loadPoints(next = {}) {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        start: next.start || start,
        end: next.end || end,
        limit: '200',
      });
      const selected = next.studentId !== undefined ? next.studentId : studentId;
      if (selected) params.set('studentId', selected);
      const data = await apiFetch(`/api/student-points?${params.toString()}`);
      setRows(data.rows || []);
      setSummary(data.summary || { reward: 0, penalty: 0, net: 0, count: 0 });
    } catch (error) {
      setRows([]);
      setMessage?.(error.message || '상벌점 조회 실패');
    } finally {
      setLoading(false);
    }
  }

  async function submitPoint() {
    if (!studentId) return alert('학생을 선택하세요.');
    if (!String(form.reason || '').trim()) return alert('상벌점 사유를 입력하세요.');
    const points = Math.max(1, Number(form.points || 0));
    try {
      setSaving(true);
      const data = await apiFetch('/api/student-points', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          studentId,
          pointDate: form.pointDate,
          pointType: form.pointType,
          points,
          reason: form.reason,
          memo: form.memo,
          createdBy: currentUser?.displayName || '관리자',
        }),
      });
      setMessage?.(data.message || '상벌점 기록 완료');
      setForm((prev) => ({ ...prev, points: 1, reason: '', memo: '' }));
      await loadPoints();
    } catch (error) {
      setMessage?.(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePoint(row) {
    const ok = confirm(`${row.student?.name || '학생'}의 ${row.point_type === 'reward' ? '상점' : '벌점'} ${row.points}점 기록을 삭제할까요?`);
    if (!ok) return;
    try {
      const data = await apiFetch('/api/student-points', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', id: row.id }),
      });
      setMessage?.(data.message || '상벌점 기록 삭제 완료');
      await loadPoints();
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  function setPreset(type) {
    const todayValue = getKstDateString();
    if (type === 'today') {
      setStart(todayValue);
      setEnd(todayValue);
      loadPoints({ start: todayValue, end: todayValue });
      return;
    }
    if (type === 'week') {
      const range = getThisWeekRange();
      setStart(range.start);
      setEnd(range.end);
      loadPoints({ start: range.start, end: range.end });
      return;
    }
    if (type === 'month') {
      const firstDay = todayValue.slice(0, 8) + '01';
      setStart(firstDay);
      setEnd(todayValue);
      loadPoints({ start: firstDay, end: todayValue });
    }
  }

  const selectedStudent = activeStudents.find((student) => String(student.id) === String(studentId));

  return (
    <section className="content-card student-points-tab">
      <div className="section-head">
        <div>
          <h2>상벌점 관리</h2>
          <p>학생별 상점·벌점을 수시로 기록하고, 데일리/위클리 리포트에 반영합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={() => setPreset('today')}>오늘</button>
          <button className="secondary section-action" onClick={() => setPreset('week')}>이번 주</button>
          <button className="secondary section-action" onClick={() => setPreset('month')}>이번 달</button>
          <button className="primary section-action" onClick={() => loadPoints()} disabled={loading}>{loading ? '조회 중...' : '조회'}</button>
        </div>
      </div>

      <div className="points-summary-grid">
        <div className="reward"><span>상점</span><strong>{summary.reward || 0}점</strong></div>
        <div className="penalty"><span>벌점</span><strong>{summary.penalty || 0}점</strong></div>
        <div><span>순점수</span><strong>{summary.net > 0 ? '+' : ''}{summary.net || 0}점</strong></div>
        <div><span>기록 수</span><strong>{summary.count || 0}건</strong></div>
      </div>

      <div className="points-control-grid clean-panel">
        <div className="field">
          <label>학생</label>
          <select value={studentId} onChange={(e) => { setStudentId(e.target.value); loadPoints({ studentId: e.target.value }); }}>
            <option value="">전체 학생</option>
            {activeStudents.map((student) => (
              <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</option>
            ))}
          </select>
        </div>
        <div className="field"><label>시작일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label>종료일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={end} onChange={(e) => setEnd(e.target.value)} /></div>
      </div>

      <div className="points-form-card clean-panel">
        <div className="points-form-head">
          <strong>{selectedStudent ? `${selectedStudent.name} 상벌점 기록` : '학생을 선택해 상벌점을 기록하세요'}</strong>
          <span>리포트에는 해당 날짜 또는 기간의 상벌점 요약이 자동 반영됩니다.</span>
        </div>
        <div className="points-form-grid">
          <div className="field"><label>날짜</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={form.pointDate} onChange={(e) => setForm({ ...form, pointDate: e.target.value })} /></div>
          <div className="field"><label>구분</label><select value={form.pointType} onChange={(e) => setForm({ ...form, pointType: e.target.value })}><option value="reward">상점</option><option value="penalty">벌점</option></select></div>
          <div className="field"><label>점수</label><input type="number" min="1" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} /></div>
          <div className="field full"><label>사유</label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="예: 플래너 성실 작성 / 무단 외출 / 순공 목표 달성" /></div>
          <div className="field full"><label>메모</label><input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="내부 참고 메모. 선택 입력" /></div>
        </div>
        <button className="primary" onClick={submitPoint} disabled={saving || !studentId}>{saving ? '저장 중...' : '상벌점 저장'}</button>
      </div>

      <div className="points-list-card clean-panel">
        <div className="points-list-head">
          <strong>상벌점 기록</strong>
          <span>{loading ? '조회 중...' : `${rows.length}건 표시 중`}</span>
        </div>
        {rows.length ? (
          <div className="points-row-list">
            {rows.map((row) => (
              <article key={row.id} className={`points-row ${row.point_type}`}>
                <div>
                  <strong>{row.student?.name || row.student_name || '학생'}</strong>
                  <span>{row.point_date} · {[row.student?.school, row.student?.grade].filter(Boolean).join(' ')}</span>
                </div>
                <em>{row.point_type === 'reward' ? '+' : '-'}{row.points}점</em>
                <p>{row.reason}</p>
                <button className="secondary" onClick={() => deletePoint(row)}>삭제</button>
              </article>
            ))}
          </div>
        ) : (
          <div className="all-clear">선택 조건에 해당하는 상벌점 기록이 없습니다.</div>
        )}
      </div>
    </section>
  );
}

function RankingTab({ ranking, rankingStart, rankingEnd, setRankingStart, setRankingEnd, loadRanking, setRankingPreset }) {
  return (
    <section className="content-card">
      <h2>순공시간 랭킹보드</h2>
      <p>원하는 기간을 설정해 총 순공시간, 출석일수, 일평균 순공시간을 비교합니다.</p>
      <div className="btn-row">
        <button className="secondary" onClick={() => setRankingPreset('today')}>오늘</button>
        <button className="secondary" onClick={() => setRankingPreset('week')}>이번 주</button>
        <button className="secondary" onClick={() => setRankingPreset('month')}>이번 달</button>
      </div>
      <div className="time-grid">
        <div className="field"><label>시작일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={rankingStart} onChange={(e) => setRankingStart(e.target.value)} /></div>
        <div className="field"><label>종료일</label><input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={rankingEnd} onChange={(e) => setRankingEnd(e.target.value)} /></div>
      </div>
      <div className="btn-row"><button className="primary" onClick={() => loadRanking()}>랭킹 조회</button></div>
      <table className="data-table">
        <thead><tr><th>순위</th><th>학생</th><th>출석일수</th><th>총 순공시간</th><th>일평균</th><th>외출</th><th>관리필요</th></tr></thead>
        <tbody>
          {ranking.map((row, index) => (
            <tr key={row.studentId}>
              <td>{index + 1}</td>
              <td>{row.name} / {[row.school, row.grade].filter(Boolean).join(' ')}</td>
              <td>{row.attendanceDays}일</td>
              <td>{formatMinutes(row.totalStudyMinutes)}</td>
              <td>{formatMinutes(row.averageStudyMinutes)}</td>
              <td>{row.awayCount}회</td>
              <td>{row.needsAttentionCount}회</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AttendanceTab({
  students, rows, loading, start, end, studentFilter, setStart, setEnd, setStudentFilter, loadHistory, setPreset,
  operatingRules, statusFilter, setStatusFilter, summaryCollapsed, setSummaryCollapsed, saveMentorComment, focusMentorCommentRequest,
  mentoringContext, onReturnToMentoring, onNavigateMentoringStudent,
}) {
  const rules = normalizeOperatingRules(operatingRules);
  const selectedStudent = (students || []).find((student) => String(student.id) === String(studentFilter));
  const flaggedRows = (rows || []).map((row) => ({ ...row, flags: getAttendanceFlags(row, rules) }));
  const [commentFilter, setCommentFilter] = useState('all');
  const [commentDrafts, setCommentDrafts] = useState({});
  const [savingCommentId, setSavingCommentId] = useState(null);
  const [mentoringReturnReady, setMentoringReturnReady] = useState(false);
  const mentorCommentTextareaRef = useRef(null);
  const today = getKstDateString();

  const statusFilteredRows = statusFilter === 'all'
    ? flaggedRows
    : flaggedRows.filter((row) => row.flags.some((flag) => flag.label === statusFilter));

  const visibleRows = statusFilteredRows.filter((row) => {
    if (commentFilter === 'with_comment') return Boolean(String(row.mentorComment || '').trim());
    if (commentFilter === 'without_comment') return !String(row.mentorComment || '').trim();
    return true;
  });

  const totalStudy = (rows || []).reduce((sum, row) => sum + Number(row.pureStudyMinutes || 0), 0);
  const totalAway = (rows || []).reduce((sum, row) => sum + Number(row.awayCount || 0), 0);
  const totalAwayMinutes = (rows || []).reduce((sum, row) => sum + Number(row.awayMinutes || 0), 0);
  const attendanceDays = (rows || []).filter((row) => row.checkInAt).length;
  const commentDays = (rows || []).filter((row) => String(row.mentorComment || '').trim()).length;
  const averageStudy = attendanceDays > 0 ? Math.round(totalStudy / attendanceDays) : 0;
  const averageCheckIn = averageClock(rows, 'checkInTime');
  const averageCheckOut = averageClock(rows, 'checkOutTime');
  const lateDays = countAttendanceFlag(rows, '지각', rules);
  const earlyLeaveDays = countAttendanceFlag(rows, '조퇴', rules);
  const excessiveAwayDays = countAttendanceFlag(rows, '외출과다', rules);
  const lowStudyDays = countAttendanceFlag(rows, '순공부족', rules);
  const attentionDays = (rows || []).filter((row) => getAttendanceFlags(row, rules).some((flag) => ['관리주의', '미등원', '외출과다'].includes(flag.label))).length;
  const statusOptions = ['all', '정상', '지각', '조퇴', '외출과다', '순공부족', '관리주의', '미등원'];
  const todayRow = flaggedRows.find((row) => row.date === today);
  const fromMentoringFlow = mentoringContext?.source === 'mentoring' && String(mentoringContext?.studentId || '') === String(studentFilter || selectedStudent?.id || '');
  const mentoringSequence = Array.isArray(mentoringContext?.studentSequence) ? mentoringContext.studentSequence : [];
  const mentoringCurrentIndex = fromMentoringFlow
    ? (() => {
      const foundIndex = mentoringSequence.findIndex((item) => String(item.studentId || '') === String(studentFilter || selectedStudent?.id || ''));
      return foundIndex >= 0 ? foundIndex : Number(mentoringContext?.currentIndex ?? -1);
    })()
    : -1;
  const previousMentoringStudent = mentoringCurrentIndex > 0 ? mentoringSequence[mentoringCurrentIndex - 1] : null;
  const nextMentoringStudent = mentoringCurrentIndex >= 0 && mentoringCurrentIndex < mentoringSequence.length - 1 ? mentoringSequence[mentoringCurrentIndex + 1] : null;
  const recentCommentRows = flaggedRows
    .filter((row) => row.date !== today && String(row.mentorComment || '').trim())
    .slice(0, 5);

  function getCommentDraft(row) {
    if (!row) return '';
    return Object.prototype.hasOwnProperty.call(commentDrafts, row.id) ? commentDrafts[row.id] : (row.mentorComment || '');
  }

  function updateCommentDraft(rowId, value) {
    setCommentDrafts((prev) => ({ ...prev, [rowId]: value }));
    setMentoringReturnReady(false);
  }

  async function handleSaveTodayComment() {
    if (!saveMentorComment || !todayRow) return;
    const value = getCommentDraft(todayRow);
    setSavingCommentId(todayRow.id);
    const ok = await saveMentorComment(todayRow.id, value);
    setSavingCommentId(null);
    if (ok) {
      setCommentDrafts((prev) => {
        const next = { ...prev };
        delete next[todayRow.id];
        return next;
      });
      if (fromMentoringFlow) setMentoringReturnReady(true);
    }
  }

  function moveMentoringStudent(target) {
    if (!target?.studentId) return;
    onNavigateMentoringStudent?.(target.studentId, {
      ...(mentoringContext || {}),
      studentId: String(target.studentId),
      currentIndex: typeof target.sequenceIndex === 'number' ? target.sequenceIndex : mentoringSequence.findIndex((item) => String(item.studentId || '') === String(target.studentId)),
    });
  }

  useEffect(() => {
    if (!focusMentorCommentRequest?.nonce) return undefined;
    if (!selectedStudent?.id || String(selectedStudent.id) !== String(focusMentorCommentRequest.studentId)) return undefined;
    const timer = window.setTimeout(() => {
      mentorCommentTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mentorCommentTextareaRef.current?.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusMentorCommentRequest?.nonce, focusMentorCommentRequest?.studentId, selectedStudent?.id, todayRow?.id]);

  useEffect(() => {
    setMentoringReturnReady(false);
  }, [mentoringContext?.slotId, mentoringContext?.studentId, focusMentorCommentRequest?.nonce]);

  function handleStudentChange(event) {
    const value = event.target.value;
    setStudentFilter(value);
    setStatusFilter('all');
    setCommentFilter('all');
    if (!value) return;
    loadHistory(start, end, value);
  }

  const summaryNotice = selectedStudent
    ? `${selectedStudent.name} 학생의 ${start} ~ ${end} 출결 현황입니다.`
    : '학생을 선택하면 출결 현황이 표시됩니다.';

  return (
    <section className="content-card attendance-history-tab attendance-table-mode">
      <div className="section-head">
        <div>
          <h2>출결 현황 · 멘토 코멘트</h2>
          <p>{summaryNotice}</p>
        </div>
        <div className="planner-head-actions attendance-preset-actions">
          <button className="secondary section-action" onClick={() => setPreset('today')}>오늘</button>
          <button className="secondary section-action" onClick={() => setPreset('week')}>이번 주</button>
          <button className="secondary section-action" onClick={() => setPreset('month')}>이번 달</button>
        </div>
      </div>

      <div className="attendance-filter-panel clean-panel table-filter-panel">
        <div className="field">
          <label>학생 선택</label>
          <select value={studentFilter} onChange={handleStudentChange}>
            <option value="">학생을 선택하세요</option>
            {(students || []).map((student) => (
              <option key={student.id} value={student.id}>
                {student.name} / {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>시작일</label>
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={start} onChange={(e) => { setStart(e.target.value); if (studentFilter) loadHistory(e.target.value, end, studentFilter); }} />
        </div>
        <div className="field">
          <label>종료일</label>
          <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={end} onChange={(e) => { setEnd(e.target.value); if (studentFilter) loadHistory(start, e.target.value, studentFilter); }} />
        </div>
        <button className="primary section-action" onClick={() => loadHistory()} disabled={loading || !studentFilter}>{loading ? '조회 중...' : '출결 조회'}</button>
      </div>

      {!selectedStudent ? (
        <div className="attendance-blank-hint clean-panel">
          <strong>학생을 먼저 선택하세요.</strong>
          <span>출결·관리 이력 메뉴는 학생별 장기 출결 참여도와 학습상태를 보는 화면입니다. 학생을 선택하기 전에는 기록을 표시하지 않습니다.</span>
        </div>
      ) : null}

      {selectedStudent ? (
        <>
          <div className="attendance-summary-toggle-row">
            <button className="secondary section-action" onClick={() => setSummaryCollapsed(!summaryCollapsed)}>
              {summaryCollapsed ? '요약 펼치기' : '요약 접기'}
            </button>
            <div className="field compact-status-filter">
              <label>상태 필터</label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statusOptions.map((option) => (
                  <option key={option} value={option}>{option === 'all' ? '전체 상태' : option}</option>
                ))}
              </select>
            </div>
            <div className="field compact-status-filter">
              <label>코멘트 필터</label>
              <select value={commentFilter} onChange={(event) => setCommentFilter(event.target.value)}>
                <option value="all">전체 기록</option>
                <option value="with_comment">코멘트 있는 날</option>
                <option value="without_comment">코멘트 없는 날</option>
              </select>
            </div>
            <span className="attendance-visible-count">표시 {visibleRows.length}건 / 전체 {rows?.length || 0}건</span>
          </div>

          {!summaryCollapsed ? (
            <div className="attendance-insight-summary">
              <div className="student-profile-card">
                <span>선택 학생</span>
                <strong>{selectedStudent.name}</strong>
                <em>{[selectedStudent.school, selectedStudent.grade].filter(Boolean).join(' ') || '학교/학년 미입력'} · {selectedStudent.default_seat_no ? `${String(selectedStudent.default_seat_no).padStart(2, '0')}번` : '기본 좌석 미입력'}</em>
              </div>
              <div><span>조회 기간</span><strong>{start} ~ {end}</strong></div>
              <div><span>등원일수</span><strong>{attendanceDays}일</strong></div>
              <div><span>평균 등원</span><strong>{averageCheckIn}</strong></div>
              <div><span>평균 하원</span><strong>{averageCheckOut}</strong></div>
              <div><span>총 순공시간</span><strong>{formatMinutes(totalStudy)}</strong></div>
              <div><span>일평균 순공</span><strong>{formatMinutes(averageStudy)}</strong></div>
              <div><span>외출</span><strong>{totalAway}회 · {formatMinutes(totalAwayMinutes)}</strong></div>
              <div><span>코멘트 기록</span><strong>{commentDays}일</strong></div>
              <div><span>관리주의일</span><strong>{attentionDays}일</strong></div>
            </div>
          ) : null}

          <div className="attendance-insight-toolbar">
            <div className="attendance-risk-chip-row">
              <span className={lateDays ? 'risk-chip warn' : 'risk-chip'}>지각 {lateDays}일</span>
              <span className={earlyLeaveDays ? 'risk-chip warn' : 'risk-chip'}>조퇴 {earlyLeaveDays}일</span>
              <span className={excessiveAwayDays ? 'risk-chip warn' : 'risk-chip'}>외출과다 {excessiveAwayDays}일</span>
              <span className={lowStudyDays ? 'risk-chip warn' : 'risk-chip'}>순공부족 {lowStudyDays}일</span>
              <span className={attentionDays ? 'risk-chip danger' : 'risk-chip'}>관리주의 {attentionDays}일</span>
            </div>
            <button className="secondary section-action" disabled={!visibleRows?.length} onClick={() => downloadAttendanceCsv({ rows: visibleRows, student: selectedStudent, start, end, rules })}>
              CSV 다운로드
            </button>
          </div>

          <div className="today-mentor-comment-panel">
            <div className="today-comment-editor-card">
              <div className="today-comment-head">
                <div>
                  <strong>오늘 학습멘토 코멘트</strong>
                  <span>{today} · 오늘 코멘트만 수정 가능합니다.</span>
                </div>
                {todayRow ? <span className={todayRow.mentorComment ? 'status-pill done' : 'status-pill pending'}>{todayRow.mentorComment ? '입력됨' : '미입력'}</span> : <span className="status-pill neutral">오늘 기록 없음</span>}
              </div>
              {todayRow ? (
                <>
                  <textarea
                    ref={mentorCommentTextareaRef}
                    value={getCommentDraft(todayRow)}
                    onChange={(event) => updateCommentDraft(todayRow.id, event.target.value)}
                    placeholder="오늘 1:1 면담 내용과 다음 관리 포인트를 입력하세요."
                  />
                  <div className="today-comment-actions">
                    <span>저장 후 리포트 미리보기/발송 시 최신 코멘트가 자동 반영됩니다.</span>
                    <div className="today-comment-primary-actions">
                      {fromMentoringFlow && mentoringReturnReady ? (
                        <button type="button" className="secondary mentoring-return-button" onClick={onReturnToMentoring}>멘토링 시간표로 돌아가기</button>
                      ) : null}
                      <button className="primary" onClick={handleSaveTodayComment} disabled={savingCommentId === todayRow.id}>
                        {savingCommentId === todayRow.id ? '저장 중...' : '오늘 코멘트 저장'}
                      </button>
                    </div>
                  </div>
                  {fromMentoringFlow && mentoringSequence.length > 1 ? (
                    <div className="mentoring-comment-nav-row">
                      <span>같은 차시 학생 이동</span>
                      <button type="button" className="secondary" onClick={() => moveMentoringStudent(previousMentoringStudent)} disabled={!previousMentoringStudent}>이전{previousMentoringStudent?.studentName ? ` · ${previousMentoringStudent.studentName}` : ''}</button>
                      <button type="button" className="secondary" onClick={() => moveMentoringStudent(nextMentoringStudent)} disabled={!nextMentoringStudent}>다음{nextMentoringStudent?.studentName ? ` · ${nextMentoringStudent.studentName}` : ''}</button>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="today-comment-empty">
                  오늘 출결 기록이 없거나 조회 기간에 오늘이 포함되어 있지 않습니다. 오늘 기록이 생성되면 이 영역에서 코멘트를 저장할 수 있습니다.
                </div>
              )}
            </div>

            <div className="recent-comment-card">
              <strong>최근 학습멘토 코멘트</strong>
              {recentCommentRows.length ? (
                <div className="recent-comment-list">
                  {recentCommentRows.map((row) => (
                    <div key={`recent-${row.id}`}>
                      <b>{formatAttendanceDate(row.date)}</b>
                      <span>{row.mentorComment}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="today-comment-empty">최근 저장된 과거 코멘트가 없습니다.</div>
              )}
            </div>
          </div>

          <details className="attendance-rule-guide">
            <summary>상태 기준 안내</summary>
            <div>
              <span><b>지각</b> 학생 시간표의 예정 등원보다 {rules.lateThresholdMinutes}분 이상 늦게 등원</span>
              <span><b>조퇴</b> 학생 시간표의 예정 하원보다 {rules.earlyLeaveThresholdMinutes}분 이상 일찍 하원</span>
              <span><b>외출과다</b> 하루 외출 {rules.excessiveAwayCount}회 이상 또는 외출 누적 {rules.excessiveAwayMinutes}분 이상</span>
              <span><b>순공부족</b> 등원 기록이 있고 날짜별 순공시간이 {formatMinutes(rules.lowStudyMinutes)} 미만</span>
              <span><b>관리주의</b> 멘토 코멘트/특이사항에 관리 키워드 포함: {(rules.attentionKeywords || []).join(', ')}</span>
              <span><b>미등원</b> 해당 날짜에 등원시간 없음</span>
              <span><b>정상</b> 위 항목에 해당하지 않음</span>
            </div>
          </details>

          <div className="mentor-comment-history-guide">
            <strong>학습멘토 코멘트 기록</strong>
            <span>과거 코멘트는 참고용으로만 표시됩니다. 수정은 오늘 코멘트 입력 영역에서만 가능합니다.</span>
          </div>

          <div className="attendance-table-wrap">
            <table className="attendance-flat-table attendance-insight-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>등원시간</th>
                  <th>하원시간</th>
                  <th>외출 현황</th>
                  <th>순공시간</th>
                  <th>상태</th>
                  <th>학습멘토 코멘트</th>
                  <th>특이사항</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className={row.flags.some((flag) => flag.type === 'danger') ? 'row-danger' : row.flags.some((flag) => flag.type === 'warn') ? 'row-warn' : ''}>
                    <td className="date-cell">{formatAttendanceDate(row.date)}</td>
                    <td>{formatAttendanceCell(row.checkInTime)}</td>
                    <td>{row.checkOutTime || (row.checkInAt ? '아직 학습중' : '-')}</td>
                    <td className="long-cell">{formatAttendanceAway(row)}</td>
                    <td>{formatMinutes(row.pureStudyMinutes)}</td>
                    <td className="status-cell">
                      <div className="attendance-flag-list">
                        {row.flags.map((flag) => (
                          <span key={`${row.id}-${flag.label}`} className={`attendance-flag ${flag.type}`}>{flag.label}</span>
                        ))}
                      </div>
                    </td>
                    <td className="comment-cell mentor-comment-readonly-cell">
                      {row.date === today ? <span className="today-comment-chip">오늘 · 상단에서 수정</span> : null}
                      <div className={row.mentorComment ? 'mentor-comment-readonly filled' : 'mentor-comment-readonly empty'}>
                        {row.mentorComment || '저장된 코멘트 없음'}
                      </div>
                    </td>
                    <td className="comment-cell">{formatAttendanceCell(row.attendanceMemo || row.scheduleNote || row.eventSummary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(!rows || rows.length === 0) ? (
            <div className="empty-student-list attendance-empty-result">
              <strong>선택한 기간의 출결 기록이 없습니다.</strong>
              <span>검색기간을 변경하거나 학생 시간표/출결 데이터가 저장되어 있는지 확인하세요.</span>
            </div>
          ) : null}

          {rows?.length > 0 && visibleRows.length === 0 ? (
            <div className="empty-student-list attendance-empty-result">
              <strong>선택한 필터에 해당하는 기록이 없습니다.</strong>
              <span>상태 필터나 코멘트 필터를 전체로 변경해 보세요.</span>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}



function StudentCareTab({ attendanceProps = {}, historyProps = {} }) {
  const selectedStudentId = attendanceProps.studentFilter || historyProps.focusStudentId || '';
  const selectedStudent = (attendanceProps.students || historyProps.students || []).find((student) => String(student.id) === String(selectedStudentId));

  return (
    <section className="student-care-page student-care-unified-page">
      <div className="content-card student-care-hero">
        <div>
          <p>출결 현황, 오늘 학습멘토 코멘트, 누적 학생 관리 이력을 한 화면에서 이어서 확인합니다.</p>
        </div>
        <div className="student-care-selected-pill">
          {selectedStudent ? `${selectedStudent.name} 선택 중` : '학생 선택 대기'}
        </div>
      </div>

      <div className="content-card student-care-picker">
        <div className="student-care-picker-head">
          <strong>학생 선택</strong>
          <span>먼저 학생과 조회 기간을 선택하세요. 선택하면 아래 두 영역에 함께 적용됩니다.</span>
        </div>
        <div className="student-care-picker-row">
          <div className="field student-care-picker-student">
            <label>학생</label>
            <select
              value={attendanceProps.studentFilter || ''}
              onChange={(event) => {
                const value = event.target.value;
                attendanceProps.setStudentFilter?.(value);
                if (value) attendanceProps.loadHistory?.(attendanceProps.start, attendanceProps.end, value);
              }}
            >
              <option value="">학생을 선택하세요</option>
              {(attendanceProps.students || []).map((student) => (
                <option key={student.id} value={student.id}>
                  {student.name} / {[student.school, student.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>시작일</label>
            <input type="date" value={attendanceProps.start || ''} onClick={(event) => event.target.showPicker?.()} onChange={(event) => { attendanceProps.setStart?.(event.target.value); if (attendanceProps.studentFilter) attendanceProps.loadHistory?.(event.target.value, attendanceProps.end, attendanceProps.studentFilter); }} />
          </div>
          <div className="field">
            <label>종료일</label>
            <input type="date" value={attendanceProps.end || ''} onClick={(event) => event.target.showPicker?.()} onChange={(event) => { attendanceProps.setEnd?.(event.target.value); if (attendanceProps.studentFilter) attendanceProps.loadHistory?.(attendanceProps.start, event.target.value, attendanceProps.studentFilter); }} />
          </div>
          <div className="student-care-picker-presets">
            <button type="button" className="secondary" onClick={() => attendanceProps.setPreset?.('today')}>오늘</button>
            <button type="button" className="secondary" onClick={() => attendanceProps.setPreset?.('week')}>이번 주</button>
            <button type="button" className="secondary" onClick={() => attendanceProps.setPreset?.('month')}>이번 달</button>
            <button type="button" className="primary" onClick={() => attendanceProps.loadHistory?.()} disabled={attendanceProps.loading || !attendanceProps.studentFilter}>{attendanceProps.loading ? '조회 중...' : '조회'}</button>
          </div>
        </div>
      </div>

      <div className="content-card student-care-unified-guide">
        <div>
          <strong>통합 관리 화면</strong>
          <span>화면은 위쪽의 오늘 출결·멘토 코멘트 영역과 아래쪽의 누적 관리 이력 영역으로 나뉩니다. 학생과 조회 기간은 한 번만 선택하면 두 영역에 함께 적용됩니다.</span>
        </div>
        <div className="student-care-anchor-actions">
          <a href="#student-care-attendance-section">오늘 기록</a>
          <a href="#student-care-history-section">누적 기록</a>
        </div>
      </div>

      <div id="student-care-attendance-section" className="student-care-section-block">
        <div className="student-care-section-title today-record-title">
          <span>오늘 기록</span>
          <div>
            <h3>출결 현황 · 학습멘토 코멘트</h3>
            <p>오늘 출결 상태와 멘토 코멘트를 먼저 확인하고 저장합니다. 멘토링 시간표에서 넘어온 경우 저장 후 시간표로 바로 돌아갈 수 있습니다.</p>
          </div>
        </div>
        <AttendanceTab {...attendanceProps} />
      </div>

      <div id="student-care-history-section" className="student-care-section-block student-care-history-section">
        <div className="student-care-section-title history-record-title">
          <span>누적 기록</span>
          <div>
            <h3>학생 관리 이력</h3>
            <p>위에서 선택한 학생과 기간을 기준으로 상담·순찰·리포트·관리주의 이력을 누적해서 확인합니다.</p>
          </div>
        </div>
        <StudentHistoryTab
          {...historyProps}
          embedded
          externalStudentId={selectedStudentId}
          externalStart={historyProps.externalStart || attendanceProps.start}
          externalEnd={historyProps.externalEnd || attendanceProps.end}
        />
      </div>
    </section>
  );
}


function StudentHistoryTab({ students = [], apiFetch, currentUser, setMessage, setActiveTab, focusStudentId = '', embedded = false, externalStudentId = '', externalStart = '', externalEnd = '' }) {
  const today = getKstDateString();
  const defaultRange = { start: addDays(today, -6), end: today };
  const [studentId, setStudentId] = useState('');
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [historyData, setHistoryData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [openRowKey, setOpenRowKey] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryMode, setSummaryMode] = useState('student_feedback');
  const [summaryStatus, setSummaryStatus] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const lastAppliedFocusStudentRef = useRef('');

  const activeStudents = useMemo(() => (students || []).filter((student) => student?.status !== 'inactive'), [students]);
  const selectedStudent = useMemo(() => activeStudents.find((student) => String(student.id) === String(studentId)) || null, [activeStudents, studentId]);

  useEffect(() => {
    const targetId = String(externalStudentId || focusStudentId || '');
    const targetStart = externalStart || start;
    const targetEnd = externalEnd || end;
    const targetKey = `${targetId}|${targetStart}|${targetEnd}`;

    if (!targetId) {
      if (embedded) {
        setStudentId('');
        setHistoryData(null);
        setNotice('상단에서 학생을 선택하면 같은 조건의 누적 관리 이력이 함께 표시됩니다.');
      }
      return;
    }

    if (lastAppliedFocusStudentRef.current === targetKey) return;
    lastAppliedFocusStudentRef.current = targetKey;
    if (targetId !== String(studentId || '')) setStudentId(targetId);
    if (targetStart !== start) setStart(targetStart);
    if (targetEnd !== end) setEnd(targetEnd);
    loadHistory(targetId, targetStart, targetEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalStudentId, focusStudentId, externalStart, externalEnd]);

  useEffect(() => {
    if (embedded) return;
    if (!studentId && activeStudents[0]?.id) setStudentId(activeStudents[0].id);
  }, [activeStudents, studentId, embedded]);

  async function loadHistory(nextStudentId = studentId, nextStart = start, nextEnd = end) {
    if (!nextStudentId) {
      setNotice('먼저 학생을 선택하세요.');
      return;
    }
    try {
      setLoading(true);
      setNotice('학생 관리 이력을 불러오는 중...');
      const data = await apiFetch(`/api/student-history?studentId=${encodeURIComponent(nextStudentId)}&start=${nextStart}&end=${nextEnd}`);
      setHistoryData(data);
      const savedText = data?.counselingSummariesByType?.[summaryMode]?.generated_summary || data?.counselingSummariesByType?.[summaryMode]?.edited_summary || '';
      setSummaryDraft(savedText);
      setSummaryStatus(savedText ? { type: 'done', message: '최근 생성된 상담 요약을 불러왔습니다.' } : null);
      setOpenRowKey('');
      setNotice(`${data?.student?.name || '학생'} · ${nextStart} ~ ${nextEnd} 관리 이력을 조회했습니다.`);
    } catch (error) {
      setNotice(error.message || '학생 관리 이력 조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (embedded) return;
    if (studentId) loadHistory(studentId, start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  function applyPreset(type) {
    let range = { start, end };
    if (type === 'today') range = { start: today, end: today };
    if (type === 'recent7') range = { start: addDays(today, -6), end: today };
    if (type === 'recent30') range = { start: addDays(today, -29), end: today };
    if (type === 'thisWeek') range = getFullWeekRange(today);
    if (type === 'thisMonth') range = { start: startOfMonth(today), end: endOfMonth(today) };
    setStart(range.start);
    setEnd(range.end);
    loadHistory(studentId, range.start, range.end);
  }

  function getSummaryModeLabel(mode = summaryMode) {
    return mode === 'parent_counseling' ? '학부모 상담용' : '학생 피드백용';
  }

  function getRangeDayCount() {
    try {
      const startDate = new Date(`${start}T00:00:00+09:00`);
      const endDate = new Date(`${end}T00:00:00+09:00`);
      return Math.floor((endDate - startDate) / 86400000) + 1;
    } catch {
      return 0;
    }
  }

  function setSummaryModeAndLoad(mode) {
    setSummaryMode(mode);
    const text = historyData?.counselingSummariesByType?.[mode]?.generated_summary || historyData?.counselingSummariesByType?.[mode]?.edited_summary || '';
    setSummaryDraft(text);
    setSummaryStatus(text ? { type: 'done', message: `${getSummaryModeLabel(mode)} 최근 생성본을 불러왔습니다.` } : null);
  }

  async function generateCounselingSummary(mode = summaryMode) {
    if (!historyData?.student?.id) {
      setSummaryStatus({ type: 'error', message: '먼저 학생 관리 이력을 조회하세요.' });
      return;
    }
    if (!historyData?.aiConfig?.openAiConfigured) {
      setSummaryStatus({ type: 'error', message: 'OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.' });
      return;
    }
    if (!rows.length) {
      setSummaryStatus({ type: 'error', message: '요약 생성에 필요한 출결·순찰·리포트 기록이 부족합니다.' });
      return;
    }
    const rangeDays = getRangeDayCount();
    if (rangeDays > 31) {
      const ok = window.confirm(`조회기간이 ${rangeDays}일입니다. 데이터가 많아 요약 비용과 시간이 늘어날 수 있습니다. 계속 생성할까요?`);
      if (!ok) return;
    }
    try {
      setSummaryLoading(true);
      setSummaryMode(mode);
      setSummaryStatus({ type: 'loading', message: `${getSummaryModeLabel(mode)} GPT 요약을 생성하는 중...` });
      const data = await apiFetch('/api/student-history-summary', {
        method: 'POST',
        body: JSON.stringify({
          action: 'generate',
          studentId: historyData.student.id,
          startDate: historyData.start,
          endDate: historyData.end,
          summaryType: mode,
          sourcePayload: historyData.counselingSource,
        }),
      });
      const text = data?.summary?.generated_summary || data?.summary?.edited_summary || data?.text || '';
      setSummaryDraft(text);
      setHistoryData((prev) => prev ? {
        ...prev,
        counselingSummary: data.summary || prev.counselingSummary,
        counselingSummariesByType: {
          ...(prev.counselingSummariesByType || {}),
          [mode]: data.summary,
        },
      } : prev);
      setSummaryStatus({ type: 'done', message: `${getSummaryModeLabel(mode)} 상담 요약을 생성했습니다.${data?.model ? ` (${data.model})` : ''}` });
    } catch (error) {
      setSummaryStatus({ type: 'error', message: error.message || 'GPT 상담 요약 생성에 실패했습니다.' });
    } finally {
      setSummaryLoading(false);
    }
  }

  function copySummary() {
    if (!summaryDraft.trim()) return;
    navigator.clipboard?.writeText(summaryDraft).then(() => {
      setSummaryStatus({ type: 'done', message: '상담 요약을 클립보드에 복사했습니다.' });
    }).catch(() => setSummaryStatus({ type: 'error', message: '클립보드 복사에 실패했습니다.' }));
  }

  const summary = historyData?.summary || {};
  const rows = historyData?.rows || [];

  return (
    <section className={embedded ? 'student-history-page embedded-student-history' : 'student-history-page'}>
      <div className={embedded ? 'content-card student-history-hero embedded' : 'content-card student-history-hero'}>
        <div>
          <h2>{embedded ? '누적 관리 이력' : '학생 관리 이력'}</h2>
          <p>{embedded ? '위의 학생·기간 기준으로 출결, 순공시간, 순찰 체크, 플래너, 관리주의, 알림, 리포트 이력을 함께 표시합니다.' : '학생 1명을 선택하면 조회기간의 출결, 순공시간, 순찰 체크, 플래너, 관리주의, 알림, 리포트 이력을 한 화면에 압축해서 확인합니다.'}</p>
        </div>
        <div className="student-history-badge">{historyData ? `${historyData.start} ~ ${historyData.end}` : embedded ? '상단 조건 연동' : '상담 준비 · 누적 관리 확인용'}</div>
      </div>

      {!embedded ? (
      <div className="content-card student-history-filter-card">
        <div className="student-history-filter-grid">
          <label>
            <span>학생</span>
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)}>
              <option value="">학생 선택</option>
              {activeStudents.map((student) => (
                <option key={student.id} value={student.id}>{student.name} {student.school ? `· ${student.school}` : ''}</option>
              ))}
            </select>
          </label>
          <label>
            <span>조회 시작일</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>조회 종료일</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <button type="button" className="primary" onClick={() => loadHistory(studentId, start, end)} disabled={loading || !studentId}>{loading ? '조회 중...' : '조회'}</button>
        </div>
        <div className="student-history-preset-row">
          <button type="button" className="secondary" onClick={() => applyPreset('today')}>오늘</button>
          <button type="button" className="secondary" onClick={() => applyPreset('recent7')}>최근 7일</button>
          <button type="button" className="secondary" onClick={() => applyPreset('recent30')}>최근 30일</button>
          <button type="button" className="secondary" onClick={() => applyPreset('thisWeek')}>이번 주</button>
          <button type="button" className="secondary" onClick={() => applyPreset('thisMonth')}>이번 달</button>
        </div>
        {notice ? <div className="inline-notice">{notice}</div> : null}
      </div>
      ) : notice ? <div className="inline-notice student-history-embedded-notice">{notice}</div> : null}

      {historyData ? (
        <>
          <div className="student-history-profile-card content-card">
            <div>
              <span>선택 학생</span>
              <strong>{selectedStudent?.name || historyData.student?.name || '학생'}</strong>
              <em>{[historyData.student?.school, historyData.student?.grade].filter(Boolean).join(' · ') || '학교/학년 미입력'}</em>
            </div>
            <div>
              <span>조회 기간</span>
              <strong>{historyData.start} ~ {historyData.end}</strong>
              <em>표시는 상담용 압축 뷰입니다.</em>
            </div>
          </div>

          <div className="student-history-summary-grid">
            <div><span>등원일수</span><strong>{summary.attendanceDays || 0}일</strong></div>
            <div><span>총 순공시간</span><strong>{summary.totalStudyLabel || '0분'}</strong></div>
            <div><span>일평균 순공</span><strong>{summary.averageStudyLabel || '0분'}</strong></div>
            <div><span>외출</span><strong>{summary.awayCount || 0}회</strong></div>
            <div><span>순찰 기록</span><strong>{summary.studyCheckCount || 0}회</strong></div>
            <div><span>관리주의</span><strong>{summary.focusCount || 0}건</strong></div>
            <div><span>학부모 알림</span><strong>{summary.alertCount || 0}건</strong></div>
            <div><span>리포트 발송</span><strong>{summary.dailySentCount || 0}/{summary.dailyReportCount || 0}</strong></div>
          </div>

          <div className="student-history-layout">
            <div className="content-card student-history-main-table-card">
              <div className="student-history-section-head">
                <div>
                  <h3>날짜별 압축 관리표</h3>
                  <p>엑셀 관리시트처럼 하루 단위 기록을 압축해서 표시합니다. 행을 누르면 상세 이력이 펼쳐집니다.</p>
                </div>
              </div>
              <div className="student-history-table-wrap">
                <table className="student-history-table">
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>출결 요약</th>
                      <th>순공</th>
                      <th>학습 체크</th>
                      <th>관리자 관찰</th>
                      <th>학습체크 상세</th>
                      <th>플래너</th>
                      <th>관리주의/알림</th>
                      <th>리포트</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const key = row.sessionId || row.reportId || row.date;
                      const open = openRowKey === key;
                      return (
                        <Fragment key={key}>
                          <tr className={row.focusCount ? 'has-focus' : ''} onClick={() => setOpenRowKey(open ? '' : key)}>
                            <td className="student-history-date-cell">{row.kind === 'weekly' ? '위클리' : formatAttendanceDate(row.date)}</td>
                            <td>{row.attendanceSummary || '-'}</td>
                            <td>{row.pureStudyLabel || '-'}</td>
                            <td>{row.studyCheckCount ? `${row.studyCheckCount}회 · ${row.topSubject}/${row.topStudyStatus}` : '-'}</td>
                            <td className="student-history-long-cell">{row.observation || '-'}</td>
                            <td className="student-history-long-cell">{row.periodSummary || '-'}</td>
                            <td className="student-history-long-cell">{row.plannerStatus === '제출' ? (row.plannerMemo || '제출') : row.plannerStatus || '-'}</td>
                            <td>{row.focusCount ? `관리주의 ${row.focusCount}건` : row.alertCount ? `알림 ${row.alertCount}건` : '-'}</td>
                            <td>{row.reportStatus || '-'}</td>
                          </tr>
                          {open ? (
                            <tr className="student-history-detail-row">
                              <td colSpan={9}>
                                <div className="student-history-detail-grid">
                                  <div><b>출결 이벤트</b><span>{row.eventSummary || '-'}</span></div>
                                  <div><b>순찰/학습상태</b><span>{row.periodSummary || '-'}</span></div>
                                  <div><b>관리자 코멘트</b><span>{row.observation || '-'}</span></div>
                                  <div><b>플래너 검토</b><span>{row.plannerMemo || '-'}</span></div>
                                  <div><b>관리주의</b><span>{row.focusIssues || '-'}</span></div>
                                  <div><b>알림/리포트</b><span>알림 {row.alertCount || 0}건 · {row.reportStatus || '-'}</span></div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!rows.length ? (
                <div className="empty-student-list">
                  <strong>조회기간의 학생 관리 이력이 없습니다.</strong>
                  <span>출결, 순찰, 리포트, 플래너 기록이 저장되면 이곳에 표시됩니다.</span>
                </div>
              ) : null}
            </div>

            <aside className="content-card student-history-summary-panel">
              <div className="student-history-section-head compact">
                <div>
                  <h3>GPT 상담 요약</h3>
                  <p>구두 상담 참고용 초안을 생성합니다. 리포트 삽입용 저장/편집 기능은 제외했습니다.</p>
                </div>
              </div>
              <div className="student-history-summary-type-tabs">
                <button type="button" className={summaryMode === 'student_feedback' ? 'active' : ''} onClick={() => setSummaryModeAndLoad('student_feedback')}>학생 피드백용</button>
                <button type="button" className={summaryMode === 'parent_counseling' ? 'active' : ''} onClick={() => setSummaryModeAndLoad('parent_counseling')}>학부모 상담용</button>
              </div>
              <div className="student-history-ai-meta">
                <span>{historyData.aiConfig?.openAiConfigured ? 'GPT 사용 가능' : 'OPENAI_API_KEY 필요'}</span>
                <span>{historyData.counselingSummariesByType?.[summaryMode]?.model_name || historyData.aiConfig?.model || 'GPT 모델 미사용'}</span>
                <span>{summaryMode === 'parent_counseling' ? '완화된 표현' : '직설적 피드백'}</span>
              </div>
              <div className="student-history-summary-output">
                {summaryDraft ? summaryDraft : `${getSummaryModeLabel()} 요약을 생성하면 이곳에 표시됩니다.`}
              </div>
              <div className="student-history-ai-actions v4129">
                <button type="button" className="primary" onClick={() => generateCounselingSummary(summaryMode)} disabled={summaryLoading || !historyData}>{summaryLoading ? '처리 중...' : `${getSummaryModeLabel()} 생성`}</button>
                <button type="button" className="secondary" onClick={() => generateCounselingSummary(summaryMode)} disabled={summaryLoading || !historyData}>다시 생성</button>
                <button type="button" className="secondary" onClick={copySummary} disabled={!summaryDraft.trim()}>복사</button>
              </div>
              {summaryStatus ? <div className={`student-history-ai-status ${summaryStatus.type}`}>{summaryStatus.message}</div> : null}
              <div className="student-history-ai-note">
                <b>운영 기준</b>
                <span>학생 피드백용은 학생에게 직접 전달할 수 있는 직설적인 관리 포인트 중심입니다.</span>
                <span>학부모 상담용은 같은 내용을 완화된 표현과 개선 방향 중심으로 정리합니다.</span>
                <span>방학 순공 기준: 1주 환산 순공시간 40시간 초과는 학습량 충분, 30~40시간은 보통, 30시간 미만은 개선 필요로 GPT 요약에 반영됩니다.</span>
                <span>사용 전 Vercel 환경변수 <code>OPENAI_API_KEY</code>와 필요 시 <code>GPT_SUMMARY_MODEL</code>을 설정하세요.</span>
              </div>
              <div className="student-history-shortcuts">
                <b>관련 화면 바로가기</b>
                <div>
                  <button type="button" onClick={() => setActiveTab?.('dailyReports')}>데일리 리포트</button>
                  <button type="button" onClick={() => setActiveTab?.('weeklyReports')}>위클리 리포트</button>
                  <button type="button" onClick={() => setActiveTab?.('attention')}>관리주의 이력</button>
                  <button type="button" onClick={() => setActiveTab?.('settings')}>알림/템플릿 설정</button>
                </div>
              </div>
            </aside>
          </div>

          {historyData.warnings?.length ? (
            <div className="content-card student-history-warning-card">
              <strong>일부 자료 조회 참고사항</strong>
              {historyData.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          ) : null}
        </>
      ) : (
        <div className="content-card empty-student-list student-history-empty">
          <strong>{embedded ? '상단에서 학생을 선택하면 누적 관리 이력이 표시됩니다.' : '학생을 선택하면 관리 이력이 표시됩니다.'}</strong>
          <span>{embedded ? '출결/멘토 코멘트와 같은 조회 조건으로 상담 준비용 누적 이력을 함께 불러옵니다.' : '조회기간의 데이터를 압축해 상담 준비용 화면으로 구성합니다.'}</span>
        </div>
      )}
    </section>
  );
}



function AttentionTab({ apiFetch, students = [], scheduleAlerts = [], dismissedAlertMemos = {}, fieldFocusAcknowledgements = [], selectSeat, setActiveTab }) {
  const defaultRange = getThisWeekRange();
  const [start, setStart] = useState(defaultRange.start);
  const [end, setEnd] = useState(defaultRange.end);
  const [studentFilter, setStudentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [historyRows, setHistoryRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const activeAlerts = useMemo(() => {
    const memoIds = new Set(Object.keys(dismissedAlertMemos || {}));
    return (scheduleAlerts || [])
      .filter((alert) => alert?.mode === 'check')
      .filter((alert) => !memoIds.has(alert.id))
      .map((alert) => ({
        source: 'open',
        id: `open-${alert.id}`,
        alert_id: alert.id,
        ack_date: getKstDateString(),
        student_id: alert.student?.id || alert.schedule?.student_id || null,
        student_name: alert.student?.name || '학생',
        seat_no: alert.seatNo || alert.student?.default_seat_no || null,
        alert_type: alert.type || 'field_focus',
        alert_title: alert.title || '관리필요 확인',
        alert_body: alert.body || '',
        planned_time: alert.plannedTime || null,
        current_status: '미처리',
        memo: '',
        admin_name: '',
        dismissed_at: null,
        created_at: null,
        statusLabel: '미처리',
        statusClass: 'pending',
      }));
  }, [scheduleAlerts, dismissedAlertMemos]);

  const rows = useMemo(() => {
    const resolved = (historyRows || []).map((row) => ({
      source: 'resolved',
      ...row,
      statusLabel: '처리완료',
      statusClass: 'done',
    }));
    return [...activeAlerts, ...resolved].sort((a, b) => {
      const da = a.ack_date || '';
      const db = b.ack_date || '';
      if (da !== db) return db.localeCompare(da);
      return new Date(b.dismissed_at || b.created_at || 0) - new Date(a.dismissed_at || a.created_at || 0);
    });
  }, [activeAlerts, historyRows]);

  const filteredRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      if (studentFilter !== 'all' && String(row.student_id || '') !== String(studentFilter)) return false;
      if (statusFilter === 'open' && row.source !== 'open') return false;
      if (statusFilter === 'resolved' && row.source !== 'resolved') return false;
      if (keyword) {
        const haystack = [row.student_name, row.alert_title, row.alert_body, row.memo, row.admin_name, row.current_status, row.planned_time]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
  }, [rows, studentFilter, statusFilter, searchText]);

  const summary = useMemo(() => ({
    total: filteredRows.length,
    open: filteredRows.filter((row) => row.source === 'open').length,
    resolved: filteredRows.filter((row) => row.source === 'resolved').length,
    students: new Set(filteredRows.map((row) => row.student_id || row.student_name).filter(Boolean)).size,
  }), [filteredRows]);

  async function loadHistory(nextStart = start, nextEnd = end) {
    if (!apiFetch) return;
    setLoading(true);
    setNotice('관리주의 이력 조회 중...');
    try {
      const data = await apiFetch(`/api/field-focus-acknowledgement?start=${nextStart}&end=${nextEnd}`);
      const acknowledgements = Array.isArray(data.acknowledgements) ? data.acknowledgements : [];
      setHistoryRows(acknowledgements);
      setNotice(`${nextStart} ~ ${nextEnd} 기간의 처리완료 이력 ${acknowledgements.length}건을 조회했습니다.`);
    } catch (error) {
      setNotice(error.message || '관리주의 이력 조회에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory(start, end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPreset(type) {
    let range = getThisWeekRange();
    if (type === 'lastWeek') range = getPreviousFullWeekRange();
    if (type === 'recent4') {
      const full = getFullWeekRange();
      range = { start: addDays(full.start, -21), end: full.end };
    }
    setStart(range.start);
    setEnd(range.end);
    loadHistory(range.start, range.end);
  }

  function openDashboard(row) {
    if (row?.seat_no) selectSeat?.(Number(row.seat_no));
    setActiveTab?.('dashboard');
  }

  return (
    <section className="content-card attention-history-page">
      <div className="attention-history-header">
        <div>
          <p>실시간 관리는 메인 대시보드의 빨간 좌석과 관리 포커스에서 처리하고, 이 화면에서는 처리 이력과 현재 미처리 항목을 조회합니다.</p>
        </div>
        <div className="attention-history-mode-badge">실시간 처리: 메인 대시보드</div>
      </div>

      <div className="attention-history-toolbar">
        <div className="date-filter-grid compact">
          <label>
            <span>조회 시작일</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            <span>조회 종료일</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
          <label>
            <span>학생</span>
            <select value={studentFilter} onChange={(event) => setStudentFilter(event.target.value)}>
              <option value="all">전체 학생</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}
            </select>
          </label>
          <label>
            <span>처리상태</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">전체 상태</option>
              <option value="open">현재 미처리</option>
              <option value="resolved">처리완료</option>
            </select>
          </label>
          <label className="wide-field">
            <span>검색어</span>
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="학생명, 사유, 메모, 처리자 검색" />
          </label>
        </div>
        <div className="attention-history-actions">
          <button type="button" className="secondary" onClick={() => setPreset('thisWeek')}>이번 주</button>
          <button type="button" className="secondary" onClick={() => setPreset('lastWeek')}>지난 주</button>
          <button type="button" className="secondary" onClick={() => setPreset('recent4')}>최근 4주</button>
          <button type="button" className="primary" onClick={() => loadHistory(start, end)} disabled={loading}>{loading ? '조회 중...' : '조회'}</button>
        </div>
      </div>

      <div className="attention-history-summary">
        <div><span>필터 결과</span><strong>{summary.total}건</strong></div>
        <div><span>현재 미처리</span><strong>{summary.open}건</strong></div>
        <div><span>처리완료</span><strong>{summary.resolved}건</strong></div>
        <div><span>학생 수</span><strong>{summary.students}명</strong></div>
      </div>

      {notice ? <div className="inline-notice">{notice}</div> : null}

      <div className="attention-history-list">
        {filteredRows.map((row) => (
          <article key={`${row.source}-${row.id || row.alert_id}`} className={`attention-history-card ${row.statusClass || ''}`}>
            <div className="attention-history-card-main">
              <div className="attention-history-topline">
                <strong>{row.student_name || '학생'}</strong>
                <span className={`status-pill ${row.statusClass || 'neutral'}`}>{row.statusLabel}</span>
              </div>
              <h3>{row.alert_title || '관리필요 확인'}</h3>
              <p>{row.alert_body || '상세 사유 없음'}</p>
              <div className="attention-history-meta">
                <span>{formatAttendanceDate(row.ack_date)}</span>
                <span>좌석 {row.seat_no ? String(row.seat_no).padStart(2, '0') : '-'}</span>
                <span>예정 {row.planned_time || '-'}</span>
                <span>상태 {row.current_status || '-'}</span>
              </div>
            </div>
            <div className="attention-history-side">
              {row.source === 'resolved' ? (
                <>
                  <div className="history-memo-box">
                    <span>확인 메모</span>
                    <strong>{row.memo || '메모 없음'}</strong>
                  </div>
                  <div className="history-handler">{row.admin_name || '관리자'} · {formatKstTime(row.dismissed_at || row.updated_at || row.created_at)}</div>
                </>
              ) : (
                <div className="history-memo-box pending">
                  <span>처리 위치</span>
                  <strong>대시보드 관리 포커스</strong>
                </div>
              )}
              <button type="button" className="secondary" onClick={() => openDashboard(row)}>{row.source === 'open' ? '대시보드에서 처리' : '좌석 보기'}</button>
            </div>
          </article>
        ))}
      </div>

      {!filteredRows.length ? (
        <div className="empty-student-list attention-history-empty">
          <strong>조회 조건에 맞는 관리주의 이력이 없습니다.</strong>
          <span>기간이나 필터를 변경해 보세요. 현재 실시간 관리주의 항목은 메인 대시보드에서 바로 처리할 수 있습니다.</span>
        </div>
      ) : null}
    </section>
  );
}


function ReportActivityPanel({ title, logs = [], loading = false, onRefresh, onRetry, reportType = 'daily' }) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [retryingId, setRetryingId] = useState(null);

  const logsByStatus = {
    all: logs,
    done: logs.filter((log) => {
      const label = getReportActivityStatus(log).label;
      return label === '발송완료' || label === '수동 발송완료';
    }),
    partial: logs.filter((log) => getReportActivityStatus(log).label === '부분 성공'),
    pending: logs.filter((log) => ['발송대기', '발송요청 접수'].includes(getReportActivityStatus(log).label)),
    failed: logs.filter((log) => getReportActivityStatus(log).label === '발송실패'),
    test: logs.filter((log) => ['테스트 대체', '연결테스트'].includes(getReportActivityStatus(log).label)),
  };

  const filteredLogs = logsByStatus[statusFilter] || logs;
  const visibleLogs = open ? filteredLogs : filteredLogs.slice(0, 8);

  const summaryCards = [
    ['all', '전체 로그', logsByStatus.all.length, 'neutral'],
    ['done', '성공', logsByStatus.done.length, 'done'],
    ['partial', '부분 성공', logsByStatus.partial.length, 'partial'],
    ['pending', '접수/대기', logsByStatus.pending.length, 'pending'],
    ['failed', '실패', logsByStatus.failed.length, 'failed'],
    ['test', '테스트/진단', logsByStatus.test.length, 'test'],
  ];

  function changeStatusFilter(nextStatus) {
    setStatusFilter(nextStatus);
    setOpen(false);
  }

  async function retryLog(log) {
    if (!onRetry || !canRetryReportActivity(log)) return;
    const status = getReportActivityStatus(log).label;
    const ok = confirm(`${log.target_name || '해당 리포트'}의 ${status} 기록을 기준으로 다시 발송할까요?\n\n중복 수신 방지를 위해 실제 실패 수신자 여부와 SOLAPI 내역을 함께 확인한 뒤 진행하세요.`);
    if (!ok) return;
    try {
      setRetryingId(log.id);
      await onRetry(log);
      if (onRefresh) await onRefresh();
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <section className="report-activity-panel clean-panel delivery-tracking-panel">
      <div className="report-activity-head">
        <div>
          <strong>{title}</strong>
          <span>최근 48시간 리포트 발송 흐름입니다. 보호자별 결과와 실패 사유를 확인하고 실패 건만 재발송 판단에 활용하세요.</span>
        </div>
        <div className="report-activity-actions">
          <span className="report-activity-count">표시 {filteredLogs.length} / 전체 {logs.length}</span>
          <button className="secondary" onClick={onRefresh} disabled={loading}>{loading ? '조회 중...' : '새로고침'}</button>
        </div>
      </div>

      <div className="report-activity-summary interactive delivery-summary-grid">
        {summaryCards.map(([key, label, count, tone]) => (
          <button
            key={key}
            type="button"
            className={`report-activity-stat ${tone} ${statusFilter === key ? 'active' : ''}`}
            onClick={() => changeStatusFilter(key)}
          >
            <span>{label}</span>
            <strong>{count}</strong>
          </button>
        ))}
      </div>

      {filteredLogs.length ? (
        <div className="report-activity-list">
          {visibleLogs.map((log) => {
            const status = getReportActivityStatus(log);
            const payload = log.payload || {};
            const recipientRows = getReportActivityRecipientRows(log);
            const recipientStats = getReportActivityRecipientStats(log);
            const retryAvailable = Boolean(onRetry && canRetryReportActivity(log));
            return (
              <details key={log.id} className={`report-activity-row delivery-row ${status.className}`}>
                <summary>
                  <div>
                    <strong>{getActionLogLabel(log.action_type)}</strong>
                    <span>{getReportActivitySummary(log)}</span>
                  </div>
                  <em className={`status-pill ${status.className}`}>{status.label}</em>
                </summary>
                <div className="report-activity-detail delivery-detail-grid">
                  <div><span>작업자</span><strong>{log.actor_name || '-'}</strong></div>
                  <div><span>대상</span><strong>{log.target_name || '-'}</strong></div>
                  <div><span>시간</span><strong>{formatKstTimeWithSeconds(log.created_at)}</strong></div>
                  <div><span>원본 작업</span><strong>{log.action_type || '-'}</strong></div>
                  <div><span>Provider</span><strong>{payload.provider || payload.providerMode || '-'}</strong></div>
                  <div><span>Provider 상태</span><strong>{payload.providerStatus || payload.status || '-'}</strong></div>
                  <div><span>Request ID</span><strong>{payload.requestId || '-'}</strong></div>
                  <div><span>Error Code</span><strong>{payload.errorCode || '-'}</strong></div>
                </div>

                <div className="delivery-recipient-summary">
                  <div><span>전체 수신</span><strong>{recipientStats.total || recipientRows.length || 0}명</strong></div>
                  <div><span>성공/접수</span><strong>{recipientStats.successLike ?? ((recipientStats.sent || 0) + (recipientStats.received || 0))}명</strong></div>
                  <div><span>실패</span><strong>{recipientStats.failed || 0}명</strong></div>
                  <div><span>정책</span><strong>{payload.recipientPolicy?.mode || payload.recipientPolicy?.modeLabel || '-'}</strong></div>
                </div>

                {recipientRows.length ? (
                  <div className="delivery-recipient-list">
                    {recipientRows.map((row, index) => {
                      const rowStatus = getDeliveryStatusLabel(row.status);
                      return (
                        <div key={`${log.id}-${row.phone || index}`} className={`delivery-recipient-row ${rowStatus.className}`}>
                          <div>
                            <strong>{row.relationship || row.name || `수신자 ${index + 1}`}</strong>
                            <span>{maskPhoneForDisplay(row.phone)}</span>
                          </div>
                          <em className={`status-pill ${rowStatus.className}`}>{rowStatus.label}</em>
                          <small>{row.errorMessage || row.providerStatus || row.messageId || '상세 사유 없음'}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="delivery-empty-note">보호자별 상세 결과가 없는 과거 로그입니다. SOLAPI 발송 내역과 함께 확인하세요.</div>
                )}

                {payload.errorMessage || payload.reason || payload.message ? (
                  <div className="delivery-error-note">
                    <strong>확인 메시지</strong>
                    <span>{payload.errorMessage || payload.reason || payload.message}</span>
                  </div>
                ) : null}

                {retryAvailable ? (
                  <div className="delivery-retry-actions">
                    <button className="secondary" onClick={() => retryLog(log)} disabled={retryingId === log.id}>
                      {retryingId === log.id ? '재발송 중...' : `${reportType === 'weekly' ? '위클리' : '데일리'} 실패 건 재발송`}
                    </button>
                    <span>실패 수신자만 따로 저장하는 전용 테이블은 아직 없으므로, 재발송 전 SOLAPI 내역에서 중복 수신 가능성을 확인하세요.</span>
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      ) : (
        <div className="all-clear">{statusFilter === 'all' ? '최근 48시간 내 리포트 발송/저장 관련 기록이 없습니다.' : '선택한 상태의 발송 이력이 없습니다.'}</div>
      )}

      {filteredLogs.length > 8 ? (
        <button className="secondary report-activity-more" onClick={() => setOpen(!open)}>{open ? '간단히 보기' : `전체 ${filteredLogs.length}건 보기`}</button>
      ) : null}
    </section>
  );
}

function ReportSendStatusBanner({ sendConfig, reportType = 'daily' }) {
  const dailyConnected = Boolean(sendConfig?.daily?.configured);
  const weeklyConnected = Boolean(sendConfig?.weekly?.configured);
  const connected = reportType === 'weekly' ? weeklyConnected : dailyConnected;
  const envName = reportType === 'weekly'
    ? (sendConfig?.weekly?.envName || 'WEEKLY_REPORT_SEND_WEBHOOK_URL')
    : (sendConfig?.daily?.envName || 'REPORT_SEND_WEBHOOK_URL');
  const safety = getReportSendSafetySummary(sendConfig);
  const reportLabel = reportType === 'weekly' ? '위클리 리포트' : '데일리 리포트';

  return (
    <div className={`send-config-banner ${connected ? 'connected' : 'pending'} safety-${safety.className || 'safe'}`}>
      <div>
        <strong>{reportLabel} 발송 상태: {safety.title}</strong>
        <span>{connected ? safety.description : `${envName}이 아직 설정되지 않아 발송대기 상태까지만 저장됩니다.`}</span>
        <small>
          Provider: {safety.providerMode} · Fail-safe: {safety.failSafe ? 'ON' : 'OFF'} · 테스트 번호: {safety.testMode ? 'ON' : 'OFF'} · Allowlist: {safety.allowlistCount ? `${safety.allowlistCount}개` : '미사용'}
        </small>
      </div>
      <em>{safety.badge}</em>
    </div>
  );
}


function MentoringBaseSettingsTab({ students = [], apiFetch, setMessage, defaultSchedule = DEFAULT_SCHEDULE_SETTINGS, onMentoringChanged }) {
  const [mentors, setMentors] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [mentorStudentLinks, setMentorStudentLinks] = useState([]);
  const [mentorStudentEditorId, setMentorStudentEditorId] = useState('');
  const [mentorStudentDrafts, setMentorStudentDrafts] = useState({});
  const [mentorEdits, setMentorEdits] = useState({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const activeStudents = useMemo(() => (students || []).filter((student) => (student.status || 'active') === 'active').sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko')), [students]);
  const activeMentors = useMemo(() => (mentors || []).filter((mentor) => mentor.is_active !== false).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.mentor_name || '').localeCompare(String(b.mentor_name || ''), 'ko')), [mentors]);
  const mentoringDefaultSlotOptions = useMemo(() => buildDefaultMentoringSlotOptions(defaultSchedule), [defaultSchedule]);

  const assignmentsByMentor = useMemo(() => {
    const grouped = {};
    for (const item of assignments || []) {
      if (!item.mentor_id) continue;
      grouped[item.mentor_id] = (grouped[item.mentor_id] || 0) + 1;
    }
    return grouped;
  }, [assignments]);

  const mentorStudentIdsByMentor = useMemo(() => {
    const grouped = {};
    for (const link of mentorStudentLinks || []) {
      if (!link.mentor_id || !link.student_id || link.is_active === false) continue;
      const mentorId = String(link.mentor_id);
      if (!grouped[mentorId]) grouped[mentorId] = new Set();
      grouped[mentorId].add(String(link.student_id));
    }
    return grouped;
  }, [mentorStudentLinks]);

  const mentorIdByResponsibleStudent = useMemo(() => {
    const map = {};
    for (const link of mentorStudentLinks || []) {
      if (link.is_active === false || !link.student_id || !link.mentor_id) continue;
      map[String(link.student_id)] = String(link.mentor_id);
    }
    return map;
  }, [mentorStudentLinks]);

  const effectiveMentorStudentEditorId = mentorStudentEditorId || activeMentors[0]?.id || '';
  const selectedMentorForStudentConfig = activeMentors.find((mentor) => String(mentor.id) === String(effectiveMentorStudentEditorId)) || null;

  useEffect(() => {
    loadMentoringSettings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mentorStudentEditorId && activeMentors.length) setMentorStudentEditorId(activeMentors[0].id);
  }, [mentorStudentEditorId, activeMentors]);

  function applyMentoringData(data = {}) {
    setMentors(data.mentors || []);
    setAssignments(data.assignments || []);
    setMentorStudentLinks(data.mentorStudentLinks || []);
    if (data.warning) setNotice(data.warning);
  }

  async function loadMentoringSettings() {
    try {
      setLoading(true);
      const params = new URLSearchParams({ date: getKstDateString() });
      const data = await apiFetch(`/api/mentoring?${params.toString()}`);
      applyMentoringData(data);
      setNotice(data.warning || '멘토링 기본 설정을 불러왔습니다.');
    } catch (error) {
      setNotice(error.message || '멘토링 기본 설정을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function refreshAfterChange() {
    try { await onMentoringChanged?.(); } catch {}
  }

  function getMentorStudentDraftIds(mentorId = effectiveMentorStudentEditorId) {
    if (!mentorId) return [];
    const draft = mentorStudentDrafts[String(mentorId)];
    if (Array.isArray(draft)) return draft.map(String);
    return Array.from(mentorStudentIdsByMentor[String(mentorId)] || []);
  }

  const mentorStudentDraftIds = getMentorStudentDraftIds(effectiveMentorStudentEditorId);
  const mentorStudentDraftSet = new Set(mentorStudentDraftIds.map(String));

  function toggleMentorStudentDraft(studentId) {
    if (!effectiveMentorStudentEditorId) return;
    setMentorStudentDrafts((prev) => {
      const mentorId = String(effectiveMentorStudentEditorId);
      const next = new Set((Array.isArray(prev[mentorId]) ? prev[mentorId] : getMentorStudentDraftIds(mentorId)).map(String));
      const key = String(studentId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [mentorId]: Array.from(next) };
    });
  }

  function resetMentorStudentDraft() {
    if (!effectiveMentorStudentEditorId) return;
    setMentorStudentDrafts((prev) => {
      const next = { ...prev };
      delete next[String(effectiveMentorStudentEditorId)];
      return next;
    });
  }

  async function saveMentor(mentor) {
    const draft = mentorEdits[mentor.id] || {};
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({
          action: 'saveMentor',
          id: mentor.id,
          mentorCode: mentor.mentor_code,
          mentorName: draft.mentorName ?? mentor.mentor_name,
          capacityTarget: draft.capacityTarget ?? mentor.capacity_target,
          sortOrder: mentor.sort_order,
          isActive: mentor.is_active,
          scheduleDate: getKstDateString(),
        }),
      });
      applyMentoringData(data);
      setMentorEdits((prev) => ({ ...prev, [mentor.id]: {} }));
      setNotice('멘토 정보를 저장했습니다.');
      setMessage?.('멘토링 멘토 기본 설정을 저장했습니다.');
      await refreshAfterChange();
    } catch (error) {
      setNotice(error.message || '멘토 저장 실패');
    } finally {
      setLoading(false);
    }
  }

  async function seedDefaults() {
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', { method: 'POST', body: JSON.stringify({ action: 'seedDefaults', scheduleDate: getKstDateString() }) });
      applyMentoringData(data);
      setNotice('설정 탭의 기본 시간표를 기준으로 월/수/금 1~8차시 멘토링 차시와 멘토 2명을 세팅/동기화했습니다. 화/목은 필요한 경우 요일별 템플릿에서 임시 차시를 추가할 수 있습니다.');
      setMessage?.('멘토링 1~8차시 기본 세팅 동기화 완료');
      await refreshAfterChange();
    } catch (error) {
      setNotice(error.message || '기본 세팅 실패');
    } finally {
      setLoading(false);
    }
  }

  async function saveMentorStudentSettings() {
    const mentorId = effectiveMentorStudentEditorId;
    if (!mentorId) {
      setNotice('담당학생을 설정할 멘토를 먼저 선택하세요.');
      return;
    }
    const studentIds = getMentorStudentDraftIds(mentorId);
    try {
      setLoading(true);
      const data = await apiFetch('/api/mentoring', {
        method: 'POST',
        body: JSON.stringify({ action: 'saveMentorStudents', mentorId, studentIds, scheduleDate: getKstDateString() }),
      });
      applyMentoringData(data);
      setMentorStudentDrafts((prev) => ({ ...prev, [String(mentorId)]: studentIds }));
      setNotice(`담당학생 ${studentIds.length}명을 저장했습니다.`);
      setMessage?.('멘토별 담당학생 설정을 저장했습니다.');
      await refreshAfterChange();
    } catch (error) {
      setNotice(error.message || '담당학생 설정 저장 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="content-card mentoring-settings-page">
      <div className="section-head mentoring-hero">
        <div>
          <h2>설정 · 멘토링 기본 설정</h2>
          <p>초기에 한 번 잡아두는 멘토명, 담당학생 목표, 멘토별 담당학생, 기본 시간표 기준 1~8차시 세팅을 이곳에서 관리합니다.</p>
        </div>
        <button type="button" className="secondary" onClick={seedDefaults} disabled={loading}>기본 시간표 기준 1~8차시 동기화</button>
      </div>

      <div className="mentoring-summary-grid">
        {activeMentors.map((mentor) => {
          const assigned = assignmentsByMentor[mentor.id] || 0;
          const responsibleCount = mentorStudentIdsByMentor[String(mentor.id)]?.size || 0;
          const draft = mentorEdits[mentor.id] || {};
          return (
            <div key={mentor.id} className={`mentoring-mentor-card ${String(effectiveMentorStudentEditorId) === String(mentor.id) ? 'active-config' : ''}`}>
              <div>
                <strong>{mentor.mentor_name}</strong>
                <span>담당 {responsibleCount}/{mentor.capacity_target || 13}명 · 시간표 배정 {assigned}건</span>
              </div>
              <div className="mentor-edit-row">
                <input value={draft.mentorName ?? mentor.mentor_name ?? ''} onChange={(event) => setMentorEdits((prev) => ({ ...prev, [mentor.id]: { ...(prev[mentor.id] || {}), mentorName: event.target.value } }))} />
                <input type="number" min="1" max="40" value={draft.capacityTarget ?? mentor.capacity_target ?? 13} onChange={(event) => setMentorEdits((prev) => ({ ...prev, [mentor.id]: { ...(prev[mentor.id] || {}), capacityTarget: event.target.value } }))} />
                <button type="button" className="secondary" onClick={() => saveMentor(mentor)} disabled={loading}>저장</button>
              </div>
              <button type="button" className="text-mini-button" onClick={() => setMentorStudentEditorId(mentor.id)}>담당학생 설정</button>
            </div>
          );
        })}
        <div className="mentoring-mentor-card mentoring-policy-card">
          <strong>운영 기준</strong>
          <span>기본 요일: 월·수·금</span>
          <span>임시 추가: 화·목 가능</span>
          <span>차시: 기본 시간표의 1~8차시</span>
          <span>{mentoringDefaultSlotOptions[0]?.startTime || '09:00'}~{mentoringDefaultSlotOptions.at(-1)?.endTime || '17:50'} 기준</span>
          <span>차시당 권장: 3~4명</span>
          <span>요일 템플릿 → 날짜별 일정 자동 반영</span>
          <span>당일 변경: 날짜별 화면에서 수정</span>
          <span>좌석표 표시: 차시 시작 10분 전~차시 종료</span>
        </div>
      </div>

      {selectedMentorForStudentConfig ? (
        <div className="mentoring-responsibility-panel">
          <div className="mentoring-responsibility-head">
            <div>
              <h3>멘토별 담당학생 설정</h3>
              <p>관리자가 사전에 멘토별 13명 내외의 담당학생을 지정합니다. 이 설정은 멘토링 시간표의 학생 배정 영역에서 담당/비담당 색상 구분과 정렬 기준으로 사용됩니다.</p>
            </div>
            <div className="mentoring-responsibility-control">
              <select value={effectiveMentorStudentEditorId} onChange={(event) => setMentorStudentEditorId(event.target.value)}>
                {activeMentors.map((mentor) => <option key={mentor.id} value={mentor.id}>{mentor.mentor_name}</option>)}
              </select>
              <span>선택 {mentorStudentDraftIds.length}/{selectedMentorForStudentConfig.capacity_target || 13}명</span>
            </div>
          </div>
          <div className="mentoring-responsibility-picker">
            {activeStudents.map((student) => {
              const checked = mentorStudentDraftSet.has(String(student.id));
              const currentMentorId = mentorIdByResponsibleStudent[String(student.id)];
              const assignedOtherMentor = currentMentorId && String(currentMentorId) !== String(effectiveMentorStudentEditorId);
              const otherMentor = activeMentors.find((mentor) => String(mentor.id) === String(currentMentorId));
              return (
                <button key={student.id} type="button" className={`mentoring-responsibility-chip ${checked ? 'selected' : ''} ${assignedOtherMentor && !checked ? 'other-mentor' : ''}`} onClick={() => toggleMentorStudentDraft(student.id)}>
                  <strong>{student.name}</strong>
                  <span>{student.school || student.grade || '학생'}{assignedOtherMentor && !checked ? ` · ${otherMentor?.mentor_name || '다른 멘토'} 담당` : checked ? ' · 담당' : ''}</span>
                </button>
              );
            })}
          </div>
          <div className="mentoring-responsibility-actions">
            <button type="button" className="primary" onClick={saveMentorStudentSettings} disabled={loading}>담당학생 저장</button>
            <button type="button" className="secondary" onClick={resetMentorStudentDraft} disabled={loading}>저장값으로 되돌리기</button>
            <span>{selectedMentorForStudentConfig.mentor_name} 기준으로 흰색 카드는 담당학생, 회색 카드는 비담당학생입니다.</span>
          </div>
        </div>
      ) : (
        <div className="empty-student-list">
          <strong>멘토 정보가 없습니다.</strong>
          <span>기본 시간표 기준 1~8차시 동기화를 먼저 실행하면 기본 멘토 2명이 생성됩니다.</span>
        </div>
      )}

      {notice ? <div className="form-notice mentoring-notice">{notice}</div> : null}
    </section>
  );
}

function SettingsTab({
  settingsView, setSettingsView, students, seatsForDisplay, openStudentEditor, diagnostics, loading, runCheck, cleanup,
  operatingRules, rulesDraft, setRulesDraft, saveOperatingRules, rulesLoading, defaultSchedule, defaultScheduleConfig, defaultScheduleConfigDraft, setDefaultScheduleConfigDraft, saveDefaultSchedule, defaultScheduleLoading, bulkGenerateSchedules, scheduleCoverage, apiFetch, setMessage, currentUser, canUseUserManagement, sendConfig, loadSendConfig, onMentoringChanged,
}) {
  useEffect(() => {
    if (settingsView === 'users' && !canUseUserManagement) setSettingsView('students');
  }, [settingsView, canUseUserManagement, setSettingsView]);
  return (
    <section className="settings-shell settings-structured-shell">
      <div className="settings-tabs clean-panel">
        <button className={settingsView === 'students' ? 'active' : ''} onClick={() => setSettingsView('students')}>학생 관리</button>
        {canUseUserManagement ? <button className={settingsView === 'users' ? 'active' : ''} onClick={() => setSettingsView('users')}>유저 관리</button> : null}
        <button className={settingsView === 'integrity' ? 'active' : ''} onClick={() => setSettingsView('integrity')}>좌석 데이터 점검</button>
        <button className={settingsView === 'system' ? 'active' : ''} onClick={() => setSettingsView('system')}>시스템 점검</button>
        <button className={settingsView === 'send' ? 'active' : ''} onClick={() => setSettingsView('send')}>리포트 발송 설정</button>
        <button className={settingsView === 'alimtalkTemplates' ? 'active' : ''} onClick={() => setSettingsView('alimtalkTemplates')}>알림톡 템플릿 관리</button>
        <button className={settingsView === 'attendanceNotifications' ? 'active' : ''} onClick={() => setSettingsView('attendanceNotifications')}>출결 알림 로그</button>
        <button className={settingsView === 'rules' ? 'active' : ''} onClick={() => setSettingsView('rules')}>운영 기준 설정</button>
        <button className={settingsView === 'defaultSchedule' ? 'active' : ''} onClick={() => setSettingsView('defaultSchedule')}>기본 시간표 설정</button>
        <button className={settingsView === 'mentoring' ? 'active' : ''} onClick={() => setSettingsView('mentoring')}>멘토링 기본 설정</button>
        <button className={settingsView === 'kioskBridge' ? 'active' : ''} onClick={() => setSettingsView('kioskBridge')}>키오스크 브릿지</button>
      </div>

      {settingsView === 'students' ? (
        <StudentsTab students={students} seatsForDisplay={seatsForDisplay} openStudentEditor={openStudentEditor} />
      ) : null}

      {settingsView === 'users' && canUseUserManagement ? (
        <UserManagementTab apiFetch={apiFetch} setMessage={setMessage} />
      ) : null}

      {settingsView === 'integrity' ? (
        <SeatIntegrityTab diagnostics={diagnostics} loading={loading} runCheck={runCheck} cleanup={cleanup} />
      ) : null}

      {settingsView === 'system' ? (
        <SystemCheckTab students={students} seatsForDisplay={seatsForDisplay} diagnostics={diagnostics} />
      ) : null}

      {settingsView === 'send' ? (
        <ReportSendSettingsTab
          sendConfig={sendConfig}
          apiFetch={apiFetch}
          setMessage={setMessage}
          loadSendConfig={loadSendConfig}
        />
      ) : null}

      {settingsView === 'alimtalkTemplates' ? (
        <AlimtalkTemplateConsole
          sendConfig={sendConfig}
          apiFetch={apiFetch}
          setMessage={setMessage}
          loadSendConfig={loadSendConfig}
        />
      ) : null}

      {settingsView === 'attendanceNotifications' ? (
        <AttendanceNotificationLogsTab
          apiFetch={apiFetch}
          setMessage={setMessage}
          sendConfig={sendConfig}
        />
      ) : null}

      {settingsView === 'rules' ? (
        <OperatingRulesTab
          operatingRules={operatingRules}
          rulesDraft={rulesDraft}
          setRulesDraft={setRulesDraft}
          saveOperatingRules={saveOperatingRules}
          rulesLoading={rulesLoading}
        />
      ) : null}

      {settingsView === 'defaultSchedule' ? (
        <DefaultScheduleSettingsTab
          defaultScheduleConfig={defaultScheduleConfig}
          defaultScheduleConfigDraft={defaultScheduleConfigDraft}
          setDefaultScheduleConfigDraft={setDefaultScheduleConfigDraft}
          saveDefaultSchedule={saveDefaultSchedule}
          defaultScheduleLoading={defaultScheduleLoading}
          students={students}
          bulkGenerateSchedules={bulkGenerateSchedules}
          scheduleCoverage={scheduleCoverage}
        />
      ) : null}

      {settingsView === 'mentoring' ? (
        <MentoringBaseSettingsTab
          students={students}
          apiFetch={apiFetch}
          setMessage={setMessage}
          defaultSchedule={defaultScheduleConfig?.variants?.weekday || defaultSchedule}
          onMentoringChanged={onMentoringChanged}
        />
      ) : null}

      {settingsView === 'kioskBridge' ? (
        <KioskBridgeSettingsTab
          apiFetch={apiFetch}
          setMessage={setMessage}
        />
      ) : null}
    </section>
  );
}

function UserManagementTab({ apiFetch, setMessage }) {
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [userSubTab, setUserSubTab] = useState('users');
  const [logFilters, setLogFilters] = useState({
    actionType: 'all',
    actor: 'all',
    keyword: '',
  });
  const [draft, setDraft] = useState({
    username: '',
    displayName: '',
    email: '',
    phone: '',
    role: 'user',
    status: 'pending',
    memo: '',
  });

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    try {
      setLoading(true);
      const data = await apiFetch('/api/app-users');
      setUsers(data.users || []);
      setLogs(data.logs || []);
    } catch (error) {
      setMessage?.(error.message || '유저 목록을 불러오지 못했습니다. v40-59 SQL 실행 여부를 확인하세요.');
    } finally {
      setLoading(false);
    }
  }

  function getPermissions(user) {
    return { ...makeDefaultPermissions(user.role), ...(user.permissions || {}) };
  }

  function updateUserLocal(userId, patch) {
    setUsers((prev) => prev.map((user) => user.id === userId ? { ...user, ...patch } : user));
  }

  async function saveUser(user, patch = {}) {
    try {
      const payload = {
        action: 'update',
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        permissions: getPermissions(user),
        memo: user.memo,
        ...patch,
      };
      const data = await apiFetch('/api/app-users', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setUsers(data.users || []);
      setLogs(data.logs || []);
      setMessage?.('유저 정보 저장 완료');
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  async function createUser() {
    if (!draft.username.trim() || !draft.displayName.trim()) {
      alert('아이디와 이름을 입력하세요.');
      return;
    }

    try {
      const data = await apiFetch('/api/app-users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create',
          ...draft,
          permissions: makeDefaultPermissions(draft.role),
        }),
      });
      setUsers(data.users || []);
      setLogs(data.logs || []);
      setDraft({ username: '', displayName: '', email: '', phone: '', role: 'user', status: 'pending', memo: '' });
      setMessage?.('유저 계정 기반 정보 생성 완료');
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  async function setTemporaryPassword(user) {
    const password = prompt(`${user.display_name || user.username} 계정의 임시 비밀번호를 입력하세요.\n8자 이상으로 설정하세요.`);
    if (!password) return;
    if (password.length < 8) {
      alert('임시 비밀번호는 8자 이상으로 입력하세요.');
      return;
    }

    try {
      const data = await apiFetch('/api/app-users', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_password',
          id: user.id,
          password,
          requirePasswordChange: true,
        }),
      });
      setUsers(data.users || []);
      setLogs(data.logs || []);
      setMessage?.('임시 비밀번호 설정 완료');
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  const pendingUsers = users.filter((user) => user.status === 'pending');
  const managedUsers = users.filter((user) => user.status !== 'pending');
  const superAdmins = users.filter((user) => user.role === 'super_admin');
  const resetRequestUsers = users.filter((user) => user.password_reset_requested_at);

  const actionTypes = [...new Set((logs || []).map((log) => log.action_type).filter(Boolean))];
  const actors = [...new Set((logs || []).map((log) => log.actor_name).filter(Boolean))];

  const filteredLogs = (logs || []).filter((log) => {
    if (logFilters.actionType !== 'all' && log.action_type !== logFilters.actionType) return false;
    if (logFilters.actor !== 'all' && log.actor_name !== logFilters.actor) return false;

    const keyword = logFilters.keyword.trim().toLowerCase();
    if (!keyword) return true;

    const payloadText = (() => {
      try { return JSON.stringify(log.payload || {}); } catch { return ''; }
    })();

    return [
      log.action_type,
      getActionLogLabel(log.action_type),
      log.actor_name,
      log.target_name,
      log.target_type,
      payloadText,
    ].some((value) => String(value || '').toLowerCase().includes(keyword));
  });

  const todayLogCount = (logs || []).filter((log) => String(log.created_at || '').slice(0, 10) === getKstDateString()).length;
  const reportLogCount = (logs || []).filter((log) => String(log.action_type || '').includes('report')).length;
  const accountLogCount = (logs || []).filter((log) => String(log.action_type || '').startsWith('user.')).length;

  function renderUserAdminCard(user) {
    const permissions = getPermissions(user);
    return (
      <article key={user.id} className={`user-admin-card ${user.status}`}>
        <div className="user-admin-head">
          <div>
            <strong>{user.display_name || user.username}</strong>
            <span>{user.username} · {user.email || '이메일 미입력'} · {user.password_set_at ? '비밀번호 설정됨' : '비밀번호 미설정'}{user.password_reset_requested_at ? ' · 재설정 요청 있음' : ''}</span>
          </div>
          <span className={`status-pill ${user.status === 'active' ? 'done' : user.status === 'rejected' ? 'failed' : 'neutral'}`}>{USER_STATUS_LABELS[user.status] || user.status}</span>
        </div>

        <div className="user-admin-controls">
          <label>역할<select value={user.role} onChange={(e) => updateUserLocal(user.id, { role: e.target.value, permissions: makeDefaultPermissions(e.target.value) })}><option value="user">일반유저</option><option value="super_admin">총괄관리자</option></select></label>
          <label>상태<select value={user.status} onChange={(e) => updateUserLocal(user.id, { status: e.target.value })}><option value="active">활성</option><option value="paused">일시정지</option><option value="inactive">비활성</option><option value="rejected">거절</option><option value="pending">승인 대기</option></select></label>
        </div>

        <div className="permission-chip-grid">
          {USER_PERMISSION_TABS.map(([key, label]) => (
            <label key={key} className={permissions[key] ? 'checked' : ''}>
              <input
                type="checkbox"
                checked={Boolean(permissions[key])}
                onChange={(e) => updateUserLocal(user.id, {
                  permissions: { ...permissions, [key]: e.target.checked },
                })}
              />
              {label}
            </label>
          ))}
          <label className={permissions.settings ? 'checked admin-only' : 'admin-only'}>
            <input
              type="checkbox"
              checked={Boolean(permissions.settings)}
              onChange={(e) => updateUserLocal(user.id, {
                permissions: { ...permissions, settings: e.target.checked, userManagement: e.target.checked ? permissions.userManagement : false },
              })}
            />
            설정 접근
          </label>
          <label className={permissions.userManagement ? 'checked admin-only' : 'admin-only'}>
            <input
              type="checkbox"
              checked={Boolean(permissions.userManagement)}
              onChange={(e) => updateUserLocal(user.id, {
                permissions: { ...permissions, userManagement: e.target.checked, settings: e.target.checked ? true : permissions.settings },
              })}
            />
            유저 관리
          </label>
        </div>

        <div className="field">
          <label>관리 메모</label>
          <input value={user.memo || ''} onChange={(e) => updateUserLocal(user.id, { memo: e.target.value })} placeholder="관리자 메모" />
        </div>

        <div className="user-admin-actions">
          <button className="primary" onClick={() => saveUser(user)}>저장</button>
          <button className="secondary" onClick={() => setTemporaryPassword(user)}>임시 비번</button>
          <button className="secondary" onClick={() => saveUser(user, { status: user.status === 'active' ? 'inactive' : 'active' })}>{user.status === 'active' ? '비활성화' : '활성화'}</button>
        </div>
      </article>
    );
  }

  return (
    <section className="content-card user-management-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 유저 관리</h2>
          <p>개인 계정 전환을 위한 유저/권한 기반입니다. 작업 로그는 최근 48시간만 보관하고 이후 자동 정리됩니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action compact-admin-action" onClick={loadUsers} disabled={loading}>{loading ? '불러오는 중...' : '새로고침'}</button>
        </div>
      </div>

      <div className="integrity-summary-grid">
        <div><span>전체 유저</span><strong>{users.length}</strong></div>
        <div><span>승인 대기</span><strong>{pendingUsers.length}</strong></div>
        <div><span>총괄관리자</span><strong>{superAdmins.length}</strong></div>
        <div><span>활성</span><strong>{users.filter((user) => user.status === 'active').length}</strong></div>
        <div><span>재설정 요청</span><strong>{resetRequestUsers.length}</strong></div>
        <div><span>48시간 로그</span><strong>{logs.length}</strong></div>
      </div>

      <div className="user-sub-tabs">
        <button className={userSubTab === 'users' ? 'active' : ''} onClick={() => setUserSubTab('users')}>유저 목록 <span>{managedUsers.length}</span></button>
        <button className={userSubTab === 'pending' ? 'active' : ''} onClick={() => setUserSubTab('pending')}>승인 대기 <span>{pendingUsers.length}</span></button>
        <button className={userSubTab === 'logs' ? 'active' : ''} onClick={() => setUserSubTab('logs')}>작업 로그 <span>{logs.length}</span></button>
      </div>

      {userSubTab === 'users' ? (
        <>
          <section className="user-management-card">
            <h3>관리자 직접 유저 추가</h3>
            <div className="user-form-grid">
              <div className="field"><label>아이디</label><input value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} placeholder="예: teacher01" /></div>
              <div className="field"><label>이름</label><input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder="예: 김OO 선생님" /></div>
              <div className="field"><label>이메일</label><input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="비밀번호 찾기용 이메일" /></div>
              <div className="field"><label>휴대폰</label><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="010-0000-0000" /></div>
              <div className="field"><label>역할</label><select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}><option value="user">일반유저</option><option value="super_admin">총괄관리자</option></select></div>
              <div className="field"><label>상태</label><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}><option value="pending">승인 대기</option><option value="active">활성</option><option value="paused">일시정지</option><option value="inactive">비활성</option></select></div>
              <div className="field full"><label>관리 메모</label><input value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} placeholder="예: 중등부 담당 / 데일리 리포트 발송 가능" /></div>
            </div>
            <button className="primary" onClick={createUser}>유저 정보 추가</button>
            <div className="hint">로그인 화면의 계정 생성 신청으로 들어온 유저는 승인 대기 탭에 표시됩니다. v40-62부터 체크한 페이지 권한이 실제 메뉴 접근에 적용됩니다.</div>
          </section>

          <section className="user-management-card">
            <h3>유저 권한 관리</h3>
            <div className="user-list-grid">
              {managedUsers.length ? managedUsers.map(renderUserAdminCard) : <div className="all-clear">등록된 활성/비활성 유저가 없습니다.</div>}
            </div>
          </section>
        </>
      ) : null}

      {userSubTab === 'pending' ? (
        <section className="user-management-card">
          <h3>승인 대기</h3>
          <div className="pending-user-list">
            {pendingUsers.length ? pendingUsers.map((user) => (
              <div key={user.id} className="pending-user-row">
                <div>
                  <strong>{user.display_name}</strong>
                  <span>{user.username} · {user.email || '이메일 미입력'} · {user.phone || '휴대폰 미입력'}</span>
                  {user.memo ? <em>{user.memo}</em> : null}
                </div>
                <button className="primary" onClick={() => saveUser(user, { status: 'active' })}>승인</button>
                <button className="secondary" onClick={() => setTemporaryPassword(user)}>비번설정</button>
                <button className="secondary" onClick={() => saveUser(user, { status: 'rejected' })}>거절</button>
              </div>
            )) : <div className="all-clear">승인 대기 유저가 없습니다.</div>}
          </div>
        </section>
      ) : null}

      {userSubTab === 'logs' ? (
        <section className="user-management-card action-log-detail-card">
          <div className="user-log-head">
            <div>
              <h3>작업 로그</h3>
              <p>최근 48시간 작업만 보관됩니다. 오래된 로그는 새 로그 저장 또는 유저 관리 조회 시 자동 삭제됩니다.</p>
            </div>
            <div className="log-retention-badge">48시간 보관</div>
          </div>

          <div className="log-summary-grid">
            <div><span>전체</span><strong>{logs.length}</strong></div>
            <div><span>오늘</span><strong>{todayLogCount}</strong></div>
            <div><span>리포트</span><strong>{reportLogCount}</strong></div>
            <div><span>계정/권한</span><strong>{accountLogCount}</strong></div>
          </div>

          <div className="log-filter-grid">
            <label>
              작업 종류
              <select value={logFilters.actionType} onChange={(e) => setLogFilters({ ...logFilters, actionType: e.target.value })}>
                <option value="all">전체</option>
                {actionTypes.map((type) => <option key={type} value={type}>{getActionLogLabel(type)}</option>)}
              </select>
            </label>
            <label>
              작업자
              <select value={logFilters.actor} onChange={(e) => setLogFilters({ ...logFilters, actor: e.target.value })}>
                <option value="all">전체</option>
                {actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
              </select>
            </label>
            <label>
              검색
              <input value={logFilters.keyword} onChange={(e) => setLogFilters({ ...logFilters, keyword: e.target.value })} placeholder="학생명, 작업자, 작업명 검색" />
            </label>
          </div>

          {filteredLogs.length ? (
            <div className="action-log-list detailed">
              {filteredLogs.slice(0, 100).map((log) => (
                <details key={log.id} className="action-log-row detailed">
                  <summary>
                    <strong>{getActionLogLabel(log.action_type)}</strong>
                    <span>{getActionLogSummary(log)}</span>
                  </summary>
                  <div className="action-log-detail-grid">
                    <div><span>작업자</span><strong>{log.actor_name || '-'}</strong></div>
                    <div><span>대상</span><strong>{log.target_name || log.target_type || '-'}</strong></div>
                    <div><span>일시</span><strong>{formatKstTimeWithSeconds(log.created_at)}</strong></div>
                    <div><span>원본 작업명</span><strong>{log.action_type || '-'}</strong></div>
                  </div>
                  <pre>{JSON.stringify(log.payload || {}, null, 2)}</pre>
                </details>
              ))}
            </div>
          ) : (
            <div className="empty-student-list">
              <strong>조건에 맞는 작업 로그가 없습니다.</strong>
              <span>작업 로그는 최근 48시간까지만 보관됩니다.</span>
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}

function ReportShareLinksManager({ apiFetch, setMessage }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('active');
  const [copiedId, setCopiedId] = useState('');

  useEffect(() => {
    loadLinks(filter);
  }, [filter]);

  async function loadLinks(nextFilter = filter) {
    try {
      setLoading(true);
      const data = await apiFetch(`/api/report-share-link?status=${nextFilter}&limit=120`);
      setLinks(data.links || []);
    } catch (error) {
      setLinks([]);
      setMessage?.(error.message || '공개 리포트 링크 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  async function copyLink(link) {
    if (!link.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopiedId(link.id);
      setMessage?.('공개 리포트 링크 복사 완료');
      window.setTimeout(() => setCopiedId(''), 2200);
    } catch {
      prompt('아래 링크를 복사하세요.', link.url);
    }
  }

  async function revokeLink(link) {
    const ok = confirm('이 공개 리포트 링크를 비활성화할까요?\n학부모가 해당 링크로 더 이상 리포트를 볼 수 없습니다.');
    if (!ok) return;

    try {
      const data = await apiFetch('/api/report-share-link', {
        method: 'POST',
        body: JSON.stringify({ action: 'revoke', id: link.id }),
      });
      setMessage?.(data.message || '공개 리포트 링크를 비활성화했습니다.');
      await loadLinks(filter);
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  async function extendLink(link) {
    const days = prompt('며칠 연장할까요?', '30');
    if (days === null) return;
    const parsed = Number(days);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      alert('1 이상의 숫자를 입력하세요.');
      return;
    }

    try {
      const data = await apiFetch('/api/report-share-link', {
        method: 'POST',
        body: JSON.stringify({ action: 'extend', id: link.id, expiresDays: parsed }),
      });
      setMessage?.(data.message || '공개 리포트 링크 만료일을 연장했습니다.');
      await loadLinks(filter);
    } catch (error) {
      setMessage?.(error.message);
    }
  }

  function getStatus(link) {
    if (!link.is_active) return ['revoked', '비활성'];
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return ['expired', '만료'];
    return ['active', '활성'];
  }

  const activeCount = links.filter((link) => getStatus(link)[0] === 'active').length;
  const expiredCount = links.filter((link) => getStatus(link)[0] === 'expired').length;
  const revokedCount = links.filter((link) => getStatus(link)[0] === 'revoked').length;
  const totalViews = links.reduce((sum, link) => sum + Number(link.view_count || 0), 0);

  return (
    <section className="report-share-link-manager">
      <div className="send-payload-head">
        <div>
          <h3>공개 리포트 링크 관리</h3>
          <p>알림톡의 #{'{'}리포트링크{'}'}로 발송되는 학부모 열람 링크를 확인하고 비활성화할 수 있습니다.</p>
        </div>
        <button className="secondary" onClick={() => loadLinks(filter)} disabled={loading}>{loading ? '조회 중...' : '링크 새로고침'}</button>
      </div>

      <div className="share-link-summary-grid">
        <button type="button" className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}><span>활성</span><strong>{activeCount}</strong></button>
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}><span>전체</span><strong>{links.length}</strong></button>
        <div><span>만료</span><strong>{expiredCount}</strong></div>
        <div><span>비활성</span><strong>{revokedCount}</strong></div>
        <div><span>열람수</span><strong>{totalViews}</strong></div>
      </div>

      {links.length ? (
        <div className="share-link-list">
          {links.map((link) => {
            const [statusKey, statusLabel] = getStatus(link);
            return (
              <article key={link.id} className={`share-link-card ${statusKey}`}>
                <div className="share-link-main">
                  <div>
                    <strong>{link.report_type === 'weekly' ? '위클리 리포트' : '데일리 리포트'}</strong>
                    <span>{link.target_label || link.report_id}</span>
                  </div>
                  <em className={`status-pill ${statusKey === 'active' ? 'done' : statusKey === 'expired' ? 'pending' : 'failed'}`}>{statusLabel}</em>
                </div>
                <div className="share-link-meta">
                  <span>만료: {formatKstTimeWithSeconds(link.expires_at)}</span>
                  <span>열람: {link.view_count || 0}회</span>
                  <span>최근 열람: {link.last_viewed_at ? formatKstTimeWithSeconds(link.last_viewed_at) : '-'}</span>
                </div>
                <code>{link.url || 'URL 생성 실패'}</code>
                <div className="share-link-actions">
                  <button className="secondary" onClick={() => copyLink(link)} disabled={!link.url}>{copiedId === link.id ? '복사됨' : '링크 복사'}</button>
                  <button className="secondary" onClick={() => window.open(link.url, '_blank')} disabled={!link.url}>열기</button>
                  <button className="secondary" onClick={() => extendLink(link)}>30일 연장</button>
                  <button className="danger-lite" onClick={() => revokeLink(link)} disabled={statusKey === 'revoked'}>비활성화</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="all-clear">{loading ? '공개 리포트 링크를 조회하고 있습니다.' : '표시할 공개 리포트 링크가 없습니다.'}</div>
      )}
    </section>
  );
}


function AttendanceNotificationLogsTab({ apiFetch, setMessage, sendConfig }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ status: 'all', eventType: 'all', student: '' });
  const [error, setError] = useState('');
  const [subTab, setSubTab] = useState('logs');
  const [recipientRows, setRecipientRows] = useState([]);
  const [recipientSummary, setRecipientSummary] = useState(null);
  const [recipientSettings, setRecipientSettings] = useState(null);
  const [recipientWarnings, setRecipientWarnings] = useState([]);
  const [recipientLoading, setRecipientLoading] = useState(false);
  const [recipientFilters, setRecipientFilters] = useState({ status: 'all', student: '' });
  const [savingPreferenceId, setSavingPreferenceId] = useState('');
  const [resendingLogId, setResendingLogId] = useState('');

  async function loadLogs(nextFilters = filters) {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        limit: '100',
        status: nextFilters.status || 'all',
        eventType: nextFilters.eventType || 'all',
      });
      if (nextFilters.student) params.set('student', nextFilters.student);
      const data = await apiFetch(`/api/attendance-notification-logs?${params.toString()}`);
      setRows(data.rows || []);
      setSummary(data.summary || null);
    } catch (err) {
      setError(err.message || '출결 알림 로그를 불러오지 못했습니다.');
      setMessage?.(err.message || '출결 알림 로그 조회 실패');
    } finally {
      setLoading(false);
    }
  }

  async function loadRecipients(nextFilters = recipientFilters) {
    try {
      setRecipientLoading(true);
      const params = new URLSearchParams({ status: nextFilters.status || 'all' });
      if (nextFilters.student) params.set('student', nextFilters.student);
      const data = await apiFetch(`/api/attendance-notification-recipients?${params.toString()}`);
      setRecipientRows(data.rows || []);
      setRecipientSummary(data.summary || null);
      setRecipientSettings(data.settings || null);
      setRecipientWarnings(data.warnings || []);
    } catch (err) {
      setMessage?.(err.message || '학생별 알림 수신 점검 조회 실패');
    } finally {
      setRecipientLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
    loadRecipients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key, value) {
    const next = { ...filters, [key]: value };
    setFilters(next);
  }

  function updateRecipientFilter(key, value) {
    const next = { ...recipientFilters, [key]: value };
    setRecipientFilters(next);
  }

  async function resendLog(row) {
    const ok = confirm(`${row.students?.name || '학생'} 학생의 ${getKioskEventLabel(row.event_type)} 알림을 다시 발송 요청할까요?\n\n테스트모드 ON이면 테스트 수신번호로 발송됩니다.`);
    if (!ok) return;

    try {
      setResendingLogId(row.id);
      const data = await apiFetch('/api/attendance-notification-logs', {
        method: 'POST',
        body: JSON.stringify({ action: 'resend', logId: row.id }),
      });
      setMessage?.(data.message || '출결 알림 재발송 요청 완료');
      await loadLogs(filters);
      await loadRecipients(recipientFilters);
    } catch (err) {
      setMessage?.(err.message || '출결 알림 재발송 실패');
    } finally {
      setResendingLogId('');
    }
  }

  async function togglePreference(row, column) {
    const studentId = row.student?.id;
    if (!studentId) return;
    const current = row.preference || {};
    const nextPreference = { ...current, [column]: !Boolean(current[column]) };

    try {
      setSavingPreferenceId(`${studentId}-${column}`);
      const data = await apiFetch('/api/attendance-notification-recipients', {
        method: 'POST',
        body: JSON.stringify({ action: 'save_preference', studentId, preference: nextPreference }),
      });
      setMessage?.(data.message || '학생별 출결 알림 제외 설정 저장 완료');
      await loadRecipients(recipientFilters);
    } catch (err) {
      setMessage?.(err.message || '학생별 출결 알림 제외 설정 저장 실패');
    } finally {
      setSavingPreferenceId('');
    }
  }

  const testModeOn = Boolean(sendConfig?.recipientPolicy?.testMode ?? recipientSettings?.testMode);
  const testRecipientReady = Boolean(sendConfig?.recipientPolicy?.testRecipientCount || recipientSettings?.testRecipientConfigured);
  const providerReady = Boolean(sendConfig?.attendance?.configured || recipientSettings?.providerConfigured);

  return (
    <section className="content-card attendance-notification-log-tab">
      <div className={`attendance-notification-safety-banner ${testModeOn ? 'test' : 'live'}`}>
        <div>
          <strong>{testModeOn ? '현재 테스트모드 ON' : '현재 테스트모드 OFF'}</strong>
          <span>{testModeOn ? '출결 알림은 테스트 수신번호로 대체됩니다.' : '출결 알림이 실제 보호자 연락처로 발송될 수 있습니다.'}</span>
        </div>
        <em>{testModeOn ? (testRecipientReady ? '테스트 번호 설정됨' : '테스트 번호 미설정') : (providerReady ? '실제 발송 설정 확인' : '템플릿/API 확인 필요')}</em>
      </div>

      <div className="section-head">
        <div>
          <h2>설정 · 출결 알림톡 안정화 콘솔</h2>
          <p>출결 알림 로그, 실패 사유, 재발송, 학생별 알림 제외 설정을 한 곳에서 확인합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={() => { loadLogs(); loadRecipients(); }} disabled={loading || recipientLoading}>{loading || recipientLoading ? '불러오는 중...' : '전체 새로고침'}</button>
        </div>
      </div>

      <div className="settings-tabs mini-tabs clean-panel">
        <button className={subTab === 'logs' ? 'active' : ''} onClick={() => setSubTab('logs')}>출결 알림 로그</button>
        <button className={subTab === 'recipients' ? 'active' : ''} onClick={() => setSubTab('recipients')}>학생별 수신 점검</button>
      </div>

      {subTab === 'logs' ? (
        <>
          <div className="notification-summary-grid">
            <div><span>전체</span><strong>{summary?.total ?? rows.length}</strong></div>
            <div><span>입실</span><strong>{summary?.checkIn ?? 0}</strong></div>
            <div><span>퇴실</span><strong>{summary?.checkOut ?? 0}</strong></div>
            <div><span>외출</span><strong>{summary?.away ?? 0}</strong></div>
            <div><span>복귀</span><strong>{summary?.return ?? 0}</strong></div>
            <div><span>복귀지연</span><strong>{summary?.returnOverdue ?? 0}</strong></div>
            <div><span>발송완료</span><strong>{summary?.sent ?? 0}</strong></div>
            <div><span>요청접수</span><strong>{summary?.received ?? 0}</strong></div>
            <div><span>실패</span><strong>{summary?.failed ?? 0}</strong></div>
            <div><span>건너뜀</span><strong>{summary?.skipped ?? 0}</strong></div>
            <div><span>테스트모드</span><strong>{summary?.testMode ?? 0}</strong></div>
          </div>

          {summary?.failureReasons && Object.keys(summary.failureReasons).length ? (
            <div className="notification-failure-reasons clean-panel">
              <strong>실패/건너뜀 사유 요약</strong>
              <div>
                {Object.entries(summary.failureReasons).map(([label, count]) => (
                  <span key={label} className="risk-chip warn">{label} {count}건</span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="notification-log-filters clean-panel">
            <div className="field">
              <label>발송상태</label>
              <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
                <option value="all">전체</option>
                <option value="ready">발송대기</option>
                <option value="received">요청접수</option>
                <option value="sent">발송완료</option>
                <option value="failed">발송실패</option>
                <option value="skipped">건너뜀</option>
              </select>
            </div>
            <div className="field">
              <label>알림종류</label>
              <select value={filters.eventType} onChange={(e) => updateFilter('eventType', e.target.value)}>
                <option value="all">전체</option>
                <option value="check_in">입실</option>
                <option value="check_out">퇴실</option>
                <option value="away">외출</option>
                <option value="return">복귀</option>
                <option value="return_overdue">복귀 지연</option>
              </select>
            </div>
            <div className="field">
              <label>학생명</label>
              <input value={filters.student} onChange={(e) => updateFilter('student', e.target.value)} placeholder="학생명 검색" />
            </div>
            <button className="primary" onClick={() => loadLogs()} disabled={loading}>검색</button>
          </div>

          {error ? <div className="error-box">{error}</div> : null}

          <div className="notification-log-table-wrap">
            <table className="data-table notification-log-table notification-log-table-v41-10">
              <thead>
                <tr>
                  <th>발송시각</th>
                  <th>학생</th>
                  <th>알림</th>
                  <th>출결시각</th>
                  <th>기록방식</th>
                  <th>수신자</th>
                  <th>상태</th>
                  <th>테스트</th>
                  <th>사유/조치</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const statusClass = getAttendanceNotificationStatusClass(row.send_status);
                  const recipientText = row.recipient_phone_snapshot || (Array.isArray(row.recipient_snapshot) ? row.recipient_snapshot.map((item) => item.phone).filter(Boolean).join(', ') : '');
                  const diagnosis = row.failureDiagnosis || {};
                  return (
                    <tr key={row.id}>
                      <td>{formatKstTime(row.created_at)}</td>
                      <td><strong>{row.students?.name || '-'}</strong><span className="muted small-block">{[row.students?.school, row.students?.grade].filter(Boolean).join(' ')}</span></td>
                      <td>{getKioskEventLabel(row.event_type)}</td>
                      <td>{formatKstTime(row.event_at)}</td>
                      <td>{getAttendanceNotificationSourceLabel(row)}</td>
                      <td>{recipientText || '-'}<span className="muted small-block">{row.recipient_count || 0}명</span></td>
                      <td><span className={`status-pill ${statusClass}`}>{getAttendanceNotificationStatusLabel(row.send_status)}</span></td>
                      <td>{row.test_mode ? <span className="status-pill pending">ON</span> : <span className="status-pill done">OFF</span>}</td>
                      <td className="notification-error-cell">
                        <strong>{diagnosis.label || '-'}</strong>
                        <span className="small-block muted">{diagnosis.detail || row.error_message || row.provider_status || '-'}</span>
                        {diagnosis.actionHint ? <em className="small-block">{diagnosis.actionHint}</em> : null}
                      </td>
                      <td>
                        <button className="secondary compact-button" onClick={() => resendLog(row)} disabled={Boolean(resendingLogId)}>
                          {resendingLogId === row.id ? '재발송 중...' : '재발송'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length ? (
                  <tr><td colSpan={10} className="empty-cell">출결 알림톡 로그가 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="hint">v41-10에서는 실패/건너뜀 사유를 사람이 읽기 쉬운 진단으로 표시하고, 필요한 경우 로그에서 바로 재발송할 수 있습니다.</div>
        </>
      ) : null}

      {subTab === 'recipients' ? (
        <>
          <div className="notification-summary-grid recipient-check-summary">
            <div><span>전체 학생</span><strong>{recipientSummary?.total ?? recipientRows.length}</strong></div>
            <div><span>정상</span><strong>{recipientSummary?.ok ?? 0}</strong></div>
            <div><span>확인 필요</span><strong>{recipientSummary?.warning ?? 0}</strong></div>
            <div><span>발송 불가</span><strong>{recipientSummary?.blocked ?? 0}</strong></div>
            <div><span>학생별 제외</span><strong>{recipientSummary?.excluded ?? 0}</strong></div>
            <div><span>연락처 없음</span><strong>{recipientSummary?.missingRecipient ?? 0}</strong></div>
          </div>

          {recipientWarnings?.length ? (
            <div className="error-box">{recipientWarnings.join(' / ')}</div>
          ) : null}

          <div className="notification-log-filters clean-panel">
            <div className="field">
              <label>상태</label>
              <select value={recipientFilters.status} onChange={(e) => updateRecipientFilter('status', e.target.value)}>
                <option value="all">전체</option>
                <option value="ok">정상</option>
                <option value="warning">확인 필요</option>
                <option value="blocked">발송 불가</option>
                <option value="excluded">학생별 제외</option>
              </select>
            </div>
            <div className="field">
              <label>학생명</label>
              <input value={recipientFilters.student} onChange={(e) => updateRecipientFilter('student', e.target.value)} placeholder="학생명 검색" />
            </div>
            <button className="primary" onClick={() => loadRecipients()} disabled={recipientLoading}>{recipientLoading ? '조회 중...' : '수신 점검'}</button>
          </div>

          <div className="notification-log-table-wrap">
            <table className="data-table notification-recipient-check-table">
              <thead>
                <tr>
                  <th>학생</th>
                  <th>보호자 연락처</th>
                  <th>상태</th>
                  <th>최근 발송</th>
                  <th>학생별 알림 제외 설정</th>
                  <th>확인사항</th>
                </tr>
              </thead>
              <tbody>
                {recipientRows.map((row) => {
                  const pref = row.preference || {};
                  const statusClass = row.status === 'ok' ? 'done' : row.status === 'blocked' ? 'failed' : row.status === 'excluded' ? 'neutral' : 'pending';
                  return (
                    <tr key={row.student?.id}>
                      <td><strong>{row.student?.name || '-'}</strong><span className="muted small-block">{[row.student?.school, row.student?.grade].filter(Boolean).join(' ') || '학교/학년 미입력'}</span></td>
                      <td>
                        {row.recipients?.length ? row.recipients.map((item) => (
                          <span key={`${row.student?.id}-${item.phone}`} className="recipient-mini-chip">{item.relationship || item.name || '보호자'} {item.phone}</span>
                        )) : <span className="status-pill failed">연락처 없음</span>}
                      </td>
                      <td><span className={`status-pill ${statusClass}`}>{row.status === 'ok' ? '정상' : row.status === 'blocked' ? '발송 불가' : row.status === 'excluded' ? '학생별 제외' : '확인 필요'}</span></td>
                      <td>{row.recentLog ? <><strong>{getAttendanceNotificationStatusLabel(row.recentLog.send_status)}</strong><span className="muted small-block">{getKioskEventLabel(row.recentLog.event_type)} · {formatKstTime(row.recentLog.created_at)}</span></> : '-'}</td>
                      <td className="preference-toggle-cell">
                        {[
                          ['exclude_check_in', '입실'],
                          ['exclude_check_out', '퇴실'],
                          ['exclude_away', '외출'],
                          ['exclude_return', '복귀'],
                          ['exclude_return_overdue', '복귀지연'],
                        ].map(([column, label]) => (
                          <button
                            key={column}
                            className={pref[column] ? 'danger-lite compact-button' : 'secondary compact-button'}
                            onClick={() => togglePreference(row, column)}
                            disabled={Boolean(savingPreferenceId)}
                          >
                            {savingPreferenceId === `${row.student?.id}-${column}` ? '저장 중' : `${label} ${pref[column] ? '제외' : '허용'}`}
                          </button>
                        ))}
                      </td>
                      <td className="notification-error-cell">
                        {row.problems?.length ? row.problems.map((problem) => <span key={problem.key} className="small-block">· {problem.label}</span>) : <span className="all-clear-inline">확인사항 없음</span>}
                      </td>
                    </tr>
                  );
                })}
                {!recipientRows.length ? (
                  <tr><td colSpan={6} className="empty-cell">표시할 학생이 없습니다.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="hint">학생별 제외 설정은 자동 알림 발송 시점에 적용됩니다. 제외된 이벤트는 발송되지 않고 로그에 '건너뜀'으로 남습니다.</div>
        </>
      ) : null}
    </section>
  );
}


const ALIMTALK_TEMPLATE_CONSOLE_ITEMS = [
  {
    key: 'daily',
    label: '데일리 리포트',
    purpose: '마감 발송 콘솔에서 학부모에게 데일리 리포트 링크와 핵심 요약을 보냅니다.',
    required: ['#{학생명}', '#{날짜}', '#{출결상태}', '#{순공시간}', '#{확인사항}', '#{리포트링크}'],
    solapiEnv: 'SOLAPI_TEMPLATE_ID_DAILY',
    directEnv: 'KAKAO_TEMPLATE_CODE_DAILY',
    guide: '리포트 링크가 반드시 포함되어야 하며 report_share_links 테이블이 정상이어야 합니다.',
  },
  {
    key: 'weekly',
    label: '위클리 리포트',
    purpose: '주간 리포트 저장 후 학부모에게 주간 누적 리포트 링크를 보냅니다.',
    required: ['#{학생명}', '#{기간}', '#{주간순공시간}', '#{확인사항}', '#{리포트링크}'],
    solapiEnv: 'SOLAPI_TEMPLATE_ID_WEEKLY',
    directEnv: 'KAKAO_TEMPLATE_CODE_WEEKLY',
    guide: '주간 리포트는 저장된 weekly_reports와 공개 링크가 함께 준비되어야 합니다.',
  },
  {
    key: 'attendance',
    label: '출결 자동 알림',
    purpose: '입실·퇴실·외출·복귀·복귀 지연 이벤트 발생 시 보호자에게 자동 안내합니다.',
    required: ['#{학생명}', '#{날짜}', '#{출결구분}', '#{출결시간}', '#{기록방식}'],
    solapiEnv: 'SOLAPI_TEMPLATE_ID_ATTENDANCE',
    directEnv: 'KAKAO_TEMPLATE_CODE_ATTENDANCE',
    guide: '출결 알림 ON/OFF와 학생별 제외 설정을 함께 확인하세요.',
  },
  {
    key: 'parent_confirmation',
    label: '학부모 확인 요청',
    purpose: '시간표상 있어야 하는데 미입실/외출/퇴실 등 현장 확인이 필요한 상황을 즉시 안내합니다.',
    required: ['#{학생명}', '#{예정학습시간}', '#{예정외출시간}', '#{현재상태}'],
    solapiEnv: 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION',
    directEnv: 'KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION',
    guide: '시간표 알림센터의 학부모 알림 버튼에서 미리보기 후 발송됩니다.',
  },
];

function getTemplateConfigForConsole(sendConfig = {}, item = {}) {
  if (item.key === 'weekly') {
    return {
      configured: Boolean(sendConfig?.provider?.solapiWeeklyTemplateConfigured || sendConfig?.provider?.weeklyTemplateConfigured || sendConfig?.weekly?.configured),
      envName: sendConfig?.provider?.solapiWeeklyTemplateEnvName || sendConfig?.provider?.weeklyTemplateEnvName || sendConfig?.weekly?.envName || item.solapiEnv,
      modeLabel: sendConfig?.provider?.mode === 'solapi' ? 'SOLAPI 템플릿' : sendConfig?.provider?.weeklyTemplateConfigured ? 'Direct Kakao 템플릿' : sendConfig?.weekly?.modeLabel || '템플릿 미설정',
    };
  }

  if (item.key === 'attendance') {
    return {
      configured: Boolean(sendConfig?.attendance?.configured),
      envName: sendConfig?.attendance?.solapiTemplateEnvName || sendConfig?.attendance?.templateEnvName || item.solapiEnv,
      modeLabel: sendConfig?.attendance?.modeLabel || '출결 템플릿 미설정',
    };
  }

  if (item.key === 'parent_confirmation') {
    return {
      configured: Boolean(sendConfig?.parentConfirmation?.configured),
      envName: sendConfig?.parentConfirmation?.solapiTemplateEnvName || sendConfig?.parentConfirmation?.templateEnvName || item.solapiEnv,
      modeLabel: sendConfig?.parentConfirmation?.modeLabel || '학부모 확인 요청 템플릿 미설정',
    };
  }

  return {
    configured: Boolean(sendConfig?.provider?.solapiDailyTemplateConfigured || sendConfig?.provider?.dailyTemplateConfigured || sendConfig?.daily?.configured),
    envName: sendConfig?.provider?.solapiDailyTemplateEnvName || sendConfig?.provider?.dailyTemplateEnvName || sendConfig?.daily?.envName || item.solapiEnv,
    modeLabel: sendConfig?.provider?.mode === 'solapi' ? 'SOLAPI 템플릿' : sendConfig?.provider?.dailyTemplateConfigured ? 'Direct Kakao 템플릿' : sendConfig?.daily?.modeLabel || '템플릿 미설정',
  };
}

function buildAlimtalkRiskItems(sendConfig = {}) {
  const provider = sendConfig?.provider || {};
  const recipient = sendConfig?.recipientPolicy || {};
  const risks = [];
  if (!provider.solapiApiKeyConfigured && provider.mode === 'solapi') risks.push(['SOLAPI API Key 미설정', 'SOLAPI_API_KEY 환경변수를 확인하세요.']);
  if (!provider.solapiApiSecretConfigured && provider.mode === 'solapi') risks.push(['SOLAPI API Secret 미설정', 'SOLAPI_API_SECRET 환경변수를 확인하세요.']);
  if (!provider.solapiChannelConfigured && provider.mode === 'solapi') risks.push(['SOLAPI 채널 미설정', 'SOLAPI_CHANNEL_ID 또는 pfId 값을 확인하세요.']);
  if (provider.failSafe) risks.push(['Fail-safe ON', '실제 발송은 차단되거나 발송대기 중심으로 기록됩니다. 운영 전 의도한 상태인지 확인하세요.']);
  if (recipient.testMode && !recipient.testRecipientCount) risks.push(['테스트모드 ON / 테스트번호 없음', 'KAKAO_TEST_RECIPIENT_PHONE 또는 KAKAO_TEST_RECIPIENT_PHONES를 설정하세요.']);
  if (!recipient.testMode && provider.actualSendEnabled && !recipient.allowlistCount) risks.push(['전체 실전 발송 가능', '테스트/Allowlist 제한 없이 보호자에게 실제 발송될 수 있습니다.']);
  if (!sendConfig?.reportLinks?.configured) risks.push(['리포트 링크 DB 확인 필요', '데일리/위클리 템플릿의 #{리포트링크} 발급을 위해 v40-83 SQL 실행 여부를 확인하세요.']);
  ALIMTALK_TEMPLATE_CONSOLE_ITEMS.forEach((item) => {
    const cfg = getTemplateConfigForConsole(sendConfig, item);
    if (!cfg.configured) risks.push([`${item.label} 템플릿 미설정`, `${cfg.envName || item.solapiEnv} 환경변수 또는 Direct Kakao 템플릿 코드를 확인하세요.`]);
  });
  return risks;
}

function getAlimtalkFinalReadiness(sendConfig = {}, item = {}) {
  const cfg = getTemplateConfigForConsole(sendConfig, item);
  const provider = sendConfig?.provider || {};
  const recipient = sendConfig?.recipientPolicy || {};
  if (!cfg.configured) {
    return { key: 'missing', label: '설정 필요', className: 'failed', detail: `${cfg.envName || item.solapiEnv} 설정이 필요합니다.` };
  }
  if (!recipient.testRecipientCount) {
    return { key: 'no_test_recipient', label: '테스트번호 필요', className: 'failed', detail: '테스트 발송 전 KAKAO_TEST_RECIPIENT_PHONE을 설정하세요.' };
  }
  if (provider.mode === 'solapi' && (!provider.solapiApiKeyConfigured || !provider.solapiApiSecretConfigured || !provider.solapiChannelConfigured)) {
    return { key: 'api_missing', label: 'API 설정 필요', className: 'failed', detail: 'SOLAPI API Key / Secret / Channel 설정이 필요합니다.' };
  }
  if (provider.failSafe) {
    return { key: 'test_only_failsafe', label: '테스트만 가능', className: 'pending', detail: 'Fail-safe ON 상태라 실제 카카오 발송은 차단되고 요청 접수만 확인됩니다.' };
  }
  if (recipient.testMode) {
    return { key: 'test_ready', label: '테스트 발송 가능', className: 'done', detail: '테스트 수신번호로 실제 테스트 발송이 가능합니다.' };
  }
  if (provider.actualSendEnabled) {
    return { key: 'live_ready', label: '실전 발송 가능', className: 'warning', detail: '테스트모드 OFF 상태입니다. 실전 발송 전 최종 확인이 필요합니다.' };
  }
  return { key: 'ready_pending', label: '설정 확인', className: 'pending', detail: '템플릿은 있으나 실제 발송 가능 여부를 확인해야 합니다.' };
}

function summarizeAlimtalkTestSendResult(result = null) {
  if (!result) return '아직 테스트 발송을 실행하지 않았습니다.';
  if (result.ok === false) return result.message || result.error || '테스트 발송 실패';
  if (result.failSafe) return 'Fail-safe ON으로 실제 발송은 차단되었고 요청 접수만 확인했습니다.';
  if (result.actualSent) return '테스트 수신번호로 실제 테스트 발송이 완료되었습니다.';
  return result.message || '테스트 발송 요청이 접수되었습니다.';
}

function AlimtalkTemplateConsole({ sendConfig, apiFetch, setMessage, loadSendConfig }) {
  const [testingType, setTestingType] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [templateValidationResult, setTemplateValidationResult] = useState(null);
  const [testSendResult, setTestSendResult] = useState(null);
  const activeTestMode = Boolean(sendConfig?.recipientPolicy?.testMode);
  const risks = buildAlimtalkRiskItems(sendConfig);
  const readyCount = ALIMTALK_TEMPLATE_CONSOLE_ITEMS.filter((item) => getTemplateConfigForConsole(sendConfig, item).configured).length;

  async function runTemplatePayloadTest(reportType) {
    try {
      setTestingType(`${reportType}_payload`);
      setTestResult(null);
      const data = await apiFetch('/api/report-send-test', {
        method: 'POST',
        body: JSON.stringify({ reportType }),
      });
      setTestResult(data);
      setMessage?.(`${getKakaoReportTypeLabel(reportType)} 테스트 payload 생성 완료`);
    } catch (error) {
      setTestResult({ ok: false, reportType, error: error.message });
      setMessage?.(error.message || '테스트 payload 생성 실패');
    } finally {
      setTestingType('');
    }
  }

  async function runTemplateValidation(reportType) {
    try {
      setTestingType(`${reportType}_template`);
      setTemplateValidationResult(null);
      const payload = testResult?.reportType === reportType ? testResult.payload : null;
      const data = await apiFetch('/api/report-template-validate', {
        method: 'POST',
        body: JSON.stringify({ reportType, payload }),
      });
      setTemplateValidationResult(data);
      setMessage?.(data.ok ? `${getKakaoReportTypeLabel(reportType)} 템플릿 변수 검증 통과` : `${getKakaoReportTypeLabel(reportType)} 템플릿 변수 확인 필요`);
    } catch (error) {
      setTemplateValidationResult({ ok: false, reportType, error: error.message });
      setMessage?.(error.message || '템플릿 변수 검증 실패');
    } finally {
      setTestingType('');
    }
  }

  async function runActualTestSend(reportType) {
    const label = getKakaoReportTypeLabel(reportType);
    const ok = confirm(`${label} 템플릿을 테스트 수신번호로 발송합니다. 실제 학부모 번호로는 발송하지 않습니다. 계속할까요?`);
    if (!ok) return;
    try {
      setTestingType(`${reportType}_send`);
      setTestSendResult(null);
      const data = await apiFetch('/api/alimtalk-test-send', {
        method: 'POST',
        body: JSON.stringify({ reportType }),
      });
      setTestSendResult(data);
      setMessage?.(data.message || `${label} 테스트 발송 요청 완료`);
    } catch (error) {
      setTestSendResult({ ok: false, reportType, message: error.message, error: error.message });
      setMessage?.(error.message || '테스트 발송 실패');
    } finally {
      setTestingType('');
    }
  }

  return (
    <section className="content-card alimtalk-template-console-tab">
      <div className={`attendance-notification-safety-banner ${activeTestMode ? 'test' : 'live'}`}>
        <div>
          <strong>{activeTestMode ? '현재 테스트모드 ON' : '현재 테스트모드 OFF'}</strong>
          <span>{activeTestMode ? '리포트·출결·학부모 확인 요청 알림이 테스트 수신번호로 대체됩니다.' : '실제 보호자 연락처로 발송될 수 있습니다. 템플릿과 수신 정책을 확인하세요.'}</span>
        </div>
        <em>{activeTestMode ? (sendConfig?.recipientPolicy?.testRecipientCount ? '테스트 번호 설정됨' : '테스트 번호 미설정') : (sendConfig?.provider?.actualSendEnabled ? '실전 발송 가능' : 'Fail-safe / 설정 확인')}</em>
      </div>

      <div className="section-head">
        <div>
          <h2>설정 · 알림톡 템플릿 관리 콘솔</h2>
          <p>데일리·위클리·출결·학부모 확인 요청 템플릿의 설정 상태, 필수 변수, 테스트 payload, 위험 요소를 한 화면에서 점검합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={loadSendConfig}>연결 상태 새로고침</button>
        </div>
      </div>

      <div className="alimtalk-console-summary-grid">
        <div><span>템플릿 준비</span><strong>{readyCount}/{ALIMTALK_TEMPLATE_CONSOLE_ITEMS.length}</strong></div>
        <div><span>Provider</span><strong>{sendConfig?.provider?.mode || '-'}</strong></div>
        <div><span>Fail-safe</span><strong>{sendConfig?.provider?.failSafe ? 'ON' : 'OFF'}</strong></div>
        <div><span>실제 발송</span><strong>{sendConfig?.provider?.actualSendEnabled ? '가능' : '차단/대기'}</strong></div>
        <div><span>테스트모드</span><strong>{activeTestMode ? 'ON' : 'OFF'}</strong></div>
        <div><span>테스트 번호</span><strong>{sendConfig?.recipientPolicy?.testRecipientCount ? `${sendConfig.recipientPolicy.testRecipientCount}개` : '미설정'}</strong></div>
      </div>

      <div className="alimtalk-template-console-grid">
        {ALIMTALK_TEMPLATE_CONSOLE_ITEMS.map((item) => {
          const cfg = getTemplateConfigForConsole(sendConfig, item);
          const readiness = getAlimtalkFinalReadiness(sendConfig, item);
          return (
            <article key={item.key} className={`alimtalk-template-console-card ${cfg.configured ? 'ready' : 'missing'}`}>
              <div className="alimtalk-template-console-head">
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.purpose}</span>
                </div>
                <em className={`status-pill ${readiness.className || (cfg.configured ? 'done' : 'failed')}`}>{readiness.label}</em>
              </div>
              <div className="alimtalk-template-console-meta">
                <div><span>현재 환경변수</span><strong>{cfg.envName}</strong></div>
                <div><span>발송 모드</span><strong>{cfg.modeLabel}</strong></div>
                <div><span>SOLAPI 권장</span><strong>{item.solapiEnv}</strong></div>
                <div><span>Direct Kakao</span><strong>{item.directEnv}</strong></div>
              </div>
              <div className="alimtalk-required-variables">
                {item.required.map((variable) => <code key={variable}>{variable}</code>)}
              </div>
              <p className="hint">{item.guide}</p>
              <div className="alimtalk-readiness-detail">{readiness.detail}</div>
              <div className="send-settings-card-actions">
                <button className="secondary" onClick={() => runTemplatePayloadTest(item.key)} disabled={testingType === `${item.key}_payload`}>{testingType === `${item.key}_payload` ? '생성 중...' : '테스트 payload'}</button>
                <button className="secondary" onClick={() => runTemplateValidation(item.key)} disabled={testingType === `${item.key}_template`}>{testingType === `${item.key}_template` ? '검증 중...' : '변수 검증'}</button>
                <button className="primary" onClick={() => runActualTestSend(item.key)} disabled={testingType === `${item.key}_send` || !sendConfig?.recipientPolicy?.testRecipientCount || !cfg.configured}>{testingType === `${item.key}_send` ? '발송 중...' : '테스트 수신번호로 발송'}</button>
              </div>
            </article>
          );
        })}
      </div>

      <section className={`alimtalk-risk-console ${risks.length ? 'warn' : 'ok'}`}>
        <div className="send-payload-head">
          <div>
            <h3>현재 위험 요소</h3>
            <p>환경변수, 테스트모드, Fail-safe, 템플릿, 리포트 링크 DB 상태를 기준으로 운영 전 확인이 필요한 항목을 표시합니다.</p>
          </div>
          <span className={`status-pill ${risks.length ? 'failed' : 'done'}`}>{risks.length ? `${risks.length}건 확인 필요` : '확인사항 없음'}</span>
        </div>
        {risks.length ? (
          <div className="alimtalk-risk-list">
            {risks.map(([title, detail]) => (
              <div key={`${title}-${detail}`}>
                <strong>{title}</strong>
                <span>{detail}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="all-clear">현재 알림톡 설정상 즉시 확인이 필요한 위험 요소가 없습니다.</div>
        )}
      </section>

      <section className={`template-validation-result-card ${templateValidationResult?.ok ? 'ok' : templateValidationResult ? 'warn' : ''}`}>
        <div className="send-payload-head">
          <div>
            <h3>최근 템플릿 변수 검증 결과</h3>
            <p>각 템플릿의 필수 변수가 비어 있는지 확인합니다. 누락이 있으면 실제 발송/발송대기에서 차단될 수 있습니다.</p>
          </div>
          {templateValidationResult?.ok ? <span className="status-pill done">검증 통과</span> : templateValidationResult ? <span className="status-pill failed">확인 필요</span> : <span className="status-pill pending">대기</span>}
        </div>
        {templateValidationResult ? (
          <>
            <div className="template-validation-summary">
              <div><span>구분</span><strong>{getKakaoReportTypeLabel(templateValidationResult.reportType)}</strong></div>
              <div><span>필수 변수</span><strong>{templateValidationResult.required?.length || 0}개</strong></div>
              <div><span>누락</span><strong>{templateValidationResult.missing?.length || 0}개</strong></div>
              <div><span>경고</span><strong>{templateValidationResult.warnings?.length || 0}개</strong></div>
            </div>
            {templateValidationResult.missing?.length ? <div className="template-validation-list failed"><strong>누락 변수</strong><span>{templateValidationResult.missing.join(', ')}</span></div> : null}
            {templateValidationResult.warnings?.length ? <div className="template-validation-list warning"><strong>경고</strong><span>{templateValidationResult.warnings.join(' / ')}</span></div> : null}
            <pre>{JSON.stringify(templateValidationResult.variables || {}, null, 2)}</pre>
          </>
        ) : <div className="all-clear">아직 템플릿 변수 검증을 실행하지 않았습니다.</div>}
      </section>

      <section className={`alimtalk-test-send-result-card ${testSendResult?.ok ? 'ok' : testSendResult ? 'warn' : ''}`}>
        <div className="send-payload-head">
          <div>
            <h3>최근 테스트 발송 결과</h3>
            <p>테스트 발송은 KAKAO_TEST_RECIPIENT_PHONE/PHONES로만 전송되도록 강제합니다. Fail-safe ON이면 실제 발송은 차단되고 요청 접수만 확인됩니다.</p>
          </div>
          {testSendResult?.ok ? <span className="status-pill done">처리 완료</span> : testSendResult ? <span className="status-pill failed">확인 필요</span> : <span className="status-pill pending">대기</span>}
        </div>
        <div className="template-validation-summary">
          <div><span>구분</span><strong>{testSendResult?.reportType ? getKakaoReportTypeLabel(testSendResult.reportType) : '-'}</strong></div>
          <div><span>테스트 번호</span><strong>{testSendResult?.testRecipientCount ? `${testSendResult.testRecipientCount}개` : '-'}</strong></div>
          <div><span>상태</span><strong>{testSendResult?.status || '-'}</strong></div>
          <div><span>실제 발송</span><strong>{testSendResult?.actualSent ? '완료' : testSendResult?.failSafe ? 'Fail-safe 차단' : '-'}</strong></div>
        </div>
        <div className="all-clear">{summarizeAlimtalkTestSendResult(testSendResult)}</div>
        <pre>{JSON.stringify(testSendResult || { message: '템플릿 카드의 테스트 수신번호로 발송 버튼을 누르면 결과가 표시됩니다.' }, null, 2)}</pre>
      </section>

      <section className="send-payload-preview">
        <div className="send-payload-head">
          <div>
            <h3>최근 테스트 payload</h3>
            <p>실제 알림톡을 보내지 않고 서버가 생성하는 payload와 카카오 변수값을 확인합니다.</p>
          </div>
          {testResult?.ok ? <span className="status-pill done">생성 완료</span> : testResult?.error ? <span className="status-pill failed">생성 실패</span> : <span className="status-pill pending">대기</span>}
        </div>
        <pre>{JSON.stringify(testResult?.payload || { message: '템플릿 카드의 테스트 payload 버튼을 누르면 여기에 표시됩니다.' }, null, 2)}</pre>
      </section>
    </section>
  );
}

function ReportSendSettingsTab({ sendConfig, apiFetch, setMessage, loadSendConfig }) {
  const [testingType, setTestingType] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [webhookTestResult, setWebhookTestResult] = useState(null);
  const [templateValidationResult, setTemplateValidationResult] = useState(null);
  const [testModeSaving, setTestModeSaving] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);

  const notificationPolicy = sendConfig?.notificationPolicy || {};
  const daily = sendConfig?.daily || {};
  const weekly = sendConfig?.weekly || {};
  const dailyMode = daily.configured ? 'Webhook 연동 모드' : '발송대기 저장 모드';
  const weeklyMode = weekly.configured ? 'Webhook 연동 모드' : '발송대기 저장 모드';

  async function runTest(reportType) {
    try {
      setTestingType(reportType);
      setTestResult(null);
      const data = await apiFetch('/api/report-send-test', {
        method: 'POST',
        body: JSON.stringify({ reportType }),
      });
      setTestResult(data);
      setMessage?.(`${getKakaoReportTypeLabel(reportType)} 테스트 payload 생성 완료`);
    } catch (error) {
      setTestResult({ ok: false, error: error.message });
      setMessage?.(error.message);
    } finally {
      setTestingType('');
    }
  }

  async function runWebhookTest(reportType) {
    try {
      setTestingType(`${reportType}_webhook`);
      setWebhookTestResult(null);
      const data = await apiFetch('/api/report-webhook-test', {
        method: 'POST',
        body: JSON.stringify({ reportType }),
      });
      setWebhookTestResult(data);
      setMessage?.(data.message || `${getKakaoReportTypeLabel(reportType)} Webhook 연결 테스트 완료`);
    } catch (error) {
      setWebhookTestResult({ ok: false, error: error.message, message: error.message });
      setMessage?.(error.message);
    } finally {
      setTestingType('');
    }
  }

  async function runTemplateValidation(reportType) {
    try {
      setTestingType(`${reportType}_template`);
      setTemplateValidationResult(null);
      const payload = testResult?.reportType === reportType ? testResult.payload : null;
      const data = await apiFetch('/api/report-template-validate', {
        method: 'POST',
        body: JSON.stringify({ reportType, payload }),
      });
      setTemplateValidationResult(data);
      setMessage?.(data.ok ? `${getKakaoReportTypeLabel(reportType)} 템플릿 변수 검증 통과` : `${getKakaoReportTypeLabel(reportType)} 템플릿 변수 확인 필요`);
    } catch (error) {
      setTemplateValidationResult({ ok: false, error: error.message });
      setMessage?.(error.message);
    } finally {
      setTestingType('');
    }
  }

  async function setRecipientTestMode(nextMode) {
    const currentlyOn = Boolean(sendConfig?.recipientPolicy?.testMode);
    if (currentlyOn === nextMode) return;
    if (!nextMode && sendConfig?.provider?.actualSendEnabled && !sendConfig?.recipientPolicy?.allowlistCount) {
      const ok = confirm('테스트모드를 OFF로 전환하면 실제 보호자 연락처로 알림톡이 발송될 수 있습니다. 템플릿 승인, 테스트 발송, 수신자 정책을 모두 확인한 뒤에만 실전 발송 모드로 전환하세요.\n\n정말 실전 발송 모드로 전환하시겠습니까?');
      if (!ok) return;
    }

    try {
      setTestModeSaving(true);
      const data = await apiFetch('/api/report-send-config', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_recipient_test_mode', testMode: nextMode }),
      });
      setMessage?.(data.message || (nextMode ? '테스트모드 ON' : '테스트모드 OFF'));
      await loadSendConfig?.();
    } catch (error) {
      setMessage?.(error.message || '테스트모드 전환 실패');
    } finally {
      setTestModeSaving(false);
    }
  }


  async function saveAttendanceNotificationSettings(patch) {
    const nextSettings = {
      checkInEnabled: notificationPolicy.checkInEnabled !== false,
      checkOutEnabled: notificationPolicy.checkOutEnabled !== false,
      awayEnabled: Boolean(notificationPolicy.awayEnabled),
      returnEnabled: Boolean(notificationPolicy.returnEnabled),
      returnOverdueEnabled: notificationPolicy.returnOverdueEnabled !== false,
      returnOverdueGraceMinutes: Number(notificationPolicy.returnOverdueGraceMinutes ?? 15),
      ...patch,
    };

    if (nextSettings.returnOverdueGraceMinutes < 0 || nextSettings.returnOverdueGraceMinutes > 180) {
      setMessage?.('복귀 지연 기준은 0~180분 사이로 입력하세요.');
      return;
    }

    try {
      setNotificationSaving(true);
      const data = await apiFetch('/api/report-send-config', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_attendance_notification_settings', settings: nextSettings }),
      });
      setMessage?.(data.message || '출결 알림 설정 저장 완료');
      await loadSendConfig?.();
    } catch (error) {
      setMessage?.(error.message || '출결 알림 설정 저장 실패');
    } finally {
      setNotificationSaving(false);
    }
  }

  const payloadPreview = testResult?.payload || {
    channel: 'kakao',
    reportType: 'daily | weekly | attendance',
    studentName: '테스트 학생',
    recipients: [{ relationship: '모', phone: '01000000000' }],
    messageText: '리포트 본문',
    requestedBy: '현재 접속자',
  };
  const activeTestMode = Boolean(sendConfig?.recipientPolicy?.testMode);

  return (
    <section className="content-card report-send-settings-tab">
      <div className={`attendance-notification-safety-banner ${activeTestMode ? 'test' : 'live'}`}>
        <div>
          <strong>{activeTestMode ? '현재 테스트모드 ON' : '현재 테스트모드 OFF'}</strong>
          <span>{activeTestMode ? '리포트와 출결 알림이 테스트 수신번호로 대체됩니다.' : '실제 보호자 연락처로 발송될 수 있습니다. 운영 전 설정을 확인하세요.'}</span>
        </div>
        <em>{activeTestMode ? (sendConfig?.recipientPolicy?.testRecipientCount ? '테스트 번호 설정됨' : '테스트 번호 미설정') : (sendConfig?.provider?.actualSendEnabled ? '실전 발송 가능' : 'Fail-safe / 설정 확인')}</em>
      </div>
      <div className="section-head">
        <div>
          <h2>설정 · 리포트 발송 설정</h2>
          <p>데일리/위클리 리포트와 출결 자동 알림톡 연결 상태를 확인합니다. 테스트 발송은 실제 학부모에게 전송하지 않습니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={loadSendConfig}>연결 상태 새로고침</button>
        </div>
      </div>

      <div className="send-settings-status-grid">
        <div className={`send-settings-card ${daily.configured ? 'connected' : 'pending'}`}>
          <strong>데일리 리포트</strong>
          <span>상태: {daily.configured ? '연결됨' : '미연결'}</span>
          <span>환경변수: {daily.envName || 'REPORT_SEND_WEBHOOK_URL'}</span>
          <em>{dailyMode}</em>
          <div className="send-settings-card-actions">
            <button className="secondary" onClick={() => runTest('daily')} disabled={testingType === 'daily'}>{testingType === 'daily' ? '생성 중...' : '테스트 payload 생성'}</button>
            <button className="primary" onClick={() => runWebhookTest('daily')} disabled={testingType === 'daily_webhook'}>{testingType === 'daily_webhook' ? '연결 테스트 중...' : 'Webhook 연결 테스트'}</button>
            <button className="secondary" onClick={() => runTemplateValidation('daily')} disabled={testingType === 'daily_template'}>{testingType === 'daily_template' ? '검증 중...' : '템플릿 변수 검증'}</button>
          </div>
        </div>

        <div className={`send-settings-card ${weekly.configured ? 'connected' : 'pending'}`}>
          <strong>위클리 리포트</strong>
          <span>상태: {weekly.configured ? '연결됨' : '미연결'}</span>
          <span>환경변수: {weekly.envName || 'WEEKLY_REPORT_SEND_WEBHOOK_URL'}</span>
          <em>{weeklyMode}</em>
          <div className="send-settings-card-actions">
            <button className="secondary" onClick={() => runTest('weekly')} disabled={testingType === 'weekly'}>{testingType === 'weekly' ? '생성 중...' : '테스트 payload 생성'}</button>
            <button className="primary" onClick={() => runWebhookTest('weekly')} disabled={testingType === 'weekly_webhook'}>{testingType === 'weekly_webhook' ? '연결 테스트 중...' : 'Webhook 연결 테스트'}</button>
            <button className="secondary" onClick={() => runTemplateValidation('weekly')} disabled={testingType === 'weekly_template'}>{testingType === 'weekly_template' ? '검증 중...' : '템플릿 변수 검증'}</button>
          </div>
        </div>

        <div className={`send-settings-card ${sendConfig?.attendance?.configured ? 'connected' : 'pending'}`}>
          <strong>출결 자동 알림</strong>
          <span>상태: {sendConfig?.attendance?.configured ? '템플릿 확인됨' : '템플릿 미설정'}</span>
          <span>환경변수: {sendConfig?.attendance?.solapiTemplateEnvName || sendConfig?.attendance?.templateEnvName || 'SOLAPI_TEMPLATE_ID_ATTENDANCE'}</span>
          <em>{sendConfig?.attendance?.modeLabel || '출결 템플릿 미설정'}</em>
          <div className="send-settings-card-actions">
            <button className="secondary" onClick={() => runTemplateValidation('attendance')} disabled={testingType === 'attendance_template'}>{testingType === 'attendance_template' ? '검증 중...' : '출결 변수 검증'}</button>
          </div>
        </div>

        <div className={`send-settings-card ${sendConfig?.parentConfirmation?.configured ? 'connected' : 'pending'}`}>
          <strong>학부모 확인 요청</strong>
          <span>상태: {sendConfig?.parentConfirmation?.configured ? '템플릿 확인됨' : '템플릿 미설정'}</span>
          <span>환경변수: {sendConfig?.parentConfirmation?.solapiTemplateEnvName || sendConfig?.parentConfirmation?.templateEnvName || 'SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION'}</span>
          <em>{sendConfig?.parentConfirmation?.modeLabel || '학부모 확인 요청 템플릿 미설정'}</em>
          <div className="send-settings-card-actions">
            <button className="secondary" onClick={() => runTemplateValidation('parent_confirmation')} disabled={testingType === 'parent_confirmation_template'}>{testingType === 'parent_confirmation_template' ? '검증 중...' : '확인요청 변수 검증'}</button>
          </div>
        </div>
      </div>

      <section className={`provider-adapter-card ${sendConfig?.provider?.actualSendEnabled ? 'live' : 'safe'}`}>
        <div className="send-payload-head">
          <div>
            <h3>카카오 제공자 어댑터 상태</h3>
            <p>실제 학부모 발송 가능 여부를 확인합니다. Fail-safe가 켜져 있으면 실제 카카오 발송을 차단합니다.</p>
          </div>
          {sendConfig?.provider?.actualSendEnabled ? <span className="status-pill failed">실전 발송 가능</span> : <span className="status-pill pending">Fail-safe / 대기</span>}
        </div>
        <div className="provider-status-grid">
          <div><span>Provider Mode</span><strong>{sendConfig?.provider?.mode || '-'}</strong></div>
          <div><span>Fail-safe</span><strong>{sendConfig?.provider?.failSafe ? 'ON' : 'OFF'}</strong></div>
          <div><span>실제 발송</span><strong>{sendConfig?.provider?.actualSendEnabled ? '가능' : '차단'}</strong></div>
          <div><span>실제 방식</span><strong>{sendConfig?.provider?.actualSendMethod || '-'}</strong></div>
          <div><span>Provider Webhook</span><strong>{sendConfig?.provider?.providerConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>Direct API</span><strong>{sendConfig?.provider?.directApiConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>Sender Key</span><strong>{sendConfig?.provider?.senderKeyConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>Direct Daily Template</span><strong>{sendConfig?.provider?.dailyTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>Direct Weekly Template</span><strong>{sendConfig?.provider?.weeklyTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>Direct Attendance Template</span><strong>{sendConfig?.provider?.attendanceTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI Ready</span><strong>{sendConfig?.provider?.solapiReady ? '준비됨' : '미완료'}</strong></div>
          <div><span>SOLAPI API Key</span><strong>{sendConfig?.provider?.solapiApiKeyConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI API Secret</span><strong>{sendConfig?.provider?.solapiApiSecretConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI Channel</span><strong>{sendConfig?.provider?.solapiChannelConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI Daily Template</span><strong>{sendConfig?.provider?.solapiDailyTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI Weekly Template</span><strong>{sendConfig?.provider?.solapiWeeklyTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>SOLAPI Attendance Template</span><strong>{sendConfig?.provider?.solapiAttendanceTemplateConfigured ? '설정됨' : '미설정'}</strong></div>
          <div><span>리포트 링크 DB</span><strong>{sendConfig?.reportLinks?.configured ? '정상' : 'SQL 필요'}</strong></div>
          <div><span>수신 테스트</span><strong>{sendConfig?.recipientPolicy?.testMode ? 'ON' : 'OFF'}</strong></div>
          <div><span>테스트 번호</span><strong>{sendConfig?.recipientPolicy?.testRecipientCount ? `${sendConfig.recipientPolicy.testRecipientCount}개` : '미설정'}</strong></div>
          <div><span>Allowlist</span><strong>{sendConfig?.recipientPolicy?.allowlistCount ? `${sendConfig.recipientPolicy.allowlistCount}개` : '미사용'}</strong></div>
          <div><span>Webhook Secret</span><strong>{sendConfig?.provider?.webhookSecretConfigured ? '사용' : '미사용'}</strong></div>
        </div>
        <div className={sendConfig?.provider?.actualSendEnabled ? 'provider-live-warning' : 'provider-safe-note'}>
          {sendConfig?.provider?.actualSendEnabled
            ? '현재 실제 발송 가능 상태입니다. 발송 버튼 클릭 시 학부모에게 메시지가 전송될 수 있으므로 운영 전 최종 확인이 필요합니다.'
            : '현재는 실제 발송이 차단되었거나 Webhook/SOLAPI 설정이 미완료되어 요청 접수/발송대기 중심으로 기록됩니다.'}
        </div>
      </section>

      <section className={`recipient-test-mode-card ${sendConfig?.recipientPolicy?.testMode ? 'active' : 'safe'}`}>
        <div className="send-payload-head">
          <div>
            <h3>1명 수신 테스트 / 수신번호 제한</h3>
            <p>실제 발송 전에는 테스트 수신번호로만 메시지가 가도록 제한할 수 있습니다. v41-06부터는 이 화면에서 테스트모드를 직접 ON/OFF할 수 있습니다.</p>
          </div>
          <div className="recipient-test-mode-actions">
            {sendConfig?.recipientPolicy?.testMode ? <span className="status-pill pending">테스트 모드 ON</span> : sendConfig?.recipientPolicy?.allowlistCount ? <span className="status-pill neutral">Allowlist 적용</span> : <span className="status-pill done">일반 발송</span>}
            <button className={sendConfig?.recipientPolicy?.testMode ? 'primary' : 'secondary'} onClick={() => setRecipientTestMode(true)} disabled={testModeSaving || sendConfig?.recipientPolicy?.testMode}>{testModeSaving ? '저장 중...' : '테스트모드 ON'}</button>
            <button className={!sendConfig?.recipientPolicy?.testMode ? 'primary' : 'secondary'} onClick={() => setRecipientTestMode(false)} disabled={testModeSaving || !sendConfig?.recipientPolicy?.testMode}>{testModeSaving ? '저장 중...' : '테스트모드 OFF'}</button>
          </div>
        </div>
        <div className="recipient-policy-grid">
          <div><span>테스트 모드</span><strong>{sendConfig?.recipientPolicy?.testMode ? 'ON' : 'OFF'}</strong></div>
          <div><span>설정 기준</span><strong>{sendConfig?.recipientPolicy?.testModeSource === 'dashboard' ? 'Beyond OS 화면 설정' : '환경변수 기본값'}</strong></div>
          <div><span>테스트 수신번호</span><strong>{sendConfig?.recipientPolicy?.testRecipientCount ? `${sendConfig.recipientPolicy.testRecipientCount}개 설정` : '미설정'}</strong></div>
          <div><span>Allowlist</span><strong>{sendConfig?.recipientPolicy?.allowlistCount ? `${sendConfig.recipientPolicy.allowlistCount}개` : '미사용'}</strong></div>
          <div><span>정책</span><strong>{sendConfig?.recipientPolicy?.modeLabel || '-'}</strong></div>
        </div>
        <div className="recipient-policy-guide">
          <code>테스트 수신번호 자체는 Vercel 환경변수 KAKAO_TEST_RECIPIENT_PHONE 또는 KAKAO_TEST_RECIPIENT_PHONES에 저장합니다.</code>
          <code>화면 ON/OFF 값은 Supabase system_settings.report_send_settings에 저장되어 KAKAO_RECIPIENT_TEST_MODE보다 우선 적용됩니다.</code>
          <code>KAKAO_RECIPIENT_ALLOWLIST=01000000000,01011112222</code>
        </div>
      </section>

      <section className="attendance-notification-settings-card clean-panel">
        <div className="send-payload-head">
          <div>
            <h3>출결 자동 알림 ON/OFF</h3>
            <p>입실·퇴실은 기본 발송, 외출·복귀는 필요할 때만 켤 수 있습니다. 복귀 지연 알림은 학생 시간표의 외출 복귀 예정시간을 기준으로 자동 점검합니다.</p>
          </div>
          <span className="status-pill neutral">v41-09</span>
        </div>
        <div className="notification-toggle-grid">
          <div>
            <strong>입실 알림</strong>
            <span>Beyond OS에 입실 기록 생성 시 발송</span>
            <button className={notificationPolicy.checkInEnabled !== false ? 'primary' : 'secondary'} onClick={() => saveAttendanceNotificationSettings({ checkInEnabled: !(notificationPolicy.checkInEnabled !== false) })} disabled={notificationSaving}>{notificationPolicy.checkInEnabled !== false ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <strong>퇴실 알림</strong>
            <span>Beyond OS에 퇴실 기록 생성 시 발송</span>
            <button className={notificationPolicy.checkOutEnabled !== false ? 'primary' : 'secondary'} onClick={() => saveAttendanceNotificationSettings({ checkOutEnabled: !(notificationPolicy.checkOutEnabled !== false) })} disabled={notificationSaving}>{notificationPolicy.checkOutEnabled !== false ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <strong>외출 알림</strong>
            <span>외출 기록 생성 시 학부모 알림 발송</span>
            <button className={notificationPolicy.awayEnabled ? 'primary' : 'secondary'} onClick={() => saveAttendanceNotificationSettings({ awayEnabled: !notificationPolicy.awayEnabled })} disabled={notificationSaving}>{notificationPolicy.awayEnabled ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <strong>복귀 알림</strong>
            <span>복귀 기록 생성 시 학부모 알림 발송</span>
            <button className={notificationPolicy.returnEnabled ? 'primary' : 'secondary'} onClick={() => saveAttendanceNotificationSettings({ returnEnabled: !notificationPolicy.returnEnabled })} disabled={notificationSaving}>{notificationPolicy.returnEnabled ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <strong>복귀 지연 알림</strong>
            <span>복귀 예정시간 초과 시 10분 주기 자동 점검</span>
            <button className={notificationPolicy.returnOverdueEnabled !== false ? 'primary' : 'secondary'} onClick={() => saveAttendanceNotificationSettings({ returnOverdueEnabled: !(notificationPolicy.returnOverdueEnabled !== false) })} disabled={notificationSaving}>{notificationPolicy.returnOverdueEnabled !== false ? 'ON' : 'OFF'}</button>
          </div>
          <div>
            <strong>복귀 지연 기준</strong>
            <span>예정시간 + 입력 분 이후 알림</span>
            <div className="inline-setting-control">
              <input type="number" min="0" max="180" step="5" value={notificationPolicy.returnOverdueGraceMinutes ?? 15} onChange={(e) => saveAttendanceNotificationSettings({ returnOverdueGraceMinutes: Number(e.target.value || 0) })} disabled={notificationSaving} />
              <em>분</em>
            </div>
          </div>
        </div>
        <div className="hint">복귀 지연 알림은 학생 시간표에 외출 시작·복귀 예정이 등록되어 있고, 현재 상태가 외출 중인 경우에만 발송됩니다. 중복 발송은 학생·알림종류·예정복귀시간 기준으로 차단됩니다.</div>
      </section>

      <div className="send-mode-grid">
        <div><strong>수동 발송 모드</strong><span>미리보기 문구를 복사해 직접 카카오톡으로 발송하고, 수동 발송완료 처리합니다.</span></div>
        <div><strong>발송대기 저장 모드</strong><span>Webhook이 없으면 실제 발송 없이 발송대기 상태와 payload만 저장합니다.</span></div>
        <div><strong>Webhook 연동 모드</strong><span>REPORT_SEND_WEBHOOK_URL 또는 WEEKLY_REPORT_SEND_WEBHOOK_URL이 설정되면 리포트 발송은 외부 발송 서버로 요청합니다. 출결 자동 알림은 내부 /api/kakao-send-webhook을 통해 동일 어댑터를 사용합니다.</span></div>
        <div><strong>Provider Adapter</strong><span>KAKAO_PROVIDER_MODE로 mock/webhook/kakao/kakao_ready/solapi를 선택하고, KAKAO_FAIL_SAFE_MODE로 실제 발송을 차단합니다.</span></div>
      </div>

      <section className="webhook-safety-checklist">
        <div className="send-payload-head">
          <div>
            <h3>실전 연결 전 체크리스트</h3>
            <p>Webhook 서버가 요청 수신과 실제 카카오 발송 완료를 구분해 응답하도록 확인하세요.</p>
          </div>
          <span className="status-pill pending">안전장치</span>
        </div>
        <div className="webhook-checklist-grid">
          <div><strong>1</strong><span>Webhook URL 환경변수 설정 완료</span></div>
          <div><strong>2</strong><span>Webhook 연결 테스트 성공</span></div>
          <div><strong>3</strong><span>테스트 payload는 실제 발송하지 않음 확인</span></div>
          <div><strong>4</strong><span>received/queued는 발송완료가 아닌 발송요청 접수로 처리</span></div>
          <div><strong>5</strong><span>실제 발송 완료 시 status: sent 반환</span></div>
          <div><strong>6</strong><span>실패 시 status: failed와 message/errorCode 반환</span></div>
        </div>
      </section>

      <section className="alimtalk-template-management-card compact-template-handoff">
        <div className="send-payload-head">
          <div>
            <h3>템플릿 설정은 알림톡 템플릿 관리에서 확인</h3>
            <p>리포트 발송 설정은 테스트모드, 출결 알림 ON/OFF, Fail-safe 같은 운영 정책만 관리합니다. 템플릿 ID, 필수 변수, 테스트 발송은 별도 탭으로 통합했습니다.</p>
          </div>
          <span className="status-pill neutral">중복 정리</span>
        </div>
        <div className="webhook-checklist-grid">
          <div><strong>템플릿 상태</strong><span>설정 → 알림톡 템플릿 관리</span></div>
          <div><strong>테스트 발송</strong><span>데일리·위클리·출결·학부모 확인 요청별 테스트 발송</span></div>
          <div><strong>필수 변수</strong><span>템플릿별 변수 누락 여부 통합 점검</span></div>
          <div><strong>위험 요소</strong><span>Fail-safe, 테스트번호, API 설정 상태 통합 확인</span></div>
        </div>
      </section>

      <section className="vercel-webhook-sample-card">
        <div className="send-payload-head">
          <div>
            <h3>Vercel Webhook 서버 샘플</h3>
            <p>Beyond OS 안에 샘플 Webhook API Route가 포함되었습니다. 실제 카카오 발송 서버가 준비되기 전까지 안전하게 수신/중복방지 흐름을 테스트할 수 있습니다.</p>
          </div>
          <span className="status-pill neutral">샘플 엔드포인트</span>
        </div>
        <div className="webhook-env-guide">
          <div>
            <strong>샘플 API Route</strong>
            <code>/api/kakao-send-webhook</code>
          </div>
          <div>
            <strong>데일리 환경변수</strong>
            <code>REPORT_SEND_WEBHOOK_URL=https://배포주소/api/kakao-send-webhook</code>
          </div>
          <div>
            <strong>위클리 환경변수</strong>
            <code>WEEKLY_REPORT_SEND_WEBHOOK_URL=https://배포주소/api/kakao-send-webhook</code>
          </div>
          <div>
            <strong>선택 보안값</strong>
            <code>REPORT_SEND_WEBHOOK_SECRET 또는 KAKAO_SEND_WEBHOOK_SECRET</code>
          </div>
        </div>
        <div className="direct-kakao-env-guide">
          <strong>SOLAPI 전용 Adapter 환경변수</strong>
          <code>KAKAO_PROVIDER_MODE=solapi</code>
          <code>KAKAO_FAIL_SAFE_MODE=true</code>
          <code>KAKAO_RECIPIENT_TEST_MODE=true</code>
          <code>KAKAO_TEST_RECIPIENT_PHONE=원장님_테스트번호</code>
          <code>SOLAPI_API_KEY=발급받은_API_KEY</code>
          <code>SOLAPI_API_SECRET=발급받은_API_SECRET</code>
          <code>SOLAPI_CHANNEL_ID=channelId_또는_pfId</code>
          <code>SOLAPI_TEMPLATE_ID_DAILY=데일리_templateId</code>
          <code>SOLAPI_TEMPLATE_ID_WEEKLY=위클리_templateId</code>
          <code>SOLAPI_TEMPLATE_ID_ATTENDANCE=출결_templateId</code>
          <code>SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION=학부모확인요청_templateId</code>
        </div>
        <div className="direct-kakao-env-guide">
          <strong>기존 Direct Kakao Adapter 환경변수</strong>
          <code>KAKAO_PROVIDER_MODE=kakao</code>
          <code>KAKAO_DIRECT_API_URL=https://카카오-또는-중계제공자-발송-API</code>
          <code>KAKAO_DIRECT_API_KEY=제공자_API_KEY</code>
          <code>KAKAO_SENDER_KEY=발신프로필_KEY</code>
          <code>KAKAO_TEMPLATE_CODE_DAILY=데일리_템플릿코드</code>
          <code>KAKAO_TEMPLATE_CODE_WEEKLY=위클리_템플릿코드</code>
          <code>KAKAO_TEMPLATE_CODE_ATTENDANCE=출결_템플릿코드</code>
          <code>KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION=학부모확인요청_템플릿코드</code>
        </div>
        <div className="hint">샘플 Webhook은 idempotencyKey 기준으로 중복 요청을 차단합니다. KAKAO_PROVIDER_MODE=solapi이면 내부 Webhook Route가 SOLAPI API로 변환 발송합니다.</div>
      </section>

      <section className="send-payload-preview">
        <div className="send-payload-head">
          <div>
            <h3>테스트 payload 미리보기</h3>
            <p>실제 카카오 발송은 하지 않고, 향후 Webhook 또는 SOLAPI API로 전달될 데이터 구조만 확인합니다.</p>
          </div>
          {testResult?.ok ? <span className="status-pill done">테스트 생성 완료</span> : testResult?.error ? <span className="status-pill failed">테스트 실패</span> : <span className="status-pill pending">대기</span>}
        </div>
        <pre>{JSON.stringify(payloadPreview, null, 2)}</pre>
      </section>

      <section className={`template-validation-result-card ${templateValidationResult?.ok ? 'ok' : templateValidationResult ? 'warn' : ''}`}>
        <div className="send-payload-head">
          <div>
            <h3>카카오 템플릿 변수 검증</h3>
            <p>발송 전 필수 템플릿 변수가 비어 있는지 확인합니다. 실제 발송/발송대기에서는 검증 실패 시 발송이 차단됩니다.</p>
          </div>
          {templateValidationResult?.ok ? <span className="status-pill done">검증 통과</span> : templateValidationResult ? <span className="status-pill failed">확인 필요</span> : <span className="status-pill pending">대기</span>}
        </div>

        {templateValidationResult ? (
          <>
            <div className="template-validation-summary">
              <div><span>리포트</span><strong>{getKakaoReportTypeLabel(templateValidationResult.reportType)}</strong></div>
              <div><span>필수 변수</span><strong>{templateValidationResult.required?.length || 0}개</strong></div>
              <div><span>누락</span><strong>{templateValidationResult.missing?.length || 0}개</strong></div>
              <div><span>경고</span><strong>{templateValidationResult.warnings?.length || 0}개</strong></div>
            </div>

            {templateValidationResult.missing?.length ? (
              <div className="template-validation-list failed">
                <strong>누락 변수</strong>
                <span>{templateValidationResult.missing.join(', ')}</span>
              </div>
            ) : null}

            {templateValidationResult.warnings?.length ? (
              <div className="template-validation-list warning">
                <strong>경고</strong>
                <span>{templateValidationResult.warnings.join(' / ')}</span>
              </div>
            ) : null}

            <pre>{JSON.stringify(templateValidationResult.variables || {}, null, 2)}</pre>
          </>
        ) : (
          <div className="all-clear">아직 템플릿 변수 검증을 실행하지 않았습니다.</div>
        )}
      </section>

      <section className="webhook-test-result-card">
        <div className="send-payload-head">
          <div>
            <h3>Webhook 연결 테스트 결과</h3>
            <p>테스트 요청은 <b>isTest: true</b>, <b>actualSend: false</b>로 전송됩니다. 발송 서버도 이 값을 기준으로 실제 카카오 발송을 하지 않도록 구성해야 합니다.</p>
          </div>
          {webhookTestResult?.ok ? <span className="status-pill done">성공</span> : webhookTestResult?.error || webhookTestResult?.ok === false ? <span className="status-pill failed">실패</span> : <span className="status-pill pending">대기</span>}
        </div>
        <div className="webhook-test-summary">
          <div><span>리포트</span><strong>{webhookTestResult?.reportType === 'weekly' ? '위클리' : webhookTestResult?.reportType === 'daily' ? '데일리' : '-'}</strong></div>
          <div><span>상태</span><strong>{webhookTestResult?.status || '-'}</strong></div>
          <div><span>환경변수</span><strong>{webhookTestResult?.envName || '-'}</strong></div>
          <div><span>응답</span><strong>{webhookTestResult?.message || webhookTestResult?.error || '-'}</strong></div>
        </div>
        <pre>{JSON.stringify(webhookTestResult?.standardResponse || webhookTestResult || { message: '아직 Webhook 연결 테스트를 실행하지 않았습니다.' }, null, 2)}</pre>
      </section>

      <div className="hint">
        중복 발송 방지를 위해 이미 발송대기 또는 발송완료 상태인 리포트는 발송 버튼 클릭 시 추가 확인창이 표시됩니다. 출결 자동 알림은 학생·출결종류·날짜·시각·기록방식 기준으로 중복 발송을 방지합니다.
      </div>
    </section>
  );
}


function formatKioskLogDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(value);
  }
}

function getKioskImportStatusLabel(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'processed') return '자동반영 완료';
  if (normalized === 'failed') return '자동반영 실패';
  if (normalized === 'duplicate') return '중복 무시';
  if (normalized === 'received') return '수신됨';
  if (normalized === 'pending') return '자동반영 보류';
  if (normalized === 'ignored') return '관리자 무시';
  if (normalized === 'reprocessed') return '재처리 완료';
  if (normalized === 'heartbeat') return 'Heartbeat';
  return status || '-';
}

function getKioskImportStatusClass(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'processed') return 'done';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'duplicate') return 'neutral';
  if (normalized === 'received' || normalized === 'pending') return 'pending';
  if (normalized === 'ignored') return 'neutral';
  if (normalized === 'reprocessed') return 'done';
  if (normalized === 'heartbeat') return 'done';
  return 'neutral';
}

function getKioskImportEventText(eventType = '') {
  return getKioskEventLabel(eventType) || '-';
}

function compactKioskRawText(raw = '') {
  return String(raw || '').replace(/\s+/g, ' ').trim() || '-';
}

function formatKioskErrorForOperator(error = '') {
  const text = String(error || '').trim();
  if (!text) return '-';
  if (/학생을 찾을 수 없습니다/.test(text)) return `${text} Beyond OS 학생명과 문자 학생명을 확인하세요.`;
  if (/좌석/.test(text) && /없|지정/.test(text)) return `${text} 학생 정보의 좌석 배정을 확인하세요.`;
  if (/입실 기록/.test(text)) return `${text} 좌석배치도에서 해당 학생의 현재 출결 상태를 확인하세요.`;
  if (/외출 상태/.test(text)) return `${text} 문자 유형과 현재 상태가 맞는지 확인하세요.`;
  if (/퇴실/.test(text) && /이미/.test(text)) return `${text} 중복 하원 문자 또는 수동 처리 여부를 확인하세요.`;
  if (/60초|수동 처리/.test(text)) return `${text} 이미 관리자가 같은 출결을 처리한 것으로 보입니다.`;
  return text;
}


function KioskBridgeSettingsTab({ apiFetch, setMessage }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [sourceDeviceId, setSourceDeviceId] = useState('sms-bridge-phone-01');
  const [rawText, setRawText] = useState('목동유쌤영어학원 김민준 님이 입장했습니다.');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [logFilter, setLogFilter] = useState('all');
  const [expandedLogId, setExpandedLogId] = useState('');
  const [bridgeSaving, setBridgeSaving] = useState(false);
  const [bridgeSettingsDraft, setBridgeSettingsDraft] = useState(null);
  const [logActionDrafts, setLogActionDrafts] = useState({});
  const [logActionLoading, setLogActionLoading] = useState('');

  useEffect(() => {
    if (config?.bridgeSettings) setBridgeSettingsDraft(config.bridgeSettings);
  }, [config?.bridgeSettings]);

  async function loadConfig() {
    try {
      setLoading(true);
      const data = await apiFetch('/api/kiosk-bridge-config');
      setConfig(data);
    } catch (error) {
      setConfig({ ok: false, error: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfig();
  }, []);

  const endpointUrl = config?.endpointUrl || (typeof window !== 'undefined' ? `${window.location.origin}/api/kiosk-attendance-bridge` : '/api/kiosk-attendance-bridge');
  const sampleMessages = config?.sampleMessages || {
    checkIn: '[Web발신]\n더플레이스26\n김민준 학생이 학원에 도착했어요.',
    away: '[Web발신]\n더플레이스26\n김민준 학생이 잠시 외출했어요.\n 사유: 타학원 수업',
    checkOut: '[Web발신]\n더플레이스26\n김민준 학생이 하원했어요.\n 재원시간: 09시00분 ~ 21시50분',
    return: '[Web발신]\n더플레이스26\n김민준 학생이 다시 돌아왔어요.',
    heartbeat: 'KIOSK_HEARTBEAT',
  };
  const bodyPreview = {
    rawText,
    sourceDeviceId,
    ...(idempotencyKey.trim() ? { idempotencyKey: idempotencyKey.trim() } : {}),
  };
  const recentImports = Array.isArray(config?.recentImports) ? config.recentImports : [];
  const activeStudents = Array.isArray(config?.activeStudents) ? config.activeStudents : [];
  const studentAliases = Array.isArray(config?.studentAliases) ? config.studentAliases : [];
  const operationSummary = config?.operationSummary || { total: 0, processed: 0, failed: 0, duplicate: 0, pending: 0, ignored: 0, reprocessed: 0, heartbeat: 0, successRate: 0, lastReceivedAt: null, lastProcessedAt: null, lastHeartbeatAt: null, lastAttendanceReceivedAt: null, lastSignalAt: null };
  const bridgeSettings = config?.bridgeSettings || { autoApplyEnabled: true, staleWarningMinutes: 60, heartbeatIntervalMinutes: 30, manualConflictWindowSeconds: 60, overnightCheckoutCorrectionEnabled: true, overnightCheckoutGraceMinutes: 60, operatingHoursEnabled: true, operationStartTime: '09:00', operationEndTime: '24:00', breakHoldBufferMinutes: 1, breakHoldDuplicateWindowSeconds: 30 };
  const draftSettings = bridgeSettingsDraft || bridgeSettings;
  const staleStatus = config?.staleStatus || { thresholdMinutes: 60, stale: false, minutesSinceLastSignal: null, minutesSinceLastHeartbeat: null, minutesSinceLastAttendance: null, message: '최근 수신 상태를 확인 중입니다.' };
  const autoApplyEnabled = bridgeSettings.autoApplyEnabled !== false;
  const bridgeStatusLabel = !autoApplyEnabled ? '자동반영 OFF' : staleStatus.stale ? '확인 필요' : staleStatus.status === 'outside_hours' ? '운영시간 외' : staleStatus.status === 'heartbeat_only' ? 'Heartbeat 정상' : '정상';
  const bridgeStatusDescription = !autoApplyEnabled ? '문자 수신 시 로그만 저장합니다.' : staleStatus.stale ? staleStatus.message : staleStatus.message || '최근 키오스크 수신/Heartbeat 기록이 정상 범위 안에 있습니다.';
  const filteredImports = recentImports.filter((item) => {
    const status = String(item?.status || '').toLowerCase();
    if (logFilter === 'all') return true;
    if (logFilter === 'processed') return status === 'processed';
    if (logFilter === 'failed') return status === 'failed';
    if (logFilter === 'duplicate') return status === 'duplicate';
    if (logFilter === 'pending') return status === 'received' || status === 'pending';
    if (logFilter === 'resolved') return status === 'ignored' || status === 'reprocessed';
    if (logFilter === 'heartbeat') return status === 'heartbeat' || String(item?.source || '').toLowerCase() === 'kiosk_heartbeat' || String(item?.parsed_event_type || '').toLowerCase() === 'heartbeat';
    return true;
  });
  const logStats = recentImports.reduce((acc, item) => {
    const status = String(item?.status || 'unknown').toLowerCase();
    acc.total += 1;
    if (status === 'processed') acc.processed += 1;
    else if (status === 'failed') acc.failed += 1;
    else if (status === 'duplicate') acc.duplicate += 1;
    else if (status === 'ignored') acc.ignored = (acc.ignored || 0) + 1;
    else if (status === 'reprocessed') acc.reprocessed = (acc.reprocessed || 0) + 1;
    else if (status === 'heartbeat' || String(item?.source || '').toLowerCase() === 'kiosk_heartbeat' || String(item?.parsed_event_type || '').toLowerCase() === 'heartbeat') acc.heartbeat = (acc.heartbeat || 0) + 1;
    else acc.pending += 1;
    return acc;
  }, { total: 0, processed: 0, failed: 0, duplicate: 0, pending: 0, ignored: 0, reprocessed: 0, heartbeat: 0 });

  async function saveBridgeSettings(nextSettings) {
    const merged = {
      ...bridgeSettings,
      ...(draftSettings || {}),
      autoApplyEnabled,
      staleWarningMinutes: Number(draftSettings.staleWarningMinutes || bridgeSettings.staleWarningMinutes || 60),
      manualConflictWindowSeconds: Number(draftSettings.manualConflictWindowSeconds ?? bridgeSettings.manualConflictWindowSeconds ?? 60),
      overnightCheckoutCorrectionEnabled: draftSettings.overnightCheckoutCorrectionEnabled ?? bridgeSettings.overnightCheckoutCorrectionEnabled ?? true,
      overnightCheckoutGraceMinutes: Number(draftSettings.overnightCheckoutGraceMinutes ?? bridgeSettings.overnightCheckoutGraceMinutes ?? 60),
      breakHoldBufferMinutes: Number(draftSettings.breakHoldBufferMinutes ?? bridgeSettings.breakHoldBufferMinutes ?? 1),
      breakHoldDuplicateWindowSeconds: Number(draftSettings.breakHoldDuplicateWindowSeconds ?? bridgeSettings.breakHoldDuplicateWindowSeconds ?? 30),
      ...(nextSettings || {}),
    };
    try {
      setBridgeSaving(true);
      const data = await apiFetch('/api/kiosk-bridge-config', {
        method: 'POST',
        body: JSON.stringify({ bridgeSettings: merged }),
      });
      setConfig((prev) => ({ ...(prev || {}), bridgeSettings: data.bridgeSettings || merged }));
      setMessage?.('키오스크 브릿지 설정 저장 완료');
      await loadConfig();
    } catch (error) {
      setMessage?.(error.message || '키오스크 브릿지 설정 저장 실패');
    } finally {
      setBridgeSaving(false);
    }
  }

  async function copyText(key, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setMessage?.('복사되었습니다.');
      window.setTimeout(() => setCopiedKey(''), 1600);
    } catch {
      setMessage?.('복사에 실패했습니다. 직접 선택해서 복사해 주세요.');
    }
  }

  function applySample(value) {
    setRawText(value);
    setTestResult(null);
  }

  async function runParsePreview() {
    if (!rawText.trim()) {
      setMessage?.('문자 원문을 입력하세요.');
      return;
    }
    try {
      setParseLoading(true);
      setParseResult(null);
      const data = await apiFetch('/api/kiosk-bridge-parse-test', {
        method: 'POST',
        body: JSON.stringify({ rawText }),
      });
      setParseResult(data.parseResult || data);
      setMessage?.('문자 원문 파싱 테스트 완료');
    } catch (error) {
      setParseResult({ ok: false, error: error.message || '문자 원문 파싱 테스트 실패' });
      setMessage?.(error.message || '문자 원문 파싱 테스트 실패');
    } finally {
      setParseLoading(false);
    }
  }


  function updateLogActionDraft(logId, patch) {
    setLogActionDrafts((prev) => ({
      ...(prev || {}),
      [logId]: { ...(prev?.[logId] || {}), ...patch },
    }));
  }

  async function runImportAction(item, action) {
    if (!item?.id) return;
    const draft = logActionDrafts[item.id] || {};
    if (action === 'alias_and_reprocess' && !draft.studentId) {
      setMessage?.('연결할 Beyond OS 학생을 선택하세요.');
      return;
    }
    try {
      setLogActionLoading(`${action}-${item.id}`);
      const data = await apiFetch('/api/kiosk-bridge-import-action', {
        method: 'POST',
        body: JSON.stringify({
          action,
          importEventId: item.id,
          studentId: draft.studentId || undefined,
          aliasName: draft.aliasName || item.parsed_student_name || '',
          memo: draft.memo || '',
        }),
      });
      setMessage?.(data.toastMessage || '키오스크 로그 처리 완료');
      await loadConfig();
    } catch (error) {
      setMessage?.(error.message || '키오스크 로그 처리 실패');
    } finally {
      setLogActionLoading('');
    }
  }

  async function deleteAlias(alias) {
    if (!alias?.id) return;
    try {
      setLogActionLoading(`delete-alias-${alias.id}`);
      const data = await apiFetch('/api/kiosk-bridge-import-action', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_alias', aliasId: alias.id }),
      });
      setMessage?.(data.toastMessage || '학생명 연결 규칙을 비활성화했습니다.');
      await loadConfig();
    } catch (error) {
      setMessage?.(error.message || '학생명 연결 규칙 삭제 실패');
    } finally {
      setLogActionLoading('');
    }
  }

  async function runBridgeTest() {
    const secret = secretInput.trim();
    if (!secret) {
      setMessage?.('테스트 전송에는 KIOSK_BRIDGE_SECRET 값이 필요합니다.');
      return;
    }
    if (!rawText.trim()) {
      setMessage?.('카카오 알림톡 원문을 입력하세요.');
      return;
    }
    try {
      setLoading(true);
      setTestResult(null);
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-kiosk-secret': secret,
        },
        body: JSON.stringify(bodyPreview),
      });
      const data = await response.json().catch(() => ({}));
      setTestResult({ httpStatus: response.status, ...data });
      if (!response.ok || data.ok === false) {
        setMessage?.(data.error || '키오스크 브릿지 테스트 전송 실패');
      } else {
        setMessage?.(data.toastMessage || '키오스크 브릿지 테스트 전송 성공');
      }
    } catch (error) {
      setTestResult({ ok: false, error: error.message });
      setMessage?.(error.message || '키오스크 브릿지 테스트 전송 실패');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="content-card kiosk-bridge-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 키오스크 브릿지 연결 가이드</h2>
          <p>안드로이드폰에 도착한 SMS/MMS 문자 원문 또는 카카오 알림톡 원문을 Beyond OS로 전달해 입실/외출/퇴실/재입장을 자동 반영합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={loadConfig} disabled={loading}>{loading ? '확인 중...' : '연결 정보 새로고침'}</button>
        </div>
      </div>

      <div className="kiosk-bridge-status-grid">
        <div><span>전송 URL</span><strong>{endpointUrl}</strong><button className="secondary mini" onClick={() => copyText('url', endpointUrl)}>{copiedKey === 'url' ? '복사됨' : '복사'}</button></div>
        <div><span>인증 헤더</span><strong>x-kiosk-secret</strong><button className="secondary mini" onClick={() => copyText('header', 'x-kiosk-secret')}>{copiedKey === 'header' ? '복사됨' : '복사'}</button></div>
        <div><span>Secret 상태</span><strong>{config?.secretConfigured ? 'Vercel 설정됨' : '미설정'}</strong><em>{config?.secretConfigured ? '자동화 앱에 같은 값을 입력' : 'KIOSK_BRIDGE_SECRET 필요'}</em></div>
        <div><span>SQL 점검</span><strong>{config?.diagnostics?.ok ? '정상' : '확인 필요'}</strong><em>{config?.diagnostics?.ok ? 'v40-115 SQL 반영됨' : '진단 카드 확인'}</em></div>
        <div><span>자동반영</span><strong>{autoApplyEnabled ? 'ON' : 'OFF'}</strong><em>{autoApplyEnabled ? '수신 즉시 출결 반영' : '로그만 저장 / 출결 미반영'}</em></div>
        <div><span>미수신 경고</span><strong>{staleStatus.thresholdMinutes || 60}분</strong><em>{staleStatus.stale ? '확인 필요' : '정상 범위'}</em></div>
        <div><span>Heartbeat 주기</span><strong>{bridgeSettings.heartbeatIntervalMinutes || 30}분</strong><em>MacroDroid 반복 실행</em></div>
        <div><span>중복 방지</span><strong>{bridgeSettings.manualConflictWindowSeconds ?? 60}초</strong><em>수동 처리 직후 키오스크 무시</em></div>
        <div><span>자정 퇴실 보정</span><strong>{bridgeSettings.overnightCheckoutCorrectionEnabled === false ? 'OFF' : `${bridgeSettings.overnightCheckoutGraceMinutes ?? 60}분`}</strong><em>실제 키오스크 퇴실 우선</em></div>
        <div><span>쉬는 시간 HOLD buffer</span><strong>{bridgeSettings.breakHoldBufferMinutes ?? 1}분</strong><em>다음 차시 시작 후 신호 지연 보정</em></div>
        <div><span>HOLD 중복 신호 방지</span><strong>{bridgeSettings.breakHoldDuplicateWindowSeconds ?? 30}초</strong><em>같은 학생·같은 신호 반복 제거</em></div>
        <div><span>운영시간 감시</span><strong>{bridgeSettings.operatingHoursEnabled === false ? 'OFF' : `${bridgeSettings.operationStartTime || '09:00'}~${bridgeSettings.operationEndTime || '24:00'}`}</strong><em>{staleStatus.insideOperatingHours === false ? '현재 운영시간 외' : '감시 적용 중'}</em></div>
        <div><span>기기 ID 예시</span><strong>{sourceDeviceId}</strong><button className="secondary mini" onClick={() => copyText('device', sourceDeviceId)}>{copiedKey === 'device' ? '복사됨' : '복사'}</button></div>
      </div>

      <section className={`kiosk-bridge-guide-card ${autoApplyEnabled ? '' : 'warn'}`}>
        <div className="send-payload-head">
          <div>
            <h3>키오스크 자동반영 안전모드</h3>
            <p>운영 중 자동반영을 잠시 멈추고 싶을 때 OFF로 전환하세요. OFF 상태에서는 문자 원문과 파싱 결과만 로그에 저장하고 좌석/출결은 변경하지 않습니다.</p>
          </div>
          <span className={`status-pill ${autoApplyEnabled ? 'done' : 'pending'}`}>{autoApplyEnabled ? '자동반영 ON' : '자동반영 OFF'}</span>
        </div>
        <div className="kiosk-log-summary-grid">
          <div><span>현재 상태</span><strong>{autoApplyEnabled ? '자동반영 중' : '로그만 저장'}</strong></div>
          <div><span>미수신 경고 기준</span><strong>{staleStatus.thresholdMinutes || 60}분</strong></div>
          <div><span>마지막 수신 경과</span><strong>{staleStatus.minutesSinceLastSignal === null || staleStatus.minutesSinceLastSignal === undefined ? '-' : `${staleStatus.minutesSinceLastSignal}분 전`}</strong></div>
          <div><span>브릿지 상태</span><strong>{bridgeStatusLabel}</strong></div>
        </div>
        {!autoApplyEnabled ? (
          <div className="status-alert warning">{bridgeStatusDescription}</div>
        ) : staleStatus.stale ? (
          <div className="status-alert warning">{bridgeStatusDescription}</div>
        ) : (
          <div className="status-alert success">{bridgeStatusDescription}</div>
        )}
        <div className="popup-bottom-actions">
          <button
            className={autoApplyEnabled ? 'secondary' : 'primary'}
            onClick={() => saveBridgeSettings({ autoApplyEnabled: !autoApplyEnabled })}
            disabled={bridgeSaving}
          >
            {bridgeSaving ? '저장 중...' : autoApplyEnabled ? '자동반영 OFF로 전환' : '자동반영 ON으로 전환'}
          </button>
        </div>
        <div className="hint">v41-04부터 출결 문자뿐 아니라 Heartbeat 신호도 최근 수신으로 인정합니다. 운영시간 안에서 60분 이상 아무 신호가 없을 때만 확인 필요로 표시됩니다.</div>
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>Heartbeat / 운영시간 감시 설정</h3>
            <p>학생 출입 문자가 없어도 브릿지폰이 살아있는지 확인하기 위해 MacroDroid가 주기적으로 Heartbeat를 전송하도록 설정합니다.</p>
          </div>
          <span className="status-pill neutral">v41-04 Heartbeat</span>
        </div>
        <div className="rules-grid">
          <div className="field">
            <label>Heartbeat 권장 주기(분)</label>
            <input type="number" min="5" max="180" value={draftSettings.heartbeatIntervalMinutes || 30} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), heartbeatIntervalMinutes: Number(e.target.value || 30) })} />
          </div>
          <div className="field">
            <label>미수신 경고 기준(분)</label>
            <input type="number" min="10" max="240" value={draftSettings.staleWarningMinutes || 60} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), staleWarningMinutes: Number(e.target.value || 60) })} />
          </div>
          <div className="field">
            <label>수동입력-키오스크 중복 방지(초)</label>
            <input type="number" min="0" max="600" value={draftSettings.manualConflictWindowSeconds ?? 60} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), manualConflictWindowSeconds: Number(e.target.value || 0) })} />
            <div className="hint">권장값 60초. 관리자가 먼저 처리한 직후 같은 키오스크 문자가 들어오면 중복으로 무시합니다.</div>
          </div>
          <div className="field">
            <label>쉬는 시간 HOLD buffer(분)</label>
            <input type="number" min="0" max="30" value={draftSettings.breakHoldBufferMinutes ?? 1} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), breakHoldBufferMinutes: Number(e.target.value || 0) })} />
            <div className="hint">기본값 1분. 차시 종료부터 다음 차시 시작 후 설정한 시간까지 키오스크 외출·복귀·퇴실·재입실 신호를 HOLD합니다. 마지막 차시 종료 후에는 HOLD하지 않고 즉시 출결 반영합니다.</div>
          </div>
          <div className="field">
            <label>HOLD 중복 신호 판단 시간(초)</label>
            <input type="number" min="5" max="120" value={draftSettings.breakHoldDuplicateWindowSeconds ?? 30} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), breakHoldDuplicateWindowSeconds: Number(e.target.value || 30) })} />
            <div className="hint">기본값 30초. 같은 학생의 같은 외출·복귀·퇴실·입실 신호가 설정 시간 안에 반복되면 첫 신호만 HOLD하고 나머지는 중복으로 무시합니다.</div>
          </div>
          <div className="field">
            <label>자정 이후 실제 퇴실 보정 허용(분)</label>
            <input type="number" min="0" max="180" value={draftSettings.overnightCheckoutGraceMinutes ?? 60} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), overnightCheckoutGraceMinutes: Number(e.target.value || 0) })} />
            <div className="hint">권장값 60분. 자정 자동마감 뒤 이 시간 안에 실제 키오스크 퇴실 문자가 들어오면 전날 세션의 실제 퇴실로 보정하고 퇴실 알림을 발송합니다.</div>
          </div>
          <div className="field checkbox-field">
            <label><input type="checkbox" checked={draftSettings.overnightCheckoutCorrectionEnabled !== false} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), overnightCheckoutCorrectionEnabled: e.target.checked })} /> 자정 이후 실제 퇴실 보정 사용</label>
            <div className="hint">OFF이면 자정 이후 퇴실 문자는 기존처럼 오늘 날짜 출결 상태 기준으로 처리됩니다.</div>
          </div>
          <div className="field">
            <label>운영 시작</label>
            <TimeSelect value={draftSettings.operationStartTime || '09:00'} onChange={(value) => setBridgeSettingsDraft({ ...(draftSettings || {}), operationStartTime: value })} />
          </div>
          <div className="field">
            <label>운영 종료</label>
            <TimeSelect value={draftSettings.operationEndTime || '24:00'} onChange={(value) => setBridgeSettingsDraft({ ...(draftSettings || {}), operationEndTime: value })} allow24 />
          </div>
          <div className="field full checkbox-field">
            <label><input type="checkbox" checked={draftSettings.operatingHoursEnabled !== false} onChange={(e) => setBridgeSettingsDraft({ ...(draftSettings || {}), operatingHoursEnabled: e.target.checked })} /> 운영시간 안에서만 미수신 경고 표시</label>
          </div>
        </div>
        <div className="kiosk-log-summary-grid">
          <div><span>마지막 신호</span><strong>{formatKioskLogDate(staleStatus.lastSignalAt || operationSummary.lastSignalAt)}</strong></div>
          <div><span>마지막 Heartbeat</span><strong>{formatKioskLogDate(staleStatus.lastHeartbeatAt || operationSummary.lastHeartbeatAt)}</strong></div>
          <div><span>마지막 출결 문자</span><strong>{formatKioskLogDate(staleStatus.lastAttendanceReceivedAt || operationSummary.lastAttendanceReceivedAt)}</strong></div>
          <div><span>운영시간 여부</span><strong>{staleStatus.insideOperatingHours === false ? '운영시간 외' : '운영시간 내'}</strong></div>
        </div>
        <div className="popup-bottom-actions">
          <button className="primary" onClick={() => saveBridgeSettings(draftSettings)} disabled={bridgeSaving}>{bridgeSaving ? '저장 중...' : 'Heartbeat/운영시간 설정 저장'}</button>
        </div>
        <div className="hint">권장값: Heartbeat 30분 주기, 미수신 경고 60분 기준, 쉬는 시간 HOLD buffer 1분, HOLD 중복 신호 30초, 자정 이후 실제 퇴실 보정 60분. 자정 시스템 자동퇴실은 학부모 알림 없이 내부 마감만 하고, 이후 실제 키오스크 퇴실이 들어오면 그때 퇴실 알림을 보냅니다.</div>
      </section>

      <section className={`kiosk-bridge-guide-card ${config?.diagnostics?.ok ? '' : 'warn'}`}>
        <div className="send-payload-head">
          <div>
            <h3>키오스크 브릿지 진단</h3>
            <p>500 오류가 날 때 원인을 빠르게 찾기 위한 SQL/환경 점검 결과입니다.</p>
          </div>
          <span className={`status-pill ${config?.diagnostics?.ok ? 'done' : 'failed'}`}>{config?.diagnostics?.ok ? '정상' : '확인 필요'}</span>
        </div>
        <div className="kiosk-diagnostic-list">
          {(config?.diagnostics?.checks || []).map((item) => (
            <div key={item.key} className={`kiosk-diagnostic-row ${item.ok ? 'ok' : 'failed'}`}>
              <strong>{item.label}</strong>
              <span>{item.message}</span>
              {item.error?.message ? <code>{item.error.message}</code> : null}
            </div>
          ))}
          {!config?.diagnostics?.checks?.length ? (
            <div className="hint">연결 정보 새로고침을 눌러 진단 결과를 불러오세요.</div>
          ) : null}
        </div>
      </section>

      <section className="kiosk-bridge-guide-card warn">
        <div className="send-payload-head">
          <div>
            <h3>먼저 해야 할 서버 설정</h3>
            <p>이 값이 없으면 외부에서 Beyond OS로 출결 정보를 보낼 수 없습니다. 실제 값은 화면에 표시하지 않습니다.</p>
          </div>
          <span className={`status-pill ${config?.secretConfigured ? 'done' : 'failed'}`}>{config?.secretConfigured ? '설정됨' : '필요'}</span>
        </div>
        <ol className="kiosk-steps">
          <li>Vercel 프로젝트의 Environment Variables에 <code>KIOSK_BRIDGE_SECRET</code>을 추가합니다.</li>
          <li>충분히 긴 랜덤 문자열을 값으로 넣습니다. 예: <code>beyond-kiosk-bridge-2026-랜덤문자열</code></li>
          <li>환경변수 추가 또는 수정 후에는 반드시 Production 재배포를 합니다.</li>
          <li>안드로이드 자동화 앱의 HTTP 요청 헤더에 같은 값을 <code>x-kiosk-secret</code>으로 넣습니다.</li>
        </ol>
      </section>


      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>학생명 수동 연결 규칙</h3>
            <p>키오스크 문자 학생명과 Beyond OS 학생명이 다를 때 한 번만 연결해두면 이후 같은 문자명은 자동 매칭됩니다.</p>
          </div>
          <span className="status-pill neutral">v41-05 Alias</span>
        </div>
        {config?.studentAliasesError ? <div className="status-alert warning">학생명 연결 규칙을 불러오지 못했습니다. v41-05 SQL 실행 여부를 확인하세요: {config.studentAliasesError}</div> : null}
        <div className="kiosk-alias-list">
          {studentAliases.map((alias) => (
            <div key={alias.id} className="kiosk-alias-item">
              <strong>{alias.alias_name}</strong>
              <span>→ {alias.student?.name || '학생 정보 없음'}</span>
              <button className="secondary mini" onClick={() => deleteAlias(alias)} disabled={logActionLoading === `delete-alias-${alias.id}`}>{logActionLoading === `delete-alias-${alias.id}` ? '처리 중' : '비활성화'}</button>
            </div>
          ))}
          {!studentAliases.length ? <div className="hint">아직 저장된 학생명 연결 규칙이 없습니다. 실패 로그를 펼쳐 “학생 연결 후 재처리”를 누르면 자동으로 추가됩니다.</div> : null}
        </div>
      </section>

      <section className="kiosk-bridge-guide-card kiosk-log-card">
        <div className="send-payload-head">
          <div>
            <h3>최근 키오스크 수신 로그</h3>
            <p>MacroDroid/SMS 브릿지에서 Beyond OS로 들어온 최근 50건의 원문, 파싱 결과, 처리 상태를 확인합니다.</p>
          </div>
          <button className="secondary" onClick={loadConfig} disabled={loading}>{loading ? '새로고침 중...' : '로그 새로고침'}</button>
        </div>
        <div className="kiosk-log-section-label">오늘 운영 요약</div>
        <div className="kiosk-log-summary-grid today">
          <div><span>오늘 수신</span><strong>{operationSummary.total || 0}</strong></div>
          <div><span>자동반영 성공</span><strong>{operationSummary.processed || 0}</strong></div>
          <div><span>성공률</span><strong>{operationSummary.total ? `${operationSummary.successRate || Math.round(((operationSummary.processed || 0) / operationSummary.total) * 100)}%` : '-'}</strong></div>
          <div><span>실패</span><strong>{operationSummary.failed || 0}</strong></div>
          <div><span>중복 무시</span><strong>{operationSummary.duplicate || 0}</strong></div>
          <div><span>재처리</span><strong>{operationSummary.reprocessed || 0}</strong></div>
          <div><span>관리자 무시</span><strong>{operationSummary.ignored || 0}</strong></div>
          <div><span>Heartbeat</span><strong>{operationSummary.heartbeat || 0}</strong></div>
          <div><span>마지막 신호</span><strong>{formatKioskLogDate(operationSummary.lastSignalAt || operationSummary.lastReceivedAt)}</strong></div>
          <div><span>브릿지 상태</span><strong>{bridgeStatusLabel}</strong></div>
        </div>
        {staleStatus.stale ? <div className="status-alert warning">{staleStatus.message}</div> : null}
        <div className="kiosk-log-section-label">최근 50건 요약</div>
        <div className="kiosk-log-summary-grid">
          <div><span>전체</span><strong>{logStats.total}</strong></div>
          <div><span>성공</span><strong>{logStats.processed}</strong></div>
          <div><span>실패</span><strong>{logStats.failed}</strong></div>
          <div><span>중복</span><strong>{logStats.duplicate}</strong></div>
          <div><span>수신/보류</span><strong>{logStats.pending}</strong></div>
          <div><span>재처리</span><strong>{logStats.reprocessed || 0}</strong></div>
          <div><span>무시</span><strong>{logStats.ignored || 0}</strong></div>
          <div><span>Heartbeat</span><strong>{logStats.heartbeat || 0}</strong></div>
        </div>
        <div className="kiosk-log-filter-row">
          {[
            ['all', '전체'],
            ['processed', '성공'],
            ['failed', '실패'],
            ['duplicate', '중복'],
            ['pending', '수신/보류'],
            ['resolved', '관리자 처리'],
            ['heartbeat', 'Heartbeat'],
          ].map(([key, label]) => (
            <button key={key} className={logFilter === key ? 'active' : ''} onClick={() => setLogFilter(key)}>{label}</button>
          ))}
        </div>
        {config?.recentImportsError ? (
          <div className="status-alert warning">최근 수신 로그를 불러오지 못했습니다: {config.recentImportsError}</div>
        ) : null}
        <div className="kiosk-log-table-wrap">
          <table className="kiosk-log-table">
            <thead>
              <tr>
                <th>수신시각</th>
                <th>상태</th>
                <th>유형</th>
                <th>학생</th>
                <th>기기</th>
                <th>원문 요약</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {filteredImports.map((item) => {
                const isExpanded = expandedLogId === item.id;
                const statusClass = getKioskImportStatusClass(item.status);
                return (
                  <Fragment key={item.id}>
                    <tr className="kiosk-log-row" onClick={() => setExpandedLogId(isExpanded ? '' : item.id)}>
                      <td>{formatKioskLogDate(item.received_at || item.created_at)}</td>
                      <td><span className={`status-pill ${statusClass}`}>{getKioskImportStatusLabel(item.status)}</span></td>
                      <td>{getKioskImportEventText(item.parsed_event_type)}</td>
                      <td>{item.parsed_student_name || '-'}</td>
                      <td>{item.source_device_id || '-'}</td>
                      <td className="kiosk-log-raw-compact">{compactKioskRawText(item.raw_text)}</td>
                      <td>{item.operator_action ? getKioskImportStatusLabel(item.status) : '-'}</td>
                    </tr>
                    {isExpanded ? (
                      <tr className="kiosk-log-detail-row">
                        <td colSpan="7">
                          <div className="kiosk-log-detail-grid">
                            <div><span>처리시각</span><strong>{formatKioskLogDate(item.processed_at)}</strong></div>
                            <div><span>좌석</span><strong>{item.seat_no ? `${item.seat_no}번` : '-'}</strong></div>
                            <div><span>외출/기타 사유</span><strong>{item.parsed_reason || '-'}</strong></div>
                            <div><span>재원시간 원문</span><strong>{item.parsed_duration || '-'}</strong></div>
                            <div><span>Import ID</span><code>{item.id}</code></div>
                            <div><span>Idempotency Key</span><code>{item.idempotency_key || '-'}</code></div>
                            <div><span>관리자 처리</span><strong>{item.operator_action || '-'}</strong></div>
                            <div><span>연결된 재처리 로그</span><code>{item.linked_import_event_id || '-'}</code></div>
                          </div>
                          {item.error_message ? <div className="status-alert error">실패 사유: {formatKioskErrorForOperator(item.error_message)}</div> : null}
                          <div className="kiosk-log-action-panel">
                            <div className="send-payload-head">
                              <div>
                                <h4>관리자 처리</h4>
                                <p>미매칭/실패 로그는 학생을 연결한 뒤 바로 재처리할 수 있습니다. 단, 재처리는 실제 출결에 반영됩니다.</p>
                              </div>
                              <span className="status-pill neutral">v41-05</span>
                            </div>
                            <div className="rules-grid">
                              <div className="field">
                                <label>문자 학생명</label>
                                <input value={(logActionDrafts[item.id]?.aliasName ?? item.parsed_student_name ?? '')} onChange={(event) => updateLogActionDraft(item.id, { aliasName: event.target.value })} placeholder="문자에 찍힌 학생명" />
                              </div>
                              <div className="field">
                                <label>연결할 Beyond OS 학생</label>
                                <select value={logActionDrafts[item.id]?.studentId || ''} onChange={(event) => updateLogActionDraft(item.id, { studentId: event.target.value })}>
                                  <option value="">학생 선택</option>
                                  {activeStudents.map((student) => (
                                    <option key={student.id} value={student.id}>{student.name}{student.grade ? ` · ${student.grade}` : ''}{student.default_seat_no ? ` · ${student.default_seat_no}번` : ''}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="field full">
                                <label>관리자 메모</label>
                                <input value={logActionDrafts[item.id]?.memo || ''} onChange={(event) => updateLogActionDraft(item.id, { memo: event.target.value })} placeholder="예: 문자명과 등록명이 달라 연결 후 재처리" />
                              </div>
                            </div>
                            <div className="popup-bottom-actions">
                              <button className="primary" onClick={(event) => { event.stopPropagation(); runImportAction(item, 'alias_and_reprocess'); }} disabled={Boolean(logActionLoading)}>{logActionLoading === `alias_and_reprocess-${item.id}` ? '재처리 중...' : '학생 연결 후 재처리'}</button>
                              <button className="secondary" onClick={(event) => { event.stopPropagation(); runImportAction(item, 'reprocess'); }} disabled={Boolean(logActionLoading)}>{logActionLoading === `reprocess-${item.id}` ? '재처리 중...' : '그대로 재처리'}</button>
                              <button className="secondary" onClick={(event) => { event.stopPropagation(); runImportAction(item, 'ignore'); }} disabled={Boolean(logActionLoading)}>{logActionLoading === `ignore-${item.id}` ? '처리 중...' : '이 로그 무시'}</button>
                            </div>
                          </div>
                          <div className="kiosk-log-raw-block">
                            <div className="send-payload-head">
                              <h4>수신 원문 raw_text</h4>
                              <button className="secondary mini" onClick={(event) => { event.stopPropagation(); copyText(`raw-${item.id}`, item.raw_text || ''); }}>{copiedKey === `raw-${item.id}` ? '복사됨' : '원문 복사'}</button>
                            </div>
                            <pre>{item.raw_text || '-'}</pre>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!filteredImports.length ? (
                <tr><td colSpan="7" className="empty-table-cell">표시할 키오스크 수신 로그가 없습니다. 실제 문자 수신 후 로그 새로고침을 눌러 확인하세요.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="hint">행을 클릭하면 원문 전체와 실패 사유를 펼쳐볼 수 있습니다. 자동반영이 안 될 때는 먼저 raw_text가 문자 원문 그대로 들어왔는지 확인하세요.</div>
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>SMS/Web발신 문자 원문 샘플</h3>
            <p>v40-121부터 [Web발신] 줄바꿈 문자와 text/plain 원문 수신을 지원하며, “학원에 도착했어요/잠시 외출했어요/다시 돌아왔어요/하원했어요” 형식까지 인식합니다. MacroDroid에서는 JSON 대신 text/plain Body에 SMS 본문 변수를 그대로 넣는 방식을 권장합니다.</p>
          </div>
          <span className="status-pill neutral">v40-121 SMS parser</span>
        </div>
        <div className="kiosk-sample-grid">
          <button onClick={() => applySample(sampleMessages.checkIn)}><strong>입실</strong><span>{sampleMessages.checkIn}</span></button>
          <button onClick={() => applySample(sampleMessages.away)}><strong>외출</strong><span>{sampleMessages.away}</span></button>
          <button onClick={() => applySample(sampleMessages.checkOut)}><strong>퇴실</strong><span>{sampleMessages.checkOut}</span></button>
          <button onClick={() => applySample(sampleMessages.return)}><strong>재입장</strong><span>{sampleMessages.return}</span></button>
          <button onClick={() => applySample(sampleMessages.heartbeat || 'KIOSK_HEARTBEAT')}><strong>Heartbeat</strong><span>{sampleMessages.heartbeat || 'KIOSK_HEARTBEAT'}</span></button>
        </div>
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>문자 원문 파서 테스트</h3>
            <p>실제 출결에 반영하지 않고, 문자 원문에서 학생명/출결유형/사유가 어떻게 추출되는지만 미리 확인합니다.</p>
          </div>
          <span className="status-pill neutral">Dry run</span>
        </div>
        <div className="rules-grid">
          <div className="field full">
            <label>테스트할 SMS/Web발신 원문</label>
            <textarea value={rawText} onChange={(e) => { setRawText(e.target.value); setParseResult(null); }} placeholder={"[Web발신]\n더플레이스26\n김민준 학생이 학원에 도착했어요."} />
          </div>
        </div>
        <div className="popup-bottom-actions">
          <button className="secondary" onClick={runParsePreview} disabled={parseLoading}>{parseLoading ? '분석 중...' : '출결 반영 없이 파싱만 테스트'}</button>
        </div>
        {parseResult ? (
          <div className={`kiosk-test-result ${parseResult.ok ? 'done' : 'failed'}`}>
            <strong>{parseResult.ok ? '파싱 가능' : '파싱 실패'}</strong>
            <span>{parseResult.message || parseResult.error || '-'}</span>
            <div className="kiosk-log-detail-grid">
              <div><span>학생명</span><strong>{parseResult.studentName || '-'}</strong></div>
              <div><span>학생 매칭</span><strong>{parseResult.matched ? '매칭됨' : '미매칭'}</strong></div>
              <div><span>출결 유형</span><strong>{getKioskImportEventText(parseResult.eventType)}</strong></div>
              <div><span>사유</span><strong>{parseResult.reason || '-'}</strong></div>
              <div><span>재원시간 원문</span><strong>{parseResult.duration || '-'}</strong></div>
              <div><span>처리 가능 여부</span><strong>{parseResult.canAutoApply ? '가능' : '확인 필요'}</strong></div>
            </div>
            <pre>{JSON.stringify(parseResult, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>Beyond OS 수신 테스트</h3>
            <p>아래 테스트는 실제로 학생 출결을 반영합니다. 반드시 테스트 학생명 또는 실제 확인 가능한 학생명으로만 실행하세요.</p>
          </div>
          <span className="status-pill pending">실제 반영 테스트</span>
        </div>
        <div className="rules-grid">
          <div className="field full">
            <label>SMS/Web발신 문자 원문 rawText</label>
            <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={"[Web발신]\n더플레이스26\n김민준 학생이 학원에 도착했어요."} />
          </div>
          <div className="field">
            <label>sourceDeviceId</label>
            <input value={sourceDeviceId} onChange={(e) => setSourceDeviceId(e.target.value)} placeholder="sms-bridge-phone-01" />
          </div>
          <div className="field">
            <label>idempotencyKey</label>
            <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="비워두면 서버가 자동 생성" />
            <div className="hint">같은 알림 중복 처리를 막는 고유값입니다. MacroDroid에서 만들기 어렵다면 비워도 됩니다.</div>
          </div>
          <div className="field">
            <label>KIOSK_BRIDGE_SECRET 테스트 입력</label>
            <input type="password" value={secretInput} onChange={(e) => setSecretInput(e.target.value)} placeholder="Vercel 환경변수와 같은 값" />
            <div className="hint">저장하지 않고 이번 테스트 요청에만 사용합니다.</div>
          </div>
        </div>
        <div className="kiosk-json-preview">
          <div className="send-payload-head">
            <div><h4>자동화 앱 JSON Body 테스트용</h4><p>이 화면의 자체 테스트는 JSON으로 보내지만, 실제 MacroDroid 문자 자동화는 text/plain Body 사용을 권장합니다.</p></div>
            <button className="secondary" onClick={() => copyText('json', JSON.stringify(bodyPreview, null, 2))}>{copiedKey === 'json' ? '복사됨' : 'JSON 복사'}</button>
          </div>
          <pre>{JSON.stringify(bodyPreview, null, 2)}</pre>
        </div>
        <div className="popup-bottom-actions">
          <button className="primary" onClick={runBridgeTest} disabled={loading}>{loading ? '전송 중...' : 'Beyond OS로 테스트 전송'}</button>
        </div>
        {testResult ? (
          <div className={`kiosk-test-result ${testResult.ok ? 'done' : 'failed'}`}>
            <strong>{testResult.ok ? '테스트 성공' : '테스트 실패'}</strong>
            <span>{testResult.toastMessage || testResult.error || testResult.message || '-'}</span>
            {!testResult.ok ? (
              <div className="kiosk-error-summary">
                <p><b>HTTP 상태:</b> {testResult.httpStatus || '-'}</p>
                <p><b>오류 단계:</b> {testResult.stage || '-'}</p>
                {testResult.hint ? <p><b>조치:</b> {testResult.hint}</p> : null}
                {testResult.parsedStudentName ? <p><b>파싱된 학생명:</b> {testResult.parsedStudentName}</p> : null}
              </div>
            ) : null}
            <pre>{JSON.stringify(testResult, null, 2)}</pre>
          </div>
        ) : null}
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>MacroDroid 자동화 앱 설정 순서</h3>
            <p>브릿지폰에서 SMS/MMS 문자 수신을 감지한 뒤 위 전송 URL로 HTTP POST 요청을 보내는 방식입니다.</p>
          </div>
          <span className="status-pill neutral">추천 파일럿</span>
        </div>
        <ol className="kiosk-steps">
          <li>브릿지용 안드로이드폰에서 키오스크 Web발신 문자/MMS가 정상 수신되는지 확인합니다.</li>
          <li>MacroDroid를 설치하고 문자/SMS 권한과 백그라운드 실행 권한을 허용합니다.</li>
          <li>새 매크로를 만들고 Trigger를 <b>SMS 수신</b> 또는 문자 앱 <b>Notification Received</b>로 설정합니다. 문자 내용 조건은 <code>더플레이스26</code> 포함으로 둡니다.</li>
          <li>Action에서 <b>HTTP Request</b>를 추가하고 Method는 <code>POST</code>, URL은 위 전송 URL을 넣습니다.</li>
          <li>Headers에는 <code>x-kiosk-secret: KIOSK_BRIDGE_SECRET 값</code>을 넣고, 필요 시 <code>x-source-device-id: sms-bridge-phone-01</code>을 추가합니다.</li>
          <li>Body 내용 탭의 컨텐츠 타입은 <code>text/plain</code>으로 선택하고, Body에는 SMS 본문 매직텍스트만 그대로 넣습니다. JSON으로 감싸지 않습니다.</li>
          <li>추가로 Heartbeat 매크로를 하나 더 만들고 Trigger를 <b>30분마다 반복</b>으로 설정합니다. HTTP 설정은 같은 URL/secret을 사용하되 Body에는 <code>KIOSK_HEARTBEAT</code>만 넣습니다.</li>
          <li>Heartbeat 매크로에는 헤더 <code>x-source-device-id: sms-bridge-phone-01</code>을 추가하면 브릿지폰별 상태 확인이 쉬워집니다.</li>
          <li>문자 원문은 <code>[Web발신] 더플레이스26 OOO 학생이 학원에 도착했어요 / 잠시 외출했어요 / 다시 돌아왔어요 / 하원했어요</code> 형식을 지원합니다.</li>
          <li>배터리 최적화에서 MacroDroid와 문자 앱을 제외하고, 브릿지폰은 충전 상태로 고정 운영합니다.</li>
        </ol>
      </section>

      <section className="kiosk-bridge-guide-card">
        <div className="send-payload-head">
          <div>
            <h3>운영 전 확인 체크리스트</h3>
            <p>처음에는 반드시 테스트 학생 1명으로 하루 정도 수동 출결과 자동 출결을 비교하세요.</p>
          </div>
          <span className="status-pill pending">파일럿 권장</span>
        </div>
        <div className="webhook-checklist-grid">
          <div><strong>1</strong><span>SMS/MMS 문자 본문에 학생명/사유가 모두 포함됨</span></div>
          <div><strong>2</strong><span>Beyond OS 학생명과 문자 학생명이 정확히 일치함</span></div>
          <div><strong>3</strong><span>동명이인은 이름 뒤 구분표시를 붙여 등록함</span></div>
          <div><strong>4</strong><span>입실·외출·재입장·퇴실 4종 테스트 성공</span></div>
          <div><strong>5</strong><span>우측 하단 자동반영 알림과 최근 출결 이력 배지 확인</span></div>
          <div><strong>6</strong><span>attendance_import_events에 원문 로그가 저장됨</span></div>
          <div><strong>7</strong><span>Heartbeat 매크로가 30분마다 전송되고 최근 신호로 표시됨</span></div>
        </div>
      </section>
    </section>
  );
}


function validateScheduleVariantDraft(variant = {}, dayLabel = '') {
  const errors = [];
  const prefix = dayLabel ? `[${dayLabel}] ` : '';
  const inMinute = timeToMinutes(variant.plannedCheckIn);
  const outMinute = timeToMinutes(variant.plannedCheckOut);
  if (!isFiveMinuteTime24(variant.plannedCheckIn)) errors.push(`${prefix}기본 예정 등원은 5분 단위 HH:MM 형식이어야 합니다.`);
  if (!isFiveMinuteTime24(variant.plannedCheckOut)) errors.push(`${prefix}기본 예정 하원은 5분 단위 HH:MM 형식이어야 합니다.`);
  if (inMinute !== null && outMinute !== null && outMinute <= inMinute) errors.push(`${prefix}기본 예정 하원은 기본 예정 등원보다 늦어야 합니다.`);
  (variant.studyWindows || []).forEach((item, index) => {
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);
    if (!String(item.label || '').trim()) errors.push(`${prefix}${index + 1}번째 구간: 이름을 입력하세요.`);
    if (!isFiveMinuteTime24(item.start)) errors.push(`${prefix}${index + 1}번째 구간: 시작시간은 5분 단위 HH:MM 형식이어야 합니다.`);
    if (!isFiveMinuteTime24(item.end)) errors.push(`${prefix}${index + 1}번째 구간: 종료시간은 5분 단위 HH:MM 형식이어야 합니다.`);
    if (start !== null && end !== null && end <= start) errors.push(`${prefix}${index + 1}번째 구간: 종료시간은 시작시간보다 늦어야 합니다.`);
  });
  return errors;
}

function DefaultScheduleSettingsTab({ defaultScheduleConfig, defaultScheduleConfigDraft, setDefaultScheduleConfigDraft, saveDefaultSchedule, defaultScheduleLoading, students = [], bulkGenerateSchedules, scheduleCoverage = null }) {
  const [activeDayType, setActiveDayType] = useState('weekday');
  const [overrideBaseDate, setOverrideBaseDate] = useState(getKstDateString());
  const [bulkStart, setBulkStart] = useState(getKstDateString());
  const [bulkEnd, setBulkEnd] = useState(addDays(getKstDateString(), 27));
  const [bulkTargetStudentId, setBulkTargetStudentId] = useState('all');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [selectedOverrideDate, setSelectedOverrideDate] = useState('');

  const configDraft = defaultScheduleConfigDraft && defaultScheduleConfigDraft.variants
    ? defaultScheduleConfigDraft
    : normalizeDefaultScheduleConfig(defaultScheduleConfigDraft || DEFAULT_SCHEDULE_CONFIG);
  const variants = configDraft.variants || DEFAULT_SCHEDULE_CONFIG.variants;
  const holidays = Array.isArray(configDraft.holidays) ? configDraft.holidays : [];
  const dateOverrides = configDraft.dateOverrides && typeof configDraft.dateOverrides === 'object' ? configDraft.dateOverrides : {};
  const variant = variants[activeDayType] || variants.weekday;
  const dayLabel = DEFAULT_SCHEDULE_DAY_TYPE_LABELS[activeDayType];

  // 날짜별 예외 운영 달력 데이터
  const overrideMonthDates = makeDateRange(startOfMonth(overrideBaseDate), endOfMonth(overrideBaseDate));
  const overrideMonthLabel = overrideBaseDate.slice(0, 7).replace('-', '년 ') + '월';

  function shiftOverrideMonth(direction) {
    const d = new Date(`${startOfMonth(overrideBaseDate)}T00:00:00`);
    d.setMonth(d.getMonth() + direction);
    setOverrideBaseDate(getKstDateString(d));
  }

  function setDateOverride(date, dayType) {
    if (!date) return;
    const next = { ...dateOverrides };
    if (!dayType) delete next[date];
    else next[date] = dayType;
    // '지정 해제(자동)' 시 구버전 공휴일 목록에 등록된 날짜도 함께 해제합니다.
    // (공휴일 지정 메뉴는 v41-45에서 이 달력으로 통합됨)
    const nextHolidays = !dayType ? holidays.filter((item) => item !== date) : holidays;
    setDefaultScheduleConfigDraft({ ...configDraft, dateOverrides: next, holidays: nextHolidays });
  }

  // dateOverrides를 제외한 '자동 판정' 유형 (지정 해제 시 돌아갈 값 안내용)
  function getAutoDayType(date) {
    return getDayTypeForDate({ holidays }, date);
  }

  async function runBulkGenerate() {
    if (!bulkGenerateSchedules) return;
    const targetStudent = bulkTargetStudentId !== 'all' ? students.find((student) => String(student.id) === String(bulkTargetStudentId)) : null;
    const confirmed = window.confirm(
      `${targetStudent ? `${targetStudent.name} 학생` : '전체 학생'} · ${bulkStart} ~ ${bulkEnd}\n\n요일 유형별 기본 시간표(운영일 기준)로 개인 시간표를 일괄 생성합니다.\n이미 저장된 날짜는 변경하지 않습니다. 진행할까요?`
    );
    if (!confirmed) return;
    setBulkWorking(true);
    try {
      await bulkGenerateSchedules({ studentIds: targetStudent ? [targetStudent.id] : null, startDate: bulkStart, endDate: bulkEnd });
    } finally {
      setBulkWorking(false);
    }
  }

  function updateVariant(nextVariant) {
    setDefaultScheduleConfigDraft({
      ...configDraft,
      variants: { ...variants, [activeDayType]: nextVariant },
    });
  }

  function updateField(key, value) {
    updateVariant({ ...variant, [key]: value });
  }

  function updateWindow(index, key, value) {
    const windows = [...(variant.studyWindows || [])];
    windows[index] = { ...(windows[index] || {}), [key]: value };
    // 입력 중 24:00 같은 값을 보존하기 위해 정규화는 저장/불러오기에서 한 번 더 수행합니다.
    updateVariant({ ...variant, studyWindows: windows });
  }

  function addWindow() {
    const last = variant.studyWindows?.[variant.studyWindows.length - 1];
    const startMinute = Math.min(23 * 60, (timeToMinutes(last?.end) ?? 9 * 60));
    const endMinute = Math.min(24 * 60, startMinute + 50);
    updateVariant({
      ...variant,
      studyWindows: [
        ...(variant.studyWindows || []),
        { label: `${(variant.studyWindows || []).length + 1}차시`, start: minutesToTime(startMinute), end: minutesToTime(endMinute) },
      ],
    });
  }

  function removeWindow(index) {
    const windows = (variant.studyWindows || []).filter((_, rowIndex) => rowIndex !== index);
    updateVariant({ ...variant, studyWindows: windows.length ? windows : DEFAULT_SCHEDULE_SETTINGS.studyWindows });
  }

  function copyFromWeekday() {
    const base = variants.weekday || DEFAULT_SCHEDULE_CONFIG.variants.weekday;
    updateVariant({
      ...variant,
      scheduleLabel: base.scheduleLabel,
      plannedCheckIn: base.plannedCheckIn,
      plannedCheckOut: base.plannedCheckOut,
      studyWindows: (base.studyWindows || []).map((item) => ({ ...item })),
    });
  }

  function resetDraft() {
    setDefaultScheduleConfigDraft(normalizeDefaultScheduleConfig(DEFAULT_SCHEDULE_CONFIG));
  }

  function loadCurrent() {
    setDefaultScheduleConfigDraft(normalizeDefaultScheduleConfig(defaultScheduleConfig || DEFAULT_SCHEDULE_CONFIG));
  }

  const activeErrors = validateScheduleVariantDraft(variant, '');
  const allErrors = DEFAULT_SCHEDULE_DAY_TYPES.flatMap((dt) => validateScheduleVariantDraft(variants[dt] || {}, DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dt]));
  const totalStudyMinutes = (variant.studyWindows || []).reduce((sum, item) => {
    const start = timeToMinutes(item.start);
    const end = timeToMinutes(item.end);
    return start !== null && end !== null && end > start ? sum + (end - start) : sum;
  }, 0);

  return (
    <section className="content-card operating-rules-tab default-schedule-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 기본 시간표 (요일 유형별)</h2>
          <p>평일 · 토요일 · 일요일 · 공휴일 시간표를 각각 설정합니다. 이 시간표는 차시(순공 인정) 구간의 기준이며, 학생 시간표 탭의 일괄 생성과 신규 입력 기본값으로 사용됩니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={loadCurrent} disabled={defaultScheduleLoading}>현재값 불러오기</button>
          <button className="secondary section-action" onClick={resetDraft} disabled={defaultScheduleLoading}>기본값</button>
          <button className="primary section-action" onClick={() => saveDefaultSchedule(configDraft)} disabled={defaultScheduleLoading || allErrors.length > 0}>{defaultScheduleLoading ? '저장 중...' : '기본 시간표 저장'}</button>
        </div>
      </div>

      <div className="planner-head-actions day-type-tabs" style={{ flexWrap: 'wrap', marginBottom: '16px' }}>
        {DEFAULT_SCHEDULE_DAY_TYPES.map((dt) => (
          <button
            key={dt}
            className={`section-action ${activeDayType === dt ? 'primary' : 'secondary'}`}
            onClick={() => setActiveDayType(dt)}
          >
            {DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dt]}
            {variants[dt]?.enabled === false ? ' · 휴무' : ''}
          </button>
        ))}
      </div>

      <div className="rules-grid">
        <div className="field">
          <label>{dayLabel} 운영</label>
          <label className="toggle-inline" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={variant.enabled !== false}
              onChange={(e) => updateField('enabled', e.target.checked)}
              style={{ width: '18px', height: '18px' }}
            />
            <span>{variant.enabled !== false ? '운영일 (일괄 생성 대상)' : '휴무일 (일괄 생성에서 제외)'}</span>
          </label>
          <div className="hint">휴무로 두면 학생 시간표 일괄 생성에서 이 요일 유형의 날짜가 제외됩니다. 등원 예정은 개인 시간표가 저장된 날짜에만 적용됩니다.</div>
        </div>
        <div className="field">
          <label>시간표 이름</label>
          <input value={variant.scheduleLabel || ''} onChange={(e) => updateField('scheduleLabel', e.target.value)} placeholder={`예: ${dayLabel} 기본 시간표`} />
          <div className="hint">{dayLabel}에 학생별 예외 시간표가 없을 때 표시되는 기본 시간표명입니다.</div>
        </div>
        <div className="field">
          <label>기본 예정 등원</label>
          <TimeSelect value={variant.plannedCheckIn} onChange={(value) => updateField('plannedCheckIn', value)} />
          <div className="hint">지각 판정의 기본 기준입니다. 5분 단위로 입력하세요.</div>
        </div>
        <div className="field">
          <label>기본 예정 하원</label>
          <TimeSelect value={variant.plannedCheckOut} onChange={(value) => updateField('plannedCheckOut', value)} allow24 />
          <div className="hint">조퇴 판정의 기본 기준입니다. 24:00까지 입력할 수 있습니다.</div>
        </div>
        <div className="field">
          <label>하루 순공 인정 합계</label>
          <input value={formatMinutes(totalStudyMinutes)} readOnly />
          <div className="hint">아래 학습 인정 구간의 합계입니다. 구간 밖 시간은 점심/저녁/쉬는시간으로 제외됩니다.</div>
        </div>
      </div>

      <div className="send-payload-preview default-schedule-editor">
        <div className="send-payload-head">
          <div>
            <h3>{dayLabel} 학습 인정 구간</h3>
            <p>순공시간 계산과 기본 시간표 화면에 쓰이는 구간입니다. 점심/저녁/쉬는시간은 구간을 비워두면 자동 제외됩니다.</p>
          </div>
          <div className="planner-head-actions">
            {activeDayType !== 'weekday' ? (
              <button className="secondary section-action" onClick={copyFromWeekday} disabled={defaultScheduleLoading}>평일 시간표 복사</button>
            ) : null}
            <button className="secondary section-action" onClick={addWindow} disabled={defaultScheduleLoading}>구간 추가</button>
          </div>
        </div>

        <div className="schedule-window-list">
          {(variant.studyWindows || []).map((item, index) => (
            <div className="break-row schedule-window-row" key={`${activeDayType}-${index}-${item.label}-${item.start}-${item.end}`}>
              <div className="time-grid">
                <div className="field">
                  <label>구간명</label>
                  <input value={item.label || ''} onChange={(e) => updateWindow(index, 'label', e.target.value)} placeholder={`${index + 1}차시`} />
                </div>
                <div className="field">
                  <label>시작</label>
                  <TimeSelect value={item.start || ''} onChange={(value) => updateWindow(index, 'start', value)} />
                </div>
                <div className="field">
                  <label>종료</label>
                  <TimeSelect value={item.end || ''} onChange={(value) => updateWindow(index, 'end', value)} allow24 />
                </div>
                <div className="field">
                  <label>인정 시간</label>
                  <input readOnly value={(() => { const start = timeToMinutes(item.start); const end = timeToMinutes(item.end); return start !== null && end !== null && end > start ? formatMinutes(end - start) : '-'; })()} />
                </div>
              </div>
              <button className="danger" onClick={() => removeWindow(index)} disabled={defaultScheduleLoading}>구간 삭제</button>
            </div>
          ))}
        </div>

        {activeErrors.length ? (
          <div className="template-validation-list failed">
            <strong>저장 전 확인 ({dayLabel})</strong>
            <span>{activeErrors.join(' / ')}</span>
          </div>
        ) : (
          <div className="all-clear">{dayLabel} 시간표는 저장 가능합니다.</div>
        )}
      </div>

      <div className="send-payload-preview default-schedule-editor">
        <div className="send-payload-head">
          <div>
            <h3>날짜별 예외 운영 (달력)</h3>
            <p>특정 날짜만 다른 요일 유형의 시간표로 운영할 때 사용합니다. 예: 평일인데 토요일 시간표로 운영, 공휴일 지정. 날짜를 클릭해 유형을 지정하세요.</p>
          </div>
          <div className="planner-head-actions">
            <button className="secondary section-action" onClick={() => shiftOverrideMonth(-1)}>◀ 지난달</button>
            <strong style={{ alignSelf: 'center' }}>{overrideMonthLabel}</strong>
            <button className="secondary section-action" onClick={() => shiftOverrideMonth(1)}>다음달 ▶</button>
          </div>
        </div>
        <div className="calendar-grid month-grid month-calendar override-calendar">
          {['일', '월', '화', '수', '목', '금', '토'].map((dowLabel) => <div key={`ov-dow-${dowLabel}`} className="month-weekday-head">{dowLabel}</div>)}
          {Array.from({ length: overrideMonthDates.length ? getDayOfWeekFromDateString(overrideMonthDates[0]) : 0 }, (_, padIndex) => <div key={`ov-pad-${padIndex}`} className="month-pad-cell" aria-hidden="true" />)}
          {overrideMonthDates.map((date) => {
            const overriddenType = dateOverrides[date] || null;
            const effectiveType = overriddenType || getAutoDayType(date);
            return (
              <button
                key={date}
                type="button"
                className={`calendar-day override-day ${date === getKstDateString() ? 'today' : ''} ${selectedOverrideDate === date ? 'selected' : ''} ${overriddenType ? 'overridden' : ''}`}
                onClick={() => setSelectedOverrideDate(date)}
              >
                <strong>{Number(date.slice(8))}일</strong>
                <div className={`month-summary-chip ${overriddenType ? 'break' : ''}`}>{DEFAULT_SCHEDULE_DAY_TYPE_LABELS[effectiveType]}{overriddenType ? ' 지정' : ''}</div>
              </button>
            );
          })}
        </div>
        {selectedOverrideDate ? (
          <div className="override-controls">
            <strong>{selectedOverrideDate}</strong>
            <span className="hint" style={{ marginTop: 0 }}>
              자동 판정: {DEFAULT_SCHEDULE_DAY_TYPE_LABELS[getAutoDayType(selectedOverrideDate)]}
              {dateOverrides[selectedOverrideDate] ? ` → 현재 ${DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dateOverrides[selectedOverrideDate]]} 시간표로 지정됨` : ''}
            </span>
            {DEFAULT_SCHEDULE_DAY_TYPES.map((dt) => (
              <button key={`ov-set-${dt}`} className={`section-action ${dateOverrides[selectedOverrideDate] === dt ? 'primary' : 'secondary'}`} onClick={() => setDateOverride(selectedOverrideDate, dt)} disabled={defaultScheduleLoading}>{DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dt]} 시간표로</button>
            ))}
            <button className="danger section-action" onClick={() => setDateOverride(selectedOverrideDate, null)} disabled={defaultScheduleLoading || (!dateOverrides[selectedOverrideDate] && !holidays.includes(selectedOverrideDate))}>지정 해제(자동)</button>
          </div>
        ) : (
          <div className="hint">날짜를 클릭하면 해당 날짜의 운영 유형을 지정할 수 있습니다. 지정 후 상단의 &apos;기본 시간표 저장&apos;을 눌러야 적용됩니다.</div>
        )}
        {Object.keys(dateOverrides).length ? (
          <div className="holiday-chip-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
            {Object.entries(dateOverrides).sort(([a], [b]) => a.localeCompare(b)).map(([date, dt]) => (
              <span key={`ov-chip-${date}`} className="filter-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                {date} → {DEFAULT_SCHEDULE_DAY_TYPE_LABELS[dt]}
                <button className="danger" style={{ padding: '0 6px', lineHeight: 1.4 }} onClick={() => setDateOverride(date, null)} disabled={defaultScheduleLoading}>×</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {bulkGenerateSchedules ? (
        <div className="send-payload-preview default-schedule-editor bulk-generate-box">
          <div className="send-payload-head">
            <div>
              <h3>기본 시간표로 개인 시간표 일괄 생성 (총괄 관리자)</h3>
              <p>요일 유형별 기본 시간표(운영일)를 템플릿으로 학생 개인 시간표를 기간 일괄 생성합니다. 이미 저장된 날짜는 변경하지 않습니다. 한 번에 최대 92일.</p>
            </div>
          </div>
          {scheduleCoverage?.warnings?.length ? (
            <div className="template-validation-list failed" style={{ marginBottom: '12px' }}>
              <strong>개인 시간표 공백 경고 ({scheduleCoverage.warnings.length}명)</strong>
              <span>{scheduleCoverage.warnings.map((warning) => warning.kind === 'missing' ? `${warning.name}: 시간표 없음` : `${warning.name}: ${warning.lastDate}까지만 있음`).join(' · ')}</span>
            </div>
          ) : null}
          <div className="time-grid">
            <div className="field">
              <label>시작일</label>
              <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} />
            </div>
            <div className="field">
              <label>종료일</label>
              <input type="date" onClick={openNativePicker} onFocus={openNativePicker} value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} />
            </div>
            <div className="field">
              <label>대상</label>
              <select value={bulkTargetStudentId} onChange={(e) => setBulkTargetStudentId(e.target.value)}>
                <option value="all">전체 학생</option>
                {students.map((student) => <option key={student.id} value={student.id}>{student.name} / {[student.school, student.grade].filter(Boolean).join(' ')}</option>)}
              </select>
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <button className="primary" onClick={runBulkGenerate} disabled={bulkWorking || defaultScheduleLoading}>{bulkWorking ? '생성 중...' : '일괄 생성'}</button>
            </div>
          </div>
          <div className="hint">신규 학생 등록 후에는 대상에서 해당 학생만 선택해 실행하세요. 시간표 저장을 먼저 완료한 뒤 실행해야 최신 기본 시간표가 반영됩니다.</div>
        </div>
      ) : null}

      {allErrors.length ? (
        <div className="template-validation-list failed">
          <strong>저장 전 확인 (전체 요일 유형)</strong>
          <span>{allErrors.join(' / ')}</span>
        </div>
      ) : null}
    </section>
  );
}

function OperatingRulesTab({ operatingRules, rulesDraft, setRulesDraft, saveOperatingRules, rulesLoading }) {
  const draft = normalizeOperatingRules(rulesDraft);
  const current = normalizeOperatingRules(operatingRules);

  function setNumberField(key, value) {
    const next = { ...draft, [key]: value === '' ? '' : Number(value) };
    setRulesDraft(next);
  }

  function setKeywordText(value) {
    setRulesDraft({ ...draft, attentionKeywords: value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) });
  }

  function resetDraft() {
    setRulesDraft(DEFAULT_OPERATING_RULES);
  }

  return (
    <section className="content-card operating-rules-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 운영 기준</h2>
          <p>출결현황의 지각, 조퇴, 외출과다, 순공부족 판정 기준을 직접 조정합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={() => setRulesDraft(current)} disabled={rulesLoading}>현재값 불러오기</button>
          <button className="secondary section-action" onClick={resetDraft} disabled={rulesLoading}>기본값</button>
          <button className="primary section-action" onClick={() => saveOperatingRules(draft)} disabled={rulesLoading}>{rulesLoading ? '저장 중...' : '운영 기준 저장'}</button>
        </div>
      </div>

      <div className="rules-grid">
        <div className="field">
          <label>순공부족 기준</label>
          <input type="number" min="0" step="5" value={draft.lowStudyMinutes} onChange={(e) => setNumberField('lowStudyMinutes', e.target.value)} />
          <div className="hint">{formatMinutes(draft.lowStudyMinutes)} 미만이면 순공부족으로 표시합니다.</div>
        </div>
        <div className="field">
          <label>지각 기준</label>
          <input type="number" min="0" step="1" value={draft.lateThresholdMinutes} onChange={(e) => setNumberField('lateThresholdMinutes', e.target.value)} />
          <div className="hint">예정 등원보다 이 값 이상 늦으면 지각입니다. 현재 {draft.lateThresholdMinutes}분.</div>
        </div>
        <div className="field">
          <label>조퇴 기준</label>
          <input type="number" min="0" step="1" value={draft.earlyLeaveThresholdMinutes} onChange={(e) => setNumberField('earlyLeaveThresholdMinutes', e.target.value)} />
          <div className="hint">예정 하원보다 이 값 이상 빠르면 조퇴입니다. 현재 {draft.earlyLeaveThresholdMinutes}분.</div>
        </div>
        <div className="field">
          <label>외출과다 횟수</label>
          <input type="number" min="0" step="1" value={draft.excessiveAwayCount} onChange={(e) => setNumberField('excessiveAwayCount', e.target.value)} />
          <div className="hint">하루 외출 {draft.excessiveAwayCount}회 이상이면 외출과다입니다.</div>
        </div>
        <div className="field">
          <label>외출과다 누적시간</label>
          <input type="number" min="0" step="5" value={draft.excessiveAwayMinutes} onChange={(e) => setNumberField('excessiveAwayMinutes', e.target.value)} />
          <div className="hint">하루 외출 누적 {formatMinutes(draft.excessiveAwayMinutes)} 이상이면 외출과다입니다.</div>
        </div>
        <div className="field rules-keywords-field">
          <label>관리주의 키워드</label>
          <textarea value={(draft.attentionKeywords || []).join(', ')} onChange={(e) => setKeywordText(e.target.value)} />
          <div className="hint">쉼표 또는 줄바꿈으로 구분합니다. 코멘트/특이사항에 포함되면 관리주의로 표시합니다.</div>
        </div>
      </div>
    </section>
  );
}

function SystemCheckTab({ students, seatsForDisplay, diagnostics }) {
  const activeStudents = (students || []).filter((student) => student.status !== 'inactive');
  const assignedStudents = activeStudents.filter((student) => student.default_seat_no);
  const missingSeatStudents = activeStudents.filter((student) => !student.default_seat_no);
  const inactiveSeats = (seatsForDisplay || []).filter((seat) => seat.is_active === false);

  return (
    <section className="content-card system-check-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 시스템 점검</h2>
          <p>운영 전 기본 데이터가 정상적으로 준비되어 있는지 빠르게 확인합니다.</p>
        </div>
      </div>

      <div className="integrity-summary-grid">
        <div><span>현재 기준</span><strong>v40-6</strong></div>
        <div><span>활성 학생</span><strong>{activeStudents.length}명</strong></div>
        <div><span>좌석 배정</span><strong>{assignedStudents.length}명</strong></div>
        <div><span>좌석 미입력</span><strong>{missingSeatStudents.length}명</strong></div>
        <div><span>최근 좌석 점검</span><strong>{diagnostics ? `${diagnostics.summary?.issueCount || 0}건` : '미실행'}</strong></div>
      </div>

      <div className="system-check-list">
        <div className={missingSeatStudents.length ? 'system-check-item warn' : 'system-check-item ok'}>
          <strong>학생 기본 좌석</strong>
          <span>{missingSeatStudents.length ? `${missingSeatStudents.length}명의 기본 좌석이 비어 있습니다.` : '활성 학생의 기본 좌석 입력 상태가 양호합니다.'}</span>
        </div>
        <div className={inactiveSeats.length ? 'system-check-item warn' : 'system-check-item ok'}>
          <strong>좌석 활성 상태</strong>
          <span>{inactiveSeats.length ? `${inactiveSeats.length}개 좌석이 비활성 처리되어 있습니다.` : '현재 표시 좌석이 정상적으로 활성화되어 있습니다.'}</span>
        </div>
        <div className={diagnostics?.summary?.issueCount ? 'system-check-item warn' : 'system-check-item ok'}>
          <strong>좌석 데이터 정합성</strong>
          <span>{diagnostics ? (diagnostics.summary?.issueCount ? '좌석 데이터 점검 탭에서 확인이 필요한 항목이 있습니다.' : '최근 좌석 데이터 점검 결과 문제가 없습니다.') : '좌석 데이터 점검을 한 번 실행해 주세요.'}</span>
        </div>
      </div>
    </section>
  );
}

function SeatIntegrityTab({ diagnostics, loading, runCheck, cleanup }) {
  const summary = diagnostics?.summary || {};
  const issues = diagnostics?.issues || [];
  const cleanupPlan = diagnostics?.cleanupPlan || [];

  return (
    <section className="content-card integrity-tab">
      <div className="section-head">
        <div>
          <h2>설정 · 데이터 점검</h2>
          <p>학생 기본 좌석, 좌석 테이블, 오늘 세션의 충돌 여부를 점검하고 필요한 경우 정리합니다.</p>
        </div>
        <div className="planner-head-actions">
          <button className="secondary section-action" onClick={runCheck} disabled={loading}>{loading ? '점검 중...' : '좌석 데이터 점검'}</button>
          <button className="primary section-action" onClick={cleanup} disabled={loading || !cleanupPlan.length}>자동 정리 실행</button>
        </div>
      </div>

      <div className="integrity-summary-grid">
        <div><span>좌석</span><strong>{summary.seatCount ?? '-'}</strong></div>
        <div><span>활성 학생</span><strong>{summary.studentCount ?? '-'}</strong></div>
        <div><span>문제 발견</span><strong>{summary.issueCount ?? '-'}</strong></div>
        <div><span>자동 정리 가능</span><strong>{summary.cleanupCount ?? '-'}</strong></div>
        <div><span>관리자 확인 필요</span><strong>{summary.reviewCount ?? '-'}</strong></div>
      </div>

      {!diagnostics ? (
        <div className="empty-student-list">
          <strong>아직 점검 결과가 없습니다.</strong>
          <span>좌석 데이터 점검 버튼을 눌러 현재 DB 상태를 확인하세요.</span>
        </div>
      ) : null}

      {diagnostics ? (
        <div className="integrity-layout">
          <section className="integrity-card">
            <h3>점검 결과</h3>
            {issues.length ? (
              <div className="integrity-list">
                {issues.map((issue, index) => (
                  <div key={`${issue.type}-${index}`} className={`integrity-item ${issue.severity}`}>
                    <strong>{issue.title}</strong>
                    <span>{issue.detail}</span>
                  </div>
                ))}
              </div>
            ) : <div className="all-clear">좌석 데이터 충돌이 발견되지 않았습니다.</div>}
          </section>

          <section className="integrity-card">
            <h3>정리 미리보기</h3>
            {cleanupPlan.length ? (
              <div className="cleanup-list">
                {cleanupPlan.map((item) => (
                  <div key={`${item.kind || 'seat'}-${item.seatNo}`} className="cleanup-item">
                    <strong>{String(item.seatNo).padStart(2, '0')}번 좌석</strong>
                    <span>{item.beforeStudentName} → {item.afterStudentName}</span>
                  </div>
                ))}
              </div>
            ) : <div className="all-clear">정리할 좌석 데이터가 없습니다.</div>}
          </section>
        </div>
      ) : null}

      <div className="hint integrity-hint">
        자동 정리 실행은 학생 기본 좌석을 기준으로 좌석 테이블(seats.current_student_id)만 맞춥니다. 오늘만 임시 좌석을 사용했을 가능성이 있는 세션 충돌은 관리자 확인 필요 항목으로만 표시합니다. 학생 기본 좌석 자체가 잘못된 경우에는 설정 &gt; 학생 관리에서 먼저 수정하세요.
      </div>
    </section>
  );
}

function AccountModal({ open, onClose, currentUser, passwordForm, setPasswordForm, changeOwnPassword, passwordStatus }) {
  if (!open) return null;

  const isPersonalAccount = currentUser?.username && currentUser.username !== 'admin';

  return (
    <div className="modal-backdrop account-modal-backdrop">
      <div className="popup-card account-modal">
        <div className="popup-head">
          <div>
            <h2>내 계정</h2>
            <p>현재 접속 계정 정보 확인 및 비밀번호 변경</p>
          </div>
          <button type="button" className="secondary account-close-button" onClick={onClose} aria-label="내 계정 닫기">닫기</button>
        </div>

        <div className="account-info-grid">
          <div><span>이름</span><strong>{currentUser?.displayName || '-'}</strong></div>
          <div><span>아이디</span><strong>{currentUser?.username || '-'}</strong></div>
          <div><span>역할</span><strong>{USER_ROLE_LABELS[currentUser?.role] || currentUser?.role || '-'}</strong></div>
          <div><span>상태</span><strong>{currentUser?.status || 'active'}</strong></div>
        </div>

        {currentUser?.requirePasswordChange ? (
          <div className="account-warning">임시 비밀번호로 로그인했습니다. 보안을 위해 비밀번호를 변경하세요.</div>
        ) : null}

        {isPersonalAccount ? (
          <section className="account-password-section">
            <h3>비밀번호 변경</h3>
            <div className="user-form-grid">
              <div className="field full">
                <label>현재 비밀번호</label>
                <input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
              </div>
              <div className="field">
                <label>새 비밀번호</label>
                <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} placeholder="8자 이상" />
              </div>
              <div className="field">
                <label>새 비밀번호 확인</label>
                <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} />
              </div>
            </div>
            <div className="account-modal-actions"><button className="primary" onClick={changeOwnPassword}>비밀번호 변경</button></div>
            {passwordStatus ? <div className={passwordStatus.type === 'success' ? 'success' : passwordStatus.type === 'neutral' ? 'hint account-status' : 'error'}>{passwordStatus.message}</div> : null}
          </section>
        ) : (
          <div className="hint">공용 관리자 비밀번호는 이 화면에서 변경하지 않습니다. Vercel 환경변수 ADMIN_PASSWORD에서 관리하세요.</div>
        )}
      </div>
    </div>
  );
}

function RestrictedAccessCard({ activeTab, allowedTabs = [] }) {
  const label = TABS.find(([key]) => key === activeTab)?.[1] || activeTab || '현재 페이지';
  return (
    <section className="content-card restricted-access-card">
      <h2>접근 권한이 없습니다.</h2>
      <p>{label} 페이지에 접근할 수 있는 권한이 없습니다. 필요한 경우 총괄관리자에게 권한 변경을 요청하세요.</p>
      <div className="permission-summary-box">
        <strong>현재 접근 가능한 페이지</strong>
        <span>{allowedTabs.length ? allowedTabs.map(([, tabLabel]) => tabLabel).join(' · ') : '접근 가능한 페이지가 없습니다.'}</span>
      </div>
    </section>
  );
}

function PlaceholderTab({ title, description, items }) {
  return (
    <section className="content-card">
      <h2>{title}</h2>
      <p>{description}</p>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}
