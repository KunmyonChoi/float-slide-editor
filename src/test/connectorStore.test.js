import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

const shape = (id, x, y) => ({
  id, type: 'shape', x, y, width: 100, height: 100, zIndex: 1,
  content: '', isRich: false, merged: false, sourceId: null, styles: {},
})

describe('flatStore 커넥터', () => {
  beforeEach(() => {
    useFlatStore.setState({
      flatElements: [shape('A', 0, 0), shape('B', 300, 0)],
      selectedFlatIds: [], editingFlatId: null, drawMode: null, diagramMode: false,
      connectorDefaults: { startArrow: 'none', endArrow: 'triangle', stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '' },
    })
    // 히스토리 초기화를 위해 한 번 비우고 다시 설정
  })

  it('setDiagramMode 토글 — drawMode와 상호배타', () => {
    useFlatStore.getState().setDrawMode('line')
    expect(useFlatStore.getState().drawMode).toBe('line')
    useFlatStore.getState().setDiagramMode(true)
    expect(useFlatStore.getState().diagramMode).toBe(true)
    expect(useFlatStore.getState().drawMode).toBeNull()
    useFlatStore.getState().setDrawMode('polygon')
    expect(useFlatStore.getState().diagramMode).toBe(false)
  })

  it('addConnector — connection 저장 + 기본 화살표 + 선택', () => {
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.shapeType).toBe('connector')
    expect(el.connection).toEqual({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    expect(el.endArrow).toBe('triangle')
    expect(el.startArrow).toBe('none')
    expect(el.styles.stroke).toBe('#1e293b')
    expect(useFlatStore.getState().selectedFlatIds).toEqual([id])
  })

  it('connectorDefaults 변경이 다음 커넥터에 반영', () => {
    useFlatStore.getState().setConnectorDefaults({ endArrow: 'arrow', strokeDasharray: '6 4' })
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { point: { x: 200, y: 50 } } })
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.endArrow).toBe('arrow')
    expect(el.styles.strokeDasharray).toBe('6 4')
  })

  it('reverseConnector — 양끝 연결 + 화살표 스왑', () => {
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    useFlatStore.getState().reverseConnector(id)
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection).toEqual({ start: { elementId: 'B' }, end: { elementId: 'A' } })
    expect(el.startArrow).toBe('triangle')
    expect(el.endArrow).toBe('none')
  })

  it('드래그 드래프트: 타겟 위에서 종료 → 부착 커넥터 생성', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 50 })
    expect(useFlatStore.getState().connectorDraft.sourceId).toBe('A')
    useFlatStore.getState().updateConnectorDraft({ x: 350, y: 50 }, 'B')
    const id = useFlatStore.getState().commitConnectorDraft()
    expect(useFlatStore.getState().connectorDraft).toBeNull()
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection).toEqual({ start: { elementId: 'A' }, end: { elementId: 'B' } })
  })

  it('드래그 드래프트: 빈 곳에서 충분히 끌면 자유 끝점 커넥터', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 50 })
    useFlatStore.getState().updateConnectorDraft({ x: 600, y: 400 }, null)
    const id = useFlatStore.getState().commitConnectorDraft()
    const el = useFlatStore.getState().flatElements.find(e => e.id === id)
    expect(el.connection.start).toEqual({ elementId: 'A' })
    expect(el.connection.end).toEqual({ point: { x: 600, y: 400 } })
  })

  it('드래그 드래프트: 거의 안 끌면 생성 안 함', () => {
    const before = useFlatStore.getState().flatElements.length
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 50 })
    useFlatStore.getState().updateConnectorDraft({ x: 52, y: 51 }, null)
    const id = useFlatStore.getState().commitConnectorDraft()
    expect(id).toBeNull()
    expect(useFlatStore.getState().flatElements.length).toBe(before)
  })

  it('드래그 드래프트: 같은 도형으로 종료 → 생성 안 함(자기연결 금지)', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 50 })
    useFlatStore.getState().updateConnectorDraft({ x: 60, y: 60 }, 'A')
    const id = useFlatStore.getState().commitConnectorDraft()
    expect(id).toBeNull()
  })

  it('cancelConnectorDraft로 취소', () => {
    useFlatStore.getState().beginConnectorFrom('A', { x: 50, y: 50 })
    useFlatStore.getState().cancelConnectorDraft()
    expect(useFlatStore.getState().connectorDraft).toBeNull()
  })

  it('addConnector는 undo로 되돌릴 수 있다', () => {
    const before = useFlatStore.getState().flatElements.length
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    expect(useFlatStore.getState().flatElements.length).toBe(before + 1)
    useFlatStore.getState().undo()
    expect(useFlatStore.getState().flatElements.find(e => e.id === id)).toBeUndefined()
  })

  it('도형 삭제 시 참조 커넥터도 함께 삭제(1 undo로 복구)', () => {
    const cid = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    useFlatStore.setState({ selectedFlatIds: ['A'] })
    useFlatStore.getState().removeSelectedElements()
    let els = useFlatStore.getState().flatElements
    expect(els.find(e => e.id === 'A')).toBeUndefined()
    expect(els.find(e => e.id === cid)).toBeUndefined() // 커넥터 동반 삭제
    expect(els.find(e => e.id === 'B')).toBeTruthy()
    // 한 번의 undo로 도형+커넥터 모두 복구
    useFlatStore.getState().undo()
    els = useFlatStore.getState().flatElements
    expect(els.find(e => e.id === 'A')).toBeTruthy()
    expect(els.find(e => e.id === cid)).toBeTruthy()
  })

  it('자유 끝점 커넥터는 한쪽 도형 삭제로 함께 삭제', () => {
    const cid = useFlatStore.getState().addConnector({ start: { elementId: 'B' }, end: { point: { x: 200, y: 50 } } })
    useFlatStore.getState().removeFlatElement('B')
    expect(useFlatStore.getState().flatElements.find(e => e.id === cid)).toBeUndefined()
  })

  it('커넥터 화살표/선스타일 변경이 connectorDefaults에 기억됨', () => {
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    useFlatStore.getState().updateFlatElement(id, { endArrow: 'circle' })
    useFlatStore.getState().updateFlatElement(id, { styles: { strokeDasharray: '8 4' } })
    const d = useFlatStore.getState().connectorDefaults
    expect(d.endArrow).toBe('circle')
    expect(d.strokeDasharray).toBe('8 4')
    // 다음 새 커넥터가 기억된 값 상속
    const id2 = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { point: { x: 200, y: 50 } } })
    const el2 = useFlatStore.getState().flatElements.find(e => e.id === id2)
    expect(el2.endArrow).toBe('circle')
    expect(el2.styles.strokeDasharray).toBe('8 4')
  })

  it('일반 도형 업데이트는 connectorDefaults에 영향 없음', () => {
    const d0 = { ...useFlatStore.getState().connectorDefaults }
    useFlatStore.getState().updateFlatElement('A', { styles: { strokeDasharray: '2 2' } })
    expect(useFlatStore.getState().connectorDefaults).toEqual(d0)
  })

  it('커넥터만 단독 삭제는 도형에 영향 없음', () => {
    const cid = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    useFlatStore.getState().removeFlatElement(cid)
    const els = useFlatStore.getState().flatElements
    expect(els.find(e => e.id === 'A')).toBeTruthy()
    expect(els.find(e => e.id === 'B')).toBeTruthy()
  })
})
