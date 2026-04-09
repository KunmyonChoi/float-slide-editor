import { describe, it, expect } from 'vitest'
import { parseTextShadow, serializeTextShadow } from '../core/TextShadowParser'

describe('parseTextShadow', () => {
  it('none → 빈 배열', () => {
    expect(parseTextShadow('none')).toEqual([])
    expect(parseTextShadow('')).toEqual([])
  })

  it('단일 그림자', () => {
    const s = parseTextShadow('2px 3px 4px rgba(0, 0, 0, 0.5)')
    expect(s).toHaveLength(1)
    expect(s[0].offsetX).toBe(2)
    expect(s[0].offsetY).toBe(3)
    expect(s[0].blur).toBe(4)
    expect(s[0].color).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('hex 색상', () => {
    const s = parseTextShadow('1px 1px 2px #ff0000')
    expect(s[0].color).toBe('#ff0000')
  })

  it('다중 그림자', () => {
    const s = parseTextShadow('0px 1px 2px #000, 0px 0px 8px rgba(255, 255, 255, 0.5)')
    expect(s).toHaveLength(2)
  })

  it('음수 offset', () => {
    const s = parseTextShadow('-2px -3px 4px #000')
    expect(s[0].offsetX).toBe(-2)
    expect(s[0].offsetY).toBe(-3)
  })
})

describe('serializeTextShadow', () => {
  it('빈 배열 → none', () => {
    expect(serializeTextShadow([])).toBe('none')
  })

  it('직렬화', () => {
    const css = serializeTextShadow([{ offsetX: 2, offsetY: 3, blur: 4, color: 'rgba(0, 0, 0, 0.5)' }])
    expect(css).toBe('2px 3px 4px rgba(0, 0, 0, 0.5)')
  })

  it('roundtrip', () => {
    const original = '2px 3px 4px rgba(0, 0, 0, 0.5)'
    const parsed = parseTextShadow(original)
    expect(serializeTextShadow(parsed)).toBe(original)
  })
})
