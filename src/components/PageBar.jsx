import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'

/**
 * PageBar
 * 화면 하단 고정 페이지 컨트롤.
 * HTML / Flat / Split 모든 모드에서 동일하게 표시.
 * reveal.js 슬라이드일 경우 상하좌우 4방향 네비게이션 제공.
 */
export default function PageBar() {
  const { currentPage, totalPages, navigatePage, navigateDirection,
          isReveal, revealH, revealV, revealTotalH, revealTotalV,
          canLeft, canRight, canUp, canDown } = useEditorStore()

  // 전역 키보드: PageUp/PageDown + reveal.js 화살표
  useEffect(() => {
    const onKeyDown = (e) => {
      if (useEditorStore.getState().mode === 'present') return // 발표 모드에서는 각 Presenter가 처리
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.target.tagName === 'IFRAME') return

      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        const { isReveal } = useEditorStore.getState()
        if (isReveal && e.key === 'ArrowRight') navigateDirection('right')
        else navigatePage(1)
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const { isReveal } = useEditorStore.getState()
        if (isReveal && e.key === 'ArrowLeft') navigateDirection('left')
        else navigatePage(-1)
      } else if (e.key === 'ArrowUp') {
        const { isReveal } = useEditorStore.getState()
        if (isReveal) { e.preventDefault(); navigateDirection('up') }
      } else if (e.key === 'ArrowDown') {
        const { isReveal } = useEditorStore.getState()
        if (isReveal) { e.preventDefault(); navigateDirection('down') }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigatePage, navigateDirection])

  const handleLeft = useCallback(() => {
    if (isReveal) navigateDirection('left')
    else navigatePage(-1)
  }, [isReveal, navigateDirection, navigatePage])

  const handleRight = useCallback(() => {
    if (isReveal) navigateDirection('right')
    else navigatePage(1)
  }, [isReveal, navigateDirection, navigatePage])

  const handleUp = useCallback(() => navigateDirection('up'), [navigateDirection])
  const handleDown = useCallback(() => navigateDirection('down'), [navigateDirection])

  const mode = useEditorStore(s => s.mode)
  if (mode === 'present') return null
  if (totalPages <= 1 && !isReveal) return null

  const btnStyle = (enabled) => ({
    background: 'none',
    border: 'none',
    color: enabled ? '#94a3b8' : '#334155',
    cursor: enabled ? 'pointer' : 'default',
    fontSize: 16,
    padding: '0 6px',
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
  })

  // reveal.js: 4방향 컨트롤
  if (isReveal) {
    const canPrevH = canLeft
    const canNextH = canRight
    const canPrevV = canUp
    const canNextV = canDown
    const hasVertical = revealTotalV > 0

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 36,
        flexShrink: 0,
        background: '#0f172a',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {/* 좌 */}
        <button onClick={handleLeft} disabled={!canPrevH} style={btnStyle(canPrevH)} title="이전 슬라이드 (←)">
          &#9664;
        </button>

        {/* 상하 (수직 슬라이드가 있을 때만) */}
        {hasVertical && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <button onClick={handleUp} disabled={!canPrevV} style={{ ...btnStyle(canPrevV), height: 16, fontSize: 10 }} title="위 (↑)">
              &#9650;
            </button>
            <button onClick={handleDown} disabled={!canNextV} style={{ ...btnStyle(canNextV), height: 16, fontSize: 10 }} title="아래 (↓)">
              &#9660;
            </button>
          </div>
        )}

        {/* 페이지 표시 */}
        <span style={{
          color: '#94a3b8',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none',
          minWidth: 60,
          textAlign: 'center',
        }}>
          {hasVertical
            ? `${revealH + 1}.${revealV + 1} / ${revealTotalH}`
            : `${revealH + 1} / ${revealTotalH}`
          }
        </span>

        {/* 우 */}
        <button onClick={handleRight} disabled={!canNextH} style={btnStyle(canNextH)} title="다음 슬라이드 (→)">
          &#9654;
        </button>
      </div>
    )
  }

  // 일반 슬라이드: 좌우만
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      height: 36,
      flexShrink: 0,
      background: '#0f172a',
      borderTop: '1px solid rgba(255,255,255,0.06)',
    }}>
      <button
        onClick={handleLeft}
        disabled={currentPage <= 0}
        style={btnStyle(currentPage > 0)}
      >&#8249;</button>

      <span style={{
        color: '#94a3b8',
        fontSize: 13,
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
      }}>
        {currentPage + 1} / {totalPages}
      </span>

      <button
        onClick={handleRight}
        disabled={currentPage >= totalPages - 1}
        style={btnStyle(currentPage < totalPages - 1)}
      >&#8250;</button>
    </div>
  )
}
