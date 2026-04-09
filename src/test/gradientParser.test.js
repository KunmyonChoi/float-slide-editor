import { describe, it, expect } from 'vitest'
import { parseGradient, serializeGradient } from '../core/GradientParser'

describe('parseGradient', () => {
  it('none 반환 — 빈 값', () => {
    expect(parseGradient('')).toEqual({ type: 'none', angle: 180, stops: [] })
    expect(parseGradient('none')).toEqual({ type: 'none', angle: 180, stops: [] })
  })

  it('linear-gradient — deg 각도', () => {
    const g = parseGradient('linear-gradient(135deg, #ff0000 0%, #0000ff 100%)')
    expect(g.type).toBe('linear')
    expect(g.angle).toBe(135)
    expect(g.stops).toHaveLength(2)
    expect(g.stops[0].color).toBe('#ff0000')
    expect(g.stops[0].position).toBe(0)
    expect(g.stops[1].color).toBe('#0000ff')
    expect(g.stops[1].position).toBe(100)
  })

  it('linear-gradient — to direction', () => {
    const g = parseGradient('linear-gradient(to right, red 0%, blue 100%)')
    expect(g.type).toBe('linear')
    expect(g.angle).toBe(90)
  })

  it('linear-gradient — rgba 색상', () => {
    const g = parseGradient('linear-gradient(180deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 0.5) 100%)')
    expect(g.stops[0].color).toBe('rgba(255, 0, 0, 1)')
    expect(g.stops[1].color).toBe('rgba(0, 0, 255, 0.5)')
  })

  it('linear-gradient — 3개 스톱', () => {
    const g = parseGradient('linear-gradient(90deg, red 0%, green 50%, blue 100%)')
    expect(g.stops).toHaveLength(3)
    expect(g.stops[1].position).toBe(50)
  })

  it('radial-gradient', () => {
    const g = parseGradient('radial-gradient(circle, #ff0000 0%, #0000ff 100%)')
    expect(g.type).toBe('radial')
    expect(g.stops).toHaveLength(2)
  })

  it('위치 없는 스톱 — 균등 배분', () => {
    const g = parseGradient('linear-gradient(180deg, red, green, blue)')
    expect(g.stops[0].position).toBe(0)
    expect(g.stops[2].position).toBe(100)
    expect(g.stops[1].position).toBeGreaterThan(0)
    expect(g.stops[1].position).toBeLessThan(100)
  })
})

describe('serializeGradient', () => {
  it('none', () => {
    expect(serializeGradient({ type: 'none', angle: 0, stops: [] })).toBe('none')
  })

  it('linear', () => {
    const css = serializeGradient({
      type: 'linear', angle: 135,
      stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }],
    })
    expect(css).toBe('linear-gradient(135deg, #ff0000 0%, #0000ff 100%)')
  })

  it('radial', () => {
    const css = serializeGradient({
      type: 'radial', angle: 0,
      stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }],
    })
    expect(css).toBe('radial-gradient(circle, #ff0000 0%, #0000ff 100%)')
  })

  it('roundtrip', () => {
    const original = 'linear-gradient(45deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 0.5) 100%)'
    const parsed = parseGradient(original)
    const serialized = serializeGradient(parsed)
    const reparsed = parseGradient(serialized)
    expect(reparsed.type).toBe(parsed.type)
    expect(reparsed.angle).toBe(parsed.angle)
    expect(reparsed.stops).toHaveLength(parsed.stops.length)
  })
})
