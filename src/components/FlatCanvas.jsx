import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useFlatStore, isBackgroundLayer } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { isBackgroundElement } from '../core/SnapEngine'
import { getRotatedAABB } from '../core/RotationUtils'
import FlatElementRenderer from './FlatElementRenderer'
import FlatSelectionOverlay, { FlatGroupOverlay } from './FlatSelectionOverlay'
import FlatAiBar from './FlatAiBar'
import FlatImageAiBar from './FlatImageAiBar'
import FlatSelectionAiBar from './FlatSelectionAiBar'
import FlatInlineEditor from './FlatInlineEditor'
import FlatTableEditor from './FlatTableEditor'
import FlatContextMenu from './FlatContextMenu'
import ImageCropOverlay from './ImageCropOverlay'
import { nextFlatId, isFontUrl } from '../core/FlatExtractor'
import { pointsToBBox, absoluteToRelativePoints, pointsToSvgPath } from '../core/PolyShapeUtils'
import { confirmDialog } from './ConfirmDialog'
import { bumpFontSizePx } from '../core/TextStyleScope'

/**
 * FlatCanvas
 * FlatElement 배열을 절대 배치로 렌더링하는 캔버스.
 * SlideCanvas와 동일한 스케일링 로직 사용.
 */
export default function FlatCanvas() {
  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })  // 줌 초과 시 화면 px 오프셋
  const fitScaleRef = useRef(1)        // 현재 '맞춤' 스케일
  const fitModeRef = useRef(true)      // true면 리사이즈 시 자동 맞춤 유지
  const spaceDownRef = useRef(false)   // 스페이스 누름(팬 모드)
  const panDragRef = useRef(null)      // 스페이스+드래그 팬 진행 상태
  const [marquee, setMarquee] = useState(null)
  const marqueeRef = useRef(null) // 마키 시작 좌표 기억
  const [contextMenu, setContextMenu] = useState(null)
  const [snapGuides, setSnapGuides] = useState([])

  const { flatElements, selectedFlatIds, editingFlatId, croppingFlatId, setSelectedFlat, setSelectedFlats, canvasSize,
          removeSelectedElements, updateFlatElement, undo, redo, viewMode, reExtract,
          copyElement, cutElement, pasteElement, duplicateElement, selectAllFlats,
          bringForward, sendBackward, bringToFront, sendToBack, setCroppingFlat,
          addFlatElement, setCanvasRef, preloadProgress, drawMode, setDrawMode, flatPageCount } = useFlatStore()
  const [dragOver, setDragOver] = useState(false)
  const [drawPoints, setDrawPoints] = useState([])     // 그리기 중 확정된 점들
  const [drawPreview, setDrawPreview] = useState(null)  // 마우스 위치 (프리뷰용)
  const { currentPage, revealV, mode } = useEditorStore()

  // 웹폰트를 부모 문서 <head>에 **합집합·영속**으로 주입 — 모든 페이지의 폰트를 한 번에
  // 넣고 제거하지 않는다. (현재 페이지 fontImports에 묶어 제거→재주입하면, 페이지 전환 시
  // 비현재 썸네일이 폰트를 잃어 모양이 달라지고 깜빡임(움찔)이 생긴다.)
  // 덱 교체 시에는 editorStore._injectDeckStylesheets가 data-flat-font를 정리한다.
  const allFonts = useFlatStore.getState().getAllFontImports()
  const allFontKey = allFonts.join('\n')
  useEffect(() => {
    for (const imp of allFonts) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        const href = urlMatch[1]
        if (!isFontUrl(href)) continue // 폰트 URL만(비폰트 차단)
        const exists = [...document.querySelectorAll('link[data-flat-font]')].some(l => l.getAttribute('href') === href)
        if (exists) continue
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.flatFont = 'true'
        document.head.appendChild(link)
      } else if (imp.includes('@font-face')) {
        const exists = [...document.querySelectorAll('style[data-flat-font]')].some(s => s.textContent === imp)
        if (exists) continue
        const style = document.createElement('style')
        style.textContent = imp
        style.dataset.flatFont = 'true'
        document.head.appendChild(style)
      }
    }
    // 제거 없음(영속) — 덱 교체 시 일괄 정리
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFontKey])

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
          opacity: '1', objectFit: 'contain',
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

  // 비디오 파일 → IndexedDB + 요소 삽입
  const insertVideoFromFile = useCallback(async (file, dropX, dropY) => {
    if (!file.type.startsWith('video/')) return
    const { BlobStore } = await import('../core/BlobStore')
    const key = await BlobStore.put(file)
    const blobUrl = await BlobStore.getUrl(key)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = blobUrl
    await new Promise(r => { video.onloadedmetadata = r; video.onerror = r })
    let w = video.videoWidth || 560
    let h = video.videoHeight || 315
    const maxW = canvasSize.w * 0.6, maxH = canvasSize.h * 0.6
    if (w > maxW || h > maxH) {
      const ratio = Math.min(maxW / w, maxH / h)
      w = Math.round(w * ratio); h = Math.round(h * ratio)
    }
    const maxZ = flatElements.length > 0 ? Math.max(...flatElements.map(el => el.zIndex)) : 0
    const x = dropX != null ? Math.max(0, Math.min(dropX - w / 2, canvasSize.w - w)) : (canvasSize.w - w) / 2
    const y = dropY != null ? Math.max(0, Math.min(dropY - h / 2, canvasSize.h - h)) : (canvasSize.h - h) / 2
    const el = {
      id: nextFlatId(), sourceId: null,
      type: 'video', width: w, height: h,
      content: BlobStore.toRef(key),
      isRich: false, merged: false,
      x: Math.round(x), y: Math.round(y),
      zIndex: maxZ + 1,
      styles: { backgroundColor: 'rgba(0,0,0,0)', borderRadius: '8px', opacity: '1' },
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [canvasSize, flatElements, addFlatElement, setSelectedFlat])

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
    const allFiles = [...e.dataTransfer.files]

    // HTML 슬라이드 파일 드롭 → 덱 불러오기(가져오기와 동일)
    const htmlFile = allFiles.find(f => f.type === 'text/html' || /\.html?$/i.test(f.name))
    if (htmlFile) {
      ;(async () => {
        const hasContent = useFlatStore.getState().flatElements.length > 0 || useFlatStore.getState().flatPageCount > 1
        if (hasContent) {
          const ok = await confirmDialog({
            title: 'HTML 슬라이드 불러오기',
            message: '드롭한 HTML 슬라이드로 현재 작업이 대체됩니다.\n저장하지 않았다면 먼저 저장하세요. 계속할까요?',
            confirmText: '불러오기', cancelText: '취소', danger: true,
          })
          if (!ok) return
        }
        const text = await htmlFile.text()
        useFlatStore.getState().clearPageCache()
        useEditorStore.getState().loadHtml(text, { imported: true })
      })()
      return
    }

    const images = allFiles.filter(f => f.type.startsWith('image/'))
    const videos = allFiles.filter(f => f.type.startsWith('video/'))
    if (images.length === 0 && videos.length === 0) return
    // 드롭 위치를 캔버스 좌표로 변환
    let dropX, dropY
    if (canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      dropX = (e.clientX - rect.left) / scale
      dropY = (e.clientY - rect.top) / scale
    }
    for (const file of images) insertImageFromFile(file, dropX, dropY)
    for (const file of videos) insertVideoFromFile(file, dropX, dropY)
  }, [scale, insertImageFromFile, insertVideoFromFile])

  // ── 그리기 모드 ──
  const finalizeDraw = useCallback((allPoints) => {
    if (allPoints.length < 2) { setDrawPoints([]); setDrawPreview(null); setDrawMode(null); return }
    const dm = useFlatStore.getState().drawMode
    const bbox = pointsToBBox(allPoints)
    // padding for stroke visibility
    const pad = 4
    const adjBbox = { x: bbox.x - pad, y: bbox.y - pad, width: bbox.width + pad * 2, height: bbox.height + pad * 2 }
    const relPoints = allPoints.map(p => ({ x: p.x - adjBbox.x, y: p.y - adjBbox.y }))
    const closed = dm === 'polygon'
    const maxZ = flatElements.length > 0 ? Math.max(...flatElements.map(e => e.zIndex)) : 0
    const el = {
      id: nextFlatId(), sourceId: null,
      type: 'shape', shapeType: dm === 'line' ? 'line' : dm,
      x: adjBbox.x, y: adjBbox.y,
      width: adjBbox.width, height: adjBbox.height,
      zIndex: maxZ + 1,
      content: '', isRich: false, merged: false,
      points: relPoints,
      closed,
      styles: {
        stroke: '#1e293b', strokeWidth: '2', strokeDasharray: '',
        fill: closed ? 'rgba(99,102,241,0.15)' : 'none',
        backgroundColor: 'rgba(0,0,0,0)', opacity: '1',
      },
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
    setDrawPoints([]); setDrawPreview(null); setDrawMode(null)
  }, [flatElements, addFlatElement, setSelectedFlat, setDrawMode])

  const handleDrawClick = useCallback((e) => {
    if (!drawMode) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = (e.clientX - rect.left) / scale
    const cy = (e.clientY - rect.top) / scale

    if (drawMode === 'line') {
      if (drawPoints.length === 0) {
        setDrawPoints([{ x: cx, y: cy }])
      } else {
        finalizeDraw([...drawPoints, { x: cx, y: cy }])
      }
    } else {
      // polyline / polygon: 클릭마다 점 추가
      setDrawPoints(prev => [...prev, { x: cx, y: cy }])
    }
  }, [drawMode, drawPoints, scale, finalizeDraw])

  const handleDrawDoubleClick = useCallback((e) => {
    if (!drawMode || drawMode === 'line') return
    if (drawPoints.length >= 2) {
      e.preventDefault()
      e.stopPropagation()
      finalizeDraw(drawPoints)
    }
  }, [drawMode, drawPoints, finalizeDraw])

  const handleDrawMouseMove = useCallback((e) => {
    if (!drawMode || drawPoints.length === 0) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setDrawPreview({ x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale })
  }, [drawMode, drawPoints.length, scale])

  // ESC로 그리기 취소/확정
  useEffect(() => {
    if (!drawMode) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (drawPoints.length >= 2 && drawMode !== 'line') {
          finalizeDraw(drawPoints) // 확정
        } else {
          setDrawPoints([]); setDrawPreview(null); setDrawMode(null) // 취소
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawMode, drawPoints, finalizeDraw, setDrawMode])

  // 클립보드 붙여넣기 (이미지 / 텍스트)
  useEffect(() => {
    const onPaste = (e) => {
      // 텍스트 편집 중이면 브라우저 기본 동작 (contentEditable에 붙여넣기)
      if (useFlatStore.getState().editingFlatId) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.contentEditable === 'true') return

      const items = [...(e.clipboardData?.items || [])]

      // 1순위: 이미지
      const imageItem = items.find(i => i.type.startsWith('image/'))
      if (imageItem) {
        e.preventDefault()
        const file = imageItem.getAsFile()
        if (file) insertImageFromFile(file)
        return
      }

      // 2순위: 내부 요소 클립보드가 있으면 요소 붙여넣기 (keydown에서 처리)
      const { clipboard } = useFlatStore.getState()
      if (clipboard && clipboard.length > 0) return

      // 3순위: 텍스트 → 새 텍스트 요소 생성
      const text = e.clipboardData?.getData('text/plain')
      if (text && text.trim()) {
        e.preventDefault()
        const { canvasSize: cs, flatElements: els, addFlatElement, setSelectedFlat } = useFlatStore.getState()
        const maxZ = els.length > 0 ? Math.max(...els.map(el => el.zIndex)) : 0
        // 텍스트 크기 추정
        const lines = text.trim().split('\n')
        const estWidth = Math.min(Math.max(200, Math.max(...lines.map(l => l.length)) * 10), cs.w * 0.8)
        const estHeight = Math.max(40, lines.length * 24)
        const el = {
          id: nextFlatId(), sourceId: null,
          type: 'text',
          content: text.trim().replace(/\n/g, '<br>'),
          isRich: text.includes('\n'),
          merged: false,
          x: Math.round((cs.w - estWidth) / 2),
          y: Math.round((cs.h - estHeight) / 2),
          width: Math.round(estWidth),
          height: Math.round(estHeight),
          zIndex: maxZ + 1,
          styles: {
            backgroundColor: 'rgba(0,0,0,0)', color: '#1e293b',
            fontSize: '16px', fontFamily: 'sans-serif', fontWeight: '400',
            lineHeight: '1.5', textAlign: 'left', padding: '4px 8px',
            borderRadius: '0px', border: '0px none', boxShadow: 'none', opacity: '1',
          },
        }
        addFlatElement(el)
        setSelectedFlat(el.id)
      }
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
    // split 모드에서만 iframe 페이지 변경을 flat에 반영.
    // flat 단일 모드는 flat 페이지 시스템(goToFlatPage)이 단독 관리하므로
    // iframe 기반 재추출을 트리거하지 않는다(삽입한 페이지 보존).
    if (viewMode === 'split') reExtract(key)
  }, [currentPage, revealV, viewMode, reExtract])

  // 첫 추출 완료 후 모든 페이지를 백그라운드 프리로드
  const preloadDone = useRef(false)
  // 덱 전체가 비워진 경우(새 HTML 로드/초기화 → flatPageCount 0)에만 프리로드 재트리거.
  // 공백(빈) 페이지로 이동해 flatElements만 0이 된 것은 재트리거 대상이 아님
  // (그렇지 않으면 빈 페이지 이동 시 전체 일괄 변환이 재실행됨).
  const prevElCount = useRef(flatElements.length)
  useEffect(() => {
    if (prevElCount.current > 0 && flatElements.length === 0
        && useFlatStore.getState().flatPageCount === 0) {
      preloadDone.current = false
    }
    prevElCount.current = flatElements.length
  }, [flatElements.length])
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

      // Enter / F2 → 텍스트/도형 편집 모드 진입 (단일 선택만, F2는 PowerPoint 호환)
      if ((e.key === 'Enter' || e.key === 'F2') && singleId) {
        const els = useFlatStore.getState().flatElements
        const el = els.find(el => el.id === singleId)
        if (el && (el.type === 'text' || el.type === 'shape' || el.type === 'table')) {
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

      // 선택 없음 + Delete → 현재 슬라이드 삭제 (PowerPoint, 복구 토스트 제공).
      // Backspace는 제외(오타 위험). flat 모드 + 2장 이상 + 편집 중 아님.
      if (e.key === 'Delete' && !hasSelection && !useFlatStore.getState().editingFlatId
          && (viewMode === 'flat' || viewMode === 'split')
          && useFlatStore.getState().flatPageCount > 1) {
        e.preventDefault()
        useFlatStore.getState().deletePage()
        return
      }

      // F5 → 처음부터 발표, Shift+F5 → 현재 페이지부터 (PowerPoint 호환)
      if (e.key === 'F5') {
        e.preventDefault()
        const startIndex = e.shiftKey ? useFlatStore.getState().flatCurrentPage : 0
        useEditorStore.getState().enterPresentation({ startIndex })
        return
      }

      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if (e.code === 'KeyZ' && e.shiftKey)  { e.preventDefault(); redo(); return }
        if (e.code === 'KeyY')                { e.preventDefault(); redo(); return }
        if (e.code === 'KeyA')                { e.preventDefault(); selectAllFlats(); return }
        // Ctrl+Shift+C/V: 스타일 복사/붙여넣기 (Ctrl+C/V보다 먼저 체크)
        if (e.code === 'KeyC' && e.shiftKey && hasSelection) { e.preventDefault(); useFlatStore.getState().copyStyle(); return }
        if (e.code === 'KeyV' && e.shiftKey && hasSelection) { e.preventDefault(); useFlatStore.getState().pasteStyle(); return }
        if (e.code === 'KeyC' && hasSelection)  { copyElement(); return }
        if (e.code === 'KeyX' && hasSelection)  { cutElement(); return }
        if (e.code === 'KeyV')                  { pasteElement(); return }
        if (e.code === 'KeyD' && hasSelection)  { e.preventDefault(); duplicateElement(); return }
        // 그룹 / 그룹 해제
        if (e.code === 'KeyG' && !e.shiftKey && selectedFlatIds.length >= 2) { e.preventDefault(); useFlatStore.getState().groupSelected(); return }
        if (e.code === 'KeyG' && e.shiftKey && hasSelection) { e.preventDefault(); useFlatStore.getState().ungroupSelected(); return }
        // z-순서: 단일 선택만
        if (e.code === 'BracketRight' && !e.shiftKey && singleId) { bringForward(singleId); return }
        if (e.code === 'BracketLeft' && !e.shiftKey && singleId)  { sendBackward(singleId); return }
        if (e.code === 'BracketRight' && e.shiftKey && singleId)  { bringToFront(singleId); return }
        if (e.code === 'BracketLeft' && e.shiftKey && singleId)   { sendToBack(singleId); return }

        // ── 텍스트 서식 단축키 (선택된 text 요소에 적용, 다중 선택 batch) ──
        if (hasSelection) {
          const els = useFlatStore.getState().flatElements
          const textEls = selectedFlatIds
            .map(id => els.find(el => el.id === id))
            .filter(el => el && (el.type === 'text' || (el.type === 'shape' && el.content)))

          if (textEls.length > 0) {
            const batch = useFlatStore.getState().batchUpdateFlatElementsIndividual
            // Ctrl+B — 굵게 토글
            if (e.code === 'KeyB') {
              e.preventDefault()
              batch(textEls.map(el => ({
                id: el.id,
                changes: { styles: { fontWeight: parseInt(el.styles?.fontWeight || '400') >= 700 ? '400' : '700' } }
              })))
              return
            }
            // Ctrl+I — 이탈릭 토글
            if (e.code === 'KeyI') {
              e.preventDefault()
              batch(textEls.map(el => ({
                id: el.id,
                changes: { styles: { fontStyle: el.styles?.fontStyle === 'italic' ? 'normal' : 'italic' } }
              })))
              return
            }
            // Ctrl+U — 밑줄 토글
            if (e.code === 'KeyU') {
              e.preventDefault()
              batch(textEls.map(el => ({
                id: el.id,
                changes: { styles: { textDecoration: (el.styles?.textDecoration || '').includes('underline') ? 'none' : 'underline' } }
              })))
              return
            }
            // Ctrl+Shift+>(.) / <(,) — 폰트 크기 상대 증감(±2px). 부분 수정분(인라인 font-size)도
            // 함께 가감해 위계 유지 (전체적으로 현재 크기에서 ±N 하는 기대 동작)
            if (e.shiftKey && (e.code === 'Period' || e.code === 'Comma')) {
              e.preventDefault()
              const delta = e.code === 'Period' ? 2 : -2
              batch(textEls.map(el => {
                const r = bumpFontSizePx(el.content, el.isRich, parseFloat(el.styles?.fontSize || '16'), delta)
                return { id: el.id, changes: { content: r.content, styles: { fontSize: r.fontSize } } }
              }))
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

  /** 맞춤 scale 재계산. 맞춤 모드면 scale도 맞춤값으로 동기화. */
  const recalcScale = useCallback(() => {
    if (!stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    if (!r.width || !r.height) return
    const pad = 48
    const fit = Math.min(
      (r.width - pad * 2) / canvasSize.w,
      (r.height - pad * 2) / canvasSize.h,
      1,
    )
    fitScaleRef.current = fit
    if (fitModeRef.current) { setScale(fit); setPan({ x: 0, y: 0 }) }
  }, [canvasSize])

  useEffect(() => {
    recalcScale()
    if (!stageRef.current) return
    const ro = new ResizeObserver(recalcScale)
    ro.observe(stageRef.current)
    return () => ro.disconnect()
  }, [recalcScale])

  // ── 줌/팬 ─────────────────────────────────────────
  const ZOOM_MIN = 0.1, ZOOM_MAX = 8

  // scale/pan 최신값을 고정 클로저(휠/드래그 핸들러)에서 읽기 위한 ref
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const panRef = useRef(pan)
  panRef.current = pan

  // 캔버스가 화면 밖으로 완전히 벗어나지 않도록 팬 클램프(최소 40px 노출)
  const clampPan = useCallback((p, s) => {
    const stage = stageRef.current?.getBoundingClientRect()
    if (!stage) return p
    const maxX = (canvasSize.w * s + stage.width) / 2 - 40
    const maxY = (canvasSize.h * s + stage.height) / 2 - 40
    return {
      x: Math.max(-maxX, Math.min(maxX, p.x)),
      y: Math.max(-maxY, Math.min(maxY, p.y)),
    }
  }, [canvasSize])

  // 줌 적용(클램프). focal {clientX, clientY} 지정 시 그 지점을 고정(커서 기준 줌).
  const applyZoom = useCallback((next, focal) => {
    const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next))
    fitModeRef.current = false
    const stage = stageRef.current?.getBoundingClientRect()
    if (stage && ns > fitScaleRef.current) {
      setPan(prevPan => {
        const cx = stage.left + stage.width / 2
        const cy = stage.top + stage.height / 2
        const fx = focal ? focal.clientX : cx
        const fy = focal ? focal.clientY : cy
        const offX = fx - cx - prevPan.x
        const offY = fy - cy - prevPan.y
        const k = ns / scaleRef.current - 1
        return clampPan({ x: prevPan.x - offX * k, y: prevPan.y - offY * k }, ns)
      })
    } else {
      setPan({ x: 0, y: 0 }) // 맞춤 이하로 줄이면 중앙 정렬
    }
    setScale(ns)
  }, [clampPan])

  const fitToWindow = useCallback(() => {
    fitModeRef.current = true
    setScale(fitScaleRef.current)
    setPan({ x: 0, y: 0 })
  }, [])

  const zoomTo100 = useCallback(() => { applyZoom(1) }, [applyZoom])

  // 휠: Ctrl/Cmd+휠=커서 기준 줌, 휠=세로 팬, Shift+휠=가로 팬
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (e) => {
      if (useFlatStore.getState().editingFlatId) return
      // 마우스 휠 = 커서 기준 줌. (Shift+휠은 줌 상태에서 가로 팬)
      if (e.shiftKey && scaleRef.current > fitScaleRef.current + 1e-6) {
        e.preventDefault()
        setPan(prev => clampPan({ x: prev.x - (e.deltaX || e.deltaY), y: prev.y }, scaleRef.current))
        return
      }
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyZoom(scaleRef.current * factor, { clientX: e.clientX, clientY: e.clientY })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [applyZoom, clampPan])

  // 스페이스: 팬 모드 토글(누르는 동안)
  useEffect(() => {
    const onDown = (e) => {
      if (e.code !== 'Space') return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (useFlatStore.getState().editingFlatId) return
      spaceDownRef.current = true
      if (stageRef.current) stageRef.current.style.cursor = 'grab'
    }
    const onUp = (e) => {
      if (e.code !== 'Space') return
      spaceDownRef.current = false
      if (stageRef.current) stageRef.current.style.cursor = ''
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // 스페이스/가운데버튼 + 드래그 팬 (캡처 단계 → 요소 위에서도 동작)
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onDownCapture = (e) => {
      if (!(spaceDownRef.current || e.button === 1)) return
      if (useFlatStore.getState().editingFlatId) return
      e.preventDefault(); e.stopPropagation()
      panDragRef.current = { startX: e.clientX, startY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y }
      stage.style.cursor = 'grabbing'
    }
    stage.addEventListener('mousedown', onDownCapture, true)
    return () => stage.removeEventListener('mousedown', onDownCapture, true)
  }, [])

  // 팬 드래그 진행
  useEffect(() => {
    const onMove = (e) => {
      const d = panDragRef.current
      if (!d) return
      setPan(clampPan({ x: d.startPanX + (e.clientX - d.startX), y: d.startPanY + (e.clientY - d.startY) }, scaleRef.current))
    }
    const onUp = () => {
      if (panDragRef.current) {
        panDragRef.current = null
        if (stageRef.current) stageRef.current.style.cursor = spaceDownRef.current ? 'grab' : ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [clampPan])

  // 마키 선택: mousedown → mousemove → mouseup
  // 배경 요소는 stopPropagation 안 하므로 여기까지 버블링됨
  // 선택 해제는 mouseup에서 판단 (드래그 없고 배경도 안 눌렸으면 해제)
  const handleStageMouseDown = useCallback((e) => {
    if (e.button === 2) return // 우클릭은 컨텍스트 메뉴가 처리
    setContextMenu(null) // 좌클릭 시 컨텍스트 메뉴 닫기
    if (panDragRef.current) return // 팬 진행 중이면 마키 무시
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
      marqueeRef.current.endX = endX // onUp에서 store 변경 없이 읽기 위해 ref에 저장
      marqueeRef.current.endY = endY
      setMarquee({ startX, startY, endX, endY })
    }
    const onUp = () => {
      const m = marqueeRef.current
      if (!m) return
      marqueeRef.current = null
      const { shiftKey, startX, startY } = m
      const endX = m.endX ?? startX
      const endY = m.endY ?? startY
      setMarquee(null) // 순수 업데이트만 — store 변경은 아래 핸들러 본문에서(렌더 중 setState 금지)

      // 마키 영역 계산
      const x1 = Math.min(startX, endX)
      const y1 = Math.min(startY, endY)
      const x2 = Math.max(startX, endX)
      const y2 = Math.max(startY, endY)
      // 최소 크기 이하면 단순 클릭 → 빈 영역(배경 위 포함) 클릭이므로 선택 해제.
      // (배경 레이어는 pointer-events:none이라 배경 click에 위임할 수 없음)
      if (x2 - x1 < 3 && y2 - y1 < 3) {
        if (!shiftKey) useFlatStore.getState().setSelectedFlat(null)
        return
      }

      // 실제 마키 드래그 발생 → 배경 click 무시 플래그 설정
      useFlatStore.setState({ _skipBgClick: true })
      requestAnimationFrame(() => useFlatStore.setState({ _skipBgClick: false }))

      // 완전 포함된 요소만 선택 (PPT 방식) + 배경 제외
      const els = useFlatStore.getState().flatElements
      const cs = useFlatStore.getState().canvasSize
      const hits = els.filter(el => {
        if (isBackgroundLayer(el, cs)) return false // 배경 레이어는 마퀴 선택 제외
        // 요소가 마키 영역 안에 완전히 포함되어야 선택
        return el.x >= x1 && el.y >= y1 && el.x + el.width <= x2 && el.y + el.height <= y2
      }).map(el => el.id)
      if (hits.length > 0) {
        // 그룹 일부만 잡혔으면 그룹 전체 포함
        const expanded = useFlatStore.getState().expandSelectionToGroups(hits)
        useFlatStore.getState().setSelectedFlats(expanded)
      } else if (!shiftKey) {
        useFlatStore.getState().setSelectedFlat(null)
      }
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
    // 편집 중에는 우리 메뉴를 열지 않고 브라우저 기본 동작도 막지 않음
    // — 모바일 롱프레스로 텍스트 단어선택/네이티브 콜아웃을 보존
    if (useFlatStore.getState().editingFlatId) return
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
      {canvasSize?.w > 0 && canvasSize?.h > 0 && (
        <div
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: canvasSize.w,
            height: canvasSize.h,
            transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) scale(${scale})`,
            transformOrigin: 'center center',
            boxShadow: '0 20px 80px rgba(0,0,0,0.7)',
            background: '#fff',
          }}
          onMouseDown={handleStageMouseDown}
        >
          <div
            data-flat-canvas="true"
            style={{
              position: 'relative', width: '100%', height: '100%', overflow: 'hidden', userSelect: 'none',
              cursor: drawMode ? 'crosshair' : undefined,
            }}
            onClick={drawMode ? handleDrawClick : undefined}
            onDoubleClick={drawMode ? handleDrawDoubleClick : undefined}
            onMouseMove={drawMode ? handleDrawMouseMove : undefined}
          >
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
            {/* 텍스트 박스 단일 선택 시 전용 AI 플로팅바 (편집 중·발표 중에는 숨김) */}
            {selectedEls.length === 1 && selectedEl && selectedEl.type === 'text' && !editingFlatId && mode !== 'present' && (
              <FlatAiBar element={selectedEl} scale={scale} canvasRef={canvasRef} />
            )}
            {/* 이미지 단일 선택 시 전용 AI 디자인 향상 플로팅바 (편집 중·발표 중에는 숨김) */}
            {selectedEls.length === 1 && selectedEl && selectedEl.type === 'image' && !editingFlatId && mode !== 'present' && (
              <FlatImageAiBar element={selectedEl} scale={scale} canvasRef={canvasRef} />
            )}
            {selectedEls.length > 1 && !editingFlatId && (
              <FlatGroupOverlay elements={selectedEls} scale={scale}
                otherRects={otherRects} canvasSize={canvasSize} onSnapGuides={setSnapGuides} />
            )}
            {/* 다중 선택 시 전용 AI 플로팅바 (편집 중·발표 중에는 숨김) */}
            {selectedEls.length > 1 && !editingFlatId && mode !== 'present' && (
              <FlatSelectionAiBar elements={selectedEls} scale={scale} canvasRef={canvasRef} />
            )}
            {/* 스냅 가이드 */}
            {snapGuides.map((g, i) => {
              // 간격 표시 (양방향 화살표 + 거리)
              if (g.type === 'gap') {
                const isH = g.orientation === 'h' // 수평 간격 (좌우)
                return (
                  <div key={i} data-export-ignore="true" style={{
                    position: 'absolute', pointerEvents: 'none', zIndex: 9998,
                    ...(isH
                      ? { left: g.from, top: g.position - 0.5, width: g.to - g.from, height: 1 }
                      : { left: g.position - 0.5, top: g.from, width: 1, height: g.to - g.from }),
                    background: '#ff6b9d',
                  }}>
                    <span style={{
                      position: 'absolute',
                      ...(isH
                        ? { top: -14, left: '50%', transform: 'translateX(-50%)' }
                        : { left: 6, top: '50%', transform: 'translateY(-50%)' }),
                      fontSize: 10, color: '#ff6b9d', fontWeight: 600,
                      background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: 3,
                      whiteSpace: 'nowrap',
                    }}>{g.distance}px</span>
                  </div>
                )
              }
              // 균등 간격 스냅 (분홍 점선)
              if (g.type === 'spacing') {
                return (
                  <div key={i} data-export-ignore="true" style={{
                    position: 'absolute', pointerEvents: 'none', zIndex: 9997,
                    ...(g.orientation === 'v'
                      ? { left: g.position, top: 0, width: 0, height: '100%', borderLeft: '1px dashed #c084fc' }
                      : { top: g.position, left: 0, height: 0, width: '100%', borderTop: '1px dashed #c084fc' }),
                  }} />
                )
              }
              // 크기 매칭 (파란 점선 + 치수)
              if (g.type === 'size') {
                return (
                  <div key={i} data-export-ignore="true" style={{
                    position: 'absolute', pointerEvents: 'none', zIndex: 9997,
                    ...(g.orientation === 'v'
                      ? { left: g.position, top: g.from, width: 0, height: g.to - g.from, borderLeft: '1px dashed #38bdf8' }
                      : { top: g.position, left: g.from, height: 0, width: g.to - g.from, borderTop: '1px dashed #38bdf8' }),
                  }}>
                    <span style={{
                      position: 'absolute',
                      ...(g.orientation === 'v'
                        ? { left: 4, top: '50%', transform: 'translateY(-50%)' }
                        : { top: 4, left: '50%', transform: 'translateX(-50%)' }),
                      fontSize: 10, color: '#38bdf8', fontWeight: 600,
                      background: 'rgba(0,0,0,0.7)', padding: '1px 4px', borderRadius: 3,
                      whiteSpace: 'nowrap',
                    }}>{g.targetSize}px</span>
                  </div>
                )
              }
              // 기본 정렬 가이드 (빨간 실선)
              return (
                <div key={i} data-export-ignore="true" style={{
                  position: 'absolute',
                  ...(g.orientation === 'v'
                    ? { left: g.position, top: 0, width: 1, height: '100%' }
                    : { top: g.position, left: 0, height: 1, width: '100%' }),
                  background: '#ff2d55',
                  pointerEvents: 'none',
                  zIndex: 9997,
                }} />
              )
            })}
            {/* 그리기 프리뷰 */}
            {drawMode && drawPoints.length > 0 && (
              <svg
                data-export-ignore="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999, overflow: 'visible' }}
              >
                {(() => {
                  const allPts = drawPreview ? [...drawPoints, drawPreview] : drawPoints
                  if (allPts.length < 2) return null
                  const d = pointsToSvgPath(allPts, drawMode === 'polygon' && !drawPreview)
                  return (
                    <>
                      <path d={d} stroke="#6366f1" strokeWidth="2" fill={drawMode === 'polygon' ? 'rgba(99,102,241,0.1)' : 'none'}
                            strokeDasharray="6,3" strokeLinecap="round" strokeLinejoin="round" />
                      {allPts.map((p, i) => (
                        <circle key={i} cx={p.x} cy={p.y} r={4}
                                fill={i < drawPoints.length ? '#6366f1' : '#a5b4fc'}
                                stroke="#fff" strokeWidth="1.5" />
                      ))}
                    </>
                  )
                })()}
              </svg>
            )}
            {editingFlatId && flatElements.find(e => e.id === editingFlatId) && (
              flatElements.find(e => e.id === editingFlatId).type === 'table'
                ? <FlatTableEditor element={flatElements.find(e => e.id === editingFlatId)} />
                : <FlatInlineEditor element={flatElements.find(e => e.id === editingFlatId)} />
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
            이미지/영상을 여기에 놓으세요
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

      {/* 빈 안내: 변환 중이거나, 프로젝트 자체가 없을 때만. 프로젝트 안의 빈 페이지는
          빈 캔버스만 보이게(작성 중인데 'HTML 로드' 안내가 뜨는 혼란 방지) */}
      {flatElements.length === 0 && (preloadProgress || flatPageCount === 0) && (
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

      {/* 줌 컨트롤 (우하단 플로팅) */}
      {canvasSize?.w > 0 && (
        <ZoomControl
          scale={scale}
          onZoomIn={() => applyZoom(scaleRef.current * 1.2)}
          onZoomOut={() => applyZoom(scaleRef.current / 1.2)}
          onFit={fitToWindow}
          on100={zoomTo100}
        />
      )}
    </div>
  )
}

function ZoomControl({ scale, onZoomIn, onZoomOut, onFit, on100 }) {
  // mousedown preventDefault → 버튼이 포커스를 가져가지 않음(클릭 후 Space/Enter가
  // 버튼에 먹히는 현상 방지). 클릭(onClick)은 그대로 동작.
  const stop = (e) => { e.stopPropagation(); e.preventDefault() }
  const btn = {
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)',
    color: '#cbd5e1', cursor: 'pointer', fontSize: 14, lineHeight: 1,
  }
  const txt = { ...btn, width: 'auto', padding: '0 8px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }
  return (
    <div
      onMouseDown={stop}
      style={{
        position: 'absolute', right: 12, bottom: 12, zIndex: 60,
        display: 'flex', alignItems: 'center', gap: 4, padding: 4, borderRadius: 9,
        background: 'rgba(15,23,42,0.9)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}
    >
      <button style={btn} onClick={onZoomOut} title="축소 (Ctrl+휠)">−</button>
      <button style={txt} onClick={on100} title="100%">{Math.round(scale * 100)}%</button>
      <button style={btn} onClick={onZoomIn} title="확대 (Ctrl+휠)">+</button>
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.12)' }} />
      <button style={txt} onClick={onFit} title="창에 맞춤">맞춤</button>
    </div>
  )
}
