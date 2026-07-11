import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { writeUserActionLog } from '../../../lib/actionLog';
import { validateKakaoTemplateVariables } from '../../../lib/reportTemplateValidation';

export const dynamic = 'force-dynamic';

function makeSamplePayload(reportType = 'daily') {
  const isWeekly = reportType === 'weekly';
  const isAttendance = reportType === 'attendance';

  if (isAttendance) {
    return {
      reportType: 'attendance',
      studentName: '테스트 학생',
      reportDate: '2026-06-29',
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
    };
  }

  if (reportType === 'parent_confirmation') {
    return {
      reportType: 'parent_confirmation',
      studentName: '테스트 학생',
      plannedStudyTime: '09:00 ~ 22:00',
      plannedBreakTime: '13:00 ~ 15:00 (수학학원)',
      currentStatusText: '외출 후 미복귀',
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
    };
  }

  if (isWeekly) {
    return {
      reportType: 'weekly',
      studentName: '테스트 학생',
      startDate: '2026-06-29',
      endDate: '2026-07-05',
      reportLink: 'https://example.com/r/test-weekly',
      templateVariables: {
        studentName: '테스트 학생',
        period: '2026-06-29 ~ 2026-07-05',
        weeklyStudyTime: '18시간 20분',
        mainCheckSummary: '순공부족 1회',
        reportLink: 'https://example.com/r/test-weekly',
        kakaoVariables: {
          '#{학생명}': '테스트 학생',
          '#{기간}': '2026-06-29 ~ 2026-07-05',
          '#{주간순공시간}': '18시간 20분',
          '#{확인사항}': '순공부족 1회',
          '#{리포트링크}': 'https://example.com/r/test-weekly',
        },
      },
    };
  }

  return {
    reportType: 'daily',
    studentName: '테스트 학생',
    reportDate: '2026-06-29',
    reportLink: 'https://example.com/r/test-daily',
    templateVariables: {
      studentName: '테스트 학생',
      date: '2026-06-29',
      attendanceStatus: '학습중',
      pureStudyTime: '5시간 20분',
      mainCheckSummary: '특이사항 없음',
      reportLink: 'https://example.com/r/test-daily',
      kakaoVariables: {
        '#{학생명}': '테스트 학생',
        '#{날짜}': '2026-06-29',
        '#{출결상태}': '학습중',
        '#{순공시간}': '5시간 20분',
        '#{확인사항}': '특이사항 없음',
        '#{리포트링크}': 'https://example.com/r/test-daily',
      },
    },
  };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const body = await request.json().catch(() => ({}));
    const reportType = body.reportType === 'weekly' ? 'weekly' : body.reportType === 'attendance' ? 'attendance' : body.reportType === 'parent_confirmation' ? 'parent_confirmation' : 'daily';
    const payload = body.payload || makeSamplePayload(reportType);
    const result = validateKakaoTemplateVariables(payload, reportType);

    try {
      const supabase = getSupabaseAdmin();
      await writeUserActionLog(supabase, request, {
        actionType: reportType === 'weekly' ? 'weekly_report.template_validate' : reportType === 'attendance' ? 'attendance_notification.template_validate' : reportType === 'parent_confirmation' ? 'parent_confirmation.template_validate' : 'daily_report.template_validate',
        targetType: 'kakao_template',
        targetId: reportType,
        targetName: reportType === 'weekly' ? '위클리 템플릿 변수 검증' : reportType === 'attendance' ? '출결 알림 템플릿 변수 검증' : reportType === 'parent_confirmation' ? '학부모 확인 요청 템플릿 변수 검증' : '데일리 템플릿 변수 검증',
        payload: result,
      });
    } catch {
      // 검증 자체는 로그 실패와 무관하게 반환합니다.
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({
      ok: false,
      error: error.message || '카카오 템플릿 변수 검증 중 오류가 발생했습니다.',
    }, { status: 500 });
  }
}
