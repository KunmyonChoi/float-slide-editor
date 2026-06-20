import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useFlatStore } from '../store/flatStore'

/**
 * PageBar
 * 화면 하단 고정 페이지 컨트롤.
 * Flat 모드: flatStore 기반 페이지 관리 (추가/삭제 포함)
 * HTML 모드: editorStore 기반 iframe 네비게이션
 */
export default function PageBar() {
  const { currentPage, totalPages, navigatePage, navigateDirection,
          isReveal, revealH, revealV, revealTotalH, revealTotalV,
          canLeft, canRight, canUp, canDown } = useEditorStore()
  const mode = useEditorStore(s => s.mode)
  const preloading = useFlatStore(s => s._preloading)
  const viewMode = useFlatStore(s => s.viewMode)
  const flatPageCount = useFlatStore(s => s.flatPageCount)
  const flatCurrentPage = useFlatStore(s => s.flatCurrentPage)
  const notesCollapsed = useFlatStore(s => s.notesCollapsed)

  const isFlatMode = viewMode === 'flat' || viewMode === 'split'

  // 전역 키보드: PageUp/PageDown + 화살표
  useEffect(() => {
    const onKeyDown = (e) => {
      if (useEditorStore.getState().mode === 'present') return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.tagName === 'IFRAME' && useFlatStore.getState().viewMode === 'html') return

      const vm = useFlatStore.getState().viewMode
      const isFM = vm === 'flat' || vm === 'split'
      // 프리로드(백그라운드 일괄 변환) 중에는 순수 flat 페이지 이동만 허용.
      // 구조 변경(Ctrl+조합)·split/html iframe 조작은 프리로드와 충돌하므로 차단.
      const isPlainNavKey = !e.ctrlKey && !e.metaKey &&
        ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)
      if (useFlatStore.getState()._preloading && !(vm === 'flat' && isPlainNavKey)) return

      // Ctrl+Shift+PageUp/Down: 페이지 순서 이동
      if (isFM && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'PageUp') { e.preventDefault(); useFlatStore.getState().movePageOrder(-1); return }
        if (e.key === 'PageDown') { e.preventDefault(); useFlatStore.getState().movePageOrder(1); return }
      }

      // Ctrl+M: 페이지 추가 / Ctrl+Shift+M: 현재 페이지 삭제 (flat 모드, 편집 중 제외)
      if (isFM && (e.ctrlKey || e.metaKey) && e.code === 'KeyM') {
        e.preventDefault()
        if (useFlatStore.getState().editingFlatId) return
        if (e.shiftKey) {
          const fc = useFlatStore.getState().flatPageCount
          if (fc > 1) useFlatStore.getState().deletePage() // 복구 토스트 제공 → 확인창 불필요
        } else {
          useFlatStore.getState().addPage('titleContent')
        }
        return
      }

      // Flat 모드에서 Arrow는: 요소 선택 시 이동용, Shift+Arrow도 10px 이동용 → 페이지 이동 스킵
      const isArrow = ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown'].includes(e.key)
      if (isArrow && isFM) {
        const { selectedFlatIds, editingFlatId } = useFlatStore.getState()
        if (selectedFlatIds.length > 0 || editingFlatId) return
      }

      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (isFM) { useFlatStore.getState().navigateFlatPage(1) }
        else {
          const { isReveal } = useEditorStore.getState()
          if (isReveal && e.key === 'ArrowRight') navigateDirection('right')
          else navigatePage(1)
        }
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        if (isFM) { useFlatStore.getState().navigateFlatPage(-1) }
        else {
          const { isReveal } = useEditorStore.getState()
          if (isReveal && e.key === 'ArrowLeft') navigateDirection('left')
          else navigatePage(-1)
        }
      } else if (e.key === 'ArrowUp') {
        // flat 모드: 위 = 이전 페이지. HTML(reveal) 2D 덱은 기존대로 방향 이동.
        if (isFM) { e.preventDefault(); useFlatStore.getState().navigateFlatPage(-1) }
        else {
          const { isReveal } = useEditorStore.getState()
          if (isReveal) { e.preventDefault(); navigateDirection('up') }
        }
      } else if (e.key === 'ArrowDown') {
        // flat 모드: 아래 = 다음 페이지.
        if (isFM) { e.preventDefault(); useFlatStore.getState().navigateFlatPage(1) }
        else {
          const { isReveal } = useEditorStore.getState()
          if (isReveal) { e.preventDefault(); navigateDirection('down') }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigatePage, navigateDirection])

  const handleLeft = useCallback(() => {
    if (preloading) return
    if (isReveal) navigateDirection('left')
    else navigatePage(-1)
  }, [isReveal, navigateDirection, navigatePage, preloading])

  const handleRight = useCallback(() => {
    if (preloading) return
    if (isReveal) navigateDirection('right')
    else navigatePage(1)
  }, [isReveal, navigateDirection, navigatePage, preloading])

  const handleUp = useCallback(() => navigateDirection('up'), [navigateDirection])
  const handleDown = useCallback(() => navigateDirection('down'), [navigateDirection])

  // 발표 모드에서는 숨김
  if (mode === 'present') return null

  const btnStyle = (enabled) => ({
    background: 'none', border: 'none',
    color: enabled ? '#94a3b8' : '#334155',
    cursor: enabled ? 'pointer' : 'default',
    fontSize: 16, padding: '0 6px', lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28,
  })

  const barStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 36, flexShrink: 0,
    background: '#0f172a', borderTop: '1px solid rgba(255,255,255,0.06)',
  }

  const pageLabel = { color: '#94a3b8', fontSize: 13, fontVariantNumeric: 'tabular-nums', userSelect: 'none' }

  // ── Flat 모드: flatStore 기반 ──
  // 페이지 이동·순서변경은 슬라이드 목록 패널에서 직접 하므로 하단 바에는 두지 않음.
  // 페이지 표시 + 추가/삭제만 유지.
  if (isFlatMode && flatPageCount > 0) {
    return (
      <div style={{ ...barStyle, position: 'relative' }}>
        {/* 발표자 노트 토글 — 라인 좌측 끝 */}
        <button
          onClick={() => useFlatStore.getState().toggleNotesCollapsed()}
          title={(notesCollapsed ? '발표자 노트 열기' : '발표자 노트 닫기') + '  ( \\ )'}
          style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            display: 'flex', alignItems: 'center', gap: 4, height: 24, padding: '0 8px',
            background: notesCollapsed ? 'transparent' : 'rgba(99,102,241,0.18)',
            border: '1px solid ' + (notesCollapsed ? 'rgba(255,255,255,0.08)' : 'rgba(99,102,241,0.35)'),
            borderRadius: 6, cursor: 'pointer',
            color: notesCollapsed ? '#94a3b8' : '#a5b4fc', fontSize: 12, lineHeight: 1,
          }}
        >
          <NoteIcon /> 노트
        </button>
        <span style={pageLabel}>{flatCurrentPage + 1} / {flatPageCount}</span>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button onClick={() => useFlatStore.getState().addPage('titleContent')} style={{ ...btnStyle(true), fontSize: 14, width: 24, height: 24 }} title="페이지 추가 (Ctrl+M)">+</button>
        <button
          onClick={() => { if (flatPageCount > 1) useFlatStore.getState().deletePage() }}
          disabled={flatPageCount <= 1}
          style={{ ...btnStyle(flatPageCount > 1), fontSize: 14, width: 24, height: 24 }}
          title="페이지 삭제 (Ctrl+Shift+M)"
        >&minus;</button>
      </div>
    )
  }

  // ── Reveal.js: 4방향 컨트롤 ──
  if (isReveal) {
    const hasVertical = revealTotalV > 0
    return (
      <div style={barStyle}>
        <button onClick={handleLeft} disabled={!canLeft} style={btnStyle(canLeft)}>&#9664;</button>
        {hasVertical && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <button onClick={handleUp} disabled={!canUp} style={{ ...btnStyle(canUp), height: 16, fontSize: 10 }}>&#9650;</button>
            <button onClick={handleDown} disabled={!canDown} style={{ ...btnStyle(canDown), height: 16, fontSize: 10 }}>&#9660;</button>
          </div>
        )}
        <span style={{ ...pageLabel, minWidth: 60, textAlign: 'center' }}>
          {hasVertical ? `${revealH + 1}.${revealV + 1} / ${revealTotalH}` : `${revealH + 1} / ${revealTotalH}`}
        </span>
        <button onClick={handleRight} disabled={!canRight} style={btnStyle(canRight)}>&#9654;</button>
      </div>
    )
  }

  // ── 일반 HTML 슬라이드 ──
  if (totalPages <= 1) return null
  return (
    <div style={{ ...barStyle, gap: 12 }}>
      <button onClick={handleLeft} disabled={currentPage <= 0} style={btnStyle(currentPage > 0)}>&#8249;</button>
      <span style={pageLabel}>{currentPage + 1} / {totalPages}</span>
      <button onClick={handleRight} disabled={currentPage >= totalPages - 1} style={btnStyle(currentPage < totalPages - 1)}>&#8250;</button>
    </div>
  )
}

function NoteIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M4 4h16v12l-4 4H4z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="12" y2="13" />
    </svg>
  )
}
