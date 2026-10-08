/**
 * videoExport — 덱 → 영상 내보내기의 순수 계산부(브라우저 API 없음, 단위 테스트 대상).
 *
 * 실제 녹화(videoRecorder.js)는 발표 화면을 실시간으로 재생하면서 "이 탭" 화면 공유를 받아
 * 슬라이드 영역만 잘라 캔버스에 다시 그리고, 그 캔버스 + 탭 오디오를 MediaRecorder로 담는다.
 * 여기에는 그 과정의 숫자 계산(출력 크기·잘라낼 사각형·코덱 선택·파일 이름)만 모았다.
 */

/** 해상도 선택지 — canvas: 덱 캔버스 크기 그대로 · 1080p/720p: 짧은 변 기준(비율 유지) */
export const VIDEO_RESOLUTIONS = [
  { id: 'canvas', label: '원본 캔버스 크기' },
  { id: '1080p', label: '1080p', shortSide: 1080 },
  { id: '720p', label: '720p', shortSide: 720 },
]

export const VIDEO_FPS = [30, 60]

/** 화질(비트레이트) 선택지 */
export const VIDEO_QUALITIES = [
  { id: 'normal', label: '보통', bitsPerSecond: 8_000_000, hint: '8 Mbps' },
  { id: 'high', label: '높음', bitsPerSecond: 16_000_000, hint: '16 Mbps' },
]

/** 녹화를 시작한 뒤 첫 장을 틀기 전·마지막 장이 끝난 뒤 녹화를 멈추기 전 여유(ms) */
export const RECORD_PAD_MS = 500

/** MediaRecorder에 차례로 물어볼 형식 — MP4(H.264/AAC)가 되면 그것, 아니면 WebM. */
export const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
]

/**
 * 브라우저가 녹화할 수 있는 첫 형식.
 * @param {(mime: string) => boolean} isTypeSupported  보통 MediaRecorder.isTypeSupported
 * @returns {string} 지원하는 것이 없으면 '' (브라우저 기본값에 맡긴다)
 */
export function pickRecorderMime(isTypeSupported) {
  if (typeof isTypeSupported !== 'function') return ''
  for (const m of VIDEO_MIME_CANDIDATES) {
    try { if (isTypeSupported(m)) return m } catch { /* 다음 후보 */ }
  }
  return ''
}

/** 녹화 형식 → 파일 확장자 */
export function videoExtension(mime) {
  return /mp4/i.test(mime || '') ? 'mp4' : 'webm'
}

/** 짝수로 — H.264 인코더는 홀수 크기를 받지 않는다(4:2:0 크로마). */
function even(n) {
  return Math.max(2, Math.round(n / 2) * 2)
}

/**
 * 출력 영상 크기. 덱 캔버스의 비율(16:9·9:16·4:5·1:1…)을 그대로 지킨다.
 * @param {{w:number,h:number}} canvasSize
 * @param {'canvas'|'1080p'|'720p'} resolution
 * @returns {{w:number,h:number}}
 */
export function videoOutputSize(canvasSize, resolution = 'canvas') {
  const cw = Math.max(1, canvasSize?.w || 1280)
  const ch = Math.max(1, canvasSize?.h || 720)
  const preset = VIDEO_RESOLUTIONS.find(r => r.id === resolution)
  if (!preset?.shortSide) return { w: even(cw), h: even(ch) }
  const k = preset.shortSide / Math.min(cw, ch)
  return { w: even(cw * k), h: even(ch * k) }
}

/**
 * 화면 공유 프레임에서 잘라낼 슬라이드 사각형(영상 픽셀 단위).
 * 탭 캡처 프레임은 CSS 뷰포트를 기기 배율만큼 키운(또는 줄인) 그림이므로
 * 슬라이드의 getBoundingClientRect(CSS px)에 videoWidth / innerWidth 배율을 곱한다.
 * 프레임 밖으로 나간 부분은 잘라낸다(drawImage가 범위 밖을 받지 않는 브라우저가 있다).
 *
 * @param {{left:number, top:number, width:number, height:number}} stageRect  CSS px
 * @param {{w:number,h:number}} viewport  window.innerWidth/innerHeight
 * @param {{w:number,h:number}} video     videoWidth/videoHeight
 * @returns {{sx:number, sy:number, sw:number, sh:number} | null}  그릴 수 없으면 null
 */
export function captureCropRect(stageRect, viewport, video) {
  if (!stageRect || !viewport?.w || !viewport?.h || !video?.w || !video?.h) return null
  const kx = video.w / viewport.w
  const ky = video.h / viewport.h
  let x0 = stageRect.left * kx
  let y0 = stageRect.top * ky
  let x1 = (stageRect.left + stageRect.width) * kx
  let y1 = (stageRect.top + stageRect.height) * ky
  x0 = Math.max(0, Math.min(video.w, x0))
  y0 = Math.max(0, Math.min(video.h, y0))
  x1 = Math.max(0, Math.min(video.w, x1))
  y1 = Math.max(0, Math.min(video.h, y1))
  const sw = x1 - x0
  const sh = y1 - y0
  if (sw < 1 || sh < 1) return null
  return { sx: x0, sy: y0, sw, sh }
}

/** 저장 파일 이름 — 프로젝트/원본 이름(없으면 slide-export) + 확장자 */
export function videoFileName(baseName, mime) {
  let n = (baseName || '').trim().replace(/[\\/:*?"<>|]/g, '').trim()
  if (!n) n = 'slide-export'
  return `${n}.${videoExtension(mime)}`
}

/** 경과 시간 표시 — 0:07 · 12:34 · 1:02:03 */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** getDisplayMedia 실패 → 사용자에게 보여 줄 문구 */
export function captureErrorMessage(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'AbortError') return '화면 공유가 취소되었거나 허용되지 않았습니다. 다시 시도하면서 "이 탭"을 공유해 주세요.'
  if (name === 'NotFoundError') return '공유할 화면을 찾지 못했습니다.'
  if (name === 'NotReadableError') return '화면을 캡처하지 못했습니다. 다른 프로그램이 화면을 쓰고 있는지 확인해 주세요.'
  if (name === 'NotSupportedError' || name === 'TypeError') return '이 브라우저는 탭 화면 녹화를 지원하지 않습니다. 데스크톱 Chrome·Edge에서 시도해 주세요.'
  return '영상 녹화를 시작하지 못했습니다: ' + (err?.message || String(err))
}
