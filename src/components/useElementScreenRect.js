import { useState, useEffect, useLayoutEffect } from 'react'
import { useFlatStore } from '../store/flatStore'

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

/**
 * useCanvasAreaScreenRect — 캔버스 좌표 사각형({x,y,w,h})의 화면 좌표를 추적한다.
 *
 * 위 훅과 달리 scale·canvasRef를 props로 받지 않고 스토어의 캔버스 노드에서 직접 역산한다
 * (`getBoundingClientRect().width / canvasSize.w` = 현재 줌). 작업 트레이처럼 캔버스 바깥에
 * 떠 있어 scale을 전달받을 수 없는 곳에서 쓴다.
 *
 * 줌/팬은 스크롤·리사이즈 이벤트를 내지 않으므로 활성 동안 rAF로 추적하고, 값이 실제로
 * 바뀔 때만 state를 갱신한다(오버레이는 사용자가 켠 동안만 살아 있어 비용이 제한적).
 * @param {{x:number,y:number,w:number,h:number}|null} area
 * @param {boolean} active  false면 추적을 멈춘다
 * @returns {{left,top,width,height}|null}
 */
export function useCanvasAreaScreenRect(area, active = true) {
  const canvasRef = useFlatStore(s => s._canvasRef)
  const canvasSize = useFlatStore(s => s.canvasSize)
  const [rect, setRect] = useState(null)
  // area 객체는 렌더마다 새로 만들어질 수 있어 원시값으로 풀어 의존성에 넣는다.
  const ax = area?.x, ay = area?.y, aw = area?.w, ah = area?.h
  const cw = canvasSize?.w

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const cr = (active && ax != null && cw) ? canvasRef?.current?.getBoundingClientRect() : null
      const k = cr ? cr.width / cw : 0
      const next = cr ? { left: cr.left + ax * k, top: cr.top + ay * k, width: aw * k, height: ah * k } : null
      setRect(prev => {
        if (!prev && !next) return prev
        if (prev && next && prev.left === next.left && prev.top === next.top
          && prev.width === next.width && prev.height === next.height) return prev
        return next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, canvasRef, cw, ax, ay, aw, ah])

  return rect
}
