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

  it('sourceId=__bg 배경(추출/변환)은 콘텐츠 아래로 렌더', () => {
    const bg = shape('extbg', { x: 0, y: 0, width: 1280, height: 720, zIndex: 7, content: '', sourceId: '__bg' })
    const { container } = render(<FlatElementRenderer element={bg} isSelected={false} isEditing={false} scale={1} />)
    expect(Number(container.firstChild.style.zIndex)).toBeLessThan(-100000)
  })

  it('플래그/__bg 없는 풀캔버스 도형은 더 이상 배경 아님(일반 z 유지·선택 가능)', () => {
    // 크기 추론 제거: 사용자가 만든 전체화면 도형이 배경으로 잠기지 않는다
    const el = shape('fullshape', { x: 0, y: 0, width: 1280, height: 720, zIndex: 999, content: '' })
    const { container } = render(<FlatElementRenderer element={el} isSelected={false} isEditing={false} scale={1} />)
    expect(Number(container.firstChild.style.zIndex)).toBe(999)
    expect(container.firstChild.style.pointerEvents).not.toBe('none') // 선택 가능
  })
})
