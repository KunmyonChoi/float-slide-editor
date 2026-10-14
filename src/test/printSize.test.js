import { describe, it, expect } from 'vitest'
import {
  MM_PER_IN, BLEED_MM, SAFE_MM, PRINT_FORMATS,
  swap, dpiForDistance, dpiFor, scaleForDpi, canvasForPrint,
  ratioMatches, printGuides, minFontPx, minLinePx, parseMm,
} from '../core/printSize'

// 이 세션에서 실제로 만든 부스 포스터. 숫자가 손으로 계산한 값과 맞는지 못박는다.
const BOOTH = { w: 750, h: 1250 }

describe('canvasForPrint — mm에서 캔버스를 역산', () => {
  it('부스 포스터 750×1250mm → 2250×3750 (3px/mm)', () => {
    expect(canvasForPrint(BOOTH)).toEqual({ w: 2250, h: 3750, ppmm: 3 })
  })

  it('작은 규격도 같은 3px/mm — 상한이 아니라 목표 해상도가 정한다', () => {
    expect(canvasForPrint({ w: 210, h: 297 })).toEqual({ w: 630, h: 891, ppmm: 3 })
  })

  it('목표 해상도를 올리면 px/mm도 올라간다', () => {
    // 300dpi를 2배로 내리려면 ppmm ≈ 5.9 → 상한 4에서 멈춘다
    expect(canvasForPrint(BOOTH, { targetDpi: 300 }).ppmm).toBe(4)
    // 100dpi면 ppmm ≈ 2
    expect(canvasForPrint(BOOTH, { targetDpi: 100 }).ppmm).toBe(2)
  })

  it('큰 규격은 상한에 걸려 px/mm이 자동으로 내려간다', () => {
    const a0 = canvasForPrint({ w: 841, h: 1189 }, { maxW: 3000, maxH: 4000 })
    expect(a0.ppmm).toBe(3)
    expect(a0.w).toBe(2523)
  })

  it('상한이 아주 작으면 비율을 지키며 들어가는 최대 크기로', () => {
    const r = canvasForPrint(BOOTH, { maxW: 600, maxH: 600 })
    expect(r.w / r.h).toBeCloseTo(750 / 1250, 3)
    expect(r.h).toBeLessThanOrEqual(600)
  })

  it('값이 없으면 null', () => {
    expect(canvasForPrint(null)).toBeNull()
    expect(canvasForPrint({ w: 0, h: 10 })).toBeNull()
  })
})

describe('dpiFor / scaleForDpi — 해상도는 내보내기에서 만든다', () => {
  it('2250px 캔버스를 2배로 내보내면 750mm에서 152dpi', () => {
    expect(dpiFor(2250, 750, 2)).toBeCloseTo(152.4, 1)
  })

  it('1배는 76dpi — 그대로 인쇄하면 모자란다', () => {
    expect(dpiFor(2250, 750, 1)).toBeCloseTo(76.2, 1)
  })

  it('150dpi를 내려면 2배', () => {
    expect(scaleForDpi(2250, 750, 150)).toBe(2)
  })

  it('300dpi를 내려면 4배 — 큰 규격에서 이 값이 경고 신호다', () => {
    expect(scaleForDpi(2250, 750, 300)).toBe(4)
  })

  it('배율은 정수로 올린다 — 소수 배율은 캡처 가장자리가 흐려진다', () => {
    expect(Number.isInteger(scaleForDpi(2250, 750, 200))).toBe(true)
    expect(scaleForDpi(2250, 750, 200)).toBe(3)
  })

  it('값이 없으면 안전한 기본값', () => {
    expect(dpiFor(0, 750, 2)).toBe(0)
    expect(scaleForDpi(2250, 0, 150)).toBe(1)
  })
})

describe('dpiForDistance — 멀리 볼수록 낮은 해상도로 충분하다', () => {
  it('0.3m 손에 드는 인쇄물 → 300', () => expect(dpiForDistance(0.3)).toBe(300))
  it('1.5m 부스 포스터 → 150', () => expect(dpiForDistance(1.5)).toBe(150))
  it('3m 대형 패널 → 100', () => expect(dpiForDistance(3)).toBe(100))
  it('20m 현수막 → 72', () => expect(dpiForDistance(20)).toBe(72))
})

describe('ratioMatches — 비율이 어긋나면 늘어나거나 잘린다', () => {
  it('2250×3750과 750×1250은 같은 3:5', () => {
    expect(ratioMatches({ w: 2250, h: 3750 }, BOOTH)).toBe(true)
  })

  it('1920×1080 캔버스에 750×1250 인쇄는 어긋난다', () => {
    expect(ratioMatches({ w: 1920, h: 1080 }, BOOTH)).toBe(false)
  })
})

describe('printGuides — 재단 여백과 안전 영역', () => {
  it('3px/mm에서 재단 3mm=9px · 안전 50mm=150px', () => {
    expect(printGuides({ w: 2250, h: 3750 }, BOOTH)).toEqual({ ppmm: 3, bleed: 9, safe: 150 })
  })

  it('기본값이 인쇄소 관행과 맞는다', () => {
    expect(BLEED_MM).toBe(3)
    expect(SAFE_MM).toBe(50)
  })
})

describe('minFontPx / minLinePx — 거리가 치수를 정한다', () => {
  it('3px/mm · 1.5m에서 최소 글자 26px (글자높이 6mm)', () => {
    expect(minFontPx(3, 1.5)).toBe(26)
  })

  it('3px/mm · 1.5m에서 최소 선 6px (2mm)', () => {
    expect(minLinePx(3, 1.5)).toBe(6)
  })

  it('거리가 멀수록 커진다', () => {
    expect(minFontPx(3, 3)).toBeGreaterThan(minFontPx(3, 1.5))
    expect(minLinePx(3, 5)).toBeGreaterThan(minLinePx(3, 2))
  })
})

describe('parseMm', () => {
  it('750x1250 · 750×1250 둘 다 읽는다', () => {
    expect(parseMm('750x1250')).toEqual({ w: 750, h: 1250 })
    expect(parseMm('750×1250')).toEqual({ w: 750, h: 1250 })
    expect(parseMm(' 750 x 1250 ')).toEqual({ w: 750, h: 1250 })
  })

  it('소수도 읽는다', () => {
    expect(parseMm('210.5x297')).toEqual({ w: 210.5, h: 297 })
  })

  it('못 읽으면 null', () => {
    expect(parseMm('')).toBeNull()
    expect(parseMm('750')).toBeNull()
    expect(parseMm('0x100')).toBeNull()
    expect(parseMm(null)).toBeNull()
  })
})

describe('규격 목록', () => {
  it('전부 세로가 긴 값으로 적혀 있다 — 가로는 swap()으로 뒤집는다', () => {
    for (const f of PRINT_FORMATS) expect(f.h).toBeGreaterThan(f.w)
  })

  it('swap으로 가로 전환', () => {
    expect(swap({ w: 750, h: 1250 })).toEqual({ w: 1250, h: 750 })
  })

  it('A 계열 치수가 맞다', () => {
    const a4 = PRINT_FORMATS.find(f => f.id === 'a4')
    expect(a4).toMatchObject({ w: 210, h: 297 })
    expect(MM_PER_IN).toBe(25.4)
  })
})
