import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'

// ── 헬퍼 ─────────────────────────────────────────────

const DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  color: '#000', fontSize: '16px', fontFamily: 'sans-serif',
  fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
  letterSpacing: 'normal', textTransform: 'none', textDecoration: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'cover',
}

function makeEl(overrides = {}) {
  return {
    id: 'el-1',
    type: 'text',
    x: 100, y: 200, width: 300, height: 50, zIndex: 1,
    content: 'Hello',
    isRich: false, merged: false, sourceId: 'src-1',
    styles: { ...DEFAULT_STYLES },
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

// FlatContextMenu에서 사용하는 요소 생성 로직 재현
const ELEMENT_PRESETS = {
  text: {
    type: 'text', width: 200, height: 40,
    content: '새 텍스트', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, padding: '4px 8px' },
  },
  rect: {
    type: 'shape', width: 150, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0' },
  },
  circle: {
    type: 'shape', width: 100, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', borderRadius: '50%' },
  },
}

function insertElement(preset, canvasX, canvasY) {
  const p = ELEMENT_PRESETS[preset]
  const { canvasSize, flatElements, addFlatElement, setSelectedFlat } = s()
  let ex = canvasX - p.width / 2
  let ey = canvasY - p.height / 2
  ex = Math.max(0, Math.min(ex, canvasSize.w - p.width))
  ey = Math.max(0, Math.min(ey, canvasSize.h - p.height))
  const maxZ = flatElements.length > 0
    ? Math.max(...flatElements.map(e => e.zIndex))
    : 0
  const el = {
    id: nextFlatId(),
    sourceId: null,
    ...p,
    styles: { ...p.styles },
    x: ex, y: ey,
    zIndex: maxZ + 1,
  }
  addFlatElement(el)
  setSelectedFlat(el.id)
}

// ── 요소 추가 ────────────────────────────────────────

describe('컨텍스트 메뉴: 요소 추가', () => {
  beforeEach(() => seedStore([]))

  it('텍스트 요소 추가 — 클릭 위치 중심', () => {
    insertElement('text', 400, 300)
    expect(s().flatElements.length).toBe(1)
    const el = s().flatElements[0]
    expect(el.type).toBe('text')
    expect(el.content).toBe('새 텍스트')
    expect(el.x).toBe(400 - 200 / 2) // 300
    expect(el.y).toBe(300 - 40 / 2)  // 280
    expect(el.width).toBe(200)
    expect(el.height).toBe(40)
    expect(el.zIndex).toBe(1)
    // 자동 선택
    expect(s().selectedFlatIds).toEqual([el.id])
  })

  it('사각형 요소 추가', () => {
    insertElement('rect', 640, 400)
    const el = s().flatElements[0]
    expect(el.type).toBe('shape')
    expect(el.width).toBe(150)
    expect(el.height).toBe(100)
    expect(el.styles.borderRadius).toBe('0px')
  })

  it('원형 요소 추가', () => {
    insertElement('circle', 640, 400)
    const el = s().flatElements[0]
    expect(el.type).toBe('shape')
    expect(el.width).toBe(100)
    expect(el.height).toBe(100)
    expect(el.styles.borderRadius).toBe('50%')
  })

  it('캔버스 경계 클램프 — 좌상단 초과', () => {
    insertElement('text', 10, 5) // 200x40 → x=-90, y=-15 → clamped to 0,0
    const el = s().flatElements[0]
    expect(el.x).toBe(0)
    expect(el.y).toBe(0)
  })

  it('캔버스 경계 클램프 — 우하단 초과', () => {
    insertElement('text', 1270, 790) // x=1170, y=770 → clamped
    const el = s().flatElements[0]
    expect(el.x).toBe(1280 - 200) // 1080
    expect(el.y).toBe(800 - 40)   // 760
  })

  it('zIndex는 기존 요소보다 높아야 함', () => {
    seedStore([
      makeEl({ id: 'a', zIndex: 5 }),
      makeEl({ id: 'b', zIndex: 10 }),
    ])
    insertElement('rect', 400, 300)
    const newEl = s().flatElements.find(e => e.id !== 'a' && e.id !== 'b')
    expect(newEl.zIndex).toBe(11)
  })

  it('요소 추가 후 undo → 제거', () => {
    insertElement('text', 400, 300)
    expect(s().flatElements.length).toBe(1)
    s().undo()
    expect(s().flatElements.length).toBe(0)
  })

  it('요소 추가 undo → redo → 복원', () => {
    insertElement('circle', 500, 400)
    const id = s().flatElements[0].id
    s().undo()
    expect(s().flatElements.length).toBe(0)
    s().redo()
    expect(s().flatElements.length).toBe(1)
    expect(s().flatElements[0].id).toBe(id)
  })
})

// ── 컨텍스트 메뉴 액션 (store 통합) ──────────────────

describe('컨텍스트 메뉴: 편집 액션', () => {
  beforeEach(() => {
    seedStore([
      makeEl({ id: 'a', x: 10, y: 10, zIndex: 1 }),
      makeEl({ id: 'b', x: 100, y: 100, zIndex: 2 }),
      makeEl({ id: 'c', x: 200, y: 200, zIndex: 3 }),
    ])
  })

  it('선택 후 복사 → 붙여넣기', () => {
    s().setSelectedFlat('a')
    s().copyElement()
    s().pasteElement()
    expect(s().flatElements.length).toBe(4)
    const pasted = s().flatElements[3]
    expect(pasted.x).toBe(30) // 10 + 20
  })

  it('선택 후 잘라내기 → 붙여넣기', () => {
    s().setSelectedFlat('b')
    s().cutElement()
    expect(s().flatElements.length).toBe(2)
    s().pasteElement()
    expect(s().flatElements.length).toBe(3)
  })

  it('선택 후 복제', () => {
    s().setSelectedFlat('a')
    s().duplicateElement()
    expect(s().flatElements.length).toBe(4)
  })

  it('선택 후 삭제', () => {
    s().setSelectedFlats(['a', 'c'])
    s().removeSelectedElements()
    expect(s().flatElements.length).toBe(1)
    expect(s().flatElements[0].id).toBe('b')
  })

  it('전체 선택', () => {
    s().selectAllFlats()
    expect(s().selectedFlatIds).toEqual(['a', 'b', 'c'])
  })

  it('z-순서: 맨 앞으로', () => {
    s().setSelectedFlat('a')
    s().bringToFront('a')
    const a = s().flatElements.find(e => e.id === 'a')
    expect(a.zIndex).toBe(4) // max(3) + 1
  })

  it('z-순서: 맨 뒤로', () => {
    s().setSelectedFlat('c')
    s().sendToBack('c')
    const c = s().flatElements.find(e => e.id === 'c')
    expect(c.zIndex).toBe(0) // min(1) - 1
  })
})

// ── 메뉴 항목 구성 로직 ──────────────────────────────

describe('컨텍스트 메뉴: 항목 구성', () => {
  // FlatContextMenu 내부의 items 빌드 로직을 순수 함수로 검증
  function getMenuItems(hasSelection, singleId, clipboardEmpty) {
    if (hasSelection) {
      return [
        { id: 'cut', action: 'cut' },
        { id: 'copy', action: 'copy' },
        { id: 'paste', action: 'paste', disabled: clipboardEmpty },
        { id: 'dup', action: 'duplicate' },
        { id: 'del', action: 'delete' },
        { id: 'sep1', type: 'separator' },
        { id: 'zorder', submenu: 'zorder', disabled: !singleId },
        { id: 'sep2', type: 'separator' },
        { id: 'all', action: 'selectAll' },
      ]
    }
    return [
      { id: 'paste', action: 'paste', disabled: clipboardEmpty },
      { id: 'sep1', type: 'separator' },
      { id: 'insert', submenu: 'insert' },
      { id: 'sep2', type: 'separator' },
      { id: 'all', action: 'selectAll' },
    ]
  }

  it('선택 없음 → 붙여넣기 + 요소 추가 + 전체 선택', () => {
    const items = getMenuItems(false, null, true)
    const ids = items.filter(i => !i.type).map(i => i.id)
    expect(ids).toEqual(['paste', 'insert', 'all'])
    expect(items.find(i => i.id === 'paste').disabled).toBe(true)
  })

  it('선택 있음 → 편집 메뉴 + 순서 + 전체 선택', () => {
    const items = getMenuItems(true, 'a', false)
    const ids = items.filter(i => !i.type).map(i => i.id)
    expect(ids).toEqual(['cut', 'copy', 'paste', 'dup', 'del', 'zorder', 'all'])
    expect(items.find(i => i.id === 'paste').disabled).toBe(false)
    expect(items.find(i => i.id === 'zorder').disabled).toBe(false)
  })

  it('다중 선택 → 순서 서브메뉴 비활성', () => {
    const items = getMenuItems(true, null, false) // singleId = null
    expect(items.find(i => i.id === 'zorder').disabled).toBe(true)
  })

  it('클립보드 비어있으면 붙여넣기 비활성', () => {
    const items = getMenuItems(true, 'a', true)
    expect(items.find(i => i.id === 'paste').disabled).toBe(true)
  })

  it('클립보드 있으면 붙여넣기 활성', () => {
    const items = getMenuItems(false, null, false)
    expect(items.find(i => i.id === 'paste').disabled).toBe(false)
  })
})
