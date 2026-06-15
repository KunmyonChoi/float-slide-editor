import { describe, it, expect } from 'vitest'
import { bumpFontSizePx, setFontSizeUniformPx, stripInlineFormatting, FORMAT_STRIP } from '../core/TextStyleScope'

describe('bumpFontSizePx — 상대 증감(위계 유지)', () => {
  it('비-rich: base만 증가', () => {
    const r = bumpFontSizePx('Hello', false, 16, 4)
    expect(r.fontSize).toBe('20px')
    expect(r.content).toBe('Hello')
  })

  it('rich: base와 인라인 font-size 모두 +N (간격 유지)', () => {
    const html = '<span style="font-size: 24px">Big</span> normal'
    const r = bumpFontSizePx(html, true, 16, 4)
    expect(r.fontSize).toBe('20px')          // base 16+4
    expect(r.content).toContain('font-size: 28px') // 24+4 → 위계 유지(28 vs 20)
  })

  it('음수 델타도 적용, 최소값 클램프', () => {
    const html = '<span style="font-size: 10px">x</span>'
    const r = bumpFontSizePx(html, true, 16, -10, { min: 8 })
    expect(r.fontSize).toBe('8px')   // 16-10=6 → 8 클램프
    expect(r.content).toContain('font-size: 8px') // 10-10=0 → 8 클램프
  })
})

describe('setFontSizeUniformPx — 절대 통일', () => {
  it('인라인 font-size 제거 + base 설정 → 전체 동일', () => {
    const html = '<span style="font-size: 24px">Big</span> normal'
    const r = setFontSizeUniformPx(html, true, 18)
    expect(r.fontSize).toBe('18px')
    expect(r.content).not.toContain('font-size')
    expect(r.content).toContain('Big')
  })

  it('font-size 외 다른 인라인 스타일은 보존', () => {
    const html = '<span style="font-size: 24px; color: red">x</span>'
    const r = setFontSizeUniformPx(html, true, 18)
    expect(r.content).toContain('color: red')
    expect(r.content).not.toContain('font-size')
  })

  it('비-rich: content 유지, base만', () => {
    const r = setFontSizeUniformPx('plain', false, 30)
    expect(r.content).toBe('plain')
    expect(r.fontSize).toBe('30px')
  })
})

describe('stripInlineFormatting — 전체 서식 통일', () => {
  it('굵게: font-weight 인라인 제거 + <b>/<strong> unwrap', () => {
    const html = '<b>A</b><span style="font-weight: 700">B</span>C'
    const out = stripInlineFormatting(html, true, FORMAT_STRIP.bold)
    expect(out).not.toContain('<b>')
    expect(out).not.toContain('font-weight')
    expect(out).toContain('A')
    expect(out).toContain('B')
    expect(out).toContain('C')
  })

  it('이탤릭: <i>/<em> unwrap + font-style 제거', () => {
    const html = '<i>x</i><em>y</em><span style="font-style: italic">z</span>'
    const out = stripInlineFormatting(html, true, FORMAT_STRIP.italic)
    expect(out).not.toMatch(/<i>|<em>/)
    expect(out).not.toContain('font-style')
  })

  it('비-rich/빈 값은 원본 유지', () => {
    expect(stripInlineFormatting('plain', false, FORMAT_STRIP.bold)).toBe('plain')
    expect(stripInlineFormatting('', true, FORMAT_STRIP.bold)).toBe('')
  })

  it('다른 서식은 보존 (굵게 제거해도 색은 남음)', () => {
    const html = '<span style="font-weight: 700; color: red">x</span>'
    const out = stripInlineFormatting(html, true, FORMAT_STRIP.bold)
    expect(out).toContain('color: red')
    expect(out).not.toContain('font-weight')
  })
})
