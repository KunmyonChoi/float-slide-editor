import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

// ── 헬퍼 ─────────────────────────────────────────────

function makeEl(overrides = {}) {
  return {
    id: 'el-1',
    type: 'text',
    x: 100, y: 200, width: 300, height: 50, zIndex: 1,
    content: 'Hello',
    isRich: false, merged: false,
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

function seedFlatStore(elements = []) {
  useFlatStore.setState({
    flatElements: elements,
    selectedFlatId: null,
    editingFlatId: null,
    canvasSize: { w: 1280, h: 800 },
    panelMode: 'docked',
    floatingPos: { x: null, y: 80 },
  })
  useFlatStore.getState().clearHistory()
}

function seedEditorStore() {
  useEditorStore.setState({
    selectedId: null,
  })
}

// ── panelMode 상태 테스트 ──────────────────────────────

describe('panelMode 상태', () => {
  beforeEach(() => {
    seedFlatStore([makeEl()])
    seedEditorStore()
  })

  it('초기값은 docked', () => {
    expect(useFlatStore.getState().panelMode).toBe('docked')
  })

  it('setPanelMode로 floating 전환', () => {
    useFlatStore.getState().setPanelMode('floating')
    expect(useFlatStore.getState().panelMode).toBe('floating')
  })

  it('setPanelMode로 docked 복귀', () => {
    useFlatStore.getState().setPanelMode('floating')
    useFlatStore.getState().setPanelMode('docked')
    expect(useFlatStore.getState().panelMode).toBe('docked')
  })
})

// ── floatingPos 상태 테스트 ────────────────────────────

describe('floatingPos 상태', () => {
  beforeEach(() => {
    seedFlatStore([makeEl()])
  })

  it('초기값은 { x: null, y: 80 }', () => {
    const pos = useFlatStore.getState().floatingPos
    expect(pos.x).toBeNull()
    expect(pos.y).toBe(80)
  })

  it('setFloatingPos로 위치 변경', () => {
    useFlatStore.getState().setFloatingPos({ x: 200, y: 300 })
    const pos = useFlatStore.getState().floatingPos
    expect(pos.x).toBe(200)
    expect(pos.y).toBe(300)
  })

  it('모드 전환 후에도 위치 유지', () => {
    useFlatStore.getState().setFloatingPos({ x: 150, y: 250 })
    useFlatStore.getState().setPanelMode('docked')
    useFlatStore.getState().setPanelMode('floating')
    const pos = useFlatStore.getState().floatingPos
    expect(pos.x).toBe(150)
    expect(pos.y).toBe(250)
  })
})

// ── Cross-selection (split 모드) 테스트 ────────────────

describe('Cross-selection 해제', () => {
  beforeEach(() => {
    seedFlatStore([makeEl(), makeEl({ id: 'el-2' })])
    seedEditorStore()
    useFlatStore.setState({ viewMode: 'split' })
  })

  it('flat 선택 시 HTML 선택은 독립적 (store 레벨)', () => {
    // store 레벨에서는 각각 독립적으로 설정 가능
    useEditorStore.setState({ selectedId: 'html-1' })
    useFlatStore.getState().setSelectedFlat('el-1')

    // 두 선택이 동시에 존재할 수 있음 (컴포넌트 레벨에서 cross-clear)
    expect(useFlatStore.getState().selectedFlatId).toBe('el-1')
    expect(useEditorStore.getState().selectedId).toBe('html-1')
  })

  it('setSelectedFlat(null)로 flat 선택 해제', () => {
    useFlatStore.getState().setSelectedFlat('el-1')
    expect(useFlatStore.getState().selectedFlatId).toBe('el-1')

    useFlatStore.getState().setSelectedFlat(null)
    expect(useFlatStore.getState().selectedFlatId).toBeNull()
  })

  it('editorStore.setSelected(null)로 HTML 선택 해제', () => {
    useEditorStore.setState({ selectedId: 'html-1' })
    expect(useEditorStore.getState().selectedId).toBe('html-1')

    useEditorStore.getState().setSelected(null)
    expect(useEditorStore.getState().selectedId).toBeNull()
  })

  it('cross-clear 시뮬레이션: flat 선택 → HTML 해제', () => {
    // 컴포넌트 동작을 시뮬레이션
    useEditorStore.setState({ selectedId: 'html-1' })

    // FlatElementRenderer의 handleMouseDown 동작 재현
    useFlatStore.getState().setSelectedFlat('el-1')
    useEditorStore.getState().setSelected(null)

    expect(useFlatStore.getState().selectedFlatId).toBe('el-1')
    expect(useEditorStore.getState().selectedId).toBeNull()
  })

  it('cross-clear 시뮬레이션: HTML 선택 → flat 해제', () => {
    // 컴포넌트 동작을 시뮬레이션
    useFlatStore.getState().setSelectedFlat('el-1')

    // SlideCanvas의 fe:select 핸들러 동작 재현
    useEditorStore.getState().setSelected('html-1')
    useFlatStore.getState().setSelectedFlat(null)

    expect(useEditorStore.getState().selectedId).toBe('html-1')
    expect(useFlatStore.getState().selectedFlatId).toBeNull()
  })
})
