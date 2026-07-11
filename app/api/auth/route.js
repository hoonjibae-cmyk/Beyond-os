import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();
  return Response.json({ ok: true });
}
