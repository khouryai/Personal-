import { supabase, isSupabaseConfigured, BUCKETS } from './supabase.js'

function randomId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`
}

// Upload a Blob/File to a bucket and return its public URL (or null if Supabase
// isn't configured — the app keeps working locally in that case).
async function uploadToBucket(bucket, blob, ext) {
  if (!isSupabaseConfigured) return null
  const path = `${randomId()}.${ext}`
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: blob.type, upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}

export function uploadOriginal(file) {
  const ext = (file.name?.split('.').pop() || 'png').toLowerCase()
  return uploadToBucket(BUCKETS.images, file, ext)
}

export function uploadExport(blob, format = 'png') {
  return uploadToBucket(BUCKETS.exports, blob, format)
}

export function uploadThumb(blob) {
  return uploadToBucket(BUCKETS.exports, blob, 'jpg')
}

// Extract { bucket, path } from a Supabase public storage URL.
export function parseStorageUrl(url) {
  if (!url) return null
  const m = String(url).match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  return m ? { bucket: m[1], path: decodeURIComponent(m[2]) } : null
}

// Drop storage objects a project no longer points at. Re-saving a project used
// to leave its previous 20 MB render behind forever; this collects it.
// Best-effort — losing a superseded file is never worth failing a save over.
export async function removeByUrl(...urls) {
  if (!isSupabaseConfigured) return
  const byBucket = {}
  urls.map(parseStorageUrl).filter(Boolean)
    .forEach((s) => {
      const paths = (byBucket[s.bucket] ||= [])
      if (!paths.includes(s.path)) paths.push(s.path)
    })
  for (const [bucket, paths] of Object.entries(byBucket)) {
    try { await supabase.storage.from(bucket).remove(paths) } catch { /* best-effort */ }
  }
}
