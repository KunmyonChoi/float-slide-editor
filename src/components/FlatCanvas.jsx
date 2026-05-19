import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { isBackgroundElement } from '../core/SnapEngine'
import { getRotatedAABB } from '../core/RotationUtils'
import FlatElementRenderer from './FlatElementRenderer'
import FlatSelectionOverlay, { FlatGroupOverlay } from './FlatSelectionOverlay'
import FlatInlineEditor from './FlatInlineEditor'
import FlatContextMenu from './FlatContextMenu'
import ImageCropOverlay from './ImageCropOverlay'
import { nextFlatId } from '../core/FlatExtractor'

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
  const [contextMenu, setContextMenu] = useState(null)
  const [snapGuides, setSnapGuides] = useState([])

  const { flatElements, selectedFlatIds, editingFlatId, croppingFlatId, setSelectedFlat, setSelectedFlats, canvasSize,
          removeSelectedElements, updateFlatElement, undo, redo, viewMode, reExtract,
          fontImports, copyElement, cutElement, pasteElement, duplicateElement, selectAllFlats,
          bringForward, sendBackward, bringToFront, sendToBack, setCroppingFlat,
          addFlatElement, setCanvasRef, preloadProgress } = useFlatStore()
  const [dragOver, setDragOver] = useState(false)
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

  // canvasRef를 store에 노출 (이미지 내보내기용)
  useEffect(() => {
    setCanvasRef(canvasRef)
    return () => setCanvasRef(null)
  }, [setCanvasRef])

  const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))
  const selectedEl = selectedEls.length === 1 ? selectedEls[0] : null

  // 이미지 data URL로 요소 생성 + 추가
  const insertImageFromDataUrl = useCallback((dataUrl, dropX, dropY) => {
    const img = new Image()
    img.onload = () => {
      let w = img.width, h = img.height
      const maxW = canvasSize.w * 0.6, maxH = canvasSize.h * 0.6
      if (w > maxW || h > maxH) {
        const ratio = Math.min(maxW / w, maxH / h)
        w = Math.round(w * ratio)
        h = Math.round(h * ratio)
      }
      // 드롭 위치가 주어지면 그 위치 중심, 아니면 캔버스 중앙
      const cx = dropX ?? canvasSize.w / 2
      const cy = dropY ?? canvasSize.h / 2
      let ex = cx - w / 2, ey = cy - h / 2
      ex = Math.max(0, Math.min(ex, canvasSize.w - w))
      ey = Math.max(0, Math.min(ey, canvasSize.h - h))
      const maxZ = useFlatStore.getState().flatElements.length > 0
        ? Math.max(...useFlatStore.getState().flatElements.map(e => e.zIndex)) : 0
      const el = {
        id: nextFlatId(), sourceId: null,
        type: 'image', width: w, height: h,
        content: dataUrl, isRich: false, merged: false,
        styles: {
          backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
          borderRadius: '0px', border: '0px none', boxShadow: 'none',
          opacity: '1', objectFit: 'cover',
        },
        x: ex, y: ey, zIndex: maxZ + 1,
      }
      addFlatElement(el)
      useFlatStore.getState().setSelectedFlat(el.id)
    }
    img.src = dataUrl
  }, [canvasSize, addFlatElement])

  // 파일 → data URL 변환 후 삽입
  const insertImageFromFile = useCallback((file, dropX, dropY) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (ev) => insertImageFromDataUrl(ev.target.result, dropX, dropY)
    reader.readAsDataURL(file)
  }, [insertImageFromDataUrl])

  // 드래그 앤 드롭
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    // 드롭 위치를 캔버스 좌표로 변환
    let dropX, dropY
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      dropX = (e.clientX - rect.left) / scale
      dropY = (e.clientY - rect.top) / scale
    }
    for (const file of files) insertImageFromFile(file, dropX, dropY)
  }, [scale, insertImageFromFile])

  // 클립보드 붙여넣기 (이미지)
  useEffect(() => {
    const onPaste = (e) => {
      // 텍스트 편집 중이면 무시
      if (useFlatStore.getState().editingFlatId) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.contentEditable === 'true') return

      const items = [...(e.clipboardData?.items || [])]
      const imageItem = items.find(i => i.type.startsWith('image/'))
      if (imageItem) {
        e.preventDefault()
        const file = imageItem.getAsFile()
        if (file) insertImageFromFile(file)
        return
      }
      // 이미지가 아니면 기존 요소 붙여넣기가 처리
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [insertImageFromFile])

  // 스냅 대상: 비선택 + 비배경 요소들의 rect (회전 시 AABB 사용)
  const otherRects = useMemo(() =>
    flatElements
      .filter(e => !selectedFlatIds.includes(e.id) && !isBackgroundElement(e, canvasSize))
      .map(e => e.rotation ? getRotatedAABB(e.x, e.y, e.width, e.height, e.rotation)
                           : { x: e.x, y: e.y, width: e.width, height: e.height }),
    [flatElements, selectedFlatIds, canvasSize]
  )

  // 페이지 변경 시 flat 뷰 재추출 (flat/split 모드 — iframe은 항상 마운트됨)
  // reveal.js 수직 슬라이드 변경도 감지하기 위해 revealV도 의존성에 포함
  const prevPage = useRef(`${currentPage}-${revealV}`)
  useEffect(() => {
    const key = `${currentPage}-${revealV}`
    if (prevPage.current === key) return
    prevPage.current = key
    if (viewMode === 'split' || viewMode === 'flat') reExtract(key)
  }, [currentPage, revealV, viewMode, reExtract])

  // 첫 추출 완료 후 모든 페이지를 백그라운드 프리로드
  const preloadDone = useRef(false)
  useEffect(() => {
    if (preloadDone.current || flatElements.length === 0) return
    preloadDone.current = true
    // 현재 페이지 렌더링 후 프리로드 시작
    const timer = setTimeout(() => {
      useFlatStore.getState().preloadAllPages()
    }, 300)
    return () => clearTimeout(timer)
  }, [flatElements.length])

  // 키보드 단축키: Delete, 화살표 이동, Ctrl+Z/Y
  // 페이지 네비게이션(PageUp/PageDown)은 PageBar에서 전역 처리
  useEffect(() => {
    const onKeyDown = (e) => {
      // Escape: 크롭 모드 → 편집 종료 → 선택 해제
      if (e.key === 'Escape') {
        const { croppingFlatId, editingFlatId, selectedFlatIds } = useFlatStore.getState()
        if (croppingFlatId) {
          // ImageCropOverlay의 keydown 핸들러가 처리 (capture phase)
          return
        }
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

      // Enter → 텍스트/도형 편집 모드 진입 (단일 선택만)
      if (e.key === 'Enter' && singleId) {
        const els = useFlatStore.getState().flatElements
        const el = els.find(el => el.id === singleId)
        if (el && (el.type === 'text' || el.type === 'shape')) {
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

      // F5 → 발표 모드
      if (e.key === 'F5') {
        e.preventDefault()
        useEditorStore.getState().enterPresentation()
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

        // ── 텍스트 서식 단축키 (선택된 text 요소에 적용) ──
        if (hasSelection) {
          const els = useFlatStore.getState().flatElements
          const textEls = selectedFlatIds
            .map(id => els.find(el => el.id === id))
            .filter(el => el && (el.type === 'text' || (el.type === 'shape' && el.content)))

          if (textEls.length > 0) {
            // Ctrl+B — 굵게 토글
            if (e.code === 'KeyB') {
              e.preventDefault()
              for (const el of textEls) {
                const isBold = parseInt(el.styles?.fontWeight || '400') >= 700
                updateFlatElement(el.id, { styles: { fontWeight: isBold ? '400' : '700' } })
              }
              return
            }
            // Ctrl+I — 이탈릭 토글
            if (e.code === 'KeyI') {
              e.preventDefault()
              for (const el of textEls) {
                const isItalic = el.styles?.fontStyle === 'italic'
                updateFlatElement(el.id, { styles: { fontStyle: isItalic ? 'normal' : 'italic' } })
              }
              return
            }
            // Ctrl+U — 밑줄 토글
            if (e.code === 'KeyU') {
              e.preventDefault()
              for (const el of textEls) {
                const hasUnderline = (el.styles?.textDecoration || '').includes('underline')
                updateFlatElement(el.id, { styles: { textDecoration: hasUnderline ? 'none' : 'underline' } })
              }
              return
            }
            // Ctrl+Shift+> (.) — 폰트 크기 +2px
            if (e.shiftKey && (e.code === 'Period')) {
              e.preventDefault()
              for (const el of textEls) {
                const cur = parseFloat(el.styles?.fontSize || '16')
                updateFlatElement(el.id, { styles: { fontSize: `${cur + 2}px` } })
              }
              return
            }
            // Ctrl+Shift+< (,) — 폰트 크기 -2px (최소 8px)
            if (e.shiftKey && (e.code === 'Comma')) {
              e.preventDefault()
              for (const el of textEls) {
                const cur = parseFloat(el.styles?.fontSize || '16')
                updateFlatElement(el.id, { styles: { fontSize: `${Math.max(8, cur - 2)}px` } })
              }
              return
            }
          }
        }
      }

      // 화살표 이동 — 다중 선택 지원 (잠금 요소 제외)
      const step = e.shiftKey ? 10 : 1
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && hasSelection) {
        e.preventDefault()
        const delta = { ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step }, ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 } }[e.key]
        if (selectedFlatIds.length === 1) {
          const els = useFlatStore.getState().flatElements
          const el = els.find(el => el.id === singleId)
          if (el && !el.locked) updateFlatElement(singleId, { x: el.x + delta.x, y: el.y + delta.y })
        } else {
          const els = useFlatStore.getState().flatElements
          const changesMap = selectedFlatIds.map(id => {
            const el = els.find(el => el.id === id)
            return el && !el.locked ? { id, changes: { x: el.x + delta.x, y: el.y + delta.y } } : null
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
    if (e.button === 2) return // 우클릭은 컨텍스트 메뉴가 처리
    setContextMenu(null) // 좌클릭 시 컨텍스트 메뉴 닫기
    if (useFlatStore.getState().editingFlatId || useFlatStore.getState().croppingFlatId) return
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
    if (e.button === 2) return // 우클릭은 컨텍스트 메뉴가 처리
    setContextMenu(null) // 좌클릭 시 컨텍스트 메뉴 닫기
    // canvasRef 내부 클릭이면 무시 (마키 핸들러가 처리)
    if (canvasRef.current && canvasRef.current.contains(e.target)) return
    if (useFlatStore.getState().editingFlatId) return
    if (useFlatStore.getState().croppingFlatId) {
      setCroppingFlat(null)
      return
    }
    setSelectedFlat(null)
  }, [setSelectedFlat, setCroppingFlat])

  // 우클릭 컨텍스트 메뉴
  const handleContextMenu = useCallback((e) => {
    e.preventDefault()
    if (!stageRef.current) return
    const stageRect = stageRef.current.getBoundingClientRect()
    const menuX = e.clientX - stageRect.left
    const menuY = e.clientY - stageRect.top
    let cx = canvasSize.w / 2, cy = canvasSize.h / 2
    if (canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect()
      cx = (e.clientX - canvasRect.left) / scale
      cy = (e.clientY - canvasRect.top) / scale
    }
    setContextMenu({ x: menuX, y: menuY, canvasX: cx, canvasY: cy })
  }, [scale, canvasSize])

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
      onContextMenu={handleContextMenu}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
          <div data-flat-canvas="true" style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none' }}>
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
              <FlatSelectionOverlay element={selectedEl} scale={scale}
                otherRects={otherRects} canvasSize={canvasSize} onSnapGuides={setSnapGuides} />
            )}
            {selectedEls.length > 1 && (
              <FlatGroupOverlay elements={selectedEls} scale={scale}
                otherRects={otherRects} canvasSize={canvasSize} onSnapGuides={setSnapGuides} />
            )}
            {/* 스냅 가이드 */}
            {snapGuides.map((g, i) => (
              <div key={i} data-export-ignore="true" style={{
                position: 'absolute',
                ...(g.orientation === 'v'
                  ? { left: g.position, top: 0, width: 1, height: '100%' }
                  : { top: g.position, left: 0, height: 1, width: '100%' }),
                background: '#ff2d55',
                pointerEvents: 'none',
                zIndex: 9997,
              }} />
            ))}
            {editingFlatId && flatElements.find(e => e.id === editingFlatId) && (
              <FlatInlineEditor
                element={flatElements.find(e => e.id === editingFlatId)}
              />
            )}
            {croppingFlatId && flatElements.find(e => e.id === croppingFlatId) && (
              <ImageCropOverlay
                element={flatElements.find(e => e.id === croppingFlatId)}
                scale={scale}
              />
            )}
            {/* 마키 선택 영역 */}
            {marquee && (
              <div data-export-ignore="true" style={{
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

      {/* 드래그 앤 드롭 오버레이 */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(99, 102, 241, 0.1)',
          border: '3px dashed rgba(99, 102, 241, 0.5)',
          borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, pointerEvents: 'none',
        }}>
          <div style={{
            background: 'rgba(15, 23, 42, 0.9)', color: '#a5b4fc',
            padding: '12px 24px', borderRadius: 8, fontSize: 14,
          }}>
            이미지를 여기에 놓으세요
          </div>
        </div>
      )}

      {contextMenu && (
        <FlatContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canvasX={contextMenu.canvasX}
          canvasY={contextMenu.canvasY}
          onClose={() => setContextMenu(null)}
        />
      )}

      {flatElements.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            <p style={{ marginBottom: 4 }}>
              {preloadProgress
                ? `변환 중... (${preloadProgress.current}/${preloadProgress.total})`
                : 'HTML 슬라이드를 로드하면 자동으로 변환됩니다'}
            </p>
            {preloadProgress && (
              <div style={{ width: 200, height: 4, background: '#1e293b', borderRadius: 2, margin: '8px auto' }}>
                <div style={{
                  width: `${Math.round((preloadProgress.current / preloadProgress.total) * 100)}%`,
                  height: '100%', background: '#3b82f6', borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 프리로드 진행 오버레이 — 인터랙션 차단 */}
      {preloadProgress && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 200,
          background: 'rgba(15,23,42,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(2px)',
        }}>
          <div style={{
            background: 'rgba(15,23,42,0.95)', padding: '20px 32px', borderRadius: 10,
            textAlign: 'center', color: '#e2e8f0',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <p style={{ fontSize: 14, marginBottom: 8 }}>
              슬라이드 변환 중... ({preloadProgress.current}/{preloadProgress.total})
            </p>
            <div style={{ width: 200, height: 4, background: '#1e293b', borderRadius: 2 }}>
              <div style={{
                width: `${Math.round((preloadProgress.current / preloadProgress.total) * 100)}%`,
                height: '100%', background: '#3b82f6', borderRadius: 2,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <p style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
              모든 페이지를 변환하고 있습니다
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
