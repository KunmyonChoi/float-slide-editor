import { describe, it, expect } from 'vitest'
import { SLIDE_LAYOUTS } from '../core/slideLayouts'

describe('slideLayouts — 백지 시작 스캐폴딩', () => {
  const cs = { w: 1280, h: 720 }

  it('빈 슬라이드는 요소 0개', () => {
    const blank = SLIDE_LAYOUTS.find(l => l.id === 'blank')
    expect(blank.build(cs)).toEqual([])
  })

  it('각 레이아웃이 캔버스 범위 내 텍스트 요소를 생성', () => {
    for (const layout of SLIDE_LAYOUTS) {
      const els = layout.build(cs)
      for (const el of els) {
        expect(el.type).toBe('text')
        expect(el.content).toBeTruthy()
        expect(el.x).toBeGreaterThanOrEqual(0)
        expect(el.y).toBeGreaterThanOrEqual(0)
        expect(el.x + el.width).toBeLessThanOrEqual(cs.w + 1)
        expect(el.y + el.height).toBeLessThanOrEqual(cs.h + 1)
        expect(el.styles.fontSize).toMatch(/^\d+px$/)
        expect(el.styles.textAlign).toBeTruthy()
      }
    }
  })

  it('상대 좌표라 다른 비율에서도 범위 내', () => {
    const portrait = { w: 720, h: 1280 }
    const titleEls = SLIDE_LAYOUTS.find(l => l.id === 'title').build(portrait)
    for (const el of titleEls) {
      expect(el.x + el.width).toBeLessThanOrEqual(portrait.w + 1)
      expect(el.y + el.height).toBeLessThanOrEqual(portrait.h + 1)
    }
  })

  it('제목 슬라이드는 제목+부제 2개', () => {
    expect(SLIDE_LAYOUTS.find(l => l.id === 'title').build(cs)).toHaveLength(2)
  })
})
