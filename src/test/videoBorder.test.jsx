import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import FlatElementRenderer from '../components/FlatElementRenderer'
import { useFlatStore } from '../store/flatStore'
import { exportFlatHtml } from '../core/FlatExporter'

/**
 * 영상 테두리·모서리 둥글기 — 이미지와 같은 방식(styles.border / styles.borderRadius).
 * 영상은 자체 컴포지팅 레이어로 승격돼 상위 overflow:hidden으로 잘리지 않으므로, 래퍼가
 * 테두리를 그리고 안쪽 콘텐츠에는 두께만큼 줄인 반경을 따로 넘긴다.
 */
function video(extra = {}) {
  return {
    id: 'v1', type: 'video', x: 0, y: 0, width: 320, height: 180, zIndex: 1,
    content: 'https://www.youtube.com/embed/abc123',
    styles: { borderRadius: '0px', border: '0px none', opacity: '1' },
    ...extra,
  }
}

const renderVideo = (el) =>
  render(<FlatElementRenderer element={el} isSelected={false} isEditing={false} scale={1} />)

// 래퍼 = 바깥 박스(위치/크기) 안쪽의 실제 그리기 박스
const wrapperOf = (container) => container.firstChild.firstChild

describe('영상 테두리·모서리 둥글기 렌더', () => {
  beforeEach(() => {
    useFlatStore.setState({ canvasSize: { w: 1280, h: 720 }, selectedFlatIds: [] })
  })

  it('테두리 없이 반경만 주면 래퍼가 둥글어진다', () => {
    const { container } = renderVideo(video({ styles: { borderRadius: '16px', border: '0px none' } }))
    const w = wrapperOf(container)
    expect(w.style.borderRadius).toBe('16px')
    expect(w.style.overflow).toBe('hidden')
  })

  it('테두리를 주면 래퍼가 그리고 박스 안쪽으로 들어간다', () => {
    const { container } = renderVideo(video({ styles: { border: '4px solid rgb(255, 0, 0)', borderRadius: '0px' } }))
    const w = wrapperOf(container)
    expect(w.style.border).toBe('4px solid rgb(255, 0, 0)')
    expect(w.style.boxSizing).toBe('border-box') // 테두리가 크기를 밀어내지 않는다
  })

  it('개별 면 테두리도 이미지·도형과 같은 규칙으로 적용된다', () => {
    const { container } = renderVideo(video({
      styles: {
        borderTop: '2px solid rgb(0, 0, 255)', borderRight: '0px none',
        borderBottom: '0px none', borderLeft: '0px none', borderRadius: '0px',
      },
    }))
    expect(wrapperOf(container).style.borderTop).toBe('2px solid rgb(0, 0, 255)')
  })

  it('배경(라이브 배경) 영상에도 그대로 적용된다', () => {
    const el = video({ x: 0, y: 0, width: 1280, height: 720, isBackground: true, styles: { borderRadius: '24px', border: '0px none' } })
    const { container } = renderVideo(el)
    expect(wrapperOf(container).style.borderRadius).toBe('24px')
  })
})

describe('영상 테두리 — HTML 내보내기', () => {
  const CANVAS = { w: 1280, h: 720 }

  it('테두리와 반경이 내보낸 HTML에 실린다', () => {
    const html = exportFlatHtml([video({ styles: { border: '3px solid #ff0000', borderRadius: '12px', opacity: '1' } })], CANVAS)
    expect(html).toContain('border-radius:12px')
    expect(html).toContain('border:3px solid #ff0000')
    expect(html).toContain('box-sizing:border-box')
  })

  it('테두리가 없으면 border 선언을 넣지 않는다', () => {
    const html = exportFlatHtml([video({ styles: { border: '0px none', borderRadius: '0px', opacity: '1' } })], CANVAS)
    expect(html).not.toContain('border:0px none')
  })
})

describe('영상 테두리 — 속성 패널', () => {
  it('영상을 선택하면 이미지와 같은 선/모서리 컨트롤이 뜬다', async () => {
    const el = video({ styles: { border: '0px none', borderRadius: '0px', opacity: '1' } })
    useFlatStore.setState({
      flatElements: [el], selectedFlatIds: [el.id], editingFlatId: null,
      canvasSize: { w: 1280, h: 720 }, diagramMode: false,
    })
    const { default: FlatPropertyContent } = await import('../components/FlatPropertyContent')
    const { findByText } = render(<FlatPropertyContent />)
    expect(await findByText('모서리 둥글기')).toBeInTheDocument()
    expect(await findByText('선')).toBeInTheDocument()  // 선(테두리) 섹션 제목
  })
})
