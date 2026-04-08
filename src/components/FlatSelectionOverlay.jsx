import { useCallback, useRef, useEffect, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'

const HANDLE_SIZE = 8
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
export default function FlatSelectionOverlay({ element, scale }) {
  const { previewFlatElement, updateFlatElement, editingFlatId, setEditingFlat,
          setSelectedFlat, toggleSelectFlat, flatElements, canvasSize } = useFlatStore()
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
    if (editingFlatId) return // 편집 중 드래그 비활성화
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
    }
  }, [element, editingFlatId, scale, flatElements, canvasSize, setSelectedFlat, toggleSelectFlat])

  // 리사이즈 시작
  const handleResizeStart = useCallback((e, dir) => {
    if (editingFlatId) return // 편집 중 리사이즈 비활성화
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
    }
  }, [element])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return

      const dx = (e.clientX - d.startMouseX) / scale
      const dy = (e.clientY - d.startMouseY) / scale

      if (d.mode === 'move') {
        previewFlatElement(element.id, {
          x: d.startX + dx,
          y: d.startY + dy,
        })
      } else if (d.mode === 'resize') {
        let { startX: x, startY: y, startW: w, startH: h } = d
        const dir = d.dir

        if (dir.includes('e')) w = Math.max(MIN_SIZE, d.startW + dx)
        if (dir.includes('w')) { w = Math.max(MIN_SIZE, d.startW - dx); x = d.startX + (d.startW - w) }
        if (dir.includes('s')) h = Math.max(MIN_SIZE, d.startH + dy)
        if (dir.includes('n')) { h = Math.max(MIN_SIZE, d.startH - dy); y = d.startY + (d.startH - h) }

        previewFlatElement(element.id, { x, y, width: w, height: h })
      }
    }

    const onUp = () => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null

      // 현재 위치를 히스토리에 기록
      const els = useFlatStore.getState().flatElements
      const current = els.find(e => e.id === element.id)
      if (!current) return

      if (d.mode === 'move') {
        if (current.x !== d.startX || current.y !== d.startY) {
          updateFlatElement(element.id, { x: current.x, y: current.y })
        }
      } else if (d.mode === 'resize') {
        if (current.x !== d.startX || current.y !== d.startY ||
            current.width !== d.startW || current.height !== d.startH) {
          updateFlatElement(element.id, {
            x: current.x, y: current.y,
            width: current.width, height: current.height,
          })
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

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        zIndex: 9999,
        cursor: 'move',
        pointerEvents: 'auto',
      }}
      onMouseDown={handleMoveStart}
      onDoubleClick={handleDoubleClick}
    >
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

export function FlatGroupOverlay({ elements, scale }) {
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

  // 그룹 이동 시작
  const handleMoveStart = useCallback((e) => {
    if (e.target.dataset.resizeHandle) return
    e.stopPropagation()
    dragRef.current = {
      mode: 'move',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPositions: elements.map(el => ({ id: el.id, x: el.x, y: el.y })),
    }
  }, [elements])

  // 그룹 리사이즈 시작
  const handleResizeStart = useCallback((e, dir) => {
    e.stopPropagation()
    e.preventDefault()
    dragRef.current = {
      mode: 'resize',
      dir,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      bbox: { ...bbox },
      startPositions: elements.map(el => ({
        id: el.id, x: el.x, y: el.y, width: el.width, height: el.height,
      })),
    }
  }, [elements, bbox])

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current
      if (!d) return

      const dx = (e.clientX - d.startMouseX) / scale
      const dy = (e.clientY - d.startMouseY) / scale

      if (d.mode === 'move') {
        const changesMap = d.startPositions.map(sp => ({
          id: sp.id,
          changes: { x: sp.x + dx, y: sp.y + dy },
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

      const els = useFlatStore.getState().flatElements

      if (d.mode === 'move') {
        const changesMap = d.startPositions.map(sp => {
          const current = els.find(e => e.id === sp.id)
          if (!current || (current.x === sp.x && current.y === sp.y)) return null
          return { id: sp.id, changes: { x: current.x, y: current.y } }
        }).filter(Boolean)
        if (changesMap.length > 0) {
          batchUpdateFlatElementsIndividual(changesMap)
        }
      } else if (d.mode === 'resize') {
        const changesMap = d.startPositions.map(sp => {
          const current = els.find(e => e.id === sp.id)
          if (!current) return null
          if (current.x === sp.x && current.y === sp.y &&
              current.width === sp.width && current.height === sp.height) return null
          return {
            id: sp.id,
            changes: { x: current.x, y: current.y, width: current.width, height: current.height },
          }
        }).filter(Boolean)
        if (changesMap.length > 0) {
          batchUpdateFlatElementsIndividual(changesMap)
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
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: bbox.w,
        height: bbox.h,
        zIndex: 9999,
        cursor: 'move',
        pointerEvents: 'auto',
        border: '2px dashed rgba(99,102,241,0.6)',
      }}
      onMouseDown={handleMoveStart}
    >
      {GROUP_HANDLES.map(h => (
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
