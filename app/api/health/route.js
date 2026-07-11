import { getSupabaseAdmin, getSupabaseEnv } from '../../../lib/supabaseAdmin';
import { isAuthorized, unauthorizedResponse } from '../../../lib/auth';
import { APP_VERSION, APP_VERSION_NAME, APP_VERSION_DESCRIPTION } from '../../../lib/appVersion';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  if (!isAuthorized(request)) return unauthorizedResponse();

  try {
    const { supabaseUrl, supabaseKey } = getSupabaseEnv();
    const supabase = getSupabaseAdmin();
    const { data, error, count } = await supabase
      .from('seats')
      .select('seat_no', { count: 'exact' })
      .limit(1);

    return Response.json({
      ok: !error,
      appVersion: APP_VERSION,
      appVersionName: APP_VERSION_NAME,
      appVersionDescription: APP_VERSION_DESCRIPTION,
      supabaseUrlHost: new URL(supabaseUrl).host,
      hasSecretKey: Boolean(supabaseKey),
      secretKeyPrefix: supabaseKey.slice(0, 10),
      seatsProbeCount: count,
      seatsProbeData: data || [],
      error: error?.message || null,
    });
  } catch (error) {
    return Response.json({
      ok: false,
      appVersion: APP_VERSION,
      appVersionName: APP_VERSION_NAME,
      error: error?.message || String(error),
    });
  }
}
