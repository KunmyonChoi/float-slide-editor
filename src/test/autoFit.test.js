import { describe, it, expect } from 'vitest'
import { estimateCodeHeight, applyAutoFit } from '../core/autoFit'

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
