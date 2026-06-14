import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Point } from 'fabric'
import {
  createStickerObject,
  rebuildStickerObject,
  serializeSticker,
  serializeAll,
} from '../lib/stickers.js'
import { TEMPLATES } from '../lib/templates.js'
import { uploadOriginal, uploadExport } from '../lib/storage.js'
import { saveProject } from '../lib/projects.js'
import { isSupabaseConfigured } from '../lib/supabase.js'

const MAX_DISPLAY = 1000 // px — longest canvas edge on screen
const GRID = 20

export function useEditor() {
  const elRef = useRef(null)
  const canvasRef = useRef(null)
  const imageScaleRef = useRef(1) // naturalWidth / canvasWidth -> export multiplier
  const originalFileRef = useRef(null)
  const historyRef = useRef([]) // snapshots of serialized sticker arrays

  const [ready, setReady] = useState(false)
  const [hasImage, setHasImage] = useState(false)
  const [activeSpec, setActiveSpec] = useState(null)
  const [snap, setSnap] = useState(false)
  const [status, setStatus] = useState('')
  const [projectId, setProjectId] = useState(null)
  const snapRef = useRef(false)
  snapRef.current = snap

  // -------------------------------------------------------------- init canvas
  const attach = useCallback((el) => {
    if (!el || canvasRef.current) return
    elRef.current = el
    const canvas = new Canvas(el, {
      backgroundColor: '#1f2937',
      preserveObjectStacking: true,
      selection: true,
    })
    canvasRef.current = canvas

    const sync = () => {
      const o = canvas.getActiveObject()
      setActiveSpec(o && o.stickerType === 'price_tag' ? serializeSticker(o) : null)
    }
    canvas.on('selection:created', sync)
    canvas.on('selection:updated', sync)
    canvas.on('selection:cleared', () => setActiveSpec(null))
    canvas.on('object:modified', () => {
      sync()
      pushHistory()
    })
    canvas.on('object:moving', (e) => {
      if (!snapRef.current) return
      const t = e.target
      t.set({ left: Math.round(t.left / GRID) * GRID, top: Math.round(t.top / GRID) * GRID })
    })

    // wheel zoom (desktop)
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY
      let zoom = canvas.getZoom() * 0.999 ** delta
      zoom = Math.min(5, Math.max(0.2, zoom))
      canvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), zoom)
      opt.e.preventDefault()
      opt.e.stopPropagation()
    })

    // alt-drag to pan
    let panning = false
    let last = null
    canvas.on('mouse:down', (opt) => {
      if (opt.e.altKey) {
        panning = true
        canvas.selection = false
        last = { x: opt.e.clientX, y: opt.e.clientY }
      }
    })
    canvas.on('mouse:move', (opt) => {
      if (!panning || !last) return
      const vpt = canvas.viewportTransform
      vpt[4] += opt.e.clientX - last.x
      vpt[5] += opt.e.clientY - last.y
      canvas.requestRenderAll()
      last = { x: opt.e.clientX, y: opt.e.clientY }
    })
    canvas.on('mouse:up', () => {
      panning = false
      canvas.selection = true
      last = null
    })

    setReady(true)
  }, [])

  useEffect(() => () => canvasRef.current?.dispose(), [])

  // ------------------------------------------------------------- history/undo
  const pushHistory = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    historyRef.current.push(JSON.stringify(serializeAll(c)))
    if (historyRef.current.length > 50) historyRef.current.shift()
  }, [])

  const undo = useCallback(() => {
    const c = canvasRef.current
    if (!c || historyRef.current.length === 0) return
    historyRef.current.pop() // drop current state
    const prev = historyRef.current[historyRef.current.length - 1]
    const specs = prev ? JSON.parse(prev) : []
    c.getObjects()
      .filter((o) => o.stickerType === 'price_tag')
      .forEach((o) => c.remove(o))
    specs.forEach((s) => c.add(createStickerObject(s)))
    c.discardActiveObject()
    c.requestRenderAll()
    setActiveSpec(null)
  }, [])

  // ------------------------------------------------------------- load image
  const loadImageFromUrl = useCallback(async (url, naturalHint) => {
    const c = canvasRef.current
    if (!c) return
    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    const natW = naturalHint?.w || img.width
    const containerW = elRef.current?.parentElement?.clientWidth || MAX_DISPLAY
    const maxW = Math.min(MAX_DISPLAY, containerW)
    // Fit within the available width and the max display height; never upscale
    // (cap at 1) so the export multiplier stays >= 1 (true original resolution).
    const scale = Math.min(maxW / img.width, MAX_DISPLAY / img.height, 1)
    const cw = Math.round(img.width * scale)
    const ch = Math.round(img.height * scale)
    c.setDimensions({ width: cw, height: ch })
    img.set({ scaleX: scale, scaleY: scale, originX: 'left', originY: 'top', left: 0, top: 0 })
    c.backgroundImage = img
    imageScaleRef.current = natW / cw
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.requestRenderAll()
    setHasImage(true)
    historyRef.current = []
    pushHistory()
  }, [pushHistory])

  const loadImageFromFile = useCallback(async (file) => {
    originalFileRef.current = file
    const url = URL.createObjectURL(file)
    await loadImageFromUrl(url)
    setStatus('Image loaded')
  }, [loadImageFromUrl])

  // ------------------------------------------------------------- stickers
  const centerPoint = () => {
    const c = canvasRef.current
    return { x: (c?.getWidth() || 400) / 2, y: (c?.getHeight() || 400) / 2 }
  }

  const addSticker = useCallback((partial = {}) => {
    const c = canvasRef.current
    if (!c) return
    const p = centerPoint()
    const obj = createStickerObject({ x: p.x, y: p.y, ...partial })
    c.add(obj)
    c.setActiveObject(obj)
    c.requestRenderAll()
    setActiveSpec(serializeSticker(obj))
    pushHistory()
  }, [pushHistory])

  const applyTemplate = useCallback((key) => {
    const t = TEMPLATES[key]
    if (t) addSticker({ ...t })
  }, [addSticker])

  // Style edits (text/colors/shape/font) -> rebuild active sticker in place.
  const updateStyle = useCallback((patch) => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o || o.stickerType !== 'price_tag') return
    o.spec = { ...o.spec, ...patch }
    const next = rebuildStickerObject(c, o)
    setActiveSpec(serializeSticker(next))
  }, [])

  // Geometry edits (rotation/opacity) -> mutate the Fabric object directly.
  const updateGeom = useCallback((patch) => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o) return
    if (patch.rotation != null) o.rotate(patch.rotation)
    if (patch.opacity != null) o.set('opacity', patch.opacity)
    if (patch.scale != null) o.set({ scaleX: patch.scale, scaleY: patch.scale })
    o.setCoords()
    c.requestRenderAll()
    setActiveSpec(serializeSticker(o))
  }, [])

  const commit = useCallback(() => pushHistory(), [pushHistory])

  const bringForward = useCallback(() => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (o) { c.bringObjectForward(o); c.requestRenderAll(); pushHistory() }
  }, [pushHistory])

  const sendBackward = useCallback(() => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    // keep stickers above the background image
    if (o) { c.sendObjectBackwards(o); c.requestRenderAll(); pushHistory() }
  }, [pushHistory])

  const duplicateActive = useCallback(() => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o || o.stickerType !== 'price_tag') return
    const s = serializeSticker(o)
    addSticker({ ...s, id: undefined, x: s.x + 24, y: s.y + 24 })
  }, [addSticker])

  const deleteActive = useCallback(() => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o) return
    c.remove(o)
    c.discardActiveObject()
    c.requestRenderAll()
    setActiveSpec(null)
    pushHistory()
  }, [pushHistory])

  // ------------------------------------------------------------- zoom
  const zoomBy = useCallback((factor) => {
    const c = canvasRef.current
    if (!c) return
    let zoom = Math.min(5, Math.max(0.2, c.getZoom() * factor))
    c.zoomToPoint(new Point(c.getWidth() / 2, c.getHeight() / 2), zoom)
  }, [])
  const resetZoom = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.requestRenderAll()
  }, [])

  // ------------------------------------------------------------- export
  const renderDataUrl = useCallback((format = 'png') => {
    const c = canvasRef.current
    if (!c) return null
    const saved = c.viewportTransform.slice()
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.discardActiveObject()
    c.requestRenderAll()
    const dataUrl = c.toDataURL({
      format: format === 'jpg' ? 'jpeg' : 'png',
      quality: 0.92,
      multiplier: imageScaleRef.current, // restore original resolution
    })
    c.setViewportTransform(saved)
    c.requestRenderAll()
    return dataUrl
  }, [])

  const dataUrlToBlob = (dataUrl) => fetch(dataUrl).then((r) => r.blob())

  const exportImage = useCallback(async (format = 'png') => {
    const dataUrl = renderDataUrl(format)
    if (!dataUrl) return
    // trigger download
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `pricetag-${Date.now()}.${format}`
    a.click()
    setStatus('Image downloaded')

    // also persist to Supabase (best-effort)
    if (isSupabaseConfigured) {
      try {
        setStatus('Uploading export…')
        const blob = await dataUrlToBlob(dataUrl)
        const finalUrl = await uploadExport(blob, format)
        let originalUrl = null
        if (originalFileRef.current) originalUrl = await uploadOriginal(originalFileRef.current)
        const res = await saveProject({
          id: projectId,
          originalImageUrl: originalUrl,
          finalImageUrl: finalUrl,
          stickerJson: serializeAll(canvasRef.current),
        })
        if (res.ok) { setProjectId(res.project.id); setStatus('Saved to Supabase ✓') }
        else setStatus(`Saved locally (Supabase: ${res.reason})`)
      } catch (err) {
        setStatus(`Export saved locally (upload failed: ${err.message})`)
      }
    }
  }, [renderDataUrl, projectId])

  // ------------------------------------------------------------- save only
  const save = useCallback(async () => {
    const c = canvasRef.current
    if (!c) return
    if (!isSupabaseConfigured) {
      setStatus('Add Supabase keys in .env to enable saving')
      return
    }
    try {
      setStatus('Saving…')
      let originalUrl = null
      if (originalFileRef.current) originalUrl = await uploadOriginal(originalFileRef.current)
      const res = await saveProject({
        id: projectId,
        originalImageUrl: originalUrl,
        stickerJson: serializeAll(c),
      })
      if (res.ok) { setProjectId(res.project.id); setStatus('Project saved ✓') }
      else setStatus(`Save failed: ${res.reason}`)
    } catch (err) {
      setStatus(`Save failed: ${err.message}`)
    }
  }, [projectId])

  return {
    attach,
    ready,
    hasImage,
    activeSpec,
    snap,
    setSnap,
    status,
    api: {
      loadImageFromFile,
      addSticker,
      applyTemplate,
      updateStyle,
      updateGeom,
      commit,
      bringForward,
      sendBackward,
      duplicateActive,
      deleteActive,
      undo,
      zoomBy,
      resetZoom,
      exportImage,
      save,
    },
  }
}
