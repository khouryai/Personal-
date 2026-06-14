import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// The app is fully usable for editing + local export even without Supabase
// configured. Persistence/upload features degrade gracefully when this is null.
export const isSupabaseConfigured = Boolean(
  url && anonKey && anonKey !== 'your-anon-key-here',
)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : null

export const BUCKETS = { images: 'images', exports: 'exports' }
