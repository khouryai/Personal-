import { supabase, isSupabaseConfigured } from './supabase.js'

// Persist a project row. `id` optional — when provided we update in place.
export async function saveProject({ id, originalImageUrl, finalImageUrl, stickerJson, sceneJson }) {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'supabase-not-configured' }
  }
  // Only include provided fields so updates don't clobber existing values with null.
  const row = { sticker_json: stickerJson ?? [] }
  if (originalImageUrl != null) row.original_image_url = originalImageUrl
  if (finalImageUrl != null) row.final_image_url = finalImageUrl
  if (sceneJson !== undefined) row.scene_json = sceneJson
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

export async function listProjects(limit = 60) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured', projects: [] }
  const { data, error } = await supabase
    .from('projects')
    .select('id, original_image_url, final_image_url, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) return { ok: false, reason: error.message, projects: [] }
  return { ok: true, projects: data || [] }
}

export async function loadProject(id) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' }
  const { data, error } = await supabase.from('projects').select('*').eq('id', id).single()
  if (error) return { ok: false, reason: error.message }
  return { ok: true, project: data }
}
