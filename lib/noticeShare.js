import crypto from 'crypto';

export function createNoticeToken() {
  return crypto.randomBytes(18).toString('base64url');
}

export function getPublicBaseUrl(request) {
  const configured = process.env.PUBLIC_APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const host = request?.headers?.get?.('x-forwarded-host') || request?.headers?.get?.('host') || (process.env.VERCEL_URL || '');
  if (!host) return '';
  const proto = request?.headers?.get?.('x-forwarded-proto') || 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

// 외부 URL이 있으면 그 링크, 없으면 인앱 공지 페이지(/n/{token})
export function getNoticeLink(request, notice) {
  const external = String(notice?.external_url || '').trim();
  if (external) return external;
  const base = getPublicBaseUrl(request);
  if (!base || !notice?.token) return '';
  return `${base}/n/${notice.token}`;
}
