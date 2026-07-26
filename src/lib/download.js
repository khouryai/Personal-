// Saving the finished image to the device.
//
// iPad/iPhone Safari is the awkward case: an <a download> pointing at a huge
// `data:` URL either silently does nothing or opens a blank tab, and even when
// it works the file only lands in Files → Downloads — never in Photos.
// So we offer three routes, best first:
//
//   1. navigator.share({ files }) -> the iOS share sheet, which has both
//      "Save Image" (Photos / albums) and "Save to Files".
//   2. <a download> pointing at a `blob:` URL -> Files → Downloads.
//   3. Open the image in a new tab -> press and hold -> "Add to Photos".

export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as desktop Safari.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

// Decode a data: URL into a Blob *synchronously*. This has to stay sync: iOS
// Safari drops the transient user activation that navigator.share() requires
// if anything is awaited between the tap and the share() call, so the usual
// `await fetch(dataUrl).then(r => r.blob())` trick throws NotAllowedError.
export function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(',')
  const type = header.match(/:(.*?);/)?.[1] || 'image/png'
  if (!header.includes(';base64')) {
    return new Blob([decodeURIComponent(body)], { type })
  }
  const bin = atob(body)
  // Decode in chunks so a full-resolution PNG doesn't build one giant array.
  const chunks = []
  const CHUNK = 64 * 1024
  for (let offset = 0; offset < bin.length; offset += CHUNK) {
    const slice = bin.slice(offset, offset + CHUNK)
    const bytes = new Uint8Array(slice.length)
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i)
    chunks.push(bytes)
  }
  return new Blob(chunks, { type })
}

export function makeFile(blob, name) {
  try {
    return new File([blob], name, { type: blob.type, lastModified: Date.now() })
  } catch {
    return null // very old browsers without the File constructor
  }
}

// Can this device hand the image to the OS share sheet?
export function canShareFile(file) {
  return Boolean(
    file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })
  )
}

// Returns 'shared' | 'cancelled' | 'unsupported'. Call this straight from a
// click handler — do not await anything first (see dataUrlToBlob above).
export async function shareFile(file, title = 'PriceTag Studio') {
  if (!canShareFile(file)) return 'unsupported'
  try {
    await navigator.share({ files: [file], title })
    return 'shared'
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled'
    return 'unsupported'
  }
}

// blob: URL + download attribute. Works on iPadOS 13+ (lands in Files →
// Downloads) and everywhere on desktop.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Safari needs the URL to stay alive while it starts the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Last resort: show the image on its own so it can be long-pressed and added
// to Photos. Must be called from a user gesture or the popup gets blocked.
export function openBlobInTab(blob) {
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return win
}

export function formatBytes(n) {
  if (!n) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
