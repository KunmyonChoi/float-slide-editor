import { describe, it, expect } from 'vitest'
import { createOneEuro2D } from '../core/oneEuro'

const DT = 1 / 60
const run = (f, xs, dt = DT) => xs.map(x => f.step(x, 0, dt).x)
// 연속한 출력 사이 움직임이 고른지 — 계단·떨림이면 크게 들쭉날쭉하다
const jerk = (ys) => { let s = 0; for (let i = 2; i < ys.length; i++) s += Math.abs(ys[i] - 2 * ys[i - 1] + ys[i - 2]); return s / (ys.length - 2) }

describe('One Euro 필터(2D)', () => {
  it('첫 표본은 그대로, 같은 입력이 이어지면 그 값에 머문다', () => {
    const f = createOneEuro2D()
    expect(f.step(5, 7, DT)).toEqual({ x: 5, y: 7 })
    for (let i = 0; i < 30; i++) f.step(5, 7, DT)
    expect(f.step(5, 7, DT)).toEqual({ x: 5, y: 7 })
  })

  it('dt가 0 이하이면 그 표본을 건너뛴다(NaN으로 번지지 않음)', () => {
    const f = createOneEuro2D()
    f.reset(1, 2)
    expect(f.step(9, 9, 0)).toEqual({ x: 1, y: 2 })
    expect(f.step(9, 9, -0.01)).toEqual({ x: 1, y: 2 })
    const o = f.step(9, 9, DT)
    expect(Number.isFinite(o.x) && Number.isFinite(o.y)).toBe(true)
  })

  it('reset 지점에서 출발해 입력으로 수렴한다', () => {
    const f = createOneEuro2D()
    f.reset(0, 0)
    let o
    for (let i = 0; i < 120; i++) o = f.step(10, -4, DT)
    expect(o.x).toBeCloseTo(10, 2)
    expect(o.y).toBeCloseTo(-4, 2)
  })

  it('느린 이동의 정수 좌표 계단·떨림을 고르게 편다', () => {
    // 손가락이 초당 6px로 천천히 — 터치 좌표는 정수로 반올림되고 ±0.5px 떨림이 섞인다
    const raw = Array.from({ length: 120 }, (_, i) => Math.round(i * 0.1 + (i % 3 === 0 ? 0.5 : -0.4)))
    const f = createOneEuro2D()
    f.reset(raw[0], 0)
    const out = run(f, raw)
    expect(jerk(out)).toBeLessThan(jerk(raw) / 5)
  })

  it('빠른 이동은 거의 늦지 않게 따라간다', () => {
    // 초당 600px로 쭉 — 0.5초 뒤 뒤처짐이 몇 px 이내
    const raw = Array.from({ length: 30 }, (_, i) => i * 10)
    const f = createOneEuro2D()
    f.reset(0, 0)
    const out = run(f, raw)
    expect(raw.at(-1) - out.at(-1)).toBeLessThan(6)
  })

  it('차단 주파수 하한(minCutoffFloor)을 주면 남은 거리를 더 빨리 좁힌다(손을 뗀 뒤)', () => {
    const slow = createOneEuro2D(), fast = createOneEuro2D()
    slow.reset(0, 0); fast.reset(0, 0)   // 손을 뗄 때 남은 1px
    let a, b
    for (let i = 0; i < 6; i++) { a = slow.step(1, 0, DT); b = fast.step(1, 0, DT, 5) }
    expect(1 - b.x).toBeLessThan((1 - a.x) / 2)
    // 이미 빠르게 따라가는 중이면 하한이 오히려 늦추지 않는다
    const f1 = createOneEuro2D(), f2 = createOneEuro2D()
    f1.reset(0, 0); f2.reset(0, 0)
    expect(f2.step(100, 0, DT, 5).x).toBeCloseTo(f1.step(100, 0, DT).x, 9)
  })
})
