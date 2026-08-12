// Beyond OS v41-151
// 학부모가 토큰 링크에서 시간표를 확인/수정 제출하는 공개 API입니다.
//
// 로그인 없이 열리므로 토큰으로 찾은 한 건만 다룹니다.
// 제출 내용은 곧바로 시간표에 반영하지 않고 response에 담아 두고,
// 관리자가 확인한 뒤 반영합니다.

import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { normalizeWeekPattern, normalizeSpecialItems } from '../schedule-confirm/route';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const token = String(body.token || '').trim();
    const decision = String(body.decision || '').trim(); // 'confirm' | 'change'
    if (!token) return Response.json({ error: '잘못된 접근입니다.' }, { status: 400 });
    if (!['confirm', 'change'].includes(decision)) {
      return Response.json({ error: '확인 또는 수정 요청 중 하나를 선택해 주세요.' }, { status: 400 });
    }

    const guardianName = String(body.guardianName || '').trim();
    if (!guardianName) return Response.json({ error: '보호자 성함을 입력해 주세요.' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: row, error: rowError } = await supabase
      .from('schedule_confirmations')
      .select('id, status, snapshot, start_date, end_date')
      .eq('token', token)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) return Response.json({ error: '만료되었거나 잘못된 링크입니다.' }, { status: 404 });

    const payload = {
      status: decision === 'confirm' ? 'confirmed' : 'change_requested',
      confirmed_by: guardianName.slice(0, 40),
      confirmed_at: new Date().toISOString(),
      parent_note: String(body.note || '').slice(0, 1000) || null,
      updated_at: new Date().toISOString(),
    };

    if (decision === 'change') {
      payload.response = {
        days: normalizeWeekPattern(body.days || {}),
        // v41-152: 특별 일정도 학부모가 그 자리에서 고칠 수 있습니다.
        special: normalizeSpecialItems(body.special, {
          periodStart: row.start_date || '',
          periodEnd: row.end_date || '',
        }),
      };
    } else {
      payload.response = null;
    }

    const { error: updateError } = await supabase
      .from('schedule_confirmations')
      .update(payload)
      .eq('id', row.id);
    if (updateError) throw updateError;

    return Response.json({
      ok: true,
      status: payload.status,
      message: decision === 'confirm'
        ? '확인해 주셔서 감사합니다. 제출이 완료되었습니다.'
        : '수정 요청이 접수되었습니다. 확인 후 반영하고 다시 안내드리겠습니다.',
    });
  } catch (error) {
    return Response.json({ error: error?.message || '제출 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
