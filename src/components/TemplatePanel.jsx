import React from 'react'
import { TEMPLATE_LIST } from '../lib/templates.js'

export default function TemplatePanel({ api, onPick }) {
  return (
    <div className="templates">
      {TEMPLATE_LIST.map((t) => (
        <button
          key={t.key}
          className="template-btn"
          style={{ background: t.bgColor, color: t.textColor }}
          onClick={() => { api.applyTemplate(t.key); onPick?.() }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
