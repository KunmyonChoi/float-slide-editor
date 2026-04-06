import { useCallback, useRef, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'

const HANDLE_SIZE = 8
const MIN_SIZE = 20

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
  const { previewFlatElement, updateFlatElement, editingFlatId, setEditingFlat } = useFlatStore()
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
    dragRef.current = {
      mode: 'move',
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: element.x,
      startY: element.y,
    }
  }, [element])

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
