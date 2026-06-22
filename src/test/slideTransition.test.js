import { describe, it, expect } from 'vitest'
import { slideTransitionCss } from '../components/FlatPresenter'

describe('slideTransitionCss', () => {
  it('타입별 keyframe + 지속시간 매핑', () => {
    expect(slideTransitionCss({ type: 'fade', durationMs: 300 })).toBe('feSlideFade 300ms ease-out')
    expect(slideTransitionCss({ type: 'slide', durationMs: 500 })).toBe('feSlideSlide 500ms ease-out')
    expect(slideTransitionCss({ type: 'zoom', durationMs: 400 })).toBe('feSlideZoom 400ms ease-out')
  })

  it('durationMs 없으면 기본 400ms, 하한 50ms', () => {
    expect(slideTransitionCss({ type: 'fade' })).toBe('feSlideFade 400ms ease-out')
    expect(slideTransitionCss({ type: 'fade', durationMs: 10 })).toBe('feSlideFade 50ms ease-out')
  })

  it('없음/null/미지원 타입은 undefined(애니메이션 없음)', () => {
    expect(slideTransitionCss(null)).toBeUndefined()
    expect(slideTransitionCss({ type: 'none' })).toBeUndefined()
    expect(slideTransitionCss({ type: 'spin' })).toBeUndefined()
    expect(slideTransitionCss(undefined)).toBeUndefined()
  })
})
