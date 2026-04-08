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

  if (mode === 'present') return null

  // split 모드: 선택된 쪽의 콘텐츠 표시
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatId = useFlatStore(s => s.selectedFlatId)

  let showHtml
  if (viewMode === 'html') showHtml = true
  else if (viewMode === 'flat') showHtml = false
  else showHtml = !!selectedId && !selectedFlatId // split: HTML 선택만 있을 때

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

  // 선택 여부로 가시성 결정
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatId = useFlatStore(s => s.selectedFlatId)
  const hasSelection = showHtml ? !!selectedId : !!selectedFlatId

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

      <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }} data-no-drag>
        {children}
      </div>
    </div>
  )
}

// ── 도킹 셸 ────────────────────────────────────────

function DockedShell({ children }) {
  const selectedId = useEditorStore(s => s.selectedId)
  const selectedFlatId = useFlatStore(s => s.selectedFlatId)
  const hasSelection = !!selectedId || !!selectedFlatId

  return (
    <div
      className="shrink-0 overflow-y-auto"
      style={{
        width: 260,
        background: 'rgba(15,23,42,0.9)',
        backdropFilter: 'blur(16px)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {hasSelection ? children : (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-slate-600">요소를 선택하세요</span>
        </div>
      )}
    </div>
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
