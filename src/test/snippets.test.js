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

  it('KPI 카드: 복합(카드 shape + 숫자/라벨/추세 텍스트)', () => {
    const els = getSnippet('kpiCard').build(cs, theme)
    expect(els.length).toBe(4)
    expect(els[0].type).toBe('shape')          // 카드 배경
    expect(els.filter(e => e.type === 'text').length).toBe(3)
    expect(els.some(e => e.content === '90%')).toBe(true)
    expect(els[1].styles.color).toBe('#ff0000') // 숫자 = theme.accent
  })

  it('단계 카드: 뱃지 + 제목(좌측정렬) + 설명, 테마색 사용', () => {
    const t = { accent: '#ff0000', roles: { title: { color: '#111' }, muted: { color: '#999' }, body: {}, default: {} } }
    const els = getSnippet('stepCard').build(cs, t)
    expect(els.length).toBe(3)
    expect(els[0].styles.backgroundColor).toBe('#ff0000') // 뱃지 accent
    expect(els[0].styles.borderRadius).toBe('50%')
    expect(els[1].styles.color).toBe('#111')               // 제목 = theme title
    expect(els[1].styles.textAlign).toBe('left')
    expect(els[1].styles.justifyContent).toBe('flex-start')
    expect(els[2].styles.color).toBe('#999')               // 설명 = theme muted
  })

  it('세로 단계 카드: 뱃지 위 + 제목/설명 가운데', () => {
    const els = getSnippet('stepCardV').build(cs, theme)
    expect(els.length).toBe(3)
    expect(els[0].styles.borderRadius).toBe('50%')        // 뱃지
    expect(els[1].styles.textAlign).toBe('center')         // 제목 가운데
    expect(els[2].styles.textAlign).toBe('center')         // 설명 가운데
    expect(els[0].y).toBeLessThan(els[1].y)                // 뱃지가 제목 위
  })

  it('코드 블록: 다크 윈도우 + 3색 점 + 모노스페이스 코드', () => {
    const els = getSnippet('codeBlock').build(cs, theme)
    expect(els.length).toBe(3)
    expect(els[0].type).toBe('shape')                      // 윈도우
    expect(els[0].styles.backgroundColor).toBe('#0f172a')  // 다크
    expect(els[1].content).toContain('#ff5f56')            // 빨강 점
    expect(els[2].styles.fontFamily).toContain('monospace')// 코드 모노
    expect(els[2].content).toContain('function')
    expect(els[2].styles.whiteSpace).toBe('pre-wrap')
  })

  it('프로그레스 바: 트랙 + 채움(accent, 더 좁음) + 라벨', () => {
    const els = getSnippet('progressBar').build(cs, theme)
    expect(els.length).toBe(3)
    const [track, fill, label] = els
    expect(track.type).toBe('shape')
    expect(fill.styles.backgroundColor).toBe('#ff0000')   // accent
    expect(fill.width).toBeLessThan(track.width)           // 채움 < 트랙
    expect(track.styles.borderRadius).toBe('999px')
    expect(label.content).toContain('%')
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
