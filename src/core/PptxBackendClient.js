let _backendAvailable = null

// 로컬 컨테이너 배포 기본값 (Docker Hub 이미지 / 포트)
export const PPTX_DOCKER_IMAGE = 'dilly97/float-pptx'
export const PPTX_DEFAULT_PORT = 8321
const BACKEND_URL_KEY = 'pptx-backend-url'

/** `docker run` 안내 명령 (UI 힌트용) */
export function dockerRunCommand() {
  return `docker run -p ${PPTX_DEFAULT_PORT}:${PPTX_DEFAULT_PORT} ${PPTX_DOCKER_IMAGE}`
}

/**
 * 백엔드 베이스 URL 결정 (우선순위: localStorage 오버라이드 > 빌드 env > 환경 기본).
 * - dev: '' (상대경로 → vite proxy /api)
 * - prod: http://localhost:<port> (사용자가 로컬 컨테이너 실행)
 * 빈 문자열이면 상대경로(같은 origin)를 사용한다.
 */
export function getBackendBase() {
  try {
    const o = localStorage.getItem(BACKEND_URL_KEY)
    if (o !== null) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  const env = import.meta.env?.VITE_PPTX_BACKEND_URL
  if (env) return String(env).replace(/\/+$/, '')
  if (import.meta.env?.DEV) return '' // vite proxy
  return `http://localhost:${PPTX_DEFAULT_PORT}`
}

/** 백엔드 URL 런타임 설정(빈 문자열=상대경로). 다음 호출부터 재검사. */
export function setBackendBase(url) {
  try {
    if (url === null || url === undefined) localStorage.removeItem(BACKEND_URL_KEY)
    else localStorage.setItem(BACKEND_URL_KEY, String(url).trim())
  } catch { /* ignore */ }
  _backendAvailable = null
}

export async function checkBackend(force = false) {
  if (!force && _backendAvailable !== null) return _backendAvailable
  try {
    const res = await fetch(`${getBackendBase()}/api/health`, { signal: AbortSignal.timeout(2000) })
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

export async function exportViaPython(pages, defaultCanvasSize, { embedFonts = true } = {}) {
  // 임베딩 OFF면 폰트를 수집/전송하지 않음 → 서버가 다운로드·임베딩을 건너뛰고
  // 원본 family명으로 출력(파일 가벼움, 시스템 설치 폰트 의존).
  const fonts = embedFonts ? collectFontData(pages) : []
  const res = await fetch(`${getBackendBase()}/api/export/pptx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pages, defaultCanvasSize, fonts, embedFonts }),
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
