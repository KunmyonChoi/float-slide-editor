import { useCallback, useRef, useEffect, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { computeSnapGuides, computeResizeSnapGuides } from '../core/SnapEngine'
import { computeRotationAngle, snapRotation, normalizeAngle, canvasDeltaToLocal } from '../core/RotationUtils'

const HANDLE_SIZE = 8
const ROTATE_HANDLE_OFFSET = 30
const MIN_SIZE = 20
const GROUP_HANDLE_SIZE = 8

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
  const dragRef = useRef(null)

  // 더블클릭 → 텍스트 편집 모드 진입
  const handleDoubleClick = useCallback((e) => {
    if (element.type === 'text') {
      e.stopPropagation()
      setEditingFlat(element.id)
    }
  }, [element.id, element.type, setEditingFlat])

  // 드래그 이동
  const handleMoveStart = useCallback((e) => {
    if (editingFlatId) return
    if (element.locked) return // 잠금 요소 이동 차단
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
    }
  }, [element, editingFlatId, scale, flatElements, canvasSize, otherRects, setSelectedFlat, toggleSelectFlat])

  // 리사이즈 시작
  const handleResizeStart = useCallback((e, dir) => {
    if (editingFlatId || element.locked) return
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
    }
  }, [element, otherRects])

  // 회전 시작
  const handleRotateStart = useCallback((e) => {
    if (editingFlatId || element.locked) return
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'rotate',
      startRotation: element.rotation || 0,
      cx: element.x + element.width / 2,
      cy: element.y + element.height / 2,
    }
  }, [element, editingFlatId])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return

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
        // 스냅 가이드 계산
        if (d.otherRects && onSnapGuides) {
          const snap = computeSnapGuides(
            { x: px, y: py, width: element.width, height: element.height },
            d.otherRects, canvasSize
          )
          if (snap.snappedX !== null) px = snap.snappedX
          if (snap.snappedY !== null) py = snap.snappedY
          onSnapGuides(snap.guides)
        }
        previewFlatElement(element.id, { x: px, y: py })
      } else if (d.mode === 'resize') {
        let w = d.startW, h = d.startH
        const dir = d.dir

        // 회전된 요소: 마우스 delta를 로컬 좌표로 변환
        const rot = d.startRotation || 0
        const { dx: ldx, dy: ldy } = rot ? canvasDeltaToLocal(dx, dy, rot) : { dx, dy }

        if (dir.includes('e')) w = Math.max(MIN_SIZE, d.startW + ldx)
        if (dir.includes('w')) w = Math.max(MIN_SIZE, d.startW - ldx)
        if (dir.includes('s')) h = Math.max(MIN_SIZE, d.startH + ldy)
        if (dir.includes('n')) h = Math.max(MIN_SIZE, d.startH - ldy)

        // 앵커 포인트(드래그 반대편) 기준으로 중심점 보정
        // 비회전 시에도 동일 공식 적용 (cos0=1, sin0=0 → 기존 로직과 동일)
        let dax = 0, day = 0
        if (dir.includes('e')) dax = (w - d.startW) / 2
        if (dir.includes('w')) dax = (d.startW - w) / 2
        if (dir.includes('s')) day = (h - d.startH) / 2
        if (dir.includes('n')) day = (d.startH - h) / 2

        const rad = rot * Math.PI / 180
        const cosR = Math.cos(rad), sinR = Math.sin(rad)
        const startCX = d.startX + d.startW / 2
        const startCY = d.startY + d.startH / 2
        let x = startCX + dax * cosR - day * sinR - w / 2
        let y = startCY + dax * sinR + day * cosR - h / 2

        // 리사이즈 스냅 (비회전 시만)
        if (!rot && d.otherRects && onSnapGuides) {
          const snap = computeResizeSnapGuides(
            { x, y, width: w, height: h }, dir, d.otherRects, canvasSize
          )
          x = snap.x; y = snap.y; w = snap.width; h = snap.height
          onSnapGuides(snap.guides)
        }

        previewFlatElement(element.id, { x, y, width: w, height: h })
      }
    }

    const onUp = () => {
      const d = dragRef.current
      if (!d) return
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
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [element.id, scale, previewFlatElement, updateFlatElement])

  const { x, y, width, height, zIndex } = element
  const rot = element.rotation || 0
  const locked = element.locked

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
        pointerEvents: locked ? 'none' : 'auto',
        transform: rot ? `rotate(${rot}deg)` : undefined,
        transformOrigin: rot ? 'center center' : undefined,
      }}
      onMouseDown={handleMoveStart}
      onDoubleClick={handleDoubleClick}
    >
      {!locked && (
        <>
          {/* 회전 핸들 */}
          <div
            data-resize-handle="true"
            onMouseDown={handleRotateStart}
            style={{
              position: 'absolute',
              left: width / 2 - 5,
              top: -ROTATE_HANDLE_OFFSET,
              width: 10,
              height: 10,
              background: '#6366f1',
              border: '1.5px solid #fff',
              borderRadius: '50%',
              cursor: 'grab',
              zIndex: 10001,
            }}
          />
          {/* 회전 핸들 연결선 */}
          <div style={{
            position: 'absolute',
            left: width / 2,
            top: -(ROTATE_HANDLE_OFFSET - 10),
            width: 1,
            height: ROTATE_HANDLE_OFFSET - 10,
            background: 'rgba(99,102,241,0.5)',
            pointerEvents: 'none',
          }} />
          {/* 리사이즈 핸들 */}
          {HANDLES.map(h => (
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
          ))}
        </>
      )}
      {locked && (
        /* 잠금 아이콘 */
        <div style={{
          position: 'absolute',
          top: -20,
          left: width / 2 - 8,
          fontSize: 12,
          color: '#94a3b8',
          pointerEvents: 'none',
        }}>🔒</div>
      )}
    </div>
  )
}

// ── 그룹 바운딩 박스 오버레이 ────────────────────────

const GROUP_HANDLES = [
  { dir: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { dir: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { dir: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { dir: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
]

export function FlatGroupOverlay({ elements, scale, otherRects, canvasSize, onSnapGuides }) {
  const { batchPreviewFlatElements, batchUpdateFlatElementsIndividual } = useFlatStore()
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
    }
  }, [movableElements, bbox, otherRects])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return

      const dx = (e.clientX - d.startMouseX) / scale
      const dy = (e.clientY - d.startMouseY) / scale

      if (d.mode === 'move') {
        let bx = d.bbox.x + dx
        let by = d.bbox.y + dy
        let snapDx = 0, snapDy = 0
        // 그룹 bbox 기준 스냅
        if (d.otherRects && onSnapGuides) {
          const snap = computeSnapGuides(
            { x: bx, y: by, width: d.bbox.w, height: d.bbox.h },
            d.otherRects, canvasSize
          )
          if (snap.snappedX !== null) snapDx = snap.snappedX - bx
          if (snap.snappedY !== null) snapDy = snap.snappedY - by
          onSnapGuides(snap.guides)
        }
        const changesMap = d.startPositions.map(sp => ({
          id: sp.id,
          changes: { x: sp.x + dx + snapDx, y: sp.y + dy + snapDy },
        }))
        batchPreviewFlatElements(changesMap)
      } else if (d.mode === 'resize') {
        const { bbox: origBbox, dir, startPositions } = d
        let newX = origBbox.x, newY = origBbox.y
        let newW = origBbox.w, newH = origBbox.h

        if (dir.includes('e')) newW = Math.max(MIN_SIZE, origBbox.w + dx)
        if (dir.includes('w')) { newW = Math.max(MIN_SIZE, origBbox.w - dx); newX = origBbox.x + (origBbox.w - newW) }
        if (dir.includes('s')) newH = Math.max(MIN_SIZE, origBbox.h + dy)
        if (dir.includes('n')) { newH = Math.max(MIN_SIZE, origBbox.h - dy); newY = origBbox.y + (origBbox.h - newH) }

        // 그룹 리사이즈 스냅
        if (d.otherRects && onSnapGuides) {
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

    const onUp = () => {
      const d = dragRef.current
      if (!d) return
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
        }
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
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
        border: '2px dashed rgba(99,102,241,0.6)',
      }}
      onMouseDown={handleMoveStart}
    >
      {movableElements.length > 0 && GROUP_HANDLES.map(h => (
        <div
          key={h.dir}
          data-resize-handle="true"
          onMouseDown={(e) => handleResizeStart(e, h.dir)}
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
            zIndex: 10000,
          }}
        />
      ))}
    </div>
  )
}
