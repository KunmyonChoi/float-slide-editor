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

  const isFlatMode = viewMode === 'flat' || viewMode === 'split'

  // 전역 키보드: PageUp/PageDown + 화살표
  useEffect(() => {
    const onKeyDown = (e) => {
      if (useEditorStore.getState().mode === 'present') return
      if (useFlatStore.getState()._preloading) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.tagName === 'IFRAME' && useFlatStore.getState().viewMode === 'html') return

      const vm = useFlatStore.getState().viewMode
      const isFM = vm === 'flat' || vm === 'split'

      // Ctrl+Shift+PageUp/Down: 페이지 순서 이동
      if (isFM && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        if (e.key === 'PageUp') { e.preventDefault(); useFlatStore.getState().movePageOrder(-1); return }
        if (e.key === 'PageDown') { e.preventDefault(); useFlatStore.getState().movePageOrder(1); return }
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
        const { isReveal } = useEditorStore.getState()
        if (isReveal && !isFM) { e.preventDefault(); navigateDirection('up') }
      } else if (e.key === 'ArrowDown') {
        const { isReveal } = useEditorStore.getState()
        if (isReveal && !isFM) { e.preventDefault(); navigateDirection('down') }
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
  if (isFlatMode && flatPageCount > 0) {
    const canPrev = flatCurrentPage > 0
    const canNext = flatCurrentPage < flatPageCount - 1
    return (
      <div style={barStyle}>
        <button onClick={() => useFlatStore.getState().navigateFlatPage(-1)} disabled={!canPrev} style={btnStyle(canPrev)}>&#8249;</button>
        <span style={pageLabel}>{flatCurrentPage + 1} / {flatPageCount}</span>
        <button onClick={() => useFlatStore.getState().navigateFlatPage(1)} disabled={!canNext} style={btnStyle(canNext)}>&#8250;</button>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button onClick={() => useFlatStore.getState().addPage()} style={{ ...btnStyle(true), fontSize: 14, width: 24, height: 24 }} title="페이지 추가">+</button>
        <button
          onClick={() => { if (flatPageCount > 1 && confirm('현재 페이지를 삭제하시겠습니까?')) useFlatStore.getState().deletePage() }}
          disabled={flatPageCount <= 1}
          style={{ ...btnStyle(flatPageCount > 1), fontSize: 14, width: 24, height: 24 }}
          title="페이지 삭제"
        >&minus;</button>
        <span style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button
          onClick={() => useFlatStore.getState().movePageOrder(-1)}
          disabled={flatCurrentPage <= 0}
          style={{ ...btnStyle(flatCurrentPage > 0), fontSize: 11, width: 24, height: 24 }}
          title="페이지 앞으로 이동 (Ctrl+Shift+PageUp)"
        >&#9664;</button>
        <button
          onClick={() => useFlatStore.getState().movePageOrder(1)}
          disabled={flatCurrentPage >= flatPageCount - 1}
          style={{ ...btnStyle(flatCurrentPage < flatPageCount - 1), fontSize: 11, width: 24, height: 24 }}
          title="페이지 뒤로 이동 (Ctrl+Shift+PageDown)"
        >&#9654;</button>
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
