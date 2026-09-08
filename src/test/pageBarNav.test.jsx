import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import PageBar from '../components/PageBar'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

// 하단 바는 좁은 화면(모바일)에서 페이지를 넘길 유일한 손잡이다. 슬라이드 목록 패널이
// 보이지 않는 상황을 가정하고, 버튼이 실제로 페이지를 옮기는지만 본다.

const CS = { w: 1280, h: 720 }
const page = (tag) => ({
  elements: [{ id: tag, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, content: '', styles: {} }],
  canvasSize: CS, htmlSlideIndex: null,
})

function load(tags, currentKey) {
  const data = {}
  tags.forEach((t, i) => { data[`${i}-0`] = page(t) })
  useFlatStore.getState().loadAllPages(data, currentKey)
  useFlatStore.setState({ viewMode: 'flat', _preloading: false })
  useEditorStore.setState({ mode: 'edit' })
}

const prev = () => screen.getByLabelText('이전 페이지')
const next = () => screen.getByLabelText('다음 페이지')
const label = () => screen.getByText(/^\d+ \/ \d+$/).textContent

describe('PageBar — flat 모드 페이지 이동 버튼', () => {
  beforeEach(() => { cleanup(); load(['A', 'B', 'C'], '1-0') }) // 현재 = B(index 1)

  it('다음/이전 버튼이 페이지를 옮긴다', () => {
    render(<PageBar />)
    expect(label()).toBe('2 / 3')

    fireEvent.click(next())
    expect(useFlatStore.getState().flatCurrentPage).toBe(2)
    expect(label()).toBe('3 / 3')

    fireEvent.click(prev())
    expect(useFlatStore.getState().flatCurrentPage).toBe(1)
    expect(label()).toBe('2 / 3')
  })

  it('양 끝에서는 해당 방향 버튼이 비활성화된다', () => {
    load(['A', 'B', 'C'], '0-0') // 첫 페이지
    render(<PageBar />)
    expect(prev()).toBeDisabled()
    expect(next()).not.toBeDisabled()

    fireEvent.click(next())
    fireEvent.click(next())
    expect(label()).toBe('3 / 3')
    expect(next()).toBeDisabled()
    expect(prev()).not.toBeDisabled()
  })

  it('프리로드 중에는 이동을 막는다(변환과 충돌)', () => {
    useFlatStore.setState({ _preloading: true })
    render(<PageBar />)
    expect(next()).toBeDisabled()
    expect(prev()).toBeDisabled()
  })

  it('페이지 추가/삭제 버튼은 하단 바에 두지 않는다(목록 컨텍스트 메뉴·단축키 담당)', () => {
    render(<PageBar />)
    expect(screen.queryByTitle(/페이지 추가/)).toBeNull()
    expect(screen.queryByTitle(/페이지 삭제/)).toBeNull()
  })
})
