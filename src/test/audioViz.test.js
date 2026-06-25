import { describe, it, expect } from 'vitest'
import { DEFAULT_VIZ, VIZ_SHAPES, barCount, staticFrame, barsFromFrequency, drawViz } from '../core/audioViz'

describe('audioViz — 순수 헬퍼', () => {
  it('barCount: 폭에 채우기 (두께+간격 단위로 분할)', () => {
    // width 100, bar 6 + gap 4 = unit 10 → floor((100+4)/10)=10
    expect(barCount(100, 6, 4)).toBe(10)
    // 폭 0 이하라도 최소 1
    expect(barCount(0, 6, 3)).toBe(1)
    // 간격 0
    expect(barCount(50, 5, 0)).toBe(10)
  })

  it('staticFrame: 길이 n, 값은 0.12~1 범위, 결정적', () => {
    const a = staticFrame(20)
    const b = staticFrame(20)
    expect(a.length).toBe(20)
    expect(a).toEqual(b) // 결정적
    for (const v of a) { expect(v).toBeGreaterThanOrEqual(0.12 - 1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9) }
  })

  it('barsFromFrequency: 길이 n, 0~1 클램프, sensitivity 배율', () => {
    const freq = new Uint8Array(128).fill(128) // 중간값
    const out = barsFromFrequency(freq, 16, 1)
    expect(out.length).toBe(16)
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    // sensitivity 2배 → 값이 더 큼(클램프 전 비교 위해 작은 입력)
    const low = new Uint8Array(128).fill(40)
    const o1 = barsFromFrequency(low, 8, 1)
    const o2 = barsFromFrequency(low, 8, 2)
    expect(o2[0]).toBeGreaterThan(o1[0])
    // 빈 입력 → 0 배열
    expect(barsFromFrequency(new Uint8Array(0), 4, 1)).toEqual([0, 0, 0, 0])
  })

  it('drawViz: bars/mirror 모두 막대 수만큼 채움 호출(fake ctx)', () => {
    const calls = { fill: 0, clearRect: 0, beginPath: 0 }
    const ctx = {
      clearRect: () => calls.clearRect++,
      beginPath: () => calls.beginPath++,
      moveTo: () => {}, arcTo: () => {}, closePath: () => {},
      fill: () => calls.fill++,
      set fillStyle(v) {}, get fillStyle() { return '' },
    }
    const mags = [0.2, 0.5, 1, 0.1]
    drawViz(ctx, 100, 50, mags, { ...DEFAULT_VIZ, shape: 'bars' })
    expect(calls.clearRect).toBe(1)
    expect(calls.fill).toBe(4) // 막대 4개
    calls.fill = 0
    drawViz(ctx, 100, 50, mags, { ...DEFAULT_VIZ, shape: 'mirror' })
    expect(calls.fill).toBe(4)
  })

  it('VIZ_SHAPES/DEFAULT_VIZ 노출', () => {
    expect(VIZ_SHAPES.map(s => s.value)).toContain('bars')
    expect(VIZ_SHAPES.map(s => s.value)).toContain('mirror')
    expect(DEFAULT_VIZ.shape).toBe('bars')
  })
})
