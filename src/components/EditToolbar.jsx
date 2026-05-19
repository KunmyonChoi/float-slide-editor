import { useRef, useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import { nextFlatId } from '../core/FlatExtractor'
import { BlobStore } from '../core/BlobStore'
import { ToolBtn, Divider, UndoIcon, RedoIcon } from './FloatingToolbar'

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
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'cover',
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
          addFlatElement, setSelectedFlat,
          bringForward, sendBackward, bringToFront, sendToBack } = useFlatStore()
  const [insertOpen, setInsertOpen] = useState(false)
  const [shapeOpen, setShapeOpen] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const insertRef = useRef(null)
  const shapeRef = useRef(null)
  const videoRef = useRef(null)
  const imageInputRef = useRef(null)

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
    const el = {
      id: nextFlatId(),
      sourceId: null,
      ...p,
      styles: { ...p.styles },
      x: Math.round((canvasSize.w - p.width) / 2),
      y: Math.round((canvasSize.h - p.height) / 2),
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
          styles: { ...DEFAULT_STYLES, objectFit: 'cover' },
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
  const insertVideoUrl = useCallback(() => {
    const url = prompt('영상 URL을 입력하세요 (YouTube, Vimeo)')
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
              { id: 'rect', icon: <RectIcon />, label: '사각형', action: () => insertFlatPreset('rect') },
              { id: 'circle', icon: <CircleIcon />, label: '원', action: () => insertFlatPreset('circle') },
              { id: 'lineH', icon: <LineHIcon />, label: '가로 선', action: () => insertFlatPreset('lineH') },
              { id: 'lineV', icon: <LineVIcon />, label: '세로 선', action: () => insertFlatPreset('lineV') },
            ]}
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

      {/* z-순서 버튼 (flat/split 모드 + 단일 선택 시) */}
      {isFlatMode && selectedFlatIds.length === 1 && (
        <>
          <Divider />
          <ToolBtn onClick={() => sendToBack(selectedFlatIds[0])} title="맨 뒤로 (Ctrl+Shift+[)">
            <span className="text-xs">⤓</span>
          </ToolBtn>
          <ToolBtn onClick={() => sendBackward(selectedFlatIds[0])} title="뒤로 (Ctrl+[)">
            <span className="text-xs">↓</span>
          </ToolBtn>
          <ToolBtn onClick={() => bringForward(selectedFlatIds[0])} title="앞으로 (Ctrl+])">
            <span className="text-xs">↑</span>
          </ToolBtn>
          <ToolBtn onClick={() => bringToFront(selectedFlatIds[0])} title="맨 앞으로 (Ctrl+Shift+])">
            <span className="text-xs">⤒</span>
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
