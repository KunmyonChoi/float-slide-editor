import { describe, it, expect } from 'vitest'
import { estimateCodeHeight, applyAutoFit, parsePadding } from '../core/autoFit'

describe('estimateCodeHeight', () => {
  it('줄 수에 비례', () => {
    const h1 = estimateCodeHeight('a', { width: 500, fontSizePx: 15 })
    const h3 = estimateCodeHeight('a\nb\nc', { width: 500, fontSizePx: 15 })
    expect(h3).toBeGreaterThan(h1)
    expect(h3).toBeCloseTo(h1 * 3, -1)
  })
  it('폭 좁으면 긴 줄이 래핑되어 더 높아짐', () => {
    const long = 'x'.repeat(200)
    const wide = estimateCodeHeight(long, { width: 800, fontSizePx: 15 })
    const narrow = estimateCodeHeight(long, { width: 120, fontSizePx: 15 })
    expect(narrow).toBeGreaterThan(wide)
  })
})

describe('parsePadding', () => {
  it('1~4값 단축 표기 모두 처리', () => {
    expect(parsePadding('8px')).toEqual({ top: 8, right: 8, bottom: 8, left: 8 })
    expect(parsePadding('10px 20px')).toEqual({ top: 10, right: 20, bottom: 10, left: 20 })
    expect(parsePadding('46px 20px 14px 20px')).toEqual({ top: 46, right: 20, bottom: 14, left: 20 })
    expect(parsePadding('')).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(parsePadding(undefined)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe('applyAutoFit', () => {
  const mk = () => [
    { id: 'win', afContainer: true, afPad: { top: 46, right: 20, bottom: 14, left: 20 }, afGap: 0, groupId: 'g', x: 100, y: 100, width: 560, height: 220, type: 'shape' },
    { id: 'dots', groupId: 'g', x: 116, y: 112, width: 90, height: 18, type: 'text' },
    { id: 'code', afContent: true, autoHeight: true, isCode: true, code: 'line1\nline2\nline3\nline4\nline5\nline6', groupId: 'g', x: 120, y: 146, width: 520, height: 60, type: 'text', styles: { fontSize: '15px', lineHeight: '1.6' } },
  ]

  it('코드가 길면 컨테이너 높이가 늘어나고 콘텐츠 폭/위치 정렬', () => {
    const out = applyAutoFit(mk())
    const win = out.find(e => e.id === 'win')
    const code = out.find(e => e.id === 'code')
    expect(code.height).toBeGreaterThan(60)          // 6줄 → 높이 증가
    expect(code.x).toBe(120)                          // container.x + padLeft(20)
    expect(code.width).toBe(520)                      // container.width - 40
    // 컨테이너 = padTop + code + padBottom
    expect(win.height).toBe(46 + code.height + 14)
  })

  it('헤더(dots)는 건드리지 않음', () => {
    const out = applyAutoFit(mk())
    const dots = out.find(e => e.id === 'dots')
    expect(dots.y).toBe(112)
    expect(dots.height).toBe(18)
  })

  it('컨테이너 없으면 변경 없음(같은 배열)', () => {
    const els = [{ id: 'a', groupId: 'g', x: 0, y: 0, width: 10, height: 10 }]
    expect(applyAutoFit(els)).toBe(els)
  })

  it('단독(그룹 없음) autoHeight 코드 요소: 패딩 포함 높이로 자체 신축', () => {
    const els = [
      { id: 'code', autoHeight: true, isCode: true, code: 'l1\nl2\nl3\nl4\nl5\nl6',
        x: 100, y: 100, width: 560, height: 220, type: 'text',
        styles: { fontSize: '15px', lineHeight: '1.6', padding: '46px 20px 14px 20px' } },
    ]
    const out = applyAutoFit(els)
    const code = out.find(e => e.id === 'code')
    // 6줄 코드 높이 + 상단46 + 하단14 — 추정값이 패딩을 포함해야 함
    const body = estimateCodeHeight('l1\nl2\nl3\nl4\nl5\nl6', { width: 520, fontSizePx: 15, lineHeightRatio: 1.6 })
    expect(code.height).toBe(body + 46 + 14)
  })

  it('그룹 해제된 afContent 잔여 요소는 단독 루프가 건드리지 않음', () => {
    // afContainer 스니펫을 ungroup하면 afContent 텍스트에 groupId만 빠지고 autoHeight/afContent는 남는다.
    // 자기 패딩이 없어(0) 0높이로 줄면 윈도우와 분리되므로 단독 루프 대상에서 제외돼야 한다.
    const els = [
      { id: 'orphan', afContent: true, autoHeight: true, isCode: true, code: 'l1\nl2\nl3',
        x: 0, y: 0, width: 300, height: 80, type: 'text', styles: { fontSize: '14px', lineHeight: '1.6' } },
    ]
    expect(applyAutoFit(els)).toBe(els) // 변경 없음(같은 배열)
  })

  it('단독 autoHeight: measured(scrollHeight) 주어지면 그대로 사용', () => {
    const els = [
      { id: 'code', autoHeight: true, isCode: true, code: 'x', x: 0, y: 0, width: 300, height: 100,
        type: 'text', styles: { fontSize: '15px', lineHeight: '1.6', padding: '46px 20px 14px 20px' } },
    ]
    const out = applyAutoFit(els, { code: 137 })
    expect(out.find(e => e.id === 'code').height).toBe(137)
  })

  it('비-코드 콘텐츠도 <br> 줄바꿈을 줄 수로 인식해 신축', () => {
    const els = [
      { id: 'win', afContainer: true, afPad: { top: 14, right: 16, bottom: 14, left: 16 }, afGap: 0, groupId: 'g', x: 0, y: 0, width: 300, height: 60, type: 'shape' },
      { id: 'txt', afContent: true, autoHeight: true, isRich: true, content: 'a<br>b<br>c<br>d<br>e', groupId: 'g', x: 16, y: 14, width: 268, height: 30, type: 'text', styles: { fontSize: '14px', lineHeight: '1.6' } },
    ]
    const out = applyAutoFit(els)
    const txt = out.find(e => e.id === 'txt')
    expect(txt.height).toBeGreaterThan(30) // 5줄
  })
})
