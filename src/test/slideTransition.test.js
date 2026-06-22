import { describe, it, expect } from 'vitest'
import { slideTransitionCss, slideTransitionVars } from '../components/FlatPresenter'

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

describe('slideTransitionVars — slide 방향(화살표=이동 방향)', () => {
  it('slide만 방향 변수, 기본 right. 시작 오프셋은 이동의 반대편', () => {
    // left(←): 왼쪽으로 이동 → 오른쪽(+30%)에서 시작
    expect(slideTransitionVars({ type: 'slide', dir: 'left' })).toEqual({ '--fe-sx': '30%', '--fe-sy': '0' })
    // down(↓): 아래로 이동 → 위(-30%)에서 시작
    expect(slideTransitionVars({ type: 'slide', dir: 'down' })).toEqual({ '--fe-sx': '0', '--fe-sy': '-30%' })
    // 기본 right(→): 오른쪽으로 이동 → 왼쪽(-30%)에서 시작
    expect(slideTransitionVars({ type: 'slide' })).toEqual({ '--fe-sx': '-30%', '--fe-sy': '0' })
  })
  it('slide 아닌 타입은 null', () => {
    expect(slideTransitionVars({ type: 'fade' })).toBeNull()
    expect(slideTransitionVars(null)).toBeNull()
  })
})
