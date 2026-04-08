import { useRef, useEffect, useCallback, useState } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import FlatElementRenderer from './FlatElementRenderer'
import FlatSelectionOverlay, { FlatGroupOverlay } from './FlatSelectionOverlay'
import FlatInlineEditor from './FlatInlineEditor'

/**
 * FlatCanvas
 * FlatElement 배열을 절대 배치로 렌더링하는 캔버스.
 * SlideCanvas와 동일한 스케일링 로직 사용.
 */
export default function FlatCanvas() {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [marquee, setMarquee] = useState(null)
  const marqueeRef = useRef(null) // 마키 시작 좌표 기억

  const { flatElements, selectedFlatIds, editingFlatId, setSelectedFlat, setSelectedFlats, canvasSize,
          removeSelectedElements, updateFlatElement, undo, redo, viewMode, reExtract,
          fontImports, copyElement, cutElement, pasteElement, duplicateElement, selectAllFlats,
          bringForward, sendBackward, bringToFront, sendToBack } = useFlatStore()
  const { currentPage, revealV } = useEditorStore()

  // 웹폰트를 부모 문서 <head>에 주입 — iframe 폰트와 동일하게 렌더링
  useEffect(() => {
    if (!fontImports || fontImports.length === 0) return
    const injected = []
    for (const imp of fontImports) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        // 이미 동일한 href가 있으면 스킵
        const href = urlMatch[1]
        if (document.querySelector(`link[href="${href}"]`)) continue
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.flatFont = 'true'
        document.head.appendChild(link)
        injected.push(link)
      } else if (imp.includes('@font-face')) {
        const style = document.createElement('style')
        style.textContent = imp
        style.dataset.flatFont = 'true'
        document.head.appendChild(style)
        injected.push(style)
      }
    }
    return () => { for (const el of injected) el.remove() }
  }, [fontImports])

  const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))
  const selectedEl = selectedEls.length === 1 ? selectedEls[0] : null

  // 페이지 변경 시 flat 뷰 재추출 (flat/split 모드 — iframe은 항상 마운트됨)
  // reveal.js 수직 슬라이드 변경도 감지하기 위해 revealV도 의존성에 포함
  const prevPage = useRef(`${currentPage}-${revealV}`)
  useEffect(() => {
    const key = `${currentPage}-${revealV}`
    if (prevPage.current === key) return
    prevPage.current = key
    if (viewMode === 'split' || viewMode === 'flat') reExtract(key)
  }, [currentPage, revealV, viewMode, reExtract])

  // 키보드 단축키: Delete, 화살표 이동, Ctrl+Z/Y
  // 페이지 네비게이션(PageUp/PageDown)은 PageBar에서 전역 처리
  useEffect(() => {
    const onKeyDown = (e) => {
      // Escape: 텍스트 편집 중이면 편집 종료, 아니면 선택 해제
      if (e.key === 'Escape') {
        const { editingFlatId, selectedFlatIds } = useFlatStore.getState()
        if (editingFlatId) {
          e.preventDefault()
          useFlatStore.getState().setEditingFlat(null)
        } else if (selectedFlatIds.length > 0) {
          e.preventDefault()
          setSelectedFlat(null)
        }
        return
      }

      if (useFlatStore.getState().editingFlatId) return  // 텍스트 편집 중
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.contentEditable === 'true') return

      const { selectedFlatIds } = useFlatStore.getState()
      const hasSelection = selectedFlatIds.length > 0
      const singleId = selectedFlatIds.length === 1 ? selectedFlatIds[0] : null

      // Enter → 텍스트 요소 편집 모드 진입 (단일 선택만)
      if (e.key === 'Enter' && singleId) {
        const els = useFlatStore.getState().flatElements
        const el = els.find(el => el.id === singleId)
        if (el && el.type === 'text') {
          e.preventDefault()
          useFlatStore.getState().setEditingFlat(singleId)
          return
        }
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && hasSelection) {
        e.preventDefault()
        removeSelectedElements()
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if (e.code === 'KeyZ' && e.shiftKey)  { e.preventDefault(); redo(); return }
        if (e.code === 'KeyY')                { e.preventDefault(); redo(); return }
        if (e.code === 'KeyA')                { e.preventDefault(); selectAllFlats(); return }
        if (e.code === 'KeyC' && hasSelection)  { copyElement(); return }
        if (e.code === 'KeyX' && hasSelection)  { cutElement(); return }
        if (e.code === 'KeyV')                  { pasteElement(); return }
        if (e.code === 'KeyD' && hasSelection)  { e.preventDefault(); duplicateElement(); return }
        // z-순서: 단일 선택만
        if (e.code === 'BracketRight' && !e.shiftKey && singleId) { bringForward(singleId); return }
        if (e.code === 'BracketLeft' && !e.shiftKey && singleId)  { sendBackward(singleId); return }
        if (e.code === 'BracketRight' && e.shiftKey && singleId)  { bringToFront(singleId); return }
        if (e.code === 'BracketLeft' && e.shiftKey && singleId)   { sendToBack(singleId); return }
      }

      // 화살표 이동 — 다중 선택 지원
      const step = e.shiftKey ? 10 : 1
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && hasSelection) {
        e.preventDefault()
        const delta = { ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step }, ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 } }[e.key]
        if (selectedFlatIds.length === 1) {
          const els = useFlatStore.getState().flatElements
          const el = els.find(el => el.id === singleId)
          if (el) updateFlatElement(singleId, { x: el.x + delta.x, y: el.y + delta.y })
        } else {
          const els = useFlatStore.getState().flatElements
          const changesMap = selectedFlatIds.map(id => {
            const el = els.find(el => el.id === id)
            return el ? { id, changes: { x: el.x + delta.x, y: el.y + delta.y } } : null
          }).filter(Boolean)
          if (changesMap.length > 0) {
            useFlatStore.getState().batchUpdateFlatElementsIndividual(changesMap)
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [removeSelectedElements, updateFlatElement, undo, redo, copyElement, cutElement, pasteElement, duplicateElement, selectAllFlats, bringForward, sendBackward, bringToFront, sendToBack])

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

  // 마키 선택: mousedown → mousemove → mouseup
  // 배경 요소는 stopPropagation 안 하므로 여기까지 버블링됨
  // 선택 해제는 mouseup에서 판단 (드래그 없고 배경도 안 눌렸으면 해제)
  const handleStageMouseDown = useCallback((e) => {
    if (useFlatStore.getState().editingFlatId) return
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / scale
    const sy = (e.clientY - rect.top) / scale

    e.preventDefault() // 브라우저 텍스트 선택 방지
    marqueeRef.current = { startX: sx, startY: sy, rect, shiftKey: e.shiftKey }
    setMarquee({ startX: sx, startY: sy, endX: sx, endY: sy })
  }, [scale])

  useEffect(() => {
    const onMove = (e) => {
      if (!marqueeRef.current) return
      const { startX, startY, rect } = marqueeRef.current
      const endX = (e.clientX - rect.left) / scale
      const endY = (e.clientY - rect.top) / scale
      setMarquee({ startX, startY, endX, endY })
    }
    const onUp = () => {
      if (!marqueeRef.current) return
      const { shiftKey } = marqueeRef.current
      marqueeRef.current = null
      // 마키 영역 계산
      setMarquee(prev => {
        if (!prev) return null
        const x1 = Math.min(prev.startX, prev.endX)
        const y1 = Math.min(prev.startY, prev.endY)
        const x2 = Math.max(prev.startX, prev.endX)
        const y2 = Math.max(prev.startY, prev.endY)
        // 최소 크기 이하면 단순 클릭 (배경 click 이벤트가 처리)
        if (x2 - x1 < 3 && y2 - y1 < 3) return null

        // 실제 마키 드래그 발생 → 배경 click 무시 플래그 설정
        useFlatStore.setState({ _skipBgClick: true })
        requestAnimationFrame(() => useFlatStore.setState({ _skipBgClick: false }))

        // 완전 포함된 요소만 선택 (PPT 방식) + 배경 제외
        const els = useFlatStore.getState().flatElements
        const cs = useFlatStore.getState().canvasSize
        const hits = els.filter(el => {
          // 전체 캔버스 배경 제외
          if (el.type === 'shape' && !el.content
            && Math.abs(el.width - cs.w) < 2 && Math.abs(el.height - cs.h) < 2
            && Math.abs(el.x) < 2 && Math.abs(el.y) < 2) return false
          // 요소가 마키 영역 안에 완전히 포함되어야 선택
          return el.x >= x1 && el.y >= y1 && el.x + el.width <= x2 && el.y + el.height <= y2
        }).map(el => el.id)
        if (hits.length > 0) {
          useFlatStore.getState().setSelectedFlats(hits)
        } else if (!shiftKey) {
          useFlatStore.getState().setSelectedFlat(null)
        }
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [scale])

  // 캔버스 바깥 (회색 영역) 클릭 시 선택 해제
  const handleOuterClick = useCallback((e) => {
    // canvasRef 내부 클릭이면 무시 (마키 핸들러가 처리)
    if (canvasRef.current && canvasRef.current.contains(e.target)) return
    if (useFlatStore.getState().editingFlatId) return
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
      onMouseDown={handleOuterClick}
    >
      {flatElements.length > 0 && (
        <div
          ref={canvasRef}
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
          onMouseDown={handleStageMouseDown}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            {flatElements.map(el => (
              <FlatElementRenderer
                key={el.id}
                element={el}
                isSelected={selectedFlatIds.includes(el.id)}
                isEditing={el.id === editingFlatId}
                scale={scale}
              />
            ))}
            {selectedEls.length === 1 && selectedEl && (
              <FlatSelectionOverlay element={selectedEl} scale={scale} />
            )}
            {selectedEls.length > 1 && (
              <FlatGroupOverlay elements={selectedEls} scale={scale} />
            )}
            {editingFlatId && flatElements.find(e => e.id === editingFlatId) && (
              <FlatInlineEditor
                element={flatElements.find(e => e.id === editingFlatId)}
              />
            )}
            {/* 마키 선택 영역 */}
            {marquee && (
              <div style={{
                position: 'absolute',
                left: Math.min(marquee.startX, marquee.endX),
                top: Math.min(marquee.startY, marquee.endY),
                width: Math.abs(marquee.endX - marquee.startX),
                height: Math.abs(marquee.endY - marquee.startY),
                border: '1px dashed rgba(99,102,241,0.6)',
                background: 'rgba(99,102,241,0.08)',
                pointerEvents: 'none',
                zIndex: 9998,
              }} />
            )}
          </div>
        </div>
      )}

      {/* 페이지 인디케이터 — App.jsx의 공통 PageBar로 이동됨 */}

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
