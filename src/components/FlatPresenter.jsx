import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import FlatElementRenderer from './FlatElementRenderer'
import PresenterInkOverlay from './PresenterInkOverlay'
import KaraokeCaptions from './KaraokeCaptions'
import { resolveConnectors } from '../core/ConnectorRouting'
import { BlobStore } from '../core/BlobStore'
import { computeSteps, isHiddenAt, animationCss, directionVars, stepDurations } from '../core/slideAnimation'
import { transcribeSpeech } from '../core/SttClient'
import { getCachedTranscript, setCachedTranscript } from '../core/transcriptCache'
import { hasApiKey } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'

const INK_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#ffffff', '#111827']
// 펜 툴바 그룹(도구/팔레트/굵기) — nowrap로 묶어 그룹 내부는 줄바꿈되지 않게
const TOOL_CLUSTER = { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }
// 매크로 그룹 — 좁을 때 이 경계에서만 줄바꿈(넓으면 한 줄):
//  ① 도구+팔레트  ② 굵기+휴지통+블랙아웃+종료
const TOOL_MACRO = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap' }

// 슬라이드 전환 → CSS animation 문자열 (없으면 undefined). 들어오는 슬라이드에 적용.
const TRANSITION_KEYFRAMES = { fade: 'feSlideFade', slide: 'feSlideSlide', zoom: 'feSlideZoom' }
export function slideTransitionCss(t) {
  if (!t || !TRANSITION_KEYFRAMES[t.type]) return undefined
  const dur = Math.max(50, t.durationMs || 400)
  return `${TRANSITION_KEYFRAMES[t.type]} ${dur}ms ease-out`
}

// 슬라이드 전환 방향 변수(slide 타입만) — 화살표 = 들어오는 슬라이드가 이동하는 방향.
// (시작 오프셋은 이동 방향의 반대편; from=offset → to=0으로 애니메이션)
const SLIDE_OFF = '30%'
export function slideTransitionVars(t) {
  if (!t || t.type !== 'slide') return null
  switch (t.dir) {
    case 'left': return { '--fe-sx': SLIDE_OFF, '--fe-sy': '0' }        // ← 왼쪽으로 이동
    case 'up': return { '--fe-sx': '0', '--fe-sy': SLIDE_OFF }          // ↑ 위로 이동
    case 'down': return { '--fe-sx': '0', '--fe-sy': `-${SLIDE_OFF}` }  // ↓ 아래로 이동
    case 'right':
    default: return { '--fe-sx': `-${SLIDE_OFF}`, '--fe-sy': '0' }      // → 오른쪽으로 이동(기본)
  }
}

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

  // ── 발표 잉크(펜 주석) — 임시: 슬라이드별 보관, 종료(언마운트) 시 폐기 ──
  const [penActive, setPenActive] = useState(false)
  const [penTool, setPenTool] = useState('pen')     // pen | highlighter | eraser
  const [penColor, setPenColor] = useState(INK_COLORS[0])
  const [penWidth, setPenWidth] = useState('thin')  // thin | thick
  // 슬라이드별 잉크 보관(상태) — 슬라이드 전환 간 유지, 발표 종료(언마운트) 시 자동 폐기
  const [inkBySlide, setInkBySlide] = useState({}) // { [slideIndex]: strokes[] }
  const [blackout, setBlackout] = useState(false)  // 슬라이드 블랙아웃(잉크만 보이게)

  // 발표 시작 인덱스(F5=0, Shift+F5=현재 페이지). 마운트 시 1회 고정.
  const [currentSlide, setCurrentSlide] = useState(() => useEditorStore.getState().presentStartIndex || 0)
  // allPages 로드 후 범위 클램프(시작 인덱스가 총 슬라이드 수 초과 방지)
  useEffect(() => {
    if (allPages && sortedKeys.length > 0) {
      setCurrentSlide(c => Math.max(0, Math.min(c, sortedKeys.length - 1)))
    }
  }, [allPages]) // eslint-disable-line react-hooks/exhaustive-deps
  // 요소 애니메이션 빌드 단계 (현재 슬라이드)
  const [revealed, setRevealed] = useState(0)       // 진행한 빌드 단계 수(0..stepCount)
  const [playingStep, setPlayingStep] = useState(-1) // 지금 재생 중인 단계(-1=없음)
  const page = allPages?.[sortedKeys[currentSlide]]
  // 커넥터 기하는 참조 도형에서 유도 — 발표 모드에서도 해석된 사본으로 렌더
  const elements = resolveConnectors(page?.elements || [])
  const canvasSize = page?.canvasSize || { w: 1280, h: 720 }
  const fontImports = page?.fontImports || []
  const animInfo = useMemo(() => computeSteps(elements), [elements])

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

  // 네비게이션 — 빌드 단계 먼저 진행, 다 끝나면 슬라이드 이동
  const goNext = useCallback(() => {
    if (revealed < animInfo.stepCount) {
      setPlayingStep(revealed)   // 막 진입하는 단계 재생
      setRevealed(revealed + 1)
    } else if (currentSlide < totalSlides - 1) {
      setPlayingStep(-1)
      setRevealed(0)
      setCurrentSlide(currentSlide + 1)
    }
  }, [revealed, animInfo.stepCount, currentSlide, totalSlides])

  const goPrev = useCallback(() => {
    if (revealed > 0) {
      setPlayingStep(-1)         // 되감기는 즉시(애니메이션 없음)
      setRevealed(revealed - 1)
    } else if (currentSlide > 0) {
      // 이전 슬라이드는 끝까지 진행된 상태로 진입
      const prevEls = resolveConnectors(allPages?.[sortedKeys[currentSlide - 1]]?.elements || [])
      setPlayingStep(-1)
      setRevealed(computeSteps(prevEls).stepCount)
      setCurrentSlide(currentSlide - 1)
    }
  }, [revealed, currentSlide, allPages, sortedKeys])

  // 잉크 조작 (현재 슬라이드 기준)
  const slideStrokes = inkBySlide[currentSlide] || []
  const commitStroke = useCallback((stroke) => {
    setInkBySlide(m => ({ ...m, [currentSlide]: [...(m[currentSlide] || []), stroke] }))
  }, [currentSlide])
  const eraseStroke = useCallback((id) => {
    setInkBySlide(m => ({ ...m, [currentSlide]: (m[currentSlide] || []).filter(s => s.id !== id) }))
  }, [currentSlide])
  const clearSlideInk = useCallback(() => {
    setInkBySlide(m => ({ ...m, [currentSlide]: [] }))
  }, [currentSlide])

  // 키보드: ESC 종료, 화살표/스페이스 네비게이션
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        // 2단계: 펜이 켜져 있으면 펜만 끄고(+블랙아웃 해제), 아니면 발표 종료
        if (penActive) { setPenActive(false); setBlackout(false); return }
        exitPresentation()
        return
      }
      // 발표 그리기 단축키 — 단일 키로 도구 직접 선택(+필요 시 드로잉 자동 진입).
      // 도구 전환 시 블랙아웃은 유지(전환마다 풀리지 않도록); 해제는 펜 종료(Esc/종료 버튼)에서.
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'KeyP') { e.preventDefault(); setPenActive(true); setPenTool('pen'); return }
        if (e.code === 'KeyH') { e.preventDefault(); setPenActive(true); setPenTool('highlighter'); return }
        if (e.code === 'KeyE') { e.preventDefault(); setPenActive(true); setPenTool('eraser'); return }
        if (e.code === 'KeyC') { e.preventDefault(); clearSlideInk(); return } // 현재 슬라이드 잉크 전체 지우기
        if (e.code === 'KeyB') { e.preventDefault(); setPenActive(true); setBlackout(b => !b); return } // 블랙아웃 토글
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
  }, [exitPresentation, goNext, goPrev, penActive, clearSlideInk])

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
    if (x < rect.width * 0.25) goPrev()
    else goNext()
  }, [goNext, goPrev, penActive])

  // 힌트 자동 숨기기
  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 2500)
    return () => clearTimeout(t)
  }, [])

  // ── 노트 음성 나레이션 ──
  const audioElRef = useRef(null)
  const [narration, setNarration] = useState(true)
  // '음성 후 자동 진행'은 발표 전에도 설정 가능하도록 editorStore에 보관(localStorage 기억)
  const autoAdvance = useEditorStore(s => s.autoAdvance)
  const audioSrc = page?.notesAudio
  const hasAudio = !!audioSrc && BlobStore.isIdbRef(audioSrc)
  // 덱에 음성이 하나라도 있으면 나레이션 컨트롤 노출
  const deckHasAudio = useMemo(
    () => sortedKeys.some(k => BlobStore.isIdbRef(allPages?.[k]?.notesAudio)),
    [allPages, sortedKeys])

  // 슬라이드 진입 시 해당 노트 음성 자동 재생, 이동/종료 시 정지
  useEffect(() => {
    const el = audioElRef.current
    if (!el) return
    el.pause()
    el.removeAttribute('src')
    if (!narration || !hasAudio) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(audioSrc)).then(url => {
      if (cancelled || !url || !audioElRef.current) return
      audioElRef.current.src = url
      // 노트 음성 볼륨(0~1). 0이어도 재생은 유지돼 자동진행은 동작(립싱크 영상이 소리 담당 시 0).
      audioElRef.current.volume = page?.notesAudioVolume ?? 1
      audioElRef.current.play().catch(() => { /* 자동재생 차단/실패 무시 */ })
    })
    return () => { cancelled = true }
  }, [currentSlide, narration, hasAudio, audioSrc, page?.notesAudioVolume])

  const onAudioEnded = useCallback(() => { if (autoAdvance) goNext() }, [autoAdvance, goNext])

  // 음성 있는 슬라이드: 클릭 트리거를 자동으로 — 단계마다 이전 종료 후 0.3초 텀 자동 진행.
  // (슬라이드→슬라이드 자동 전환은 별도 '음성 후 자동 진행' 토글이 담당)
  const AUDIO_TERM = 300
  useEffect(() => {
    if (!(narration && hasAudio) || animInfo.stepCount === 0) return
    const durs = stepDurations(animInfo, elements)
    const timers = []
    let t = AUDIO_TERM
    for (let s = 0; s < animInfo.stepCount; s++) {
      timers.push(setTimeout(() => { setPlayingStep(s); setRevealed(s + 1) }, t))
      t += durs[s] + AUDIO_TERM
    }
    return () => timers.forEach(clearTimeout)
  }, [currentSlide, narration, hasAudio, animInfo, elements])

  // ── 가라오케 자막(STT 단어별 하이라이트) ──
  const captionsOn = useEditorStore(s => s.karaokeCaptions)
  const setCaptionsOn = useEditorStore(s => s.setKaraokeCaptions)
  const [captionWords, setCaptionWords] = useState(null)   // 현재 슬라이드 자막 단어(없으면 null)
  const [captionBusy, setCaptionBusy] = useState(false)
  const [captionErr, setCaptionErr] = useState('')

  // 자막 on + 현재 슬라이드에 음성 있음 → 캐시 확인 후 없으면 STT 호출(1회, 결과는 blobKey로 캐시).
  useEffect(() => {
    setCaptionErr('')
    if (!captionsOn || !hasAudio) { setCaptionWords(null); return }
    const blobKey = BlobStore.parseRef(audioSrc)
    const cached = getCachedTranscript(blobKey)
    if (cached) { setCaptionWords(cached.words); return }
    setCaptionWords(null)
    let cancelled = false
    setCaptionBusy(true)
    BlobStore.get(blobKey)
      .then(blob => {
        if (!blob) throw new Error('음성 파일을 찾을 수 없습니다.')
        return transcribeSpeech(blob)
      })
      .then(transcript => {
        if (cancelled) return
        setCachedTranscript(blobKey, transcript)
        setCaptionWords(transcript.words)
      })
      .catch(e => { if (!cancelled) setCaptionErr(e.message || '자막 생성 실패') })
      .finally(() => { if (!cancelled) setCaptionBusy(false) })
    return () => { cancelled = true }
  }, [captionsOn, hasAudio, audioSrc])

  const toggleCaptions = useCallback(() => {
    if (!captionsOn && !hasApiKey()) { openAiSettings(); return }
    setCaptionsOn(!captionsOn)
  }, [captionsOn, setCaptionsOn])

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
          <div
            key={currentSlide}
            className="fe-slide-anim"
            style={{
              position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
              animation: slideTransitionCss(page?.transition),
              ...(slideTransitionVars(page?.transition) || {}),
            }}
          >
            {elements.map(el => {
              const step = animInfo.stepOf[el.id]
              const playing = playingStep >= 0 && step === playingStep
              const showHidden = isHiddenAt(animInfo, el, revealed) && !playing

              // 자동(auto) 요소: 슬라이드 진입 즉시 CSS animation 재생.
              // 외부 div에 key={currentSlide}가 있으므로 슬라이드 전환 시 remount → 애니 재시작.
              if (step == null && el.anim?.trigger?.mode === 'auto' && el.anim?.effect && el.anim.effect !== 'none') {
                return (
                  <div key={el.id} style={{
                    position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                    zIndex: el.zIndex,
                    transformOrigin: 'center center',
                    animation: animationCss(el.anim, animInfo.autoOffsets?.[el.id] ?? 0),
                    ...(directionVars(el.anim) || {}),
                  }}>
                    <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                      isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
                  </div>
                )
              }

              // 애니메이션 없는 요소는 래퍼 없이 그대로(레이아웃/스태킹 영향 최소화)
              if (step == null) {
                return (
                  <FlatElementRenderer key={el.id} element={el} isSelected={false}
                    isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
                )
              }
              return (
                <div key={el.id} style={{
                  position: 'absolute', left: el.x, top: el.y, width: el.width, height: el.height,
                  zIndex: el.zIndex, // 래퍼가 요소 z를 보존(안 하면 z:auto로 양수 z 형제 아래로 깔림)
                  transformOrigin: 'center center',
                  opacity: showHidden ? 0 : undefined,
                  visibility: showHidden ? 'hidden' : undefined,
                  animation: playing ? animationCss(el.anim, animInfo.offsetOf[el.id]) : undefined,
                  ...(playing ? (directionVars(el.anim) || {}) : {}),
                }}>
                  <FlatElementRenderer element={{ ...el, x: 0, y: 0 }} isSelected={false}
                    isEditing={false} scale={scale} canvasSize={canvasSize} playNow={true} />
                </div>
              )
            })}
            {/* 블랙아웃: 슬라이드 내용을 가리는 검은 레이어 (잉크 오버레이보다 아래, 펜 모드에서만) */}
            {penActive && blackout && (
              <div style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 2147482000, pointerEvents: 'none' }} />
            )}
            <PresenterInkOverlay
              penActive={penActive}
              tool={penTool}
              color={penColor}
              penWidth={penWidth}
              scale={scale}
              canvasSize={canvasSize}
              strokes={slideStrokes}
              onCommitStroke={commitStroke}
              onEraseStroke={eraseStroke}
            />
          </div>
          {captionsOn && hasAudio && captionWords?.length > 0 && (
            <KaraokeCaptions audioEl={audioElRef.current} words={captionWords} />
          )}
        </div>
      )}

      {/* 노트 음성 재생기(숨김) */}
      <audio ref={audioElRef} onEnded={onAudioEnded} />

      {/* 나레이션 컨트롤 (좌하단) — 음성이 있는 덱에서만 노출 */}
      {!loading && deckHasAudio && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', bottom: 20, left: 20, zIndex: 1011,
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 10,
            background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)', color: '#cbd5e1',
            opacity: 0.45, transition: 'opacity 0.2s', fontSize: 12,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.45' }}
        >
          <button type="button" title={narration ? '나레이션 끄기' : '나레이션 켜기'}
            onClick={() => setNarration(n => !n)}
            style={ctrlBtn(narration)}>{narration ? '🔊' : '🔇'}</button>
          {hasAudio && (
            <button type="button" title="이 슬라이드 음성 다시 재생"
              onClick={() => { const el = audioElRef.current; if (el && el.src) { el.currentTime = 0; el.volume = page?.notesAudioVolume ?? 1; el.play().catch(() => {}) } }}
              style={ctrlBtn(false)}>▶</button>
          )}
          <button type="button"
            title={captionsOn ? '가라오케 자막 끄기 (STT로 노트 음성을 텍스트로 표시)' : '가라오케 자막 켜기 (STT로 노트 음성을 텍스트로 표시)'}
            onClick={toggleCaptions}
            style={ctrlBtn(captionsOn)}>{captionBusy ? '⏳' : 'CC'}</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: '#94a3b8' }}>
            <input type="checkbox" checked={autoAdvance} onChange={e => useEditorStore.getState().setAutoAdvance(e.target.checked)} />
            음성 후 자동 진행
          </label>
          {captionErr && <span style={{ color: '#fca5a5', fontSize: 11 }}>{captionErr}</span>}
        </div>
      )}

      {/* 펜 도구 모음 (하단 중앙) */}
      {!loading && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', bottom: 18, left: '50%', transform: 'translateX(-50%)',
            zIndex: 1011, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexWrap: 'wrap', gap: 8, padding: '6px 8px',
            maxWidth: 'calc(100vw - 16px)', // 좁은 화면에서 양옆 잘림 방지 → 그룹 단위 줄바꿈
            borderRadius: 12, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            opacity: penActive ? 1 : 0.4, transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = penActive ? '1' : '0.4' }}
        >
          {!penActive ? (
            <button type="button" title="펜 모드 켜기 (P)"
              onClick={() => { setPenTool('pen'); setPenActive(true) }}
              style={ctrlBtn(false)}>✎</button>
          ) : (<>
            {/* 그룹① 도구 + 색상 팔레트 (좁으면 이게 1줄) */}
            <div style={TOOL_MACRO}>
              <div style={TOOL_CLUSTER}>
                <button type="button" title="펜 (P)" onClick={() => setPenTool('pen')} style={ctrlBtn(penTool === 'pen')}>✎</button>
                <button type="button" title="형광펜 (H)" onClick={() => setPenTool('highlighter')} style={ctrlBtn(penTool === 'highlighter')}>🖍</button>
                <button type="button" title="지우개 (E)" onClick={() => setPenTool('eraser')} style={ctrlBtn(penTool === 'eraser')}>⌫</button>
              </div>
              <div style={TOOL_CLUSTER}>
                {INK_COLORS.map(c => (
                  <button key={c} type="button" title={`색 ${c}`} onClick={() => { setPenColor(c); if (penTool === 'eraser') setPenTool('pen') }}
                    style={{
                      width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0,
                      background: c,
                      border: penColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.3)',
                      boxShadow: penColor === c ? '0 0 0 1px rgba(99,102,241,0.8)' : 'none',
                    }} />
                ))}
              </div>
            </div>
            {/* 그룹② 굵기 + 휴지통 + 블랙아웃 + 종료 (좁으면 다음 줄) */}
            <div style={TOOL_MACRO}>
              <div style={TOOL_CLUSTER}>
                <button type="button" title="가는 선" onClick={() => setPenWidth('thin')} style={ctrlBtn(penWidth === 'thin')}>•</button>
                <button type="button" title="굵은 선" onClick={() => setPenWidth('thick')} style={ctrlBtn(penWidth === 'thick')}>⬤</button>
              </div>
              <button type="button" title="현재 슬라이드 잉크 전체 지우기 (C)" onClick={clearSlideInk} style={ctrlBtn(false)}>🗑</button>
              <button type="button" title="블랙아웃 — 슬라이드 가리고 잉크만 (B)" onClick={() => setBlackout(b => !b)} style={ctrlBtn(blackout)}>◼</button>
              {/* 펜 모드 종료 — X 아이콘 danger 알약으로 명확히 */}
              <button type="button" title="펜 모드 종료 (Esc)" onClick={() => { setPenActive(false); setBlackout(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, height: 26, padding: '0 8px',
                  borderRadius: 7, cursor: 'pointer', fontSize: 12,
                  background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5',
                }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                </svg>
                종료
              </button>
            </div>
          </>)}
        </div>
      )}

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

function ctrlBtn(active) {
  return {
    width: 26, height: 26, borderRadius: 7, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    // 선택 상태는 솔리드 인디고 + 흰색 + 외곽 링으로 또렷하게(비선택은 옅게)
    background: active ? '#6366f1' : 'rgba(255,255,255,0.06)',
    border: '1px solid ' + (active ? '#a5b4fc' : 'rgba(255,255,255,0.12)'),
    boxShadow: active ? '0 0 0 2px rgba(99,102,241,0.45)' : 'none',
    color: active ? '#ffffff' : '#cbd5e1', fontSize: 13,
    fontWeight: active ? 700 : 400,
    transition: 'background 0.12s, box-shadow 0.12s',
  }
}
