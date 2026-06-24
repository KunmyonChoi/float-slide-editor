import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

// 리사이즈 비율 고정 = 전역 토글(lockAspect)과 Shift의 XOR.
// 컴포넌트의 인라인 식과 동일한 진리표를 문서화/검증한다.
const shouldLock = (shiftKey, lockAspect) => shiftKey !== lockAspect

describe('lockAspect (가로세로 비율 고정 토글)', () => {
  beforeEach(() => { useFlatStore.setState({ lockAspect: false }) })

  it('기본값은 꺼짐', () => {
    expect(useFlatStore.getState().lockAspect).toBe(false)
  })

  it('toggleLockAspect/setLockAspect 동작', () => {
    useFlatStore.getState().toggleLockAspect()
    expect(useFlatStore.getState().lockAspect).toBe(true)
    useFlatStore.getState().toggleLockAspect()
    expect(useFlatStore.getState().lockAspect).toBe(false)
    useFlatStore.getState().setLockAspect(true)
    expect(useFlatStore.getState().lockAspect).toBe(true)
  })

  it('XOR 진리표 — 토글 OFF면 Shift로 고정, 토글 ON이면 기본 고정·Shift로 자유', () => {
    expect(shouldLock(false, false)).toBe(false) // 평소 = 자유
    expect(shouldLock(true, false)).toBe(true)   // Shift = 고정
    expect(shouldLock(false, true)).toBe(true)   // 토글 ON = 고정(모바일: Shift 없이)
    expect(shouldLock(true, true)).toBe(false)   // 토글 ON + Shift = 일시 자유
  })
})
