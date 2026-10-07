import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// 발표 엔진이 flatStore에서 꺼내 갈 덱 — 테스트마다 갈아 끼운다.
const CANVAS = { w: 1280, h: 720 }
const vid = (over = {}) => ({ id: 'v1', type: 'video', content: 'idb://clip', ...over })
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
const { reportMediaEnded, reportMediaFailed } = await import('../core/mediaAdvance')

async function startEngine() {
  const rendered = renderHook(() => usePresentationEngine())
  for (let i = 0; i < 20 && rendered.result.current.loading; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  }
  expect(rendered.result.current.loading).toBe(false)
  return rendered
}
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('미디어가 끝날 때까지 기다린 뒤 다음 슬라이드', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useEditorStore.getState().setLoopPresentation(false)
    useEditorStore.getState().setAutoBuild(false)
    useEditorStore.getState().setAutoAdvance(true)
    useEditorStore.setState({ presentStartIndex: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    useEditorStore.getState().setAutoAdvance(false)
    useEditorStore.getState().setLoopPresentation(false)
  })

  it('나레이션이 먼저 끝나도 영상이 끝나야 넘어간다', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', elements: [vid({ advanceOnEnd: true })] }), '1-0': page() }
    const { result } = await startEngine()
    expect(result.current.advanceMode).toBe('all')

    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.waitMediaPending).toBe(1)

    act(() => reportMediaEnded('v1'))
    expect(result.current.currentSlide).toBe(1)
  })

  it('영상이 먼저 끝나면 나레이션을 기다린다', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', elements: [vid({ advanceOnEnd: true })] }), '1-0': page() }
    const { result } = await startEngine()

    act(() => reportMediaEnded('v1'))
    expect(result.current.currentSlide).toBe(0)
    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)
  })

  it('옵션 없는 영상은 기다리지 않는다 — 예전처럼 나레이션 끝에 넘어간다', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', elements: [vid()] }), '1-0': page() }
    const { result } = await startEngine()
    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)
  })

  it('자동 진행이 꺼져 있으면 미디어가 끝나도 그대로', async () => {
    useEditorStore.getState().setAutoAdvance(false)
    deck = { '0-0': page({ elements: [vid({ advanceOnEnd: true })] }), '1-0': page() }
    const { result } = await startEngine()
    act(() => reportMediaEnded('v1'))
    expect(result.current.currentSlide).toBe(0)
  })

  it('나레이션 없는 음악 장 — 루프의 머무는 시간에 끊기지 않고 곡이 끝나면 넘어간다', async () => {
    useEditorStore.getState().setAutoAdvance(false)
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page({ elements: [{ id: 'm', type: 'audio', content: 'idb://song', advanceOnEnd: true }] }), '1-0': page() }
    const { result } = await startEngine()

    await tick(LOOP_DWELL_MS + 2000)
    expect(result.current.currentSlide).toBe(0)
    act(() => reportMediaEnded('m'))
    expect(result.current.currentSlide).toBe(1)
  })

  it('미디어가 재생되지 못하면(루프) 머무는 시간 뒤에 넘어간다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page({ elements: [vid({ advanceOnEnd: true })] }), '1-0': page() }
    const { result } = await startEngine()

    act(() => reportMediaFailed('v1'))
    expect(result.current.currentSlide).toBe(0)
    await tick(LOOP_DWELL_MS + 200)
    expect(result.current.currentSlide).toBe(1)
  })

  it('루프로 같은 장에 다시 오면 다시 기다린다 — 지난 회차의 끝남 신호를 쓰지 않는다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page({ elements: [vid({ advanceOnEnd: true })] }) }
    const { result } = await startEngine()

    act(() => reportMediaEnded('v1'))
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.waitMediaPending).toBe(1) // 되감긴 새 회차 — 다시 기다림

    await tick(LOOP_DWELL_MS + 2000)
    expect(result.current.waitMediaPending).toBe(1)
  })

  it('슬라이드 기준 media — 나레이션을 기다리지 않고, 옵션을 안 켠 영상도 기다린다', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', advance: { mode: 'media' }, elements: [vid()] }), '1-0': page() }
    const { result } = await startEngine()
    expect(result.current.advanceMode).toBe('media')
    expect(result.current.elements[0].advanceOnEnd).toBe(true) // 렌더러가 자동 재생·반복 끔으로 그리도록

    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(0)
    act(() => reportMediaEnded('v1'))
    expect(result.current.currentSlide).toBe(1)
  })

  it('슬라이드 기준 narration — 끝까지 재생 옵션이 있어도 나레이션 끝에 넘어간다', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', advance: { mode: 'narration' }, elements: [vid({ advanceOnEnd: true })] }), '1-0': page() }
    const { result } = await startEngine()
    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)
  })

  it('슬라이드 기준 time — 나레이션과 무관하게 N초 뒤', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice', advance: { mode: 'time', seconds: 7 } }), '1-0': page() }
    const { result } = await startEngine()

    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.getAdvanceEta()).toBeGreaterThan(6)
    await tick(7000)
    expect(result.current.currentSlide).toBe(1)
  })

  it('슬라이드 기준 click — 전시회에서도 이 장에서 멈춘다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page({ advance: { mode: 'click' } }), '1-0': page() }
    const { result } = await startEngine()
    await tick(LOOP_DWELL_MS * 3)
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.getAdvanceEta()).toBeNull()
  })

  it('루프의 머무는 시간 남은 시간 표시', async () => {
    useEditorStore.getState().setAutoAdvance(false)
    useEditorStore.getState().setLoopPresentation(true)
    deck = { '0-0': page(), '1-0': page() }
    const { result } = await startEngine()
    const eta = result.current.getAdvanceEta()
    expect(eta).toBeGreaterThan(LOOP_DWELL_MS / 1000 - 1)
    expect(eta).toBeLessThanOrEqual(LOOP_DWELL_MS / 1000)
  })
})

describe('여러 슬라이드에 걸친 BGM', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useEditorStore.getState().setLoopPresentation(false)
    useEditorStore.getState().setAutoAdvance(false)
    useEditorStore.setState({ presentStartIndex: 0 })
  })
  afterEach(() => { vi.useRealTimers() })

  it('지정한 장 수 동안 같은 BGM 요소가 유지되고 그 뒤에는 없다', async () => {
    const bgm = { id: 'bgm', type: 'audio', content: 'idb://bgm', bgmSpan: 2 }
    deck = { '0-0': page({ elements: [bgm] }), '1-0': page(), '2-0': page() }
    const { result } = await startEngine()

    expect(result.current.bgm?.id).toBe('bgm')
    act(() => result.current.goNext())
    expect(result.current.currentSlide).toBe(1)
    expect(result.current.bgm?.id).toBe('bgm')
    act(() => result.current.goNext())
    expect(result.current.bgm).toBeNull()
  })

  it('BGM은 끝을 기다리는 대상이 아니다', async () => {
    useEditorStore.getState().setAutoAdvance(true)
    const bgm = { id: 'bgm', type: 'audio', content: 'idb://bgm', bgmSpan: 0, advanceOnEnd: true }
    deck = { '0-0': page({ notesAudio: 'idb://voice', elements: [bgm] }), '1-0': page() }
    const { result } = await startEngine()
    expect(result.current.advanceMode).toBe('narration')
    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)
    expect(result.current.bgm?.id).toBe('bgm')
  })

  it('나레이션이 흐르는 동안 narrationPlaying(덕킹 신호)', async () => {
    deck = { '0-0': page({ notesAudio: 'idb://voice' }) }
    const { result } = await startEngine()
    expect(result.current.narrationPlaying).toBe(true)
    act(() => result.current.onAudioEnded())
    expect(result.current.narrationPlaying).toBe(false)
  })
})
