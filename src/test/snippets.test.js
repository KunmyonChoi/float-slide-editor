import { describe, it, expect } from 'vitest'
import { SNIPPETS, getSnippet } from '../core/snippets'

const cs = { w: 1280, h: 720 }
const theme = { accent: '#ff0000', roles: { title: {}, body: {}, default: {} } }

describe('snippets', () => {
  it('필 라벨: 테마 accent 배경 + 라운드 + 중앙 배치', () => {
    const [el] = getSnippet('pill').build(cs, theme)
    expect(el.type).toBe('text')
    expect(el.content).toBe('LABEL')
    expect(el.styles.backgroundColor).toBe('#ff0000')
    expect(el.styles.borderRadius).toBe('999px')
    expect(el.x).toBeGreaterThan(0)
    expect(el.x).toBeLessThan(cs.w)
  })

  it('숫자 뱃지: 원형(50%) + 숫자', () => {
    const [el] = getSnippet('numberBadge').build(cs, theme)
    expect(el.styles.borderRadius).toBe('50%')
    expect(el.content).toBe('1')
    expect(el.width).toBe(el.height) // 정사각 → 원형
  })

  it('accent 없으면 기본 색 폴백', () => {
    const [el] = getSnippet('pill').build(cs, {})
    expect(el.styles.backgroundColor).toBe('#6366f1')
  })

  it('콜아웃: 좌측 컬러바 + 옅은 배경 + 아이콘 본문', () => {
    const [el] = getSnippet('calloutTip').build(cs, theme)
    expect(el.type).toBe('text')
    expect(el.content).toContain('💡')
    expect(el.styles.borderLeft).toContain('solid')
    expect(el.styles.backgroundColor).toContain('rgba')
    expect(el.styles.textAlign).toBe('left')
  })

  it('콜아웃 4종(팁/주의/정보/성공) 모두 존재', () => {
    for (const id of ['calloutTip', 'calloutWarn', 'calloutInfo', 'calloutSuccess']) {
      expect(getSnippet(id)).toBeTruthy()
    }
  })

  it('풀쿼트: 큰 따옴표 포함 리치 텍스트, 가운데 정렬', () => {
    const [el] = getSnippet('pullQuote').build(cs, theme)
    expect(el.isRich).toBe(true)
    expect(el.content).toContain('“')
    expect(el.content).toContain('”')
    expect(el.styles.textAlign).toBe('center')
    expect(el.styles.fontStyle).toBe('italic')
  })

  it('좌측바 인용: 좌측 컬러바(테마 accent) + 투명 배경', () => {
    const [el] = getSnippet('leftBarQuote').build(cs, theme)
    expect(el.styles.borderLeft).toContain('#ff0000') // theme.accent
    expect(el.styles.backgroundColor).toBe('rgba(0,0,0,0)')
    expect(el.styles.textAlign).toBe('left')
  })

  it('모든 스니펫: 고유 id + build 함수', () => {
    const ids = new Set(SNIPPETS.map(s => s.id))
    expect(ids.size).toBe(SNIPPETS.length)
    for (const s of SNIPPETS) {
      expect(typeof s.build).toBe('function')
      expect(Array.isArray(s.build(cs, theme))).toBe(true)
    }
  })
})
