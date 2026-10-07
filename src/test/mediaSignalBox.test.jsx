import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import MediaSignalBox from '../components/MediaSignalBox'
import { onMediaSignal } from '../core/mediaAdvance'
import { getAudioClock } from '../core/audioClock'

function setup(props) {
  const got = []
  const off = onMediaSignal((id, kind) => got.push(`${id}:${kind}`))
  const r = render(<MediaSignalBox elementId="v1" {...props}><video /></MediaSignalBox>)
  const v = r.container.querySelector('video')
  v.pause = vi.fn()
  return { got, off, v, ...r }
}

describe('MediaSignalBox — 래퍼에서 미디어 이벤트를 캡처', () => {
  let cleanup = () => {}
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('안쪽 <video>의 ended를 엔진 신호로 보낸다(한 번만)', () => {
    const { got, off, v } = setup({ signal: true })
    cleanup = off
    act(() => { v.dispatchEvent(new Event('ended')); v.dispatchEvent(new Event('ended')) })
    expect(got).toEqual(['v1:ended'])
  })

  it('error는 실패로 알린다', () => {
    const { got, off, v } = setup({ signal: true })
    cleanup = off
    act(() => { v.dispatchEvent(new Event('error')) })
    expect(got).toEqual(['v1:failed'])
  })

  it('signal이 꺼져 있으면 아무것도 보내지 않는다', () => {
    const { got, off, v } = setup({ signal: false })
    cleanup = off
    act(() => { v.dispatchEvent(new Event('ended')) })
    expect(got).toEqual([])
  })

  it('최대 재생 시간 — 직전엔 볼륨을 줄이고, 닿으면 멈추고 끝남으로 친다', () => {
    const { got, off, v } = setup({ signal: true, maxPlaySec: 10 })
    cleanup = off
    Object.defineProperty(v, 'currentTime', { value: 9, writable: true, configurable: true })
    act(() => { v.dispatchEvent(new Event('timeupdate')) })
    expect(v.volume).toBeCloseTo(0.5)
    expect(got).toEqual([])
    v.currentTime = 10
    act(() => { v.dispatchEvent(new Event('timeupdate')) })
    expect(v.pause).toHaveBeenCalled()
    expect(got).toEqual(['v1:ended'])
  })

  it('재생이 시작되면 재생 위치를 audioClock에 올린다(남은 시간 계산용)', () => {
    const { off, v, unmount } = setup({ signal: true })
    cleanup = off
    act(() => { v.dispatchEvent(new Event('play')) })
    expect(getAudioClock('v1')).toBe(v)
    unmount()
    expect(getAudioClock('v1')).toBeNull()
  })

  it('정리 중 끊긴 재생(AbortError)은 실패가 아니다', async () => {
    vi.useFakeTimers()
    const { got, off, v } = setup({ signal: true })
    cleanup = off
    Object.defineProperty(v, 'paused', { value: true, configurable: true })
    v.play = vi.fn(() => Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(v.play).toHaveBeenCalled()
    expect(got).toEqual([])
  })

  it('자동 재생이 시작되지 않고 play()도 거부되면 실패로 알린다', async () => {
    vi.useFakeTimers()
    const { got, off, v } = setup({ signal: true })
    cleanup = off
    Object.defineProperty(v, 'paused', { value: true, configurable: true })
    v.play = vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(v.play).toHaveBeenCalled()
    expect(got).toEqual(['v1:failed'])
  })
})
