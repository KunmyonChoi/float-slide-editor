import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import TouchZoomNav from '../components/TouchZoomNav'

const canvas = { w: 1920, h: 1080 }
const stage = { w: 400, h: 300, fit: 0.2 }

function setup(over = {}) {
  const props = {
    scale: 0.2, pan: { x: 0, y: 0 }, fit: 0.2, stage, canvas, elements: [],
    onPan: vi.fn(), onZoom: vi.fn(), onFit: vi.fn(), panTool: false, onTogglePan: vi.fn(),
    handIcon: null, ...over,
  }
  return { props, ...render(<TouchZoomNav {...props} />) }
}

describe('TouchZoomNav — 미니맵 패드 · 줌 슬라이더', () => {
  it('맞춤 크기에선 움직일 곳이 없어 미니맵을 숨긴다', () => {
    const { queryByTestId, getByTestId } = setup()
    expect(queryByTestId('minimap-pad')).toBeNull()
    expect(getByTestId('zoom-slider')).toBeTruthy()
  })

  it('확대하면 미니맵과 보이는 영역 사각형이 나온다', () => {
    const { getByTestId } = setup({ scale: 1 })
    const view = getByTestId('minimap-view')
    const k = 132 / 1920
    expect(Number(view.getAttribute('x'))).toBeCloseTo(760 * k)
    expect(Number(view.getAttribute('width'))).toBeCloseTo(400 * k)
  })

  it('미니맵 바탕은 맨 위 배경 레이어 색, 도형은 제 색', () => {
    const elements = [
      { id: 'b1', type: 'shape', x: 0, y: 0, width: 1920, height: 1080, zIndex: 0, isBackground: true, sourceId: '__bg', styles: { backgroundColor: 'rgb(15, 23, 42)' } },
      { id: 'b2', type: 'shape', x: 0, y: 0, width: 1920, height: 1080, zIndex: 1, sourceId: '__bg', styles: { backgroundColor: 'rgb(241, 245, 249)' } },
      { id: 's', type: 'shape', x: 100, y: 100, width: 400, height: 300, zIndex: 2, styles: { backgroundColor: 'rgb(99, 102, 241)' } },
      { id: 't', type: 'text', x: 600, y: 100, width: 400, height: 100, zIndex: 3, styles: { backgroundColor: 'rgba(0, 0, 0, 0)' } },
    ]
    const { getByTestId } = setup({ scale: 1, elements })
    const pad = getByTestId('minimap-pad')
    expect(pad.style.background).toBe('rgb(241, 245, 249)')
    const fills = [...pad.querySelectorAll('rect')].map(r => r.getAttribute('fill'))
    expect(fills).toContain('rgb(99, 102, 241)')
    expect(fills).toContain('rgba(100,116,139,0.32)')
  })

  it('미니맵을 접고 다시 펼 수 있다', () => {
    const { getByLabelText, queryByTestId } = setup({ scale: 1 })
    fireEvent.click(getByLabelText('미니맵 접기'))
    expect(queryByTestId('minimap-pad')).toBeNull()
    fireEvent.click(getByLabelText('미니맵 펴기'))
    expect(queryByTestId('minimap-pad')).toBeTruthy()
  })

  it('사각형 밖을 탭하면 그곳을 가운데로 가져오고, 끌면 따라간다', () => {
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad') // jsdom 사각형은 (0,0) 기준
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 10, clientY: 10 })
    // 왼쪽 위 구석 → 보이는 영역이 슬라이드 안에 남도록 제한된 가운데
    expect(props.onPan).toHaveBeenLastCalledWith({ x: 760, y: 390 })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 20, clientY: 10 })
    const last = props.onPan.mock.calls.at(-1)[0]
    expect(last.x).toBeCloseTo(960 - 20 / (132 / 1920))
    fireEvent.pointerUp(pad, { pointerId: 1 })
    props.onPan.mockClear()
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 40, clientY: 10 })
    expect(props.onPan).not.toHaveBeenCalled() // 손을 떼면 그 자리에 멈춘다
  })

  it('사각형 안을 잡으면 잡은 자리 그대로 끈다(탭만으로는 움직이지 않음)', () => {
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    const k = 132 / 1920
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 960 * k, clientY: 540 * k })
    expect(props.onPan).not.toHaveBeenCalled()
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 960 * k + 5, clientY: 540 * k })
    const last = props.onPan.mock.calls.at(-1)[0]
    expect(last.x).toBeCloseTo(-5 / k)
    expect(last.y).toBeCloseTo(0)
  })

  it('컨트롤 크기만큼 오른쪽·아래 슬라이드 밖까지 끌 수 있다(가린 구석 꺼내 보기)', () => {
    const ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.dataset.testid === 'touch-zoom-nav' ? 206 : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.dataset.testid === 'touch-zoom-nav' ? 128 : 0 } })
    try {
      const { getByTestId, props } = setup({ scale: 1 })
      const pad = getByTestId('minimap-pad')
      const k = 132 / 1920
      fireEvent.pointerDown(pad, { pointerId: 1, clientX: 960 * k, clientY: 540 * k })
      fireEvent.pointerMove(pad, { pointerId: 1, clientX: 500, clientY: 500 })
      // 컨트롤 206×128 + 가장자리 12 → 오른쪽 218, 아래 140 더
      expect(props.onPan).toHaveBeenLastCalledWith({ x: 960 - (1920 - 200 + 218), y: 540 - (1080 - 150 + 140) })
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh)
    }
  })

  it('슬라이더 왼쪽 끝은 맞춤, 끌면 로그 눈금 배율', () => {
    const { getByTestId, props } = setup()
    const slider = getByTestId('zoom-slider') // 폭 112, 손잡이 18 → 이동 거리 94
    fireEvent.pointerDown(slider, { pointerId: 1, clientX: 9 })
    expect(props.onFit).toHaveBeenCalled()
    fireEvent.pointerMove(slider, { pointerId: 1, clientX: 9 + 94 })
    expect(props.onZoom).toHaveBeenLastCalledWith(2)
    fireEvent.pointerUp(slider, { pointerId: 1 })
  })

  it('% 버튼: 맞춤이면 100%로, 확대 중이면 맞춤으로', () => {
    const a = setup()
    fireEvent.click(a.getByText('20%'))
    expect(a.props.onZoom).toHaveBeenCalledWith(1)
    a.unmount()
    const b = setup({ scale: 1 })
    fireEvent.click(b.getByText('100%'))
    expect(b.props.onFit).toHaveBeenCalled()
  })
})
