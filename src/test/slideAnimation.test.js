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

  // 아래 네 가지는 실제 덱(23장·456요소)에서 조용히 어긋나던 지점이다.
  // 표 한 장이 클릭 4번 대신 44번을 요구하고, 표지 부제가 자동으로 흐르지 않았다.
  it('뒤에 선언된 앵커도 참조한다 — 전방 참조가 클릭 단계로 흩어지지 않는다', () => {
    const els = []
    for (let i = 0; i < 10; i++) {
      els.push(mk('r' + i, { effect: 'fadeIn', seq: i, trigger: { mode: 'with', ref: 'anchor' } }))
    }
    els.push(mk('anchor', { effect: 'fadeIn', seq: 10, trigger: { mode: 'click' } }))

    const info = computeSteps(els)
    expect(info.stepCount).toBe(1)
    expect(info.stepOf.r0).toBe(0)
    expect(info.stepOf.r9).toBe(0)
  })

  it('auto를 참조하면 체인 전체가 auto — 클릭을 요구하지 않는다', () => {
    const els = [
      mk('title', { effect: 'fadeIn', seq: 0, durationMs: 500, trigger: { mode: 'auto' } }),
      mk('sub', { effect: 'slideIn', seq: 1, durationMs: 500, delayMs: 150, trigger: { mode: 'after', ref: 'title' } }),
      mk('badge', { effect: 'fadeIn', seq: 2, delayMs: 80, trigger: { mode: 'with', ref: 'title' } }),
    ]
    const info = computeSteps(els)

    expect(info.stepCount).toBe(0)                 // 클릭 없이 장이 살아난다
    expect(info.autoOffsets).toEqual({ title: 0, sub: 650, badge: 80 })
    expect(info.stepOf.sub).toBeUndefined()
  })

  it('with도 delay를 인정한다 — 한 단계 안에서 계단식 등장', () => {
    const els = [
      mk('a', { effect: 'fadeIn', seq: 0, durationMs: 300, trigger: { mode: 'click' } }),
      mk('b', { effect: 'fadeIn', seq: 1, durationMs: 300, delayMs: 90, trigger: { mode: 'with', ref: 'a' } }),
      mk('c', { effect: 'fadeIn', seq: 2, durationMs: 300, delayMs: 180, trigger: { mode: 'with', ref: 'a' } }),
    ]
    const info = computeSteps(els)

    expect(info.stepCount).toBe(1)                 // 클릭은 한 번
    expect(info.offsetOf).toEqual({ a: 0, b: 90, c: 180 })
  })

  it('순환 참조는 끊고 단계로 떨어뜨린다(무한 재귀 없음)', () => {
    const els = [
      mk('x', { effect: 'fadeIn', seq: 0, trigger: { mode: 'with', ref: 'y' } }),
      mk('y', { effect: 'fadeIn', seq: 1, trigger: { mode: 'with', ref: 'x' } }),
    ]
    const info = computeSteps(els)
    expect(info.stepCount).toBeGreaterThanOrEqual(1)
    expect(Object.keys(info.stepOf).sort()).toEqual(['x', 'y'])
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
  it('directionVars: 화살표=이동 방향. slideIn은 -M(시작 오프셋), slideOut은 +M(끝 오프셋)', () => {
    // slideIn left(←): 왼쪽으로 이동 → 오른쪽(+34%)에서 시작해 0으로
    expect(directionVars({ effect: 'slideIn', dir: 'left' })).toEqual({ '--fe-dx': '34%', '--fe-dy': '0' })
    // slideIn down(↓): 아래로 이동 → 위(-34%)에서 시작
    expect(directionVars({ effect: 'slideIn', dir: 'down' })).toEqual({ '--fe-dx': '0', '--fe-dy': '-34%' })
    // slideOut left(←): 왼쪽으로 이동 → 0에서 왼쪽(-34%)으로 빠짐
    expect(directionVars({ effect: 'slideOut', dir: 'left' })).toEqual({ '--fe-dx': '-34%', '--fe-dy': '0' })
    expect(directionVars({ effect: 'slideOut', dir: 'up' })).toEqual({ '--fe-dx': '0', '--fe-dy': '-34%' })
    expect(directionVars({ effect: 'fadeIn' })).toBeNull()
  })
})
