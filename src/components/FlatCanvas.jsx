import { useRef, useEffect, useCallback, useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import FlatElementRenderer from './FlatElementRenderer'
import FlatSelectionOverlay from './FlatSelectionOverlay'

/**
 * FlatCanvas
 * FlatElement 배열을 절대 배치로 렌더링하는 캔버스.
 * SlideCanvas와 동일한 스케일링 로직 사용.
 */
export default function FlatCanvas() {
  const stageRef = useRef(null)
  const [scale, setScale] = useState(1)

  const { flatElements, selectedFlatId, setSelectedFlat, canvasSize,
          removeFlatElement, updateFlatElement, undo, redo, viewMode, reExtract } = useFlatStore()
  const { currentPage, totalPages, navigatePage } = useEditorStore()

  const selectedEl = selectedFlatId
    ? flatElements.find(e => e.id === selectedFlatId)
    : null

  // 페이지 변경 시 flat 뷰 재추출 (split 모드에서만 — iframe이 살아있어야 함)
  const prevPage = useRef(currentPage)
  useEffect(() => {
    if (prevPage.current === currentPage) return
    prevPage.current = currentPage
    if (viewMode === 'split') reExtract()
  }, [currentPage, viewMode, reExtract])

  // 키보드 단축키: Delete, 화살표 이동, Ctrl+Z/Y, PageUp/PageDown
  useEffect(() => {
    const onKeyDown = (e) => {
      // input/textarea 내부에서는 무시
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      // 페이지 네비게이션 (PageUp/PageDown, 또는 요소 미선택 상태에서 좌우 화살표)
      const { selectedFlatId } = useFlatStore.getState()

      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        navigatePage(e.key === 'PageDown' ? 1 : -1)
        return
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFlatId) {
        e.preventDefault()
        removeFlatElement(selectedFlatId)
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if (e.key === 'z' && e.shiftKey)  { e.preventDefault(); redo(); return }
        if (e.key === 'y')                { e.preventDefault(); redo(); return }
      }

      // 요소 미선택 시 좌우 화살표로 페이지 이동
      if (!selectedFlatId && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        navigatePage(e.key === 'ArrowRight' ? 1 : -1)
        return
      }

      const step = e.shiftKey ? 10 : 1
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedFlatId) {
        e.preventDefault()
        const els = useFlatStore.getState().flatElements
        const el = els.find(e => e.id === selectedFlatId)
        if (!el) return
        const delta = { ArrowUp: { y: -step }, ArrowDown: { y: step }, ArrowLeft: { x: -step }, ArrowRight: { x: step } }[e.key]
        updateFlatElement(selectedFlatId, {
          x: el.x + (delta.x || 0),
          y: el.y + (delta.y || 0),
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeFlatElement, updateFlatElement, undo, redo, navigatePage])

  /** scale 재계산 */
  const recalcScale = useCallback(() => {
    if (!stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    const pad = 48
    const s = Math.min(
      (r.width - pad * 2) / canvasSize.w,
      (r.height - pad * 2) / canvasSize.h
    )
    setScale(Math.min(s, 1))
  }, [canvasSize])

  useEffect(() => {
    recalcScale()
    if (!stageRef.current) return
    const ro = new ResizeObserver(recalcScale)
    ro.observe(stageRef.current)
    return () => ro.disconnect()
  }, [recalcScale])

  const handleStageClick = useCallback(() => {
    setSelectedFlat(null)
  }, [setSelectedFlat])

  return (
    <div
      ref={stageRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: '#0f172a',
      }}
      onMouseDown={handleStageClick}
    >
      {flatElements.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: canvasSize.w,
            height: canvasSize.h,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
            boxShadow: '0 20px 80px rgba(0,0,0,0.7)',
            background: '#fff',
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            {flatElements.map(el => (
              <FlatElementRenderer
                key={el.id}
                element={el}
                isSelected={el.id === selectedFlatId}
                scale={scale}
              />
            ))}
            {selectedEl && (
              <FlatSelectionOverlay element={selectedEl} scale={scale} />
            )}
          </div>
        </div>
      )}

      {/* 페이지 인디케이터 */}
      {totalPages > 1 && flatElements.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(15,23,42,0.88)', backdropFilter: 'blur(12px)',
          borderRadius: 12, padding: '6px 16px',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 50,
        }}>
          <button
            onClick={() => navigatePage(-1)}
            disabled={currentPage <= 0}
            style={{
              background: 'none', border: 'none', color: currentPage <= 0 ? '#334155' : '#94a3b8',
              cursor: currentPage <= 0 ? 'default' : 'pointer', fontSize: 16, padding: '0 4px',
            }}
          >&#8249;</button>
          <span style={{ color: '#94a3b8', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => navigatePage(1)}
            disabled={currentPage >= totalPages - 1}
            style={{
              background: 'none', border: 'none', color: currentPage >= totalPages - 1 ? '#334155' : '#94a3b8',
              cursor: currentPage >= totalPages - 1 ? 'default' : 'pointer', fontSize: 16, padding: '0 4px',
            }}
          >&#8250;</button>
        </div>
      )}

      {flatElements.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            textAlign: 'center', color: '#64748b', fontSize: 14,
          }}>
            <p style={{ marginBottom: 4 }}>Flat 뷰에 표시할 요소가 없습니다</p>
            <p style={{ fontSize: 12, color: '#475569' }}>
              HTML 뷰에서 슬라이드를 로드한 후 Flat 뷰로 전환하세요
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
