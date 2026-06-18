import { useRef, useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'
import { SLIDE_LAYOUTS, carryLayoutContent } from '../core/slideLayouts'
import ThemeMenu from './ThemeMenu'
import { themeRoleStyles } from '../core/themes'
import { SNIPPETS } from '../core/snippets'
import SnippetMenu from './SnippetMenu'
import { createTableElement } from '../core/slideTable'
import { BlobStore } from '../core/BlobStore'
import { isBackgroundElement } from '../core/SnapEngine'
import { ToolBtn, Divider, UndoIcon, RedoIcon } from './FloatingToolbar'
import { promptUrl } from './UrlPrompt'

// 새 배경의 zIndex — 기존 배경들보다 '앞'(최상위 배경). 안 그러면 흰 배경 등에 가려진다.
// 배경끼리는 render z에 -1,000,000 오프셋이 있어 항상 콘텐츠 아래로 유지됨.
function nextBgZ(els) {
  const bgZs = els.filter(e => isBackgroundElement(e)).map(e => e.zIndex)
  if (bgZs.length) return Math.max(...bgZs) + 1
  return els.length ? Math.min(...els.map(e => e.zIndex)) - 1 : 0
}

const HTML_INSERT_ITEMS = [
  { tag: 'p',   label: '텍스트', icon: '📝', attrs: { textContent: '새 텍스트' } },
  { tag: 'img', label: '이미지', icon: '🖼', attrs: { src: 'https://placehold.co/400x300', alt: '이미지' } },
  { tag: 'div', label: '박스',   icon: '📦', attrs: {} },
]

const DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  color: '#000', fontSize: '16px', fontFamily: 'sans-serif',
  fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
  letterSpacing: 'normal', textTransform: 'none', textDecoration: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'contain',
}

const FLAT_PRESETS = {
  text: {
    type: 'text', width: 200, height: 40,
    content: '새 텍스트', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, padding: '4px 8px' },
  },
  rect: {
    type: 'shape', width: 150, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0' },
  },
  circle: {
    type: 'shape', width: 100, height: 100,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#e2e8f0', borderRadius: '50%' },
  },
  lineH: {
    type: 'shape', width: 200, height: 2,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#94a3b8' },
  },
  lineV: {
    type: 'shape', width: 2, height: 200,
    content: '', isRich: false, merged: false,
    styles: { ...DEFAULT_STYLES, backgroundColor: '#94a3b8' },
  },
}

/**
 * EditToolbar — 편집 컨텍스트 툴바
 * Undo/Redo, 삽입, z-순서
 * Flat 모드: PowerPoint 스타일 요소 추가 버튼
 * HTML 모드: HTML 요소 삽입 드롭다운
 */
export default function EditToolbar() {
  const { slideHtml, mode, canUndo: htmlCanUndo, canRedo: htmlCanRedo,
          selectedId, elements, undo: htmlUndo, redo: htmlRedo, insertElement } = useEditorStore()
  const { viewMode, selectedFlatIds, flatElements, canvasSize,
          canUndo: flatCanUndo, canRedo: flatCanRedo,
          undo: flatUndo, redo: flatRedo,
          addFlatElement, addFlatElements, applyLayoutElements, setSelectedFlat } = useFlatStore()
  const [insertOpen, setInsertOpen] = useState(false)
  const [shapeOpen, setShapeOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const insertRef = useRef(null)
  const shapeRef = useRef(null)
  const videoRef = useRef(null)
  const layoutRef = useRef(null)
  const tableRef = useRef(null)
  const imageInputRef = useRef(null)
  const bgImageInputRef = useRef(null)
  const bgVideoInputRef = useRef(null)

  const isFlatMode = viewMode === 'flat' || viewMode === 'split'
  const canUndo = isFlatMode ? flatCanUndo : htmlCanUndo
  const canRedo = isFlatMode ? flatCanRedo : htmlCanRedo
  const undo = isFlatMode ? flatUndo : htmlUndo
  const redo = isFlatMode ? flatRedo : htmlRedo

  // Ctrl+Z/Y → 모드에 따라 적절한 undo/redo 호출
  useEffect(() => {
    const onKeyDown = (e) => {
      const vm = useFlatStore.getState().viewMode
      if (vm === 'flat' || vm === 'split') return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); htmlUndo() }
        if (e.code === 'KeyZ' && e.shiftKey)  { e.preventDefault(); htmlRedo() }
        if (e.code === 'KeyY')                { e.preventDefault(); htmlRedo() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [htmlUndo, htmlRedo])

  // ── Flat 모드 삽입 헬퍼 ──

  const insertFlatPreset = useCallback((presetKey) => {
    const p = FLAT_PRESETS[presetKey]
    if (!p) return
    const maxZ = flatElements.length > 0
      ? Math.max(...flatElements.map(e => e.zIndex))
      : 0
    const themeText = p.type === 'text' ? useFlatStore.getState().getThemeTextDefault() : null
    const el = {
      id: nextFlatId(),
      sourceId: null,
      ...p,
      styles: { ...p.styles, ...(themeText ? { color: themeText.color, fontWeight: themeText.fontWeight, textShadow: themeText.textShadow } : {}) },
      x: Math.round((canvasSize.w - p.width) / 2),
      y: Math.round((canvasSize.h - p.height) / 2),
      zIndex: maxZ + 1,
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [flatElements, canvasSize, addFlatElement, setSelectedFlat])

  // 배경 레이어 추가 — 캔버스 전체 크기 + z 최하(맨 뒤). 기존 콘텐츠를 가리지 않는다.
  const insertBackground = useCallback(() => {
    const el = {
      id: nextFlatId(), sourceId: '__bg',
      type: 'shape', content: '', isRich: false, merged: false,
      isBackground: true, // 배경 레이어: 항상 맨 뒤 고정, z-order 변경 비활성
      x: 0, y: 0, width: canvasSize.w, height: canvasSize.h,
      zIndex: nextBgZ(flatElements), // 기존 배경들보다 앞
      styles: { ...DEFAULT_STYLES, backgroundColor: '#ffffff', borderRadius: '0px' },
    }
    addFlatElement(el)
    // 배경은 캔버스에서 선택 대상이 아님 → 선택 해제하여 '배경 레이어' 패널이 뜨게 함
    setSelectedFlat(null)
  }, [flatElements, canvasSize, addFlatElement, setSelectedFlat])

  // 배경 이미지 추가 — 선택한 이미지 파일을 전체화면 배경 레이어로
  const handleBgImageFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      addFlatElement({
        id: nextFlatId(), sourceId: '__bg', type: 'image',
        content: ev.target.result, isRich: false, merged: false,
        isBackground: true, locked: true,
        x: 0, y: 0, width: canvasSize.w, height: canvasSize.h, zIndex: nextBgZ(flatElements),
        styles: { ...DEFAULT_STYLES, objectFit: 'cover' },
      })
      setSelectedFlat(null)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [flatElements, canvasSize, addFlatElement, setSelectedFlat])

  // 배경 영상 추가 — 선택한 영상 파일을 전체화면 배경 레이어로(자동재생/반복/음소거)
  const handleBgVideoFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const { BlobStore } = await import('../core/BlobStore')
    const key = await BlobStore.put(file)
    addFlatElement({
      id: nextFlatId(), sourceId: '__bg', type: 'video',
      content: BlobStore.toRef(key), isRich: false, merged: false,
      isBackground: true, locked: true,
      autoplay: true, loop: true, muted: true, hideControls: true,
      x: 0, y: 0, width: canvasSize.w, height: canvasSize.h, zIndex: nextBgZ(flatElements),
      styles: { ...DEFAULT_STYLES, objectFit: 'cover' },
    })
    setSelectedFlat(null)
    e.target.value = ''
  }, [flatElements, canvasSize, addFlatElement, setSelectedFlat])

  // 레이아웃 적용 — 기존 레이아웃이 있으면 변환(역할별 내용 이어받아 교체), 없으면 신규 삽입.
  // 어느 쪽이든 단일 undo 단위.
  const insertLayout = useCallback((layoutId) => {
    const layout = SLIDE_LAYOUTS.find(l => l.id === layoutId)
    if (!layout) return
    const existingLayoutEls = flatElements.filter(e => e.layoutRole)
    const specs = carryLayoutContent(existingLayoutEls, layout.build(canvasSize))
    const maxZ = flatElements.length > 0 ? Math.max(...flatElements.map(e => e.zIndex)) : 0
    // 레이아웃의 하드코딩 색 대신 현재 테마(사용자정의 포함)의 역할색/굵기/그림자 적용
    const theme = useFlatStore.getState()._currentTheme()
    const els = specs.map((s, i) => {
      const el = {
        sourceId: null, rotation: 0, merged: false, isRich: false,
        ...s,
        id: nextFlatId(),
        zIndex: maxZ + 1 + i,
      }
      if (el.type === 'text' && el.layoutRole) {
        const rs = themeRoleStyles(theme, el.layoutRole)
        if (rs) el.styles = { ...el.styles, color: rs.color, fontWeight: rs.fontWeight, textShadow: rs.textShadow }
      }
      return el
    })
    if (existingLayoutEls.length > 0) {
      // 변환: 기존 레이아웃 요소 제거 + 새 레이아웃 추가 (빈 슬라이드면 제거만)
      applyLayoutElements(existingLayoutEls.map(e => e.id), els)
    } else if (els.length > 0) {
      addFlatElements(els)
    }
    setSelectedFlat(null)
  }, [flatElements, canvasSize, addFlatElements, applyLayoutElements, setSelectedFlat])

  // 스니펫(데코 요소) 삽입 — 현재 테마 색 사용, 중앙 배치, 복합은 그룹으로
  const insertSnippet = useCallback((snippetId) => {
    const snip = SNIPPETS.find(s => s.id === snippetId)
    if (!snip) return
    const theme = useFlatStore.getState()._currentTheme()
    const specs = snip.build(canvasSize, theme)
    if (!specs || specs.length === 0) return
    const maxZ = flatElements.length > 0 ? Math.max(...flatElements.map(e => e.zIndex)) : 0
    const groupId = specs.length > 1
      ? 'grp-' + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2, 11))
      : null
    const els = specs.map((s, i) => ({
      sourceId: null, rotation: 0, isRich: false, merged: false,
      ...s,
      id: nextFlatId(), zIndex: maxZ + 1 + i,
      ...(groupId ? { groupId } : {}),
    }))
    addFlatElements(els)
    if (els.length === 1) setSelectedFlat(els[0].id)
    else useFlatStore.getState().setSelectedFlats(els.map(e => e.id))
  }, [canvasSize, flatElements, addFlatElements, setSelectedFlat])

  // 표 삽입 — rows×cols 그리드 피커에서 선택
  const insertTable = useCallback((rows, cols) => {
    const partial = createTableElement(rows, cols, canvasSize)
    const maxZ = flatElements.length > 0 ? Math.max(...flatElements.map(e => e.zIndex)) : 0
    const el = {
      id: nextFlatId(),
      sourceId: null,
      rotation: 0,
      ...partial,
      x: Math.round(((canvasSize?.w || 1280) - partial.width) / 2),
      y: Math.round(((canvasSize?.h || 720) - partial.height) / 2),
      zIndex: maxZ + 1,
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [flatElements, canvasSize, addFlatElement, setSelectedFlat])

  const handleImageFile = useCallback((e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const img = new Image()
      img.onload = () => {
        let w = img.width, h = img.height
        const maxW = canvasSize.w * 0.6, maxH = canvasSize.h * 0.6
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h)
          w = Math.round(w * ratio)
          h = Math.round(h * ratio)
        }
        const maxZ = flatElements.length > 0
          ? Math.max(...flatElements.map(el => el.zIndex)) : 0
        const el = {
          id: nextFlatId(), sourceId: null,
          type: 'image', width: w, height: h,
          content: ev.target.result,
          isRich: false, merged: false,
          x: Math.round((canvasSize.w - w) / 2),
          y: Math.round((canvasSize.h - h) / 2),
          zIndex: maxZ + 1,
          styles: { ...DEFAULT_STYLES, objectFit: 'contain' },
        }
        addFlatElement(el)
        setSelectedFlat(el.id)
      }
      img.src = ev.target.result
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }, [canvasSize, flatElements, addFlatElement, setSelectedFlat])

  const videoInputRef = useRef(null)

  // 영상 URL 입력
  const insertVideoUrl = useCallback(async () => {
    const url = await promptUrl({ title: '영상 URL을 입력하세요', placeholder: 'YouTube, Vimeo URL' })
    if (!url || !url.trim()) return
    const embedUrl = parseVideoUrl(url.trim())
    const w = Math.min(560, canvasSize.w * 0.6)
    const h = Math.round(w * 9 / 16)
    const maxZ = flatElements.length > 0
      ? Math.max(...flatElements.map(el => el.zIndex)) : 0
    const el = {
      id: nextFlatId(), sourceId: null,
      type: 'video', width: w, height: h,
      content: embedUrl,
      isRich: false, merged: false,
      autoplay: true, loop: false, muted: false, hideControls: true, // 기본: 자동재생 on, 반복·음소거 off, 컨트롤 숨김
      x: Math.round((canvasSize.w - w) / 2),
      y: Math.round((canvasSize.h - h) / 2),
      zIndex: maxZ + 1,
      styles: { ...DEFAULT_STYLES, borderRadius: '8px' },
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
  }, [canvasSize, flatElements, addFlatElement, setSelectedFlat])

  // 영상 파일 선택
  const handleVideoFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > 200) {
      if (!confirm(`파일 크기가 ${sizeMB.toFixed(0)}MB입니다. 계속하시겠습니까?`)) return
    }
    const key = await BlobStore.put(file)
    const blobUrl = await BlobStore.getUrl(key)
    // 비디오 치수 감지
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
    const el = {
      id: nextFlatId(), sourceId: null,
      type: 'video', width: w, height: h,
      content: BlobStore.toRef(key),
      isRich: false, merged: false,
      autoplay: true, loop: false, muted: false, hideControls: true, // 기본: 자동재생 on, 반복·음소거 off, 컨트롤 숨김
      x: Math.round((canvasSize.w - w) / 2),
      y: Math.round((canvasSize.h - h) / 2),
      zIndex: maxZ + 1,
      styles: { ...DEFAULT_STYLES, borderRadius: '8px' },
    }
    addFlatElement(el)
    setSelectedFlat(el.id)
    e.target.value = ''
  }, [canvasSize, flatElements, addFlatElement, setSelectedFlat])

  if (mode === 'present') return null

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 shrink-0 relative z-20"
      style={{
        background: 'rgba(15,23,42,0.9)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <ToolBtn onClick={undo} disabled={!canUndo} title="실행취소 (Ctrl+Z)">
        <UndoIcon />
      </ToolBtn>
      <ToolBtn onClick={redo} disabled={!canRedo} title="다시실행 (Ctrl+Y)">
        <RedoIcon />
      </ToolBtn>

      <Divider />

      {isFlatMode ? (
        <>
          {/* ── Flat 모드: 요소 추가 버튼들 ── */}
          <ToolBtn onClick={() => insertFlatPreset('text')} title="텍스트 추가">
            <TextIcon /><span className="text-xs ml-1">텍스트</span>
          </ToolBtn>

          {/* 도형 드롭다운 */}
          <DropdownBtn
            innerRef={shapeRef}
            open={shapeOpen}
            setOpen={setShapeOpen}
            icon={<RectIcon />}
            label="도형"
            items={[
              { id: 'background', icon: <RectIcon />, label: '배경 (단색·전체·맨 뒤)', action: insertBackground },
              { id: 'bgImage', icon: <ImageIcon />, label: '배경 이미지', action: () => bgImageInputRef.current?.click() },
              { id: 'bgVideo', icon: <VideoIcon />, label: '배경 영상', action: () => bgVideoInputRef.current?.click() },
              { id: 'rect', icon: <RectIcon />, label: '사각형', action: () => insertFlatPreset('rect') },
              { id: 'circle', icon: <CircleIcon />, label: '원', action: () => insertFlatPreset('circle') },
              { id: 'lineH', icon: <LineHIcon />, label: '가로 선', action: () => insertFlatPreset('lineH') },
              { id: 'lineV', icon: <LineVIcon />, label: '세로 선', action: () => insertFlatPreset('lineV') },
              { id: 'drawLine', icon: <DrawLineIcon />, label: '선 그리기', action: () => useFlatStore.getState().setDrawMode('line') },
              { id: 'drawPolyline', icon: <PolylineIcon />, label: '폴리라인', action: () => useFlatStore.getState().setDrawMode('polyline') },
              { id: 'drawPolygon', icon: <PolygonIcon />, label: '폴리곤', action: () => useFlatStore.getState().setDrawMode('polygon') },
            ]}
          />

          {/* 표 삽입 — 행×열 그리드 피커 */}
          <TableSizeDropdown
            innerRef={tableRef}
            open={tableOpen}
            setOpen={setTableOpen}
            onPick={insertTable}
          />

          <ToolBtn onClick={() => imageInputRef.current?.click()} title="이미지 추가">
            <ImageIcon /><span className="text-xs ml-1">이미지</span>
          </ToolBtn>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleImageFile}
          />
          <input ref={bgImageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBgImageFile} />
          <input ref={bgVideoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleBgVideoFile} />

          {/* 영상 드롭다운 (URL / 파일) */}
          <DropdownBtn
            innerRef={videoRef}
            open={videoOpen}
            setOpen={setVideoOpen}
            icon={<VideoIcon />}
            label="영상"
            items={[
              { id: 'vurl', icon: <span className="text-xs">🔗</span>, label: 'URL 입력', action: insertVideoUrl },
              { id: 'vfile', icon: <span className="text-xs">📁</span>, label: '파일 선택', action: () => videoInputRef.current?.click() },
            ]}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={handleVideoFile}
          />

          {/* 스니펫(데코 요소) — 섹션 그룹 + 미리보기 + 설명. 레이아웃 왼쪽 */}
          <SnippetMenu onPick={insertSnippet} />

          {/* 레이아웃 드롭다운 — 백지 시작 스캐폴딩 */}
          <DropdownBtn
            innerRef={layoutRef}
            open={layoutOpen}
            setOpen={setLayoutOpen}
            icon={<LayoutIcon />}
            label="레이아웃"
            // '빈 슬라이드'는 사실상 전체 삭제(복구 불가)라 메뉴에서 제외 — 전체선택→삭제로 대체
            items={SLIDE_LAYOUTS.filter(l => l.id !== 'blank').map(l => ({
              id: l.id, icon: <LayoutIcon />, label: l.name, action: () => insertLayout(l.id),
            }))}
          />

          {/* 테마 선택 */}
          <ThemeMenu />
        </>
      ) : (
        /* ── HTML 모드: 기존 삽입 드롭다운 ── */
        <HtmlInsertDropdown
          innerRef={insertRef}
          open={insertOpen}
          setOpen={setInsertOpen}
          disabled={!slideHtml}
          onInsert={(tag, attrs) => {
            const meta = selectedId ? elements.get(selectedId) : null
            const parentId = meta?.type === 'container' ? selectedId : null
            insertElement(parentId, tag, attrs)
            setInsertOpen(false)
          }}
        />
      )}

      {/* 그리기 모드 표시 */}
      {useFlatStore.getState().drawMode && (
        <>
          <Divider />
          <span className="text-xs text-indigo-300 px-2">
            {useFlatStore.getState().drawMode === 'line' ? '선 그리기' : useFlatStore.getState().drawMode === 'polyline' ? '폴리라인' : '폴리곤'}
            <span className="text-slate-500 ml-1">(ESC 취소)</span>
          </span>
          <ToolBtn onClick={() => useFlatStore.getState().setDrawMode(null)} title="그리기 취소">
            <span className="text-xs text-red-400">취소</span>
          </ToolBtn>
        </>
      )}

    </div>
  )
}


// ── 드롭다운 컴포넌트 ──

function DropdownBtn({ innerRef, open, setOpen, icon, label, items }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (innerRef.current && !innerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, innerRef, setOpen])

  return (
    <div ref={innerRef} style={{ position: 'relative' }}>
      <ToolBtn onClick={() => setOpen(v => !v)} title={label}>
        {icon}<span className="text-xs ml-1">{label}</span><ChevronDown />
      </ToolBtn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)', width: 130,
          background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 100, padding: '4px',
        }}>
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => { item.action(); setOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10 transition-colors"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 표 크기 그리드 피커 — 호버로 행×열 선택, 클릭으로 삽입
const TABLE_PICK_ROWS = 8
const TABLE_PICK_COLS = 8
function TableSizeDropdown({ innerRef, open, setOpen, onPick }) {
  const [hover, setHover] = useState({ r: 0, c: 0 })

  useEffect(() => {
    if (!open) return
    setHover({ r: 0, c: 0 })
    const handler = (e) => {
      if (innerRef.current && !innerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, innerRef, setOpen])

  const CELL = 18, GAP = 2
  return (
    <div ref={innerRef} style={{ position: 'relative' }}>
      <ToolBtn onClick={() => setOpen(v => !v)} title="표 추가">
        <TableIcon /><span className="text-xs ml-1">표</span><ChevronDown />
      </ToolBtn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 100, padding: 10,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${TABLE_PICK_COLS}, ${CELL}px)`, gap: GAP }}>
            {Array.from({ length: TABLE_PICK_ROWS * TABLE_PICK_COLS }, (_, i) => {
              const r = Math.floor(i / TABLE_PICK_COLS)
              const c = i % TABLE_PICK_COLS
              const active = r <= hover.r && c <= hover.c
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => { onPick(r + 1, c + 1); setOpen(false) }}
                  style={{
                    width: CELL, height: CELL, borderRadius: 3, cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: active ? 'rgba(99,102,241,0.65)' : 'rgba(255,255,255,0.05)',
                  }}
                />
              )
            })}
          </div>
          <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: '#cbd5e1' }}>
            {hover.r + 1} × {hover.c + 1}
          </div>
        </div>
      )}
    </div>
  )
}

function HtmlInsertDropdown({ innerRef, open, setOpen, disabled, onInsert }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (innerRef.current && !innerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, innerRef, setOpen])

  return (
    <div ref={innerRef} style={{ position: 'relative' }}>
      <ToolBtn onClick={() => setOpen(v => !v)} disabled={disabled} title="요소 삽입">
        <PlusIcon /><span className="text-xs ml-1">삽입</span>
      </ToolBtn>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
          transform: 'translateX(-50%)', width: 140,
          background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 100, padding: '4px',
        }}>
          {HTML_INSERT_ITEMS.map(item => (
            <button
              key={item.tag}
              onClick={() => onInsert(item.tag, item.attrs)}
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-white/10 transition-colors"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


// ── 유틸 ──

function parseVideoUrl(url) {
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
  if (m) return `https://www.youtube.com/embed/${m[1]}`
  m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (m) return `https://player.vimeo.com/video/${m[1]}`
  return url
}


// ── 아이콘 ──

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TextIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  )
}

function RectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  )
}

function LayoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="12" y1="9" x2="12" y2="21" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  )
}

function CircleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" />
    </svg>
  )
}

function DrawLineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20L20 4" />
      <circle cx="4" cy="20" r="2" fill="currentColor" />
      <circle cx="20" cy="4" r="2" fill="currentColor" />
    </svg>
  )
}

function PolylineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 20L9 8L15 16L21 4" />
    </svg>
  )
}

function PolygonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3L21 10L18 21H6L3 10Z" />
    </svg>
  )
}

function LineHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h18" />
    </svg>
  )
}

function LineVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v18" />
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-0.5 opacity-50">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
