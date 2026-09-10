import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// 발표 엔진은 flatStore에서 덱을 비동기로 꺼낸다 — 테스트에서는 두 장짜리 가짜 덱으로 대체.
// 첫 장에 클릭 트리거 애니메이션 두 단계가 있고, 노트 음성은 없다.
const anim = (seq) => ({ effect: 'fadeIn', durationMs: 400, delayMs: 0, trigger: { mode: 'click' }, seq })
const PAGES = {
  '0-0': {
    canvasSize: { w: 1280, h: 720 },
    elements: [
      { id: 'a', type: 'text', anim: anim(0) },
      { id: 'b', type: 'text', anim: anim(1) },
    ],
  },
  '1-0': { canvasSize: { w: 1280, h: 720 }, elements: [] },
}

vi.mock('../store/flatStore', () => ({
  useFlatStore: {
    getState: () => ({
      _preloading: false,
      getAllPagesAsync: async () => ({ pages: PAGES }),
      setPageNotesCaptions: () => {},
    }),
  },
}))

const { usePresentationEngine } = await import('../core/usePresentationEngine')
const { useEditorStore } = await import('../store/editorStore')

// 두 단계가 다 나오기까지: 300(텀) + 400(1단계) + 300(텀) + 400(2단계)
const ALL_STEPS_MS = 1600

describe('애니메이션 자동 재생(autoBuild)', () => {
  beforeEach(() => {
    useEditorStore.getState().setAutoBuild(false)
    useEditorStore.setState({ presentStartIndex: 0 })
  })
  afterEach(() => useEditorStore.getState().setAutoBuild(false))

  it('꺼져 있으면 클릭(goNext) 전까지 단계가 진행되지 않는다', async () => {
    const { result } = renderHook(() => usePresentationEngine())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.animInfo.stepCount).toBe(2)

    await new Promise(r => setTimeout(r, ALL_STEPS_MS))
    expect(result.current.revealed).toBe(0)

    act(() => result.current.goNext())
    expect(result.current.revealed).toBe(1)
  })

  it('켜면 음성이 없어도 단계가 순서대로 자동 재생된다', async () => {
    useEditorStore.getState().setAutoBuild(true)
    const { result } = renderHook(() => usePresentationEngine())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await waitFor(() => expect(result.current.revealed).toBe(1), { timeout: 1500 })
    await waitFor(() => expect(result.current.revealed).toBe(2), { timeout: 1500 })
  })

  it('마지막 단계까지 나오면 멈춘다 — 다음 장으로 넘어가지 않는다', async () => {
    useEditorStore.getState().setAutoBuild(true)
    const { result } = renderHook(() => usePresentationEngine())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.revealed).toBe(2), { timeout: 2000 })

    await new Promise(r => setTimeout(r, 800))
    expect(result.current.revealed).toBe(2)
    expect(result.current.currentSlide).toBe(0)

    // 그 다음 클릭은 평소처럼 다음 장으로
    act(() => result.current.goNext())
    expect(result.current.currentSlide).toBe(1)
  })

  it('발표자가 앞질러 클릭하면 뒤늦은 타이머가 되감지 않는다', async () => {
    useEditorStore.getState().setAutoBuild(true)
    const { result } = renderHook(() => usePresentationEngine())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.goNext())
    act(() => result.current.goNext())
    expect(result.current.revealed).toBe(2)

    await new Promise(r => setTimeout(r, ALL_STEPS_MS))
    expect(result.current.revealed).toBe(2)
    expect(result.current.currentSlide).toBe(0)
  })
})
