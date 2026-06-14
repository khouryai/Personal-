import { Line, Rect, Ellipse, Triangle, Group } from 'fabric'

// Custom props that must survive (de)serialization for markup + stickers.
export const PERSIST_PROPS = [
  'stickerType', 'stickerId', 'spec',
  'markup', 'markupTool', 'markupColor', 'markupWidth',
  'selectable', 'evented',
]

// Create the initial markup object at a single point; it's grown during drag.
export function createMarkupStart(tool, p, { color, width }) {
  const base = {
    stroke: color, strokeWidth: width, strokeUniform: true,
    markup: true, markupTool: tool, markupColor: color, markupWidth: width,
  }
  if (tool === 'line' || tool === 'arrow') {
    return new Line([p.x, p.y, p.x, p.y], { ...base })
  }
  if (tool === 'box') {
    return new Rect({ left: p.x, top: p.y, width: 1, height: 1, fill: 'transparent', ...base })
  }
  if (tool === 'circle') {
    return new Ellipse({ left: p.x, top: p.y, rx: 1, ry: 1, fill: 'transparent', ...base })
  }
  return null
}

// Update the in-progress markup as the pointer moves.
export function updateMarkupDraw(obj, tool, origin, p) {
  if (tool === 'line' || tool === 'arrow') {
    obj.set({ x2: p.x, y2: p.y })
  } else if (tool === 'box') {
    obj.set({
      left: Math.min(origin.x, p.x), top: Math.min(origin.y, p.y),
      width: Math.abs(p.x - origin.x), height: Math.abs(p.y - origin.y),
    })
  } else if (tool === 'circle') {
    obj.set({
      left: Math.min(origin.x, p.x), top: Math.min(origin.y, p.y),
      rx: Math.abs(p.x - origin.x) / 2, ry: Math.abs(p.y - origin.y) / 2,
    })
  }
  obj.setCoords()
}

export function isTooSmall(tool, origin, p) {
  if (tool === 'line' || tool === 'arrow') {
    return Math.hypot(p.x - origin.x, p.y - origin.y) < 6
  }
  return Math.abs(p.x - origin.x) < 6 || Math.abs(p.y - origin.y) < 6
}

// Build a grouped arrow (line + arrowhead) from start/end points.
export function makeArrowGroup(x1, y1, x2, y2, color, width) {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(14, width * 4)
  const line = new Line([x1, y1, x2, y2], {
    stroke: color, strokeWidth: width, strokeUniform: true,
  })
  const head = new Triangle({
    width: headLen, height: headLen, fill: color,
    left: x2, top: y2, originX: 'center', originY: 'center',
    angle: (angle * 180) / Math.PI + 90,
  })
  return new Group([line, head], {
    markup: true, markupTool: 'arrow', markupColor: color, markupWidth: width,
  })
}

// Apply stroke color / width to a selected markup object (handles arrow groups).
export function applyMarkupStyle(obj, { color, width }) {
  if (!obj) return
  obj.markupColor = color
  obj.markupWidth = width
  if (obj.markupTool === 'arrow' && obj.getObjects) {
    obj.getObjects().forEach((ch) => {
      if (ch.type === 'triangle') ch.set('fill', color)
      else ch.set('stroke', color)
      ch.set('strokeWidth', width)
    })
  } else {
    obj.set({ stroke: color, strokeWidth: width })
  }
  obj.setCoords()
}
