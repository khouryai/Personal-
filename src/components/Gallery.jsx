import React, { useCallback, useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase.js'

const UNITS = [
  [1, 's'], [60, 'm'], [3600, 'h'], [86400, 'd'], [604800, 'w'], [2629800, 'mo'],
]

function timeAgo(iso) {
  if (!iso) return ''
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 5) return 'just now'
  let [size, unit] = UNITS[0]
  for (const [s, u] of UNITS) {
    if (secs < s) break
    size = s; unit = u
  }
  return `${Math.floor(secs / size)}${unit} ago`
}

export default function Gallery({ api, currentId, onClose }) {
  const [state, setState] = useState({ loading: true, projects: [], error: null })
  const [busy, setBusy] = useState(null)     // { id, action } in flight
  const [itemError, setItemError] = useState(null) // { id, message }
  // A ref, not just the state: two taps in the same tick both read the old
  // state value, so a fast double-tap would otherwise fire two opens.
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const res = await api.fetchGallery()
    setState(res.ok
      ? { loading: false, projects: res.projects, error: null }
      : { loading: false, projects: [], error: res.reason })
  }, [api])

  useEffect(() => { load() }, [load])

  // Wait for the photo to actually be on the canvas before closing. The old
  // version fired openProject and closed immediately, so a slow or failed load
  // looked like the button simply hadn't worked.
  const run = async (p, action, fn) => {
    if (busyRef.current) return
    busyRef.current = true
    setItemError(null)
    setBusy({ id: p.id, action })
    try {
      return await fn()
    } finally {
      busyRef.current = false
      setBusy(null)
    }
  }

  const openOne = (p) => run(p, 'open', async () => {
    const res = await api.openProject(p.id)
    if (res?.ok) onClose()
    else if (res?.reason !== 'superseded') {
      setItemError({ id: p.id, message: res?.reason || 'could not open' })
    }
  })

  const deleteOne = (p) => {
    if (busyRef.current) return
    if (!window.confirm('Permanently delete this photo from storage? This cannot be undone.')) return
    return run(p, 'delete', async () => {
      const res = await api.deleteProject(p.id)
      if (res.ok) setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id) }))
      else setItemError({ id: p.id, message: res.reason })
    })
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Saved photos</strong>
          <div className="gallery-head-actions">
            <button className="btn ghost small" onClick={load} disabled={state.loading || !!busy}>
              {state.loading ? 'Loading…' : '↻ Refresh'}
            </button>
            <button className="btn ghost" onClick={onClose} disabled={!!busy}>✕</button>
          </div>
        </div>

        {!isSupabaseConfigured && <p className="panel-empty">Supabase isn’t configured.</p>}
        {state.loading && <p className="panel-empty">Loading your saved photos…</p>}
        {state.error && <p className="panel-empty">Couldn’t load: {state.error}</p>}
        {!state.loading && !state.error && state.projects.length === 0 && (
          <p className="panel-empty">No saved photos yet. Save an image to keep it here.</p>
        )}

        <div className="gallery-grid">
          {state.projects.map((p) => {
            // Prefer the small preview; fall back to the full render only for
            // rows saved before thumbnails existed.
            const img = p.thumb_url || p.final_image_url || p.original_image_url
            const isCurrent = p.id === currentId
            const thisBusy = busy?.id === p.id
            const err = itemError?.id === p.id ? itemError.message : null
            return (
              <div className={`gallery-item${isCurrent ? ' current' : ''}`} key={p.id}>
                <div className="gallery-thumb">
                  {img
                    ? <img src={img} alt="saved" loading="lazy" decoding="async" />
                    : <div className="gallery-noimg">no image</div>}
                  {isCurrent && <span className="gallery-badge">Open now</span>}
                  {thisBusy && (
                    <div className="gallery-overlay">
                      <span className="spinner" />
                      {busy.action === 'open' ? 'Opening…' : 'Deleting…'}
                    </div>
                  )}
                </div>

                <div className="gallery-meta">
                  <span>{timeAgo(p.updated_at || p.created_at)}</span>
                  {p.has_editable_scene === false && <span title="Saved before editable layers — reopens flat">flat</span>}
                </div>

                <div className="gallery-actions">
                  <button className="btn" onClick={() => openOne(p)} disabled={!!busy}>
                    {thisBusy && busy.action === 'open' ? '…' : 'Edit'}
                  </button>
                  {(p.final_image_url || p.original_image_url) && (
                    <a className="btn" href={p.final_image_url || p.original_image_url}
                      target="_blank" rel="noreferrer">View</a>
                  )}
                  <button className="btn danger" onClick={() => deleteOne(p)} disabled={!!busy}>
                    {thisBusy && busy.action === 'delete' ? '…' : 'Delete'}
                  </button>
                </div>

                {err && <div className="gallery-error">{err}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
