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
import { uploadOriginal, uploadExport, uploadThumb, removeByUrl } from '../lib/storage.js'
import { saveProject, listProjects, loadProject, deleteProject } from '../lib/projects.js'
import { isSupabaseConfigured } from '../lib/supabase.js'
import {
  dataUrlToBlob, makeFile, canShareFile, shareFile, downloadBlob, openBlobInTab,
} from '../lib/download.js'

const GRID = 20
const THUMB_MAX = 480 // longest edge of the gallery preview, in px

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
  const loadTokenRef = useRef(0)     // increments per load; stale loads bail out
  const sceneBgUrlRef = useRef(null) // uploaded backdrop for the current project
  const bgDirtyRef = useRef(false)   // has the backdrop changed since it was stored?
  const savedUrlsRef = useRef({ final: null, thumb: null }) // to clean up on re-save

  const [ready, setReady] = useState(false)
  const [hasImage, setHasImage] = useState(false)
  const [loading, setLoading] = useState(false)
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
    const savedVpt = c.viewportTransform.slice()

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
    // Preserve the user's current zoom/pan on resize refits (e.g. when the
    // mobile editor panel opens); only reset to fit on a fresh load.
    c.setViewportTransform(refitObjects ? savedVpt : [1, 0, 0, 1, 0, 0])
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

    // Give the empty canvas a real size so the upload call-to-action fills the
    // stage (instead of a tiny default box) before any image is loaded.
    const initW = Math.max(200, (stageRef.current?.clientWidth || 400) - 16)
    const initH = Math.max(200, (stageRef.current?.clientHeight || 400) - 16)
    canvas.setDimensions({ width: initW, height: initH })

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
  // Every load takes a ticket. A slow load that finishes after a newer one
  // started must not paint itself over the newer photo — without this, opening
  // two saved projects in quick succession left whichever was slower on screen.
  const beginLoad = useCallback(() => {
    loadTokenRef.current += 1
    setLoading(true)
    return loadTokenRef.current
  }, [])
  const isStale = (token) => token !== loadTokenRef.current

  // Fetch the image FIRST, swap only once it has decoded. The old version
  // cleared the canvas up front and then awaited the network, so any failure
  // or slow response left the previous photo stranded with its overlays gone —
  // exactly the "it doesn't replace the photo" symptom.
  const setBackground = useCallback(async (url, opts = {}) => {
    const c = canvasRef.current
    if (!c) throw new Error('editor not ready')
    if (!url) throw new Error('this photo has no image file')
    // Fabric's own rejection reads "fabric: Error loading <url>" — not
    // something to put in front of someone.
    const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' })
      .catch(() => { throw new Error('the image file couldn’t be loaded') })
    if (!img) throw new Error('the image file couldn’t be loaded')
    if (opts.token != null && isStale(opts.token)) return false
    if (opts.clear) c.getObjects().slice().forEach((o) => c.remove(o))
    img.set({ originX: 'left', originY: 'top', left: 0, top: 0 })
    c.backgroundImage = img
    fitToContainer(false)
    setHasImage(true)
    historyRef.current = []
    pushHistory()
    return true
  }, [fitToContainer, pushHistory])

  const loadImageFromFile = useCallback(async (file) => {
    const token = beginLoad()
    const objectUrl = URL.createObjectURL(file)
    try {
      originalFileRef.current = file
      originalUrlRef.current = null
      sceneBgUrlRef.current = null
      bgDirtyRef.current = false
      savedUrlsRef.current = { final: null, thumb: null }
      setProjectId(null)
      const applied = await setBackground(objectUrl, { clear: true, token })
      if (applied) setStatus('Image loaded')
      return { ok: true }
    } catch (err) {
      if (!isStale(token)) setStatus(`Couldn’t open that image: ${err.message}`)
      return { ok: false, reason: err.message }
    } finally {
      URL.revokeObjectURL(objectUrl)
      if (!isStale(token)) setLoading(false)
    }
  }, [setBackground, beginLoad])

  // open a saved image (flattened) into a fresh canvas
  const openImageUrl = useCallback(async (url, token = beginLoad()) => {
    try {
      originalFileRef.current = null
      originalUrlRef.current = null
      sceneBgUrlRef.current = null
      bgDirtyRef.current = false
      savedUrlsRef.current = { final: null, thumb: null }
      setProjectId(null)
      const applied = await setBackground(url, { clear: true, token })
      if (applied) setStatus('Opened saved image')
      return { ok: true }
    } catch (err) {
      if (!isStale(token)) setStatus(`Open failed: ${err.message}`)
      return { ok: false, reason: err.message }
    } finally {
      if (!isStale(token)) setLoading(false)
    }
  }, [setBackground, beginLoad])

  // Reopen a saved PROJECT with its stickers + markup as editable objects.
  // Resolves only once the photo is actually on screen, so callers can keep a
  // spinner up and report a real failure instead of closing on a maybe.
  const openProject = useCallback(async (id) => {
    const token = beginLoad()
    setStatus('Opening…')
    try {
      const res = await loadProject(id)
      if (!res.ok) throw new Error(res.reason)
      if (isStale(token)) return { ok: false, reason: 'superseded' }

      const p = res.project
      const scene = p.scene_json
      const bg = scene?.bg || p.original_image_url

      // Legacy row with no editable scene -> open the flattened image instead.
      if (!scene?.objects || !bg) {
        const flat = p.final_image_url || p.original_image_url
        if (!flat) throw new Error('this photo has no image file')
        const r = await openImageUrl(flat, token)
        if (!r.ok) return r
        if (isStale(token)) return { ok: false, reason: 'superseded' }
        // Saving this legacy row again should retire its old render, and will
        // upgrade it to an editable scene.
        savedUrlsRef.current = { final: p.final_image_url || null, thumb: p.thumb_url || null }
        setProjectId(p.id)
        setStatus('Opened as a flat image — this save has no editable layers')
        return { ok: true, flattened: true }
      }

      originalFileRef.current = null
      originalUrlRef.current = p.original_image_url || null
      sceneBgUrlRef.current = scene.bg || null
      bgDirtyRef.current = false
      savedUrlsRef.current = { final: p.final_image_url || null, thumb: p.thumb_url || null }
      const applied = await setBackground(bg, { clear: true, token })
      if (!applied || isStale(token)) return { ok: false, reason: 'superseded' }

      const c = canvasRef.current
      if (!c) throw new Error('editor not ready')
      const ratio = c.getWidth() / (scene.w || c.getWidth())
      const objs = await util.enlivenObjects(scene.objects)
      if (isStale(token)) return { ok: false, reason: 'superseded' }
      objs.forEach((o) => {
        o.set({ left: o.left * ratio, top: o.top * ratio, scaleX: o.scaleX * ratio, scaleY: o.scaleY * ratio })
        o.setCoords(); c.add(o)
      })
      c.requestRenderAll()
      historyRef.current = []; pushHistory()
      setProjectId(p.id)
      setStatus('Reopened — fully editable')
      return { ok: true }
    } catch (err) {
      if (!isStale(token)) setStatus(`Open failed: ${err.message}`)
      return { ok: false, reason: err.message }
    } finally {
      if (!isStale(token)) setLoading(false)
    }
  }, [setBackground, openImageUrl, pushHistory, beginLoad])

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
    // Text size stays independent of shape size — the shape only re-fits when
    // the user changes padding or taps "Fit shape to text" (those pass boxW/H null).
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

  const deselect = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    c.discardActiveObject(); c.requestRenderAll()
    setActiveSpec(null); setActiveMarkup(null)
  }, [])

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
    // The backdrop is no longer the stored photo, so the next save has to
    // upload its own copy of it.
    bgDirtyRef.current = true
    fitToContainer(true)
    pushHistory()
    setStatus('Cropped')
  }, [fitToContainer, pushHistory])

  // ------------------------------------------------------------- export
  const renderDataUrl = useCallback((format = 'png', multiplier) => {
    const c = canvasRef.current
    if (!c) return null
    const saved = c.viewportTransform.slice()
    c.setViewportTransform([1, 0, 0, 1, 0, 0])
    c.discardActiveObject(); c.requestRenderAll()
    const dataUrl = c.toDataURL({
      format: format === 'jpg' ? 'jpeg' : 'png',
      quality: 0.92, multiplier: multiplier ?? imageScaleRef.current,
    })
    c.setViewportTransform(saved); c.requestRenderAll()
    return dataUrl
  }, [])

  // A ~480px JPEG for the gallery grid. The grid used to load final_image_url
  // — a 20-38 MB full-resolution PNG — once per card, which is what made
  // "Saved photos" so slow to open.
  const renderThumbDataUrl = useCallback(() => {
    const c = canvasRef.current
    if (!c) return null
    const m = Math.min(1, THUMB_MAX / Math.max(c.getWidth(), c.getHeight(), 1))
    return renderDataUrl('jpg', m)
  }, [renderDataUrl])

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

  // Render the finished image into a Blob + File, ready to hand to the OS.
  // Synchronous on purpose — iOS Safari revokes the user activation that
  // navigator.share() needs the moment we await something (see lib/download.js).
  const prepareExport = useCallback((format = 'png') => {
    const dataUrl = renderDataUrl(format)
    if (!dataUrl) return null
    const ext = format === 'jpg' ? 'jpg' : 'png'
    const blob = dataUrlToBlob(dataUrl)
    const name = `pricetag-${Date.now()}.${ext}`
    const file = makeFile(blob, name)
    return { blob, file, name, format: ext, size: blob.size, canShare: canShareFile(file) }
  }, [renderDataUrl])

  // One path for every write to Supabase, used by both Save and the
  // post-download backup.
  const persistProject = useCallback(async ({ finalBlob, format = 'png' }) => {
    if (!isSupabaseConfigured) return { ok: false, reason: 'supabase-not-configured' }
    const c = canvasRef.current
    if (!c) return { ok: false, reason: 'editor not ready' }

    const originalUrl = await ensureOriginalUrl()

    // The backdrop only needs its own file once a crop has changed it.
    // Previously every save re-rendered the untouched photo as a full-res PNG
    // and uploaded it — a ~20 MB duplicate of a file already in storage, and
    // the thing the editor then had to re-download on every reopen.
    let bgUrl = sceneBgUrlRef.current || originalUrl
    let staleBg = null
    if (bgDirtyRef.current) {
      const bgData = renderBackgroundDataUrl()
      if (bgData) {
        const uploaded = await uploadExport(dataUrlToBlob(bgData), 'png')
        staleBg = sceneBgUrlRef.current
        bgUrl = uploaded
        sceneBgUrlRef.current = uploaded
        bgDirtyRef.current = false
      }
    }

    const finalUrl = finalBlob ? await uploadExport(finalBlob, format) : null
    const thumbData = renderThumbDataUrl()
    const thumbUrl = thumbData ? await uploadThumb(dataUrlToBlob(thumbData)) : null

    const scene = buildScene(); if (scene) scene.bg = bgUrl
    const res = await saveProject({
      id: projectId, originalImageUrl: originalUrl,
      finalImageUrl: finalUrl, thumbUrl,
      stickerJson: serializeAll(c), sceneJson: scene,
    })
    if (!res.ok) return res

    setProjectId(res.project.id)
    // Only once the row points at the new files: drop the ones it replaced,
    // never the original photo (the backdrop usually just references it).
    const superseded = [staleBg, finalUrl && savedUrlsRef.current.final, thumbUrl && savedUrlsRef.current.thumb]
      .filter((u) => u && u !== originalUrl && u !== bgUrl)
    savedUrlsRef.current = {
      final: finalUrl || savedUrlsRef.current.final,
      thumb: thumbUrl || savedUrlsRef.current.thumb,
    }
    if (superseded.length) removeByUrl(...superseded)
    return res
  }, [projectId, ensureOriginalUrl, buildScene, renderBackgroundDataUrl, renderThumbDataUrl])

  // Back up after the file has already reached the device, so a cloud failure
  // never blocks saving.
  const uploadExportToCloud = useCallback(async (blob, format = 'png') => {
    if (!isSupabaseConfigured || !blob) return
    try {
      setStatus('Backing up to cloud…')
      const res = await persistProject({ finalBlob: blob, format })
      setStatus(res.ok ? 'Saved to your device ✓ · backed up' : `Saved to your device ✓ (cloud: ${res.reason})`)
    } catch (err) {
      setStatus(`Saved to your device ✓ (cloud backup failed: ${err.message})`)
    }
  }, [persistProject])

  // Hand the file to the OS share sheet — on iPad this is the one route that
  // offers both "Save Image" (Photos) and "Save to Files".
  const shareExport = useCallback(async (desc) => {
    if (!desc?.file) return 'unsupported'
    const result = await shareFile(desc.file)
    if (result === 'shared') setStatus('Sent to share sheet ✓')
    else if (result === 'cancelled') setStatus('')
    return result
  }, [])

  const saveExportToFiles = useCallback((desc) => {
    if (!desc?.blob) return
    downloadBlob(desc.blob, desc.name)
    setStatus('Downloaded — check Files › Downloads')
  }, [])

  const openExportInTab = useCallback((desc) => {
    if (!desc?.blob) return
    openBlobInTab(desc.blob)
    setStatus('Press and hold the image → Add to Photos')
  }, [])

  // Straight download, no chooser — used by the desktop PNG/JPG buttons.
  const exportImage = useCallback(async (format = 'png') => {
    const desc = prepareExport(format)
    if (!desc) return
    saveExportToFiles(desc)
    await uploadExportToCloud(desc.blob, desc.format)
  }, [prepareExport, saveExportToFiles, uploadExportToCloud])

  const save = useCallback(async () => {
    const c = canvasRef.current
    if (!c) return { ok: false, reason: 'editor not ready' }
    if (!isSupabaseConfigured) { setStatus('Supabase not configured'); return { ok: false, reason: 'supabase-not-configured' } }
    try {
      setStatus('Saving…')
      // Store both the flattened render and the editable scene, so the project
      // reopens with its stickers + markup intact.
      const dataUrl = renderDataUrl('png')
      const res = await persistProject({
        finalBlob: dataUrl ? dataUrlToBlob(dataUrl) : null, format: 'png',
      })
      setStatus(res.ok ? 'Project saved ✓' : `Save failed: ${res.reason}`)
      return res
    } catch (err) {
      setStatus(`Save failed: ${err.message}`)
      return { ok: false, reason: err.message }
    }
  }, [renderDataUrl, persistProject])

  const fetchGallery = useCallback(() => listProjects(), [])

  const removeProject = useCallback(async (id) => {
    const res = await deleteProject(id)
    if (res.ok && id === projectId) setProjectId(null)
    return res
  }, [projectId])

  return {
    attach, ready, hasImage, loading, projectId, activeSpec, activeMarkup, snap, setSnap, status,
    tool, setTool, markupColor, markupWidth, cropMode,
    api: {
      loadImageFromFile, openImageUrl, openProject, addSticker, applyTemplate,
      updateStyle, updateGeom, updateMarkup, fitSticker, commit,
      bringForward, sendBackward, duplicateActive, deleteActive, clearMarkup, deselect,
      undo, zoomBy, resetZoom, exportImage, save, fetchGallery, deleteProject: removeProject,
      prepareExport, shareExport, saveExportToFiles, openExportInTab, uploadExportToCloud,
      startCrop, applyCrop, cancelCrop,
    },
  }
}
