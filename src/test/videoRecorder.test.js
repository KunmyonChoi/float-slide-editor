import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 녹화기(videoRecorder) — 브라우저 API를 흉내 내서 '끝나지 않는 녹화'가 다시 생기지 않는지 본다.
// 실제 화면·인코더는 Playwright(Firefox·Chromium)로 확인했다. 여기서는 정지 경로와 정리만.

vi.mock('../store/flatStore', () => ({
  useFlatStore: { getState: () => ({ canvasSize: { w: 1280, h: 720 }, getExportBaseName: () => 'deck' }) },
}))

const { runVideoExport } = await import('../core/videoRecorder')
const { useEditorStore } = await import('../store/editorStore')
const { RECORDER_STOP_TIMEOUT_MS } = await import('../core/videoExport')

class FakeTrack extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.onended = null }
  stop() { this.readyState = 'ended' }
  getSettings() { return { width: 1280, height: 764 } } // Firefox: displaySurface 없음
}
class FakeStream {
  constructor(tracks = []) { this.tracks = tracks }
  getTracks() { return this.tracks }
  getVideoTracks() { return this.tracks.filter(t => t.kind === 'video') }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio') }
}

/**
 * Firefox 흉내: 'opus'가 든 형식으로 오디오 없는 스트림을 담으면 데이터도 stop 이벤트도 내지 않는다.
 * hang=true면 형식과 무관하게 stop 이벤트가 오지 않는다(인코더 멈춤).
 */
function makeRecorderClass({ hang = false } = {}) {
  return class FakeRecorder {
    static instances = []
    static isTypeSupported(m) { return m.startsWith('video/webm') && !/vp9/.test(m) }
    constructor(stream, opts) {
      this.stream = stream; this.mimeType = opts?.mimeType || 'video/webm'; this.state = 'inactive'
      FakeRecorder.instances.push(this)
    }
    get broken() {
      return hang || (/opus/.test(this.mimeType) && this.stream.getAudioTracks().length === 0)
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      if (this.broken) return
      this.ondataavailable?.({ data: new Blob(['x'.repeat(100)]) })
      setTimeout(() => this.onstop?.(), 0)
    }
  }
}

let videoTrack, downloads, stage

beforeEach(() => {
  vi.useFakeTimers()
  // 그리기 루프(매 프레임 잘라 그리기)는 여기서 보지 않는다 — 한 번만 돌게 막는다.
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  videoTrack = new FakeTrack('video')
  downloads = []
  navigator.mediaDevices = { getDisplayMedia: vi.fn(async () => new FakeStream([videoTrack])) }
  window.MediaStream = FakeStream
  window.MediaRecorder = makeRecorderClass()
  HTMLCanvasElement.prototype.captureStream = () => new FakeStream([new FakeTrack('video')])
  HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, drawImage() {} })
  HTMLMediaElement.prototype.play = function () { Object.defineProperty(this, 'videoWidth', { value: 1280, configurable: true }); return Promise.resolve() }
  HTMLMediaElement.prototype.pause = () => {}
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => {}
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloads.push(this.download) })
  stage = document.createElement('div')
  stage.setAttribute('data-present-stage', '')
  document.body.appendChild(stage)
  useEditorStore.setState({ videoRecording: null, mode: 'edit', iframeRef: null })
})

afterEach(() => {
  stage.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  useEditorStore.setState({ videoRecording: null, mode: 'edit' })
})

/** 녹화를 시작해 덱 재생(playing)까지 보낸다. 녹화 결과 프라미스를 { done }으로 돌려준다. */
async function startPlaying() {
  const done = runVideoExport({ resolution: '720p', fps: 30 })
  for (let i = 0; i < 100 && useEditorStore.getState().videoRecording?.phase !== 'playing'; i++) {
    await vi.advanceTimersByTimeAsync(50)
  }
  expect(useEditorStore.getState().videoRecording?.phase).toBe('playing')
  expect(useEditorStore.getState().mode).toBe('present')
  return { done }
}

describe('영상 녹화기 — 정지·저장·정리', () => {
  it('오디오 트랙이 없으면(Firefox) 오디오 코덱 없는 형식으로 담고, 덱 끝에서 저장하고 편집으로 돌아간다', async () => {
    const { done } = await startPlaying()
    expect(window.MediaRecorder.instances[0].mimeType).toBe('video/webm;codecs=vp8')
    useEditorStore.getState().updateVideoRecording({ phase: 'finished' })
    await vi.advanceTimersByTimeAsync(1000)
    const res = await done
    expect(res.ok).toBe(true)
    expect(res.noAudio).toBe(true)
    expect(res.stoppedEarly).toBe(false)
    expect(downloads).toEqual(['deck.webm'])
    expect(useEditorStore.getState().videoRecording).toBe(null)
    expect(useEditorStore.getState().mode).toBe('edit')
  })

  it('녹화기가 stop 이벤트를 끝내 보내지 않아도 Esc 한 번에 빠져나온다', async () => {
    window.MediaRecorder = makeRecorderClass({ hang: true })
    const { done } = await startPlaying()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(useEditorStore.getState().videoRecording?.phase).toBe('stopping')
    await vi.advanceTimersByTimeAsync(RECORDER_STOP_TIMEOUT_MS + 100)
    const res = await done
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy() // 담긴 게 없다는 안내 — 멈춰 있지 않고 결과를 돌려준다
    expect(useEditorStore.getState().videoRecording).toBe(null)
    expect(useEditorStore.getState().mode).toBe('edit')
  })

  it('전체 화면이 풀리면(브라우저가 Esc를 가져감) 정지하고 저장한다', async () => {
    const { done } = await startPlaying()
    document.dispatchEvent(new Event('fullscreenchange'))
    await vi.advanceTimersByTimeAsync(100)
    const res = await done
    expect(res.ok).toBe(true)
    expect(res.stoppedEarly).toBe(true)
    expect(downloads).toEqual(['deck.webm'])
    expect(useEditorStore.getState().mode).toBe('edit')
  })

  it('브라우저의 "공유 중지"(트랙 ended — onended만 불리는 경우 포함)도 정지하고 저장한다', async () => {
    const { done } = await startPlaying()
    videoTrack.onended()
    await vi.advanceTimersByTimeAsync(100)
    const res = await done
    expect(res.ok).toBe(true)
    expect(res.stoppedEarly).toBe(true)
    expect(useEditorStore.getState().mode).toBe('edit')
    expect(videoTrack.readyState).toBe('ended')
  })

  it('녹화가 끝나면 Esc 처리기를 떼어 낸다 — 다음 발표의 Esc를 가로채지 않는다', async () => {
    const { done } = await startPlaying()
    useEditorStore.getState().requestStopVideoRecording()
    await vi.advanceTimersByTimeAsync(100)
    await done
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })
})
