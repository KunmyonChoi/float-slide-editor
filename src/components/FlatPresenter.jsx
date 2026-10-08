import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import PresentedSlide from './PresentedSlide'
import PresenterToolbar from './PresenterToolbar'
import BgmPlayer from './BgmPlayer'
import { usePresentationEngine } from '../core/usePresentationEngine'
import { useWebFontImports } from '../core/useWebFontImports'
import { useWakeLock } from '../core/useWakeLock'
import { captionSpaceBelow as captionSpaceBelowOf } from '../core/captionPlacement'
import { formatElapsed } from '../core/videoExport'

// 영상 녹화 중 화면 아래에 비워 두는 REC 표시줄 높이(px) — 슬라이드는 그 위 영역에만 그려서
// 녹화(슬라이드 영역만 잘라 담는다)에 표시줄·정지 버튼이 절대 비치지 않게 한다.
const REC_BAR_H = 44

/**
 * FlatPresenter — 단일 화면 발표(현재 창을 전체화면으로).
 *
 * 발표 상태는 usePresentationEngine이, 그리기는 PresentedSlide가 맡는다.
 * 듀얼 모니터 발표자 창(SpeakerView)도 같은 엔진·같은 렌더러를 쓰므로
 * 두 경로에서 슬라이드가 다르게 보일 일이 없다.
 */
export default function FlatPresenter() {
  const exitPresentation = useEditorStore(s => s.exitPresentation)
  const requestStopRecording = useEditorStore(s => s.requestStopVideoRecording)
  const recordingOn = useEditorStore(s => !!s.videoRecording)
  const stageRef = useRef(null)
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [hintVisible, setHintVisible] = useState(true)

  // 녹화 중 Esc는 발표 종료가 아니라 '녹화 정지(지금까지 저장)' — 정리는 녹화기가 맡는다.
  const eng = usePresentationEngine({ onExit: recordingOn ? requestStopRecording : exitPresentation })
  const { canvasSize, loading, loadingCaptions, penActive, totalSlides, currentSlide, setAudioEl } = eng
  const recording = eng.recording

  // 배율 = 뷰포트에 슬라이드를 꽉 채우는 값. 창 크기만 상태로 두고 배율은 파생값으로 —
  // 이펙트에서 곧바로 setState를 부르면 마운트마다 렌더가 한 번 더 돈다.
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // 녹화 중에는 아래 REC 표시줄 자리를 빼고 그 위에 슬라이드를 맞춘다.
  const stageH = recording ? Math.max(1, viewport.h - REC_BAR_H) : viewport.h
  const scale = Math.min(viewport.w / canvasSize.w, stageH / canvasSize.h)
  // 슬라이드 비율과 화면 비율이 달라 아래에 남는 여백 — 넓으면 자막이 그리 내려간다.
  const captionSpaceBelow = useMemo(
    () => captionSpaceBelowOf({ w: viewport.w, h: stageH }, canvasSize, scale),
    [viewport.w, stageH, canvasSize, scale])

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
    if (recording) return // 녹화 중에는 클릭으로 넘기지 않는다(엔진이 자동으로 흘려보낸다)
    if (penActive) return // 펜 모드 중 클릭은 드로잉(오버레이가 처리), 네비 안 함
    const tag = e.target.tagName
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'A' || tag === 'BUTTON') return
    if (e.target.closest('iframe, video, a, button')) return
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    if (x < rect.width * 0.25) eng.goPrev()
    else eng.goNext()
  }, [eng, penActive, recording])

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
        // 녹화: 아래 REC 표시줄 자리를 비우고, 슬라이드 위 포인터는 숨긴다
        ...(recording ? { bottom: REC_BAR_H, cursor: 'none' } : {}),
      }}
      onClick={handleClick}
    >
      {/* 녹화 시작 대기 — 덱은 준비됐지만 아직 틀지 않는다. 녹화기가 잘라 낼 자리만 검게 잡아 둔다. */}
      {recording && eng.recordHold && !eng.deckLoading && (
        <div data-present-stage="" style={{
          position: 'absolute', top: '50%', left: '50%',
          width: canvasSize.w, height: canvasSize.h,
          transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center center',
          background: '#000',
        }} />
      )}

      {loading && !recording && (
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
          // 녹화는 슬라이드 영역만 담으므로 자막을 아래 여백이 아니라 슬라이드 위에 그린다
          captionSpaceBelow={recording ? 0 : captionSpaceBelow}
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
          stageMarker={recording}
        />
      )}

      {/* 노트 음성 재생기(숨김) */}
      <audio ref={setAudioEl} onEnded={eng.onAudioEnded} onError={eng.onAudioError} />
      {/* 여러 장에 걸쳐 흐르는 BGM — 슬라이드 밖에서 재생해 장이 바뀌어도 끊기지 않게 */}
      {!eng.loading && <BgmPlayer element={eng.bgm} duck={eng.narrationPlaying} />}

      {!loading && !recording && <PresenterToolbar eng={eng} />}

      {/* 페이지 카운터 (다중 페이지만) */}
      {totalSlides > 1 && !recording && (
        <div style={{
          position: 'fixed', bottom: 60, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 12, color: 'rgba(255,255,255,0.3)',
          zIndex: 1010, pointerEvents: 'none',
        }}>
          {currentSlide + 1} / {totalSlides}
        </div>
      )}

      {recording && <RecordingBar onStop={requestStopRecording} />}

      {/* ESC 힌트 */}
      {!recording && <div
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
      </div>}

      {/* 우하단 발표 끝내기 — 항상 클릭 가능 (힌트가 사라져도) */}
      {!recording && <button
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
      </button>}
    </div>
  )
}

/**
 * RecordingBar — 영상 녹화 중 화면 맨 아래 띠(슬라이드 영역 밖이라 녹화에 비치지 않는다).
 * REC 경과 시간 · 소리 없음 안내 · 정지(지금까지 저장).
 */
function RecordingBar({ onStop }) {
  const rec = useEditorStore(s => s.videoRecording)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  const startedAt = rec?.startedAt || 0
  const elapsed = startedAt ? now - startedAt : 0
  const label = !startedAt ? '녹화 준비 중…'
    : rec?.phase === 'finished' ? '마무리 중…'
      : rec?.phase === 'stopping' ? '저장 중…' : 'REC'
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, height: REC_BAR_H, zIndex: 1012,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        background: '#0b1120', borderTop: '1px solid rgba(255,255,255,0.08)',
        color: '#e2e8f0', fontSize: 12, userSelect: 'none',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: '50%', background: '#ef4444',
        animation: startedAt ? 'fe-rec-blink 1s steps(2, start) infinite' : undefined,
        opacity: startedAt ? 1 : 0.4,
      }} />
      <span style={{ fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#cbd5e1' }}>{formatElapsed(elapsed)}</span>
      {rec?.noAudio && (
        <span style={{ color: '#fbbf24' }}>소리 없음 — 탭 오디오가 공유되지 않았습니다</span>
      )}
      <button
        type="button"
        onClick={onStop}
        title="녹화 정지 (ESC) — 지금까지 저장"
        style={{
          marginLeft: 8, padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
          background: 'rgba(239,68,68,0.9)', color: '#fff', border: 'none', fontSize: 12,
        }}
      >정지</button>
      <style>{`@keyframes fe-rec-blink { to { visibility: hidden } }`}</style>
    </div>
  )
}
