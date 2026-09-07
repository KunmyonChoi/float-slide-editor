import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import PresentedSlide from './PresentedSlide'
import { SlideThumbnail } from './SlideListPanel'
import { NarrationControls, InkControls } from './PresenterToolbar'
import { useWebFontImports } from '../core/useWebFontImports'
import { usePresentationEngine } from '../core/usePresentationEngine'
import { useAudienceLink } from '../core/useAudienceLink'

/**
 * SpeakerView — 듀얼 모니터 발표의 발표자 창.
 *
 * 발표 상태를 소유하고(usePresentationEngine), 스냅샷을 청중 창으로 계속 밀어준다.
 * 청중 창이 없거나 끊겨도 이 창만으로 발표(=리허설)가 성립한다.
 */

const NOTE_SIZES = [14, 16, 18, 21, 24]

function fmtElapsed(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 컨테이너 안에 캔버스를 꽉 채우는 배율 — 미리보기/썸네일이 창 크기를 따라가게
function useFitScale(ref, canvasSize) {
  const [scale, setScale] = useState(0.1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setScale(Math.min(r.width / canvasSize.w, r.height / canvasSize.h))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, canvasSize.w, canvasSize.h])
  return scale
}

export default function SpeakerView() {
  const exitPresentation = useEditorStore(s => s.exitPresentation)
  const sessionId = useEditorStore(s => s.presentSessionId)
  const audienceScreen = useEditorStore(s => s.audienceScreen)
  const popupBlocked = useEditorStore(s => s.audiencePopupBlocked)

  const eng = usePresentationEngine({ onExit: exitPresentation })
  // <audio>에 붙일 콜백 ref는 미리 꺼내 둔다 — JSX에서 eng.setAudioEl을 바로 ref로 주면
  // 린터가 이후의 eng.* 접근까지 렌더 중 ref 접근으로 본다.
  const { setAudioEl } = eng
  const previewRef = useRef(null)
  const previewScale = useFitScale(previewRef, eng.canvasSize)

  const [noteSize, setNoteSize] = useState(2)   // NOTE_SIZES 인덱스
  const [gridOpen, setGridOpen] = useState(false)

  // ── 경과 시간 / 현재 시각 ──
  const [elapsed, setElapsed] = useState(0)
  const [timerRunning, setTimerRunning] = useState(true)
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date())
      if (timerRunning) setElapsed(e => e + 1)
    }, 1000)
    return () => clearInterval(t)
  }, [timerRunning])

  // ── 청중 창 연결 ──
  // 스냅샷은 최신 엔진을 ref에 담아 getter로 넘긴다(상태가 바뀔 때마다 채널 핸들러를
  // 다시 등록하지 않기 위해서다). 갱신은 렌더가 아니라 커밋 후에 — 아래 push 이펙트들보다
  // 먼저 선언해 두어야 같은 커밋에서 최신 값이 먼저 반영된다.
  const engRef = useRef(eng)
  useEffect(() => { engRef.current = eng })

  const getDeck = useCallback(() => engRef.current.allPages || {}, [])
  const getState = useCallback(() => {
    const e = engRef.current
    const audio = e.getAudioStatus()
    return {
      slide: e.currentSlide,
      revealed: e.revealed,
      playingStep: e.playingStep,
      // 블랙아웃은 청중 화면만 덮는다 — 발표자는 계속 슬라이드와 노트를 본다
      blackout: e.blackout,
      strokes: e.slideStrokes,
      captionWords: e.captionsOn && e.hasAudio ? e.captionWords : null,
      audioTime: audio.time,
      audioPlaying: audio.playing,
    }
  }, [])

  const link = useAudienceLink({ sessionId, getDeck, getState })

  // 덱이 준비되면(로딩 완료) 한 번 밀어준다 — 청중 창이 먼저 떠서 hello를 이미 보냈을 수 있다.
  useEffect(() => {
    if (!eng.loading) {
      link.push()
      // hello를 놓친 청중 창을 위해 덱도 다시 보낸다(덱 메시지는 청중 쪽에서 덮어쓰기만 한다).
      // push 직후라 순서 역전 걱정 없음.
    }
  }, [eng.loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // 상태가 바뀔 때마다 청중 창에 반영
  useEffect(() => {
    link.push()
  }, [link, eng.currentSlide, eng.revealed, eng.playingStep, eng.blackout,
      eng.slideStrokes, eng.captionWords, eng.captionsOn, eng.hasAudio])

  // 나레이션 재생 중에는 자막 위치를 주기적으로 동기화(청중 창은 그 사이를 보간한다)
  useEffect(() => {
    if (!eng.hasAudio || !eng.narration) return
    const t = setInterval(() => link.push(), 500)
    return () => clearInterval(t)
  }, [link, eng.hasAudio, eng.narration])

  // 키보드 — 발표자 창에서만 받는다(청중 창은 입력을 받지 않는다)
  useEffect(() => {
    const onKey = (e) => {
      if (gridOpen && e.key === 'Escape') { e.preventDefault(); setGridOpen(false); return }
      eng.handleKeyDown(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [eng.handleKeyDown, gridOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  useWebFontImports(eng.allPages, eng.sortedKeys)

  const notes = eng.page?.notes || ''
  const nextIndex = eng.currentSlide + 1
  const upcoming = useMemo(
    () => eng.sortedKeys.slice(eng.currentSlide + 2, eng.currentSlide + 4)
      .map((k, i) => ({ key: k, index: eng.currentSlide + 2 + i, page: eng.allPages?.[k] })),
    [eng.sortedKeys, eng.currentSlide, eng.allPages])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      background: '#0f172a', color: '#e2e8f0',
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
    }}>

      {/* ── 상단 바 ── */}
      <div style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px',
        background: 'rgba(15,23,42,0.9)', borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <ConnectionBadge
          connected={link.connected}
          screenLabel={audienceScreen?.label}
          popupBlocked={popupBlocked}
          onReopen={() => {
            const ok = link.reopen(audienceScreen)
            useEditorStore.getState().setAudiencePopupBlocked(!ok)
          }}
        />

        <div style={divider} />
        <span style={{ ...tabular, fontSize: 13, color: '#94a3b8' }}>
          {eng.currentSlide + 1} / {eng.totalSlides || 1}
        </span>

        <div style={{ flexGrow: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>경과</span>
          <span style={{ ...tabular, fontSize: 22, fontWeight: 600, letterSpacing: -0.5 }}>{fmtElapsed(elapsed)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" onClick={() => setTimerRunning(r => !r)} style={iconBtn}
              title={timerRunning ? '타이머 일시정지' : '타이머 계속'}>
              {timerRunning
                ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></svg>
                : <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 4l12 8-12 8z" /></svg>}
            </button>
            <button type="button" onClick={() => setElapsed(0)} style={iconBtn} title="타이머 초기화">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M3 13C5 7 11 4 17 6s9 8 7 14" /></svg>
            </button>
          </div>
        </div>

        <div style={{ ...divider, margin: '0 4px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15 }}>
          <span style={{ ...tabular, fontSize: 15, color: '#cbd5e1' }}>
            {String(clock.getHours()).padStart(2, '0')}:{String(clock.getMinutes()).padStart(2, '0')}
          </span>
          <span style={{ fontSize: 10, color: '#67738a' }}>현재 시각</span>
        </div>

        <div style={{ ...divider, margin: '0 4px' }} />

        <button type="button" onClick={exitPresentation} title="발표 끝내기 (ESC)" style={{
          display: 'flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', borderRadius: 7,
          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5',
          fontSize: 12, cursor: 'pointer',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          발표 종료
        </button>
      </div>

      {/* ── 본문 ── */}
      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>

        {/* 좌: 현재 슬라이드 + 빌드 + 노트 */}
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, padding: 14 }}>
          <div ref={previewRef} style={{
            flex: '1 1 58%', minHeight: 0, position: 'relative', borderRadius: 8, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.12)', background: '#000',
          }}>
            {eng.loading
              ? <Centered>{eng.loadingCaptions ? '자막 준비 중…' : '페이지 로딩 중…'}</Centered>
              : (
                <PresentedSlide
                  slideKey={eng.currentSlide}
                  page={eng.page}
                  elements={eng.elements}
                  animInfo={eng.animInfo}
                  revealed={eng.revealed}
                  playingStep={eng.playingStep}
                  scale={previewScale}
                  canvasSize={eng.canvasSize}
                  penActive={eng.penActive}
                  penTool={eng.penTool}
                  penColor={eng.penColor}
                  penWidth={eng.penWidth}
                  // 발표자 미리보기는 블랙아웃하지 않는다 — 청중 화면만 검게 하고
                  // 발표자는 계속 슬라이드를 보며 말을 이어간다(아래 배지로 상태를 알린다).
                  blackout={false}
                  strokes={eng.slideStrokes}
                  onCommitStroke={eng.commitStroke}
                  onEraseStroke={eng.eraseStroke}
                  captionWords={null}
                  getAudioTime={null}
                />
              )}
            {eng.blackout && (
              <div style={{
                position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 9px', borderRadius: 7, fontSize: 11.5,
                background: 'rgba(15,23,42,0.85)', border: '1px solid rgba(255,255,255,0.15)', color: '#e2e8f0',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: '#000', border: '1px solid rgba(255,255,255,0.5)' }} />
                청중 화면 블랙아웃 중 · B
              </div>
            )}
          </div>

          {/* 빌드 단계 */}
          <div style={{ height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, color: '#67738a' }}>빌드</span>
            {eng.animInfo.stepCount > 0 ? (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {Array.from({ length: eng.animInfo.stepCount }, (_, i) => (
                  <span key={i} style={{
                    width: 22, height: 4, borderRadius: 2, display: 'block',
                    background: i < eng.revealed ? '#6366f1' : 'rgba(255,255,255,0.14)',
                  }} />
                ))}
              </div>
              <span style={{ ...tabular, fontSize: 11, color: '#94a3b8' }}>
                {eng.revealed} / {eng.animInfo.stepCount}
              </span>
            </>) : (
              <span style={{ fontSize: 11, color: '#475569' }}>단계 없음</span>
            )}
          </div>

          {/* 발표자 노트 */}
          <div style={{
            flex: '1 1 42%', minHeight: 0, display: 'flex', flexDirection: 'column',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.05)', overflow: 'hidden',
          }}>
            <div style={{
              height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v12l-4 4H4z" /><line x1="8" y1="9" x2="16" y2="9" /><line x1="8" y1="13" x2="12" y2="13" />
              </svg>
              <span style={{ fontSize: 12, color: '#a5b4fc' }}>발표자 노트</span>
              <div style={{ flexGrow: 1 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button type="button" title="글씨 작게" onClick={() => setNoteSize(i => Math.max(0, i - 1))}
                  style={{ ...iconBtn, width: 22, height: 22, fontSize: 11 }}>A&minus;</button>
                <button type="button" title="글씨 크게" onClick={() => setNoteSize(i => Math.min(NOTE_SIZES.length - 1, i + 1))}
                  style={{ ...iconBtn, width: 22, height: 22, fontSize: 12 }}>A+</button>
              </div>
            </div>
            <div style={{
              flexGrow: 1, minHeight: 0, padding: '10px 12px', overflowY: 'auto',
              fontSize: NOTE_SIZES[noteSize], lineHeight: 1.62, color: '#e2e8f0', whiteSpace: 'pre-wrap',
            }} className="thin-scrollbar">
              {notes || <span style={{ color: '#475569' }}>이 슬라이드에는 노트가 없습니다.</span>}
            </div>
          </div>
        </div>

        {/* 우: 다음 슬라이드 + 나레이션 + 이어지는 순서 */}
        <div style={{
          width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, padding: 14,
          borderLeft: '1px solid rgba(255,255,255,0.06)', overflowY: 'auto',
        }} className="thin-scrollbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>다음 슬라이드</span>
            {eng.nextPage && (
              <span style={{ ...tabular, fontSize: 11, color: '#67738a' }}>
                {nextIndex + 1} / {eng.totalSlides}
              </span>
            )}
          </div>

          <div style={{
            width: '100%', borderRadius: 8, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.12)', background: '#0f172a',
            display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 100,
          }}>
            {eng.nextPage
              ? <SlideThumbnail elements={eng.nextPage.elements} canvasSize={eng.nextPage.canvasSize} width={330} />
              : <span style={{ fontSize: 12, color: '#475569', padding: 24 }}>마지막 슬라이드입니다</span>}
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

          <NarrationControls eng={eng} inline />

          {upcoming.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, color: '#67738a' }}>이어지는 순서</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {upcoming.map(u => (
                  <button key={u.key} type="button" onClick={() => eng.goToSlide(u.index)} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                    background: 'rgba(255,255,255,0.04)', border: 'none', cursor: 'pointer', textAlign: 'left',
                  }}>
                    <span style={{ ...tabular, width: 16, fontSize: 11, color: '#64748b', textAlign: 'right' }}>{u.index + 1}</span>
                    <span style={{ borderRadius: 3, overflow: 'hidden', flexShrink: 0, display: 'block' }}>
                      <SlideThumbnail elements={u.page?.elements || []} canvasSize={u.page?.canvasSize} width={56} />
                    </span>
                    <span style={{
                      fontSize: 12, color: '#94a3b8', overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{slideLabel(u.page)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 하단 컨트롤 바 ── */}
      <div style={{
        height: 58, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px',
        background: 'rgba(15,23,42,0.9)', borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button type="button" onClick={eng.goPrev} style={navBtn(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          이전
        </button>

        <div style={divider} />

        <InkControls eng={eng} inline />
        <span style={{ fontSize: 11, color: '#67738a' }}>청중 화면에 함께 표시</span>

        <div style={{ flexGrow: 1 }} />

        <button type="button" onClick={() => setGridOpen(true)} style={navBtn(false)} title="전체 슬라이드 보기">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          전체 보기
        </button>

        <button type="button" onClick={eng.goNext} style={navBtn(true)}>
          다음
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {/* 노트 음성 재생기(숨김) — 발표자 창에서만 재생한다(두 창이 겹쳐 울리지 않도록) */}
      <audio ref={setAudioEl} onEnded={eng.onAudioEnded} />

      {gridOpen && (
        <SlideGrid
          allPages={eng.allPages}
          sortedKeys={eng.sortedKeys}
          current={eng.currentSlide}
          onPick={(i) => { eng.goToSlide(i); setGridOpen(false) }}
          onClose={() => setGridOpen(false)}
        />
      )}
    </div>
  )
}

// ── 조각들 ─────────────────────────────────────────────

const divider = { width: 1, height: 20, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }
const tabular = { fontVariantNumeric: 'tabular-nums' }

const iconBtn = {
  width: 26, height: 26, borderRadius: 7, padding: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
  color: '#cbd5e1', cursor: 'pointer',
}

function navBtn(primary) {
  return {
    display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: primary ? '0 16px' : '0 14px',
    borderRadius: 8, fontSize: 13, cursor: 'pointer',
    background: primary ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.06)',
    border: '1px solid ' + (primary ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.12)'),
    color: primary ? '#ffffff' : '#cbd5e1',
    fontWeight: primary ? 500 : 400,
  }
}

function Centered({ children }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'rgba(255,255,255,0.4)', fontSize: 14,
    }}>{children}</div>
  )
}

/** 페이지의 첫 텍스트를 라벨로 — 없으면 번호만 */
function slideLabel(page) {
  const el = (page?.elements || []).find(e => e.type === 'text' && typeof e.content === 'string' && e.content.trim())
  if (!el) return '(제목 없음)'
  const text = el.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return text.slice(0, 24) || '(제목 없음)'
}

function ConnectionBadge({ connected, screenLabel, popupBlocked, onReopen }) {
  const tone = connected
    ? { bg: 'rgba(16,185,129,0.2)', border: 'rgba(16,185,129,0.4)', fg: '#6ee7b7', dot: '#10b981' }
    : { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)', fg: '#fca5a5', dot: '#ef4444' }
  const label = connected
    ? `청중 창 · ${screenLabel || '연결됨'}`
    : (popupBlocked ? '청중 창 · 팝업 차단됨' : '청중 창 · 연결 끊김')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 9px', borderRadius: 7,
        background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, fontSize: 12,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.dot, display: 'block' }} />
        {label}
      </div>
      {!connected && (
        <button type="button" onClick={onReopen} style={{
          height: 26, padding: '0 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
          background: 'rgba(99,102,241,0.5)', border: '1px solid rgba(99,102,241,0.35)', color: '#ffffff',
        }}>다시 열기</button>
      )}
    </div>
  )
}

/** 전체 슬라이드 그리드 — 클릭해 점프 */
function SlideGrid({ allPages, sortedKeys, current, onPick, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,0.85)',
        backdropFilter: 'blur(8px)', padding: 32, overflowY: 'auto',
      }}
      className="thin-scrollbar"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'center' }}
      >
        {sortedKeys.map((k, i) => (
          <button key={k} type="button" onClick={() => onPick(i)} style={{
            display: 'flex', flexDirection: 'column', gap: 5, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <span style={{
              display: 'block', borderRadius: 4, overflow: 'hidden',
              outline: i === current ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.12)',
              outlineOffset: i === current ? -1 : 0,
            }}>
              <SlideThumbnail elements={allPages?.[k]?.elements || []} canvasSize={allPages?.[k]?.canvasSize} width={196} />
            </span>
            <span style={{ ...tabular, fontSize: 11, color: i === current ? '#a5b4fc' : '#64748b', textAlign: 'left' }}>
              {i + 1}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
