import { useCallback, useRef, useEffect, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { computeSnapGuides, computeResizeSnapGuides } from '../core/SnapEngine'
import { computeRotationAngle, snapRotation, normalizeAngle, canvasDeltaToLocal } from '../core/RotationUtils'
import { pointsToBBox, closestPointOnSegments } from '../core/PolyShapeUtils'
import { attachTargetAt, nearestConnectionPoint } from '../core/ConnectorRouting'
import { useIsTouch } from '../core/pointerEnv'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_OFFSET = 30
// 리사이즈 최소 크기. 얇은 구분선/규칙선(높이 1~4px 등)으로 변환된 요소를
// 다시 그 크기로 되돌릴 수 있도록 1px까지 허용한다(0/음수만 방지).
const MIN_SIZE = 1
const GROUP_HANDLE_SIZE = 8
const RADIUS_HANDLE_MIN_INSET = 14 // 둥글기 0일 때도 잡을 수 있도록 핸들 최소 안쪽 거리
const RADIUS_HANDLE_MAX_INSET = 18 // 핸들이 모서리 근처에 머물도록 상한(중앙 침범 방지)
const RADIUS_HANDLE_MIN_ELEM = 40 // 이보다 작은 요소는 핸들이 본체를 덮으므로 숨김

// (x,y) 캔버스 좌표를 포함하는 최상위(zIndex) 텍스트/표 요소 — 그룹 내부 더블클릭 편집용 (순수)
export function hitTopTextAt(elements, x, y) {
  let best = null
  for (const el of elements) {
    if (el.type !== 'text' && el.type !== 'table') continue
    if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) {
      if (!best || el.zIndex > best.zIndex) best = el
    }
  }
  return best
}

const HANDLES = [
  { dir: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { dir: 'n',  cursor: 'ns-resize',   x: 0.5, y: 0 },
  { dir: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { dir: 'e',  cursor: 'ew-resize',   x: 1, y: 0.5 },
  { dir: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { dir: 's',  cursor: 'ns-resize',   x: 0.5, y: 1 },
  { dir: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { dir: 'w',  cursor: 'ew-resize',   x: 0, y: 0.5 },
]

/**
 * FlatSelectionOverlay
 * 선택된 요소 주변에 8방향 리사이즈 핸들을 렌더링한다.
 * 드래그로 이동, 핸들로 리사이즈.
 */
export default function FlatSelectionOverlay({ element, scale, otherRects, canvasSize, onSnapGuides }) {
  const { previewFlatElement, updateFlatElement, editingFlatId, setEditingFlat,
          setSelectedFlat, toggleSelectFlat, flatElements } = useFlatStore()
  const diagramMode = useFlatStore(s => s.diagramMode)
  const isTouch = useIsTouch()
  const dragRef = useRef(null)

  // 더블클릭 → 텍스트 편집 모드 진입 (text + shape)
  const handleDoubleClick = useCallback((e) => {
    if (element.type === 'text' || element.type === 'shape' || element.type === 'table') {
      e.stopPropagation()
      setEditingFlat(element.id)
    }
  }, [element.id, element.type, setEditingFlat])

  // 드래그 이동
  const handleMoveStart = useCallback((e) => {
    const st = useFlatStore.getState()
    if (st.drawMode) return // 그리기 모드 중 이동 차단
    if (editingFlatId) return
    if (dragRef.current) return // 이미 드래그 중(둘째 손가락 등) → 무시
    // 다이어그램 모드 + Alt/⌘(Cmd) 드래그 → 이 도형(선택됨)에서 커넥터 시작(이동 대신)
    if (st.diagramMode && (e.altKey || e.metaKey) && element.shapeType !== 'connector') {
      e.stopPropagation(); e.preventDefault()
      st.beginConnectorFrom(element.id, { x: element.x + element.width / 2, y: element.y + element.height / 2 })
      return
    }
    // 커넥터는 기하가 연결 참조에서 유도됨 → 본체 이동 무의미. 선택만 유지(마키/해제 방지).
    if (element.shapeType === 'connector') { e.stopPropagation(); return }
    if (element.locked) return
    if (e.target.dataset.resizeHandle) return
    e.stopPropagation()

    // 클릭 지점에 현재 선택 요소보다 위에 있는 다른 요소가 있으면 그 요소 선택
    const canvasEl = e.currentTarget.parentElement
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect()
      const cx = (e.clientX - rect.left) / scale
      const cy = (e.clientY - rect.top) / scale
      // 현재 선택 요소보다 zIndex가 높고, 클릭 지점에 있는 요소 찾기 (배경 제외)
      const hit = flatElements
        .filter(el => {
          if (el.id === element.id) return false
          if (el.zIndex <= element.zIndex) return false
          // 배경 요소 제외
          if (el.type === 'shape' && !el.content
            && Math.abs(el.width - canvasSize.w) < 2 && Math.abs(el.height - canvasSize.h) < 2
            && Math.abs(el.x) < 2 && Math.abs(el.y) < 2) return false
          return cx >= el.x && cy >= el.y && cx <= el.x + el.width && cy <= el.y + el.height
        })
        .sort((a, b) => b.zIndex - a.zIndex)[0]
      if (hit) {
        if (e.shiftKey) {
          toggleSelectFlat(hit.id)
        } else {
          setSelectedFlat(hit.id)
        }
        return
      }
    }

    dragRef.current = {
      mode: 'move',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: element.x,
      startY: element.y,
      otherRects: otherRects || [],
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    // 터치: 포인터 캡처로 손가락이 요소를 벗어나도 이동 지속
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [element, editingFlatId, scale, flatElements, canvasSize, otherRects, setSelectedFlat, toggleSelectFlat])

  // 리사이즈 시작
  const handleResizeStart = useCallback((e, dir) => {
    if (editingFlatId || element.locked) return
    if (dragRef.current) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'resize',
      dir,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: element.x,
      startY: element.y,
      startW: element.width,
      startH: element.height,
      startRotation: element.rotation || 0,
      otherRects: otherRects || [],
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [element, editingFlatId, otherRects])

  // 회전 시작
  const handleRotateStart = useCallback((e) => {
    if (editingFlatId || element.locked) return
    if (dragRef.current) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'rotate',
      startRotation: element.rotation || 0,
      cx: element.x + element.width / 2,
      cy: element.y + element.height / 2,
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [element, editingFlatId])

  // 모서리 둥글기(border-radius) 조절 시작
  const handleRadiusStart = useCallback((e) => {
    if (editingFlatId || element.locked) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'radius',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startRadius: parseFloat(element.styles?.borderRadius) || 0,
      maxR: Math.min(element.width, element.height) / 2,
      rot: element.rotation || 0,
    }
  }, [element, editingFlatId])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      // 마우스 PointerEvent는 mousemove가 처리(중복 방지). 터치/펜만 포인터 경로로.
      if (e.pointerType === 'mouse') return
      if (d.pointerId != null && e.pointerId !== d.pointerId) return

      if (d.mode === 'rotate') {
        // canvasRef(scale 적용된 부모)의 rect에서 캔버스 좌표 계산
        const canvasEl = document.querySelector('[data-flat-canvas]')
        if (!canvasEl) return
        const parentEl = canvasEl.parentElement // canvasRef div (scale 적용)
        if (!parentEl) return
        const rect = parentEl.getBoundingClientRect()
        const mouseX = (e.clientX - rect.left) / scale
        const mouseY = (e.clientY - rect.top) / scale
        let angle = computeRotationAngle(d.cx, d.cy, mouseX, mouseY)
        angle = normalizeAngle(Math.round(angle))
        if (e.shiftKey) angle = Math.round(angle / 45) * 45 % 360
        previewFlatElement(element.id, { rotation: angle })
        return
      }

      const dx = (e.clientX - d.startMouseX) / scale
      const dy = (e.clientY - d.startMouseY) / scale

      if (d.mode === 'move') {
        let px = d.startX + dx
        let py = d.startY + dy
        // 스냅 가이드 계산 — ⌘(Cmd)/Ctrl를 누르고 있으면 일시적으로 스냅(자석) 무시(Figma식)
        if (d.otherRects && onSnapGuides && !(e.metaKey || e.ctrlKey)) {
          const snap = computeSnapGuides(
            { x: px, y: py, width: element.width, height: element.height },
            d.otherRects, canvasSize
          )
          if (snap.snappedX !== null) px = snap.snappedX
          if (snap.snappedY !== null) py = snap.snappedY
          onSnapGuides(snap.guides)
        } else if (onSnapGuides) {
          onSnapGuides([]) // 스냅 무시 중에는 가이드도 숨김
        }
        previewFlatElement(element.id, { x: px, y: py })
      } else if (d.mode === 'resize') {
        let w = d.startW, h = d.startH
        const dir = d.dir
        const sym = e.altKey || e.ctrlKey || e.metaKey   // Alt(또는 Ctrl: PowerPoint): 중심 대칭
        const lockRatio = e.shiftKey  // Shift: 가로세로 비율 고정

        // 회전된 요소: 마우스 delta를 로컬 좌표로 변환
        const rot = d.startRotation || 0
        const { dx: ldx, dy: ldy } = rot ? canvasDeltaToLocal(dx, dy, rot) : { dx, dy }

        const k = sym ? 2 : 1 // 중심 대칭이면 양쪽이 움직이므로 변화량 2배
        if (dir.includes('e')) w = Math.max(MIN_SIZE, d.startW + ldx * k)
        if (dir.includes('w')) w = Math.max(MIN_SIZE, d.startW - ldx * k)
        if (dir.includes('s')) h = Math.max(MIN_SIZE, d.startH + ldy * k)
        if (dir.includes('n')) h = Math.max(MIN_SIZE, d.startH - ldy * k)

        // 비율 고정 — 더 많이 변한 축을 기준으로 나머지를 비례 계산
        if (lockRatio) {
          const ratio = d.startW / d.startH
          const horiz = dir.includes('e') || dir.includes('w')
          const vert = dir.includes('n') || dir.includes('s')
          if (horiz && vert) {
            if (Math.abs(w / d.startW - 1) >= Math.abs(h / d.startH - 1)) h = w / ratio
            else w = h * ratio
          } else if (horiz) { h = w / ratio } else { w = h * ratio }
          w = Math.max(MIN_SIZE, w); h = Math.max(MIN_SIZE, h)
        }

        // 앵커 보정: 중심 대칭이면 중심 고정(dax=day=0), 아니면 반대편 고정
        let dax = 0, day = 0
        if (!sym) {
          if (dir.includes('e')) dax = (w - d.startW) / 2
          if (dir.includes('w')) dax = (d.startW - w) / 2
          if (dir.includes('s')) day = (h - d.startH) / 2
          if (dir.includes('n')) day = (d.startH - h) / 2
        }

        const rad = rot * Math.PI / 180
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        const startCX = d.startX + d.startW / 2
        const startCY = d.startY + d.startH / 2
        let x = startCX + dax * cosR - day * sinR - w / 2
        let y = startCY + dax * sinR + day * cosR - h / 2

        // 리사이즈 스냅 (비회전 + 보조키 미사용 시만 — 비율/대칭을 깨지 않도록)
        if (!rot && !lockRatio && !sym && d.otherRects && onSnapGuides) {
          const snap = computeResizeSnapGuides(
            { x, y, width: w, height: h }, dir, d.otherRects, canvasSize
          )
          x = snap.x; y = snap.y; w = snap.width; h = snap.height
          onSnapGuides(snap.guides)
        }

        previewFlatElement(element.id, { x, y, width: w, height: h })
      } else if (d.mode === 'radius') {
        // 회전된 요소: 마우스 delta를 로컬 좌표로 변환 후 대각선 방향으로 투영
        const { dx: ldx, dy: ldy } = d.rot ? canvasDeltaToLocal(dx, dy, d.rot) : { dx, dy }
        const r = Math.max(0, Math.min(d.maxR, d.startRadius + (ldx + ldy) / 2))
        previewFlatElement(element.id, { styles: { borderRadius: Math.round(r) + 'px' } })
      }
    }

    const onUp = (e) => {
      const d = dragRef.current
      if (!d) return
      // 마우스 PointerEvent의 pointerup은 mouseup이 처리(중복 방지)
      if (e && e.pointerType === 'mouse') return
      if (e && d.pointerId != null && e.pointerId != null && e.pointerId !== d.pointerId) return
      dragRef.current = null
      if (onSnapGuides) onSnapGuides([])

      // 현재(프리뷰) 값을 저장한 후 원래 값으로 되돌리고 updateFlatElement 호출
      // → updateFlatElement가 올바른 oldValues를 캡처하여 undo 가능
      const els = useFlatStore.getState().flatElements
      const current = els.find(e => e.id === element.id)
      if (!current) return

      if (d.mode === 'rotate') {
        const newRotation = current.rotation || 0
        if (newRotation !== d.startRotation) {
          previewFlatElement(element.id, { rotation: d.startRotation })
          updateFlatElement(element.id, { rotation: newRotation })
        }
      } else if (d.mode === 'move') {
        if (current.x !== d.startX || current.y !== d.startY) {
          const newX = current.x, newY = current.y
          previewFlatElement(element.id, { x: d.startX, y: d.startY })
          updateFlatElement(element.id, { x: newX, y: newY })
        }
      } else if (d.mode === 'resize') {
        if (current.x !== d.startX || current.y !== d.startY ||
            current.width !== d.startW || current.height !== d.startH) {
          const newVals = { x: current.x, y: current.y, width: current.width, height: current.height }
          previewFlatElement(element.id, { x: d.startX, y: d.startY, width: d.startW, height: d.startH })
          updateFlatElement(element.id, newVals)
        }
      } else if (d.mode === 'radius') {
        const newRadius = parseFloat(current.styles?.borderRadius) || 0
        if (newRadius !== d.startRadius) {
          previewFlatElement(element.id, { styles: { borderRadius: d.startRadius + 'px' } })
          updateFlatElement(element.id, { styles: { borderRadius: newRadius + 'px' } })
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 터치/펜: 같은 onMove/onUp 재사용(내부에서 pointerType==='mouse'는 무시)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [element.id, scale, previewFlatElement, updateFlatElement])

  const { x, y, width, height, zIndex } = element
  const rot = element.rotation || 0
  const locked = element.locked
  const isConnector = element.shapeType === 'connector'

  // 모서리 둥글기 핸들: 사각형 요소(포인트 기반 다각형·배경 제외)에만 노출
  const isBackground = element.type === 'shape' && !element.content
    && Math.abs(width - canvasSize.w) < 2 && Math.abs(height - canvasSize.h) < 2
    && Math.abs(x) < 2 && Math.abs(y) < 2
  const maxR = Math.min(width, height) / 2
  const curR = parseFloat(element.styles?.borderRadius) || 0
  // 핸들은 모서리 근처에만(상한 적용) — 작은 요소에서 중앙을 덮어 이동을 막지 않도록.
  const radiusInset = Math.min(Math.max(curR, RADIUS_HANDLE_MIN_INSET), maxR, RADIUS_HANDLE_MAX_INSET)
  // 너무 작거나(본체를 덮음) 이미 완전 라운드(원형·필 — 둥글기 조절 무의미)면 숨김
  const isFullyRound = curR >= maxR - 0.5
  const showRadiusHandle = !locked && !element.points && !isBackground
    && Math.min(width, height) >= RADIUS_HANDLE_MIN_ELEM && !isFullyRound

  return (
    <div
      data-export-ignore="true"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        zIndex: 9999,
        cursor: locked ? 'default' : 'move',
        // 커넥터는 본체 이동이 없고 bbox가 (대각선이면) 크다 → 컨테이너가 아래 도형 클릭을
        // 막지 않도록 pointer 통과. 끝점 핸들만 따로 auto로 받는다.
        pointerEvents: (locked || isConnector) ? 'none' : 'auto',
        // 터치로 선택 요소를 끌어 이동 — 브라우저 기본 제스처(스크롤 등) 차단
        touchAction: (locked || isConnector) ? undefined : 'none',
        transform: rot ? `rotate(${rot}deg)` : undefined,
        transformOrigin: rot ? 'center center' : undefined,
      }}
      onMouseDown={handleMoveStart}
      onPointerDown={(e) => { if (e.pointerType === 'touch') handleMoveStart(e) }}
      onDoubleClick={handleDoubleClick}
    >
      {!locked && (
        <>
          {/* 회전 핸들 (커넥터는 회전 무의미 → 숨김. 모바일은 일반 모드에서만) */}
          {!isConnector && !(isTouch && diagramMode) && (() => {
            const rsz = isTouch ? 22 / scale : 10
            const roff = isTouch ? ROTATE_HANDLE_OFFSET / scale : ROTATE_HANDLE_OFFSET
            return <>
              <div
                data-resize-handle="true"
                onMouseDown={handleRotateStart}
                onPointerDown={(e) => { if (e.pointerType === 'touch') handleRotateStart(e) }}
                style={{
                  position: 'absolute',
                  left: width / 2 - rsz / 2,
                  top: -roff,
                  width: rsz, height: rsz,
                  background: '#6366f1',
                  border: `${(isTouch ? 2 : 1.5) / (isTouch ? scale : 1)}px solid #fff`,
                  borderRadius: '50%',
                  cursor: 'grab', touchAction: 'none',
                  zIndex: 10001,
                }}
              />
              <div style={{
                position: 'absolute',
                left: width / 2,
                top: -(roff - rsz),
                width: 1 / (isTouch ? scale : 1),
                height: roff - rsz,
                background: 'rgba(99,102,241,0.5)',
                pointerEvents: 'none',
              }} />
            </>
          })()}
          {/* 모서리 둥글기 핸들 (좌상단 안쪽 다이아몬드) */}
          {showRadiusHandle && (
            <div
              data-resize-handle="true"
              title="드래그하여 모서리 둥글기 조절"
              onMouseDown={handleRadiusStart}
              style={{
                position: 'absolute',
                left: radiusInset - 5,
                top: radiusInset - 5,
                width: 10,
                height: 10,
                background: '#f59e0b',
                border: '1.5px solid #fff',
                transform: 'rotate(45deg)',
                cursor: 'nwse-resize',
                zIndex: 10001,
              }}
            />
          )}
          {/* 리사이즈 핸들 또는 포인트 핸들 */}
          {isConnector && element.connection && element.points && element.points.length >= 2 ? (
            /* 커넥터: 양 끝 재연결 핸들 — 드래그로 다른 도형에 재부착(빈 공간이면 원복) */
            [0, element.points.length - 1].map((idx, i) => {
              const which = i === 0 ? 'start' : 'end'
              const pt = element.points[idx]
              return (
                <div
                  key={which}
                  data-resize-handle="true"
                  title="드래그해서 다른 도형에 다시 연결"
                  onMouseDown={(e) => {
                    e.stopPropagation(); e.preventDefault()
                    const orig = element.connection
                    const origMine = which === 'start' ? orig.start : orig.end
                    const onMove = (me) => {
                      const canvasEl = document.querySelector('[data-flat-canvas]')
                      if (!canvasEl) return
                      const rect = canvasEl.getBoundingClientRect()
                      const p = { x: (me.clientX - rect.left) / scale, y: (me.clientY - rect.top) / scale }
                      const st = useFlatStore.getState()
                      const otherId = (which === 'start' ? orig.end : orig.start)?.elementId
                      const targetId = attachTargetAt(p.x, p.y, st.flatElements, { excludeId: otherId, canvasSize: st.canvasSize })
                      // 연결점에 가까우면 고정, 아니면 몸체=플로팅
                      let tempEnd
                      if (targetId) {
                        const tEl = st.flatElements.find(el => el.id === targetId)
                        const ap = tEl ? nearestConnectionPoint(p.x, p.y, tEl, 16) : null
                        tempEnd = ap ? { elementId: targetId, fx: ap.fx, fy: ap.fy } : { elementId: targetId }
                      } else {
                        tempEnd = { point: p }
                      }
                      const tempConn = which === 'start' ? { start: tempEnd, end: orig.end } : { start: orig.start, end: tempEnd }
                      previewFlatElement(element.id, { connection: tempConn })
                    }
                    const onUp = () => {
                      window.removeEventListener('mousemove', onMove)
                      window.removeEventListener('mouseup', onUp)
                      const cur = useFlatStore.getState().flatElements.find(el => el.id === element.id)
                      const curEnd = cur && (which === 'start' ? cur.connection.start : cur.connection.end)
                      // 원복 후, 도형에 부착(변경)된 경우만 히스토리 커밋. 빈 공간이면 취소(원복 유지).
                      previewFlatElement(element.id, { connection: orig })
                      const changed = curEnd && curEnd.elementId && (
                        curEnd.elementId !== origMine?.elementId ||
                        curEnd.fx !== origMine?.fx || curEnd.fy !== origMine?.fy)
                      if (changed) {
                        const finalConn = which === 'start' ? { start: curEnd, end: orig.end } : { start: orig.start, end: curEnd }
                        updateFlatElement(element.id, { connection: finalConn })
                      }
                    }
                    window.addEventListener('mousemove', onMove)
                    window.addEventListener('mouseup', onUp)
                  }}
                  style={{
                    position: 'absolute',
                    left: pt.x - 6, top: pt.y - 6,
                    width: 12, height: 12,
                    background: '#10b981',
                    border: '2px solid #fff',
                    boxShadow: '0 0 0 1px rgba(16,185,129,0.5)',
                    borderRadius: '50%',
                    cursor: 'crosshair',
                    pointerEvents: 'auto', // 컨테이너가 none이어도 핸들은 받음
                    zIndex: 10001,
                  }}
                />
              )
            })
          ) : element.shapeType && element.points ? (
            /* 포인트 기반 shape: 각 꼭지점에 원형 핸들 */
            element.points.map((pt, idx) => (
              <div
                key={`pt-${idx}`}
                data-resize-handle="true"
                onMouseDown={(e) => {
                  if (e.shiftKey && element.points.length > 2) {
                    // Shift+클릭: 포인트 삭제
                    e.stopPropagation()
                    const newPts = element.points.filter((_, i) => i !== idx)
                    const bbox = pointsToBBox(newPts.map(p => ({ x: p.x + element.x, y: p.y + element.y })))
                    const relPts = newPts.map(p => ({ x: p.x + element.x - bbox.x, y: p.y + element.y - bbox.y }))
                    updateFlatElement(element.id, { points: relPts, x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height })
                    return
                  }
                  // 포인트 드래그 시작
                  e.stopPropagation()
                  const startX = e.clientX, startY = e.clientY
                  const startPt = { ...pt }
                  const onMove = (me) => {
                    const dx = (me.clientX - startX) / scale
                    const dy = (me.clientY - startY) / scale
                    const newPts = element.points.map((p, i) =>
                      i === idx ? { x: startPt.x + dx, y: startPt.y + dy } : p
                    )
                    const absPts = newPts.map(p => ({ x: p.x + element.x, y: p.y + element.y }))
                    const bbox = pointsToBBox(absPts)
                    const relPts = absPts.map(p => ({ x: p.x - bbox.x, y: p.y - bbox.y }))
                    previewFlatElement(element.id, { points: relPts, x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height })
                  }
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove)
                    window.removeEventListener('mouseup', onUp)
                    const el = useFlatStore.getState().flatElements.find(e => e.id === element.id)
                    if (el) updateFlatElement(element.id, { points: el.points, x: el.x, y: el.y, width: el.width, height: el.height })
                  }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                }}
                style={{
                  position: 'absolute',
                  left: pt.x - 5,
                  top: pt.y - 5,
                  width: 10, height: 10,
                  background: '#6366f1',
                  border: '2px solid #fff',
                  borderRadius: '50%',
                  cursor: 'move',
                  zIndex: 10000,
                }}
              />
            ))
          ) : isTouch ? (
            /* 모바일: 우하단(SE) 한 점만 — 좌상단 고정 자유 변형. 화면 기준 일정 크기. */
            (() => {
              const H = 24 / scale
              return (
                <div
                  data-resize-handle="true"
                  onMouseDown={(e) => handleResizeStart(e, 'se')}
                  onPointerDown={(e) => { if (e.pointerType === 'touch') handleResizeStart(e, 'se') }}
                  style={{
                    position: 'absolute',
                    left: width - H / 2,
                    top: height - H / 2,
                    width: H, height: H,
                    background: '#6366f1',
                    border: `${2 / scale}px solid #fff`,
                    borderRadius: 6 / scale,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'nwse-resize', touchAction: 'none',
                    zIndex: 10000,
                  }}
                >
                  <svg width={H * 0.55} height={H * 0.55} viewBox="0 0 12 12" fill="none"
                    stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9 H9 V3" />
                  </svg>
                </div>
              )
            })()
          ) : (
            HANDLES.map(h => (
              <div
                key={h.dir}
                data-resize-handle="true"
                onMouseDown={(e) => handleResizeStart(e, h.dir)}
                style={{
                  position: 'absolute',
                  left: h.x * width - HANDLE_SIZE / 2,
                  top: h.y * height - HANDLE_SIZE / 2,
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  background: '#6366f1',
                  border: '1px solid #fff',
                  borderRadius: 2,
                  cursor: h.cursor,
                  zIndex: 10000,
                }}
              />
            ))
          )}
        </>
      )}
      {locked && (
        /* 잠금 아이콘 */
        <div style={{
          position: 'absolute',
          top: -20,
          left: width / 2 - 8,
          color: '#94a3b8',
          pointerEvents: 'none',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
      )}
    </div>
  )
}

// ── 그룹 바운딩 박스 오버레이 ────────────────────────

const GROUP_HANDLES = [
  { dir: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { dir: 'n',  cursor: 'ns-resize',   x: 0.5, y: 0 },
  { dir: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { dir: 'e',  cursor: 'ew-resize',   x: 1, y: 0.5 },
  { dir: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { dir: 's',  cursor: 'ns-resize',   x: 0.5, y: 1 },
  { dir: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { dir: 'w',  cursor: 'ew-resize',   x: 0, y: 0.5 },
]

export function FlatGroupOverlay({ elements, scale, otherRects, canvasSize, onSnapGuides }) {
  const { batchPreviewFlatElements, batchUpdateFlatElementsIndividual, setEditingFlat } = useFlatStore()
  const dragRef = useRef(null)

  const bbox = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of elements) {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.width)
      maxY = Math.max(maxY, el.y + el.height)
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [elements])

  // 잠금되지 않은 요소만 조작 대상
  const movableElements = useMemo(() => elements.filter(el => !el.locked), [elements])

  // 그룹 더블클릭 → 그 지점의 텍스트/표 요소를 인라인 편집 (그룹 유지)
  const handleDoubleClick = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const cx = bbox.x + (e.clientX - r.left) / scale
    const cy = bbox.y + (e.clientY - r.top) / scale
    const hit = hitTopTextAt(elements, cx, cy)
    if (hit) { e.stopPropagation(); setEditingFlat(hit.id) }
  }, [elements, bbox, scale, setEditingFlat])

  // 그룹 이동 시작
  const handleMoveStart = useCallback((e) => {
    if (e.target.dataset.resizeHandle) return
    if (movableElements.length === 0) return
    e.stopPropagation()
    dragRef.current = {
      mode: 'move',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPositions: movableElements.map(el => ({ id: el.id, x: el.x, y: el.y })),
      bbox: { ...bbox },
      otherRects: otherRects || [],
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [movableElements, bbox, otherRects])

  // 그룹 리사이즈 시작
  const handleResizeStart = useCallback((e, dir) => {
    if (movableElements.length === 0) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'resize',
      dir,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      bbox: { ...bbox },
      startPositions: movableElements.map(el => ({
        id: el.id, x: el.x, y: el.y, width: el.width, height: el.height,
      })),
      otherRects: otherRects || [],
      pointerId: e.pointerType ? e.pointerId : undefined,
    }
    if (e.pointerType === 'touch' && e.currentTarget?.setPointerCapture) {
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 무시 */ }
    }
  }, [movableElements, bbox, otherRects])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return
      // 마우스 PointerEvent는 mousemove가 처리(중복 방지). 터치/펜만 포인터 경로로.
      if (e.pointerType === 'mouse') return
      if (d.pointerId != null && e.pointerId !== d.pointerId) return

      const dx = (e.clientX - d.startMouseX) / scale
      const dy = (e.clientY - d.startMouseY) / scale

      if (d.mode === 'move') {
        let bx = d.bbox.x + dx
        let by = d.bbox.y + dy
        let snapDx = 0, snapDy = 0
        // 그룹 bbox 기준 스냅 — ⌘(Cmd)/Ctrl 누르면 일시적으로 스냅 무시
        if (d.otherRects && onSnapGuides && !(e.metaKey || e.ctrlKey)) {
          const snap = computeSnapGuides(
            { x: bx, y: by, width: d.bbox.w, height: d.bbox.h },
            d.otherRects, canvasSize
          )
          if (snap.snappedX !== null) snapDx = snap.snappedX - bx
          if (snap.snappedY !== null) snapDy = snap.snappedY - by
          onSnapGuides(snap.guides)
        } else if (onSnapGuides) {
          onSnapGuides([])
        }
        const changesMap = d.startPositions.map(sp => ({
          id: sp.id,
          changes: { x: sp.x + dx + snapDx, y: sp.y + dy + snapDy },
        }))
        batchPreviewFlatElements(changesMap)
      } else if (d.mode === 'resize') {
        const { bbox: origBbox, dir, startPositions } = d
        const sym = e.altKey || e.ctrlKey || e.metaKey  // Alt(또는 Ctrl: PowerPoint): 그룹 중심 대칭
        const lockRatio = e.shiftKey // Shift: 그룹 비율 고정
        const k = sym ? 2 : 1
        let newW = origBbox.w, newH = origBbox.h

        if (dir.includes('e')) newW = Math.max(MIN_SIZE, origBbox.w + dx * k)
        if (dir.includes('w')) newW = Math.max(MIN_SIZE, origBbox.w - dx * k)
        if (dir.includes('s')) newH = Math.max(MIN_SIZE, origBbox.h + dy * k)
        if (dir.includes('n')) newH = Math.max(MIN_SIZE, origBbox.h - dy * k)

        if (lockRatio) {
          const ratio = origBbox.w / origBbox.h
          const horiz = dir.includes('e') || dir.includes('w')
          const vert = dir.includes('n') || dir.includes('s')
          if (horiz && vert) {
            if (Math.abs(newW / origBbox.w - 1) >= Math.abs(newH / origBbox.h - 1)) newH = newW / ratio
            else newW = newH * ratio
          } else if (horiz) { newH = newW / ratio } else { newW = newH * ratio }
          newW = Math.max(MIN_SIZE, newW); newH = Math.max(MIN_SIZE, newH)
        }

        // 위치: 중심 대칭이면 중심 고정, 아니면 반대편 고정
        let newX = origBbox.x, newY = origBbox.y
        if (sym) {
          newX = origBbox.x + (origBbox.w - newW) / 2
          newY = origBbox.y + (origBbox.h - newH) / 2
        } else {
          if (dir.includes('w')) newX = origBbox.x + (origBbox.w - newW)
          if (dir.includes('n')) newY = origBbox.y + (origBbox.h - newH)
        }

        // 그룹 리사이즈 스냅 (보조키 미사용 시만)
        if (!lockRatio && !sym && d.otherRects && onSnapGuides) {
          const snap = computeResizeSnapGuides(
            { x: newX, y: newY, width: newW, height: newH }, dir, d.otherRects, canvasSize
          )
          newX = snap.x; newY = snap.y; newW = snap.width; newH = snap.height
          onSnapGuides(snap.guides)
        }

        const scaleX = newW / origBbox.w
        const scaleY = newH / origBbox.h

        const changesMap = startPositions.map(sp => ({
          id: sp.id,
          changes: {
            x: newX + (sp.x - origBbox.x) * scaleX,
            y: newY + (sp.y - origBbox.y) * scaleY,
            width: Math.max(MIN_SIZE, sp.width * scaleX),
            height: Math.max(MIN_SIZE, sp.height * scaleY),
          },
        }))
        batchPreviewFlatElements(changesMap)
      }
    }

    const onUp = (e) => {
      const d = dragRef.current
      if (!d) return
      // 마우스 PointerEvent의 pointerup은 mouseup이 처리(중복 방지)
      if (e && e.pointerType === 'mouse') return
      if (e && d.pointerId != null && e.pointerId != null && e.pointerId !== d.pointerId) return
      dragRef.current = null
      if (onSnapGuides) onSnapGuides([])

      const els = useFlatStore.getState().flatElements

      if (d.mode === 'move') {
        // 현재(프리뷰) 값 저장 후 원래 값으로 되돌리고 commit → undo 가능
        const newChanges = d.startPositions.map(sp => {
          const current = els.find(e => e.id === sp.id)
          if (!current || (current.x === sp.x && current.y === sp.y)) return null
          return { id: sp.id, changes: { x: current.x, y: current.y } }
        }).filter(Boolean)
        if (newChanges.length > 0) {
          // 원래 위치로 되돌리기
          const revertMap = d.startPositions.map(sp => ({
            id: sp.id, changes: { x: sp.x, y: sp.y },
          }))
          batchPreviewFlatElements(revertMap)
          batchUpdateFlatElementsIndividual(newChanges)
        }
      } else if (d.mode === 'resize') {
        const newChanges = d.startPositions.map(sp => {
          const current = els.find(e => e.id === sp.id)
          if (!current) return null
          if (current.x === sp.x && current.y === sp.y &&
              current.width === sp.width && current.height === sp.height) return null
          return {
            id: sp.id,
            changes: { x: current.x, y: current.y, width: current.width, height: current.height },
          }
        }).filter(Boolean)
        if (newChanges.length > 0) {
          // 원래 크기로 되돌리기
          const revertMap = d.startPositions.map(sp => ({
            id: sp.id, changes: { x: sp.x, y: sp.y, width: sp.width, height: sp.height },
          }))
          batchPreviewFlatElements(revertMap)
          batchUpdateFlatElementsIndividual(newChanges)
          // 폭 변경 → 코드 재줄바꿈 → 오토핏 컨테이너 높이 재계산
          useFlatStore.getState().reflowAutoFit()
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    // 터치/펜: 같은 onMove/onUp 재사용(내부에서 pointerType==='mouse'는 무시)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [scale, batchPreviewFlatElements, batchUpdateFlatElementsIndividual])

  return (
    <div
      data-export-ignore="true"
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: bbox.w,
        height: bbox.h,
        zIndex: 9999,
        cursor: movableElements.length === 0 ? 'default' : 'move',
        pointerEvents: 'auto',
        // 터치로 그룹을 끌어 이동 — 브라우저 기본 제스처(스크롤 등) 차단
        touchAction: movableElements.length === 0 ? undefined : 'none',
        border: '2px dashed rgba(99,102,241,0.6)',
      }}
      onMouseDown={handleMoveStart}
      onPointerDown={(e) => { if (e.pointerType === 'touch') handleMoveStart(e) }}
      onDoubleClick={handleDoubleClick}
    >
      {movableElements.length > 0 && GROUP_HANDLES.map(h => (
        <div
          key={h.dir}
          data-resize-handle="true"
          onMouseDown={(e) => handleResizeStart(e, h.dir)}
          onPointerDown={(e) => { if (e.pointerType === 'touch') handleResizeStart(e, h.dir) }}
          style={{
            position: 'absolute',
            left: h.x * bbox.w - GROUP_HANDLE_SIZE / 2,
            top: h.y * bbox.h - GROUP_HANDLE_SIZE / 2,
            width: GROUP_HANDLE_SIZE,
            height: GROUP_HANDLE_SIZE,
            background: '#6366f1',
            border: '1px solid #fff',
            borderRadius: 2,
            cursor: h.cursor,
            touchAction: 'none',
            zIndex: 10000,
          }}
        />
      ))}
    </div>
  )
}
