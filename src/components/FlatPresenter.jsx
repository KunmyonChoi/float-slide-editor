import { useState, useEffect, useCallback, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import PresentedSlide from './PresentedSlide'
import PresenterToolbar from './PresenterToolbar'
import { usePresentationEngine } from '../core/usePresentationEngine'
import { useWebFontImports } from '../core/useWebFontImports'
import { useWakeLock } from '../core/useWakeLock'

/**
 * FlatPresenter — 단일 화면 발표(현재 창을 전체화면으로).
 *
 * 발표 상태는 usePresentationEngine이, 그리기는 PresentedSlide가 맡는다.
 * 듀얼 모니터 발표자 창(SpeakerView)도 같은 엔진·같은 렌더러를 쓰므로
 * 두 경로에서 슬라이드가 다르게 보일 일이 없다.
 */
export default function FlatPresenter() {
  const exitPresentation = useEditorStore(s => s.exitPresentation)
  const stageRef = useRef(null)
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [hintVisible, setHintVisible] = useState(true)

  const eng = usePresentationEngine({ onExit: exitPresentation })
  const { canvasSize, loading, loadingCaptions, penActive, totalSlides, currentSlide, setAudioEl } = eng

  // 배율 = 뷰포트에 슬라이드를 꽉 채우는 값. 창 크기만 상태로 두고 배율은 파생값으로 —
  // 이펙트에서 곧바로 setState를 부르면 마운트마다 렌더가 한 번 더 돈다.
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const scale = Math.min(viewport.w / canvasSize.w, viewport.h / canvasSize.h)

  // 키보드 — 창 + iframe 양쪽에 리스닝(발표 진입 시 포커스가 iframe에 남아있을 수 있다)
  useEffect(() => {
    const onKeyDown = eng.handleKeyDown
    window.addEventListener('keydown', onKeyDown)
    const iframe = useEditorStore.getState().iframeRef?.current
    const iframeDoc = iframe?.contentDocument
    iframeDoc?.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      iframeDoc?.removeEventListener('keydown', onKeyDown)
    }
  }, [eng.handleKeyDown])

  // 클릭: 좌측 1/4 → 이전, 우측 3/4 → 다음
  // iframe/video/a 등 인터랙티브 요소 위의 클릭은 무시
  const handleClick = useCallback((e) => {
    if (penActive) return // 펜 모드 중 클릭은 드로잉(오버레이가 처리), 네비 안 함
    const tag = e.target.tagName
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'A' || tag === 'BUTTON') return
    if (e.target.closest('iframe, video, a, button')) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (x < rect.width * 0.25) eng.goPrev()
    else eng.goNext()
  }, [eng, penActive])

  // 힌트 자동 숨기기
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 2500)
    return () => clearTimeout(t)
  }, [])

  // 발표 중에는 화면이 어두워지지 않게 붙든다(모바일 자동 밝기·절전)
  useWakeLock(true)

  // 웹폰트 주입
  useWebFontImports(eng.allPages, eng.sortedKeys)

  return (
    <div
      ref={stageRef}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: '#000',
        cursor: 'default', // 발표 중 포인터 항상 표시(숨기지 않음)
      }}
      onClick={handleClick}
    >
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
            {loadingCaptions ? '자막 준비 중...' : '페이지 로딩 중...'}
          </span>
        </div>
      )}

      {!loading && (
        <PresentedSlide
          slideKey={currentSlide}
          page={eng.page}
          elements={eng.elements}
          animInfo={eng.animInfo}
          revealed={eng.revealed}
          playingStep={eng.playingStep}
          scale={scale}
          canvasSize={canvasSize}
          penActive={penActive}
          penTool={eng.penTool}
          penColor={eng.penColor}
          penWidth={eng.penWidth}
          // 단일 화면에서는 블랙아웃이 펜 모드의 하위 기능이다(기존 동작 유지)
          blackout={penActive && eng.blackout}
          strokes={eng.slideStrokes}
          onCommitStroke={eng.commitStroke}
          onEraseStroke={eng.eraseStroke}
          captionWords={eng.captionsOn && eng.hasAudio ? eng.captionWords : null}
          getAudioTime={eng.getAudioTime}
        />
      )}

      {/* 노트 음성 재생기(숨김) */}
      <audio ref={setAudioEl} onEnded={eng.onAudioEnded} />

      {!loading && <PresenterToolbar eng={eng} />}

      {/* 페이지 카운터 (다중 페이지만) */}
      {totalSlides > 1 && (
        <div style={{
          position: 'fixed', bottom: 60, left: '50%',
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

      {/* 우하단 발표 끝내기 — 항상 클릭 가능 (힌트가 사라져도) */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); exitPresentation() }}
        title="발표 끝내기 (ESC)"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 1011,
          width: 40, height: 40, borderRadius: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1',
          cursor: 'pointer', opacity: 0.4, transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.4' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="6" y1="6" x2="18" y2="18" /><line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      </button>
    </div>
  )
}
