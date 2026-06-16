import { describe, it, expect } from 'vitest'
import { colorDist, pixelAlpha, MAX_COLOR_DIST } from '../core/chromaKey'

describe('chromaKey 순수 함수', () => {
  it('colorDist: 같은 색 0, 흑↔백 최대', () => {
    expect(colorDist(10, 20, 30, 10, 20, 30)).toBe(0)
    expect(colorDist(0, 0, 0, 255, 255, 255)).toBeCloseTo(MAX_COLOR_DIST, 3)
  })

  it('pixelAlpha: 핵심 안쪽=0(제거), 바깥=원래 알파 유지', () => {
    // tol=100, feather=30 → 안쪽(<70) 제거, 70~100 페더, >=100 유지
    expect(pixelAlpha(50, 100, 30, 255)).toBe(0)
    expect(pixelAlpha(120, 100, 30, 255)).toBe(255)
  })

  it('pixelAlpha: 페더 구간은 부분 투명(0~원알파)', () => {
    const a = pixelAlpha(85, 100, 30, 255) // 중간
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(255)
  })
})
