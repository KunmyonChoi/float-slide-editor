import { describe, it, expect } from 'vitest'
import { htmlToTextRuns, cssColorToHex } from '../core/HtmlToTextRuns'

describe('HtmlToTextRuns', () => {
  describe('htmlToTextRuns', () => {
    it('일반 텍스트 → 단일 런', () => {
      const runs = htmlToTextRuns('Hello World', {})
      expect(runs).toHaveLength(1)
      expect(runs[0].text).toBe('Hello World')
    })

    it('빈 입력 → 빈 텍스트 런', () => {
      const runs = htmlToTextRuns('', {})
      expect(runs).toHaveLength(1)
      expect(runs[0].text).toBe('')
    })

    it('<b>/<strong> → bold', () => {
      const runs = htmlToTextRuns('<b>bold</b> normal', {})
      const boldRun = runs.find(r => r.text === 'bold')
      expect(boldRun.options.bold).toBe(true)
      const normalRun = runs.find(r => r.text === ' normal')
      expect(normalRun.options.bold).toBeUndefined()
    })

    it('<i>/<em> → italic', () => {
      const runs = htmlToTextRuns('<em>italic</em>', {})
      expect(runs[0].options.italic).toBe(true)
    })

    it('<u> → underline', () => {
      const runs = htmlToTextRuns('<u>underlined</u>', {})
      expect(runs[0].options.underline).toEqual({ style: 'sng' })
    })

    it('인라인 스타일 color → color 옵션', () => {
      const runs = htmlToTextRuns('<span style="color: #ff0000">red</span>', {})
      expect(runs[0].options.color).toBe('ff0000')
    })

    it('인라인 스타일 font-size → fontSize 옵션 (px→pt)', () => {
      const runs = htmlToTextRuns('<span style="font-size: 32px">big</span>', {})
      expect(runs[0].options.fontSize).toBe(24) // 32 * 0.75 = 24
    })

    it('baseStyles 적용', () => {
      const runs = htmlToTextRuns('text', { color: 'rgb(0, 0, 255)', fontSize: '20px' })
      expect(runs[0].options.color).toBe('0000ff')
      expect(runs[0].options.fontSize).toBe(15) // 20 * 0.75
    })

    it('<br> → 줄바꿈', () => {
      const runs = htmlToTextRuns('line1<br>line2', {})
      const texts = runs.map(r => r.text)
      expect(texts).toContain('\n')
    })

    it('블록 요소(<div>) → 줄바꿈 포함', () => {
      const runs = htmlToTextRuns('<div>block1</div><div>block2</div>', {})
      const texts = runs.map(r => r.text).join('')
      expect(texts).toContain('\n')
    })

    it('중첩 서식 (<b><i>)', () => {
      const runs = htmlToTextRuns('<b><i>bold-italic</i></b>', {})
      expect(runs[0].options.bold).toBe(true)
      expect(runs[0].options.italic).toBe(true)
    })

    it('font-weight:700 → bold', () => {
      const runs = htmlToTextRuns('<span style="font-weight:700">heavy</span>', {})
      expect(runs[0].options.bold).toBe(true)
    })
  })

  describe('cssColorToHex', () => {
    it('#hex 6자리 → 그대로', () => {
      expect(cssColorToHex('#ff0000')).toBe('ff0000')
    })

    it('#hex 3자리 → 6자리 확장', () => {
      expect(cssColorToHex('#f00')).toBe('ff0000')
    })

    it('rgb() → hex', () => {
      expect(cssColorToHex('rgb(255, 128, 0)')).toBe('ff8000')
    })

    it('rgba() → hex (alpha 무시)', () => {
      expect(cssColorToHex('rgba(0, 0, 0, 0.5)')).toBe('000000')
    })

    it('null → undefined', () => {
      expect(cssColorToHex(null)).toBeUndefined()
    })
  })
})
