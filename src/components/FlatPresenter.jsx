import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import FlatElementRenderer from './FlatElementRenderer'

/**
 * FlatPresenter — flat 편집 결과 기반 발표 모드
 * 전체화면, 편집 UI 없음, 페이지 네비게이션 (화살표/클릭)
 */
export default function FlatPresenter() {
  const exitPresentation = useEditorStore(s => s.exitPresentation)
  const stageRef = useRef(null)
  const [scale, setScale] = useState(1)
  const [hintVisible, setHintVisible] = useState(true)
  const [allPages, setAllPages] = useState(null)
  const [loading, setLoading] = useState(true)

  // 미방문 페이지 포함 전체 페이지 비동기 추출 (프리로드 완료 대기)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // 프리로드 중이면 완료될 때까지 대기
      while (useFlatStore.getState()._preloading) {
        await new Promise(r => setTimeout(r, 200))
        if (cancelled) return
      }
      const { pages } = await useFlatStore.getState().getAllPagesAsync()
      if (!cancelled) {
        setAllPages(pages)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const sortedKeys = useMemo(() => {
    if (!allPages) return []
    return Object.keys(allPages).sort((a, b) => {
      const [aP, aV] = a.split('-').map(Number)
      const [bP, bV] = b.split('-').map(Number)
      return aP - bP || aV - bV
    })
  }, [allPages])

  const [currentSlide, setCurrentSlide] = useState(0)
  const page = allPages?.[sortedKeys[currentSlide]]
  const elements = page?.elements || []
  const canvasSize = page?.canvasSize || { w: 1280, h: 720 }
  const fontImports = page?.fontImports || []

  const totalSlides = sortedKeys.length

  // 웹폰트 주입
  useEffect(() => {
    const allImports = new Set()
    for (const key of sortedKeys) {
      for (const imp of (allPages[key]?.fontImports || [])) allImports.add(imp)
    }
    const injected = []
    for (const imp of allImports) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        const href = urlMatch[1]
        if (document.querySelector(`link[href="${href}"]`)) continue
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.dataset.flatPresent = 'true'
        document.head.appendChild(link)
        injected.push(link)
      }
    }
    return () => { for (const el of injected) el.remove() }
  }, [allPages, sortedKeys])

  // 스케일 계산 (뷰포트 전체)
  const recalcScale = useCallback(() => {
    const sw = window.innerWidth
    const sh = window.innerHeight
    const s = Math.min(sw / canvasSize.w, sh / canvasSize.h)
    setScale(s)
  }, [canvasSize])

  useEffect(() => {
    recalcScale()
    window.addEventListener('resize', recalcScale)
    return () => window.removeEventListener('resize', recalcScale)
  }, [recalcScale])

  // 네비게이션
  const goNext = useCallback(() => {
    setCurrentSlide(c => Math.min(c + 1, totalSlides - 1))
  }, [totalSlides])

  const goPrev = useCallback(() => {
    setCurrentSlide(c => Math.max(c - 1, 0))
  }, [])

  // 키보드: ESC 종료, 화살표/스페이스 네비게이션
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        exitPresentation()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // iframe에 포커스가 남아있을 수 있으므로 iframe 내부에도 리스닝
    const iframe = useEditorStore.getState().iframeRef?.current
    const iframeDoc = iframe?.contentDocument
    iframeDoc?.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      iframeDoc?.removeEventListener('keydown', onKeyDown)
    }
  }, [exitPresentation, goNext, goPrev])

  // 클릭: 좌측 1/4 → 이전, 우측 3/4 → 다음
  const handleClick = useCallback((e) => {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (x < rect.width * 0.25) goPrev()
    else goNext()
  }, [goNext, goPrev])

  // 힌트 자동 숨기기
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 2500)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: '#000',
        cursor: 'none',
      }}
      onClick={handleClick}
    >
      {/* 로딩 중 */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>페이지 로딩 중...</span>
        </div>
      )}

      {/* 슬라이드 캔버스 */}
      {!loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: canvasSize.w,
          height: canvasSize.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
          background: '#fff',
        }}>
          <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
            {elements.map(el => (
              <FlatElementRenderer
                key={el.id}
                element={el}
                isSelected={false}
                isEditing={false}
                scale={scale}
              />
            ))}
          </div>
        </div>
      )}

      {/* 페이지 카운터 (다중 페이지만) */}
      {totalSlides > 1 && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12, color: 'rgba(255,255,255,0.3)',
          zIndex: 1010, pointerEvents: 'none',
        }}>
          {currentSlide + 1} / {totalSlides}
        </div>
      )}

      {/* ESC 힌트 */}
      <div
        onClick={(e) => { e.stopPropagation(); exitPresentation() }}
        style={{
          position: 'fixed', bottom: 24, left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1010,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 16px', borderRadius: 12, cursor: 'pointer',
          background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.07)',
          opacity: hintVisible ? 1 : 0, transition: 'opacity 0.5s',
          pointerEvents: hintVisible ? 'all' : 'none',
        }}
      >
        <span style={{ fontSize: 12, color: '#94a3b8' }}>발표 모드</span>
        <kbd style={{ fontSize: 11, background: 'rgba(255,255,255,0.1)',
                      color: '#cbd5e1', padding: '2px 6px', borderRadius: 4,
                      fontFamily: 'monospace' }}>ESC</kbd>
        <span style={{ fontSize: 12, color: '#64748b' }}>편집으로 복귀</span>
      </div>
    </div>
  )
}
