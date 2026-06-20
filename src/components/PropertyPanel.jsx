import { useRef, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'
import HtmlPropertyContent from './HtmlPropertyContent'
import FlatPropertyContent from './FlatPropertyContent'

/**
 * PropertyPanel — 통합 속성 패널
 * panelMode에 따라 FloatingShell(플로팅) 또는 DockedShell(도킹)로 렌더링.
 * viewMode에 따라 HTML 콘텐츠 또는 Flat 콘텐츠를 표시.
 */
export default function PropertyPanel() {
  const panelMode = useFlatStore(s => s.panelMode)
  const viewMode = useFlatStore(s => s.viewMode)
  const mode = useEditorStore(s => s.mode)

  // split 모드: 선택된 쪽의 콘텐츠 표시
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatIds = useFlatStore(s => s.selectedFlatIds)

  if (mode === 'present') return null

  let showHtml
  if (viewMode === 'html') showHtml = true
  else if (viewMode === 'flat') showHtml = false
  else showHtml = !!selectedId && selectedFlatIds.length === 0 // split: HTML 선택만 있을 때

  const content = showHtml ? <HtmlPropertyContent /> : <FlatPropertyContent />

  if (panelMode === 'floating') {
    return <FloatingShell showHtml={showHtml}>{content}</FloatingShell>
  }
  return <DockedShell>{content}</DockedShell>
}

// ── 플로팅 셸 ───────────────────────────────────────

function FloatingShell({ children, showHtml }) {
  const panelRef = useRef(null)
  const dragging = useRef(null)
  const floatingPos = useFlatStore(s => s.floatingPos)
  const setFloatingPos = useFlatStore(s => s.setFloatingPos)

  // 선택 여부로 가시성 결정 (flat 모드: 선택 없어도 배경 패널 표시)
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatIds = useFlatStore(s => s.selectedFlatIds)
  const viewMode = useFlatStore(s => s.viewMode)
  const isFlatMode = viewMode === 'flat' || viewMode === 'split'
  const hasSelection = isFlatMode || (showHtml ? !!selectedId : selectedFlatIds.length > 0)

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return
      const newPos = {
        x: Math.min(Math.max(0, e.clientX - dragging.current.startX), window.innerWidth - 260),
        y: Math.min(Math.max(0, e.clientY - dragging.current.startY), window.innerHeight - 100),
      }
      setFloatingPos(newPos)
    }
    const onUp = () => { dragging.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setFloatingPos])

  const handleMouseDown = (e) => {
    if (e.target.closest('[data-no-drag]')) return
    dragging.current = {
      startX: e.clientX - (floatingPos.x ?? window.innerWidth - 280),
      startY: e.clientY - floatingPos.y,
    }
    e.preventDefault()
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-40 w-60 rounded-xl overflow-hidden select-none"
      style={{
        right: floatingPos.x === null ? 16 : 'auto',
        left: floatingPos.x !== null ? floatingPos.x : 'auto',
        top: floatingPos.y,
        opacity: hasSelection ? 1 : 0,
        transform: hasSelection ? 'translateX(0) scale(1)' : 'translateX(16px) scale(0.97)',
        pointerEvents: hasSelection ? 'all' : 'none',
        transition: 'opacity 0.2s, transform 0.2s',
        background: 'rgba(15,23,42,0.9)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* 드래그 핸들 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5 cursor-grab active:cursor-grabbing">
        <span className="text-xs font-medium text-slate-400">속성</span>
        <GripIcon />
      </div>

      <div className="overflow-y-auto thin-scrollbar" style={{ maxHeight: 'calc(100vh - 160px)' }} data-no-drag>
        {children}
      </div>
      {!showHtml && <DeleteFooter />}
    </div>
  )
}

// ── 도킹 셸 ────────────────────────────────────────

function DockedShell({ children }) {
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatIds = useFlatStore(s => s.selectedFlatIds)
  const viewMode = useFlatStore(s => s.viewMode)
  const collapsed = useFlatStore(s => s.panelCollapsed)
  const toggleCollapsed = useFlatStore(s => s.togglePanelCollapsed)
  const isFlatMode = viewMode === 'flat' || viewMode === 'split'
  // Flat 모드: 선택 없어도 슬라이드 배경 패널 표시
  const showContent = isFlatMode || !!selectedId || selectedFlatIds.length > 0

  const shell = {
    background: 'rgba(15,23,42,0.9)',
    backdropFilter: 'blur(16px)',
    borderLeft: '1px solid rgba(255,255,255,0.08)',
  }

  // 접힘: 얇은 띠 + 펼치기 버튼
  if (collapsed) {
    return (
      <div className="shrink-0 flex flex-col items-center pt-2" style={{ width: 32, ...shell }}>
        <button
          onClick={toggleCollapsed}
          title="속성 패널 펼치기"
          className="w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
        >
          <ChevronLeftIcon />
        </button>
        <span className="mt-2 text-[10px] text-slate-500" style={{ writingMode: 'vertical-rl' }}>속성</span>
      </div>
    )
  }

  return (
    <div className="shrink-0 flex flex-col" style={{ width: 260, ...shell }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 shrink-0">
        <span className="text-xs font-medium text-slate-400">속성</span>
        <button
          onClick={toggleCollapsed}
          title="속성 패널 접기"
          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors"
        >
          <ChevronRightIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scrollbar">
        {showContent ? children : (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-slate-600">요소를 선택하세요</span>
          </div>
        )}
      </div>
      {isFlatMode && <DeleteFooter />}
    </div>
  )
}

// 선택 요소 삭제 — 스크롤 영역 밖(패널 푸터)에 항상 표시
function DeleteFooter() {
  const selectedFlatIds = useFlatStore(s => s.selectedFlatIds)
  const removeSelectedElements = useFlatStore(s => s.removeSelectedElements)
  const n = selectedFlatIds.length
  if (n === 0) return null
  return (
    <div className="shrink-0 px-3 py-2 border-t border-white/10">
      <button
        onClick={removeSelectedElements}
        className="flex items-center justify-center w-full text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg px-2.5 py-1.5 border border-red-500/20 transition-colors"
      >
        <TrashIcon />
        <span className="ml-1">{n > 1 ? `${n}개 삭제` : '삭제'}</span>
      </button>
    </div>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

// ── 아이콘 ─────────────────────────────────────────

function GripIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="text-slate-600">
      {[0, 4, 8].map(y =>
        [0, 4, 8].map(x => (
          <circle key={`${x}-${y}`} cx={x + 2} cy={y + 2} r="1" />
        ))
      )}
    </svg>
  )
}
