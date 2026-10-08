import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import {
  pickRecorderMime, videoOutputSize, captureCropRect, cropBounds, videoFileName,
  VIDEO_QUALITIES, RECORD_PAD_MS, RECORDER_STOP_TIMEOUT_MS, captureErrorMessage, isRecordStopKey,
  calibrationMarkers, findMarkers, solveCaptureMapping, scaleMapping, calibrationFailedMessage, CALIB_RING_CSS,
} from './videoExport'

/**
 * videoRecorder — 덱을 발표 화면으로 실시간 재생하면서 녹화해 영상 파일로 내려받는다.
 *
 *  1) getDisplayMedia로 "이 탭"을 공유받는다(탭 오디오 = 나레이션·BGM·요소 오디오가 한데 섞인 소리).
 *  2) 녹화 모드로 발표에 들어간다(editorStore.beginVideoRecording) — 엔진이 붙들고 있다가
 *  3) 슬라이드 영역([data-present-stage])이 뜨면 화면 네 귀퉁이에 색 표식을 잠깐 띄워 캡처 영상 속
 *     페이지의 자리·배율을 잰다(창·화면 공유, Firefox — 영상에 도구 막대·바탕화면이 함께 담긴다).
 *     그다음 캡처 영상을 숨은 <video>로 틀어 매 프레임
 *     그 영역만 잘라 출력 크기 캔버스에 그리고, canvas.captureStream + 탭 오디오를 MediaRecorder로 담는다.
 *  4) 0.5초 뒤 덱 재생(phase 'playing') → 엔진이 마지막 장을 마치면 'finished' → 0.5초 뒤 정지.
 *     정지 버튼·Esc('stopping')·전체 화면 해제·화면 공유 종료도 지금까지 담은 것을 저장하고 끝낸다.
 *
 * 브라우저 API 의존부라 단위 테스트 대신 실제 브라우저로 검증한다. 계산은 videoExport.js.
 */

const STAGE_SELECTOR = '[data-present-stage]'
const STAGE_WAIT_MS = 60000
// 표식을 찾는 데 쓰는 최대 시간 · 찾을 때 영상을 줄여 읽는 최대 폭(px)
const CALIBRATION_TIMEOUT_MS = 3000
const CALIB_SAMPLE_MAX_W = 1920
const isFirefox = () => typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent || '')

let active = false

/** 녹화가 진행 중인가(메뉴 중복 실행 방지) */
export function isVideoExportActive() { return active }

/** 이 브라우저에서 탭 녹화가 가능한가 — 불가하면 이유 문구, 가능하면 '' */
export function videoExportUnsupportedReason() {
  if (typeof window === 'undefined') return '브라우저에서만 녹화할 수 있습니다.'
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return '이 브라우저는 탭 화면 녹화(화면 공유)를 지원하지 않습니다. 데스크톱 Chrome·Edge에서 시도해 주세요. (모바일 브라우저는 지원하지 않습니다)'
  }
  if (typeof window.MediaRecorder === 'undefined') return '이 브라우저는 MediaRecorder(영상 녹화)를 지원하지 않습니다.'
  if (!HTMLCanvasElement.prototype.captureStream) return '이 브라우저는 캔버스 영상 캡처를 지원하지 않습니다.'
  return ''
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * 영상 내보내기 실행. 사용자 클릭(“녹화 시작”) 안에서 곧바로 불러야 화면 공유 창이 뜬다.
 * 예외를 던지지 않는다 — 결과 객체로 돌려준다.
 * @param {object} opts
 * @param {'canvas'|'1080p'|'720p'} opts.resolution
 * @param {number} opts.fps
 * @param {'normal'|'high'} opts.quality
 * @param {number} opts.startIndex  시작 슬라이드(0=처음)
 * @param {() => void} [opts.onShared] 화면 공유를 허락받았을 때 — 대화창을 닫는다(녹화 화면에 비치지 않게)
 * @returns {Promise<{ ok: boolean, error?: string, fileName?: string, noAudio?: boolean,
 *                     durationMs?: number, size?: number, stoppedEarly?: boolean,
 *                     captureSize?: {w,h}|null, outputSize?: {w,h} }>}
 */
export async function runVideoExport({ resolution = 'canvas', fps = 30, quality = 'normal', startIndex = 0, onShared } = {}) {
  if (active) return { ok: false, error: '이미 녹화 중입니다.' }
  const unsupported = videoExportUnsupportedReason()
  if (unsupported) return { ok: false, error: unsupported }

  active = true
  let stream = null
  try {
    // ── 1) 이 탭 공유 ──
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: { ideal: fps, max: fps }, cursor: 'never' },
        audio: {
          suppressLocalAudioPlayback: false, channelCount: { ideal: 2 },
          // 음악·나레이션을 통화용 처리(에코 제거·잡음 억제·자동 음량)로 뭉개지 않게 끈다
          echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'include',
      })
    } catch (err) {
      return { ok: false, error: captureErrorMessage(err) }
    }
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) return { ok: false, error: '화면 영상을 받지 못했습니다.' }
    // 'browser'(탭) · 'window' · 'monitor' — Firefox는 알려 주지 않는다(''). 창·화면 공유도 받는다:
    // 녹화 직전 보정으로 영상 속 페이지 자리를 잰다.
    const surface = videoTrack.getSettings?.().displaySurface || ''
    const audioTracks = stream.getAudioTracks()
    const noAudio = audioTracks.length === 0
    onShared?.()

    return await record({ videoTrack, audioTracks, noAudio, resolution, fps, quality, startIndex, surface })
  } catch (err) {
    console.error('[영상 내보내기] 실패:', err)
    return { ok: false, error: '영상 내보내기 실패: ' + (err?.message || String(err)) }
  } finally {
    stream?.getTracks().forEach(t => { try { t.stop() } catch { /* 무시 */ } })
    if (useEditorStore.getState().videoRecording || useEditorStore.getState().mode === 'present') {
      useEditorStore.getState().endVideoRecording()
    }
    active = false
  }
}

async function record({ videoTrack, audioTracks, noAudio, resolution, fps, quality, startIndex, surface }) {
  const es = useEditorStore.getState()
  const canvasSize = useFlatStore.getState().canvasSize || { w: 1280, h: 720 }
  const out = videoOutputSize(canvasSize, resolution)
  const bitrate = (VIDEO_QUALITIES.find(q => q.id === quality) || VIDEO_QUALITIES[0]).bitsPerSecond

  const cleanups = []
  const cleanup = () => { while (cleanups.length) { try { cleanups.pop()() } catch { /* 무시 */ } } }

  try {
    // ── 2) 녹화 모드 발표 진입 ──
    es.beginVideoRecording({ startIndex, noAudio })

    // 공유가 도중에 끊기면(브라우저의 "공유 중지") 지금까지 담은 것을 저장한다.
    const requestStop = () => useEditorStore.getState().requestStopVideoRecording()
    // onended도 함께 단다 — Firefox에서는 addEventListener('ended')로 단 처리기가 불리지 않는 경우가
    // 있었다(onended는 불린다). 정지 요청은 여러 번 와도 한 번만 처리된다.
    videoTrack.addEventListener('ended', requestStop)
    videoTrack.onended = requestStop
    cleanups.push(() => { videoTrack.removeEventListener('ended', requestStop); videoTrack.onended = null })
    cleanups.push(listenForStop(requestStop))

    // 캡처 영상을 숨은 <video>로 재생 — 매 프레임 여기서 잘라 그린다.
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([videoTrack])
    cleanups.push(() => { video.pause(); video.srcObject = null })
    await video.play().catch(() => {})
    await waitFor(() => video.videoWidth > 0, 10000)
    if (!video.videoWidth) return { ok: false, error: '화면 공유 영상을 받지 못했습니다.' }

    // 슬라이드 영역이 뜰 때까지(덱 로딩) 기다린다. 그사이 사용자가 멈추면 그만.
    const stageReady = await waitFor(
      () => document.querySelector(STAGE_SELECTOR) || isStopRequested(), STAGE_WAIT_MS)
    if (!stageReady || isStopRequested()) return { ok: false, error: stageReady ? '' : '발표 화면을 준비하지 못했습니다.' }
    // 레이아웃이 자리 잡고 캡처에 반영될 시간
    await sleep(150)

    // 영상 속 페이지 자리 재기. 탭 공유는 못 재도 '영상 = 페이지 뷰포트'로 갈 수 있지만, 창·화면 공유는
    // 못 재면 엉뚱한 곳을 담게 되므로 녹화하지 않는다.
    const calib = await calibrateCapture(video)
    if (isStopRequested()) return { ok: false, error: '' }
    if (!calib && surface !== 'browser') return { ok: false, error: calibrationFailedMessage(isFirefox()) }
    let mapping = calib?.map || null
    const geom = { vw: video.videoWidth, vh: video.videoHeight, iw: window.innerWidth, ih: window.innerHeight }
    let stopReason = ''
    // 표식을 걷어 낸 화면이 캡처에 반영될 시간
    await sleep(150)

    // ── 3) 잘라 그릴 캔버스 + 녹화기 ──
    const canvas = document.createElement('canvas')
    canvas.width = out.w
    canvas.height = out.h
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.w, out.h)

    // 슬라이드를 감싼 정수 픽셀 범위만 1:1로 옮겨 두는 중간 캔버스 — 영상에서 곧바로 늘려 그리면 보간이
    // 범위 바로 바깥(검정)까지 섞어 영상 가장자리에 어두운 줄이 생긴다. 캔버스 끝 바깥은 끝 픽셀이 되풀이된다.
    const crop1 = document.createElement('canvas')
    const ctx1 = crop1.getContext('2d', { alpha: false })

    let stageEl = null
    let raf = 0
    // 실제로 잘라 담은 슬라이드 크기(영상 픽셀) — 가장 작았던 값. 출력보다 작으면 결과 창에서 알린다.
    let captured = null
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!stageEl || !stageEl.isConnected) stageEl = document.querySelector(STAGE_SELECTOR)
      if (!stageEl || video.readyState < 2) return
      // 잰 뒤로 영상 크기나 창 크기가 바뀌면 그 대응은 더는 맞지 않는다. 탭 공유는 '영상 = 뷰포트'로
      // 이어 가고, 창·화면 공유는 엉뚱한 곳을 담기 전에 거기까지 저장하고 멈춘다.
      if (mapping && (video.videoWidth !== geom.vw || video.videoHeight !== geom.vh ||
          window.innerWidth !== geom.iw || window.innerHeight !== geom.ih)) {
        if (surface === 'browser') mapping = null
        else {
          if (!stopReason) { stopReason = 'resized'; useEditorStore.getState().requestStopVideoRecording() }
          return
        }
      }
      const crop = captureCropRect(
        stageEl.getBoundingClientRect(),
        { w: window.innerWidth, h: window.innerHeight },
        { w: video.videoWidth, h: video.videoHeight }, mapping)
      if (!crop) return
      if (!captured || crop.sw < captured.w) captured = { w: Math.round(crop.sw), h: Math.round(crop.sh) }
      const b = cropBounds(crop)
      if (crop1.width !== b.w || crop1.height !== b.h) { crop1.width = b.w; crop1.height = b.h }
      ctx1.drawImage(video, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h)
      ctx.drawImage(crop1, Math.max(0, crop.sx - b.x), Math.max(0, crop.sy - b.y),
        Math.min(crop.sw, b.w), Math.min(crop.sh, b.h), 0, 0, out.w, out.h)
    }
    draw()
    cleanups.push(() => cancelAnimationFrame(raf))

    const canvasStream = canvas.captureStream(fps)
    cleanups.push(() => canvasStream.getTracks().forEach(t => t.stop()))
    const recStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])

    // 오디오 트랙이 없으면 오디오 코덱 없는 형식으로 — Firefox는 'vp8,opus'로 영상만 담으면 멈춰 버린다.
    let mimeType = pickRecorderMime(t => window.MediaRecorder.isTypeSupported(t), { audio: audioTracks.length > 0 })
    const recOpts = {
      videoBitsPerSecond: bitrate,
      ...(noAudio ? {} : { audioBitsPerSecond: 192000 }),
    }
    let recorder
    try {
      recorder = new window.MediaRecorder(recStream, { ...(mimeType ? { mimeType } : {}), ...recOpts })
    } catch (err) {
      if (!mimeType) throw err
      // 지원한다던 형식을 막상 거절하는 브라우저 — 형식은 브라우저 기본값에 맡긴다.
      mimeType = ''
      recorder = new window.MediaRecorder(recStream, recOpts)
    }
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
    recorder.onerror = (e) => console.error('[영상 내보내기] 녹화기 오류:', e?.error || e)
    const stopped = new Promise(r => { recorder.onstop = r })
    cleanups.push(() => { if (recorder.state !== 'inactive') { try { recorder.stop() } catch { /* 무시 */ } } })
    recorder.start(1000)
    const startedAt = Date.now()
    useEditorStore.getState().updateVideoRecording({ startedAt })

    // ── 4) 여유 후 덱 재생 → 끝/정지를 기다린다 ──
    await sleep(RECORD_PAD_MS)
    if (!isStopRequested()) useEditorStore.getState().updateVideoRecording({ phase: 'playing' })
    const how = await waitForEnd()
    if (how === 'finished') await sleep(RECORD_PAD_MS)

    if (recorder.state !== 'inactive') {
      try { recorder.stop() } catch { /* 이미 멈춤 */ }
    }
    // stop 이벤트가 끝내 오지 않아도(인코더 멈춤) 받은 조각으로 저장하고 빠져나간다 — 녹화가 영영
    // 끝나지 않고 발표 화면에 갇히는 일이 없게.
    await Promise.race([stopped, sleep(RECORDER_STOP_TIMEOUT_MS)])
    const durationMs = Date.now() - startedAt
    const type = recorder.mimeType || mimeType || 'video/webm'
    const blob = new Blob(chunks, { type: type.split(';')[0] })
    if (!blob.size) return { ok: false, error: '녹화된 내용이 없습니다.' }

    const base = useFlatStore.getState().getExportBaseName?.() || ''
    const fileName = videoFileName(base, type)
    downloadBlob(blob, fileName)
    return {
      ok: true, fileName, noAudio, durationMs, size: blob.size, stoppedEarly: how !== 'finished',
      captureSize: captured, outputSize: out, stopReason, calibrated: !!calib,
    }
  } finally {
    cleanup()
  }
}

/**
 * 화면 네 귀퉁이에 색 표식을 띄우고, 캡처 영상에서 찾아 CSS px → 영상 px 대응을 잰다.
 * 표식은 검은 바탕 위에 띄운다(슬라이드에 같은 색이 있어도 헷갈리지 않게) — 녹화 시작 전이라 담기지 않는다.
 * @returns {Promise<{map: {sx,sy,ox,oy}} | null>} 못 재면 null
 */
async function calibrateCapture(video) {
  const viewport = { w: window.innerWidth, h: window.innerHeight }
  const markers = calibrationMarkers(viewport)
  const removeOverlay = showCalibrationOverlay(markers)
  try {
    const sample = document.createElement('canvas')
    const sctx = sample.getContext('2d', { willReadFrequently: true })
    if (!sctx?.getImageData) return null
    const until = Date.now() + CALIBRATION_TIMEOUT_MS
    await sleep(100) // 표식이 그려지고 캡처에 반영될 때까지
    while (Date.now() < until && !isStopRequested()) {
      await nextVideoFrame(video)
      const vw = video.videoWidth, vh = video.videoHeight
      if (vw > 0 && vh > 0) {
        const k = Math.min(1, CALIB_SAMPLE_MAX_W / vw)
        const sw = Math.max(1, Math.round(vw * k)), sh = Math.max(1, Math.round(vh * k))
        if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh }
        sctx.drawImage(video, 0, 0, sw, sh)
        const img = sctx.getImageData(0, 0, sw, sh)
        const { map } = solveCaptureMapping(markers, findMarkers(img, markers), { w: sw, h: sh }, viewport)
        if (map) return { map: scaleMapping(map, vw / sw, vh / sh) }
      }
      await sleep(60)
    }
    return null
  } catch (err) {
    console.warn('[영상 내보내기] 화면 위치 보정 실패:', err)
    return null
  } finally {
    removeOverlay()
  }
}

/** 보정 표식(검은 바탕 + 검은 테두리 두른 색 사각형 넷)을 페이지 맨 위에 띄운다. 반환 함수로 걷는다. */
function showCalibrationOverlay(markers) {
  const root = document.createElement('div')
  root.setAttribute('data-video-calibration', '')
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#000;pointer-events:none;'
  for (const m of markers) {
    const d = document.createElement('div')
    d.setAttribute('data-calib-marker', m.id)
    d.style.cssText = `position:absolute;left:${m.left - CALIB_RING_CSS}px;top:${m.top - CALIB_RING_CSS}px;` +
      `width:${m.size}px;height:${m.size}px;border:${CALIB_RING_CSS}px solid #000;box-sizing:content-box;` +
      `background:rgb(${m.color.join(',')});`
    root.appendChild(d)
  }
  document.body.appendChild(root)
  return () => root.remove()
}

/** 캡처 영상의 다음 프레임까지(requestVideoFrameCallback이 없으면 잠깐) 기다린다. */
function nextVideoFrame(video) {
  if (typeof video.requestVideoFrameCallback !== 'function') return sleep(50)
  return new Promise(resolve => {
    const t = setTimeout(resolve, 250) // 화면이 멈춰 프레임이 안 와도 계속 시도한다
    video.requestVideoFrameCallback(() => { clearTimeout(t); resolve() })
  })
}

/**
 * 녹화를 멈추라는 사용자 신호를 페이지 전체에서 받는다. 반환 함수로 해제.
 *  - Esc: 창의 캡처 단계에서 받는다 — 포커스가 어디 있든(대화창·편집 iframe·REC 표시줄 버튼),
 *    다른 단축키 처리기가 이벤트를 삼키기 전에. 편집 iframe 문서에도 단다(포커스가 남아 있을 수 있다).
 *  - 전체 화면 해제: 요소 전체 화면에서는 브라우저가 Esc를 가져가 전체 화면만 풀고 페이지에는 키를
 *    주지 않는다(Firefox·Chrome) — 녹화 중 전체 화면이 풀리면 Esc를 누른 것으로 본다.
 */
function listenForStop(requestStop) {
  const onKey = (e) => {
    if (!isRecordStopKey(e)) return
    e.preventDefault()
    e.stopPropagation()
    requestStop()
  }
  const onFullscreen = () => { if (!document.fullscreenElement) requestStop() }
  const iframeDoc = (() => {
    try { return useEditorStore.getState().iframeRef?.current?.contentDocument || null } catch { return null }
  })()
  window.addEventListener('keydown', onKey, true)
  iframeDoc?.addEventListener('keydown', onKey, true)
  document.addEventListener('fullscreenchange', onFullscreen)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    iframeDoc?.removeEventListener('keydown', onKey, true)
    document.removeEventListener('fullscreenchange', onFullscreen)
  }
}

function isStopRequested() {
  const rec = useEditorStore.getState().videoRecording
  return !rec || rec.phase === 'stopping'
}

/** 덱 끝('finished') 또는 정지 요청('stopping'·녹화 상태 사라짐)까지 기다린다. */
function waitForEnd() {
  return new Promise(resolve => {
    const check = (st) => {
      const rec = st.videoRecording
      if (!rec || rec.phase === 'stopping') return 'stopped'
      if (rec.phase === 'finished') return 'finished'
      return null
    }
    const now = check(useEditorStore.getState())
    if (now) { resolve(now); return }
    const unsub = useEditorStore.subscribe((st) => {
      const r = check(st)
      if (r) { unsub(); resolve(r) }
    })
  })
}

/** cond가 참이 될 때까지(최대 timeoutMs) 기다린다. 결과값을 돌려준다. */
async function waitFor(cond, timeoutMs) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = cond()
    if (v) return v
    if (Date.now() > until) return null
    await sleep(50)
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 다운로드가 시작되기 전에 회수하면 일부 브라우저에서 저장이 실패한다.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
