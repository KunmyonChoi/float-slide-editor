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

const s = () => useFlatStore.getState()

function seedStore(elements) {
  useFlatStore.setState({
    flatElements: elements,
    selectedFlatIds: [],
    editingFlatId: null,
    clipboard: null,
    canvasSize: { w: 1280, h: 800 },
  })
  s().clearHistory()
}

// ── 다중 선택 기본 동작 ───────────────────────────────

describe('다중 선택 기본 동작', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10, zIndex: 1 }),
      makeEl({ id: 'b', x: 100, y: 100, zIndex: 2 }),
      makeEl({ id: 'c', x: 200, y: 200, zIndex: 3 }),
    ])
  })

  it('setSelectedFlat(id) → 단일 선택', () => {
    s().setSelectedFlat('a')
    expect(s().selectedFlatIds).toEqual(['a'])
  })

  it('setSelectedFlat(null) → 선택 해제', () => {
    s().setSelectedFlat('a')
    s().setSelectedFlat(null)
    expect(s().selectedFlatIds).toEqual([])
  })

  it('toggleSelectFlat → 토글 추가', () => {
    s().setSelectedFlat('a')
    s().toggleSelectFlat('b')
    expect(s().selectedFlatIds).toEqual(['a', 'b'])
  })

  it('toggleSelectFlat → 토글 제거', () => {
    s().setSelectedFlat('a')
    s().toggleSelectFlat('b')
    s().toggleSelectFlat('a')
    expect(s().selectedFlatIds).toEqual(['b'])
  })

  it('setSelectedFlats → 일괄 설정', () => {
    s().setSelectedFlats(['a', 'b', 'c'])
    expect(s().selectedFlatIds).toEqual(['a', 'b', 'c'])
  })

  it('selectAllFlats → 전체 선택', () => {
    s().selectAllFlats()
    expect(s().selectedFlatIds).toEqual(['a', 'b', 'c'])
  })
})

// ── 다중 삭제 ────────────────────────────────────────

describe('removeSelectedElements', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, zIndex: 1 }),
      makeEl({ id: 'b', x: 100, zIndex: 2 }),
      makeEl({ id: 'c', x: 200, zIndex: 3 }),
    ])
  })

  it('다중 선택 삭제', () => {
    s().setSelectedFlats(['a', 'c'])
    s().removeSelectedElements()
    expect(s().flatElements.map(e => e.id)).toEqual(['b'])
    expect(s().selectedFlatIds).toEqual([])
  })

  it('다중 삭제 undo → 전체 복원', () => {
    s().setSelectedFlats(['a', 'c'])
    s().removeSelectedElements()
    expect(s().flatElements.length).toBe(1)

    s().undo()
    expect(s().flatElements.length).toBe(3)
    expect(s().flatElements.map(e => e.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('다중 삭제 undo → redo', () => {
    s().setSelectedFlats(['a', 'c'])
    s().removeSelectedElements()

    s().undo()
    expect(s().flatElements.length).toBe(3)

    s().redo()
    expect(s().flatElements.length).toBe(1)
    expect(s().flatElements[0].id).toBe('b')
  })

  it('단일 선택 삭제 (기존 호환)', () => {
    s().setSelectedFlat('b')
    s().removeSelectedElements()
    expect(s().flatElements.length).toBe(2)
    expect(s().flatElements.map(e => e.id)).toEqual(['a', 'c'])
  })

  it('선택 없을 때 삭제 무시', () => {
    s().removeSelectedElements()
    expect(s().flatElements.length).toBe(3)
  })
})

// ── 다중 복사/붙여넣기 ────────────────────────────────

describe('다중 복사/붙여넣기', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10, zIndex: 1 }),
      makeEl({ id: 'b', x: 100, y: 100, zIndex: 2 }),
    ])
  })

  it('다중 copy → paste', () => {
    s().setSelectedFlats(['a', 'b'])
    s().copyElement()
    expect(s().clipboard.length).toBe(2)

    s().pasteElement()
    expect(s().flatElements.length).toBe(4)
    const pasted = s().flatElements.slice(2)
    expect(pasted[0].x).toBe(30) // 10+20
    expect(pasted[1].x).toBe(120) // 100+20
    expect(pasted[0].id).not.toBe('a')
    expect(pasted[1].id).not.toBe('b')
    // 붙여넣은 요소들이 선택됨
    expect(s().selectedFlatIds).toEqual(pasted.map(e => e.id))
  })

  it('다중 paste undo/redo', () => {
    s().setSelectedFlats(['a', 'b'])
    s().copyElement()
    s().pasteElement()
    expect(s().flatElements.length).toBe(4)

    s().undo()
    expect(s().flatElements.length).toBe(2)

    s().redo()
    expect(s().flatElements.length).toBe(4)
  })

  it('다중 cut → paste', () => {
    s().setSelectedFlats(['a', 'b'])
    s().cutElement()
    expect(s().flatElements.length).toBe(0)
    expect(s().clipboard.length).toBe(2)

    s().pasteElement()
    expect(s().flatElements.length).toBe(2)
    expect(s().flatElements[0].x).toBe(30)
  })

  it('다중 duplicate', () => {
    s().setSelectedFlats(['a', 'b'])
    s().duplicateElement()
    expect(s().flatElements.length).toBe(4)
  })
})

// ── 배치 업데이트 ─────────────────────────────────────

describe('batchUpdateFlatElements', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10 }),
      makeEl({ id: 'b', x: 100, y: 100 }),
      makeEl({ id: 'c', x: 200, y: 200 }),
    ])
  })

  it('여러 요소에 동일 changes 적용', () => {
    s().batchUpdateFlatElements(['a', 'b'], { styles: { opacity: '0.5' } })
    expect(s().flatElements.find(e => e.id === 'a').styles.opacity).toBe('0.5')
    expect(s().flatElements.find(e => e.id === 'b').styles.opacity).toBe('0.5')
    expect(s().flatElements.find(e => e.id === 'c').styles.opacity).toBe('1') // 영향 없음
  })

  it('batch update undo/redo', () => {
    s().batchUpdateFlatElements(['a', 'b'], { styles: { opacity: '0.5' } })
    expect(s().flatElements.find(e => e.id === 'a').styles.opacity).toBe('0.5')

    s().undo()
    expect(s().flatElements.find(e => e.id === 'a').styles.opacity).toBe('1')
    expect(s().flatElements.find(e => e.id === 'b').styles.opacity).toBe('1')

    s().redo()
    expect(s().flatElements.find(e => e.id === 'a').styles.opacity).toBe('0.5')
  })

  it('스타일 중첩 머지 유지', () => {
    s().batchUpdateFlatElements(['a'], { styles: { color: 'red' } })
    const aStyles = s().flatElements.find(e => e.id === 'a').styles
    expect(aStyles.color).toBe('red')
    expect(aStyles.fontSize).toBe('16px') // 기존 유지
  })
})

describe('batchUpdateFlatElementsIndividual', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10 }),
      makeEl({ id: 'b', x: 100, y: 100 }),
    ])
  })

  it('요소별 다른 changes 적용', () => {
    s().batchUpdateFlatElementsIndividual([
      { id: 'a', changes: { x: 50, y: 50 } },
      { id: 'b', changes: { x: 200, y: 200 } },
    ])
    expect(s().flatElements.find(e => e.id === 'a').x).toBe(50)
    expect(s().flatElements.find(e => e.id === 'b').x).toBe(200)
  })

  it('개별 batch undo', () => {
    s().batchUpdateFlatElementsIndividual([
      { id: 'a', changes: { x: 50 } },
      { id: 'b', changes: { x: 200 } },
    ])
    s().undo()
    expect(s().flatElements.find(e => e.id === 'a').x).toBe(10)
    expect(s().flatElements.find(e => e.id === 'b').x).toBe(100)
  })
})

describe('batchPreviewFlatElements', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10 }),
      makeEl({ id: 'b', x: 100, y: 100 }),
    ])
  })

  it('미리보기 — 히스토리 없음', () => {
    s().batchPreviewFlatElements([
      { id: 'a', changes: { x: 50 } },
      { id: 'b', changes: { x: 200 } },
    ])
    expect(s().flatElements.find(e => e.id === 'a').x).toBe(50)
    expect(s().flatElements.find(e => e.id === 'b').x).toBe(200)
    expect(s().canUndo).toBe(false) // 히스토리에 기록 안 됨
  })
})

// ── removeFlatElement 단일 삭제 시 selectedFlatIds 업데이트 ──

describe('removeFlatElement + selectedFlatIds', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a' }),
      makeEl({ id: 'b', x: 500 }),
    ])
  })

  it('선택된 요소 삭제 시 selectedFlatIds에서도 제거', () => {
    s().setSelectedFlats(['a', 'b'])
    s().removeFlatElement('a')
    expect(s().selectedFlatIds).toEqual(['b'])
    expect(s().flatElements.length).toBe(1)
  })

  it('미선택 요소 삭제 시 selectedFlatIds 유지', () => {
    s().setSelectedFlat('b')
    s().removeFlatElement('a')
    expect(s().selectedFlatIds).toEqual(['b'])
    expect(s().flatElements.length).toBe(1)
  })
})
