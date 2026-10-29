import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
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

// requestAnimationFrame을 손으로 돌린다 — 미니맵은 손가락 위치를 필터로 거른 뒤 프레임마다 화면을 옮긴다
function frameDriver() {
  const q = new Map(); let id = 0, t = 0
  vi.stubGlobal('requestAnimationFrame', (cb) => { q.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (i) => { q.delete(i) })
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      t += 1000 / 60
      const cbs = [...q.values()]; q.clear()
      act(() => cbs.forEach(cb => cb(t)))
    }
  }
  const settle = (max = 600) => { for (let i = 0; i < max && q.size; i++) step() }
  return { step, settle, pending: () => q.size }
}

afterEach(() => { vi.unstubAllGlobals() })

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

  it('사각형 밖을 탭하면 그곳이 가운데로 미끄러져 오고, 손을 떼면 그 자리에 멈춘다', () => {
    const f = frameDriver()
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad') // jsdom 사각형은 (0,0) 기준
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 10, clientY: 10 })
    f.step(3)
    const glide = props.onPan.mock.calls.map(c => c[0].x)
    expect(glide.length).toBe(3)                       // 매 프레임 조금씩
    expect(glide[0]).toBeGreaterThan(0)
    expect(glide[0]).toBeLessThan(760)
    fireEvent.pointerUp(pad, { pointerId: 1 })
    f.settle()
    // 왼쪽 위 구석 → 보이는 영역이 슬라이드 안에 남도록 제한된 가운데
    expect(props.onPan).toHaveBeenLastCalledWith({ x: 760, y: 390 })
    expect(f.pending()).toBe(0)                        // 루프도 끝났다
    const n = props.onPan.mock.calls.length
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 40, clientY: 10 })
    f.step(5)
    expect(props.onPan).toHaveBeenCalledTimes(n)       // 손을 떼면 그 자리에 멈춘다
  })

  it('사각형 안을 탭만 하면 화면은 그대로(손가락이 조금 흔들려도)', () => {
    const f = frameDriver()
    const k = 132 / 1920
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 960 * k, clientY: 540 * k })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 960 * k + 1.5, clientY: 540 * k })
    f.step(5)
    fireEvent.pointerUp(pad, { pointerId: 1 })
    f.settle()
    expect(props.onPan).not.toHaveBeenCalled()
  })

  it('사각형 안을 잡고 끌면 잡은 자리 그대로 따라오고, 손가락이 멈추면 정확히 그 자리에서 쉰다', () => {
    const f = frameDriver()
    const k = 132 / 1920
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 960 * k, clientY: 540 * k })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 960 * k + 5, clientY: 540 * k })
    f.settle()                                         // 손가락은 누른 채 멈춤
    const last = props.onPan.mock.calls.at(-1)[0]
    expect(last.x).toBeCloseTo(-5 / k, 6)              // 손가락 자리로 정확히
    expect(last.y).toBeCloseTo(0, 6)
    expect(f.pending()).toBe(0)                        // 멈춰 있는 동안은 프레임을 돌리지 않는다
    const n = props.onPan.mock.calls.length
    fireEvent.pointerUp(pad, { pointerId: 1 })
    f.settle()
    expect(props.onPan).toHaveBeenCalledTimes(n)       // 이미 그 자리 — 더 보낼 것 없음
  })

  it('느린 끌기의 정수 좌표 계단과 손 떨림을 펴서 화면이 고르게 움직인다', () => {
    const f = frameDriver()
    const k = 132 / 1920
    const { getByTestId, props } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    const x0 = 960 * k, y0 = 540 * k
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: x0, clientY: y0 })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: x0 + 3, clientY: y0 }) // 끌기 시작
    f.settle()
    // 초당 6패드px로 천천히 — 터치 좌표는 정수, ±0.5px 떨림
    const raw = []
    for (let i = 1; i <= 90; i++) {
      const x = Math.round(x0 + 3 + i * 0.1 + (i % 3 === 0 ? 0.5 : -0.4))
      raw.push(-(x - x0) / k) // 거르지 않았다면 화면 이동(pan.x)
      fireEvent.pointerMove(pad, { pointerId: 1, clientX: x, clientY: y0 })
      f.step()
    }
    const out = props.onPan.mock.calls.slice(-90).map(c => c[0].x)
    const jerk = (ys) => { let s = 0; for (let i = 2; i < ys.length; i++) s += Math.abs(ys[i] - 2 * ys[i - 1] + ys[i - 2]); return s }
    expect(jerk(out)).toBeLessThan(jerk(raw) / 5)
  })

  it('컨트롤 크기만큼 오른쪽·아래 슬라이드 밖까지 끌 수 있다(가린 구석 꺼내 보기)', () => {
    const f = frameDriver()
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
      fireEvent.pointerUp(pad, { pointerId: 1 })
      f.settle()
      // 컨트롤 206×128 + 가장자리 12 → 오른쪽 218, 아래 140 더
      expect(props.onPan).toHaveBeenLastCalledWith({ x: 960 - (1920 - 200 + 218), y: 540 - (1080 - 150 + 140) })
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', ow)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', oh)
    }
  })

  it('다른 입력(손 도구·휠·줌)이 화면을 옮기면 미니맵은 덮어쓰지 않고 손을 뗀다', () => {
    const f = frameDriver()
    const { getByTestId, props, rerender } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 10, clientY: 10 }) // 구석으로 미끄러지는 중
    f.step(2)
    fireEvent.pointerUp(pad, { pointerId: 1 })
    const n = props.onPan.mock.calls.length
    rerender(<TouchZoomNav {...props} pan={{ x: -123, y: 45 }} />) // 그사이 손 도구가 옮김
    f.settle()
    expect(props.onPan).toHaveBeenCalledTimes(n)
    expect(f.pending()).toBe(0)
  })

  it('끄는 도중 맞춤으로 축소돼 미니맵이 사라지면 아무것도 확정하지 않는다', () => {
    const f = frameDriver()
    const k = 132 / 1920
    const { getByTestId, props, rerender } = setup({ scale: 1 })
    const pad = getByTestId('minimap-pad')
    fireEvent.pointerDown(pad, { pointerId: 1, clientX: 960 * k, clientY: 540 * k })
    fireEvent.pointerMove(pad, { pointerId: 1, clientX: 960 * k + 5, clientY: 540 * k })
    f.step(3)
    const n = props.onPan.mock.calls.length
    rerender(<TouchZoomNav {...props} scale={0.2} pan={{ x: 0, y: 0 }} />) // 맞춤 → 미니맵 숨김
    f.settle()
    expect(props.onPan).toHaveBeenCalledTimes(n) // 옛 배율로 계산한 이동을 맞춤에 덮어쓰지 않는다
    expect(f.pending()).toBe(0)
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
