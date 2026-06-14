import { Group, Rect, Circle, IText, Path, Shadow } from 'fabric'

// ---------------------------------------------------------------------------
// A "sticker" is a Fabric Group made of an optional background shape + price
// text. Visual STYLE (text/colors/shape/font) lives on `group.spec`; GEOMETRY
// (position/scale/rotation/opacity) lives on the Fabric object itself. Both are
// combined when serializing to the sticker_json contract.
// ---------------------------------------------------------------------------

export const DEFAULT_STICKER = {
  type: 'price_tag',
  text: '$19.99',
  x: 200,
  y: 200,
  scale: 1,
  rotation: 0,
  fontSize: 32,
  fontWeight: 'bold',
  textColor: '#000000',
  bgColor: '#FFD700',
  shape: 'rounded_rect', // 'text' | 'rounded_rect' | 'circle' | 'tag'
  opacity: 1,
  shadow: null,
}

function uuid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `s-${Date.now()}-${Math.random()}`
}

function makeShadow(str) {
  if (!str) return null
  // format: "<color> <offsetX> <offsetY> <blur>"  e.g. "rgba(0,0,0,0.25) 0 2 6"
  const [color, ox, oy, blur] = String(str).trim().split(/\s+/)
  return new Shadow({ color, offsetX: +ox || 0, offsetY: +oy || 0, blur: +blur || 0 })
}

function tagPath(w, h) {
  const W = w / 2
  const H = h / 2
  const notch = h * 0.5
  return `M ${-W} 0 L ${-W + notch} ${-H} L ${W} ${-H} L ${W} ${H} L ${-W + notch} ${H} Z`
}

// Build the child objects (shape + text) centered at the group origin.
function buildChildren(spec) {
  const { text, fontSize, fontWeight, textColor, bgColor, shape } = spec
  const shadow = makeShadow(spec.shadow)

  const itext = new IText(text || '$0.00', {
    fontSize,
    fontWeight,
    fill: textColor,
    fontFamily: 'Inter, Helvetica, Arial, sans-serif',
    originX: 'center',
    originY: 'center',
    left: 0,
    top: 0,
    selectable: false,
    evented: false,
  })

  const tw = itext.width
  const th = itext.height
  const padX = Math.max(18, fontSize * 0.55)
  const padY = Math.max(12, fontSize * 0.4)
  const children = []

  if (shape === 'rounded_rect') {
    const w = tw + padX * 2
    const h = th + padY * 2
    children.push(
      new Rect({
        width: w, height: h,
        rx: Math.min(18, h / 2), ry: Math.min(18, h / 2),
        fill: bgColor, originX: 'center', originY: 'center', left: 0, top: 0, shadow,
      }),
    )
  } else if (shape === 'tag') {
    const w = tw + padX * 2 + h_extra(fontSize)
    const h = th + padY * 2
    children.push(
      new Path(tagPath(w, h), {
        fill: bgColor, originX: 'center', originY: 'center', left: 0, top: 0, shadow,
      }),
    )
    children.push(
      new Circle({
        radius: h * 0.1, fill: '#ffffff', stroke: bgColor, strokeWidth: 2,
        originX: 'center', originY: 'center', left: -w / 2 + h * 0.45, top: 0,
      }),
    )
    itext.set({ left: h_extra(fontSize) / 2 + h * 0.05 })
  } else if (shape === 'circle') {
    const r = Math.max(tw, th) / 2 + padY + 6
    children.push(
      new Circle({
        radius: r, fill: bgColor, originX: 'center', originY: 'center', left: 0, top: 0, shadow,
      }),
    )
  }
  // shape === 'text' => no background, text only

  children.push(itext)
  return children
}

function h_extra(fontSize) {
  return fontSize * 0.9 // extra room on tag shapes for the pointed notch
}

// Create a Fabric Group from a sticker spec (style + geometry).
export function createStickerObject(partial) {
  const spec = { ...DEFAULT_STICKER, ...partial, id: partial?.id || uuid() }
  const styleSpec = {
    text: spec.text, fontSize: spec.fontSize, fontWeight: spec.fontWeight,
    textColor: spec.textColor, bgColor: spec.bgColor, shape: spec.shape,
    shadow: spec.shadow,
  }
  const group = new Group(buildChildren(styleSpec), {
    left: spec.x,
    top: spec.y,
    originX: 'center',
    originY: 'center',
    angle: spec.rotation || 0,
    scaleX: spec.scale || 1,
    scaleY: spec.scale || 1,
    opacity: spec.opacity ?? 1,
    subTargetCheck: false,
  })
  group.stickerId = spec.id
  group.stickerType = 'price_tag'
  group.spec = styleSpec
  group.setControlsVisibility({ mtr: true })
  return group
}

// Re-render a sticker in place after a STYLE change, preserving its geometry.
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

// Serialize one Fabric sticker group to the sticker_json contract.
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
    fontSize: g.spec.fontSize,
    fontWeight: g.spec.fontWeight,
    textColor: g.spec.textColor,
    bgColor: g.spec.bgColor,
    shape: g.spec.shape,
    opacity: round(g.opacity ?? 1),
    shadow: g.spec.shadow || null,
  }
}

export function serializeAll(canvas) {
  return canvas
    .getObjects()
    .filter((o) => o.stickerType === 'price_tag')
    .map(serializeSticker)
}
