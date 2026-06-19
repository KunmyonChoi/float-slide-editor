import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import FlatElementRenderer from '../components/FlatElementRenderer'
import { useFlatStore } from '../store/flatStore'
import { resolveConnectors } from '../core/ConnectorRouting'

describe('커넥터 렌더 (점 기반 분기 재사용)', () => {
  beforeEach(() => {
    useFlatStore.setState({ canvasSize: { w: 1280, h: 720 }, selectedFlatIds: [] })
  })

  it('resolveConnectors로 points가 채워진 커넥터는 SVG path로 렌더된다', () => {
    const A = { id: 'A', type: 'shape', x: 0, y: 0, width: 100, height: 100, zIndex: 1, content: '', styles: {} }
    const B = { id: 'B', type: 'shape', x: 300, y: 0, width: 100, height: 100, zIndex: 2, content: '', styles: {} }
    const conn = {
      id: 'C', type: 'shape', shapeType: 'connector', zIndex: 3,
      connection: { start: { elementId: 'A' }, end: { elementId: 'B' } },
      startArrow: 'none', endArrow: 'triangle',
      styles: { stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '', fill: 'none' },
    }
    const resolved = resolveConnectors([A, B, conn])
    const rc = resolved.find(e => e.id === 'C')
    expect(rc.points).toHaveLength(2)

    const { container } = render(
      <FlatElementRenderer element={rc} isSelected={false} isEditing={false} scale={1} />
    )
    // 점 기반 shape 분기 → svg + path 렌더
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('path')).toBeTruthy()
    // 끝 화살표 마커 정의 존재
    expect(container.querySelector(`marker#me-C`)).toBeTruthy()
  })

  it('컨테이너는 클릭 통과(pointer-events:none), 선만 히트(stroke)', () => {
    const A = { id: 'A', type: 'shape', x: 0, y: 0, width: 100, height: 100, zIndex: 1, content: '', styles: {} }
    const B = { id: 'B', type: 'shape', x: 300, y: 0, width: 100, height: 100, zIndex: 2, content: '', styles: {} }
    const conn = {
      id: 'C', type: 'shape', shapeType: 'connector', zIndex: 3,
      connection: { start: { elementId: 'A' }, end: { elementId: 'B' } },
      startArrow: 'none', endArrow: 'triangle', styles: { stroke: '#1e293b', strokeWidth: '2', fill: 'none' },
    }
    const rc = resolveConnectors([A, B, conn]).find(e => e.id === 'C')
    const { container } = render(
      <FlatElementRenderer element={rc} isSelected={true} isEditing={false} scale={1} />
    )
    const outer = container.firstChild
    expect(outer.style.pointerEvents).toBe('none')          // 빈 bbox는 뒤 도형 클릭 통과
    const hit = container.querySelector('path[stroke="transparent"]') // 투명 히트영역
    expect(hit.getAttribute('pointer-events')).toBe('stroke') // 선 위에서만 선택
  })

  it('곡선 라우팅 커넥터는 베지어(C) path + 라벨 칩으로 렌더된다', () => {
    const A = { id: 'A', type: 'shape', x: 0, y: 0, width: 100, height: 100, zIndex: 1, content: '', styles: {} }
    const B = { id: 'B', type: 'shape', x: 300, y: 0, width: 100, height: 100, zIndex: 2, content: '', styles: {} }
    const conn = {
      id: 'C', type: 'shape', shapeType: 'connector', zIndex: 3, routing: 'curved', content: '관계',
      connection: { start: { elementId: 'A' }, end: { elementId: 'B' } },
      startArrow: 'none', endArrow: 'triangle',
      styles: { stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '', fill: 'none' },
    }
    const rc = resolveConnectors([A, B, conn]).find(e => e.id === 'C')
    const { container, getByText } = render(
      <FlatElementRenderer element={rc} isSelected={false} isEditing={false} scale={1} />
    )
    const paths = [...container.querySelectorAll('path')].map(p => p.getAttribute('d') || '')
    expect(paths.some(d => d.includes('C'))).toBe(true) // 베지어 path 존재
    expect(getByText('관계')).toBeTruthy()              // 라벨 칩
  })
})
