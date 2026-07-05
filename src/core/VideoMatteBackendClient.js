/**
 * VideoMatteBackendClient — 비디오 매팅 서버(float-matte, RVM) 클라이언트.
 *
 * CutoutBackendClient(이미지 BiRefNet) 미러. 절대 URL(기본 http://localhost:8325)로 직접 호출
 * (서버가 CORS 전체 허용 + Private Network Access 처리). 셀프 아바타 배경 제거 B2:
 * 영상 → 사람 전경만 남긴 **알파 WebM**(브라우저 투명 재생). 실시간 B1(MediaPipe)의 고품질·베이크판.
 * URL 오버라이드: localStorage['matte-backend-url'] > VITE_MATTE_BACKEND_URL > 기본.
 */
export const MATTE_DEFAULT_PORT = 8325
export const MATTE_DOCKER_IMAGE = 'dilly97/float-matte'
const MATTE_URL_KEY = 'matte-backend-url'

const GH_REPO = 'KunmyonChoi/float-slide-editor'
export const MATTE_DOWNLOADS = {
  mac: `https://github.com/${GH_REPO}/releases/latest/download/genitor-matte-mac.zip`,
  win: `https://github.com/${GH_REPO}/releases/latest/download/genitor-matte-win.zip`,
}

/** 사용자 OS 추정: 'mac' | 'win' | 'linux' | 'other'. */
export function detectMatteOS() {
  if (typeof navigator === 'undefined') return 'other'
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase()
  if (/mac|iphone|ipad|ipod/.test(p)) return 'mac'
  if (/win/.test(p)) return 'win'
  if (/linux|x11|android/.test(p)) return 'linux'
  return 'other'
}

/** GPU(NVIDIA 리눅스)는 `--gpus all` opt-in(없으면 자동 CPU). */
export function matteDockerRunCommand({ gpu = false } = {}) {
  const g = gpu ? '--gpus all ' : ''
  return `docker rm -f float-matte 2>/dev/null; docker run -d ${g}--pull=always --name float-matte -p ${MATTE_DEFAULT_PORT}:${MATTE_DEFAULT_PORT} ${MATTE_DOCKER_IMAGE}`
}

/** 백엔드 베이스 URL (localStorage > 빌드 env > 기본 localhost:8325). */
export function getMatteBase() {
  try {
    const o = localStorage.getItem(MATTE_URL_KEY)
    if (o !== null) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  const env = import.meta.env?.VITE_MATTE_BACKEND_URL
  if (env) return String(env).replace(/\/+$/, '')
  return `http://localhost:${MATTE_DEFAULT_PORT}`
}

/** 서버 준비 여부(헬스체크). @returns {Promise<{ok:boolean, info?:object, error?:string}>} */
export async function checkMatteHealth({ signal } = {}) {
  try {
    const res = await fetch(`${getMatteBase()}/api/health`, { signal })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const info = await res.json()
    return { ok: !!info.ready, info }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/**
 * 비디오 매팅 요청. 영상 Blob → 알파 WebM Blob.
 * @param {Blob} blob 로컬/업로드 영상(mp4/webm 등)
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ blob: Blob, url: string, ms: number, serverMs: number|null }>}
 */
export async function matteVideo(blob, { signal } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const fd = new FormData()
  fd.append('video', blob, 'input.mp4')
  const res = await fetch(`${getMatteBase()}/api/matte`, { method: 'POST', body: fd, signal })
  if (!res.ok) {
    let msg = `매팅 서버 오류 (${res.status})`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* 비 JSON */ }
    throw new Error(msg)
  }
  const out = await res.blob()
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)
  const serverMs = Number(res.headers.get('X-Inference-Ms')) || null
  return { blob: out, url: URL.createObjectURL(out), ms, serverMs }
}
