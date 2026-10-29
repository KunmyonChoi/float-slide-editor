import { describe, it, expect } from 'vitest'
import { wheelSource } from '../core/wheelInput'

// 실제 브라우저가 보내는 값의 모양 (deltaMode 0 = 픽셀, 1 = 줄)
const ev = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...o })

describe('wheelSource — 마우스 휠 · 트랙패드 스크롤 · 핀치 구분', () => {
  it('트랙패드 핀치(ctrlKey 합성)와 Ctrl/Cmd+휠은 pinch', () => {
    expect(wheelSource(ev({ deltaY: -2.4, ctrlKey: true }))).toBe('pinch')
    expect(wheelSource(ev({ deltaY: 100, wheelDeltaY: -120, ctrlKey: true }))).toBe('pinch')
    expect(wheelSource(ev({ deltaY: 100, wheelDeltaY: -120, metaKey: true }))).toBe('pinch')
  })

  it('macOS Chrome·Safari 트랙패드 — wheelDeltaY가 deltaY × -3', () => {
    expect(wheelSource(ev({ deltaY: 4, wheelDeltaY: -12 }))).toBe('trackpad')
    expect(wheelSource(ev({ deltaY: -1, wheelDeltaY: 3 }))).toBe('trackpad')
    // 빠르게 쓸어 deltaY가 40이면 wheelDeltaY가 -120 — 120의 배수여도 × -3 규칙이 먼저다
    expect(wheelSource(ev({ deltaY: 40, wheelDeltaY: -120 }))).toBe('trackpad')
  })

  it('가로 성분이 있으면 트랙패드 (두 손가락 대각선·가로 이동)', () => {
    expect(wheelSource(ev({ deltaX: 6, deltaY: 2, wheelDeltaY: -6 }))).toBe('trackpad')
    expect(wheelSource(ev({ deltaX: -3.5 }))).toBe('trackpad')
  })

  it('마우스 휠 — 한 칸이 wheelDeltaY 120의 배수', () => {
    expect(wheelSource(ev({ deltaY: 100, wheelDeltaY: -120 }))).toBe('mouse')        // Chrome
    expect(wheelSource(ev({ deltaY: 4.000244140625, wheelDeltaY: -120 }))).toBe('mouse') // Safari·옛 Chrome(macOS)
    expect(wheelSource(ev({ deltaY: -200, wheelDeltaY: 240 }))).toBe('mouse')        // 두 칸
  })

  it('Firefox 마우스 휠 — 줄 단위(deltaMode 1)', () => {
    expect(wheelSource(ev({ deltaY: 3, deltaMode: 1 }))).toBe('mouse')
  })

  it('wheelDeltaY가 없으면 작은 소수 delta만 트랙패드', () => {
    expect(wheelSource(ev({ deltaY: 2.5 }))).toBe('trackpad')      // Windows 정밀 터치패드·Firefox 트랙패드
    expect(wheelSource(ev({ deltaY: 100 }))).toBe('mouse')
    expect(wheelSource(ev({ deltaY: 133.33333 }))).toBe('mouse')   // 배율 133%의 마우스 한 칸
  })
})
