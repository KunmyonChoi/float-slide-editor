import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'
import { parseColor, hexToRgba } from '../components/ColorPicker'

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

function seedStore(elements) {
  useFlatStore.setState({
    flatElements: elements,
    selectedFlatId: null,
    editingFlatId: null,
    canvasSize: { w: 1280, h: 800 },
  })
  useFlatStore.getState().clearHistory()
}

// ── styles 중첩 머지 테스트 ─────────────────────────

describe('updateFlatElement styles 중첩 머지', () => {
  beforeEach(() => {
    seedStore([makeEl()])
  })

  it('styles 일부만 변경해도 나머지 보존', () => {
    const s = useFlatStore.getState
    s().updateFlatElement('el-1', { styles: { color: 'red' } })
    const el = s().flatElements[0]
    expect(el.styles.color).toBe('red')
    expect(el.styles.fontSize).toBe('16px')  // 보존
    expect(el.styles.fontFamily).toBe('Arial')  // 보존
    expect(el.styles.textAlign).toBe('left')  // 보존
  })

  it('여러 styles 키 동시 변경', () => {
    const s = useFlatStore.getState
    s().updateFlatElement('el-1', { styles: { color: 'blue', fontSize: '24px', textAlign: 'center' } })
    const el = s().flatElements[0]
    expect(el.styles.color).toBe('blue')
    expect(el.styles.fontSize).toBe('24px')
    expect(el.styles.textAlign).toBe('center')
    expect(el.styles.fontFamily).toBe('Arial')  // 보존
  })

  it('styles 변경 후 undo → 전체 styles 복원', () => {
    const s = useFlatStore.getState
    s().updateFlatElement('el-1', { styles: { color: 'red', fontSize: '32px' } })
    expect(s().flatElements[0].styles.color).toBe('red')

    s().undo()
    expect(s().flatElements[0].styles.color).toBe('#000')
    expect(s().flatElements[0].styles.fontSize).toBe('16px')
  })

  it('styles 변경 + 위치 변경 → 각각 undo', () => {
    const s = useFlatStore.getState
    s().updateFlatElement('el-1', { styles: { color: 'green' } })
    s().updateFlatElement('el-1', { x: 500 })

    s().undo()  // 위치 원복
    expect(s().flatElements[0].x).toBe(100)
    expect(s().flatElements[0].styles.color).toBe('green')

    s().undo()  // 색상 원복
    expect(s().flatElements[0].styles.color).toBe('#000')
  })

  it('styles와 비-styles를 동시에 변경', () => {
    const s = useFlatStore.getState
    s().updateFlatElement('el-1', { x: 999, styles: { color: 'purple' } })
    const el = s().flatElements[0]
    expect(el.x).toBe(999)
    expect(el.styles.color).toBe('purple')
    expect(el.styles.fontSize).toBe('16px')
  })
})

describe('previewFlatElement styles 중첩 머지', () => {
  beforeEach(() => {
    seedStore([makeEl()])
  })

  it('preview도 styles 머지 동작', () => {
    const s = useFlatStore.getState
    s().previewFlatElement('el-1', { styles: { opacity: '0.5' } })
    const el = s().flatElements[0]
    expect(el.styles.opacity).toBe('0.5')
    expect(el.styles.color).toBe('#000')  // 보존
  })
})

// ── ColorPicker 유틸 테스트 ─────────────────────────

describe('parseColor', () => {
  it('hex 색상 파싱', () => {
    const result = parseColor('#ff0000')
    expect(result.hex).toBe('#ff0000')
    expect(result.opacity).toBe(1)
  })

  it('3자리 hex 확장', () => {
    const result = parseColor('#f00')
    expect(result.hex).toBe('#ff0000')
    expect(result.opacity).toBe(1)
  })

  it('rgba 파싱', () => {
    const result = parseColor('rgba(255, 0, 0, 0.5)')
    expect(result.hex).toBe('#ff0000')
    expect(result.opacity).toBe(0.5)
  })

  it('rgb 파싱 (opacity 1)', () => {
    const result = parseColor('rgb(0, 128, 255)')
    expect(result.hex).toBe('#0080ff')
    expect(result.opacity).toBe(1)
  })

  it('투명 파싱', () => {
    const result = parseColor('transparent')
    expect(result.hex).toBe('#000000')
    expect(result.opacity).toBe(0)
  })

  it('빈 값 → 기본값', () => {
    const result = parseColor('')
    expect(result.hex).toBe('#000000')
    expect(result.opacity).toBe(1)
  })
})

describe('hexToRgba', () => {
  it('hex + opacity → rgba 문자열', () => {
    expect(hexToRgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('opacity 1 → rgba(r,g,b,1)', () => {
    expect(hexToRgba('#00ff00', 1)).toBe('rgba(0, 255, 0, 1)')
  })
})
