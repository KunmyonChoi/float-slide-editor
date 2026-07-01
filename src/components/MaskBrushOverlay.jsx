import { useRef, useState, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BlobStore } from '../core/BlobStore'

// element.content(idb 참조 또는 URL/dataURL) → 표시 가능한 URL(+해제 함수)
async function contentToUrl(content) {
  if (BlobStore.isIdbRef(content)) {
    const b = await BlobStore.get(BlobStore.parseRef(content))
    if (!b) throw new Error('이미지 데이터를 불러오지 못했습니다.')
    const url = URL.createObjectURL(b)
    return { url, revoke: () => URL.revokeObjectURL(url) }
  }
  return { url: content, revoke: () => {} }
}

// objectFit=contain일 때 요소 박스(W×H) 안에서 이미지가 실제 표시되는 사각형(요소-로컬 px)
function containRect(W, H, natW, natH) {
  const boxAR = W / H, imgAR = natW / natH
  if (imgAR >= boxAR) { const dh = W / imgAR; return { x: 0, y: (H - dh) / 2, w: W, h: dh } }
  const dw = H * imgAR; return { x: (W - dw) / 2, y: 0, w: dw, h: H }
}

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
  { element, scale, canvasRef, tool = 'brush', brushSize = 40, objectFit = 'contain', onStrokesChange },
  ref,
) {
  const canvasElRef = useRef(null)
  const strokesRef = useRef([])       // [{ tool:'brush'|'erase', size, pts:[{x,y}] }] — 요소-로컬 px
  const drawingRef = useRef(null)     // 진행 중 스트로크
  const [rect, setRect] = useState(null)
  const [tick, setTick] = useState(0)
  // 편집 가능한 영역(요소-로컬 px). contain이면 이미지 실제 표시 사각형, 아니면 박스 전체.
  const [contentRect, setContentRect] = useState(null)

  // contain 모드: 이미지 자연 크기를 읽어 표시 사각형 계산(여백은 편집 불가로 클리핑)
  useEffect(() => {
    let alive = true, revoke = () => {}
    if (objectFit !== 'contain') { setContentRect(null); return }
    ;(async () => {
      try {
        const r = await contentToUrl(element.content); revoke = r.revoke
        const img = new Image()
        img.onload = () => { if (alive) setContentRect(containRect(element.width, element.height, img.naturalWidth, img.naturalHeight)) }
        img.src = r.url
      } catch { /* 실패 시 박스 전체 허용 */ }
    })()
    return () => { alive = false; revoke() }
  }, [element.content, element.width, element.height, objectFit])

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
    // contain 여백은 편집 불가 → 칠한 것도 여기선 지우고(클리핑 미리보기) 어둡게 딤
    if (contentRect) {
      const r = { x: contentRect.x * scale, y: contentRect.y * scale, w: contentRect.w * scale, h: contentRect.h * scale }
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
      fillOutside(ctx, r, cv.width, cv.height) // 여백의 빨간 칠 제거
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = 'rgba(15,23,42,0.45)'
      fillOutside(ctx, r, cv.width, cv.height) // 여백 딤(편집 불가 표시)
    }
    ctx.globalCompositeOperation = 'source-over'
  }, [scale, contentRect])

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
  const inEditable = useCallback((p) => inRect(p, contentRect), [contentRect])

  const endStroke = (e) => {
    if (!drawingRef.current) return
    e.stopPropagation()
    drawingRef.current = null
    // 편집 가능 영역 안의 브러시 스트로크만 센다(여백만 칠하면 0 → 전체편집으로 오인 방지)
    onStrokesChange?.(editableBrushCount(strokesRef.current, contentRect))
  }

  // contentRect(이미지 표시 사각형)이 뒤늦게 로드되면 유효 카운트를 다시 알린다
  useEffect(() => { onStrokesChange?.(editableBrushCount(strokesRef.current, contentRect)) }, [contentRect, onStrokesChange])

  useImperativeHandle(ref, () => ({
    // 편집 가능 영역 안에 칠한 점이 있어야 유효한 마스크
    hasStrokes: () => strokesRef.current.some(s => s.tool === 'brush' && s.pts.some(inEditable)),
    clear: () => { strokesRef.current = []; drawingRef.current = null; redraw(); onStrokesChange?.(0) },
    // 캡처 해상도(capW×capH) 마스크 PNG data URL. 칠한 영역=투명(편집), 나머지=불투명(보존).
    buildMask: (capW, capH) => {
      if (!strokesRef.current.some(s => s.tool === 'brush' && s.pts.some(inEditable))) return null
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
      // contain 여백 클리핑: 표시 사각형 밖은 다시 불투명(보존)으로
      if (contentRect) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = '#000000'
        fillOutside(ctx, { x: contentRect.x * sx, y: contentRect.y * sy, w: contentRect.w * sx, h: contentRect.h * sy }, capW, capH)
      }
      ctx.globalCompositeOperation = 'source-over'
      return off.toDataURL('image/png')
    },
  }), [element.width, element.height, contentRect, inEditable, redraw, onStrokesChange])

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
// 편집 가능 영역 안에 점이 있는 brush 스트로크 수
function editableBrushCount(strokes, r) {
  return strokes.filter(s => s.tool === 'brush' && s.pts.some(p => inRect(p, r))).length
}

// 사각형 r 바깥(상/하/좌/우 4밴드)을 현재 fillStyle로 채운다
function fillOutside(ctx, r, W, H) {
  ctx.fillRect(0, 0, W, Math.max(0, r.y))                          // 위
  ctx.fillRect(0, r.y + r.h, W, Math.max(0, H - (r.y + r.h)))      // 아래
  ctx.fillRect(0, r.y, Math.max(0, r.x), r.h)                      // 좌
  ctx.fillRect(r.x + r.w, r.y, Math.max(0, W - (r.x + r.w)), r.h)  // 우
}

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
