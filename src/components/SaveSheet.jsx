import React, { useEffect, useMemo, useState } from 'react'
import { formatBytes, isIOS } from '../lib/download.js'

// Where does the finished photo go? On iPad the share sheet is the only route
// into Photos/albums, so it leads — with plain download + open-in-tab behind it.
export default function SaveSheet({ desc: initial, api, onClose }) {
  const [desc, setDesc] = useState(initial)
  const [error, setError] = useState('')

  const preview = useMemo(() => (desc ? URL.createObjectURL(desc.blob) : null), [desc])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (!desc) return null

  const backup = () => { api.uploadExportToCloud(desc.blob, desc.format) }

  const switchFormat = (format) => {
    if (format === desc.format) return
    const next = api.prepareExport(format)
    if (next) { setDesc(next); setError('') }
  }

  // Called straight from the tap: api.shareExport reaches navigator.share
  // synchronously so iOS still sees the user gesture.
  const onShare = async () => {
    const result = await api.shareExport(desc)
    if (result === 'cancelled') return
    if (result === 'unsupported') {
      setError('Sharing isn’t available here — downloading the file instead.')
      api.saveExportToFiles(desc)
    }
    backup()
    onClose()
  }

  const onDownload = () => { api.saveExportToFiles(desc); backup(); onClose() }
  const onOpenTab = () => { api.openExportInTab(desc) }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal save-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Save your photo</strong>
          <button className="btn ghost small" onClick={onClose}>✕</button>
        </div>

        <div className="save-preview">
          <img src={preview} alt="Finished export preview" />
          <div className="save-meta">
            {desc.format.toUpperCase()} · {formatBytes(desc.size)}
            <div className="save-format">
              <button className={`btn small ${desc.format === 'png' ? 'primary' : ''}`}
                onClick={() => switchFormat('png')}>PNG</button>
              <button className={`btn small ${desc.format === 'jpg' ? 'primary' : ''}`}
                onClick={() => switchFormat('jpg')}>JPG</button>
            </div>
          </div>
        </div>

        <div className="save-options">
          {desc.canShare && (
            <button className="btn primary save-opt" onClick={onShare}>
              <strong>📤 Save to Photos or Files</strong>
              <span>Opens the share sheet — pick “Save Image” for your albums, or “Save to Files”.</span>
            </button>
          )}
          <button className="btn save-opt" onClick={onDownload}>
            <strong>⬇ Download the file</strong>
            <span>Goes to Files › Downloads (or your browser’s download folder).</span>
          </button>
          <button className="btn save-opt" onClick={onOpenTab}>
            <strong>🖼 Open the image in a new tab</strong>
            <span>{isIOS
              ? 'Then press and hold the image → “Add to Photos”.'
              : 'Then right-click the image → “Save image as…”.'}</span>
          </button>
        </div>

        {error && <div className="save-error">{error}</div>}
        {!desc.canShare && isIOS && (
          <div className="save-hint">
            Tip: “Save to Photos” needs Safari on iPadOS 15 or newer. On older
            versions, open the image in a new tab and press and hold it.
          </div>
        )}
      </div>
    </div>
  )
}
