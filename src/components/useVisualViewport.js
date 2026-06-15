import { useState, useEffect } from 'react'

/**
 * 가상 키보드를 고려한 실제 가시 영역 상태.
 *  - height/offsetTop: visualViewport 값
 *  - keyboardOverlap: 레이아웃 뷰포트 하단에서 키보드가 가린 px
 *  - isKeyboardOpen: 키보드가 열려 있다고 볼 만큼 가려졌는지(휴리스틱)
 *
 * visualViewport 미지원 환경은 키보드 없음으로 폴백(기존 동작 유지).
 */
export function getViewportState() {
  if (typeof window === 'undefined') {
    return { height: 0, offsetTop: 0, keyboardOverlap: 0, isKeyboardOpen: false }
  }
  const vv = window.visualViewport
  if (!vv) {
    return { height: window.innerHeight, offsetTop: 0, keyboardOverlap: 0, isKeyboardOpen: false }
  }
  const keyboardOverlap = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height))
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    keyboardOverlap,
    isKeyboardOpen: keyboardOverlap > 120,
  }
}

export function useVisualViewport() {
  const [state, setState] = useState(getViewportState)
  useEffect(() => {
    const vv = typeof window !== 'undefined' && window.visualViewport
    if (!vv) return
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setState(getViewportState()))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      cancelAnimationFrame(raf)
    }
  }, [])
  return state
}
