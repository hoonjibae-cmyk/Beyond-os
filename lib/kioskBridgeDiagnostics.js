// Beyond OS v40-118
// 키오스크 브릿지 SQL/환경 진단 공통 유틸리티

function serializeSupabaseError(error) {
  if (!error) return null;
  return {
    message: error.message || String(error),
    code: error.code || null,
    details: error.details || null,
    hint: error.hint || null,
  };
}

function classifySchemaError(error, label) {
  const message = String(error?.message || error || '');
  if (/relation .* does not exist/i.test(message) || /Could not find the table/i.test(message)) {
    return `${label} 테이블이 없습니다. v40-115 키오스크 브릿지 SQL 실행 여부를 확인하세요.`;
  }
  if (/column .* does not exist/i.test(message) || /Could not find .* column/i.test(message)) {
    return `${label}에 필요한 컬럼이 없습니다. v40-115 SQL이 일부만 실행되었을 수 있습니다.`;
  }
  return `${label} 점검 중 오류가 발생했습니다.`;
}

export async function checkKioskBridgeReadiness(supabase) {
  const checks = [];

  const importCheck = await supabase
    .from('attendance_import_events')
    .select('id,source,source_device_id,idempotency_key,raw_text,parsed_event_type,parsed_student_name,status,error_message,received_at,processed_at')
    .limit(1);

  checks.push({
    key: 'attendance_import_events',
    label: '키오스크 수신 로그 테이블',
    ok: !importCheck.error,
    message: importCheck.error ? classifySchemaError(importCheck.error, 'attendance_import_events') : '정상',
    error: serializeSupabaseError(importCheck.error),
  });

  const eventCheck = await supabase
    .from('attendance_events')
    .select('id,source_type,source_label,import_event_id')
    .limit(1);

  checks.push({
    key: 'attendance_events_source_columns',
    label: '출결 이벤트 출처 컬럼',
    ok: !eventCheck.error,
    message: eventCheck.error ? classifySchemaError(eventCheck.error, 'attendance_events') : '정상',
    error: serializeSupabaseError(eventCheck.error),
  });


  const aliasCheck = await supabase
    .from('kiosk_student_aliases')
    .select('id,alias_name,student_id,is_active')
    .limit(1);

  checks.push({
    key: 'kiosk_student_aliases',
    label: '학생명 연결 규칙 테이블',
    ok: !aliasCheck.error,
    required: false,
    message: aliasCheck.error ? 'v41-05 학생명 연결/재처리 SQL이 아직 실행되지 않았습니다. 기존 자동반영은 계속 동작하지만, 학생명 수동 연결 기능은 사용할 수 없습니다.' : '정상',
    error: serializeSupabaseError(aliasCheck.error),
  });

  return {
    ok: checks.filter((item) => item.required !== false).every((item) => item.ok),
    secretConfigured: Boolean(process.env.KIOSK_BRIDGE_SECRET),
    checks,
  };
}

export function buildKioskErrorResponse({ status = 500, stage = 'unknown', error, fallbackMessage, extra = {} } = {}) {
  const message = error?.message || fallbackMessage || '키오스크 브릿지 처리 중 오류가 발생했습니다.';
  return Response.json({
    ok: false,
    stage,
    error: message,
    detail: error ? serializeSupabaseError(error) || { message: String(error) } : null,
    ...extra,
  }, { status });
}
