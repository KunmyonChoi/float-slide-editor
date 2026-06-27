import { describe, it, expect } from 'vitest'
import { prepareChromaUniforms, SQRT3, CHROMA_MAX_KEYS } from '../core/chromaGL'

describe('prepareChromaUniforms (WebGL uniform 준비)', () => {
  it('해소된 키를 0~1 색·정규화 거리로 변환하고 count를 센다', () => {
    const u = prepareChromaUniforms(
      [{ key: { r: 0, g: 255, b: 0 }, tolerance: 50, feather: 10 }],
      0, { r: 0, g: 255, b: 0 },
    )
    expect(u.count).toBe(1)
    expect(u.keys.slice(0, 3)).toEqual([0, 1, 0])      // 0~1 정규화
    expect(u.tols[0]).toBeCloseTo(0.5 * SQRT3, 5)        // 퍼센트 → 정규화 거리
    expect(u.feathers[0]).toBeCloseTo(0.1 * SQRT3, 5)
    expect(u.keys).toHaveLength(CHROMA_MAX_KEYS * 3)     // 4슬롯 패딩
    expect(u.tols).toHaveLength(CHROMA_MAX_KEYS)
  })

  it('key 없는 항목은 제외하고 count에 반영', () => {
    const u = prepareChromaUniforms(
      [{ key: { r: 0, g: 255, b: 0 }, tolerance: 18 }, { key: null, tolerance: 18 }],
      0, { r: 0, g: 255, b: 0 },
    )
    expect(u.count).toBe(1)
  })

  it('feather 미지정 시 tol*0.3 자동', () => {
    const u = prepareChromaUniforms([{ key: { r: 0, g: 255, b: 0 }, tolerance: 30 }], 0, { r: 0, g: 255, b: 0 })
    expect(u.feathers[0]).toBeCloseTo(0.3 * SQRT3 * 0.3, 5) // (30/100*SQRT3)*0.3
  })

  it('despill 퍼센트 → 0~1, spillCh는 우세 채널(그린=1, 블루=2)', () => {
    const g = prepareChromaUniforms([{ key: { r: 0, g: 255, b: 0 }, tolerance: 18 }], 80, { r: 0, g: 255, b: 0 })
    expect(g.despill).toBeCloseTo(0.8, 5)
    expect(g.spillCh).toBe(1)
    const b = prepareChromaUniforms([{ key: { r: 0, g: 0, b: 255 }, tolerance: 18 }], 50, { r: 0, g: 0, b: 255 })
    expect(b.spillCh).toBe(2)
  })

  it('빈 입력은 count 0(제거 없음)', () => {
    const u = prepareChromaUniforms([], 0, null)
    expect(u.count).toBe(0)
  })
})
