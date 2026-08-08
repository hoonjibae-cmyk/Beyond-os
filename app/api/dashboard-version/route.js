import crypto from 'crypto';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getKstDateString } from '../../../lib/date';

export const dynamic = 'force-dynamic';

// v41-121: 대시보드 "변경 감지용" 초경량 엔드포인트.
//
// 목적: 대시보드 폴링이 매번 무거운 /api/dashboard 전체 데이터(학생 전원 + 보호자 + 세션 + 이벤트...)를
// 내려받아 Vercel Fast Origin Transfer 비용을 키우던 문제를 해결합니다.
// 클라이언트는 이 엔드포인트로 "바뀌었는지"만 확인하고(수십 바이트),
// 지문(version)이 달라졌을 때만 전체 데이터를 다시 받아갑니다.
//
// 주의: 이 응답은 CDN 캐시를 사용하지 않습니다.
// 인증 헤더 기반 API를 URL 기준으로 캐시하면 미인증 요청에 캐시본이 나갈 수 있어서,
// 대신 아래 서버 인스턴스 메모리 캐시(MICRO_CACHE_MS)로 동시 요청의 DB 조회를 합칩니다.

const MICRO_CACHE_MS = 3000;
let microCache = { key: '', version: '', at: 0 };

async function countRows(supabase, table, apply) {
  try {
    let query = supabase.from(table).select('id', { count: 'exact', head: true });
    if (apply) query = apply(query);
    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
  } catch {
    return -1; // 조회 실패는 지문에 그대로 반영(변경으로 간주되어 전체 동기화 유도)
  }
}

async function buildVersion(supabase, today) {
  const parts = [];

  // 1) 오늘 세션의 출결/학습 상태 (좌석배치도 표시의 핵심) — 필요한 컬럼만 최소 조회
  const { data: sessions, error: sessionsError } = await supabase
    .from('daily_sessions')
    .select('id, seat_no, seat_status, check_in_at, check_out_at, away_started_at, away_total_minutes, pure_study_minutes, current_study_status, current_subject, attendance_memo')
    .eq('session_date', today)
    .order('seat_no', { ascending: true });
  if (sessionsError) throw sessionsError;

  for (const s of sessions || []) {
    parts.push([
      s.id, s.seat_no, s.seat_status, s.check_in_at, s.check_out_at,
      s.away_started_at, s.away_total_minutes, s.pure_study_minutes,
      s.current_study_status, s.current_subject, s.attendance_memo,
    ].join('|'));
  }

  const sessionIds = (sessions || []).map((s) => s.id).filter(Boolean);

  // 2) 세션에 딸린 기록 수 (순찰 체크 / 출결 이벤트)
  if (sessionIds.length) {
    parts.push(`checks:${await countRows(supabase, 'study_checks', (q) => q.in('session_id', sessionIds))}`);
    parts.push(`events:${await countRows(supabase, 'attendance_events', (q) => q.in('session_id', sessionIds))}`);

    // 리포트는 발송 상태 변화까지 반영해야 하므로 상태값을 지문에 포함합니다.
    try {
      const { data: reports } = await supabase
        .from('daily_reports')
        .select('id, send_status, mentor_comment')
        .in('session_id', sessionIds);
      for (const r of reports || []) parts.push(`r:${r.id}:${r.send_status}:${r.mentor_comment ? 1 : 0}`);
    } catch {
      parts.push('r:error');
    }
  } else {
    parts.push('checks:0', 'events:0', 'r:none');
  }

  // 3) 대시보드에 함께 표시되는 항목들
  const sinceIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  parts.push(`kiosk:${await countRows(supabase, 'attendance_import_events', (q) => q.gte('received_at', sinceIso))}`);
  parts.push(`focusAck:${await countRows(supabase, 'field_focus_acknowledgements', (q) => q.eq('ack_date', today).eq('is_active', true))}`);
  parts.push(`students:${await countRows(supabase, 'students', (q) => q.eq('status', 'active'))}`);

  // 쉬는 시간 키오스크 HOLD (판정 대기 건수)
  parts.push(`holds:${await countRows(supabase, 'kiosk_attendance_holds', (q) => q.eq('status', 'pending'))}`);

  // v41-145: 학부모 확인 요청 발송 내역.
  // 한 직원이 알림을 보내면 다른 직원 화면도 곧바로 '발송됨'으로 바뀌어야 중복 발송을 막습니다.
  parts.push(`parentAlerts:${await countRows(supabase, 'parent_notification_logs', (q) => q
    .gte('created_at', `${today}T00:00:00+09:00`)
    .lte('created_at', `${today}T23:59:59+09:00`))}`);

  return crypto.createHash('sha1').update(parts.join('\n')).digest('hex');
}

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  const today = getKstDateString();

  try {
    // 같은 서버 인스턴스로 몰린 동시 요청은 DB를 다시 조회하지 않고 결과를 재사용합니다.
    const now = Date.now();
    if (microCache.key === today && now - microCache.at < MICRO_CACHE_MS && microCache.version) {
      return Response.json(
        { ok: true, today, version: microCache.version, cached: true },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const version = await buildVersion(getSupabaseAdmin(), today);
    microCache = { key: today, version, at: now };

    return Response.json(
      { ok: true, today, version, cached: false },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // 실패 시 클라이언트는 전체 동기화 안전망(주기적 1회)으로 처리합니다.
    return Response.json(
      { ok: false, today, version: '', error: error.message || '대시보드 변경 감지 실패' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
