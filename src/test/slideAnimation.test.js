import { describe, it, expect } from 'vitest'
import {
  computeSteps, isHiddenAt, isPlayingAt, animationCss, directionVars,
  isEntrance, isExit, effectHasDir, stepDurations,
} from '../core/slideAnimation'

const mk = (id, anim) => ({ id, anim })

describe('slideAnimation 분류', () => {
  it('등장/퇴장/방향 판정', () => {
    expect(isEntrance('fadeIn')).toBe(true)
    expect(isExit('fadeOut')).toBe(true)
    expect(isExit('scaleOut')).toBe(true)
    expect(effectHasDir('slideIn')).toBe(true)
    expect(effectHasDir('scaleOut')).toBe(false)
    expect(effectHasDir('fadeIn')).toBe(false)
  })
})

describe('computeSteps — 트리거 그룹핑', () => {
  it('click마다 새 단계, with=동시, after=연쇄', () => {
    const els = [
      mk('a', { effect: 'fadeIn', seq: 0, durationMs: 500, trigger: { mode: 'click' } }),
      mk('b', { effect: 'fadeIn', seq: 1, durationMs: 400, trigger: { mode: 'with', ref: 'a' } }),
      mk('c', { effect: 'fadeIn', seq: 2, durationMs: 300, delayMs: 100, trigger: { mode: 'after', ref: 'a' } }),
      mk('d', { effect: 'fadeIn', seq: 3, durationMs: 500, trigger: { mode: 'click' } }),
    ]
    const info = computeSteps(els)
    expect(info.stepCount).toBe(2)            // click 2개 → 2단계
    expect(info.stepOf).toEqual({ a: 0, b: 0, c: 0, d: 1 })
    expect(info.offsetOf.a).toBe(0)
    expect(info.offsetOf.b).toBe(0)           // with: ref와 동시
    expect(info.offsetOf.c).toBe(600)         // after: a끝(500)+delay(100)
    expect(info.offsetOf.d).toBe(0)
  })

  it('ref 해소 실패(앞에 없음)는 click 폴백', () => {
    const els = [mk('x', { effect: 'fadeIn', seq: 0, trigger: { mode: 'after', ref: 'ghost' } })]
    const info = computeSteps(els)
    expect(info.stepCount).toBe(1)
    expect(info.stepOf.x).toBe(0)
  })

  it('애니 없는 요소는 무시', () => {
    const info = computeSteps([mk('a', null), mk('b', { effect: 'none' }), mk('c', { effect: 'fadeIn', seq: 0, trigger: { mode: 'click' } })])
    expect(info.stepCount).toBe(1)
    expect(info.order).toEqual(['c'])
  })
})

describe('표시 상태', () => {
  const els = [
    mk('in', { effect: 'fadeIn', seq: 0, trigger: { mode: 'click' } }),   // step 0
    mk('out', { effect: 'fadeOut', seq: 1, trigger: { mode: 'click' } }), // step 1
  ]
  const info = computeSteps(els)
  const elIn = els[0], elOut = els[1]

  it('등장: 자기 단계 전엔 숨김, 후엔 보임', () => {
    expect(isHiddenAt(info, elIn, 0)).toBe(true)   // 아직 클릭 0 → 숨김
    expect(isHiddenAt(info, elIn, 1)).toBe(false)  // 클릭 1 → 보임
  })
  it('퇴장: 자기 단계 전엔 보임, 후엔 숨김', () => {
    expect(isHiddenAt(info, elOut, 1)).toBe(false) // step1, revealed1 → 아직
    expect(isHiddenAt(info, elOut, 2)).toBe(true)  // revealed2 → 퇴장됨
  })
  it('막 진입한 단계가 재생됨', () => {
    expect(isPlayingAt(info, elIn, 1)).toBe(true)  // revealed1 → step0 재생
    expect(isPlayingAt(info, elIn, 2)).toBe(false)
    expect(isPlayingAt(info, elOut, 2)).toBe(true) // revealed2 → step1 재생
  })
})

describe('stepDurations — 자동 진행 타이밍', () => {
  it('단계별 max(offset+duration), 최소 300', () => {
    const els = [
      mk('a', { effect: 'fadeIn', seq: 0, durationMs: 500, trigger: { mode: 'click' } }),
      mk('b', { effect: 'fadeIn', seq: 1, durationMs: 300, delayMs: 100, trigger: { mode: 'after', ref: 'a' } }),
      mk('c', { effect: 'fadeIn', seq: 2, durationMs: 200, trigger: { mode: 'click' } }),
    ]
    const info = computeSteps(els)
    const durs = stepDurations(info, els)
    expect(durs[0]).toBe(900)   // b: offset(600)+dur(300)
    expect(durs[1]).toBe(300)   // c: 200 → 최소 300
  })
})

describe('CSS 생성', () => {
  it('animationCss: 이름+시간+지연+both', () => {
    expect(animationCss({ effect: 'fadeIn', durationMs: 400 }, 0)).toBe('feElFadeIn 400ms ease-out 0ms both')
    expect(animationCss({ effect: 'slideOut', durationMs: 600 }, 200)).toBe('feElSlideOut 600ms ease-out 200ms both')
    expect(animationCss({ effect: 'none' })).toBeNull()
  })
  it('directionVars: 슬라이드만, 방향별 translate', () => {
    expect(directionVars({ effect: 'slideIn', dir: 'left' })).toEqual({ '--fe-dx': '-34%', '--fe-dy': '0' })
    expect(directionVars({ effect: 'slideIn', dir: 'down' })).toEqual({ '--fe-dx': '0', '--fe-dy': '34%' })
    expect(directionVars({ effect: 'fadeIn' })).toBeNull()
  })
})
