import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// ── 테스트 헬퍼 ─────────────────────────────────────────────

function makeTextEl(overrides = {}) {
  return {
    id: 'flat-txt-1',
    type: 'text',
    x: 100,
    y: 200,
    width: 300,
    height: 50,
    zIndex: 1,
    content: 'Hello World',
    isRich: false,
    merged: false,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      color: '#000',
      fontSize: '16px',
      fontFamily: 'Arial',
      fontWeight: '400',
      lineHeight: '1.5',
      textAlign: 'left',
      borderRadius: '0px',
      border: '0px none',
      borderTop: '0px none',
      borderRight: '0px none',
      borderBottom: '0px none',
      borderLeft: '0px none',
      boxShadow: 'none',
      opacity: '1',
      padding: '0px',
      objectFit: 'cover',
    },
    ...overrides,
  }
}

function seedStore(elements) {
  useFlatStore.setState({
    flatElements: elements,
    selectedFlatId: null,
    editingFlatId: null,
    canvasSize: { w: 1280, h: 800 },
  })
  useFlatStore.getState().clearHistory()
}

// ── 테스트 ─────────────────────────────────────────────

describe('flatStore editingFlatId 상태 관리', () => {
  beforeEach(() => {
    seedStore([makeTextEl()])
  })

  it('초기 editingFlatId는 null', () => {
    expect(useFlatStore.getState().editingFlatId).toBeNull()
  })

  it('setEditingFlat으로 편집 모드 진입', () => {
    useFlatStore.getState().setEditingFlat('flat-txt-1')
    expect(useFlatStore.getState().editingFlatId).toBe('flat-txt-1')
  })

  it('setEditingFlat(null)로 편집 모드 종료', () => {
    useFlatStore.getState().setEditingFlat('flat-txt-1')
    useFlatStore.getState().setEditingFlat(null)
    expect(useFlatStore.getState().editingFlatId).toBeNull()
  })
})

describe('commitTextEdit', () => {
  beforeEach(() => {
    seedStore([makeTextEl()])
    useFlatStore.getState().setEditingFlat('flat-txt-1')
  })

  it('content와 isRich를 업데이트하고 editingFlatId를 null로 설정', () => {
    useFlatStore.getState().commitTextEdit('flat-txt-1', '<b>Bold</b>', true)
    const state = useFlatStore.getState()
    const el = state.flatElements.find(e => e.id === 'flat-txt-1')
    expect(el.content).toBe('<b>Bold</b>')
    expect(el.isRich).toBe(true)
    expect(state.editingFlatId).toBeNull()
  })

  it('plain text로 커밋하면 isRich=false', () => {
    useFlatStore.getState().commitTextEdit('flat-txt-1', 'plain text', false)
    const el = useFlatStore.getState().flatElements.find(e => e.id === 'flat-txt-1')
    expect(el.content).toBe('plain text')
    expect(el.isRich).toBe(false)
  })

  it('commitTextEdit은 히스토리에 기록되어 undo 가능', () => {
    useFlatStore.getState().commitTextEdit('flat-txt-1', 'edited', false)
    expect(useFlatStore.getState().canUndo).toBe(true)

    useFlatStore.getState().undo()
    const el = useFlatStore.getState().flatElements.find(e => e.id === 'flat-txt-1')
    expect(el.content).toBe('Hello World')
    expect(el.isRich).toBe(false)
  })

  it('undo 후 redo로 편집 내용 복원', () => {
    useFlatStore.getState().commitTextEdit('flat-txt-1', '<em>italic</em>', true)
    useFlatStore.getState().undo()
    useFlatStore.getState().redo()
    const el = useFlatStore.getState().flatElements.find(e => e.id === 'flat-txt-1')
    expect(el.content).toBe('<em>italic</em>')
    expect(el.isRich).toBe(true)
  })

  it('빈 내용으로 커밋 가능', () => {
    useFlatStore.getState().commitTextEdit('flat-txt-1', '', false)
    const el = useFlatStore.getState().flatElements.find(e => e.id === 'flat-txt-1')
    expect(el.content).toBe('')
  })
})

describe('isRich 판별 로직', () => {
  // FlatInlineEditor의 commit 로직을 단위 테스트로 검증
  function detectIsRich(html) {
    const stripped = html.replace(/<br\s*\/?>/gi, '')
    return /<[a-z][\s\S]*>/i.test(stripped)
  }

  it('plain text → isRich=false', () => {
    expect(detectIsRich('Hello World')).toBe(false)
  })

  it('<br> 만 있으면 isRich=false', () => {
    expect(detectIsRich('Line 1<br>Line 2')).toBe(false)
    expect(detectIsRich('Line 1<br/>Line 2')).toBe(false)
    expect(detectIsRich('Line 1<br />Line 2')).toBe(false)
  })

  it('<b> 태그 → isRich=true', () => {
    expect(detectIsRich('<b>Bold</b>')).toBe(true)
  })

  it('<span> 태그 → isRich=true', () => {
    expect(detectIsRich('<span style="color:red">Red</span>')).toBe(true)
  })

  it('<em> 태그 → isRich=true', () => {
    expect(detectIsRich('<em>italic</em>')).toBe(true)
  })

  it('mixed: <br> + <b> → isRich=true', () => {
    expect(detectIsRich('Line 1<br><b>Bold</b>')).toBe(true)
  })
})

describe('여러 텍스트 박스 편집 후 undo/redo', () => {
  beforeEach(() => {
    seedStore([
      makeTextEl({ id: 'txt-A', content: 'Original A' }),
      makeTextEl({ id: 'txt-B', content: 'Original B', x: 500 }),
      makeTextEl({ id: 'txt-C', content: 'Original C', x: 900 }),
    ])
  })

  it('A, B 순서로 편집 후 undo 2회 → 둘 다 원복', () => {
    const s = useFlatStore.getState
    // 텍스트 A 편집
    s().setEditingFlat('txt-A')
    s().commitTextEdit('txt-A', 'Edited A', false)
    // 텍스트 B 편집
    s().setEditingFlat('txt-B')
    s().commitTextEdit('txt-B', 'Edited B', false)

    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Edited A')
    expect(s().flatElements.find(e => e.id === 'txt-B').content).toBe('Edited B')
    expect(s().canUndo).toBe(true)

    // undo 1회 → B 원복
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-B').content).toBe('Original B')
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Edited A')

    // undo 2회 → A 원복
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Original A')
    expect(s().canUndo).toBe(false)
  })

  it('A, B, C 편집 후 undo 3회 + redo 3회', () => {
    const s = useFlatStore.getState
    s().setEditingFlat('txt-A')
    s().commitTextEdit('txt-A', 'New A', false)
    s().setEditingFlat('txt-B')
    s().commitTextEdit('txt-B', 'New B', false)
    s().setEditingFlat('txt-C')
    s().commitTextEdit('txt-C', 'New C', false)

    // undo 3회
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-C').content).toBe('Original C')
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-B').content).toBe('Original B')
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Original A')
    expect(s().canUndo).toBe(false)
    expect(s().canRedo).toBe(true)

    // redo 3회
    s().redo()
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('New A')
    s().redo()
    expect(s().flatElements.find(e => e.id === 'txt-B').content).toBe('New B')
    s().redo()
    expect(s().flatElements.find(e => e.id === 'txt-C').content).toBe('New C')
    expect(s().canRedo).toBe(false)
  })

  it('편집 후 이동 후 undo → 이동 먼저 원복, 그 다음 편집 원복', () => {
    const s = useFlatStore.getState
    // 텍스트 A 편집
    s().setEditingFlat('txt-A')
    s().commitTextEdit('txt-A', 'Changed A', false)
    // 텍스트 A 이동
    s().updateFlatElement('txt-A', { x: 999 })

    // undo 1회 → 이동 원복
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-A').x).toBe(100)
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Changed A')

    // undo 2회 → 편집 원복
    s().undo()
    expect(s().flatElements.find(e => e.id === 'txt-A').content).toBe('Original A')
  })
})

describe('편집 중 선택/이동 동작', () => {
  beforeEach(() => {
    seedStore([makeTextEl(), makeTextEl({ id: 'flat-txt-2', x: 500 })])
  })

  it('편집 중에 다른 요소를 선택해도 editingFlatId 유지 (blur로 커밋)', () => {
    useFlatStore.getState().setEditingFlat('flat-txt-1')
    useFlatStore.getState().setSelectedFlat('flat-txt-2')
    // editingFlatId는 blur 이벤트에서만 해제됨 — store에서는 독립 상태
    expect(useFlatStore.getState().editingFlatId).toBe('flat-txt-1')
    expect(useFlatStore.getState().selectedFlatId).toBe('flat-txt-2')
  })
})
