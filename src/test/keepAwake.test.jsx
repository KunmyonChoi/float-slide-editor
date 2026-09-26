import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { acquireKeepAwake, useKeepAwake, useKeepAwakeActive, _resetKeepAwake } from '../core/keepAwake'
import { useWakeLock } from '../core/useWakeLock'

/**
 * 오래 걸리는 생성 작업(영상·립싱크·노트 음성·PPT 변환) 중에도 화면이 꺼지지 않게 하는 등록부.
 * 잡는 곳이 여럿이라, 하나가 끝나도 다른 게 남아 있으면 계속 붙들려야 한다.
 */
describe('keepAwake 등록부', () => {
  beforeEach(() => _resetKeepAwake())

  it('아무도 안 잡으면 꺼져 있다', () => {
    const { result } = renderHook(() => useKeepAwakeActive())
    expect(result.current).toBe(false)
  })

  it('작업이 잡으면 켜지고, 놓으면 꺼진다', () => {
    const { result } = renderHook(() => useKeepAwakeActive())
    let release
    act(() => { release = acquireKeepAwake() })
    expect(result.current).toBe(true)
    act(() => release())
    expect(result.current).toBe(false)
  })

  it('둘이 잡으면 하나가 놓아도 유지된다 — 다른 작업이 아직 돈다', () => {
    const { result } = renderHook(() => useKeepAwakeActive())
    let a, b
    act(() => { a = acquireKeepAwake(); b = acquireKeepAwake() })
    act(() => a())
    expect(result.current).toBe(true)
    act(() => b())
    expect(result.current).toBe(false)
  })

  it('같은 작업이 두 번 놓아도 남의 몫까지 놓지 않는다', () => {
    const { result } = renderHook(() => useKeepAwakeActive())
    let a, b
    act(() => { a = acquireKeepAwake(); b = acquireKeepAwake() })
    act(() => { a(); a() })          // 중복 해제
    expect(result.current).toBe(true) // b가 아직 잡고 있다
    act(() => b())
    expect(result.current).toBe(false)
  })

  it('useKeepAwake는 작업이 끝나거나 화면이 사라지면 놓는다', () => {
    const active = renderHook(() => useKeepAwakeActive())
    const holder = renderHook(({ busy }) => useKeepAwake(busy), { initialProps: { busy: true } })
    expect(active.result.current).toBe(true)

    holder.rerender({ busy: false })
    expect(active.result.current).toBe(false)

    holder.rerender({ busy: true })
    expect(active.result.current).toBe(true)
    holder.unmount()                  // 패널이 닫혀도(언마운트) 새지 않는다
    expect(active.result.current).toBe(false)
  })
})

describe('등록부 → 실제 화면 잠금', () => {
  let request, sentinel

  beforeEach(() => {
    _resetKeepAwake()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    sentinel = { release: vi.fn(() => Promise.resolve()), addEventListener: vi.fn() }
    request = vi.fn(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  })
  afterEach(() => { delete navigator.wakeLock; vi.restoreAllMocks() })

  it('작업이 도는 동안 화면 잠금을 잡고, 끝나면 놓는다 (App이 하는 일)', async () => {
    // App: useKeepAwake(작업 중) + useWakeLock(등록부가 켜져 있으면)
    const app = renderHook(({ busy }) => {
      useKeepAwake(busy)
      useWakeLock(useKeepAwakeActive())
    }, { initialProps: { busy: false } })

    expect(request).not.toHaveBeenCalled()   // 편집만 하는 동안엔 붙들지 않는다

    await act(async () => { app.rerender({ busy: true }) })
    expect(request).toHaveBeenCalledWith('screen')

    await act(async () => { app.rerender({ busy: false }) })
    expect(sentinel.release).toHaveBeenCalled()
  })
})
