import React from 'react'
import { SHAPES } from '../lib/stickers.js'

const BG_SWATCHES = ['#FFD700', '#FFFFFF', '#E11D48', '#FF9900', '#111111', '#22C55E']

export default function PropertiesPanel({ spec, api }) {
  if (!spec) {
    return (
      <div className="panel-empty">
        Select a sticker to edit its properties, or add one from the tools.
      </div>
    )
  }
  const set = (patch) => api.updateStyle(patch)
  const setGeom = (patch) => api.updateGeom(patch)

  return (
    <div className="props">
      <label className="field">
        <span>Price text</span>
        <input
          type="text"
          value={spec.text}
          onChange={(e) => set({ text: e.target.value })}
          onBlur={api.commit}
        />
      </label>
      <label className="field">
        <span>Shape tightness — {spec.pad ?? 8}px</span>
        <input
          type="range" min="0" max="40" value={spec.pad ?? 8}
          onChange={(e) => set({ pad: +e.target.value, boxW: null, boxH: null })}
          onMouseUp={api.commit} onTouchEnd={api.commit}
        />
      </label>
      <button className="btn small" onClick={api.fitSticker}>⤢ Snap shape to text</button>

      <div className="field">
        <span>Shape</span>
        <div className="chips">
          {SHAPES.map((s) => (
            <button
              key={s.key}
              className={spec.shape === s.key ? 'chip active' : 'chip'}
              onClick={() => { set({ shape: s.key }); api.commit() }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Font size — {spec.fontSize}px</span>
        <input
          type="range" min="10" max="120" value={spec.fontSize}
          onChange={(e) => set({ fontSize: +e.target.value })}
          onMouseUp={api.commit} onTouchEnd={api.commit}
        />
      </label>

      <div className="field row">
        <label className="toggle">
          <input
            type="checkbox"
            checked={spec.fontWeight === 'bold'}
            onChange={(e) => { set({ fontWeight: e.target.checked ? 'bold' : 'normal' }); api.commit() }}
          />
          <span>Bold</span>
        </label>
        <label className="color">
          <span>Text</span>
          <input type="color" value={spec.textColor}
            onChange={(e) => set({ textColor: e.target.value })} onBlur={api.commit} />
        </label>
      </div>

      <div className="field">
        <span>Background</span>
        <div className="swatches">
          {BG_SWATCHES.map((c) => (
            <button key={c} className={spec.bgColor === c ? 'swatch active' : 'swatch'}
              style={{ background: c }} onClick={() => { set({ bgColor: c }); api.commit() }} />
          ))}
          <label className="color compact">
            <input type="color" value={spec.bgColor}
              onChange={(e) => set({ bgColor: e.target.value })} onBlur={api.commit} />
          </label>
        </div>
      </div>

      <label className="field">
        <span>Rotation — {spec.rotation}°</span>
        <input type="range" min="-180" max="180" value={spec.rotation}
          onChange={(e) => setGeom({ rotation: +e.target.value })}
          onMouseUp={api.commit} onTouchEnd={api.commit} />
      </label>

      <label className="field">
        <span>Text rotation — {spec.textAngle || 0}°</span>
        <input type="range" min="-180" max="180" value={spec.textAngle || 0}
          onChange={(e) => set({ textAngle: +e.target.value })}
          onMouseUp={api.commit} onTouchEnd={api.commit} />
      </label>

      <label className="field">
        <span>Scale — {spec.scale.toFixed(2)}×</span>
        <input type="range" min="0.3" max="3" step="0.05" value={spec.scale}
          onChange={(e) => setGeom({ scale: +e.target.value })}
          onMouseUp={api.commit} onTouchEnd={api.commit} />
      </label>

      <label className="field">
        <span>Opacity — {Math.round(spec.opacity * 100)}%</span>
        <input type="range" min="0.1" max="1" step="0.05" value={spec.opacity}
          onChange={(e) => setGeom({ opacity: +e.target.value })}
          onMouseUp={api.commit} onTouchEnd={api.commit} />
      </label>

      <div className="field layer-row">
        <button className="btn" onClick={api.sendBackward}>⬇ Back</button>
        <button className="btn" onClick={api.bringForward}>⬆ Forward</button>
      </div>
      <div className="field layer-row">
        <button className="btn" onClick={api.duplicateActive}>⧉ Duplicate</button>
        <button className="btn danger" onClick={api.deleteActive}>🗑 Delete</button>
      </div>
    </div>
  )
}
