import { describe, it, expect } from 'vitest'
import { colorDist, pixelAlpha, MAX_COLOR_DIST, applyChromaToImageData } from '../core/chromaKey'

// 최소 ImageData 스텁(jsdom canvas 없이 픽셀 로직만 검증)
function makeImageData(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4)
  pixels.forEach(([r, g, b, a], i) => { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a })
  return { data, width: pixels.length, height: 1 }
}

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

describe('applyChromaToImageData (영상 프레임/이미지 공용 코어)', () => {
  it('키색과 일치하는 픽셀은 투명(alpha 0), 다른 색은 유지', () => {
    const green = [0, 255, 0, 255]   // 제거 대상
    const red = [255, 0, 0, 255]     // 유지 대상
    const img = makeImageData([green, red])
    applyChromaToImageData(img, { r: 0, g: 255, b: 0 }, 18)
    expect(img.data[3]).toBe(0)      // 초록 픽셀 알파 0
    expect(img.data[7]).toBe(255)    // 빨강 픽셀 알파 유지
  })

  it('허용치가 클수록 더 넓은 색 범위를 제거한다', () => {
    const near = [20, 230, 20, 255]  // 키색에 가깝지만 정확히 일치하진 않음
    const low = makeImageData([near])
    applyChromaToImageData(low, { r: 0, g: 255, b: 0 }, 2)
    const lowAlpha = low.data[3]
    const high = makeImageData([near])
    applyChromaToImageData(high, { r: 0, g: 255, b: 0 }, 40)
    const highAlpha = high.data[3]
    expect(highAlpha).toBeLessThanOrEqual(lowAlpha) // 허용↑ → 더 많이 제거(알파↓)
  })
})
