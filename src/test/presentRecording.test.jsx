import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// 영상 내보내기 녹화 모드 — 발표 엔진이 사람 없이 끝까지 흘려보내고 '덱 끝'을 알리는지.
const CANVAS = { w: 1280, h: 720 }
const anim = (seq) => ({ effect: 'fadeIn', durationMs: 400, delayMs: 0, trigger: { mode: 'click' }, seq })
const twoSteps = [{ id: 'a', type: 'text', anim: anim(0) }, { id: 'b', type: 'text', anim: anim(1) }]
const page = (over = {}) => ({ canvasSize: CANVAS, elements: [], ...over })

let deck = {}

vi.mock('../store/flatStore', () => ({
  useFlatStore: {
    getState: () => ({
      _preloading: false,
      getAllPagesAsync: async () => ({ pages: deck }),
      setPageNotesCaptions: () => {},
    }),
  },
}))

const { usePresentationEngine, LOOP_DWELL_MS } = await import('../core/usePresentationEngine')
const { useEditorStore } = await import('../store/editorStore')

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const phase = () => useEditorStore.getState().videoRecording?.phase

async function startRecordingEngine(startIndex = 0) {
  useEditorStore.setState({
    presentStartIndex: startIndex,
    videoRecording: { phase: 'preparing', startIndex, startedAt: 0, noAudio: false },
  })
  const rendered = renderHook(() => usePresentationEngine())
  for (let i = 0; i < 20 && rendered.result.current.deckLoading; i++) {
    await tick(10)
  }
  expect(rendered.result.current.deckLoading).toBe(false)
  return rendered
}

describe('영상 녹화 모드 발표', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useEditorStore.getState().setLoopPresentation(false)
    useEditorStore.getState().setAutoBuild(false)
    useEditorStore.getState().setAutoAdvance(false)
  })
  afterEach(() => {
    vi.useRealTimers()
    useEditorStore.setState({ videoRecording: null, presentStartIndex: 0 })
    useEditorStore.getState().setLoopPresentation(false)
  })

  it('녹화가 시작되기 전(preparing)에는 덱을 틀지 않는다', async () => {
    deck = { '0-0': page({ elements: twoSteps }), '1-0': page() }
    const { result } = await startRecordingEngine()
    expect(result.current.recording).toBe(true)
    expect(result.current.recordHold).toBe(true)
    expect(result.current.loading).toBe(true)
    await tick(LOOP_DWELL_MS + 5000)
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.revealed).toBe(0)
  })

  it('재생이 시작되면 빌드를 자동으로 흘리고, 음성 없는 장은 머무는 시간 뒤 넘긴다 — 끝에서 finished', async () => {
    deck = { '0-0': page({ elements: twoSteps }), '1-0': page() }
    const { result } = await startRecordingEngine()
    act(() => useEditorStore.getState().updateVideoRecording({ phase: 'playing' }))
    expect(result.current.loading).toBe(false)

    await tick(1500) // 300+400+300+400 — 두 단계가 다 나온다
    expect(result.current.revealed).toBe(2)
    expect(result.current.currentSlide).toBe(0)

    await tick(LOOP_DWELL_MS)
    expect(result.current.currentSlide).toBe(1)
    expect(phase()).toBe('playing')

    await tick(LOOP_DWELL_MS + 100)
    expect(result.current.currentSlide).toBe(1) // 루프처럼 처음으로 돌아가지 않는다
    expect(phase()).toBe('finished')
  })

  it('루프 설정이 켜져 있어도 녹화 중에는 되감지 않는다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page() }
    const { result } = await startRecordingEngine()
    act(() => useEditorStore.getState().updateVideoRecording({ phase: 'playing' }))
    await tick(LOOP_DWELL_MS + 100)
    expect(result.current.currentSlide).toBe(0)
    expect(phase()).toBe('finished')
  })

  it('시간 지정 장은 그 시간에 넘긴다', async () => {
    deck = { '0-0': page({ advance: { mode: 'time', seconds: 2 } }), '1-0': page({ advance: { mode: 'time', seconds: 2 } }) }
    const { result } = await startRecordingEngine()
    act(() => useEditorStore.getState().updateVideoRecording({ phase: 'playing' }))
    await tick(2050)
    expect(result.current.currentSlide).toBe(1)
    await tick(2050)
    expect(phase()).toBe('finished')
  })

  it('클릭 장은 녹화를 멈춰 세우지 않는다 — 시간 기본값(10초)으로 넘긴다', async () => {
    deck = { '0-0': page({ advance: { mode: 'click' } }), '1-0': page() }
    const { result } = await startRecordingEngine()
    act(() => useEditorStore.getState().updateVideoRecording({ phase: 'playing' }))
    expect(result.current.advanceMode).toBe('time')
    await tick(9900)
    expect(result.current.currentSlide).toBe(0)
    await tick(200)
    expect(result.current.currentSlide).toBe(1)
  })

  it('나레이션 장은 음성이 끝나면 넘기고, 현재 장부터 시작할 수 있다', async () => {
    deck = { '0-0': page(), '1-0': page({ notesAudio: 'idb://voice' }), '2-0': page() }
    const { result } = await startRecordingEngine(1)
    expect(result.current.currentSlide).toBe(1)
    act(() => useEditorStore.getState().updateVideoRecording({ phase: 'playing' }))
    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(2)
  })

  it('Esc는 녹화 정지(onExit)만 부르고, 다른 단축키는 무시한다', async () => {
    deck = { '0-0': page(), '1-0': page() }
    const onExit = vi.fn()
    useEditorStore.setState({ presentStartIndex: 0, videoRecording: { phase: 'playing', startIndex: 0, startedAt: 1 } })
    const { result } = renderHook(() => usePresentationEngine({ onExit }))
    for (let i = 0; i < 20 && result.current.loading; i++) await tick(10)
    const ev = (key, code) => ({ key, code: code || '', preventDefault: () => {} })
    act(() => result.current.handleKeyDown(ev('ArrowRight')))
    act(() => result.current.handleKeyDown(ev('p', 'KeyP')))
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.penActive).toBe(false)
    act(() => result.current.handleKeyDown(ev('Escape')))
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
