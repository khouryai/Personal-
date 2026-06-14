import React, { useEffect, useRef, useState } from 'react'
import { useEditor } from './hooks/useEditor.js'
import PropertiesPanel from './components/PropertiesPanel.jsx'
import TemplatePanel from './components/TemplatePanel.jsx'
import { isSupabaseConfigured } from './lib/supabase.js'

export default function App() {
  const ed = useEditor()
  const fileRef = useRef(null)
  // mobile bottom-sheet: null | 'templates' | 'properties'
  const [sheet, setSheet] = useState(null)

  // open the properties sheet automatically when a sticker is selected on mobile
  useEffect(() => {
    if (ed.activeSpec && window.innerWidth <= 820) setSheet('properties')
  }, [ed.activeSpec?.id])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); ed.api.undo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); ed.api.duplicateActive() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { ed.api.deleteActive() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ed.api])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (f) ed.api.loadImageFromFile(f)
    e.target.value = ''
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🏷️ PriceTag Studio</div>
        <div className="top-actions">
          {ed.status && <span className="status">{ed.status}</span>}
          <button className="btn ghost" onClick={ed.api.save} disabled={!ed.hasImage}>Save</button>
          <button className="btn primary" onClick={() => ed.api.exportImage('png')} disabled={!ed.hasImage}>
            Download
          </button>
        </div>
      </header>

      <div className="layout">
        {/* LEFT TOOLS (desktop) */}
        <aside className="tools">
          <button className="tool" onClick={() => fileRef.current?.click()}>📷 Upload</button>
          <button className="tool" onClick={() => ed.api.addSticker()} disabled={!ed.hasImage}>➕ Sticker</button>
          <div className="tool-section-label">Templates</div>
          <TemplatePanel api={ed.api} />
          <div className="tool-section-label">Canvas</div>
          <div className="tool-grid">
            <button className="btn" onClick={() => ed.api.zoomBy(1.2)} disabled={!ed.hasImage}>＋</button>
            <button className="btn" onClick={() => ed.api.zoomBy(0.8)} disabled={!ed.hasImage}>－</button>
            <button className="btn" onClick={ed.api.resetZoom} disabled={!ed.hasImage}>Fit</button>
            <button className="btn" onClick={ed.api.undo} disabled={!ed.hasImage}>↶ Undo</button>
          </div>
          <label className="toggle snap">
            <input type="checkbox" checked={ed.snap} onChange={(e) => ed.setSnap(e.target.checked)} />
            <span>Snap to grid</span>
          </label>
          <div className="export-row">
            <button className="btn" onClick={() => ed.api.exportImage('png')} disabled={!ed.hasImage}>PNG</button>
            <button className="btn" onClick={() => ed.api.exportImage('jpg')} disabled={!ed.hasImage}>JPG</button>
          </div>
        </aside>

        {/* CENTER CANVAS */}
        <main className="stage">
          <div className="canvas-wrap">
            <canvas ref={ed.attach} />
            {!ed.hasImage && (
              <div className="dropzone" onClick={() => fileRef.current?.click()}>
                <div className="dz-inner">
                  <div className="dz-icon">📷</div>
                  <strong>Upload a photo</strong>
                  <span>Tap to choose an image, then add price-tag stickers</span>
                </div>
              </div>
            )}
          </div>
          <p className="hint">Drag to move · corner handles to resize · top handle to rotate · Alt-drag / pinch to pan · scroll to zoom</p>
        </main>

        {/* RIGHT PROPERTIES (desktop) */}
        <aside className="properties-panel">
          <div className="panel-title">Properties</div>
          <PropertiesPanel spec={ed.activeSpec} api={ed.api} />
        </aside>
      </div>

      {/* BOTTOM TOOLBAR (mobile) */}
      <nav className="bottombar">
        <button onClick={() => fileRef.current?.click()}>📷<span>Upload</span></button>
        <button onClick={() => ed.api.addSticker()} disabled={!ed.hasImage}>➕<span>Sticker</span></button>
        <button onClick={() => setSheet('templates')} disabled={!ed.hasImage}>🏷️<span>Templates</span></button>
        <button onClick={ed.api.undo} disabled={!ed.hasImage}>↶<span>Undo</span></button>
        <button onClick={() => ed.api.exportImage('png')} disabled={!ed.hasImage}>⬇<span>Export</span></button>
      </nav>

      {/* MOBILE BOTTOM SHEET */}
      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            {sheet === 'templates' && (
              <>
                <div className="sheet-title">Templates</div>
                <TemplatePanel api={ed.api} onPick={() => setSheet('properties')} />
              </>
            )}
            {sheet === 'properties' && (
              <>
                <div className="sheet-title">Edit sticker</div>
                <PropertiesPanel spec={ed.activeSpec} api={ed.api} />
              </>
            )}
          </div>
        </div>
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      {!isSupabaseConfigured && (
        <div className="config-banner">
          Supabase not configured — editing & export work locally. Add keys in <code>.env</code> to save projects.
        </div>
      )}
    </div>
  )
}
