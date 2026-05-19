let _backendAvailable = null

export async function checkBackend() {
  if (_backendAvailable !== null) return _backendAvailable
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
    _backendAvailable = res.ok
  } catch {
    _backendAvailable = false
  }
  return _backendAvailable
}

/**
 * Collect font descriptors from all pages' fontImports for backend embedding.
 * Parses @font-face blocks and @import URLs into structured font data.
 */
function collectFontData(pages) {
  const fonts = []
  const seen = new Set()

  for (const page of Object.values(pages)) {
    const imports = page.fontImports || []
    for (const css of imports) {
      const trimmed = css.trim()
      if (seen.has(trimmed)) continue
      seen.add(trimmed)

      // @import url('https://fonts.googleapis.com/css2?...')
      const importMatch = trimmed.match(/@import\s+url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)
      if (importMatch) {
        fonts.push({ type: 'google-import', url: importMatch[1] })
        continue
      }

      // @font-face { font-family: '...'; src: url(...); font-weight: ...; }
      if (trimmed.startsWith('@font-face')) {
        const family = _cssProp(trimmed, 'font-family')?.replace(/['"]/g, '')
        const src = _cssProp(trimmed, 'src')
        const weight = _cssProp(trimmed, 'font-weight') || '400'
        const style = _cssProp(trimmed, 'font-style') || 'normal'

        if (!family || !src) continue

        const urlMatch = src.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)
        if (urlMatch) {
          fonts.push({
            type: 'font-face',
            family,
            url: urlMatch[1],
            weight: parseInt(weight) || 400,
            style,
          })
        }
      }
    }
  }
  return fonts
}

function _cssProp(css, prop) {
  const m = css.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

export async function exportViaPython(pages, defaultCanvasSize) {
  const fonts = collectFontData(pages)
  const res = await fetch('/api/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages, defaultCanvasSize, fonts }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(err.error || `Server error: ${res.status}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'slide-export.pptx'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
