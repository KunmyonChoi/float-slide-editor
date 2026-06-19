import { describe, it, expect, beforeEach } from 'vitest'
import {
  CONNECTION_ANCHORS,
  isFixedEnd,
  anchorPoint,
  connectionPoints,
  nearestConnectionPoint,
  resolveConnectorEndpoints,
  resolveConnectorCurve,
  resolveConnectors,
} from '../core/ConnectorRouting'
import { useFlatStore } from '../store/flatStore'

const rect = (id, x, y, w = 100, h = 60) => ({ id, type: 'shape', x, y, width: w, height: h })
const byIdOf = (...els) => Object.fromEntries(els.map(e => [e.id, e]))

describe('연결점 모델', () => {
  it('8개 연결점(4변+4모서리)', () => {
    expect(CONNECTION_ANCHORS).toHaveLength(8)
    const A = rect('A', 10, 20, 100, 60)
    const pts = connectionPoints(A)
    expect(pts).toHaveLength(8)
    // 동쪽 변 중점 (1,0.5) → (110, 50)
    const e = pts.find(p => p.fx === 1 && p.fy === 0.5)
    expect(e).toMatchObject({ x: 110, y: 50 })
    // 남동 모서리 (1,1) → (110, 80)
    const se = pts.find(p => p.fx === 1 && p.fy === 1)
    expect(se).toMatchObject({ x: 110, y: 80 })
  })

  it('anchorPoint / isFixedEnd', () => {
    expect(anchorPoint(rect('A', 0, 0), 0.5, 1)).toEqual({ x: 50, y: 60 })
    expect(isFixedEnd({ elementId: 'A', fx: 0, fy: 0 })).toBe(true)
    expect(isFixedEnd({ elementId: 'A' })).toBe(false)
    expect(isFixedEnd({ point: { x: 1, y: 2 } })).toBe(false)
  })

  it('nearestConnectionPoint: threshold 내/외', () => {
    const A = rect('A', 0, 0, 100, 60)
    expect(nearestConnectionPoint(102, 30, A, 10)).toMatchObject({ fx: 1, fy: 0.5 }) // 동쪽 근처
    expect(nearestConnectionPoint(50, 30, A, 10)).toBeNull() // 중앙(연결점 없음)
  })
})

describe('고정 연결점 기하', () => {
  it('resolveConnectorEndpoints: 고정 끝점은 정확히 그 점', () => {
    const A = rect('A', 0, 0, 100, 60), B = rect('B', 300, 200, 100, 60)
    const eps = resolveConnectorEndpoints(
      { start: { elementId: 'A', fx: 1, fy: 0.5 }, end: { elementId: 'B', fx: 0, fy: 0.5 } },
      byIdOf(A, B))
    expect(eps.start).toEqual({ x: 100, y: 30 }) // A 동쪽
    expect(eps.end).toEqual({ x: 300, y: 230 })  // B 서쪽
  })

  it('resolveConnectorCurve: 고정점에서 변 법선으로 수직 진출', () => {
    const A = rect('A', 0, 0, 100, 60), B = rect('B', 300, 0, 100, 60)
    const cv = resolveConnectorCurve(
      { start: { elementId: 'A', fx: 1, fy: 0.5 }, end: { elementId: 'B', fx: 0, fy: 0.5 } },
      byIdOf(A, B))
    expect(cv.start).toEqual({ x: 100, y: 30 })
    expect(cv.c1.y).toBe(30)                 // 동쪽 진출 → 수평(y 동일)
    expect(cv.c1.x).toBeGreaterThan(100)     // 바깥(동)으로
    expect(cv.c2.x).toBeLessThan(300)        // B는 서쪽 바깥으로
  })

  it('모서리 고정점은 상대편 우세축으로 진출', () => {
    const A = rect('A', 0, 0, 100, 60), B = rect('B', 400, 20, 100, 60)
    // A의 남동 모서리(1,1)에서 B(오른쪽)로 → 가로 우세 → 동쪽 진출
    const cv = resolveConnectorCurve(
      { start: { elementId: 'A', fx: 1, fy: 1 }, end: { elementId: 'B' } }, byIdOf(A, B))
    expect(cv.start).toEqual({ x: 100, y: 60 })
    expect(cv.c1.y).toBe(60)                 // 동쪽 진출(수평)
    expect(cv.c1.x).toBeGreaterThan(100)
  })

  it('고정 연결점은 도형 이동을 따라감(상대 위치 유지)', () => {
    const A = rect('A', 0, 0, 100, 60), B = rect('B', 300, 0, 100, 60)
    const conn = {
      id: 'C', type: 'shape', shapeType: 'connector',
      connection: { start: { elementId: 'A', fx: 1, fy: 0 }, end: { elementId: 'B', fx: 0, fy: 0 } },
    }
    let resolved = resolveConnectors([A, B, conn]).find(e => e.id === 'C')
    const absStart1 = { x: resolved.x + resolved.points[0].x, y: resolved.y + resolved.points[0].y }
    expect(absStart1).toEqual({ x: 100, y: 0 }) // A 북동 모서리
    // A를 (50,40) 이동 → 고정점도 따라감
    const A2 = rect('A', 50, 40, 100, 60)
    resolved = resolveConnectors([A2, B, conn]).find(e => e.id === 'C')
    const absStart2 = { x: resolved.x + resolved.points[0].x, y: resolved.y + resolved.points[0].y }
    expect(absStart2).toEqual({ x: 150, y: 40 })
  })
})

describe('flatStore 고정 연결점 생성', () => {
  beforeEach(() => {
    useFlatStore.setState({
      flatElements: [rect('A', 0, 0), rect('B', 300, 0)],
      selectedFlatIds: [], editingFlatId: null, drawMode: null, diagramMode: true,
      connectorDefaults: { startArrow: 'none', endArrow: 'triangle', stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '', routing: 'straight' },
    })
  })

  it('연결점에서 시작→연결점에 드롭 = 고정↔고정', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 100, y: 30 }, { fx: 1, fy: 0.5 })
    expect(useFlatStore.getState().connectorDraft.startAnchor).toEqual({ fx: 1, fy: 0.5 })
    useFlatStore.getState().updateConnectorDraft({ x: 300, y: 30 }, 'B', { fx: 0, fy: 0.5 })
    const id = useFlatStore.getState().commitConnectorDraft()
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection.start).toEqual({ elementId: 'A', fx: 1, fy: 0.5 })
    expect(el.connection.end).toEqual({ elementId: 'B', fx: 0, fy: 0.5 })
  })

  it('연결점 시작→몸체 드롭 = 고정↔플로팅', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 100, y: 30 }, { fx: 1, fy: 0.5 })
    useFlatStore.getState().updateConnectorDraft({ x: 340, y: 30 }, 'B', null) // 연결점 아님
    const id = useFlatStore.getState().commitConnectorDraft()
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection.start).toEqual({ elementId: 'A', fx: 1, fy: 0.5 })
    expect(el.connection.end).toEqual({ elementId: 'B' }) // 플로팅(앵커 없음)
  })

  it('앵커 없이 시작(몸체/Alt드래그) = 기존 플로팅', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 30 })
    useFlatStore.getState().updateConnectorDraft({ x: 300, y: 30 }, 'B')
    const id = useFlatStore.getState().commitConnectorDraft()
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection).toEqual({ start: { elementId: 'A' }, end: { elementId: 'B' } })
  })
})
