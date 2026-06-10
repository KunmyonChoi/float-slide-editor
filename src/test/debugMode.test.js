import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

describe('debugMode 토글', () => {
  beforeEach(() => {
    useFlatStore.setState({ debugMode: false, viewMode: 'flat' })
  })

  it('기본값은 꺼짐', () => {
    expect(useFlatStore.getState().debugMode).toBe(false)
  })

  it('setDebugMode(true) → 켜짐, viewMode 유지', () => {
    useFlatStore.setState({ viewMode: 'split' })
    useFlatStore.getState().setDebugMode(true)
    expect(useFlatStore.getState().debugMode).toBe(true)
    expect(useFlatStore.getState().viewMode).toBe('split')
  })

  it('끄면 html/split 뷰에서 flat으로 복귀', () => {
    useFlatStore.setState({ debugMode: true, viewMode: 'html' })
    useFlatStore.getState().setDebugMode(false)
    expect(useFlatStore.getState().debugMode).toBe(false)
    expect(useFlatStore.getState().viewMode).toBe('flat')
  })

  it('끌 때 이미 flat이면 그대로', () => {
    useFlatStore.setState({ debugMode: true, viewMode: 'flat' })
    useFlatStore.getState().setDebugMode(false)
    expect(useFlatStore.getState().viewMode).toBe('flat')
  })
})
