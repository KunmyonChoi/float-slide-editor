/**
 * CutoutBackendClient — 피사체 분리 서버(float-cutout) 클라이언트.
 *
 * pptx-server와 달리 /api 프록시 충돌을 피해 **절대 URL(기본 http://localhost:8322)** 로 직접 호출한다
 * (서버가 CORS 전체 허용 + Private Network Access 처리). dev/prod 동일.
 * URL 오버라이드: localStorage['cutout-backend-url'] > VITE_CUTOUT_BACKEND_URL > 기본.
 */
export const CUTOUT_DEFAULT_PORT = 8322
export const CUTOUT_DOCKER_IMAGE = 'dilly97/float-cutout'
const CUTOUT_URL_KEY = 'cutout-backend-url'

/** `docker run` 안내 명령 (UI 힌트용) — GPU + 최신 pull + 기존 교체 + 백그라운드 */
export function cutoutDockerRunCommand() {
  return `docker rm -f float-cutout 2>/dev/null; docker run -d --gpus all --pull=always --name float-cutout -p ${CUTOUT_DEFAULT_PORT}:${CUTOUT_DEFAULT_PORT} ${CUTOUT_DOCKER_IMAGE}`
}

/** 백엔드 베이스 URL (localStorage > 빌드 env > 기본 localhost:8322). */
export function getCutoutBase() {
  try {
    const o = localStorage.getItem(CUTOUT_URL_KEY)
    if (o !== null) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  const env = import.meta.env?.VITE_CUTOUT_BACKEND_URL
  if (env) return String(env).replace(/\/+$/, '')
  return `http://localhost:${CUTOUT_DEFAULT_PORT}`
}

/** 백엔드 URL 런타임 설정(빈/누락=기본 복귀). 다음 호출부터 재검사. */
export function setCutoutBase(url) {
  try {
    if (url === null || url === undefined || url === '') localStorage.removeItem(CUTOUT_URL_KEY)
    else localStorage.setItem(CUTOUT_URL_KEY, String(url).trim())
  } catch { /* ignore */ }
  _available = null
}

let _available = null
let _build = null
let _device = null

export function getCutoutBuild() { return _build }
export function getCutoutDevice() { return _device }

/** 헬스체크. 결과 캐시(force로 재검사). 빌드/디바이스도 기록. */
export async function checkCutoutBackend(force = false) {
  if (!force && _available !== null) return _available
  try {
    const res = await fetch(`${getCutoutBase()}/api/health`, { signal: AbortSignal.timeout(2000) })
    _available = res.ok
    if (res.ok) {
      try {
        const j = await res.json()
        _build = j.build || null
        _device = j.device || null
      } catch { _build = null; _device = null }
    }
  } catch {
    _available = false; _build = null; _device = null
  }
  return _available
}

/**
 * 전경 분리 요청. 이미지 Blob → 알파 PNG Blob.
 * @param {Blob} blob
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ blob: Blob, url: string, ms: number }>}
 */
export async function segmentImage(blob, { signal } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const fd = new FormData()
  fd.append('image', blob, 'input.png')
  const res = await fetch(`${getCutoutBase()}/api/segment`, { method: 'POST', body: fd, signal })
  if (!res.ok) {
    let msg = `분리 서버 오류 (${res.status})`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* 비 JSON 응답 */ }
    throw new Error(msg)
  }
  const out = await res.blob()
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)
  return { blob: out, url: URL.createObjectURL(out), ms }
}
