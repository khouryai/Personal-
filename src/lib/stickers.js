import { Group, Rect, Circle, IText, Path, Polygon, Shadow } from 'fabric'

// ---------------------------------------------------------------------------
// A "sticker" is a Fabric Group: an optional background shape + price text.
// STYLE (text/colors/shape/font/textAngle) lives on `group.spec`; GEOMETRY
// (position/scale/rotation/opacity) lives on the Fabric object. The shape is
// sized to `boxW`/`boxH`, which are computed once and then kept stable so
// editing the price text does NOT resize the shape (use "fit to text" to reset).
// ---------------------------------------------------------------------------

export const SHAPES = [
  { key: 'rounded_rect', label: 'Rounded' },
  { key: 'rect', label: 'Rectangle' },
  { key: 'pill', label: 'Pill' },
  { key: 'circle', label: 'Circle' },
  { key: 'tag', label: 'Tag' },
  { key: 'diamond', label: 'Diamond' },
  { key: 'banner', label: 'Banner' },
  { key: 'starburst', label: 'Burst' },
  { key: 'text', label: 'Text only' },
]

export const DEFAULT_STICKER = {
  type: 'price_tag',
  text: '$19.99',
  x: 200,
  y: 200,
  scale: 1,
  rotation: 0,
  textAngle: 0,
  fontSize: 32,
  fontWeight: 'bold',
  textColor: '#000000',
  bgColor: '#FFD700',
  shape: 'rounded_rect',
  opacity: 1,
  shadow: null,
  pad: 8,     // padding between text and shape edge (tightness)
  boxW: null, // fixed shape box size; null = auto-fit to text using `pad`
  boxH: null,
}

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `s-${Date.now()}-${Math.random()}`
}

function makeShadow(str) {
  if (!str) return null
  const [color, ox, oy, blur] = String(str).trim().split(/\s+/)
  return new Shadow({ color, offsetX: +ox || 0, offsetY: +oy || 0, blur: +blur || 0 })
}

function tagPath(w, h) {
  const W = w / 2, H = h / 2, notch = h * 0.5
  return `M ${-W} 0 L ${-W + notch} ${-H} L ${W} ${-H} L ${W} ${H} L ${-W + notch} ${H} Z`
}

function starPoints(outer, inner, spikes) {
  const pts = []
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI / spikes) * i - Math.PI / 2
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return pts
}

// Build the child objects (shape + text). Returns the children plus the
// box dimensions actually used, so they can be persisted on the sticker.
function buildChildren(spec) {
  const { text, fontSize, fontWeight, textColor, bgColor, shape } = spec
  const shadow = makeShadow(spec.shadow)

  const itext = new IText(text || '$0.00', {
    fontSize, fontWeight, fill: textColor,
    fontFamily: 'Inter, Helvetica, Arial, sans-serif',
    originX: 'center', originY: 'center', left: 0, top: 0,
    angle: spec.textAngle || 0,
    selectable: false, evented: false, isPriceText: true,
  })

  const tw = itext.width, th = itext.height
  const pad = spec.pad ?? 8
  const boxW = spec.boxW ?? Math.round(tw + pad * 2)
  const boxH = spec.boxH ?? Math.round(th + pad * 2)
  const children = []
  const fill = { fill: bgColor, originX: 'center', originY: 'center', left: 0, top: 0, shadow }

  if (shape === 'rounded_rect' || shape === 'rect' || shape === 'pill') {
    const rx = shape === 'pill' ? boxH / 2 : shape === 'rect' ? 0 : Math.min(18, boxH / 2)
    children.push(new Rect({ width: boxW, height: boxH, rx, ry: rx, ...fill }))
  } else if (shape === 'circle') {
    children.push(new Circle({ radius: Math.max(boxW, boxH) / 2, ...fill }))
  } else if (shape === 'tag') {
    const w = boxW + fontSize * 0.9
    children.push(new Path(tagPath(w, boxH), fill))
    children.push(new Circle({
      radius: boxH * 0.1, fill: '#ffffff', stroke: bgColor, strokeWidth: 2,
      originX: 'center', originY: 'center', left: -w / 2 + boxH * 0.45, top: 0,
    }))
    itext.set({ left: fontSize * 0.45 })
  } else if (shape === 'diamond') {
    const hw = boxW * 0.9, hh = boxH * 0.9
    children.push(new Polygon(
      [{ x: 0, y: -hh }, { x: hw, y: 0 }, { x: 0, y: hh }, { x: -hw, y: 0 }], fill,
    ))
  } else if (shape === 'banner') {
    const W = boxW / 2, H = boxH / 2, notch = boxH * 0.4
    children.push(new Polygon([
      { x: -W, y: -H }, { x: W, y: -H }, { x: W - notch, y: 0 },
      { x: W, y: H }, { x: -W, y: H }, { x: -W + notch, y: 0 },
    ], fill))
  } else if (shape === 'starburst') {
    const outer = Math.hypot(boxW, boxH) / 2 * 0.95
    const inner = Math.max(outer * 0.66, Math.hypot(tw, th) / 2 + 4)
    children.push(new Polygon(starPoints(outer, inner, 10), fill))
  }
  // shape === 'text' => no background

  children.push(itext)
  return { children, boxW, boxH }
}

export function createStickerObject(partial) {
  const spec = { ...DEFAULT_STICKER, ...partial, id: partial?.id || uuid() }
  const styleSpec = {
    text: spec.text, fontSize: spec.fontSize, fontWeight: spec.fontWeight,
    textColor: spec.textColor, bgColor: spec.bgColor, shape: spec.shape,
    shadow: spec.shadow, textAngle: spec.textAngle || 0,
    pad: spec.pad ?? 8, boxW: spec.boxW ?? null, boxH: spec.boxH ?? null,
  }
  const { children, boxW, boxH } = buildChildren(styleSpec)
  styleSpec.boxW = boxW // persist the fixed box so future edits keep the size
  styleSpec.boxH = boxH

  const group = new Group(children, {
    left: spec.x, top: spec.y, originX: 'center', originY: 'center',
    angle: spec.rotation || 0, scaleX: spec.scale || 1, scaleY: spec.scale || 1,
    opacity: spec.opacity ?? 1, subTargetCheck: false,
  })
  group.stickerId = spec.id
  group.stickerType = 'price_tag'
  group.spec = styleSpec
  group.setControlsVisibility({ mtr: true })
  return group
}

// Re-render a sticker after a STYLE change, preserving geometry.
export function rebuildStickerObject(canvas, group) {
  const geom = {
    x: group.left, y: group.top, scale: group.scaleX,
    rotation: group.angle, opacity: group.opacity, id: group.stickerId,
  }
  const next = createStickerObject({ ...group.spec, ...geom })
  const idx = canvas.getObjects().indexOf(group)
  canvas.remove(group)
  canvas.insertAt(idx, next)
  canvas.setActiveObject(next)
  canvas.requestRenderAll()
  return next
}

// Update ONLY the price text in place — the shape/background size is untouched.
// Returns false if the tagged text child can't be found (e.g. after a restore).
export function setStickerText(canvas, group, text) {
  group.spec = { ...group.spec, text }
  const txt = group.getObjects().find((o) => o.isPriceText)
  if (!txt) return false
  txt.set('text', text); txt.dirty = true
  group.dirty = true
  group.setCoords()
  canvas.requestRenderAll()
  return true
}

// Clear the stored box so the next rebuild re-fits the shape to the text.
export function fitStickerToText(canvas, group) {
  group.spec = { ...group.spec, boxW: null, boxH: null }
  return rebuildStickerObject(canvas, group)
}

export function serializeSticker(g) {
  const round = (n) => Math.round(n * 1000) / 1000
  return {
    id: g.stickerId,
    type: 'price_tag',
    text: g.spec.text,
    x: Math.round(g.left),
    y: Math.round(g.top),
    scale: round(g.scaleX),
    rotation: Math.round(g.angle),
    textAngle: Math.round(g.spec.textAngle || 0),
    fontSize: g.spec.fontSize,
    fontWeight: g.spec.fontWeight,
    textColor: g.spec.textColor,
    bgColor: g.spec.bgColor,
    shape: g.spec.shape,
    opacity: round(g.opacity ?? 1),
    shadow: g.spec.shadow || null,
    pad: g.spec.pad ?? 8,
    boxW: g.spec.boxW ?? null,
    boxH: g.spec.boxH ?? null,
  }
}

export function serializeAll(canvas) {
  return canvas.getObjects()
    .filter((o) => o.stickerType === 'price_tag')
    .map(serializeSticker)
}
