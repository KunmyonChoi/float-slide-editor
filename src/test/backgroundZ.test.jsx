import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import FlatElementRenderer from '../components/FlatElementRenderer'
import { useFlatStore } from '../store/flatStore'

function shape(id, extra = {}) {
  return { id, type: 'shape', x: 0, y: 0, width: 100, height: 50, zIndex: 5, content: '', styles: { backgroundColor: '#eee' }, ...extra }
}

describe('배경 레이어는 항상 콘텐츠 아래로 렌더', () => {
  beforeEach(() => {
    useFlatStore.setState({ canvasSize: { w: 1280, h: 720 }, selectedFlatIds: [] })
  })

  it('isBackground 요소는 렌더 zIndex가 큰 음수(콘텐츠보다 낮음)', () => {
    const bg = shape('bg', { x: 0, y: 0, width: 1280, height: 720, zIndex: 5, isBackground: true })
    const { container } = render(<FlatElementRenderer element={bg} isSelected={false} isEditing={false} scale={1} />)
    expect(Number(container.firstChild.style.zIndex)).toBeLessThan(-100000)
  })

  it('일반 요소는 모델 zIndex 그대로', () => {
    const txt = { id: 't', type: 'text', x: 10, y: 10, width: 100, height: 30, zIndex: 5, content: 'hi', isRich: false, styles: {} }
    const { container } = render(<FlatElementRenderer element={txt} isSelected={false} isEditing={false} scale={1} />)
    expect(Number(container.firstChild.style.zIndex)).toBe(5)
  })

  it('높은 zIndex의 풀캔버스 배경도 콘텐츠 아래(휴리스틱)', () => {
    // isBackground 플래그 없이 전체 캔버스 크기 무내용 도형 → 배경으로 간주
    const bg = shape('fullbg', { x: 0, y: 0, width: 1280, height: 720, zIndex: 999, content: '' })
    const { container } = render(<FlatElementRenderer element={bg} isSelected={false} isEditing={false} scale={1} />)
    expect(Number(container.firstChild.style.zIndex)).toBeLessThan(0)
  })
})
