import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabaseConfig.js'

// Env vars (e.g. a local .env) take precedence; otherwise fall back to the
// committed public config so the app works out of the box in dev and on Pages.
const url = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_PUBLISHABLE_KEY

// The app is fully usable for editing + local export even without Supabase
// configured. Persistence/upload features degrade gracefully when this is null.
export const isSupabaseConfigured = Boolean(
  url && anonKey && anonKey !== 'your-anon-key-here',
)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: false } })
  : null

export const BUCKETS = { images: 'images', exports: 'exports' }
