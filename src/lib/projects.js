import { supabase, isSupabaseConfigured } from './supabase.js'

// Persist a project row. `id` optional — when provided we update in place.
export async function saveProject({ id, originalImageUrl, finalImageUrl, stickerJson }) {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'supabase-not-configured' }
  }
  const row = {
    original_image_url: originalImageUrl ?? null,
    final_image_url: finalImageUrl ?? null,
    sticker_json: stickerJson ?? [],
  }
  let query
  if (id) {
    query = supabase.from('projects').update(row).eq('id', id).select().single()
  } else {
    query = supabase.from('projects').insert(row).select().single()
  }
  const { data, error } = await query
  if (error) return { ok: false, reason: error.message }
  return { ok: true, project: data }
}

export async function loadProject(id) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' }
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
  if (error) return { ok: false, reason: error.message }
  return { ok: true, project: data }
}
