import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { DropZoneManager } from '../core/DropZoneManager'
import { InsertionPlaceholders } from '../core/InsertionPlaceholders'
import { FlexResizeHandle } from '../core/FlexResizeHandle'
import { ResizeHandles } from '../core/ResizeHandles'

const DEFAULT_W = 1280
const DEFAULT_H = 800

/**
 * SlideCanvas
 *
 * 레이아웃 원칙:
 *   편집 모드 — position:relative flex-1, 어두운 무대 배경, 여백 포함 scale
 *   발표 모드 — position:fixed inset-0 z-[1000], 완전 검정, 꽉 채움 scale
 *              Fullscreen API 없이 CSS로 즉시 전체화면 구현 (타이밍/브라우저 호환 문제 회피)
 *
 * ※ srcdoc → srcDoc (React DOM 속성명 규칙)
 */
export default function SlideCanvas() {
  const stageRef  = useRef(null)
  const iframeRef = useRef(null)

  const [scale,        setScale]        = useState(1)
  const [detectedSize, setDetectedSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })

  const { slideHtml, mode, canvasSize, selectedId, setSelected, setIframeRef, exitPresentation, insertElement, setPendingInsert } = useEditorStore()
  const dzm = useMemo(() => new DropZoneManager(), [])
  const ipm = useMemo(() => new InsertionPlaceholders(), [])
  const frh = useMemo(() => new FlexResizeHandle(), [])
  const rsh = useMemo(() => new ResizeHandles(), [])
  const [dragging, setDragging] = useState(false)

  const slideSize = canvasSize ?? detectedSize

  useEffect(() => { setIframeRef(iframeRef) }, [setIframeRef])

  // 새 파일 로드 시 감지 치수 초기화
  useEffect(() => {
    setDetectedSize({ w: DEFAULT_W, h: DEFAULT_H })
  }, [slideHtml])

  // ── 이미지 붙여넣기 공통 로직 (부모 paste + iframe fe:pasteImage) ──
  const handlePasteImage = useCallback((dataUrl, fileName) => {
    const { selectedId, elements } = useEditorStore.getState()
    const meta = selectedId ? elements.get(selectedId) : null

    if (meta?.type === 'image') {
      useEditorStore.getState().applyAttribute(selectedId, 'src', dataUrl)
    } else {
      const parentId = meta?.type === 'container' ? selectedId : null
      insertElement(parentId, 'img', {
        src: dataUrl,
        alt: fileName?.replace(/\.[^.]+$/, '') || 'pasted-image',
        style: 'max-width:100%; height:auto; display:block;',
      })
    }
  }, [insertElement])

  // iframe → 부모 postMessage
  useEffect(() => {
    const onMessage = (e) => {
      if (!e.data?.type?.startsWith('fe:')) return
      if (e.data.type === 'fe:select') {
        setSelected(e.data.id)
        // split 모드: Flat 쪽 선택 해제
        useFlatStore.getState().setSelectedFlat(null)
      }
      else if (e.data.type === 'fe:deselect') setSelected(null)
      else if (e.data.type === 'fe:insertAt') {
        const iframe = iframeRef.current
        if (!iframe) return
        const iframeRect = iframe.getBoundingClientRect()
        setPendingInsert({
          parentId: e.data.parentId || null,
          index: e.data.index,
          axis: e.data.axis || 'flow',
          wrapTarget: e.data.wrapTarget || null,
          wrapSide: e.data.wrapSide || null,
          clientX: iframeRect.left + e.data.clientX * scale,
          clientY: iframeRect.top + e.data.clientY * scale,
        })
      }
      else if (e.data.type === 'fe:pasteImage') {
        handlePasteImage(e.data.dataUrl, e.data.fileName)
      }
      else if (e.data.type === 'fe:pageChange') {
        useEditorStore.getState()._onPageChange(e.data)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [setSelected, setPendingInsert, scale, handlePasteImage])

  // 선택 변경 시 삽입 플레이스홀더 + flex 리사이즈 핸들 업데이트
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    if (mode === 'present' || !selectedId) {
      ipm.clear(doc)
      frh.clear(doc)
      rsh.clear(doc)
      return
    }
    const { previewStyle, applyStyle } = useEditorStore.getState()
    const t = setTimeout(() => {
      ipm.update(doc, selectedId)
      frh.update(doc, selectedId, { previewStyle, applyStyle })
      rsh.update(doc, selectedId, { previewStyle, applyStyle }, { ipm })
    }, 50)
    return () => {
      clearTimeout(t)
      ipm.clear(doc)
      frh.clear(doc)
      rsh.clear(doc)
    }
  }, [selectedId, mode, ipm, frh, rsh, slideHtml])

  // HTML 모드 발표: ESC 종료 + 키보드/마우스휠 페이지 네비게이션
  const viewMode = useFlatStore(s => s.viewMode)
  useEffect(() => {
    if (mode !== 'present' || viewMode !== 'html') return

    const { navigatePage, navigateDirection, isReveal } = useEditorStore.getState()

    const onKey = (e) => {
      if (e.key === 'Escape') { exitPresentation(); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        if (isReveal && e.key === 'ArrowRight') navigateDirection('right')
        else if (isReveal && e.key === 'ArrowDown') navigateDirection('down')
        else navigatePage(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        if (isReveal && e.key === 'ArrowLeft') navigateDirection('left')
        else if (isReveal && e.key === 'ArrowUp') navigateDirection('up')
        else navigatePage(-1)
      }
    }

    const onWheel = (e) => {
      e.preventDefault()
      if (e.deltaY > 0) navigatePage(1)
      else if (e.deltaY < 0) navigatePage(-1)
    }

    const onClick = (e) => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      if (x < rect.width * 0.25) navigatePage(-1)
      else navigatePage(1)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: false })
    stageRef.current?.addEventListener('click', onClick)
    const stageEl = stageRef.current

    // iframe 내부에도 키 이벤트 리스닝 (iframe에 포커스가 있을 때)
    const iframeDoc = iframeRef.current?.contentDocument
    iframeDoc?.addEventListener('keydown', onKey)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      stageEl?.removeEventListener('click', onClick)
      iframeDoc?.removeEventListener('keydown', onKey)
    }
  }, [mode, viewMode, exitPresentation])

  // iframe 로드 후 슬라이드 치수 감지 (overflow:hidden + 명시적 크기인 경우)
  const handleIframeLoad = useCallback(() => {
    try {
      const iframe = iframeRef.current
      if (!iframe) return
      const win = iframe.contentWindow
      const doc = iframe.contentDocument
      if (!win || !doc) return
      const bodyCS = win.getComputedStyle(doc.body)
      const htmlCS = win.getComputedStyle(doc.documentElement)
      const w = parseFloat(bodyCS.width)  || parseFloat(htmlCS.width)  || 0
      const h = parseFloat(bodyCS.height) || parseFloat(htmlCS.height) || 0
      if (w >= 400 && w <= 4000 && h >= 200 && h <= 4000) {
        setDetectedSize({ w, h })
      }
    } catch { /* sandbox 제한 무시 */ }

    // flat 모드 기본: iframe 로드 후 자동 flat 추출 트리거
    setTimeout(() => {
      const flatState = useFlatStore.getState()
      if (flatState.viewMode === 'flat' || flatState.viewMode === 'split') {
        const edState = useEditorStore.getState()
        const pageKey = `${edState.currentPage}-0`
        flatState.extractFromIframe(edState.iframeRef, pageKey)
      }
    }, 500)
  }, [])

  /** scale 재계산 */
  const recalcScale = useCallback(() => {
    let stageW, stageH
    if (mode === 'present') {
      // CSS fixed inset-0 → 항상 뷰포트 크기
      stageW = window.innerWidth
      stageH = window.innerHeight
    } else {
      if (!stageRef.current) return
      const r = stageRef.current.getBoundingClientRect()
      stageW = r.width
      stageH = r.height
      if (!stageW || !stageH) return
    }
    const pad = mode === 'present' ? 0 : 48
    const s   = Math.min((stageW - pad * 2) / slideSize.w, (stageH - pad * 2) / slideSize.h)
    setScale(mode === 'present' ? s : Math.min(s, 1))
  }, [slideSize, mode])

  // ResizeObserver (편집 모드) + window resize (발표 모드)
  useEffect(() => {
    recalcScale()
    if (mode === 'present') {
      window.addEventListener('resize', recalcScale)
      return () => window.removeEventListener('resize', recalcScale)
    } else {
      if (!stageRef.current) return
      const ro = new ResizeObserver(recalcScale)
      ro.observe(stageRef.current)
      return () => ro.disconnect()
    }
  }, [recalcScale, mode])

  // ── Ctrl+V 클립보드 이미지 붙여넣기 (부모 윈도우) ────────────
  useEffect(() => {
    if (mode === 'present') return
    const onPaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        const reader = new FileReader()
        reader.onload = (ev) => handlePasteImage(ev.target.result, file.name)
        reader.readAsDataURL(file)
        break
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [mode, handlePasteImage])

  // ── 드래그앤드롭 이미지 삽입 ────────────────────────────────
  const hasImageFile = useCallback((e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      const items = e.dataTransfer.items
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) return true
      }
    }
    return false
  }, [])

  const handleDragOver = useCallback((e) => {
    if (mode === 'present' || !hasImageFile(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)

    const iframe = iframeRef.current
    if (!iframe?.contentDocument) return
    const { x, y } = dzm.mapCoords(e, iframe, scale)
    const hit = dzm.hitTest(iframe.contentDocument, x, y)
    dzm.showIndicator(iframe.contentDocument, hit)
  }, [mode, scale, dzm, hasImageFile])

  const handleDragLeave = useCallback((e) => {
    // stageRef 밖으로 나갈 때만 정리
    if (stageRef.current && !stageRef.current.contains(e.relatedTarget)) {
      setDragging(false)
      const doc = iframeRef.current?.contentDocument
      if (doc) dzm.hideIndicator(doc)
    }
  }, [dzm])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const iframe = iframeRef.current
    const doc = iframe?.contentDocument
    if (!doc) return

    const hit = dzm.lastResult
    dzm.hideIndicator(doc)

    const files = e.dataTransfer?.files
    if (!files?.length) return

    // 모든 이미지 파일을 순서대로 삽입
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = (ev) => {
        const parentId = hit?.parentId ?? null
        const index = hit?.index
        insertElement(parentId, 'img', {
          src: ev.target.result,
          alt: file.name.replace(/\.[^.]+$/, ''),
          style: 'max-width:100%; height:auto; display:block;',
        }, index)
      }
      reader.readAsDataURL(file)
    }
  }, [dzm, insertElement])

  // ── 스타일 분기 ────────────────────────────────────────────
  // flat/split 모드 발표 시 FlatPresenter가 처리 — SlideCanvas는 일반 모드 유지
  const isPresent = mode === 'present' && viewMode === 'html'

  const stageStyle = isPresent
    ? { position: 'fixed', inset: 0, zIndex: 1000, background: '#000' }
    : { flex: 1, position: 'relative', overflow: 'hidden',
        background: '#0f172a', transition: 'background 0.3s' }

  return (
    <div
      ref={stageRef}
      style={stageStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 드래그 오버레이 */}
      {dragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(99,102,241,0.05)',
          border: '2px dashed rgba(99,102,241,0.3)',
          borderRadius: 12,
          pointerEvents: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: '#a5b4fc', fontSize: 14, fontWeight: 500,
                         background: 'rgba(15,23,42,0.8)', padding: '8px 16px',
                         borderRadius: 8, backdropFilter: 'blur(8px)' }}>
            이미지를 놓아주세요
          </span>
        </div>
      )}
      {slideHtml ? (
        <div
          style={{
            position:        'absolute',
            top:             '50%',
            left:            '50%',
            width:           slideSize.w,
            height:          slideSize.h,
            transform:       `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
            boxShadow:       isPresent ? 'none' : '0 20px 80px rgba(0,0,0,0.7)',
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={slideHtml}        /* ← srcDoc (React 표준 camelCase) */
            onLoad={handleIframeLoad}
            title="slide"
            style={{ width: slideSize.w, height: slideSize.h, border: 'none', display: 'block' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      ) : (
        <EmptyState />
      )}

      {/* 발표 모드 ESC 힌트 — stageRef 안에 렌더링해야 fixed 계층이 올바름 */}
      {isPresent && <PresentHint onExit={exitPresentation} />}
    </div>
  )
}

/* ─── 플레이스홀더 클릭 시 삽입 메뉴 팝업 ─────────────────────── */
export function InsertPopup() {
  const { pendingInsert, clearPendingInsert, insertElement, wrapAndInsert } = useEditorStore()
  const popupRef = useRef(null)

  useEffect(() => {
    if (!pendingInsert) return
    const handler = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        clearPendingInsert()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pendingInsert, clearPendingInsert])

  if (!pendingInsert) return null

  const items = [
    { tag: 'p',   label: '텍스트', icon: '📝', attrs: { textContent: '새 텍스트' } },
    { tag: 'img', label: '이미지', icon: '🖼', attrs: { src: 'https://placehold.co/400x300', alt: '이미지', style: 'max-width:100%;height:auto;display:block;' } },
    { tag: 'div', label: '박스',   icon: '📦', attrs: {} },
  ]

  const isCross = pendingInsert.axis === 'cross'

  const handleInsert = (item) => {
    if (isCross && pendingInsert.wrapTarget) {
      wrapAndInsert(pendingInsert.wrapTarget, pendingInsert.wrapSide, item.tag, item.attrs)
    } else {
      insertElement(pendingInsert.parentId, item.tag, item.attrs, pendingInsert.index)
    }
    clearPendingInsert()
  }

  // 팝업 위치 (화면 밖으로 넘치지 않도록 보정)
  const x = Math.min(pendingInsert.clientX, window.innerWidth - 160)
  const y = Math.min(pendingInsert.clientY, window.innerHeight - 140)

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        zIndex: 2000,
        width: 140,
        background: 'rgba(15,23,42,0.97)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10,
        boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        padding: 4,
        animation: 'fePopIn 0.15s ease-out',
      }}
    >
      {items.map(item => (
        <button
          key={item.tag}
          onClick={() => handleInsert(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '8px 12px',
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: '#cbd5e1',
            fontSize: 12,
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function PresentHint({ onExit }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 2500)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      onClick={onExit}
      style={{
        position:   'fixed', bottom: 24, left: '50%',
        transform:  'translateX(-50%)',
        zIndex:     1010,
        display:    'flex', alignItems: 'center', gap: 10,
        padding:    '8px 16px', borderRadius: 12, cursor: 'pointer',
        background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(12px)',
        border:     '1px solid rgba(255,255,255,0.07)',
        opacity:    visible ? 1 : 0, transition: 'opacity 0.5s',
        pointerEvents: visible ? 'all' : 'none',
      }}
    >
      <span style={{ fontSize: 12, color: '#94a3b8' }}>발표 모드</span>
      <kbd style={{ fontSize: 11, background: 'rgba(255,255,255,0.1)',
                    color: '#cbd5e1', padding: '2px 6px', borderRadius: 4,
                    fontFamily: 'monospace' }}>ESC</kbd>
      <span style={{ fontSize: 12, color: '#64748b' }}>편집으로 복귀</span>
    </div>
  )
}

function EmptyState() {
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%,-50%)',
      textAlign: 'center', pointerEvents: 'none', userSelect: 'none',
    }}>
      <div style={{ fontSize: 64, opacity: 0.15, marginBottom: 24 }}>▤</div>
      <p style={{ color: '#94a3b8', fontSize: 18, fontWeight: 300 }}>슬라이드를 열어주세요</p>
      <p style={{ color: '#475569', fontSize: 14, marginTop: 8 }}>
        상단 중앙으로 마우스를 올려 메뉴를 열고 HTML 파일을 불러오세요
      </p>
    </div>
  )
}
