import { describe, it, expect } from 'vitest'
import { parseBoxShadow, serializeBoxShadow } from '../core/BoxShadowParser'

describe('parseBoxShadow', () => {
  it('none → 빈 배열', () => {
    expect(parseBoxShadow('none')).toEqual([])
    expect(parseBoxShadow('')).toEqual([])
  })

  it('단일 그림자', () => {
    const s = parseBoxShadow('0px 4px 8px rgba(0, 0, 0, 0.2)')
    expect(s).toHaveLength(1)
    expect(s[0].offsetX).toBe(0)
    expect(s[0].offsetY).toBe(4)
    expect(s[0].blur).toBe(8)
    expect(s[0].spread).toBe(0)
    expect(s[0].color).toBe('rgba(0, 0, 0, 0.2)')
    expect(s[0].inset).toBe(false)
  })

  it('spread 포함', () => {
    const s = parseBoxShadow('2px 3px 4px 5px #ff0000')
    expect(s[0].offsetX).toBe(2)
    expect(s[0].offsetY).toBe(3)
    expect(s[0].blur).toBe(4)
    expect(s[0].spread).toBe(5)
    expect(s[0].color).toBe('#ff0000')
  })

  it('inset 앞', () => {
    const s = parseBoxShadow('inset 0px 1px 2px #000')
    expect(s[0].inset).toBe(true)
    expect(s[0].offsetY).toBe(1)
  })

  it('다중 그림자', () => {
    const s = parseBoxShadow('0px 4px 8px rgba(0, 0, 0, 0.2), inset 0px 1px 2px rgba(255, 255, 255, 0.1)')
    expect(s).toHaveLength(2)
    expect(s[0].inset).toBe(false)
    expect(s[1].inset).toBe(true)
  })

  it('음수 offset', () => {
    const s = parseBoxShadow('-2px -3px 4px #000')
    expect(s[0].offsetX).toBe(-2)
    expect(s[0].offsetY).toBe(-3)
  })
})

describe('serializeBoxShadow', () => {
  it('빈 배열 → none', () => {
    expect(serializeBoxShadow([])).toBe('none')
  })

  it('단일 그림자', () => {
    const css = serializeBoxShadow([
      { offsetX: 0, offsetY: 4, blur: 8, spread: 0, color: 'rgba(0, 0, 0, 0.2)', inset: false },
    ])
    expect(css).toBe('0px 4px 8px 0px rgba(0, 0, 0, 0.2)')
  })

  it('inset 그림자', () => {
    const css = serializeBoxShadow([
      { offsetX: 0, offsetY: 1, blur: 2, spread: 0, color: '#000', inset: true },
    ])
    expect(css).toContain('inset')
  })

  it('roundtrip', () => {
    const original = '0px 4px 8px 0px rgba(0, 0, 0, 0.2)'
    const parsed = parseBoxShadow(original)
    const serialized = serializeBoxShadow(parsed)
    expect(serialized).toBe(original)
  })
})
