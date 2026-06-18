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

  it('addConnector는 undo로 되돌릴 수 있다', () => {
    const before = useFlatStore.getState().flatElements.length
    const id = useFlatStore.getState().addConnector({ start: { elementId: 'A' }, end: { elementId: 'B' } })
    expect(useFlatStore.getState().flatElements.length).toBe(before + 1)
    useFlatStore.getState().undo()
    expect(useFlatStore.getState().flatElements.find(e => e.id === id)).toBeUndefined()
  })
})
