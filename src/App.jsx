import React, { useEffect, useRef, useState } from 'react'
import { useEditor } from './hooks/useEditor.js'
import PropertiesPanel from './components/PropertiesPanel.jsx'
import TemplatePanel from './components/TemplatePanel.jsx'
import MarkupBar from './components/MarkupBar.jsx'
import Gallery from './components/Gallery.jsx'
import { isSupabaseConfigured } from './lib/supabase.js'

export default function App() {
  const ed = useEditor()
  const fileRef = useRef(null)
  const [sheet, setSheet] = useState(null) // null|'templates'|'markup'
  const [gallery, setGallery] = useState(false)

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); ed.api.undo() }
      else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); ed.api.duplicateActive() }
      else if (e.key === 'Delete' || e.key === 'Backspace') { ed.api.deleteActive() }
      else if (e.key === 'Escape' && ed.cropMode) { ed.api.cancelCrop() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ed.api, ed.cropMode])

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (f) ed.api.loadImageFromFile(f)
    e.target.value = ''
  }

  const rightPanel = (
    <>
      {ed.activeSpec && <PropertiesPanel spec={ed.activeSpec} api={ed.api} />}
      {!ed.activeSpec && ed.activeMarkup && (
        <div className="props">
          <label className="field">
            <span>Markup color</span>
            <input type="color" value={ed.activeMarkup.color}
              onChange={(e) => ed.api.updateMarkup({ color: e.target.value })} />
          </label>
          <label className="field">
            <span>Stroke width — {ed.activeMarkup.width}px</span>
            <input type="range" min="1" max="24" value={ed.activeMarkup.width}
              onChange={(e) => ed.api.updateMarkup({ width: +e.target.value })}
              onMouseUp={ed.api.commit} onTouchEnd={ed.api.commit} />
          </label>
          <div className="field layer-row">
            <button className="btn" onClick={ed.api.sendBackward}>⬇ Back</button>
            <button className="btn" onClick={ed.api.bringForward}>⬆ Forward</button>
          </div>
          <div className="field layer-row">
            <button className="btn" onClick={ed.api.duplicateActive}>⧉ Duplicate</button>
            <button className="btn danger" onClick={ed.api.deleteActive}>🗑 Delete</button>
          </div>
        </div>
      )}
      {!ed.activeSpec && !ed.activeMarkup && (
        <div className="panel-empty">Select a sticker or markup to edit it.</div>
      )}
    </>
  )

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🏷️ PriceTag Studio</div>
        <div className="top-actions">
          {ed.status && <span className="status">{ed.status}</span>}
          <button className="btn ghost" onClick={() => setGallery(true)}>Saved</button>
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
          <div className="tool-grid">
            <button className="btn" onClick={() => ed.api.addSticker()} disabled={!ed.hasImage}>➕ Sticker</button>
            <button className="btn" onClick={ed.api.startCrop} disabled={!ed.hasImage}>✂ Crop</button>
          </div>

          <div className="tool-section-label">Markup</div>
          <MarkupBar tool={ed.tool} setTool={ed.setTool}
            markupColor={ed.markupColor} markupWidth={ed.markupWidth} api={ed.api} />

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
                  <strong>Click here to upload a photo</strong>
                  <span>Then add price tags, markup &amp; export your image</span>
                  <button
                    className="btn primary dz-btn"
                    onClick={(e) => { e.stopPropagation(); fileRef.current?.click() }}
                  >
                    Choose Image
                  </button>
                </div>
              </div>
            )}
            {ed.cropMode && (
              <div className="crop-bar">
                <span>Drag the box to set the crop</span>
                <button className="btn primary" onClick={ed.api.applyCrop}>Apply</button>
                <button className="btn ghost" onClick={ed.api.cancelCrop}>Cancel</button>
              </div>
            )}
          </div>
        </main>

        {/* RIGHT PROPERTIES (desktop) */}
        <aside className="properties-panel">
          <div className="panel-title">Properties</div>
          {rightPanel}
        </aside>
      </div>

      {/* DOCKED EDITOR (mobile) — pushes the photo up instead of covering it */}
      {(ed.activeSpec || ed.activeMarkup) && (
        <section className="mobile-editor">
          <div className="me-head">
            <strong>{ed.activeSpec ? 'Edit sticker' : 'Edit markup'}</strong>
            <button className="btn primary small" onClick={ed.api.deselect}>Done</button>
          </div>
          {rightPanel}
        </section>
      )}

      {/* BOTTOM TOOLBAR (mobile) */}
      <nav className="bottombar">
        <button onClick={() => fileRef.current?.click()}>📷<span>Upload</span></button>
        <button onClick={() => ed.api.addSticker()} disabled={!ed.hasImage}>➕<span>Sticker</span></button>
        <button onClick={() => setSheet('markup')} disabled={!ed.hasImage}>✎<span>Markup</span></button>
        <button onClick={ed.api.startCrop} disabled={!ed.hasImage}>✂<span>Crop</span></button>
        <button onClick={() => setSheet('templates')} disabled={!ed.hasImage}>🏷️<span>Tags</span></button>
        <button onClick={ed.api.undo} disabled={!ed.hasImage}>↶<span>Undo</span></button>
        <button onClick={() => ed.api.exportImage('png')} disabled={!ed.hasImage}>⬇<span>Export</span></button>
      </nav>

      {/* MOBILE BOTTOM SHEET */}
      {sheet && (
        <div className="sheet-backdrop" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            {sheet === 'templates' && (<>
              <div className="sheet-title">Templates</div>
              <TemplatePanel api={ed.api} onPick={() => setSheet(null)} />
            </>)}
            {sheet === 'markup' && (<>
              <div className="sheet-title">Markup tools</div>
              <MarkupBar tool={ed.tool} setTool={ed.setTool}
                markupColor={ed.markupColor} markupWidth={ed.markupWidth} api={ed.api} />
            </>)}
          </div>
        </div>
      )}

      {gallery && (
        <Gallery api={ed.api} onClose={() => setGallery(false)} onOpen={ed.api.openImageUrl} />
      )}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

      {!isSupabaseConfigured && (
        <div className="config-banner">
          Supabase not configured — editing & export work locally. Add keys in <code>.env</code> to save.
        </div>
      )}
    </div>
  )
}
