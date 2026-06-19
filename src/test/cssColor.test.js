import { describe, it, expect } from 'vitest'
import { cssColorToRgba, cssColorToHex } from '../core/CssColor'

describe('CssColor', () => {
  it('hex 3/6/8자리', () => {
    expect(cssColorToHex('#abc')).toBe('aabbcc')
    expect(cssColorToHex('#FF5B59')).toBe('ff5b59')
    expect(cssColorToRgba('#80808080')).toEqual([128, 128, 128, expect.closeTo(0.5, 0.01)])
  })

  it('rgb / rgba', () => {
    expect(cssColorToHex('rgb(255, 91, 89)')).toBe('ff5b59')
    expect(cssColorToRgba('rgba(0, 0, 0, 0)')).toEqual([0, 0, 0, 0])
  })

  it('oklch → sRGB (Tailwind v4)', () => {
    // 백엔드(gradient.py)와 동일: oklch(0.92 0.2 130) ≈ 녹색 계열
    const rgba = cssColorToRgba('oklch(0.92 0.2 130)')
    expect(rgba).not.toBeNull()
    expect(rgba[1]).toBeGreaterThan(rgba[0]) // G > R
    expect(rgba[1]).toBeGreaterThan(rgba[2]) // G > B
  })

  it('oklch with alpha', () => {
    const rgba = cssColorToRgba('oklch(0.72 0.22 25 / 0.55)')
    expect(rgba).not.toBeNull()
    expect(rgba[3]).toBeCloseTo(0.55, 2)
  })

  it('transparent / named', () => {
    expect(cssColorToRgba('transparent')).toEqual([0, 0, 0, 0])
    expect(cssColorToHex('white')).toBe('ffffff')
    expect(cssColorToHex('red')).toBe('ff0000')
  })

  it('미지원 색상은 null/undefined', () => {
    expect(cssColorToRgba('not-a-color')).toBeNull()
    expect(cssColorToHex('')).toBeUndefined()
  })
})
