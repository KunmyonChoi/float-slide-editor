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

/**
 * 녹화 중 발표 화면 아래에 비워 두는 REC 표시줄 높이(CSS px) — 슬라이드는 그 위에만 맞춰 그린다.
 * (FlatPresenter와 녹화 전 예상 크기 계산이 같은 값을 써야 한다)
 */
export const REC_BAR_H = 44

/**
 * 지금 창에서 녹화하면 슬라이드가 화면에 실제로 그려질 크기(기기 픽셀). 녹화는 이 픽셀을 잘라
 * 담으므로 출력 크기보다 작으면 늘어나 흐려진다.
 * @param {{w:number,h:number}} canvasSize 덱 캔버스
 * @param {{w:number,h:number}} viewport   window.innerWidth/innerHeight (CSS px)
 * @param {number} dpr                      window.devicePixelRatio
 * @param {number} [barH]                   아래 REC 표시줄 높이
 * @returns {{w:number,h:number}}
 */
export function expectedStagePixels(canvasSize, viewport, dpr = 1, barH = REC_BAR_H) {
  const cw = Math.max(1, canvasSize?.w || 1280)
  const ch = Math.max(1, canvasSize?.h || 720)
  const vw = Math.max(0, viewport?.w || 0)
  const vh = Math.max(0, (viewport?.h || 0) - barH)
  const k = Math.min(vw / cw, vh / ch) * (dpr > 0 ? dpr : 1)
  return { w: Math.max(0, Math.round(cw * k)), h: Math.max(0, Math.round(ch * k)) }
}

/** 담긴 슬라이드 픽셀이 출력 크기보다 작아 늘려야 하는가(반올림 오차 2px은 무시) */
export function isUpscaled(stage, out) {
  if (!stage?.w || !stage?.h || !out?.w || !out?.h) return false
  return stage.w < out.w - 2 || stage.h < out.h - 2
}

/** 늘어나 흐릴 수 있다는 안내 문구(녹화 전) */
export function upscaleNotice(stage, out) {
  if (!isUpscaled(stage, out)) return ''
  return `지금 창에서는 슬라이드가 ${stage.w}×${stage.h}으로 보여 ${out.w}×${out.h}으로 늘어나 흐릴 수 있습니다 — 창을 최대화하거나 전체 화면(F11)으로 녹화하세요.`
}

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
 * 가장자리는 안쪽 온 픽셀로 맞추고, 그만큼 비율이 틀어지지 않게 한쪽을 가운데 기준으로 조금 더 깎는다.
 * 그래서 결과는 늘 정수 사각형 [floor(sx), ceil(sx+sw)) 안에 있다 — 녹화기는 그 정수 사각형을 먼저
 * 1:1로 옮겨 담은 뒤 늘리므로 보간이 사각형 바깥(검정)을 끌어오지 않는다(cropBounds).
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
  const aspect = (x1 - x0) / (y1 - y0)
  x0 = Math.max(0, Math.min(video.w, x0))
  y0 = Math.max(0, Math.min(video.h, y0))
  x1 = Math.max(0, Math.min(video.w, x1))
  y1 = Math.max(0, Math.min(video.h, y1))
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  // 슬라이드 가장자리가 픽셀 중간에 걸리면(예: 세로 덱의 left 559.25px) 그 가장자리 픽셀은 슬라이드와
  // 바깥 검정이 섞인 색이라, 늘려 담으면 영상 테두리에 어두운 줄이 생긴다 — 안쪽 온 픽셀로 맞춘다.
  const ix0 = Math.max(0, Math.ceil(x0 - SNAP_EPS))
  const iy0 = Math.max(0, Math.ceil(y0 - SNAP_EPS))
  const ix1 = Math.min(video.w, Math.floor(x1 + SNAP_EPS))
  const iy1 = Math.min(video.h, Math.floor(y1 + SNAP_EPS))
  if (ix1 - ix0 >= 1 && iy1 - iy0 >= 1) { x0 = ix0; y0 = iy0; x1 = ix1; y1 = iy1 }
  let sx = x0
  let sy = y0
  let sw = x1 - x0
  let sh = y1 - y0
  // 맞추느라 깎인 만큼 비율이 틀어지지 않게, 남는 쪽을 가운데 기준으로 조금 더 깎는다(슬라이드 안쪽이라 섞임 없음).
  // (부동소수 수준의 차이는 그대로 둔다)
  if (aspect > 0 && Number.isFinite(aspect) && Math.abs(sw / sh / aspect - 1) > 1e-6) {
    if (sw / sh > aspect) { const w = sh * aspect; sx += (sw - w) / 2; sw = w }
    else { const h = sw / aspect; sy += (sh - h) / 2; sh = h }
  }
  return { sx, sy, sw, sh }
}

/**
 * captureCropRect 결과를 감싸는 정수 픽셀 사각형 — 이 범위만 1:1로 먼저 옮겨 담으면, 늘릴 때의 보간이
 * 범위 밖 픽셀을 섞지 못한다(가장자리 픽셀이 되풀이될 뿐).
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function cropBounds(crop) {
  const x = Math.floor(crop.sx + SNAP_EPS)
  const y = Math.floor(crop.sy + SNAP_EPS)
  const w = Math.max(1, Math.ceil(crop.sx + crop.sw - SNAP_EPS) - x)
  const h = Math.max(1, Math.ceil(crop.sy + crop.sh - SNAP_EPS) - y)
  return { x, y, w, h }
}

/** 부동소수 오차(856.0000001 등)를 정수로 보는 여유 */
const SNAP_EPS = 0.01

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
