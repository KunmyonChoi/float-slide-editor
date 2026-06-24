import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrub } from '../components/useScrub'

// 가짜 PointerEvent 생성 (setPointerCapture 스텁 포함)
function down(x, pointerId = 1) {
  return { pointerId, clientX: x, button: 0, preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } }
}
function move(x, pointerId = 1, mods = {}) {
  return { pointerId, clientX: x, ...mods }
}
function up(pointerId = 1) {
  return { pointerId }
}

describe('useScrub', () => {
  it('데드존(3px) 미만 이동은 무시하고 commit 안 함', () => {
    const onPreview = vi.fn(), onCommit = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, onPreview, onCommit }))
    const h = result.current
    h.onPointerDown(down(100))
    h.onPointerMove(move(102)) // +2px → 데드존 내
    h.onPointerUp(up())
    expect(onPreview).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('1px = 1step 으로 드래그 중 preview, 손 뗌에 commit 1회', () => {
    const onPreview = vi.fn(), onCommit = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, step: 1, onPreview, onCommit }))
    const h = result.current
    h.onPointerDown(down(100))
    h.onPointerMove(move(110)) // +10px → 20
    expect(onPreview).toHaveBeenLastCalledWith(20)
    h.onPointerUp(up())
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(20)
  })

  it('min/max 클램프', () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 95, min: 0, max: 100, onCommit, onPreview: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(0))
    h.onPointerMove(move(50)) // +50 → 145 → 100 클램프
    h.onPointerUp(up())
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it('Shift는 ×10 거칠게', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 0, step: 1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(0))
    h.onPointerMove(move(5, 1, { shiftKey: true })) // 5px × 10 = 50
    expect(onPreview).toHaveBeenLastCalledWith(50)
  })

  it('Alt는 ×0.1 미세하게 (소수 step 스냅)', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 1, step: 1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(0))
    h.onPointerMove(move(5, 1, { altKey: true })) // 5px × 0.1 = 0.5 → 1.5
    expect(onPreview).toHaveBeenLastCalledWith(1.5)
  })

  it('step=0.1 미세 단위', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 1.5, step: 0.1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(0))
    h.onPointerMove(move(10)) // 10px × 0.1 = 1.0 → 2.5
    expect(onPreview).toHaveBeenLastCalledWith(2.5)
  })

  it('다른 pointerId 이벤트는 무시', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 0, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(0, 1))
    h.onPointerMove(move(50, 2)) // 다른 손가락
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('ESC로 시작값 복원 후 취소(commit 안 함)', () => {
    const onPreview = vi.fn(), onCommit = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, onPreview, onCommit }))
    const h = result.current
    h.onPointerDown(down(0))
    h.onPointerMove(move(20)) // → 30
    expect(onPreview).toHaveBeenLastCalledWith(30)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onPreview).toHaveBeenLastCalledWith(10) // 시작값 복원
    expect(onCommit).not.toHaveBeenCalled()
  })

  // 터치: 가로/세로 모두 인식(우/상=증가). 마우스는 가로 전용.
  const tdown = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch', preventDefault: vi.fn(), currentTarget: { setPointerCapture: vi.fn() } })
  const tmove = (x, y) => ({ pointerId: 1, clientX: x, clientY: y, pointerType: 'touch' })

  it('터치: 세로 위로 드래그 = 증가', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, step: 1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(tdown(100, 100))
    h.onPointerMove(tmove(100, 80)) // dy=-20 → +20 → 30
    expect(onPreview).toHaveBeenLastCalledWith(30)
  })

  it('터치: 가로 오른쪽 드래그 = 증가', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, step: 1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(tdown(100, 100))
    h.onPointerMove(tmove(120, 100)) // dx=+20 → 30
    expect(onPreview).toHaveBeenLastCalledWith(30)
  })

  it('마우스: 세로 드래그는 무시(가로 전용)', () => {
    const onPreview = vi.fn()
    const { result } = renderHook(() => useScrub({ value: 10, step: 1, onPreview, onCommit: vi.fn() }))
    const h = result.current
    h.onPointerDown(down(100))
    h.onPointerMove({ pointerId: 1, clientX: 100, clientY: 50 }) // dx=0 → 변화 없음
    expect(onPreview).not.toHaveBeenCalled()
  })

  it('드래그 핸들 style에 ew-resize/touchAction none 포함', () => {
    const { result } = renderHook(() => useScrub({ value: 0, onPreview: vi.fn(), onCommit: vi.fn() }))
    expect(result.current.style.cursor).toBe('ew-resize')
    expect(result.current.style.touchAction).toBe('none')
  })
})
