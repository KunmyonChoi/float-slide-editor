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
    expect(s.keyboardHeight).toBe(0)
  })

  it('키보드가 가시영역을 크게 줄이면 isKeyboardOpen=true + 높이/하단 계산', async () => {
    window.innerHeight = 800
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 450, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.keyboardHeight).toBe(350) // 800 - 450
    expect(s.visibleBottom).toBe(450)  // 0 + 450
    expect(s.isKeyboardOpen).toBe(true)
  })

  it('페이지 스크롤(offsetTop 큼)에도 키보드 열림 판정 유지 — 회귀', async () => {
    // 멀리 있는 텍스트 박스로 스크롤되어 offsetTop이 커져도 키보드 높이는 그대로여야 함
    window.innerHeight = 800
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 450, offsetTop: 230, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.keyboardHeight).toBe(350)   // offsetTop과 무관
    expect(s.isKeyboardOpen).toBe(true)  // 예전 공식이면 false로 오판하던 케이스
    expect(s.visibleBottom).toBe(680)    // 230 + 450 (도킹은 가시영역 하단 추종)
  })

  it('약간의 차이는 키보드로 보지 않음(임계값 120)', async () => {
    window.innerHeight = 800
    Object.defineProperty(window, 'visualViewport', {
      value: { height: 720, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
      configurable: true,
    })
    const { getViewportState } = await import('../components/useVisualViewport')
    const s = getViewportState()
    expect(s.keyboardHeight).toBe(80)
    expect(s.isKeyboardOpen).toBe(false)
  })
})
