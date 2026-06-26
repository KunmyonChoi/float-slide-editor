import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * useDraggableToolbar — 플로팅 툴바를 그립 핸들로 드래그 이동.
 *
 * 자동 앵커(요소 추적) 위치를 기본으로 쓰다가, 사용자가 그립을 드래그하면
 * 그 시점부터 '자유 위치(fixed 절대좌표)'로 전환한다. resetKey가 바뀌면
 * (예: 선택 요소 변경) 자유 위치를 버리고 자동 앵커로 복귀한다.
 *
 * @param {*} resetKey  값이 바뀌면 드래그 위치 초기화(보통 element.id)
 * @param {React.RefObject} toolbarRef  드래그 대상 툴바 DOM ref(크기 측정용)
 * @returns {{ pos: {left:number,top:number}|null, startDrag: (e)=>void, dragging: boolean }}
 *   pos: null이면 자동 앵커 사용, 아니면 이 절대좌표로 고정.
 */
export function useDraggableToolbar(resetKey, toolbarRef) {
  const [pos, setPos] = useState(null)
  const [dragging, setDragging] = useState(false)
  const cleanupRef = useRef(null)

  // 선택 변경 등으로 resetKey가 바뀌면 자유 위치 초기화
  useEffect(() => { setPos(null) }, [resetKey])

  // 언마운트 시 리스너 정리
  useEffect(() => () => cleanupRef.current?.(), [])

  const startDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    const el = toolbarRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const startX = e.clientX, startY = e.clientY
    const baseLeft = rect.left, baseTop = rect.top
    const w = rect.width, h = rect.height
    setDragging(true)

    const onMove = (ev) => {
      const M = 4 // 화면 가장자리 여백
      let left = baseLeft + (ev.clientX - startX)
      let top = baseTop + (ev.clientY - startY)
      left = Math.max(M, Math.min(window.innerWidth - w - M, left))
      top = Math.max(M, Math.min(window.innerHeight - h - M, top))
      setPos({ left, top })
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      cleanupRef.current = null
    }
    cleanupRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [toolbarRef])

  return { pos, startDrag, dragging }
}

/** 그립 핸들(⋮⋮) — 드래그 시작 지점. 버튼 탭과 분리. */
export function GripHandle({ onPointerDown, dragging }) {
  return (
    <div
      onPointerDown={onPointerDown}
      title="드래그하여 이동"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 26, marginRight: 2, flexShrink: 0,
        cursor: dragging ? 'grabbing' : 'grab',
        touchAction: 'none', // 드래그 중 스크롤/줌 간섭 차단
        color: 'rgba(255,255,255,0.45)',
        borderRadius: 5,
      }}
    >
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
        <circle cx="2.5" cy="3" r="1.3" /><circle cx="7.5" cy="3" r="1.3" />
        <circle cx="2.5" cy="8" r="1.3" /><circle cx="7.5" cy="8" r="1.3" />
        <circle cx="2.5" cy="13" r="1.3" /><circle cx="7.5" cy="13" r="1.3" />
      </svg>
    </div>
  )
}
