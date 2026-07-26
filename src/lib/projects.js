import { supabase, isSupabaseConfigured } from './supabase.js'
import { removeByUrl } from './storage.js'

// Persist a project row. `id` optional — when provided we update in place.
export async function saveProject({ id, originalImageUrl, finalImageUrl, thumbUrl, stickerJson, sceneJson }) {
  if (!isSupabaseConfigured) {
    return { ok: false, reason: 'supabase-not-configured' }
  }
  // Only include provided fields so updates don't clobber existing values with null.
  const row = { sticker_json: stickerJson ?? [] }
  if (originalImageUrl != null) row.original_image_url = originalImageUrl
  if (finalImageUrl != null) row.final_image_url = finalImageUrl
  if (thumbUrl != null) row.thumb_url = thumbUrl
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
    // Never select scene_json here — it is large and the grid doesn't need it.
    .select('id, original_image_url, final_image_url, thumb_url, has_editable_scene, created_at, updated_at')
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

// Permanently delete a project: its storage files (original/final/thumbnail/
// background) and the database row.
export async function deleteProject(id) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' }
  const { data: p } = await supabase
    .from('projects')
    .select('original_image_url, final_image_url, thumb_url, scene_json')
    .eq('id', id)
    .single()
  if (p) {
    // The scene background is often the original photo reused — removeByUrl
    // dedupes per bucket, so listing it twice is harmless.
    await removeByUrl(p.original_image_url, p.final_image_url, p.thumb_url, p.scene_json?.bg)
  }
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
