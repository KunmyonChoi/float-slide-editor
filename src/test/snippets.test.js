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

  it('간단 묶음: 체크리스트/상태칩/키캡/해시칩 존재 + 특성', () => {
    expect(getSnippet('checklistItem').build(cs, theme)[0].content).toContain('✓')
    const chip = getSnippet('statusChip').build(cs, theme)[0]
    expect(chip.styles.borderRadius).toBe('999px')
    expect(chip.content).toContain('●')
    const key = getSnippet('keycap').build(cs, theme)[0]
    expect(key.styles.fontFamily).toContain('monospace')
    expect(key.styles.border).toContain('solid')
    const hash = getSnippet('hashChip').build(cs, theme)[0]
    expect(hash.content).toContain('#')
    expect(hash.styles.color).toBe('#ff0000') // accent
  })

  it('묶음2: 평점/결론박스/섹션헤더/CTA 특성', () => {
    expect(getSnippet('rating').build(cs, theme)[0].content).toContain('★')
    const box = getSnippet('conclusionBox').build(cs, theme)[0]
    expect(box.styles.border).toContain('#ff0000') // accent 테두리
    expect(box.styles.boxShadow).not.toBe('none')
    const bar = getSnippet('sectionHeaderBar').build(cs, theme)[0]
    expect(bar.styles.backgroundColor).toBe('#ff0000')
    expect(bar.styles.textAlign).toBe('left')
    expect(bar.width).toBeGreaterThan(cs.w * 0.8)
    const cta = getSnippet('ctaButton').build(cs, theme)[0]
    expect(cta.styles.borderRadius).toBe('999px')
    expect(cta.styles.backgroundColor).toBe('#ff0000')
  })

  it('묶음3: 대형스탯/스티키/카드/인라인코드 특성', () => {
    const stat = getSnippet('bigStat').build(cs, theme)
    expect(stat.length).toBe(2)
    expect(stat[0].styles.color).toBe('#ff0000') // 숫자 accent
    const sticky = getSnippet('stickyNote').build(cs, theme)[0]
    expect(sticky.rotation).toBe(-3)
    expect(sticky.styles.alignItems).toBe('flex-start') // valign top
    const card = getSnippet('card').build(cs, theme)[0]
    expect(card.type).toBe('shape')
    expect(card.styles.boxShadow).not.toBe('none')
    const code = getSnippet('inlineCode').build(cs, theme)[0]
    expect(code.styles.fontFamily).toContain('monospace')
  })

  it('복합 묶음: 화살표 프로세스/ProsCons/타임라인', () => {
    const ap = getSnippet('arrowProcess').build(cs, theme)
    expect(ap.length).toBe(5)                       // 칩3 + 화살표2
    expect(ap.filter(e => e.content === '→').length).toBe(2)
    const pc = getSnippet('prosCons').build(cs, theme)
    expect(pc.length).toBe(2)
    expect(pc[0].content).toContain('장점')
    expect(pc[1].styles.borderLeft).toContain('#ef4444')
    const tl = getSnippet('timeline').build(cs, theme)
    expect(tl.filter(e => e.type === 'shape').length).toBe(4) // 선1 + 점3
    expect(tl.filter(e => e.type === 'text').length).toBe(6)  // 날짜3 + 설명3
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
