import { describe, it, expect } from 'vitest'
import {
  connectorCurveControls,
  connectorCurvePath,
  connectorLabelMid,
  CURVE_CURVATURE,
} from '../core/PolyShapeUtils'

const A = { x: 0, y: 0 }
const B = { x: 100, y: 0 }

describe('connectorCurveControls', () => {
  it('점 2개 미만이면 null', () => {
    expect(connectorCurveControls([])).toBeNull()
    expect(connectorCurveControls([A])).toBeNull()
  })

  it('수평선: 제어점이 1/3·2/3 지점에서 같은 수직 방향으로 오프셋', () => {
    const { c1, c2 } = connectorCurveControls([A, B])
    expect(c1.x).toBeCloseTo(100 / 3, 3)
    expect(c2.x).toBeCloseTo(200 / 3, 3)
    // 같은 부호(같은 쪽으로 휨) + 0이 아님
    expect(Math.sign(c1.y)).toBe(Math.sign(c2.y))
    expect(c1.y).not.toBe(0)
    expect(Math.abs(c1.y)).toBeCloseTo(100 * CURVE_CURVATURE, 1)
  })

  it('길이 0(같은 점)은 제어점=양끝', () => {
    const { c1, c2 } = connectorCurveControls([A, { ...A }])
    expect(c1).toEqual(A)
    expect(c2).toEqual(A)
  })

  it('오프셋은 상한(160px)으로 제한', () => {
    const far = { x: 100000, y: 0 }
    const { c1 } = connectorCurveControls([A, far])
    expect(Math.abs(c1.y)).toBeLessThanOrEqual(160 + 1e-6)
  })
})

describe('connectorCurvePath', () => {
  it('곡선은 큐빅 베지어(C) path', () => {
    const d = connectorCurvePath([A, B])
    expect(d.startsWith('M 0 0 C')).toBe(true)
    expect(d).toContain('100 0') // 끝점 포함
  })
  it('점 부족하면 직선 폴백', () => {
    expect(connectorCurvePath([A])).toBe('')
  })
})

describe('connectorLabelMid', () => {
  it('직선은 현의 중점', () => {
    expect(connectorLabelMid([A, B], false)).toEqual({ x: 50, y: 0 })
  })
  it('곡선은 t=0.5 베지어 점 — 휘는 쪽으로 치우침', () => {
    const mid = connectorLabelMid([A, B], true)
    expect(mid.x).toBeCloseTo(50, 3) // 대칭이라 x는 중앙
    expect(mid.y).not.toBe(0)        // 곡선 쪽으로 이동
    // B(0.5) = (a + 3c1 + 3c2 + b)/8, 수직 오프셋의 3/4
    expect(Math.abs(mid.y)).toBeCloseTo(100 * CURVE_CURVATURE * 0.75, 1)
  })
})
