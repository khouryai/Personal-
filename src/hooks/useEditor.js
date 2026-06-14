import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, Point, Rect, PencilBrush, util } from 'fabric'
import {
  createStickerObject,
  rebuildStickerObject,
  serializeSticker,
  serializeAll,
  setStickerText,
  fitStickerToText,
} from '../lib/stickers.js'
import {
  createMarkupStart, updateMarkupDraw, isTooSmall, makeArrowGroup,
  applyMarkupStyle, PERSIST_PROPS,
} from '../lib/markup.js'
import { TEMPLATES } from '../lib/templates.js'
import { uploadOriginal, uploadExport } from '../lib/storage.js'
import { saveProject, listProjects, loadProject } from '../lib/projects.js'
import { isSupabaseConfigured } from '../lib/supabase.js'

const GRID = 20

export function useEditor() {
  const elRef = useRef(null)
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const imageScaleRef = useRef(1) // naturalWidth / canvasWidth -> export multiplier
  const originalFileRef = useRef(null)
  const originalUrlRef = useRef(null) // uploaded original photo URL (reused across saves)
  const historyRef = useRef([])
  const drawingRef = useRef(null) // { obj, origin, tool } while drawing a markup
  const cropRectRef = useRef(null)

  const [ready, setReady] = useState(false)
  const [hasImage, setHasImage] = useState(false)
  const [activeSpec, setActiveSpec] = useState(null)
  const [activeMarkup, setActiveMarkup] = useState(null)
  const [snap, setSnap] = useState(false)
  const [status, setStatus] = useState('')
  const [projectId, setProjectId] = useState(null)
  const [tool, setTool] = useState(null) // null=select | line|arrow|box|circle|pen
  const [markupColor, setMarkupColor] = useState('#ff3b30')
  const [markupWidth, setMarkupWidth] = useState(4)
  const [cropMode, setCropMode] = useState(false)

  // refs mirroring state for use inside Fabric event closures
  const snapRef = useRef(false); snapRef.current = snap
  const toolRef = useRef(null); toolRef.current = tool
  const colorRef = useRef(markupColor); colorRef.current = markupColor
  const widthRef = useRef(markupWidth); widthRef.current = markupWidth
  const cropRef = useRef(false); cropRef.current = cropMode
  const pinchRef = useRef(false)

  // ----------------------------------------------------------- fit to screen
  // Size the canvas to fill the available stage area, rescaling overlays so
  // the layout stays aligned. Called on load, crop, and container resize.
  const fitToContainer = useCallback((refitObjects = true) => {
    const c = canvasRef.current
    const bg = c?.backgroundImage
    const stage = stageRef.current
    if (!c || !bg || !stage) return
    const availW = Math.max(120, stage.clientWidth - 16)
    const availH = Math.max(120, stage.clientHeight - 16)
    const natW = bg.width
    const natH = bg.height
    const scale = Math.min(availW / natW, availH / natH) // fill, no upscale beyond fit
    const cw = Math.round(natW * scale)
    const ch = Math.round(natH * scale)
    const oldW = c.getWidth() || cw
    const ratio = cw / oldW

    if (refitObjects && Math.abs(ratio - 1) > 0.001) {
      c.getObjects().forEach((o) => {
        o.set({
          left: o.left * ratio, top: o.top * ratio,
          scaleX: o.scaleX * ratio, scaleY: o.scaleY * ratio,
        })
        o.setCoords()
      })
    }
    c.setDimensions({ width: cw, height: ch })
    bg.set({ scaleX: cw / natW, scaleY: ch / natH })
    imageScaleRef.current = natW / cw
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.requestRenderAll()
  }, [])

  // -------------------------------------------------------------- init canvas
  const attach = useCallback((el) => {
    if (!el || canvasRef.current) return
    elRef.current = el
    stageRef.current = el.closest('.stage')
    const canvas = new Canvas(el, {
      backgroundColor: '#1f2937',
      preserveObjectStacking: true,
      selection: true,
    })
    canvasRef.current = canvas

    const sync = () => {
      const o = canvas.getActiveObject()
      if (o && o.stickerType === 'price_tag') {
        setActiveSpec(serializeSticker(o)); setActiveMarkup(null)
      } else if (o && o.markup) {
        setActiveMarkup({ color: o.markupColor || colorRef.current, width: o.markupWidth || widthRef.current })
        setActiveSpec(null)
      } else { setActiveSpec(null); setActiveMarkup(null) }
    }
    canvas.on('selection:created', sync)
    canvas.on('selection:updated', sync)
    canvas.on('selection:cleared', () => { setActiveSpec(null); setActiveMarkup(null) })
    canvas.on('object:modified', () => { sync(); pushHistory() })
    canvas.on('object:moving', (e) => {
      if (!snapRef.current) return
      const t = e.target
      t.set({ left: Math.round(t.left / GRID) * GRID, top: Math.round(t.top / GRID) * GRID })
    })
    canvas.on('path:created', (e) => {
      e.path.markup = true; e.path.markupTool = 'pen'
      e.path.markupColor = colorRef.current; e.path.markupWidth = widthRef.current
      pushHistory()
    })

    // wheel zoom (desktop)
    canvas.on('mouse:wheel', (opt) => {
      let zoom = canvas.getZoom() * 0.999 ** opt.e.deltaY
      zoom = Math.min(6, Math.max(0.2, zoom))
      canvas.zoomToPoint(new Point(opt.e.offsetX, opt.e.offsetY), zoom)
      opt.e.preventDefault(); opt.e.stopPropagation()
    })

    // drawing markups + alt-drag pan
    const sp = (e) => (canvas.getScenePoint ? canvas.getScenePoint(e) : canvas.getPointer(e))
    let panning = false
    let last = null
    canvas.on('mouse:down', (opt) => {
      if (pinchRef.current) return
      if (opt.e.altKey) {
        panning = true; canvas.selection = false
        last = { x: opt.e.clientX ?? opt.e.touches?.[0].clientX, y: opt.e.clientY ?? opt.e.touches?.[0].clientY }
        return
      }
      const t = toolRef.current
      if (t && t !== 'pen' && !cropRef.current) {
        const p = sp(opt.e)
        const obj = createMarkupStart(t, p, { color: colorRef.current, width: widthRef.current })
        if (obj) { canvas.add(obj); drawingRef.current = { obj, origin: p, tool: t } }
      }
    })
    canvas.on('mouse:move', (opt) => {
      if (panning && last) {
        const cx = opt.e.clientX ?? opt.e.touches?.[0]?.clientX
        const cy = opt.e.clientY ?? opt.e.touches?.[0]?.clientY
        const vpt = canvas.viewportTransform
        vpt[4] += cx - last.x; vpt[5] += cy - last.y
        canvas.requestRenderAll(); last = { x: cx, y: cy }
        return
      }
      if (drawingRef.current) {
        const d = drawingRef.current
        updateMarkupDraw(d.obj, d.tool, d.origin, sp(opt.e))
        canvas.requestRenderAll()
      }
    })
    canvas.on('mouse:up', (opt) => {
      panning = false; last = null
      const d = drawingRef.current
      if (d) {
        drawingRef.current = null
        const p = sp(opt.e)
        if (isTooSmall(d.tool, d.origin, p)) {
          canvas.remove(d.obj)
        } else if (d.tool === 'arrow') {
          canvas.remove(d.obj)
          const g = makeArrowGroup(d.origin.x, d.origin.y, p.x, p.y, colorRef.current, widthRef.current)
          canvas.add(g); canvas.setActiveObject(g); pushHistory()
        } else {
          d.obj.setCoords(); canvas.setActiveObject(d.obj); pushHistory()
        }
      }
      if (!toolRef.current) canvas.selection = true
    })

    // pinch-to-zoom (mobile, two-finger) + two-finger pan
    const upper = canvas.upperCanvasEl
    let pinchStart = null
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })
    upper.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        pinchRef.current = true
        drawingRef.current && canvas.remove(drawingRef.current.obj)
        drawingRef.current = null
        pinchStart = { d: dist(e.touches), zoom: canvas.getZoom(), m: mid(e.touches) }
        e.preventDefault()
      }
    }, { passive: false })
    upper.addEventListener('touchmove', (e) => {
      if (pinchRef.current && e.touches.length === 2 && pinchStart) {
        const rect = upper.getBoundingClientRect()
        const m = mid(e.touches)
        let zoom = Math.min(6, Math.max(0.2, pinchStart.zoom * (dist(e.touches) / pinchStart.d)))
        canvas.zoomToPoint(new Point(m.x - rect.left, m.y - rect.top), zoom)
        const vpt = canvas.viewportTransform
        vpt[4] += m.x - pinchStart.m.x; vpt[5] += m.y - pinchStart.m.y
        pinchStart.m = m
        canvas.requestRenderAll()
        e.preventDefault()
      }
    }, { passive: false })
    const endPinch = (e) => { if (e.touches.length < 2) { pinchRef.current = false; pinchStart = null } }
    upper.addEventListener('touchend', endPinch)
    upper.addEventListener('touchcancel', endPinch)

    // refit on container resize / orientation change
    const ro = new ResizeObserver(() => fitToContainer(true))
    if (stageRef.current) ro.observe(stageRef.current)
    canvas._ro = ro

    setReady(true)
  }, [fitToContainer])

  useEffect(() => () => {
    canvasRef.current?._ro?.disconnect()
    canvasRef.current?.dispose()
    canvasRef.current = null // allow re-attach (e.g. React StrictMode remount)
  }, [])

  // toggle drawing/selection mode when the active tool changes
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    if (tool === 'pen') {
      c.isDrawingMode = true
      const b = new PencilBrush(c); b.color = markupColor; b.width = markupWidth
      c.freeDrawingBrush = b
    } else {
      c.isDrawingMode = false
    }
    // shape tools draw on empty space without grabbing existing objects
    c.skipTargetFind = !!tool && tool !== 'pen'
    c.selection = !tool
  }, [tool, markupColor, markupWidth, ready])

  // ------------------------------------------------------------- history/undo
  const pushHistory = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    historyRef.current.push(JSON.stringify(c.getObjects().map((o) => o.toObject(PERSIST_PROPS))))
    if (historyRef.current.length > 60) historyRef.current.shift()
  }, [])

  const undo = useCallback(async () => {
    const c = canvasRef.current
    if (!c || historyRef.current.length === 0) return
    historyRef.current.pop()
    const prev = historyRef.current[historyRef.current.length - 1]
    c.getObjects().slice().forEach((o) => c.remove(o))
    if (prev) {
      const objs = await util.enlivenObjects(JSON.parse(prev))
      objs.forEach((o) => c.add(o))
    }
    c.discardActiveObject(); c.requestRenderAll()
    setActiveSpec(null); setActiveMarkup(null)
  }, [])

  // ------------------------------------------------------------- load image
  const setBackground = useCallback(async (url, opts = {}) => {
    const c = canvasRef.current
    if (!c) return
    if (opts.clear) c.getObjects().slice().forEach((o) => c.remove(o))
    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
    img.set({ originX: 'left', originY: 'top', left: 0, top: 0 })
    c.backgroundImage = img
    fitToContainer(false)
    setHasImage(true)
    historyRef.current = []
    pushHistory()
  }, [fitToContainer, pushHistory])

  const loadImageFromFile = useCallback(async (file) => {
    originalFileRef.current = file
    originalUrlRef.current = null
    setProjectId(null)
    await setBackground(URL.createObjectURL(file), { clear: true })
    setStatus('Image loaded')
  }, [setBackground])

  // open a saved image (flattened) into a fresh canvas
  const openImageUrl = useCallback(async (url) => {
    originalFileRef.current = null
    originalUrlRef.current = null
    setProjectId(null)
    await setBackground(url, { clear: true })
    setStatus('Opened saved image')
  }, [setBackground])

  // Reopen a saved PROJECT with its stickers + markup as editable objects.
  const openProject = useCallback(async (id) => {
    setStatus('Opening project…')
    const res = await loadProject(id)
    if (!res.ok) { setStatus(`Open failed: ${res.reason}`); return }
    const p = res.project
    const scene = p.scene_json
    const bg = scene?.bg || p.original_image_url
    // Legacy / no editable scene -> fall back to opening the flattened image.
    if (!scene?.objects || !bg) {
      await openImageUrl(p.final_image_url || p.original_image_url)
      setProjectId(p.id)
      return
    }
    originalFileRef.current = null
    originalUrlRef.current = p.original_image_url || null
    await setBackground(bg, { clear: true })
    const c = canvasRef.current
    const ratio = c.getWidth() / (scene.w || c.getWidth())
    const objs = await util.enlivenObjects(scene.objects)
    objs.forEach((o) => {
      o.set({ left: o.left * ratio, top: o.top * ratio, scaleX: o.scaleX * ratio, scaleY: o.scaleY * ratio })
      o.setCoords(); c.add(o)
    })
    c.requestRenderAll()
    historyRef.current = []; pushHistory()
    setProjectId(p.id)
    setStatus('Project reopened — fully editable')
  }, [setBackground, openImageUrl, pushHistory])

  // ------------------------------------------------------------- stickers
  const centerPoint = () => {
    const c = canvasRef.current
    return { x: (c?.getWidth() || 400) / 2, y: (c?.getHeight() || 400) / 2 }
  }

  const addSticker = useCallback((partial = {}) => {
    const c = canvasRef.current
    if (!c) return
    setTool(null)
    const p = centerPoint()
    const obj = createStickerObject({ x: p.x, y: p.y, ...partial })
    c.add(obj); c.setActiveObject(obj); c.requestRenderAll()
    setActiveSpec(serializeSticker(obj)); setActiveMarkup(null)
    pushHistory()
  }, [pushHistory])

  const applyTemplate = useCallback((key) => {
    const t = TEMPLATES[key]
    if (t) addSticker({ ...t })
  }, [addSticker])

  const updateStyle = useCallback((patch) => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o || o.stickerType !== 'price_tag') return
    const keys = Object.keys(patch)
    // Editing only the price text updates it in place — shape size stays put.
    if (keys.length === 1 && keys[0] === 'text') {
      if (setStickerText(c, o, patch.text)) {
        setActiveSpec(serializeSticker(o))
        return
      }
      // Fallback (e.g. restored sticker): rebuild keeps the stored box size.
      o.spec = { ...o.spec, text: patch.text }
      setActiveSpec(serializeSticker(rebuildStickerObject(c, o)))
      return
    }
    o.spec = { ...o.spec, ...patch }
    // Changing font size re-fits the shape; other style edits keep the box.
    if ('fontSize' in patch) { o.spec.boxW = null; o.spec.boxH = null }
    setActiveSpec(serializeSticker(rebuildStickerObject(c, o)))
  }, [])

  const fitSticker = useCallback(() => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (o?.stickerType === 'price_tag') setActiveSpec(serializeSticker(fitStickerToText(c, o)))
  }, [])

  const updateGeom = useCallback((patch) => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    if (!o) return
    if (patch.rotation != null) o.rotate(patch.rotation)
    if (patch.opacity != null) o.set('opacity', patch.opacity)
    if (patch.scale != null) o.set({ scaleX: patch.scale, scaleY: patch.scale })
    o.setCoords(); c.requestRenderAll()
    if (o.stickerType === 'price_tag') setActiveSpec(serializeSticker(o))
  }, [])

  // ------------------------------------------------------------- markup style
  const updateMarkup = useCallback((patch) => {
    const c = canvasRef.current
    const o = c?.getActiveObject()
    const color = patch.color ?? markupColor
    const width = patch.width ?? markupWidth
    if (patch.color != null) setMarkupColor(patch.color)
    if (patch.width != null) setMarkupWidth(patch.width)
    if (o && o.markup) {
      applyMarkupStyle(o, { color, width })
      c.requestRenderAll()
      setActiveMarkup({ color, width })
    }
  }, [markupColor, markupWidth])

  const commit = useCallback(() => pushHistory(), [pushHistory])

  const bringForward = useCallback(() => {
    const c = canvasRef.current; const o = c?.getActiveObject()
    if (o) { c.bringObjectForward(o); c.requestRenderAll(); pushHistory() }
  }, [pushHistory])
  const sendBackward = useCallback(() => {
    const c = canvasRef.current; const o = c?.getActiveObject()
    if (o) { c.sendObjectBackwards(o); c.requestRenderAll(); pushHistory() }
  }, [pushHistory])

  const duplicateActive = useCallback(() => {
    const c = canvasRef.current; const o = c?.getActiveObject()
    if (o?.stickerType === 'price_tag') {
      const s = serializeSticker(o)
      addSticker({ ...s, id: undefined, x: s.x + 24, y: s.y + 24 })
    } else if (o?.markup) {
      o.clone(PERSIST_PROPS).then((cl) => {
        cl.set({ left: o.left + 20, top: o.top + 20 })
        c.add(cl); c.setActiveObject(cl); c.requestRenderAll(); pushHistory()
      })
    }
  }, [addSticker, pushHistory])

  const deleteActive = useCallback(() => {
    const c = canvasRef.current
    const objs = c?.getActiveObjects?.() || []
    if (!objs.length) { const o = c?.getActiveObject(); if (o) objs.push(o) }
    if (!objs.length) return
    objs.forEach((o) => c.remove(o))
    c.discardActiveObject(); c.requestRenderAll()
    setActiveSpec(null); setActiveMarkup(null); pushHistory()
  }, [pushHistory])

  const clearMarkup = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.getObjects().filter((o) => o.markup).forEach((o) => c.remove(o))
    c.discardActiveObject(); c.requestRenderAll(); setActiveMarkup(null); pushHistory()
  }, [pushHistory])

  // ------------------------------------------------------------- zoom
  const zoomBy = useCallback((factor) => {
    const c = canvasRef.current; if (!c) return
    const zoom = Math.min(6, Math.max(0.2, c.getZoom() * factor))
    c.zoomToPoint(new Point(c.getWidth() / 2, c.getHeight() / 2), zoom)
  }, [])
  const resetZoom = useCallback(() => {
    const c = canvasRef.current; if (!c) return
    c.setViewportTransform([1, 0, 0, 1, 0, 0]); c.requestRenderAll()
  }, [])

  // ------------------------------------------------------------- crop
  const startCrop = useCallback(() => {
    const c = canvasRef.current
    if (!c || !c.backgroundImage) return
    resetZoom()
    setTool(null)
    const w = c.getWidth(); const h = c.getHeight()
    const rect = new Rect({
      left: w * 0.12, top: h * 0.12, width: w * 0.76, height: h * 0.76,
      fill: 'rgba(0,0,0,0.15)', stroke: '#22c55e', strokeWidth: 2,
      strokeDashArray: [8, 5], strokeUniform: true,
      cornerColor: '#22c55e', transparentCorners: false, excludeFromExport: true,
    })
    rect.isCropRect = true
    cropRectRef.current = rect
    c.add(rect); c.setActiveObject(rect); c.requestRenderAll()
    setCropMode(true)
  }, [resetZoom])

  const cancelCrop = useCallback(() => {
    const c = canvasRef.current
    if (cropRectRef.current) { c.remove(cropRectRef.current); cropRectRef.current = null }
    c?.requestRenderAll(); setCropMode(false)
  }, [])

  const applyCrop = useCallback(async () => {
    const c = canvasRef.current
    const rect = cropRectRef.current
    const bg = c?.backgroundImage
    if (!c || !rect || !bg) return
    const r = rect.getBoundingRect()
    const sc = imageScaleRef.current
    const imgEl = bg.getElement()
    // source region in natural pixels, clamped
    const sx = Math.max(0, Math.round(r.left * sc))
    const sy = Math.max(0, Math.round(r.top * sc))
    const sw = Math.min(imgEl.naturalWidth - sx, Math.round(r.width * sc))
    const sh = Math.min(imgEl.naturalHeight - sy, Math.round(r.height * sc))

    const off = document.createElement('canvas')
    off.width = sw; off.height = sh
    off.getContext('2d').drawImage(imgEl, sx, sy, sw, sh, 0, 0, sw, sh)

    // translate overlays so they stay aligned with the cropped region
    c.remove(rect); cropRectRef.current = null
    c.getObjects().forEach((o) => {
      o.set({ left: o.left - r.left, top: o.top - r.top }); o.setCoords()
    })
    const cropped = await FabricImage.fromURL(off.toDataURL('image/png'))
    cropped.set({ originX: 'left', originY: 'top', left: 0, top: 0 })
    c.backgroundImage = cropped
    // Baseline the canvas to the crop region's display size so fitToContainer
    // rescales the (already-translated) overlays from the correct reference.
    c.setDimensions({ width: Math.round(r.width), height: Math.round(r.height) })
    cropped.set({ scaleX: r.width / sw, scaleY: r.height / sh })
    imageScaleRef.current = sw / r.width
    setCropMode(false)
    fitToContainer(true)
    pushHistory()
    setStatus('Cropped')
  }, [fitToContainer, pushHistory])

  // ------------------------------------------------------------- export
  const renderDataUrl = useCallback((format = 'png') => {
    const c = canvasRef.current
    if (!c) return null
    const saved = c.viewportTransform.slice()
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.discardActiveObject(); c.requestRenderAll()
    const dataUrl = c.toDataURL({
      format: format === 'jpg' ? 'jpeg' : 'png',
      quality: 0.92, multiplier: imageScaleRef.current,
    })
    c.setViewportTransform(saved); c.requestRenderAll()
    return dataUrl
  }, [])

  // Render the background ONLY (overlays hidden) — used to persist the exact
  // editable backdrop, including any crops, for reopening a project.
  const renderBackgroundDataUrl = useCallback(() => {
    const c = canvasRef.current
    if (!c || !c.backgroundImage) return null
    const objs = c.getObjects()
    const vis = objs.map((o) => o.visible)
    objs.forEach((o) => o.set('visible', false))
    const saved = c.viewportTransform.slice()
    c.setViewportTransform([1, 0, 0, 1, 0, 0]); c.requestRenderAll()
    const url = c.toDataURL({ format: 'png', multiplier: imageScaleRef.current })
    c.setViewportTransform(saved)
    objs.forEach((o, i) => o.set('visible', vis[i]))
    c.requestRenderAll()
    return url
  }, [])

  const dataUrlToBlob = (d) => fetch(d).then((r) => r.blob())

  // Upload the original photo once and reuse the URL across saves.
  const ensureOriginalUrl = useCallback(async () => {
    if (originalUrlRef.current) return originalUrlRef.current
    if (originalFileRef.current) {
      originalUrlRef.current = await uploadOriginal(originalFileRef.current)
    }
    return originalUrlRef.current
  }, [])

  // Serialize the full editable scene (stickers + markup) + canvas size.
  const buildScene = useCallback(() => {
    const c = canvasRef.current
    if (!c) return null
    return { v: 1, w: c.getWidth(), h: c.getHeight(), objects: c.getObjects().map((o) => o.toObject(PERSIST_PROPS)) }
  }, [])

  const exportImage = useCallback(async (format = 'png') => {
    const dataUrl = renderDataUrl(format)
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl; a.download = `pricetag-${Date.now()}.${format}`; a.click()
    setStatus('Image downloaded')
    if (isSupabaseConfigured) {
      try {
        setStatus('Uploading export…')
        const finalUrl = await uploadExport(await dataUrlToBlob(dataUrl), format)
        const bgData = renderBackgroundDataUrl()
        const bgUrl = bgData ? await uploadExport(await dataUrlToBlob(bgData), 'png') : null
        const originalUrl = await ensureOriginalUrl()
        const scene = buildScene(); if (scene) scene.bg = bgUrl
        const res = await saveProject({
          id: projectId, originalImageUrl: originalUrl,
          finalImageUrl: finalUrl, stickerJson: serializeAll(canvasRef.current),
          sceneJson: scene,
        })
        if (res.ok) { setProjectId(res.project.id); setStatus('Saved to Supabase ✓') }
        else setStatus(`Saved locally (Supabase: ${res.reason})`)
      } catch (err) { setStatus(`Export saved locally (upload failed: ${err.message})`) }
    }
  }, [renderDataUrl, projectId, ensureOriginalUrl, buildScene, renderBackgroundDataUrl])

  const save = useCallback(async () => {
    const c = canvasRef.current
    if (!c) return
    if (!isSupabaseConfigured) { setStatus('Supabase not configured'); return }
    try {
      setStatus('Saving…')
      // Save both the marked-up render and the editable scene so the project
      // reopens with its stickers + markup fully editable.
      const dataUrl = renderDataUrl('png')
      const finalUrl = dataUrl ? await uploadExport(await dataUrlToBlob(dataUrl), 'png') : null
      const bgData = renderBackgroundDataUrl()
      const bgUrl = bgData ? await uploadExport(await dataUrlToBlob(bgData), 'png') : null
      const originalUrl = await ensureOriginalUrl()
      const scene = buildScene(); if (scene) scene.bg = bgUrl
      const res = await saveProject({
        id: projectId, originalImageUrl: originalUrl,
        finalImageUrl: finalUrl, stickerJson: serializeAll(c), sceneJson: scene,
      })
      if (res.ok) { setProjectId(res.project.id); setStatus('Project saved ✓') }
      else setStatus(`Save failed: ${res.reason}`)
    } catch (err) { setStatus(`Save failed: ${err.message}`) }
  }, [projectId, renderDataUrl, ensureOriginalUrl, buildScene, renderBackgroundDataUrl])

  const fetchGallery = useCallback(() => listProjects(), [])

  return {
    attach, ready, hasImage, activeSpec, activeMarkup, snap, setSnap, status,
    tool, setTool, markupColor, markupWidth, cropMode,
    api: {
      loadImageFromFile, openImageUrl, openProject, addSticker, applyTemplate,
      updateStyle, updateGeom, updateMarkup, fitSticker, commit,
      bringForward, sendBackward, duplicateActive, deleteActive, clearMarkup,
      undo, zoomBy, resetZoom, exportImage, save, fetchGallery,
      startCrop, applyCrop, cancelCrop,
    },
  }
}
