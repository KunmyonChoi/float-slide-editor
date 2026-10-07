import { describe, it, expect } from 'vitest'
import { computeSteps, hasLoop, makeLoopAnim, loopStartMs, loopAnimationCss, loopVars, loopClassName, LOOP_EFFECTS } from '../core/slideAnimation'

const el = (id, anim, loopAnim) => ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10, anim, loopAnim })
const enter = (mode, extra = {}) => ({ effect: 'pop', durationMs: 400, delayMs: 0, trigger: { mode, ref: null }, seq: 1, ...extra })

describe('반복(강조) 효과 모델', () => {
  it('makeLoopAnim — 효과별 기본 주기, 기존 세기·시차·시작·횟수는 유지', () => {
    expect(makeLoopAnim('nope')).toBeNull()
    const a = makeLoopAnim('spin')
    expect(a).toEqual({ effect: 'spin', periodMs: 8000, intensity: 1, phaseMs: 0, start: 'afterEnter', repeat: 0 })
    const b = makeLoopAnim('pulse', { ...a, intensity: 2, phaseMs: 300, repeat: 3 })
    expect(b).toMatchObject({ effect: 'pulse', periodMs: 1200, intensity: 2, phaseMs: 300, repeat: 3 })
    expect(LOOP_EFFECTS.map(e => e.id)).toEqual(['pulse', 'breathe', 'float', 'spin', 'wiggle', 'blink', 'shimmer'])
  })

  it('hasLoop — 알 수 없는 효과는 무시', () => {
    expect(hasLoop(el('a', null, { effect: 'pulse' }))).toBe(true)
    expect(hasLoop(el('a', null, { effect: 'bogus' }))).toBe(false)
    expect(hasLoop(el('a'))).toBe(false)
  })

  it('loopStartMs — 등장 없으면 0, 자동 등장은 지연+시간, 클릭 단계는 단계 내 오프셋+시간', () => {
    const plain = el('p', null, makeLoopAnim('pulse'))
    const auto = el('a', enter('auto', { delayMs: 300 }), makeLoopAnim('pulse'))
    const click = el('c', enter('click', { seq: 2 }), makeLoopAnim('pulse'))
    const withRef = el('w', enter('with', { seq: 3, delayMs: 100, trigger: { mode: 'with', ref: 'c' } }), { ...makeLoopAnim('float'), start: 'withEnter' })
    const exitOnly = el('x', { effect: 'fadeOut', durationMs: 500, trigger: { mode: 'click' }, seq: 4 }, makeLoopAnim('blink'))
    const info = computeSteps([plain, auto, click, withRef, exitOnly])
    expect(loopStartMs(info, plain)).toBe(0)
    expect(loopStartMs(info, auto)).toBe(700)
    expect(loopStartMs(info, click)).toBe(400)
    expect(loopStartMs(info, withRef)).toBe(100) // 등장과 함께 → 등장 시작 시각
    expect(loopStartMs(info, exitOnly)).toBe(0)  // 퇴장만 있으면 처음부터 보임
    expect(loopStartMs(info, el('n'))).toBeNull()
  })

  it('loopAnimationCss — 주기·지연·횟수, 시차는 지연에서 뺀다(주기로 접음)', () => {
    expect(loopAnimationCss(null)).toBeNull()
    expect(loopAnimationCss({ effect: 'pulse', periodMs: 1200 }, 400)).toBe('feLoopPulse 1200ms ease-in-out 400ms infinite both')
    expect(loopAnimationCss({ effect: 'spin', periodMs: 8000, repeat: 2 }, 0)).toBe('feLoopSpin 8000ms linear 0ms 2 both')
    expect(loopAnimationCss({ effect: 'float', periodMs: 3000, phaseMs: 3500 }, 0)).toBe('feLoopFloat 3000ms ease-in-out -500ms infinite both')
    // 등장 뒤 시작 + 시차: 등장 중에 시작하지 않고 startMs 이후 첫 박자 경계(박자는 -phase 정렬)까지 기다림
    expect(loopAnimationCss({ effect: 'pulse', periodMs: 1000, phaseMs: 300 }, 500)).toBe('feLoopPulse 1000ms ease-in-out 1200ms infinite both')
    expect(loopAnimationCss({ effect: 'blink', periodMs: 10 }, 0)).toMatch(/^feLoopBlink 200ms /) // 최소 주기
  })

  it('loopVars/loopClassName — 세기 범위 고정, 반짝 스윕만 띠 클래스', () => {
    expect(loopVars({ intensity: 9 })).toEqual({ '--fe-li': '3' })
    expect(loopVars({ intensity: 0 })).toEqual({ '--fe-li': '0.25' })
    expect(loopVars({})).toEqual({ '--fe-li': '1' })
    expect(loopClassName({ effect: 'shimmer' })).toBe('fe-loop-anim fe-loop-shimmer')
    expect(loopClassName({ effect: 'pulse' })).toBe('fe-loop-anim')
  })
})
