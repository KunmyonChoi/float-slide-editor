import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// ── 헬퍼 ─────────────────────────────────────────────

function makeEl(overrides = {}) {
  return {
    id: 'el-1',
    type: 'text',
    x: 100, y: 200, width: 300, height: 50, zIndex: 1,
    content: 'Hello',
    isRich: false, merged: false, sourceId: 'src-1',
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      color: '#000', fontSize: '16px', fontFamily: 'Arial',
      fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
      borderRadius: '0px', border: '0px none',
      borderTop: '0px none', borderRight: '0px none',
      borderBottom: '0px none', borderLeft: '0px none',
      boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'cover',
    },
    ...overrides,
  }
}

function seedStore(elements) {
  useFlatStore.setState({
    flatElements: elements,
    selectedFlatId: null,
    editingFlatId: null,
    clipboard: null,
    canvasSize: { w: 1280, h: 800 },
  })
  useFlatStore.getState().clearHistory()
}

// ── 복사/붙여넣기/복제 테스트 ─────────────────────────

describe('copyElement / pasteElement', () => {
  beforeEach(() => {
    seedStore([makeEl({ id: 'a', zIndex: 1 })])
  })

  it('copy → paste: 새 ID, +20 오프셋, sourceId 제거', () => {
    const s = useFlatStore.getState
    s().copyElement('a')
    expect(s().clipboard).not.toBeNull()
    expect(s().clipboard.id).toBe('a')

    s().pasteElement()
    const els = s().flatElements
    expect(els.length).toBe(2)

    const pasted = els[1]
    expect(pasted.id).not.toBe('a')  // 새 ID
    expect(pasted.x).toBe(120)       // +20
    expect(pasted.y).toBe(220)       // +20
    expect(pasted.sourceId).toBeNull()
    expect(pasted.content).toBe('Hello')
    expect(s().selectedFlatId).toBe(pasted.id)  // 붙여넣은 요소 선택됨
  })

  it('paste는 clipboard 없으면 무시', () => {
    const s = useFlatStore.getState
    s().pasteElement()
    expect(s().flatElements.length).toBe(1)
  })

  it('paste 후 undo → 추가된 요소 제거', () => {
    const s = useFlatStore.getState
    s().copyElement('a')
    s().pasteElement()
    expect(s().flatElements.length).toBe(2)

    s().undo()
    expect(s().flatElements.length).toBe(1)
    expect(s().flatElements[0].id).toBe('a')
  })

  it('paste 후 undo → redo → 요소 다시 추가', () => {
    const s = useFlatStore.getState
    s().copyElement('a')
    s().pasteElement()
    const pastedId = s().flatElements[1].id

    s().undo()
    expect(s().flatElements.length).toBe(1)

    s().redo()
    expect(s().flatElements.length).toBe(2)
    expect(s().flatElements[1].id).toBe(pastedId)
  })
})

describe('cutElement', () => {
  beforeEach(() => {
    seedStore([makeEl({ id: 'a' }), makeEl({ id: 'b', x: 500 })])
  })

  it('cut → 원본 삭제 + 클립보드에 저장', () => {
    const s = useFlatStore.getState
    s().cutElement('a')
    expect(s().flatElements.length).toBe(1)
    expect(s().flatElements[0].id).toBe('b')
    expect(s().clipboard).not.toBeNull()
    expect(s().clipboard.id).toBe('a')
  })

  it('cut → paste → 원본 위치 +20에 새 요소', () => {
    const s = useFlatStore.getState
    s().cutElement('a')
    s().pasteElement()
    expect(s().flatElements.length).toBe(2)
    const pasted = s().flatElements[1]
    expect(pasted.x).toBe(120)
    expect(pasted.id).not.toBe('a')
  })
})

describe('duplicateElement', () => {
  beforeEach(() => {
    seedStore([makeEl({ id: 'a' })])
  })

  it('duplicate = copy + paste 한 번에', () => {
    const s = useFlatStore.getState
    s().duplicateElement('a')
    expect(s().flatElements.length).toBe(2)
    const dup = s().flatElements[1]
    expect(dup.id).not.toBe('a')
    expect(dup.x).toBe(120)
    expect(dup.content).toBe('Hello')
  })
})

// ── Z-순서 테스트 ─────────────────────────────────────

describe('z-order: bringForward / sendBackward', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', zIndex: 1 }),
      makeEl({ id: 'b', zIndex: 2 }),
      makeEl({ id: 'c', zIndex: 3 }),
    ])
  })

  it('bringForward: a(1)를 앞으로 → b(1), a(2) 교환', () => {
    const s = useFlatStore.getState
    s().bringForward('a')
    const a = s().flatElements.find(e => e.id === 'a')
    const b = s().flatElements.find(e => e.id === 'b')
    expect(a.zIndex).toBe(2)
    expect(b.zIndex).toBe(1)
  })

  it('sendBackward: c(3)를 뒤로 → c(2), b(3) 교환', () => {
    const s = useFlatStore.getState
    s().sendBackward('c')
    const c = s().flatElements.find(e => e.id === 'c')
    const b = s().flatElements.find(e => e.id === 'b')
    expect(c.zIndex).toBe(2)
    expect(b.zIndex).toBe(3)
  })

  it('bringForward: 이미 최상위면 변경 없음', () => {
    const s = useFlatStore.getState
    s().bringForward('c')
    const c = s().flatElements.find(e => e.id === 'c')
    expect(c.zIndex).toBe(3)
    expect(s().canUndo).toBe(false)  // 히스토리에 기록 안 됨
  })

  it('sendBackward: 이미 최하위면 변경 없음', () => {
    const s = useFlatStore.getState
    s().sendBackward('a')
    const a = s().flatElements.find(e => e.id === 'a')
    expect(a.zIndex).toBe(1)
    expect(s().canUndo).toBe(false)
  })
})

describe('z-order: bringToFront / sendToBack', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', zIndex: 1 }),
      makeEl({ id: 'b', zIndex: 2 }),
      makeEl({ id: 'c', zIndex: 3 }),
    ])
  })

  it('bringToFront: a(1) → maxZ + 1 = 4', () => {
    const s = useFlatStore.getState
    s().bringToFront('a')
    const a = s().flatElements.find(e => e.id === 'a')
    expect(a.zIndex).toBe(4)
  })

  it('sendToBack: c(3) → minZ - 1 = 0', () => {
    const s = useFlatStore.getState
    s().sendToBack('c')
    const c = s().flatElements.find(e => e.id === 'c')
    expect(c.zIndex).toBe(0)
  })

  it('bringToFront: 이미 최상위면 변경 없음', () => {
    const s = useFlatStore.getState
    s().bringToFront('c')
    expect(s().canUndo).toBe(false)
  })

  it('sendToBack: 이미 최하위면 변경 없음', () => {
    const s = useFlatStore.getState
    s().sendToBack('a')
    expect(s().canUndo).toBe(false)
  })
})

describe('z-order undo/redo', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', zIndex: 1 }),
      makeEl({ id: 'b', zIndex: 2 }),
    ])
  })

  it('bringForward → undo → 원래 zIndex 복원', () => {
    const s = useFlatStore.getState
    s().bringForward('a')
    expect(s().flatElements.find(e => e.id === 'a').zIndex).toBe(2)
    expect(s().flatElements.find(e => e.id === 'b').zIndex).toBe(1)

    s().undo()
    expect(s().flatElements.find(e => e.id === 'a').zIndex).toBe(1)
    expect(s().flatElements.find(e => e.id === 'b').zIndex).toBe(2)
  })

  it('bringToFront → undo → redo', () => {
    const s = useFlatStore.getState
    s().bringToFront('a')
    expect(s().flatElements.find(e => e.id === 'a').zIndex).toBe(3)

    s().undo()
    expect(s().flatElements.find(e => e.id === 'a').zIndex).toBe(1)

    s().redo()
    expect(s().flatElements.find(e => e.id === 'a').zIndex).toBe(3)
  })
})
