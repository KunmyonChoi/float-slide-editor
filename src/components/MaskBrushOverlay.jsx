import { useRef, useState, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

/**
 * MaskBrushOverlay — 선택한 이미지 요소 '위'에 겹쳐 마스크(편집 영역)를 브러시로 칠하는 오버레이.
 *
 * 사용자가 칠한 영역 = "여기를 편집"(OpenAI edits의 mask에서 투명 픽셀 = 편집 영역).
 * 스트로크는 요소-로컬 px 좌표로 보관하고, buildMask(capW,capH)에서 캡처 해상도에 맞춰 래스터화한다:
 *   불투명(보존) 바탕 + 칠한 경로를 destination-out으로 뚫어 투명(편집)으로 만든다.
 *
 * 부모(FlatImageAiBar)는 ref로 buildMask/hasStrokes/clear를 호출한다. 도구/브러시 크기는 props.
 */
const MaskBrushOverlay = forwardRef(function MaskBrushOverlay(
  { element, scale, canvasRef, tool = 'brush', brushSize = 40, onStrokesChange },
  ref,
) {
  const canvasElRef = useRef(null)
  const strokesRef = useRef([])       // [{ tool:'brush'|'erase', size, pts:[{x,y}] }] — 요소-로컬 px
  const drawingRef = useRef(null)     // 진행 중 스트로크
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const rerender = () => setTick(n => n + 1)
    window.addEventListener('scroll', rerender, true)
    window.addEventListener('resize', rerender)
    return () => { window.removeEventListener('scroll', rerender, true); window.removeEventListener('resize', rerender) }
  }, [])

  // 요소의 화면 좌표/크기(줌·팬 반영)
  useLayoutEffect(() => {
    const cr = canvasRef?.current?.getBoundingClientRect()
    const next = cr ? {
      left: cr.left + element.x * scale,
      top: cr.top + element.y * scale,
      width: element.width * scale,
      height: element.height * scale,
    } : null
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(prev => {
      if (!prev && !next) return prev
      if (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height) return prev
      return next
    })
  }, [canvasRef, element.x, element.y, element.width, element.height, scale, tick])

  // 표시용 캔버스 다시 그리기 — 칠한 영역을 빨간 반투명으로(지우개는 제거)
  const redraw = useCallback(() => {
    const cv = canvasElRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    for (const s of strokesRef.current) {
      ctx.globalCompositeOperation = s.tool === 'erase' ? 'destination-out' : 'source-over'
      ctx.strokeStyle = 'rgba(239,68,68,0.45)'
      ctx.lineWidth = Math.max(1, s.size * scale)
      strokePath(ctx, s.pts, scale)
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [scale])

  useEffect(() => { redraw() }, [redraw, rect, tick])

  const localPt = (e) => {
    const cv = canvasElRef.current
    const r = cv.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const onPointerDown = (e) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drawingRef.current = { tool, size: brushSize, pts: [localPt(e)] }
    strokesRef.current = [...strokesRef.current, drawingRef.current]
    redraw()
  }
  const onPointerMove = (e) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current.pts.push(localPt(e))
    redraw()
  }
  const endStroke = (e) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = null
    onStrokesChange?.(strokesRef.current.length)
  }

  useImperativeHandle(ref, () => ({
    hasStrokes: () => strokesRef.current.some(s => s.tool === 'brush' && s.pts.length),
    clear: () => { strokesRef.current = []; drawingRef.current = null; redraw(); onStrokesChange?.(0) },
    // 캡처 해상도(capW×capH) 마스크 PNG data URL. 칠한 영역=투명(편집), 나머지=불투명(보존).
    buildMask: (capW, capH) => {
      if (!strokesRef.current.some(s => s.tool === 'brush' && s.pts.length)) return null
      const off = document.createElement('canvas')
      off.width = capW; off.height = capH
      const ctx = off.getContext('2d')
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, capW, capH) // 불투명=보존
      const sx = capW / (element.width || 1), sy = capH / (element.height || 1)
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      for (const s of strokesRef.current) {
        // brush=투명(편집)으로 뚫기, erase=다시 불투명(보존)으로 복원
        ctx.globalCompositeOperation = s.tool === 'erase' ? 'source-over' : 'destination-out'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = Math.max(1, s.size * sx)
        strokePathXY(ctx, s.pts, sx, sy)
      }
      ctx.globalCompositeOperation = 'source-over'
      return off.toDataURL('image/png')
    },
  }), [element.width, element.height, redraw, onStrokesChange])

  if (!rect) return null
  return createPortal(
    <canvas
      ref={canvasElRef}
      width={Math.max(1, Math.round(rect.width))}
      height={Math.max(1, Math.round(rect.height))}
      data-edit-accessory="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: rect.left, top: rect.top,
        width: rect.width, height: rect.height, zIndex: 10042,
        cursor: 'crosshair', touchAction: 'none',
        boxShadow: '0 0 0 2px rgba(239,68,68,0.7)', borderRadius: 2,
      }}
    />,
    document.body,
  )
})

// 요소-로컬 pts를 scale 배로 그린다(표시용)
function strokePath(ctx, pts, scale) { strokePathXY(ctx, pts, scale, scale) }

function strokePathXY(ctx, pts, sx, sy) {
  if (!pts.length) return
  if (pts.length === 1) {
    // 점 하나 = 원 하나
    const r = ctx.lineWidth / 2
    ctx.beginPath()
    ctx.arc(pts[0].x * sx, pts[0].y * sy, Math.max(0.5, r), 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle
    ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(pts[0].x * sx, pts[0].y * sy)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sx, pts[i].y * sy)
  ctx.stroke()
}

export default MaskBrushOverlay
