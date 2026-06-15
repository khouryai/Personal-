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

// Extract { bucket, path } from a Supabase public storage URL.
function parseStorageUrl(url) {
  if (!url) return null
  const m = String(url).match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

// Permanently delete a project: its storage files (original/final/background)
// and the database row.
export async function deleteProject(id) {
  if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' }
  const { data: p } = await supabase
    .from('projects')
    .select('original_image_url, final_image_url, scene_json')
    .eq('id', id)
    .single()
  if (p) {
    const byBucket = {}
    ;[p.original_image_url, p.final_image_url, p.scene_json?.bg]
      .map(parseStorageUrl)
      .filter(Boolean)
      .forEach((s) => { (byBucket[s.bucket] ||= []).push(s.path) })
    for (const [bucket, paths] of Object.entries(byBucket)) {
      try { await supabase.storage.from(bucket).remove(paths) } catch { /* best-effort */ }
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) return { ok: false, reason: error.message }
  return { ok: true }
}
