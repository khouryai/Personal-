import React, { useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase.js'

export default function Gallery({ api, onClose, onOpen }) {
  const [state, setState] = useState({ loading: true, projects: [], error: null })
  const [busy, setBusy] = useState(null) // id being deleted

  useEffect(() => {
    let alive = true
    api.fetchGallery().then((res) => {
      if (!alive) return
      if (res.ok) setState({ loading: false, projects: res.projects, error: null })
      else setState({ loading: false, projects: [], error: res.reason })
    })
    return () => { alive = false }
  }, [api])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Saved photos</strong>
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>

        {!isSupabaseConfigured && <p className="panel-empty">Supabase isn’t configured.</p>}
        {state.loading && <p className="panel-empty">Loading…</p>}
        {state.error && <p className="panel-empty">Couldn’t load: {state.error}</p>}
        {!state.loading && !state.error && state.projects.length === 0 && (
          <p className="panel-empty">No saved photos yet. Export an image to save one here.</p>
        )}

        <div className="gallery-grid">
          {state.projects.map((p) => {
            // Prefer the marked-up render so reopening shows the edited image.
            const img = p.final_image_url || p.original_image_url
            return (
              <div className="gallery-item" key={p.id}>
                {img
                  ? <img src={img} alt="saved" loading="lazy" />
                  : <div className="gallery-noimg">no image</div>}
                <div className="gallery-actions">
                  <button className="btn" onClick={() => { api.openProject(p.id); onClose() }}>
                    Edit
                  </button>
                  {img && (
                    <a className="btn" href={img} target="_blank" rel="noreferrer">View</a>
                  )}
                  <button
                    className="btn danger"
                    disabled={busy === p.id}
                    onClick={async () => {
                      if (!window.confirm('Permanently delete this photo from storage? This cannot be undone.')) return
                      setBusy(p.id)
                      const res = await api.deleteProject(p.id)
                      setBusy(null)
                      if (res.ok) {
                        setState((s) => ({ ...s, projects: s.projects.filter((x) => x.id !== p.id) }))
                      } else {
                        alert(`Delete failed: ${res.reason}`)
                      }
                    }}
                  >
                    {busy === p.id ? '…' : 'Delete'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
