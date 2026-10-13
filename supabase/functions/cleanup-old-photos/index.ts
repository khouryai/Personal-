// Deletes saved photos 30 days after their last save — the project row and
// every Storage file it pointed at — plus any stray file older than 30 days
// that no remaining project references (e.g. left behind by a failed save).
//
// Runs once a day from pg_cron (see supabase/schema.sql). Storage blocks
// deleting files with SQL, so this goes through the Storage API instead.
// It takes no input and only ever applies the fixed 30-day rule, so it needs
// no caller auth: calling it early can't delete anything the schedule wouldn't.
import { createClient } from 'npm:@supabase/supabase-js@2'

const RETENTION_DAYS = 30
const BUCKETS = ['images', 'exports']
const PAGE = 1000

// "https://…/storage/v1/object/public/<bucket>/<path>" -> "<bucket>/<path>"
function storageKey(url: string | null | undefined) {
  const m = String(url ?? '').match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
  return m ? `${m[1]}/${decodeURIComponent(m[2])}` : null
}

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()

  // 1. Expired project rows.
  const { data: expired, error: selErr } = await supabase
    .from('projects').select('id').lt('updated_at', cutoff)
  if (selErr) return Response.json({ error: selErr.message }, { status: 500 })
  const ids = (expired ?? []).map((p) => p.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from('projects').delete().in('id', ids.slice(i, i + 100))
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // 2. Files still in use by the projects that remain.
  const { data: live, error: liveErr } = await supabase
    .from('projects').select('original_image_url, final_image_url, thumb_url, bg:scene_json->>bg')
  if (liveErr) return Response.json({ error: liveErr.message }, { status: 500 })
  const inUse = new Set<string>()
  for (const p of live ?? []) {
    for (const u of [p.original_image_url, p.final_image_url, p.thumb_url, p.bg]) {
      const k = storageKey(u as string)
      if (k) inUse.add(k)
    }
  }

  // 3. Remove files older than the cutoff that nothing points at. A file of
  // an expired project is always older than the cutoff, since it was uploaded
  // no later than that project's last save.
  let filesRemoved = 0
  for (const bucket of BUCKETS) {
    const stale: string[] = []
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage.from(bucket)
        .list('', { limit: PAGE, offset, sortBy: { column: 'created_at', order: 'asc' } })
      if (error) return Response.json({ error: error.message }, { status: 500 })
      for (const f of data ?? []) {
        if (!f.id) continue // a folder, not a file
        if (f.created_at < cutoff && !inUse.has(`${bucket}/${f.name}`)) stale.push(f.name)
      }
      if (!data || data.length < PAGE) break
    }
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await supabase.storage.from(bucket).remove(stale.slice(i, i + 100))
      if (error) return Response.json({ error: error.message }, { status: 500 })
    }
    filesRemoved += stale.length
  }

  return Response.json({ projectsDeleted: ids.length, filesRemoved, cutoff })
})
