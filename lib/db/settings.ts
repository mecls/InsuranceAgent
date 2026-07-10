import { supabaseService } from '@/lib/supabase/service'

/**
 * App settings — a single-row config table for the single-tenant demo. Holds the
 * global "Automatizar" switch: when on, incoming cases run end-to-end and the
 * quote auto-sends; when off, they land as drafts the user reviews and starts.
 */
const SETTINGS_ID = 'default'

export async function getAutomate(): Promise<boolean> {
  // Tolerant: before migration 0008 the table may not exist yet; default OFF.
  try {
    const { data, error } = await supabaseService()
      .from('app_settings')
      .select('automate')
      .eq('id', SETTINGS_ID)
      .maybeSingle()
    if (error) return false
    return !!(data as { automate?: boolean } | null)?.automate
  } catch {
    return false
  }
}

export async function setAutomate(value: boolean): Promise<void> {
  const { error } = await supabaseService()
    .from('app_settings')
    .upsert({ id: SETTINGS_ID, automate: value })
  if (error) throw new Error(`setAutomate failed: ${error.message}`)
}
