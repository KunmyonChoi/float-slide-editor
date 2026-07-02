import { useRef, useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BlobStore } from '../core/BlobStore'
import { containFitRect } from '../core/imageFit'
import { useElementScreenRect } from './useElementScreenRect'

/**
 * MaskBrushOverlay — 선택한 이미지 요소 '위'에 겹쳐 마스크(편집 영역)를 브러시로 칠하는 오버레이.
 *
 * 사용자가 칠한 영역 = "여기를 편집"(OpenAI edits의 mask에서 투명 픽셀 = 편집 영역).
 * 스트로크는 요소-로컬 px 좌표로 보관하고, buildMask(capW,capH)에서 캡처 해상도에 맞춰 래스터화한다:
 *   불투명(보존) 바탕 + 칠한 경로를 destination-out으로 뚫어 투명(편집)으로 만든다.
 * contain이면 이미지 실제 표시 사각형(contentRect) 밖(레터박스 여백)은 클리핑해 편집 불가.
 *
 * 부모(FlatImageAiBar)는 ref로 buildMask/hasStrokes/clear를 호출한다. 도구/브러시 크기는 props.
 */
const MaskBrushOverlay = forwardRef(function MaskBrushOverlay(
  { element, scale, canvasRef, tool = 'brush', brushSize = 40, objectFit = 'contain', onStrokesChange },
  ref,
) {
  const canvasElRef = useRef(null)
  const strokesRef = useRef([])       // [{ tool:'brush'|'erase', size, pts:[{x,y}] }] — 요소-로컬 px
  const drawingRef = useRef(null)     // 진행 중 스트로크
  const downRectRef = useRef(null)    // pointerdown 시점 캔버스 화면 rect(이동 중 layout 읽기 회피)
  const rafRef = useRef(0)
  const rect = useElementScreenRect(element, scale, canvasRef)
  // 편집 가능한 영역(요소-로컬 px). contain이면 이미지 표시 사각형, 아니면 박스 전체(null).
  const [contentRect, setContentRect] = useState(null)
  const contentRectRef = useRef(null) // buildMask가 언마운트 후에도 '최신' 값을 읽도록 ref로도 보관

  // contain 모드: 이미지 자연 크기를 읽어 표시 사각형 계산(여백은 편집 불가로 클리핑)
  useEffect(() => {
    let alive = true
    if (objectFit !== 'contain') { contentRectRef.current = null; setContentRect(null); return }
    ;(async () => {
      try {
        const url = await BlobStore.contentUrl(element.content)
        const img = new Image()
        img.onload = () => {
          if (!alive) return
          const r = containFitRect(element.width, element.height, img.naturalWidth, img.naturalHeight)
          contentRectRef.current = r; setContentRect(r)
        }
        img.src = url
      } catch { /* 실패 시 박스 전체 허용 */ }
    })()
    return () => { alive = false }
  }, [element.content, element.width, element.height, objectFit])

  // 표시용 캔버스 다시 그리기 — 칠한 영역을 빨간 반투명으로(지우개는 제거), contain 여백은 딤
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
      strokePathXY(ctx, s.pts, scale, scale)
    }
    if (contentRect) {
      const r = { x: contentRect.x * scale, y: contentRect.y * scale, w: contentRect.w * scale, h: contentRect.h * scale }
      ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'
      fillOutside(ctx, r, cv.width, cv.height) // 여백의 빨간 칠 제거
      ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(15,23,42,0.45)'
      fillOutside(ctx, r, cv.width, cv.height) // 여백 딤(편집 불가 표시)
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [scale, contentRect])

  // 포인터 이동 중에는 rAF로 합쳐 그린다(이벤트마다 전체 리드로우 방지)
  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; redraw() })
  }, [redraw])

  useEffect(() => { redraw() }, [redraw, rect])
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  const localPt = (e) => {
    const r = downRectRef.current
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const onPointerDown = (e) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    downRectRef.current = canvasElRef.current.getBoundingClientRect() // 한 번만 읽어 캐시
    drawingRef.current = { tool, size: brushSize, pts: [localPt(e)] }
    strokesRef.current = [...strokesRef.current, drawingRef.current]
    scheduleRedraw()
  }
  const onPointerMove = (e) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current.pts.push(localPt(e))
    scheduleRedraw()
  }
  const endStroke = (e) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = null
    // 편집 가능 영역 안의 브러시 스트로크만 센다(여백만 칠하면 0 → 전체편집으로 오인 방지)
    onStrokesChange?.(editableBrushCount(strokesRef.current, contentRectRef.current))
  }

  // contentRect(이미지 표시 사각형)이 뒤늦게 로드되면 유효 카운트를 다시 알린다
  useEffect(() => { onStrokesChange?.(editableBrushCount(strokesRef.current, contentRect)) }, [contentRect, onStrokesChange])

  useImperativeHandle(ref, () => ({
    hasStrokes: () => hasEditableStrokes(strokesRef.current, contentRectRef.current),
    clear: () => { strokesRef.current = []; drawingRef.current = null; redraw(); onStrokesChange?.(0) },
    // 캡처 해상도(capW×capH) 마스크 PNG data URL. 칠한 영역=투명(편집), 나머지=불투명(보존).
    // 언마운트 후에도 호출될 수 있어 contentRectRef.current(최신값)로 클리핑한다.
    buildMask: (capW, capH) => {
      const cr = contentRectRef.current
      if (!hasEditableStrokes(strokesRef.current, cr)) return null
      const off = document.createElement('canvas')
      off.width = capW; off.height = capH
      const ctx = off.getContext('2d')
      ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, capW, capH) // 불투명=보존
      const sx = capW / (element.width || 1), sy = capH / (element.height || 1)
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      for (const s of strokesRef.current) {
        ctx.globalCompositeOperation = s.tool === 'erase' ? 'source-over' : 'destination-out'
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = Math.max(1, s.size * sx)
        strokePathXY(ctx, s.pts, sx, sy)
      }
      if (cr) { // contain 여백 클리핑: 표시 사각형 밖은 다시 불투명(보존)으로
        ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000000'
        fillOutside(ctx, { x: cr.x * sx, y: cr.y * sy, w: cr.w * sx, h: cr.h * sy }, capW, capH)
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

// 요소-로컬 점 p가 사각형 r 안인가(r 없으면 항상 true=박스 전체 편집)
function inRect(p, r) { return !r || (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) }
// 편집 가능 영역 안에 칠한 brush 스트로크가 있는가(hasStrokes·buildMask 공통 판정)
function hasEditableStrokes(strokes, r) { return strokes.some(s => s.tool === 'brush' && s.pts.some(p => inRect(p, r))) }
// 편집 가능 영역 안에 점이 있는 brush 스트로크 수(버튼 안내용)
function editableBrushCount(strokes, r) { return strokes.filter(s => s.tool === 'brush' && s.pts.some(p => inRect(p, r))).length }

// 사각형 r 바깥(상/하/좌/우 4밴드)을 현재 fillStyle로 채운다
function fillOutside(ctx, r, W, H) {
  ctx.fillRect(0, 0, W, Math.max(0, r.y))                          // 위
  ctx.fillRect(0, r.y + r.h, W, Math.max(0, H - (r.y + r.h)))      // 아래
  ctx.fillRect(0, r.y, Math.max(0, r.x), r.h)                      // 좌
  ctx.fillRect(r.x + r.w, r.y, Math.max(0, W - (r.x + r.w)), r.h)  // 우
}

// 요소-로컬 pts를 (sx,sy) 배로 그린다. 점 하나면 원 하나(round cap 대체).
function strokePathXY(ctx, pts, sx, sy) {
  if (!pts.length) return
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0].x * sx, pts[0].y * sy, Math.max(0.5, ctx.lineWidth / 2), 0, Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle; ctx.fill()
    return
  }
  ctx.beginPath()
  ctx.moveTo(pts[0].x * sx, pts[0].y * sy)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * sx, pts[i].y * sy)
  ctx.stroke()
}

export default MaskBrushOverlay
