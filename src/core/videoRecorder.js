import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import {
  pickRecorderMime, videoOutputSize, captureCropRect, videoFileName,
  VIDEO_QUALITIES, RECORD_PAD_MS, captureErrorMessage,
} from './videoExport'

/**
 * videoRecorder — 덱을 발표 화면으로 실시간 재생하면서 녹화해 영상 파일로 내려받는다.
 *
 *  1) getDisplayMedia로 "이 탭"을 공유받는다(탭 오디오 = 나레이션·BGM·요소 오디오가 한데 섞인 소리).
 *  2) 녹화 모드로 발표에 들어간다(editorStore.beginVideoRecording) — 엔진이 붙들고 있다가
 *  3) 슬라이드 영역([data-present-stage])이 뜨면 캡처 영상을 숨은 <video>로 틀어 매 프레임
 *     그 영역만 잘라 출력 크기 캔버스에 그리고, canvas.captureStream + 탭 오디오를 MediaRecorder로 담는다.
 *  4) 0.5초 뒤 덱 재생(phase 'playing') → 엔진이 마지막 장을 마치면 'finished' → 0.5초 뒤 정지.
 *     정지 버튼·Esc('stopping')·화면 공유 종료도 지금까지 담은 것을 저장하고 끝낸다.
 *
 * 브라우저 API 의존부라 단위 테스트 대신 실제 브라우저로 검증한다. 계산은 videoExport.js.
 */

const STAGE_SELECTOR = '[data-present-stage]'
const STAGE_WAIT_MS = 60000

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
 *                     durationMs?: number, size?: number, stoppedEarly?: boolean }>}
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
    const surface = videoTrack.getSettings?.().displaySurface
    if (surface && surface !== 'browser') {
      return { ok: false, error: '창이나 전체 화면이 아니라 "이 탭"을 공유해야 슬라이드만 잘라 녹화할 수 있습니다.' }
    }
    const audioTracks = stream.getAudioTracks()
    const noAudio = audioTracks.length === 0
    onShared?.()

    return await record({ videoTrack, audioTracks, noAudio, resolution, fps, quality, startIndex })
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

async function record({ videoTrack, audioTracks, noAudio, resolution, fps, quality, startIndex }) {
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
    const onTrackEnded = () => useEditorStore.getState().requestStopVideoRecording()
    videoTrack.addEventListener('ended', onTrackEnded)
    cleanups.push(() => videoTrack.removeEventListener('ended', onTrackEnded))

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

    // ── 3) 잘라 그릴 캔버스 + 녹화기 ──
    const canvas = document.createElement('canvas')
    canvas.width = out.w
    canvas.height = out.h
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.w, out.h)

    let stageEl = null
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      if (!stageEl || !stageEl.isConnected) stageEl = document.querySelector(STAGE_SELECTOR)
      if (!stageEl || video.readyState < 2) return
      const crop = captureCropRect(
        stageEl.getBoundingClientRect(),
        { w: window.innerWidth, h: window.innerHeight },
        { w: video.videoWidth, h: video.videoHeight })
      if (!crop) return
      ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, out.w, out.h)
    }
    draw()
    cleanups.push(() => cancelAnimationFrame(raf))

    const canvasStream = canvas.captureStream(fps)
    cleanups.push(() => canvasStream.getTracks().forEach(t => t.stop()))
    const recStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])

    const mimeType = pickRecorderMime(t => window.MediaRecorder.isTypeSupported(t))
    const recorder = new window.MediaRecorder(recStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: bitrate,
      ...(noAudio ? {} : { audioBitsPerSecond: 192000 }),
    })
    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
    const stopped = new Promise(r => { recorder.onstop = r })
    recorder.start(1000)
    const startedAt = Date.now()
    useEditorStore.getState().updateVideoRecording({ startedAt })

    // ── 4) 여유 후 덱 재생 → 끝/정지를 기다린다 ──
    await sleep(RECORD_PAD_MS)
    if (!isStopRequested()) useEditorStore.getState().updateVideoRecording({ phase: 'playing' })
    const how = await waitForEnd()
    if (how === 'finished') await sleep(RECORD_PAD_MS)

    if (recorder.state !== 'inactive') recorder.stop()
    await stopped
    const durationMs = Date.now() - startedAt
    const type = recorder.mimeType || mimeType || 'video/webm'
    const blob = new Blob(chunks, { type: type.split(';')[0] })
    if (!blob.size) return { ok: false, error: '녹화된 내용이 없습니다.' }

    const base = useFlatStore.getState().getExportBaseName?.() || ''
    const fileName = videoFileName(base, type)
    downloadBlob(blob, fileName)
    return { ok: true, fileName, noAudio, durationMs, size: blob.size, stoppedEarly: how !== 'finished' }
  } finally {
    cleanup()
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
