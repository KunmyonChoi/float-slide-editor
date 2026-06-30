/**
 * ImagenBackendClient — Ideogram 4 레이아웃 이미지 생성 서버(float-imgen) 클라이언트.
 *
 * CutoutBackendClient와 동일 패턴: /api 프록시 충돌 회피 위해 **절대 URL(기본 http://localhost:8323)**
 * 로 직접 호출(서버가 CORS 전체 허용 + Private Network Access 처리). dev/prod 동일.
 * URL 오버라이드: localStorage['imagen-backend-url'] > VITE_IMAGEN_BACKEND_URL > 기본
 * → 원격(사내 GPU/RunPod 프록시) 엔드포인트로 전환 가능.
 */
export const IMAGEN_DEFAULT_PORT = 8323
export const IMAGEN_DOCKER_IMAGE = 'dilly97/float-imgen'
const IMAGEN_URL_KEY = 'imagen-backend-url'

/**
 * Docker 실행 명령(NVIDIA 40GB+ GPU 필수, 게이트 모델→HF 토큰 + 캐시 볼륨).
 * @param {{ hfToken?: string }} [opts]
 */
export function imagenDockerRunCommand({ hfToken = 'hf_xxxxxxxx' } = {}) {
  const P = IMAGEN_DEFAULT_PORT
  return `docker rm -f float-imgen 2>/dev/null; docker run -d --gpus all --pull=always --name float-imgen -p ${P}:${P} -e HF_TOKEN=${hfToken} -v "$HOME/.cache/huggingface:/app/.hf-cache" ${IMAGEN_DOCKER_IMAGE}`
}

/** 백엔드 베이스 URL (localStorage > 빌드 env > 기본 localhost:8323). */
export function getImagenBase() {
  try {
    const o = localStorage.getItem(IMAGEN_URL_KEY)
    if (o !== null) return o.replace(/\/+$/, '')
  } catch { /* ignore */ }
  const env = import.meta.env?.VITE_IMAGEN_BACKEND_URL
  if (env) return String(env).replace(/\/+$/, '')
  return `http://localhost:${IMAGEN_DEFAULT_PORT}`
}

/** 백엔드 URL 런타임 설정(빈/누락=기본 복귀). 다음 호출부터 재검사. */
export function setImagenBase(url) {
  try {
    if (url === null || url === undefined || url === '') localStorage.removeItem(IMAGEN_URL_KEY)
    else localStorage.setItem(IMAGEN_URL_KEY, String(url).trim())
  } catch { /* ignore */ }
  _available = null
}

let _available = null
let _build = null
let _device = null
let _presets = null
let _ready = false

export function getImagenBuild() { return _build }
export function getImagenDevice() { return _device }
export function getImagenPresets() { return _presets }
export function isImagenReady() { return _ready }

/** 헬스체크. 결과 캐시(force로 재검사). 빌드/디바이스/프리셋/ready도 기록. */
export async function checkImagenBackend(force = false) {
  if (!force && _available !== null) return _available
  try {
    const res = await fetch(`${getImagenBase()}/api/health`, { signal: AbortSignal.timeout(2000) })
    _available = res.ok
    if (res.ok) {
      try {
        const j = await res.json()
        _build = j.build || null
        _device = j.device || null
        _presets = Array.isArray(j.presets) ? j.presets : null
        _ready = j.ready === true
      } catch { _build = null; _device = null; _presets = null; _ready = false }
    }
  } catch {
    _available = false; _build = null; _device = null; _presets = null; _ready = false
  }
  return _available
}

/**
 * 레이아웃 이미지 생성. caption 객체(ideogramCaption.buildCaption) → PNG Blob.
 * @param {object} caption  Ideogram 4 JSON 캡션
 * @param {{ width?:number, height?:number, preset?:string, seed?:number, signal?:AbortSignal }} [opts]
 * @returns {Promise<{ blob: Blob, url: string, ms: number, serverMs: number|null }>}
 */
export async function generateLayoutImage(caption, { width = 1024, height = 1024, preset, seed = 0, signal } = {}) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0)
  const body = JSON.stringify({ caption, width, height, ...(preset ? { preset } : {}), seed })
  const res = await fetch(`${getImagenBase()}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal,
  })
  if (!res.ok) {
    let msg = `이미지 생성 서버 오류 (${res.status})`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* 비 JSON 응답 */ }
    throw new Error(msg)
  }
  // 모델 내장 안전필터에 막혔으면(재시도 후에도) 회색 카드 대신 에러로 — 인물 등 오탐 잦음
  if (res.headers.get('X-Safety-Blocked') === 'true') {
    throw new Error('모델 안전 필터에 막혔습니다(오탐 가능). 문구를 바꾸거나 다시 시도해 주세요.')
  }
  const out = await res.blob()
  const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)
  const serverMs = Number(res.headers.get('X-Inference-Ms')) || null // 순수 추론 시간(서버)
  return { blob: out, url: URL.createObjectURL(out), ms, serverMs }
}
