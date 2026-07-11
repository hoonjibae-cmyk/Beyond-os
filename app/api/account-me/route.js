import { getAuthorizedUser, unauthorizedResponse } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const user = getAuthorizedUser(request);
  if (!user) return unauthorizedResponse();
  return Response.json({ ok: true, user });
}
