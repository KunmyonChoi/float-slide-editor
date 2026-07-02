import { useState, useEffect, useLayoutEffect } from 'react'

/**
 * useElementScreenRect — 캔버스 요소(캔버스 좌표)의 화면 좌표/크기를 추적한다(줌·팬·스크롤 반영).
 * 캔버스 좌표 → 화면: canvasRef.getBoundingClientRect() + element.{x,y,width,height}*scale.
 * 마스크/비교 오버레이 등 요소 위에 겹치는 포털이 공유(각자 복붙하던 패턴을 일원화).
 * @returns {{left,top,width,height}|null}
 */
export function useElementScreenRect(element, scale, canvasRef) {
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => { window.removeEventListener('scroll', rerender, true); window.removeEventListener('resize', rerender) }
  }, [])

  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + element.x * scale, top: cr.top + element.y * scale,
      width: element.width * scale, height: element.height * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.width, element.height, scale, tick])

  return rect
}
