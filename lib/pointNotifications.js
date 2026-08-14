// Beyond OS v41-161
// 상벌점 알림톡 발송 모듈입니다.
//
// 두 가지를 보냅니다.
//   point_penalty : 순벌점이 단계(10/20/30점)를 넘겨 조치할 때 보내는 안내
//   point_reward  : 순점수가 기준을 넘겨 상품을 지급할 때 보내는 안내
//
// 두 알림 모두 보호자와 학생 본인에게 함께 보냅니다.
// (상벌점은 학생이 직접 알아야 행동이 바뀌는 정보라 기본으로 포함합니다)
//
// 실제 발송은 카카오에 등록·승인된 템플릿 + 변수로 나갑니다.
// 여기서 만드는 messageText는 앱 안에서 보고 남기는 기록용입니다.

import { sendSolapiAlimtalk } from './solapiAdapter';
import { BRAND_NAME, BRAND_CONTACT_PHONE } from './brand';
import { PENALTY_STAGES } from './studentPointCycle';

export const POINT_NOTIFICATION_TYPES = { penalty: 'point_penalty', reward: 'point_reward' };

// 단계별로 학부모에게 나가는 안내 문구입니다.
// 제적 단계는 통보가 아니라 상담 요청으로 표현합니다. 문서 한 줄로 끝낼 사안이 아니기 때문입니다.
export const PENALTY_STAGE_MESSAGES = {
  10: '누적 벌점이 기준을 초과하여 안내드립니다. 가정에서도 생활 지도에 협조 부탁드립니다.',
  20: '누적 벌점이 기준을 초과하여 센터장 면담이 필요합니다. 센터로 연락 주시면 일정을 안내드리겠습니다.',
  30: '누적 벌점이 기준을 크게 초과하여 계속 수강 여부를 함께 논의드려야 합니다. 센터로 연락 부탁드립니다.',
};

export function getPenaltyStageMessage(stage) {
  return PENALTY_STAGE_MESSAGES[Number(stage)] || PENALTY_STAGE_MESSAGES[10];
}

export function getPenaltyStageLabel(stage) {
  return PENALTY_STAGES.find((item) => item.stage === Number(stage))?.label || '안내';
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function maskPhone(value = '') {
  const digits = normalizePhone(value);
  if (digits.length < 7) return digits ? `${digits.slice(0, 3)}****` : '';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

function formatKstDate(value = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

/**
 * 보호자 + 학생 본인 수신자 목록을 만듭니다.
 * 같은 번호는 한 번만 남깁니다.
 */
export async function getPointNotificationRecipients(supabase, studentId, fallbackStudent = null) {
  let student = fallbackStudent;
  try {
    const { data } = await supabase
      .from('students')
      .select('id, name, school, grade, student_phone, parent_phone, status, student_guardians(*)')
      .eq('id', studentId)
      .maybeSingle();
    if (data) student = data;
  } catch {
    // 조회 실패 시 넘겨받은 학생 정보로 진행합니다.
  }

  const rows = [];
  const guardians = Array.isArray(student?.student_guardians) ? student.student_guardians : [];
  for (const [index, item] of guardians.entries()) {
    if (item?.is_active === false) continue;
    const digits = normalizePhone(item?.phone);
    if (!digits) continue;
    rows.push({
      name: item.guardian_name || item.relationship || `보호자 ${index + 1}`,
      relationship: item.relationship || '보호자',
      phone: digits,
      phoneDigits: digits,
      maskedPhone: maskPhone(digits),
      isPrimary: Boolean(item.is_primary || index === 0),
    });
  }

  if (!rows.length) {
    const fallback = normalizePhone(student?.parent_phone);
    if (fallback) {
      rows.push({
        name: '대표 보호자',
        relationship: '보호자',
        phone: fallback,
        phoneDigits: fallback,
        maskedPhone: maskPhone(fallback),
        isPrimary: true,
      });
    }
  }

  // 학생 본인
  const studentPhone = normalizePhone(student?.student_phone);
  if (studentPhone) {
    rows.push({
      name: student?.name || '학생',
      relationship: '학생 본인',
      phone: studentPhone,
      phoneDigits: studentPhone,
      maskedPhone: maskPhone(studentPhone),
      isPrimary: false,
      isStudent: true,
    });
  }

  const seen = new Set();
  const unique = rows.filter((item) => {
    if (seen.has(item.phoneDigits)) return false;
    seen.add(item.phoneDigits);
    return true;
  });

  return { student, recipients: unique };
}

// 최근 상벌점 내역을 알림톡 변수 한 칸에 담을 수 있게 줄여 씁니다.
export function formatRecentPointLines(rows = [], limit = 5) {
  const lines = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.is_deleted !== true)
    .slice(0, limit)
    .map((row) => {
      const date = String(row.point_date || row.created_at || '').slice(0, 10);
      const sign = row.point_type === 'reward' ? '상점 +' : '벌점 -';
      const reason = String(row.reason || '').trim();
      return `${date} ${sign}${Number(row.points || 0)}점${reason ? ` (${reason})` : ''}`;
    });
  return lines.length ? lines.join('\n') : '최근 내역이 없습니다.';
}

function buildPenaltyPayload({ student, stage, penaltyState, recentRows, baseDate }) {
  const stageLabel = getPenaltyStageLabel(stage);
  const guide = getPenaltyStageMessage(stage);
  const recent = formatRecentPointLines(recentRows);

  const variables = {
    '#{학생명}': student?.name || '학생',
    '#{기준일}': baseDate,
    '#{상점}': String(penaltyState?.reward ?? 0),
    '#{벌점}': String(penaltyState?.penalty ?? 0),
    '#{순벌점}': String(penaltyState?.penaltyNet ?? 0),
    '#{안내단계}': `${stage}점 초과 · ${stageLabel}`,
    '#{안내문구}': guide,
    '#{최근내역}': recent,
  };

  const messageText = [
    `[${BRAND_NAME}] 상벌점 누적 안내`,
    '',
    `${student?.name || '학생'} 학생 상벌점 누적 현황을 안내드립니다.`,
    '',
    `- 기준일: ${baseDate}`,
    `- 누적 상점: ${penaltyState?.reward ?? 0}점`,
    `- 누적 벌점: ${penaltyState?.penalty ?? 0}점`,
    `- 순벌점: ${penaltyState?.penaltyNet ?? 0}점 (${stage}점 초과 · ${stageLabel})`,
    '',
    guide,
    '',
    '최근 상벌점 내역',
    recent,
    '',
    `문의: ${BRAND_NAME} ${BRAND_CONTACT_PHONE}`,
  ].join('\n');

  return { variables, messageText };
}

function buildRewardPayload({ student, cycle, recentRows, baseDate, rewardGuide }) {
  const recent = formatRecentPointLines(recentRows);
  const guide = String(rewardGuide || '').trim()
    || '센터에서 상품 지급 안내를 드릴 예정입니다. 앞으로도 좋은 습관 이어가도록 함께 응원해 주세요.';

  const variables = {
    '#{학생명}': student?.name || '학생',
    '#{기준일}': baseDate,
    '#{상점}': String(cycle?.reward ?? 0),
    '#{벌점}': String(cycle?.penalty ?? 0),
    '#{순점수}': String(cycle?.net ?? 0),
    '#{지급안내}': guide,
    '#{최근내역}': recent,
  };

  const messageText = [
    `[${BRAND_NAME}] 상점 누적 상품 지급 안내`,
    '',
    `${student?.name || '학생'} 학생이 상점 누적 기준을 달성했습니다.`,
    '',
    `- 기준일: ${baseDate}`,
    `- 누적 상점: ${cycle?.reward ?? 0}점`,
    `- 누적 벌점: ${cycle?.penalty ?? 0}점`,
    `- 순점수: ${cycle?.net ?? 0}점`,
    '',
    guide,
    '',
    '최근 상벌점 내역',
    recent,
    '',
    `문의: ${BRAND_NAME} ${BRAND_CONTACT_PHONE}`,
  ].join('\n');

  return { variables, messageText };
}

async function writeNotificationLog(supabase, payload = {}) {
  try {
    const { data, error } = await supabase
      .from('attendance_notification_logs')
      .insert(payload)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    // 발송 기록 저장 실패가 발송 자체를 되돌리지는 않습니다.
    return null;
  }
}

/**
 * 상벌점 알림톡을 보냅니다.
 *
 * @param {Object} options
 * @param {'penalty'|'reward'} options.kind
 * @param {Object} options.supabase
 * @param {string} options.studentId
 * @param {Object} [options.student]        학생 정보(없으면 조회)
 * @param {number} [options.stage]          penalty일 때 단계(10/20/30)
 * @param {Object} [options.penaltyState]   resolvePenaltyStages 결과
 * @param {Object} [options.cycle]          resolvePointCycle 결과 (reward일 때)
 * @param {Array}  [options.recentRows]     최근 상벌점 행
 * @param {string} [options.actorName]
 * @param {string} [options.rewardGuide]
 */
export async function sendPointNotification({
  kind,
  supabase,
  studentId,
  student: fallbackStudent = null,
  stage = 0,
  penaltyState = null,
  cycle = null,
  recentRows = [],
  actorName = '관리자',
  rewardGuide = '',
}) {
  const reportType = kind === 'penalty' ? POINT_NOTIFICATION_TYPES.penalty : POINT_NOTIFICATION_TYPES.reward;
  const baseDate = formatKstDate();

  const { student, recipients } = await getPointNotificationRecipients(supabase, studentId, fallbackStudent);

  if (!recipients.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'recipient_missing',
      message: '보호자·학생 연락처가 없어 알림톡을 보내지 않았습니다. 학생 정보에서 연락처를 확인하세요.',
      recipients: [],
    };
  }

  const built = kind === 'penalty'
    ? buildPenaltyPayload({ student, stage, penaltyState, recentRows, baseDate })
    : buildRewardPayload({ student, cycle, recentRows, baseDate, rewardGuide });

  const payload = {
    reportType,
    studentName: student?.name || '학생',
    recipients: recipients.map((item) => ({
      name: item.name,
      relationship: item.relationship,
      phone: item.phoneDigits,
      isPrimary: item.isPrimary,
    })),
    recipientPhones: recipients.map((item) => item.phoneDigits),
    messageText: built.messageText,
    templateVariables: { kakaoVariables: built.variables },
    idempotencyKey: kind === 'penalty'
      ? `point_penalty:${studentId}:${stage}:${baseDate}`
      : `point_reward:${studentId}:${baseDate}:${cycle?.net ?? 0}`,
  };

  let result;
  try {
    result = await sendSolapiAlimtalk(payload);
  } catch (error) {
    result = {
      ok: false,
      status: 'failed',
      message: error?.message || '알림톡 발송 중 오류가 발생했습니다.',
      errorCode: 'SEND_EXCEPTION',
    };
  }

  await writeNotificationLog(supabase, {
    student_id: student?.id || studentId,
    event_type: reportType,
    event_at: new Date().toISOString(),
    source_type: 'manual',
    source_label: kind === 'penalty' ? '벌점 단계 조치' : '상품 지급 안내',
    message_text: built.messageText,
    recipient_count: recipients.length,
    recipient_snapshot: recipients.map((item) => ({
      name: item.name, relationship: item.relationship, phone: item.maskedPhone, isStudent: Boolean(item.isStudent),
    })),
    recipient_phone_snapshot: recipients.map((item) => item.phoneDigits).join(','),
    send_status: result?.ok ? (result.status || 'sent') : 'failed',
    provider: 'solapi',
    provider_status: result?.providerStatus || null,
    provider_response: result?.providerResponse || result || null,
    error_message: result?.ok ? null : (result?.message || null),
    created_by: actorName,
  });

  return {
    ...result,
    recipients: recipients.map((item) => ({
      name: item.name, relationship: item.relationship, maskedPhone: item.maskedPhone, isStudent: Boolean(item.isStudent),
    })),
    messageText: built.messageText,
  };
}
