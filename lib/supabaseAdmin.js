import { createClient } from '@supabase/supabase-js';

export function getSupabaseEnv() {
  const rawUrl = process.env.SUPABASE_URL || '';
  const rawKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  const supabaseUrl = rawUrl.trim().replace(/\/+$/, '');
  const supabaseKey = rawKey.trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable');
  }

  if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    throw new Error('SUPABASE_URL must look like https://PROJECT_REF.supabase.co');
  }

  return { supabaseUrl, supabaseKey };
}

export function getSupabaseAdmin() {
  const { supabaseUrl, supabaseKey } = getSupabaseEnv();

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
