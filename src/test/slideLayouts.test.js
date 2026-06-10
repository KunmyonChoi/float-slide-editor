import { describe, it, expect } from 'vitest'
import { SLIDE_LAYOUTS, carryLayoutContent } from '../core/slideLayouts'

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

describe('carryLayoutContent — 레이아웃 변환 시 내용 이어받기', () => {
  const cs = { w: 1280, h: 720 }
  const build = (id) => SLIDE_LAYOUTS.find(l => l.id === id).build(cs)

  it('기존이 없으면 스펙 그대로(기본 플레이스홀더)', () => {
    const out = carryLayoutContent([], build('title'))
    expect(out.map(s => s.content)).toEqual(['제목을 입력하세요', '부제목'])
  })

  it('제목→두 단: title은 정확 매칭으로 유지', () => {
    const old = [{ layoutRole: 'title', content: '나의 발표' }, { layoutRole: 'subtitle', content: '2026' }]
    const out = carryLayoutContent(old, build('twoColumn'))
    expect(out.find(s => s.layoutRole === 'title').content).toBe('나의 발표')
    // subtitle은 두 단에 없으므로 버려짐, left/right는 기본값
    expect(out.find(s => s.layoutRole === 'left').content).toBe('왼쪽 내용')
  })

  it('제목+내용→두 단: body 내용이 본문 풀(FIFO)로 left에 이어받음', () => {
    const old = [{ layoutRole: 'title', content: 'T' }, { layoutRole: 'body', content: '본문 텍스트' }]
    const out = carryLayoutContent(old, build('twoColumn'))
    expect(out.find(s => s.layoutRole === 'left').content).toBe('본문 텍스트')
    expect(out.find(s => s.layoutRole === 'right').content).toBe('오른쪽 내용')
  })

  it('두 단→제목+내용: 첫 본문(left)만 body로, right는 버려짐', () => {
    const old = [
      { layoutRole: 'title', content: 'T' },
      { layoutRole: 'left', content: 'L' },
      { layoutRole: 'right', content: 'R' },
    ]
    const out = carryLayoutContent(old, build('titleContent'))
    expect(out.find(s => s.layoutRole === 'body').content).toBe('L')
  })

  it('섹션(title)→제목 슬라이드(title): title 이어받음, subtitle 기본', () => {
    const old = [{ layoutRole: 'title', content: '1장' }]
    const out = carryLayoutContent(old, build('title'))
    expect(out.find(s => s.layoutRole === 'title').content).toBe('1장')
    expect(out.find(s => s.layoutRole === 'subtitle').content).toBe('부제목')
  })
})
