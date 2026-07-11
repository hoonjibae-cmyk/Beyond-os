import { DEFAULT_SCHEDULE_SETTING_KEY, FALLBACK_DEFAULT_SCHEDULE_SETTINGS, normalizeDefaultScheduleSettings } from './defaultSchedule';

export async function getDefaultScheduleSettings(supabase) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', DEFAULT_SCHEDULE_SETTING_KEY)
      .maybeSingle();

    if (error) throw error;
    return normalizeDefaultScheduleSettings(data?.setting_value || FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
  } catch {
    return normalizeDefaultScheduleSettings(FALLBACK_DEFAULT_SCHEDULE_SETTINGS);
  }
}
