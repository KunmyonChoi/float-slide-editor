import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useWakeLock } from '../core/useWakeLock'

// 브라우저가 돌려주는 WakeLockSentinel 흉내 — release()와 'release' 이벤트를 갖는다
function makeSentinel() {
  const listeners = []
  return {
    released: false,
    release: vi.fn(function () { this.released = true; return Promise.resolve() }),
    addEventListener: vi.fn((type, fn) => { if (type === 'release') listeners.push(fn) }),
    /** 브라우저가 스스로 잠금을 푼 상황(탭 가려짐·배터리 절약)을 재현 */
    browserReleases() { for (const fn of listeners) fn() },
  }
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

describe('useWakeLock — 발표 중 화면 꺼짐 방지', () => {
  let sentinel
  let request

  beforeEach(() => {
    setVisibility('visible')
    sentinel = makeSentinel()
    request = vi.fn(() => Promise.resolve(sentinel))
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true })
  })

  afterEach(() => {
    delete navigator.wakeLock
    setVisibility('visible')
    vi.restoreAllMocks()
  })

  it('active면 screen 잠금을 요청한다', async () => {
    renderHook(() => useWakeLock(true))
    await Promise.resolve()
    expect(request).toHaveBeenCalledWith('screen')
  })

  it('active가 아니면 요청하지 않는다 — 편집 중에 화면을 붙들지 않도록', async () => {
    renderHook(() => useWakeLock(false))
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })

  it('발표가 끝나면(언마운트) 잠금을 놓는다', async () => {
    const { unmount } = renderHook(() => useWakeLock(true))
    await Promise.resolve()
    unmount()
    await Promise.resolve()
    expect(sentinel.release).toHaveBeenCalled()
  })

  it('active가 false로 바뀌면 잠금을 놓는다', async () => {
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } })
    await Promise.resolve()
    rerender({ on: false })
    await Promise.resolve()
    expect(sentinel.release).toHaveBeenCalled()
  })

  it('브라우저가 잠금을 풀어도 화면이 다시 보이면 되잡는다', async () => {
    renderHook(() => useWakeLock(true))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)

    // 탭이 가려져 브라우저가 잠금 해제 → 다시 보임
    sentinel.browserReleases()
    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1) // 가려진 동안에는 요청하지 않는다

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2) // 다시 보이면 되잡는다
  })

  it('이미 잠금을 쥐고 있으면 다시 요청하지 않는다', async () => {
    renderHook(() => useWakeLock(true))
    await Promise.resolve()
    document.dispatchEvent(new Event('visibilitychange'))
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('화면이 보이지 않는 상태로 시작하면 요청하지 않는다', async () => {
    setVisibility('hidden')
    renderHook(() => useWakeLock(true))
    await Promise.resolve()
    expect(request).not.toHaveBeenCalled()
  })

  it('지원하지 않는 브라우저에서는 조용히 넘어간다 — 발표를 막지 않는다', () => {
    delete navigator.wakeLock
    expect(() => {
      const { unmount } = renderHook(() => useWakeLock(true))
      unmount()
    }).not.toThrow()
  })

  it('브라우저가 거부해도(절전 모드 등) 발표를 깨뜨리지 않는다', async () => {
    request.mockRejectedValue(new DOMException('거부됨', 'NotAllowedError'))
    const { unmount } = renderHook(() => useWakeLock(true))
    await Promise.resolve()
    await Promise.resolve()
    expect(() => unmount()).not.toThrow()
  })

  it('요청이 끝나기 전에 발표가 끝나면 받아든 잠금을 곧바로 놓는다', async () => {
    let resolveRequest
    request.mockReturnValue(new Promise(r => { resolveRequest = r }))
    const { unmount } = renderHook(() => useWakeLock(true))
    unmount()                 // 아직 잠금을 못 받은 상태에서 종료
    resolveRequest(sentinel)  // 뒤늦게 도착
    await Promise.resolve()
    await Promise.resolve()
    expect(sentinel.release).toHaveBeenCalled()
  })
})
