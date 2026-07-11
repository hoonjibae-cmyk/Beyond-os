import crypto from 'crypto';

function createToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function getPublicBaseUrl(request) {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');

  const host = request?.headers?.get?.('x-forwarded-host')
    || request?.headers?.get?.('host')
    || (process.env.VERCEL_URL ? `${process.env.VERCEL_URL}` : '');

  if (!host) return '';

  const proto = request?.headers?.get?.('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

export function getPublicReportUrl(request, token) {
  const base = getPublicBaseUrl(request);
  if (!base || !token) return '';
  return `${base}/r/${token}`;
}

export async function ensureReportShareLink(supabase, request, {
  reportType,
  reportId,
  createdBy = 'system',
  expiresDays = 30,
} = {}) {
  if (!supabase || !reportType || !reportId) {
    return { url: '', token: '', error: 'missing-input' };
  }

  const nowIso = new Date().toISOString();

  try {
    const { data: existing, error: existingError } = await supabase
      .from('report_share_links')
      .select('*')
      .eq('report_type', reportType)
      .eq('report_id', String(reportId))
      .eq('is_active', true)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingError && existing?.token) {
      return {
        url: getPublicReportUrl(request, existing.token),
        token: existing.token,
        row: existing,
      };
    }

    const token = createToken();
    const expiresAt = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('report_share_links')
      .insert({
        report_type: reportType,
        report_id: String(reportId),
        token,
        expires_at: expiresAt,
        is_active: true,
        created_by: createdBy,
      })
      .select()
      .single();

    if (error) throw error;

    return {
      url: getPublicReportUrl(request, data.token),
      token: data.token,
      row: data,
    };
  } catch (error) {
    // SQL 미실행 상태에서도 리포트 발송 자체는 막지 않습니다.
    return { url: '', token: '', error: error.message || 'share-link-error' };
  }
}
