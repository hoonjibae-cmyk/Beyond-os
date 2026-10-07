// Beyond OS v41-267 — 좌석 패널 학생 이름 클릭 → 빠른 수정
//   · 다음 기수 등록불가(표시 여부 + 사유)
//   · 신청 상품
//   · 음악 청취 허용 범위
// 로그인한 사용자 누구나 저장할 수 있습니다. 나머지 신상 정보는 설정 › 학생 관리에서 고칩니다.
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { getAuthorizedUser, isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { writeUserActionLog } from '../../../lib/actionLog';
import { normalizeProductTier } from '../../../lib/productTier';
import { normalizeAudioPolicy } from '../../../lib/audioPolicy';
import { buildEnrollmentBlockPayload, ENROLLMENT_BLOCK_SQL_HINT } from '../../../lib/enrollmentBlock';

export const dynamic = 'force-dynamic';

function isMissingEnrollmentColumn(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42703' || message.includes('enrollment_block') || message.includes('schema cache');
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json();
    const studentId = String(body.studentId || '').trim();
    if (!studentId) return Response.json({ error: 'studentId is required' }, { status: 400 });

    const blocked = body.enrollmentBlocked === true;
    const reason = String(body.enrollmentBlockReason || '').trim();
    if (blocked && !reason) return Response.json({ error: '등록불가로 표시하려면 사유를 입력하세요.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const actor = getAuthorizedUser(request);
    const actorName = actor?.displayName || body.adminName || '관리자';

    const { data: existing, error: existingError } = await supabase
      .from('students').select('*').eq('id', studentId).single();
    if (existingError) throw existingError;

    const basePayload = {
      product_tier: normalizeProductTier(body.productTier) || null,
      audio_policy: normalizeAudioPolicy(body.audioPolicy) || null,
    };
    const blockPayload = buildEnrollmentBlockPayload({ blocked, reason, actorName });

    // 등록불가 칸(v41-266 SQL)이 아직 없으면 상품·음악만 저장하고 알려 줍니다.
    let warning = '';
    let { data: student, error } = await supabase
      .from('students').update({ ...basePayload, ...blockPayload }).eq('id', studentId).select('*').single();
    if (error && isMissingEnrollmentColumn(error)) {
      warning = `등록불가 표시는 저장되지 않았습니다. ${ENROLLMENT_BLOCK_SQL_HINT}`;
      ({ data: student, error } = await supabase
        .from('students').update(basePayload).eq('id', studentId).select('*').single());
    }
    if (error) throw error;

    await writeUserActionLog(supabase, request, {
      actionType: 'student.quick_edit',
      targetType: 'student',
      targetId: studentId,
      targetName: existing?.name || studentId,
      payload: {
        before: {
          productTier: existing?.product_tier || null,
          audioPolicy: existing?.audio_policy || null,
          enrollmentBlocked: Boolean(existing?.enrollment_blocked),
          enrollmentBlockReason: existing?.enrollment_block_reason || null,
        },
        after: {
          productTier: basePayload.product_tier,
          audioPolicy: basePayload.audio_policy,
          enrollmentBlocked: warning ? null : blocked,
          enrollmentBlockReason: warning ? null : blockPayload.enrollment_block_reason,
        },
        updatedBy: actorName,
      },
    }).catch(() => {});

    return Response.json({ ok: true, student, warning, message: `${existing?.name || '학생'} 정보를 저장했습니다.${warning ? ` ${warning}` : ''}` });
  } catch (error) {
    return Response.json({ error: error.message || 'Unknown error' }, { status: 500 });
  }
}
