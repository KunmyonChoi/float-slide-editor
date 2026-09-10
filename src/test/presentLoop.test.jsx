import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// 발표 엔진이 flatStore에서 꺼내 갈 덱 — 테스트마다 갈아 끼운다.
const anim = (seq) => ({ effect: 'fadeIn', durationMs: 400, delayMs: 0, trigger: { mode: 'click' }, seq })
const twoSteps = [{ id: 'a', type: 'text', anim: anim(0) }, { id: 'b', type: 'text', anim: anim(1) }]
const CANVAS = { w: 1280, h: 720 }

// 1장: 노트 음성 있음 + 2단계 / 2장: 음성 없음 + 애니메이션 없음
const AUDIO_DECK = {
  '0-0': { canvasSize: CANVAS, elements: twoSteps, notesAudio: 'idb://voice-1' },
  '1-0': { canvasSize: CANVAS, elements: [] },
}
const SILENT_ONE_PAGE = { '0-0': { canvasSize: CANVAS, elements: twoSteps } }

let deck = AUDIO_DECK

vi.mock('../store/flatStore', () => ({
  useFlatStore: {
    getState: () => ({
      _preloading: false,
      getAllPagesAsync: async () => ({ pages: deck }),
      setPageNotesCaptions: () => {},
    }),
  },
}))

const { usePresentationEngine, LOOP_DWELL_MS, autoBuildTotalMs } = await import('../core/usePresentationEngine')
const { useEditorStore } = await import('../store/editorStore')
const { computeSteps } = await import('../core/slideAnimation')

// 2단계(각 400ms) 자동 재생이 끝나기까지 = 300+400+300+400
const BUILD_MS = 1400

// 가짜 타이머 아래에서는 waitFor가 스스로 시간을 못 밀어 주므로, 로딩이 풀릴 때까지 직접 민다.
async function startEngine() {
  const rendered = renderHook(() => usePresentationEngine())
  for (let i = 0; i < 20 && rendered.result.current.loading; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
  }
  expect(rendered.result.current.loading).toBe(false)
  return rendered
}

const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('반복 재생(루프) 발표', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    deck = AUDIO_DECK
    useEditorStore.getState().setLoopPresentation(false)
    useEditorStore.getState().setAutoBuild(false)
    useEditorStore.getState().setAutoAdvance(false)
    useEditorStore.setState({ presentStartIndex: 0 })
  })
  afterEach(() => {
    vi.useRealTimers()
    useEditorStore.getState().setLoopPresentation(false)
  })

  it('자동 재생 총 시간 — 단계마다 텀이 한 번씩 붙는다', () => {
    expect(autoBuildTotalMs({ stepCount: 0 }, [])).toBe(0)
    expect(autoBuildTotalMs(computeSteps(twoSteps), twoSteps)).toBe(BUILD_MS)
  })

  it('꺼져 있으면 마지막 장에서 멈춘다 — 처음으로 돌아가지 않는다', async () => {
    const { result } = await startEngine()

    act(() => result.current.goToSlide(1))
    await tick(LOOP_DWELL_MS + 2000)
    expect(result.current.currentSlide).toBe(1)

    act(() => result.current.goNext())
    expect(result.current.currentSlide).toBe(1)
  })

  it('켜면 마지막 장이 끝난 뒤 처음으로 돌아간다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    // 1장은 음성이 있는 장 — 음성이 끝나야 넘어간다(머무는 타이머가 먼저 넘기면 안 된다)
    await tick(BUILD_MS + LOOP_DWELL_MS + 2000)
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.revealed).toBe(2) // 빌드는 클릭 없이 다 나와 있다

    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)

    // 2장은 음성이 없는 장 — 머무는 시간이 지나면 처음으로
    await tick(LOOP_DWELL_MS + 200)
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.revealed).toBe(0)

    // 되감은 뒤에도 빌드가 다시 자동 재생된다
    await tick(BUILD_MS + 200)
    expect(result.current.revealed).toBe(2)
  })

  it('음성 있는 장을 두 번 넘기지 않는다 — 음성 종료가 유일한 신호', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    act(() => result.current.onAudioEnded())
    expect(result.current.currentSlide).toBe(1)

    // 1장에 걸려 있던 타이머가 뒤늦게 깨어나 2장을 건너뛰면 안 된다
    await tick(LOOP_DWELL_MS - 500)
    expect(result.current.currentSlide).toBe(1)
  })

  it('음성이 막히면(자동재생 차단·유실) 머무는 시간으로 넘어간다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    act(() => result.current.onAudioError())
    await tick(BUILD_MS + LOOP_DWELL_MS + 200)
    expect(result.current.currentSlide).toBe(1)
  })

  it('나레이션을 끄면 음성 있는 장도 머무는 시간으로 넘어간다', async () => {
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    act(() => result.current.setNarration(false))
    await tick(BUILD_MS + LOOP_DWELL_MS + 200)
    expect(result.current.currentSlide).toBe(1)
  })

  it('한 장짜리 덱도 같은 장을 다시 재생한다', async () => {
    deck = SILENT_ONE_PAGE
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    await tick(BUILD_MS + 200)
    expect(result.current.revealed).toBe(2)

    await tick(LOOP_DWELL_MS)
    expect(result.current.currentSlide).toBe(0)
    expect(result.current.revealed).toBe(0)   // 되감김

    await tick(BUILD_MS + 200)
    expect(result.current.revealed).toBe(2)   // 다시 재생
  })

  it('루프를 켜면 애니메이션 자동 재생 옵션이 꺼져 있어도 빌드가 나온다', async () => {
    deck = SILENT_ONE_PAGE
    useEditorStore.getState().setAutoBuild(false)
    useEditorStore.getState().setLoopPresentation(true)
    const { result } = await startEngine()

    await tick(BUILD_MS + 200)
    expect(result.current.revealed).toBe(2)
  })
})
