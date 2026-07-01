import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * ImageComparePreview — 편집 결과를 선택 이미지 요소 '위'에 겹쳐 캔버스에서 전후 비교.
 *
 * 결과 오버레이를 세로 구분선(split%)으로 잘라(clip-path) 왼쪽은 그 아래 실제 요소(=전),
 * 오른쪽은 결과(=후)가 보이게 한다. 구분선을 드래그해 비교. showOriginal(홀드) 시 결과를
 * 통째로 숨겨 원본 전체를 보여준다. 적용 전 비파괴 미리보기(요소 content는 그대로).
 */
export default function ImageComparePreview({ element, scale, canvasRef, resultUrl, objectFit = 'contain', split, onSplit, showOriginal }) {
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)
  const boxRef = useRef(null)
  const draggingRef = useRef(false)

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

  const setSplitFromEvent = (e) => {
    const b = boxRef.current?.getBoundingClientRect()
    if (!b || b.width <= 0) return
    onSplit?.(Math.max(0, Math.min(100, ((e.clientX - b.left) / b.width) * 100)))
  }
  const onPointerDown = (e) => { e.stopPropagation(); draggingRef.current = true; e.currentTarget.setPointerCapture?.(e.pointerId); setSplitFromEvent(e) }
  const onPointerMove = (e) => { if (draggingRef.current) { e.stopPropagation(); setSplitFromEvent(e) } }
  const endDrag = (e) => { if (draggingRef.current) { e.stopPropagation(); draggingRef.current = false } }

  if (!rect) return null
  return createPortal(
    <div
      ref={boxRef}
      data-edit-accessory="true"
      onMouseDown={e => e.stopPropagation()}
      style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, height: rect.height, zIndex: 10043, overflow: 'hidden' }}
    >
      {!showOriginal && (
        <>
          <img src={resultUrl} alt="" draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit, clipPath: `inset(0 0 0 ${split}%)`, userSelect: 'none' }} />
          {/* 구분선 + 드래그 핸들 */}
          <div style={{ position: 'absolute', left: `${split}%`, top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,0.6)', pointerEvents: 'none' }} />
          <div
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{
              position: 'absolute', left: `${split}%`, top: '50%', transform: 'translate(-50%,-50%)',
              width: 26, height: 26, borderRadius: 13, background: 'rgba(15,23,42,0.9)', color: '#fff',
              border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', cursor: 'ew-resize',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, touchAction: 'none',
            }}
          >⇔</div>
          {/* 전/후 뱃지 */}
          <span style={badgeStyle('left')}>전</span>
          <span style={badgeStyle('right')}>후</span>
        </>
      )}
    </div>,
    document.body,
  )
}

function badgeStyle(side) {
  return {
    position: 'absolute', top: 6, [side]: 6, padding: '1px 7px', borderRadius: 6,
    fontSize: 11, fontWeight: 600, color: '#fff', background: 'rgba(15,23,42,0.7)', pointerEvents: 'none',
  }
}
