import { getAuthorizedUser, isAuthorized, unauthorizedResponse, requireTabPermission } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { writeUserActionLog } from '../../../lib/actionLog';

export const dynamic = 'force-dynamic';

function envStatus(names) {
  for (const name of names) {
    if (process.env[name]) return { configured: true, envName: name };
  }
  return { configured: false, envName: names[0] };
}

function normalizeReportType(value = 'daily') {
  if (value === 'weekly') return 'weekly';
  if (value === 'attendance') return 'attendance';
  if (value === 'parent_confirmation') return 'parent_confirmation';
  return 'daily';
}

function getConfig(reportType) {
  if (reportType === 'weekly') return envStatus(['WEEKLY_REPORT_SEND_WEBHOOK_URL', 'REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL', 'SOLAPI_TEMPLATE_ID_WEEKLY', 'KAKAO_TEMPLATE_CODE_WEEKLY']);
  if (reportType === 'attendance') return envStatus(['SOLAPI_TEMPLATE_ID_ATTENDANCE', 'SOLAPI_TEMPLATE_ID_CHECKINOUT', 'KAKAO_TEMPLATE_CODE_ATTENDANCE', 'KAKAO_TEMPLATE_CODE_CHECKINOUT']);
  if (reportType === 'parent_confirmation') return envStatus(['SOLAPI_TEMPLATE_ID_PARENT_CONFIRMATION', 'KAKAO_TEMPLATE_CODE_PARENT_CONFIRMATION']);
  return envStatus(['REPORT_SEND_WEBHOOK_URL', 'KAKAO_REPORT_WEBHOOK_URL', 'SOLAPI_TEMPLATE_ID_DAILY', 'KAKAO_TEMPLATE_CODE_DAILY']);
}

function makePayload(reportType, actorName) {
  const type = normalizeReportType(reportType);
  if (type === 'attendance') {
    return {
      channel: 'kakao',
      mode: 'test_payload_only',
      reportType: 'attendance',
      studentName: '테스트 학생',
      studentId: 'test-student-id',
      attendanceEventId: 'test-attendance-event-id',
      reportId: 'test-attendance-event-id',
      idempotencyKey: 'test:attendance:test-student-id:check_in:01000000000',
      reportDate: '2026-06-29',
      attendanceEventType: '입실',
      attendanceTime: '09:04',
      attendanceSource: '키오스크 자동기록',
      recipients: [
        { name: '모', relationship: '모', phone: '01000000000', isPrimary: true },
      ],
      recipientPhones: ['01000000000'],
      messageText: '[The Place 26 입실 알림]\n\n테스트 학생 학생의 출결 상태가 기록되었습니다.\n\n- 구분: 입실\n- 기준시간: 09:04\n- 기록방식: 키오스크 자동기록\n\n목동유쌤영어학원',
      templateVariables: {
        studentName: '테스트 학생',
        date: '2026-06-29',
        attendanceEventType: '입실',
        attendanceTime: '09:04',
        attendanceSource: '키오스크 자동기록',
        kakaoVariables: {
          '#{학생명}': '테스트 학생',
          '#{날짜}': '2026-06-29',
          '#{출결구분}': '입실',
          '#{출결시간}': '09:04',
          '#{기록방식}': '키오스크 자동기록',
        },
      },
      requestedBy: actorName,
      requestedAt: new Date().toISOString(),
      note: '출결 알림톡 테스트 payload입니다. 실제 학부모에게 발송하지 않습니다.',
    };
  }

  if (type === 'parent_confirmation') {
    return {
      channel: 'kakao',
      mode: 'test_payload_only',
      reportType: 'parent_confirmation',
      studentName: '테스트 학생',
      studentId: 'test-student-id',
      reportId: 'test-parent-confirmation-id',
      idempotencyKey: 'test:parent_confirmation:test-student-id:01000000000',
      plannedStudyTime: '09:00 ~ 22:00',
      plannedBreakTime: '13:00 ~ 15:00 (수학학원)',
      currentStatusText: '외출 후 미복귀',
      recipients: [
        { name: '모', relationship: '모', phone: '01000000000', isPrimary: true },
      ],
      recipientPhones: ['01000000000'],
      messageText: '[The Place 26 학부모 확인 요청]\n\n테스트 학생 학생의 비욘드 썸머스쿨 출결 확인이 필요한 상황이 발생했습니다.\n\n- 금일 예정 학습 시간: 09:00 ~ 22:00\n- 금일 예정 외출 시간: 13:00 ~ 15:00 (수학학원)\n- 현재 상태: 외출 후 미복귀\n\n담당자가 학생 확인을 진행한 뒤, 필요 시 학부모님께 추가 연락드리겠습니다.\n\n목동유쌤영어학원',
      templateVariables: {
        studentName: '테스트 학생',
        plannedStudyTime: '09:00 ~ 22:00',
        plannedBreakTime: '13:00 ~ 15:00 (수학학원)',
        currentStatusText: '외출 후 미복귀',
        kakaoVariables: {
          '#{학생명}': '테스트 학생',
          '#{예정학습시간}': '09:00 ~ 22:00',
          '#{예정외출시간}': '13:00 ~ 15:00 (수학학원)',
          '#{현재상태}': '외출 후 미복귀',
        },
      },
      requestedBy: actorName,
      requestedAt: new Date().toISOString(),
      note: '학부모 확인 요청 알림톡 테스트 payload입니다. 실제 학부모에게 발송하지 않습니다.',
    };
  }

  const isWeekly = type === 'weekly';
  return {
    channel: 'kakao',
    mode: 'test_payload_only',
    reportType: isWeekly ? 'weekly' : 'daily',
    studentName: '테스트 학생',
    studentId: 'test-student-id',
    reportId: isWeekly ? 'test-weekly-report-id' : 'test-daily-report-id',
    idempotencyKey: isWeekly ? 'test:weekly:test-weekly-report-id:01000000000' : 'test:daily:test-daily-report-id:01000000000',
    sessionId: isWeekly ? null : 'test-session-id',
    reportDate: isWeekly ? null : new Date().toISOString().slice(0, 10),
    startDate: isWeekly ? '2026-06-29' : null,
    endDate: isWeekly ? '2026-07-05' : null,
    recipients: [
      { name: '모', relationship: '모', phone: '01000000000', isPrimary: true },
      { name: '부', relationship: '부', phone: '01000002222', isPrimary: false },
    ],
    recipientPhones: ['01000000000', '01000002222'],
    messageText: isWeekly
      ? '[비욘드 주간 리포트]\n학생: 테스트 학생\n기간: 2026-06-29 ~ 2026-07-05\n\n주간 총평 예시입니다.'
      : '[비욘드 데일리 리포트]\n학생: 테스트 학생\n날짜: 2026-06-29\n\n오늘 학습 기록 예시입니다.',
    templateVariables: isWeekly ? {
      studentName: '테스트 학생',
      period: '2026-06-29 ~ 2026-07-05',
      weeklyStudyTime: '18시간 20분',
      mainCheckSummary: '순공부족 1회',
      reportLink: 'https://example.com/weekly-report',
      kakaoVariables: {
        '#{학생명}': '테스트 학생',
        '#{기간}': '2026-06-29 ~ 2026-07-05',
        '#{주간순공시간}': '18시간 20분',
        '#{확인사항}': '순공부족 1회',
        '#{리포트링크}': 'https://example.com/weekly-report',
      },
    } : {
      studentName: '테스트 학생',
      date: '2026-06-29',
      attendanceStatus: '학습중',
      pureStudyTime: '5시간 20분',
      mainCheckSummary: '특이사항 없음',
      reportLink: 'https://example.com/daily-report',
      kakaoVariables: {
        '#{학생명}': '테스트 학생',
        '#{날짜}': '2026-06-29',
        '#{출결상태}': '학습중',
        '#{순공시간}': '5시간 20분',
        '#{확인사항}': '특이사항 없음',
        '#{리포트링크}': 'https://example.com/daily-report',
      },
    },
    plannerImageUrl: isWeekly ? null : 'https://example.com/test-planner-image.jpg',
    hasPlannerImage: !isWeekly,
    requestedBy: actorName,
    requestedAt: new Date().toISOString(),
    note: '테스트 payload입니다. 실제 학부모에게 발송하지 않습니다.',
  };
}

export async function POST(request) {
  const denied = requireTabPermission(request, 'settings');
  if (denied) return denied;

  try {
    const body = await request.json().catch(() => ({}));
    const reportType = normalizeReportType(body.reportType || 'daily');
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || '관리자';
    const config = getConfig(reportType);
    const payload = makePayload(reportType, actorName);

    const supabase = getSupabaseAdmin();
    await writeUserActionLog(supabase, request, {
      actionType: reportType === 'weekly' ? 'weekly_report.test' : reportType === 'attendance' ? 'attendance_notification.test' : reportType === 'parent_confirmation' ? 'parent_confirmation.test' : 'daily_report.test',
      targetType: 'report_send_test',
      targetId: reportType,
      targetName: reportType === 'weekly' ? '위클리 테스트 payload' : reportType === 'attendance' ? '출결 알림 테스트 payload' : reportType === 'parent_confirmation' ? '학부모 확인 요청 테스트 payload' : '데일리 테스트 payload',
      payload: {
        reportType,
        configured: config.configured,
        envName: config.envName,
        payloadPreview: payload,
      },
    });

    return Response.json({
      ok: true,
      reportType,
      configured: config.configured,
      envName: config.envName,
      mode: 'test_payload_only',
      payload,
      message: '테스트 payload를 생성했습니다. 실제 발송은 하지 않았습니다.',
    });
  } catch (error) {
    return Response.json({ error: error.message || '테스트 payload 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
