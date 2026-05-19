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

export async function exportViaPython(pages, defaultCanvasSize) {
  const res = await fetch('/api/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages, defaultCanvasSize }),
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
