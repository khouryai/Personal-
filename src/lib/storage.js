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
