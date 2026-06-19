import { describe, it, expect } from 'vitest'
import { resolveConnectorCurve, resolveConnectorGeometry } from '../core/ConnectorRouting'
import { connectorCurvePath, connectorLabelMid } from '../core/PolyShapeUtils'

const rect = (id, x, y, w = 100, h = 60) => ({ id, type: 'shape', x, y, width: w, height: h })
const byIdOf = (...els) => Object.fromEntries(els.map(e => [e.id, e]))

describe('resolveConnectorCurve — 변 수직 진출/대칭', () => {
  it('좌우 배치(정렬): 동/서 변에서 수평 진출, 직선(제어점 y=끝점 y)', () => {
    const A = rect('A', 0, 0), B = rect('B', 300, 0) // 같은 높이
    const cv = resolveConnectorCurve({ start: { elementId: 'A' }, end: { elementId: 'B' } }, byIdOf(A, B))
    expect(cv.start).toEqual({ x: 100, y: 30 })   // A 동쪽 변
    expect(cv.end).toEqual({ x: 300, y: 30 })     // B 서쪽 변
    // 수평 진출 → 제어점 y가 끝점과 같음(=직선)
    expect(cv.c1.y).toBe(30)
    expect(cv.c2.y).toBe(30)
    expect(cv.c1.x).toBeGreaterThan(cv.start.x)   // 동쪽(바깥)으로
    expect(cv.c2.x).toBeLessThan(cv.end.x)        // 서쪽(바깥)으로
  })

  it('좌우 배치(높이 오프셋): 수평 진출은 유지(대칭 S)', () => {
    const A = rect('A', 0, 0), B = rect('B', 300, 120)
    const cv = resolveConnectorCurve({ start: { elementId: 'A' }, end: { elementId: 'B' } }, byIdOf(A, B))
    expect(cv.start.x).toBe(100)  // A 동쪽 변
    expect(cv.end.x).toBe(300)    // B 서쪽 변
    // 진출은 여전히 수평(제어점이 끝점과 같은 y) → 끝에서 변에 수직
    expect(cv.c1.y).toBe(cv.start.y)
    expect(cv.c2.y).toBe(cv.end.y)
    // 대칭: 양끝 진출 길이 동일
    expect(cv.c1.x - cv.start.x).toBeCloseTo(cv.end.x - cv.c2.x, 6)
  })

  it('상하 배치: 남/북 변에서 수직 진출', () => {
    const A = rect('A', 0, 0), B = rect('B', 0, 300)
    const cv = resolveConnectorCurve({ start: { elementId: 'A' }, end: { elementId: 'B' } }, byIdOf(A, B))
    expect(cv.start).toEqual({ x: 50, y: 60 })   // A 남쪽
    expect(cv.end).toEqual({ x: 50, y: 300 })    // B 북쪽
    expect(cv.c1.x).toBe(50)
    expect(cv.c2.x).toBe(50)
    expect(cv.c1.y).toBeGreaterThan(cv.start.y)  // 아래(바깥)로
  })

  it('자유 끝점도 곡선 폴백 제공', () => {
    const A = rect('A', 0, 0)
    const cv = resolveConnectorCurve({ start: { elementId: 'A' }, end: { point: { x: 400, y: 30 } } }, byIdOf(A))
    expect(cv).toBeTruthy()
    expect(cv.c1).toBeTruthy()
    expect(cv.c2).toBeTruthy()
  })
})

describe('resolveConnectorGeometry — 곡선 라우팅', () => {
  it('routing=curved면 curve(제어점, bbox 상대) 포함, bbox가 곡선을 포함', () => {
    const A = rect('A', 0, 0), B = rect('B', 300, 120)
    const conn = { routing: 'curved', connection: { start: { elementId: 'A' }, end: { elementId: 'B' } } }
    const geo = resolveConnectorGeometry(conn, byIdOf(A, B))
    expect(geo.curve).toBeTruthy()
    expect(geo.points).toHaveLength(2)
    // 제어점/끝점은 bbox 안(0..width, 0..height)
    for (const p of [geo.points[0], geo.points[1], geo.curve.c1, geo.curve.c2]) {
      expect(p.x).toBeGreaterThanOrEqual(-1)
      expect(p.x).toBeLessThanOrEqual(geo.width + 1)
    }
  })

  it('routing 없으면(직선) curve 없음', () => {
    const A = rect('A', 0, 0), B = rect('B', 300, 0)
    const conn = { connection: { start: { elementId: 'A' }, end: { elementId: 'B' } } }
    const geo = resolveConnectorGeometry(conn, byIdOf(A, B))
    expect(geo.curve).toBeUndefined()
  })
})

describe('connectorCurvePath / connectorLabelMid', () => {
  const pts = [{ x: 0, y: 30 }, { x: 200, y: 30 }]
  const curve = { c1: { x: 80, y: 30 }, c2: { x: 120, y: 30 } }

  it('curve 있으면 큐빅(C), 없으면 직선(L)', () => {
    expect(connectorCurvePath(pts, curve).startsWith('M 0 30 C')).toBe(true)
    expect(connectorCurvePath(pts, null)).toBe('M 0 30 L 200 30')
  })

  it('라벨 중점: 직선이면 현의 중점', () => {
    expect(connectorLabelMid(pts, null)).toEqual({ x: 100, y: 30 })
  })

  it('라벨 중점: 직선형 곡선(제어점 일직선)도 가운데', () => {
    const mid = connectorLabelMid(pts, curve)
    expect(mid.x).toBeCloseTo(100, 0)
    expect(mid.y).toBeCloseTo(30, 0)
  })
})
