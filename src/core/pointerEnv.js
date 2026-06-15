import { useState, useEffect } from 'react'

/**
 * 터치(거친 포인터) 환경 여부 — UA 스니핑 대신 기능 감지.
 * 트랙패드/마우스는 false, 터치스크린은 true.
 */
export function isCoarsePointer() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
}

/** 리액티브 버전 — 입력 장치 전환(터치↔마우스 겸용 기기)에도 반응. */
export function useIsTouch() {
  const [touch, setTouch] = useState(isCoarsePointer)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(pointer: coarse)')
    const onChange = () => setTouch(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])
  return touch
}
