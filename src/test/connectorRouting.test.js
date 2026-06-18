import { describe, it, expect } from 'vitest'
import {
  rectCenter,
  rectBorderPoint,
  resolveConnectorEndpoints,
  resolveConnectorGeometry,
  resolveConnectors,
  attachTargetAt,
  isConnector,
  CONNECTOR_PAD,
} from '../core/ConnectorRouting'

const rect = (id, x, y, w, h, extra = {}) => ({
  id, type: 'shape', x, y, width: w, height: h, zIndex: 1, ...extra,
})

describe('ConnectorRouting', () => {
  describe('rectCenter / rectBorderPoint', () => {
    const r = { x: 0, y: 0, width: 100, height: 100 } // center (50,50)

    it('중심 계산', () => {
      expect(rectCenter(r)).toEqual({ x: 50, y: 50 })
    })

    it('오른쪽으로 향하면 오른쪽 변 중앙', () => {
      expect(rectBorderPoint(r, { x: 1000, y: 50 })).toEqual({ x: 100, y: 50 })
    })
    it('왼쪽으로 향하면 왼쪽 변 중앙', () => {
      expect(rectBorderPoint(r, { x: -1000, y: 50 })).toEqual({ x: 0, y: 50 })
    })
    it('위로 향하면 위쪽 변 중앙', () => {
      expect(rectBorderPoint(r, { x: 50, y: -1000 })).toEqual({ x: 50, y: 0 })
    })
    it('아래로 향하면 아래쪽 변 중앙', () => {
      expect(rectBorderPoint(r, { x: 50, y: 1000 })).toEqual({ x: 50, y: 100 })
    })
    it('정확한 대각선이면 모서리', () => {
      expect(rectBorderPoint(r, { x: 1050, y: 1050 })).toEqual({ x: 100, y: 100 })
    })
    it('toward가 중심과 같으면 중심 반환(0 나눗셈 가드)', () => {
      expect(rectBorderPoint(r, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
    })
  })

  describe('resolveConnectorEndpoints', () => {
    const A = rect('A', 0, 0, 100, 100)      // center (50,50)
    const B = rect('B', 300, 0, 100, 100)    // center (350,50)
    const byId = { A, B }

    it('둘 다 부착: 마주보는 변에서 만난다', () => {
      const eps = resolveConnectorEndpoints({ start: { elementId: 'A' }, end: { elementId: 'B' } }, byId)
      expect(eps.start).toEqual({ x: 100, y: 50 }) // A 오른쪽 변
      expect(eps.end).toEqual({ x: 300, y: 50 })   // B 왼쪽 변
    })

    it('start 부착 / end 자유', () => {
      const eps = resolveConnectorEndpoints({ start: { elementId: 'A' }, end: { point: { x: 200, y: 50 } } }, byId)
      expect(eps.start).toEqual({ x: 100, y: 50 })
      expect(eps.end).toEqual({ x: 200, y: 50 })
    })

    it('start 자유 / end 부착', () => {
      const eps = resolveConnectorEndpoints({ start: { point: { x: 200, y: 50 } }, end: { elementId: 'B' } }, byId)
      expect(eps.start).toEqual({ x: 200, y: 50 })
      expect(eps.end).toEqual({ x: 300, y: 50 })
    })

    it('둘 다 자유: 저장 point 그대로', () => {
      const eps = resolveConnectorEndpoints({ start: { point: { x: 10, y: 20 } }, end: { point: { x: 30, y: 40 } } }, byId)
      expect(eps.start).toEqual({ x: 10, y: 20 })
      expect(eps.end).toEqual({ x: 30, y: 40 })
    })

    it('참조 도형이 없고 point도 없으면 null', () => {
      const eps = resolveConnectorEndpoints({ start: { elementId: 'GONE' }, end: { elementId: 'B' } }, byId)
      expect(eps).toBeNull()
    })

    it('connection 누락 시 null', () => {
      expect(resolveConnectorEndpoints(null, byId)).toBeNull()
      expect(resolveConnectorEndpoints({ start: { elementId: 'A' } }, byId)).toBeNull()
    })
  })

  describe('resolveConnectorGeometry', () => {
    const A = rect('A', 0, 0, 100, 100)
    const B = rect('B', 300, 0, 100, 100)
    const byId = { A, B }

    it('bbox는 끝점 + pad, points는 bbox 상대', () => {
      const conn = { connection: { start: { elementId: 'A' }, end: { elementId: 'B' } } }
      const geo = resolveConnectorGeometry(conn, byId)
      // 끝점 (100,50)-(300,50)
      expect(geo.x).toBe(100 - CONNECTOR_PAD)
      expect(geo.y).toBe(50 - CONNECTOR_PAD)
      expect(geo.width).toBe(200 + CONNECTOR_PAD * 2)
      expect(geo.height).toBe(0 + CONNECTOR_PAD * 2)
      expect(geo.points[0]).toEqual({ x: CONNECTOR_PAD, y: CONNECTOR_PAD })
      expect(geo.points[1]).toEqual({ x: 200 + CONNECTOR_PAD, y: CONNECTOR_PAD })
    })

    it('해석 불가하면 null', () => {
      const geo = resolveConnectorGeometry({ connection: { start: { elementId: 'X' }, end: { elementId: 'Y' } } }, byId)
      expect(geo).toBeNull()
    })
  })

  describe('resolveConnectors (라이브 추종)', () => {
    it('커넥터만 기하가 채워지고 도형은 그대로', () => {
      const A = rect('A', 0, 0, 100, 100)
      const B = rect('B', 300, 0, 100, 100)
      const conn = { id: 'C', type: 'shape', shapeType: 'connector', connection: { start: { elementId: 'A' }, end: { elementId: 'B' } } }
      const out = resolveConnectors([A, B, conn])
      expect(out[0]).toBe(A) // 도형 동일 참조
      expect(out[1]).toBe(B)
      const c = out[2]
      expect(c.points[0]).toEqual({ x: CONNECTOR_PAD, y: CONNECTOR_PAD })
    })

    it('도형이 움직이면 커넥터 끝점도 따라온다', () => {
      const A = rect('A', 0, 0, 100, 100)
      const conn = { id: 'C', type: 'shape', shapeType: 'connector', connection: { start: { elementId: 'A' }, end: { point: { x: 200, y: 50 } } } }
      const before = resolveConnectors([A, conn])[1]
      expect(before.points[0].x).toBeLessThan(before.points[1].x) // A가 왼쪽
      // A를 자유점 오른쪽으로 이동 → 시작 변이 왼쪽 변으로 바뀜
      const A2 = { ...A, x: 400 }
      const after = resolveConnectors([A2, conn])[1]
      // 시작점(부착)이 자유점보다 오른쪽
      const startAbs = { x: after.x + after.points[0].x, y: after.y + after.points[0].y }
      expect(startAbs.x).toBe(400) // A2 왼쪽 변
    })

    it('커넥터가 없으면 동일 배열 참조 반환', () => {
      const els = [rect('A', 0, 0, 10, 10)]
      expect(resolveConnectors(els)).toBe(els)
    })
  })

  describe('attachTargetAt', () => {
    const A = rect('A', 0, 0, 100, 100, { zIndex: 1 })
    const B = rect('B', 50, 50, 100, 100, { zIndex: 5 }) // A와 겹침, z 높음
    const bg = rect('BG', 0, 0, 1280, 720, { zIndex: 0, isBackground: true })
    const conn = { id: 'C', type: 'shape', shapeType: 'connector', x: 0, y: 0, width: 10, height: 10, zIndex: 9 }
    const els = [A, B, bg, conn]

    it('도형 내부 점 → 그 도형', () => {
      expect(attachTargetAt(20, 20, [A])).toBe('A')
    })
    it('겹치면 z 최상위 도형', () => {
      expect(attachTargetAt(75, 75, els)).toBe('B')
    })
    it('임계 거리 내면 부착, 밖이면 null', () => {
      expect(attachTargetAt(108, 50, [A], { threshold: 12 })).toBe('A') // 우변+8
      expect(attachTargetAt(120, 50, [A], { threshold: 12 })).toBeNull() // 우변+20
    })
    it('커넥터·배경은 후보에서 제외', () => {
      // conn(z9) 영역이지만 커넥터라 제외, bg는 배경이라 제외 → A/B 중 z높은 B
      expect(attachTargetAt(75, 75, els)).toBe('B')
      // 도형 없는 빈 곳(배경만) → null
      expect(attachTargetAt(700, 400, els)).toBeNull()
    })
    it('excludeId로 자기 자신 제외', () => {
      expect(attachTargetAt(20, 20, [A], { excludeId: 'A' })).toBeNull()
    })

    it('플래그 없는 전체화면 배경도 canvasSize 주면 제외', () => {
      const cs = { w: 1280, h: 720 }
      const plainBg = rect('PBG', 0, 0, 1280, 720, { zIndex: 0 }) // isBackground 없음(크기추론 배경)
      const card = rect('CARD', 100, 100, 200, 100, { zIndex: 2 })
      const els = [plainBg, card]
      // 카드 밖 빈 곳(배경 위) → canvasSize 주면 null
      expect(attachTargetAt(700, 400, els, { canvasSize: cs })).toBeNull()
      // canvasSize 없으면 전체화면 배경이 후보가 됨(기존 동작)
      expect(attachTargetAt(700, 400, els)).toBe('PBG')
      // 카드 위는 그대로 카드
      expect(attachTargetAt(150, 150, els, { canvasSize: cs })).toBe('CARD')
    })
  })

  describe('isConnector', () => {
    it('shapeType connector만 true', () => {
      expect(isConnector({ shapeType: 'connector' })).toBe(true)
      expect(isConnector({ shapeType: 'line' })).toBe(false)
      expect(isConnector({ type: 'shape' })).toBe(false)
      expect(isConnector(null)).toBe(false)
    })
  })
})
