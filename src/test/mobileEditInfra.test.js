import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── pointerEnv ──────────────────────────────────────
describe('pointerEnv.isCoarsePointer', () => {
  let origMM
  beforeEach(() => { origMM = window.matchMedia })
  afterEach(() => { window.matchMedia = origMM; vi.resetModules() })

  it('(pointer: coarse) 매칭 시 true', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const { isCoarsePointer } = await import('../core/pointerEnv')
    expect(isCoarsePointer()).toBe(true)
  })

  it('마우스(미매칭) 시 false', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const { isCoarsePointer } = await import('../core/pointerEnv')
    expect(isCoarsePointer()).toBe(false)
  })
})

// ── useVisualViewport.getViewportState ──────────────
describe('useVisualViewport.getViewportState', () => {
  let origVV, origInner
  beforeEach(() => {
    origVV = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    origInner = window.innerHeight
  })
  afterEach(() => {
    if (origVV) Object.defineProperty(window, 'visualViewport', origVV)
    else delete window.visualViewport
    window.innerHeight = origInner
  })

  it('visualViewport 미지원이면 키보드 없음 폴백', async () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.isKeyboardOpen).toBe(false)
    expect(s.keyboardOverlap).toBe(0)
  })

  it('키보드가 하단을 크게 가리면 isKeyboardOpen=true + overlap 계산', async () => {
    window.innerHeight = 800
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 450, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.keyboardOverlap).toBe(350) // 800 - (0 + 450)
    expect(s.isKeyboardOpen).toBe(true)
  })

  it('약간의 차이는 키보드로 보지 않음(임계값 120)', async () => {
    window.innerHeight = 800
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 720, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.keyboardOverlap).toBe(80)
    expect(s.isKeyboardOpen).toBe(false)
  })
})
