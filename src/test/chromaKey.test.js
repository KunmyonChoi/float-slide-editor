import { describe, it, expect } from 'vitest'
import { colorDist, pixelAlpha, MAX_COLOR_DIST, applyChromaToImageData, applyChromaKeysToImageData, despillImageData, chromaEntries } from '../core/chromaKey'

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

  it('feather(경계)는 퍼센트 단위 — 0이면 하드 엣지(NaN 없음)', () => {
    // 경계 안쪽 픽셀: feather 0이어도 알파가 NaN이 아니라 0이어야 한다.
    const inside = [0, 250, 0, 255] // 키색에 매우 근접
    const img = makeImageData([inside])
    applyChromaToImageData(img, { r: 0, g: 255, b: 0 }, 20, 0)
    expect(Number.isNaN(img.data[3])).toBe(false)
    expect(img.data[3]).toBe(0)
  })
})

describe('다중 키 크로마키 (1차→2차 순차)', () => {
  it('여러 키 중 하나라도 일치하는 픽셀이 제거된다', () => {
    const green = [0, 255, 0, 255]   // 1차 대상
    const blue = [0, 0, 255, 255]    // 2차 대상(잔류색)
    const red = [255, 0, 0, 255]     // 유지
    const img = makeImageData([green, blue, red])
    applyChromaKeysToImageData(img, [
      { key: { r: 0, g: 255, b: 0 }, tolerance: 10 },
      { key: { r: 0, g: 0, b: 255 }, tolerance: 10 },
    ])
    expect(img.data[3]).toBe(0)    // 초록 제거
    expect(img.data[7]).toBe(0)    // 파랑(잔류) 제거
    expect(img.data[11]).toBe(255) // 빨강 유지
  })

  it('key 없는 항목은 건너뛴다(자동 추정은 호출부 책임)', () => {
    const green = [0, 255, 0, 255]
    const img = makeImageData([green])
    applyChromaKeysToImageData(img, [{ key: null, tolerance: 10 }])
    expect(img.data[3]).toBe(255) // 키 없음 → 변화 없음
  })

  it('despill: 전경의 녹색 끼를 중립 쪽으로 낮춘다(강도 100=완전)', () => {
    // 녹색 스필이 묻은 피부톤 픽셀(녹색이 r,b 평균보다 높음)
    const skin = [200, 180, 120, 255] // limit=(200+120)/2=160, g=180>160
    const img = makeImageData([skin])
    despillImageData(img, { r: 0, g: 255, b: 0 }, 100)
    expect(img.data[1]).toBe(160)  // g가 한계(160)까지 내려감
    expect(img.data[0]).toBe(200)  // r 불변
    expect(img.data[2]).toBe(120)  // b 불변
  })

  it('despill: 강도 0 또는 스필 없는 픽셀은 그대로', () => {
    const noSpill = [200, 100, 120, 255] // g(100) < limit(160) → 변화 없음
    const img = makeImageData([noSpill])
    despillImageData(img, { r: 0, g: 255, b: 0 }, 100)
    expect(img.data[1]).toBe(100)
    const img2 = makeImageData([[200, 180, 120, 255]])
    despillImageData(img2, { r: 0, g: 255, b: 0 }, 0) // 강도 0
    expect(img2.data[1]).toBe(180)
  })

  it('despill: 블루스크린이면 파란 채널을 보정한다', () => {
    const px = [120, 140, 220, 255] // limit=(120+140)/2=130, b=220>130
    const img = makeImageData([px])
    despillImageData(img, { r: 0, g: 0, b: 255 }, 100)
    expect(img.data[2]).toBe(130) // b 보정
    expect(img.data[0]).toBe(120)
    expect(img.data[1]).toBe(140)
  })

  it('chromaEntries: 구버전 단일 키를 배열로 정규화', () => {
    const legacy = chromaEntries({ enabled: true, key: { r: 1, g: 2, b: 3 }, tolerance: 25, feather: 5 })
    expect(legacy).toHaveLength(1)
    expect(legacy[0]).toMatchObject({ key: { r: 1, g: 2, b: 3 }, tolerance: 25, feather: 5 })
    // 신버전 keys는 그대로
    const multi = chromaEntries({ enabled: true, keys: [{ key: null, tolerance: 18 }, { key: { r: 9, g: 9, b: 9 }, tolerance: 12 }] })
    expect(multi).toHaveLength(2)
    // 빈 설정도 최소 1개 보장
    expect(chromaEntries(null)).toHaveLength(1)
  })
})
