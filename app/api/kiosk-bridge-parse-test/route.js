import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

function normalizeRawMessage(value = '') {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function compactMessage(value = '') {
  return normalizeRawMessage(value).replace(/\s+/g, ' ').trim();
}

function safeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectKioskEventType(raw = '') {
  const text = compactMessage(raw);
  const explicit = text.match(/^<\s*(입실|외출|퇴실|재입장)\s*>/);
  if (explicit) return explicit[1];
  if (/재입장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /재입장\s*했어요/.test(text) || /다시\s*돌아왔어요/.test(text)) return '재입장';
  if (/외출(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /(?:잠시\s*)?외출\s*했어요/.test(text)) return '외출';
  if (/퇴장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /퇴장\s*했어요/.test(text) || /하원\s*했어요/.test(text)) return '퇴실';
  if (/입장(?:을)?\s*(?:했|하였|하셨)습니다/.test(text) || /입장\s*했어요/.test(text) || /학원에\s*도착했어요/.test(text)) return '입실';
  return '';
}

function stripOptionalTypePrefix(raw = '') {
  return normalizeRawMessage(raw)
    .replace(/^\s*\[\s*Web발신\s*\]\s*/i, '')
    .replace(/^<\s*(입실|외출|퇴실|재입장)\s*>\s*/, '')
    .trim();
}

function stripKnownEventPhrases(text = '') {
  return compactMessage(text)
    .replace(/님이.*$/, '')
    .replace(/학생이.*$/, '')
    .replace(/\s*(?:입장|외출|퇴장|하원|재입장|학원에\s*도착|다시\s*돌아).*$/, '')
    .trim();
}

function matchStudentFromPrefix(prefix = '', activeStudents = []) {
  const normalizedPrefix = compactMessage(prefix);
  const matches = activeStudents
    .filter((student) => normalizedPrefix.endsWith(String(student.name || '').trim()))
    .sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  if (matches.length === 1) return { matchedStudent: matches[0], studentName: matches[0].name };
  if (matches.length > 1 && String(matches[0].name || '').length > String(matches[1].name || '').length) {
    return { matchedStudent: matches[0], studentName: matches[0].name };
  }
  const tokens = normalizedPrefix.split(/\s+/).filter(Boolean);
  return { matchedStudent: null, studentName: tokens[tokens.length - 1] || normalizedPrefix };
}

function normalizeAliasName(value = '') {
  return compactMessage(value).replace(/\s+/g, '').toLowerCase();
}

function findStudentByAlias(parsedStudentName, aliases = [], students = []) {
  const target = normalizeAliasName(parsedStudentName);
  if (!target) return null;
  const alias = (aliases || []).find((item) => normalizeAliasName(item.alias_name) === target);
  if (!alias?.student_id) return null;
  return (students || []).find((student) => student.id === alias.student_id) || null;
}

function parseKioskText(rawText = '', students = [], aliases = []) {
  const originalRaw = normalizeRawMessage(rawText);
  const raw = compactMessage(originalRaw);
  const koreanType = detectKioskEventType(originalRaw);
  if (!koreanType) {
    return { ok: false, error: '지원하지 않는 문자 형식입니다.', rawText: originalRaw };
  }
  const activeStudents = (students || []).filter((student) => student?.status !== 'inactive' && student?.name);
  const cleaned = stripOptionalTypePrefix(originalRaw);
  const compact = compactMessage(cleaned);
  let beforeNameMarker = '';
  let marker = '';
  if (compact.includes('님이')) {
    beforeNameMarker = compact.split('님이')[0]?.trim() || '';
    marker = '님이';
  } else if (compact.includes('학생이')) {
    beforeNameMarker = compact.split('학생이')[0]?.trim() || '';
    marker = '학생이';
  } else {
    beforeNameMarker = stripKnownEventPhrases(compact);
  }
  if (!beforeNameMarker) return { ok: false, error: '학생명을 찾을 수 없습니다.', rawText: originalRaw, koreanType };

  const matchResult = matchStudentFromPrefix(beforeNameMarker, activeStudents);
  let parsedStudentName = matchResult.studentName;
  let matchedStudent = matchResult.matchedStudent;
  let academyName = '';
  if (matchedStudent) {
    academyName = compactMessage(beforeNameMarker.slice(0, beforeNameMarker.length - String(parsedStudentName).length));
  } else if (marker === '학생이') {
    const tokens = beforeNameMarker.split(/\s+/).filter(Boolean);
    parsedStudentName = tokens[tokens.length - 1] || beforeNameMarker;
    academyName = tokens.slice(0, -1).join(' ');
  } else {
    const tokens = beforeNameMarker.split(/\s+/).filter(Boolean);
    parsedStudentName = tokens[tokens.length - 1] || beforeNameMarker;
    academyName = tokens.slice(0, -1).join(' ');
  }

  const reasonMatch = raw.match(/사유\s*[:：]\s*([^]+?)(?:\s+재원시간\s*[:：]|$)/);
  const durationMatch = raw.match(/재원시간\s*[:：]\s*(.+)$/);
  const eventTypeMap = { 입실: 'check_in', 외출: 'away', 퇴실: 'check_out', 재입장: 'return' };
  const aliasMatchedStudent = !matchedStudent ? findStudentByAlias(parsedStudentName, aliases, activeStudents) : null;
  if (aliasMatchedStudent) matchedStudent = aliasMatchedStudent;

  return {
    ok: true,
    rawText: originalRaw,
    compactRaw: raw,
    koreanType,
    eventType: eventTypeMap[koreanType],
    studentName: parsedStudentName,
    matched: Boolean(matchedStudent),
    aliasMatched: Boolean(aliasMatchedStudent),
    matchedStudentId: matchedStudent?.id || null,
    matchedStudentName: matchedStudent?.name || null,
    academyName,
    reason: reasonMatch ? safeText(reasonMatch[1]) : '',
    duration: durationMatch ? safeText(durationMatch[1]) : '',
    canAutoApply: Boolean(matchedStudent),
    message: matchedStudent ? (aliasMatchedStudent ? '파싱 가능: 저장된 학생명 연결 규칙으로 매칭되었습니다.' : '파싱과 학생 매칭이 가능합니다.') : '문구 파싱은 가능하지만 Beyond OS 활성 학생명과 아직 매칭되지 않았습니다.',
  };
}

export async function POST(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  try {
    const body = await request.json().catch(() => ({}));
    const rawText = body.rawText || body.text || '';
    const supabase = getSupabaseAdmin();
    const { data: students, error } = await supabase
      .from('students')
      .select('id, name, status, default_seat_no')
      .neq('status', 'inactive')
      .order('name', { ascending: true });
    if (error) throw error;
    let aliases = [];
    try {
      const aliasResult = await supabase
        .from('kiosk_student_aliases')
        .select('id, alias_name, student_id, is_active')
        .eq('is_active', true);
      aliases = aliasResult.error ? [] : aliasResult.data || [];
    } catch {
      aliases = [];
    }
    const result = parseKioskText(rawText, students || [], aliases);
    return Response.json({ ok: true, parseResult: result, activeStudentCount: (students || []).length, aliasCount: aliases.length });
  } catch (error) {
    return Response.json({ ok: false, error: error.message || '키오스크 문자 원문 테스트 실패' }, { status: 500 });
  }
}
