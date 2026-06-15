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
    return { height: 0, offsetTop: 0, visibleBottom: 0, keyboardHeight: 0, isKeyboardOpen: false }
  }
  const vv = window.visualViewport
  if (!vv) {
    return { height: window.innerHeight, offsetTop: 0, visibleBottom: window.innerHeight, keyboardHeight: 0, isKeyboardOpen: false }
  }
  // 키보드 높이는 스크롤(offsetTop)과 무관하게 가시영역이 줄어든 양으로 판정.
  // (offsetTop을 빼면 페이지가 스크롤될수록 작아져 키보드 열림을 오판함)
  const keyboardHeight = Math.max(0, window.innerHeight - vv.height)
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    visibleBottom: vv.offsetTop + vv.height, // 가시영역 하단(레이아웃 좌표) — 도킹 위치 기준
    keyboardHeight,
    isKeyboardOpen: keyboardHeight > 120,
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
