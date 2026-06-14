import React from 'react'

const TOOLS = [
  { key: null, label: '↖', name: 'Select' },
  { key: 'line', label: '╱', name: 'Line' },
  { key: 'arrow', label: '➔', name: 'Arrow' },
  { key: 'box', label: '▭', name: 'Box' },
  { key: 'circle', label: '◯', name: 'Circle' },
  { key: 'pen', label: '✎', name: 'Pen' },
]

export default function MarkupBar({ tool, setTool, markupColor, markupWidth, api }) {
  return (
    <div className="markupbar">
      <div className="tool-row">
        {TOOLS.map((t) => (
          <button
            key={t.name}
            title={t.name}
            className={tool === t.key ? 'mtool active' : 'mtool'}
            onClick={() => setTool(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="markup-style">
        <label className="color">
          <span>Color</span>
          <input type="color" value={markupColor}
            onChange={(e) => api.updateMarkup({ color: e.target.value })} />
        </label>
        <label className="field width-field">
          <span>Width {markupWidth}px</span>
          <input type="range" min="1" max="24" value={markupWidth}
            onChange={(e) => api.updateMarkup({ width: +e.target.value })} />
        </label>
      </div>
      <button
        className="btn danger small"
        onClick={() => {
          if (window.confirm('Clear all markup? You can still undo this afterwards.')) {
            api.clearMarkup()
          }
        }}
      >
        Clear all markup
      </button>
    </div>
  )
}
