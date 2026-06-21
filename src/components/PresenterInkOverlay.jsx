import { useRef, useCallback } from 'react'
import { pointsToSvgPath } from '../core/PolyShapeUtils'

// 도구별 선 굵기(캔버스 좌표 기준 — viewBox가 캔버스 크기라 스케일과 무관하게 일정 비율)
const PEN_WIDTH = { thin: 3, thick: 7 }
const HL_WIDTH = { thin: 16, thick: 28 }
const ERASE_RADIUS = 14 // 캔버스 px — 이 거리 안의 획을 지움

function strokeRenderProps(stroke) {
  const isHl = stroke.tool === 'highlighter'
  const table = isHl ? HL_WIDTH : PEN_WIDTH
  return {
    d: pointsToSvgPath(stroke.points, false),
    stroke: stroke.color,
    strokeWidth: table[stroke.width] ?? table.thin,
    fill: 'none',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    opacity: isHl ? 0.4 : 1,
    style: isHl ? { mixBlendMode: 'multiply' } : undefined,
  }
}

/**
 * PresenterInkOverlay — 발표 모드 잉크(주석) SVG 오버레이.
 * 슬라이드 scale 컨테이너 안에 배치되어 같은 transform을 공유한다.
 * penActive일 때만 포인터를 받고, 아니면 클릭 네비가 통과하도록 pointer-events:none.
 *
 * 좌표는 캔버스 좌표계(0..canvasSize)로 저장 → viewBox로 렌더하므로 scale/리사이즈 무관.
 */
export default function PresenterInkOverlay({
  penActive, tool, color, penWidth, scale, canvasSize,
  strokes, onCommitStroke, onEraseStroke,
}) {
  const svgRef = useRef(null)
  const drawRef = useRef(null)   // { id, pointerId, points } 진행 중 획
  const liveRef = useRef(null)   // 진행 중 path DOM (성능: setState 없이 직접 갱신)

  // 클라이언트 좌표 → 캔버스 좌표
  const toCanvas = useCallback((e) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale }
  }, [scale])

  // 지우개: 포인터 근처 획을 찾아 삭제
  const eraseAt = useCallback((p) => {
    for (const s of strokes) {
      for (const pt of s.points) {
        if (Math.hypot(pt.x - p.x, pt.y - p.y) <= ERASE_RADIUS) { onEraseStroke(s.id); break }
      }
    }
  }, [strokes, onEraseStroke])

  const onPointerDown = useCallback((e) => {
    if (!penActive) return
    e.preventDefault()
    e.stopPropagation()
    const p = toCanvas(e)
    // 오른쪽 버튼 드래그 = 도구와 무관하게 즉석 지우개(빠른 인터랙션)
    const erasing = tool === 'eraser' || e.button === 2
    if (erasing) {
      drawRef.current = { eraser: true, pointerId: e.pointerId }
      eraseAt(p)
      try { svgRef.current.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
      return
    }
    drawRef.current = { id: `ink-${Date.now()}-${Math.round(p.x)}`, pointerId: e.pointerId, tool, color, width: penWidth, points: [p] }
    // 라이브 path에 현재 도구의 시각 속성 부여(ref 변경은 리렌더가 없으므로 직접 설정)
    const path = liveRef.current
    if (path) {
      const rp = strokeRenderProps({ tool, color, width: penWidth, points: [] })
      path.setAttribute('stroke', rp.stroke)
      path.setAttribute('stroke-width', String(rp.strokeWidth))
      path.setAttribute('opacity', String(rp.opacity))
      path.style.mixBlendMode = rp.style?.mixBlendMode || ''
      path.setAttribute('d', '')
    }
    try { svgRef.current.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
  }, [penActive, tool, color, penWidth, toCanvas, eraseAt])

  const onPointerMove = useCallback((e) => {
    const d = drawRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const p = toCanvas(e)
    if (d.eraser) { eraseAt(p); return }
    const last = d.points[d.points.length - 1]
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2) return // 과밀 포인트 솎기
    d.points.push(p)
    if (liveRef.current) liveRef.current.setAttribute('d', pointsToSvgPath(d.points, false))
  }, [toCanvas, eraseAt])

  const finishStroke = useCallback((e) => {
    const d = drawRef.current
    if (!d || (e && d.pointerId !== e.pointerId)) return
    drawRef.current = null
    if (liveRef.current) liveRef.current.setAttribute('d', '')
    if (!d.eraser && d.points.length >= 2) {
      onCommitStroke({ id: d.id, tool: d.tool, color: d.color, width: d.width, points: d.points })
    }
  }, [onCommitStroke])

  // 둘째 손가락 진입 → 현재 획 폐기(핀치/멀티터치 오작동 방지)
  const onPointerDownCapture = useCallback((e) => {
    if (penActive && drawRef.current && drawRef.current.pointerId !== e.pointerId) {
      drawRef.current = null
      if (liveRef.current) liveRef.current.setAttribute('d', '')
    }
  }, [penActive])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${canvasSize.w} ${canvasSize.h}`}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: penActive ? 'auto' : 'none',
        touchAction: penActive ? 'none' : 'auto',
        cursor: penActive ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
        zIndex: 2147483000, // 슬라이드 요소(추출 zIndex가 클 수 있음) 위에 항상
      }}
    >
      {strokes.map(s => <path key={s.id} {...strokeRenderProps(s)} />)}
      {/* 진행 중 획(라이브) — 항상 마운트, 속성/ d는 포인터 핸들러에서 직접 갱신 */}
      <path ref={liveRef} fill="none" strokeLinecap="round" strokeLinejoin="round" d="" />
    </svg>
  )
}
