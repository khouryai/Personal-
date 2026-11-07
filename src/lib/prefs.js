// Per-browser settings, kept in localStorage so each device remembers its own
// personalizations (sticker styles, markup color/width, snap, export format).
// Storage can be unavailable (private mode, blocked site data), so every read
// and write is guarded and the app falls back to the built-in defaults.

const KEY = 'pricetag-studio:prefs:v1'

// The sticker fields worth remembering. Text and position are left out: the
// price and where it goes change from photo to photo.
export const STICKER_STYLE_KEYS = [
  'fontSize', 'fontWeight', 'textColor', 'bgColor', 'shape', 'shadow',
  'pad', 'boxW', 'boxH', 'textAngle', 'scale', 'rotation', 'opacity',
]

export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

export function savePrefs(patch) {
  const next = { ...loadPrefs(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage off */ }
  return next
}

export function getPref(name, fallback) {
  const v = loadPrefs()[name]
  return v === undefined ? fallback : v
}

// Saved style for a template key ('custom' = the plain ➕ Sticker).
export function getStickerStyle(key) {
  return loadPrefs().stickers?.[key] || {}
}

export function saveStickerStyle(key, spec) {
  const style = {}
  for (const k of STICKER_STYLE_KEYS) if (spec[k] !== undefined) style[k] = spec[k]
  const stickers = { ...(loadPrefs().stickers || {}), [key]: style }
  savePrefs({ stickers })
}

export function clearStickerStyle(key) {
  const stickers = { ...(loadPrefs().stickers || {}) }
  delete stickers[key]
  savePrefs({ stickers })
}
