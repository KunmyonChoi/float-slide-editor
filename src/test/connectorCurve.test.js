import { describe, it, expect } from 'vitest'
import {
  connectorCurveControls,
  connectorCurvePath,
  connectorLabelMid,
  CURVE_STRENGTH,
} from '../core/PolyShapeUtils'

// 현(chord) a→b 기준, 점 p가 어느 쪽인지 부호(외적). 0이면 직선 위.
const side = (a, b, p) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))

describe('connectorCurveControls — 단일 곡선(둥근 엘보)', () => {
  it('점 2개 미만이면 null', () => {
    expect(connectorCurveControls([])).toBeNull()
    expect(connectorCurveControls([{ x: 0, y: 0 }])).toBeNull()
  })

  it('좌우 정렬(높이 같음) → 제어점이 현 위 → 직선', () => {
    const a = { x: 0, y: 50 }, b = { x: 200, y: 50 }
    const { c1, c2 } = connectorCurveControls([a, b])
    expect(c1.y).toBe(50)
    expect(c2.y).toBe(50)
    expect(side(a, b, c1)).toBe(0)
    expect(side(a, b, c2)).toBe(0)
  })

  it('상하 정렬(가로 같음) → 직선', () => {
    const a = { x: 50, y: 0 }, b = { x: 50, y: 200 }
    const { c1, c2 } = connectorCurveControls([a, b])
    expect(c1.x).toBe(50)
    expect(c2.x).toBe(50)
  })

  it('대각(좌상-우하, 가로 우세) → 코너 향해 한 번만 휨(두 제어점이 같은 쪽 = 변곡 없음)', () => {
    const a = { x: 0, y: 0 }, b = { x: 200, y: 150 } // |dx|>|dy| → corner (200,0)
    const { c1, c2 } = connectorCurveControls([a, b])
    expect(c1).toEqual({ x: 100, y: 0 })   // a + (corner-a)*0.5
    expect(c2).toEqual({ x: 200, y: 75 })  // b + (corner-b)*0.5
    // 두 제어점이 현의 같은 쪽 → S자(변곡) 아님
    const s1 = side(a, b, c1), s2 = side(a, b, c2)
    expect(s1).not.toBe(0)
    expect(s1).toBe(s2)
  })

  it('세로 우세 대각 → 세로 코너 경유, 역시 단일 곡선', () => {
    const a = { x: 0, y: 0 }, b = { x: 80, y: 200 } // |dy|>|dx| → corner (0,200)
    const { c1, c2 } = connectorCurveControls([a, b])
    expect(c1).toEqual({ x: 0, y: 100 })
    expect(c2).toEqual({ x: 40, y: 200 })
    const s1 = side(a, b, c1), s2 = side(a, b, c2)
    expect(s1).toBe(s2)
  })

  it('strength로 휨 정도 조절', () => {
    const a = { x: 0, y: 0 }, b = { x: 200, y: 100 }
    const { c1 } = connectorCurveControls([a, b], 0.25)
    expect(c1).toEqual({ x: 50, y: 0 })
  })

  it('같은 점이면 제어점=양끝', () => {
    const a = { x: 5, y: 5 }
    expect(connectorCurveControls([a, { ...a }])).toEqual({ c1: a, c2: a })
  })
})

describe('connectorCurvePath', () => {
  it('곡선은 큐빅 베지어(C) path', () => {
    const d = connectorCurvePath([{ x: 0, y: 0 }, { x: 200, y: 150 }])
    expect(d.startsWith('M 0 0 C')).toBe(true)
    expect(d).toContain('200 150')
  })
  it('점 부족하면 직선 폴백(빈 문자열)', () => {
    expect(connectorCurvePath([{ x: 0, y: 0 }])).toBe('')
  })
})

describe('connectorLabelMid', () => {
  const a = { x: 0, y: 0 }, b = { x: 200, y: 150 }
  it('직선은 현의 중점', () => {
    expect(connectorLabelMid([a, b], false)).toEqual({ x: 100, y: 75 })
  })
  it('좌우 정렬 곡선은 직선처럼 정확히 가운데(호 길이 중점)', () => {
    const mid = connectorLabelMid([{ x: 0, y: 50 }, { x: 200, y: 50 }], true)
    expect(mid.x).toBeCloseTo(100, 1)
    expect(mid.y).toBeCloseTo(50, 1)
  })
  it('대각 곡선 중점은 코너 쪽(위)으로 치우치되 가로는 대략 가운데', () => {
    const mid = connectorLabelMid([a, b], true) // corner (200,0) 쪽으로 휨
    expect(mid.y).toBeLessThan(75)              // 직선 중점(75)보다 위(코너 쪽)
    expect(mid.x).toBeGreaterThan(60)
    expect(mid.x).toBeLessThan(160)
  })
  it('CURVE_STRENGTH 기본값 노출', () => {
    expect(CURVE_STRENGTH).toBe(0.5)
  })
})
