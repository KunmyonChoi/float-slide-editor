import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import PresentedSlide from './PresentedSlide'
import { useWebFontImports } from '../core/useWebFontImports'
import { useWakeLock } from '../core/useWakeLock'
import { resolveConnectors } from '../core/ConnectorRouting'
import { computeSteps } from '../core/slideAnimation'
import { openChannel, ALIVE_INTERVAL_MS } from '../core/presenterChannel'
import { sortedPageKeys } from '../core/usePresentationEngine'

/**
 * AudienceView — 청중 창(`?audience=<sessionId>`로 열리는 별도 창).
 *
 * 아무 상태도 갖지 않는다. 발표자 창이 보내주는 스냅샷을 그대로 그리기만 하고,
 * 키보드·클릭 네비게이션도 받지 않는다(청중 화면에서 실수로 슬라이드가 넘어가는 일 방지).
 * 그래서 이 창은 언제 닫혀도 되고, 다시 열리면 최신 스냅샷을 받아 이어 그린다.
 */
export default function AudienceView({ sessionId }) {
  const [deck, setDeck] = useState(null)          // { [pageKey]: page }
  // 위 인터벌이 최신 덱 유무를 보려면 ref가 필요하다(인터벌은 마운트 때 한 번만 만든다)
  const deckRef = useRef(null)
  const [state, setState] = useState(null)        // 발표자가 보낸 최신 스냅샷
  const [ended, setEnded] = useState(false)
  const [viewport, setViewport] = useState(() => ({
    w: document.documentElement.clientWidth, h: document.documentElement.clientHeight,
  }))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hintVisible, setHintVisible] = useState(true)

  // 나레이션 재생 위치 — 발표자 창의 <audio>가 진실이고, 여기서는 마지막으로 받은 값에
  // 경과 시간을 더해 추정한다(자막 단어 하이라이트가 매 프레임 필요해 메시지 주기로는 성기다).
  const audioBaseRef = useRef({ time: 0, at: 0, playing: false })

  const channelRef = useRef(null)

  // 화상회의에서 "창" 단위로 공유할 때 목록에서 골라야 하므로 제목을 분명히 한다 —
  // 발표자 창을 잘못 공유하면 노트가 그대로 중계된다.
  useEffect(() => { document.title = 'Genitor — 청중 화면' }, [])

  // ── 채널 연결: hello로 덱을 요청하고, 생존 신호를 주기적으로 보낸다 ──
  useEffect(() => {
    const ch = openChannel(sessionId)
    channelRef.current = ch

    const offDeck = ch.on('deck', (msg) => { deckRef.current = msg.pages || null; setDeck(msg.pages || null) })
    const offState = ch.on('state', (msg) => {
      setEnded(false)
      setState(msg.state)
      audioBaseRef.current = {
        time: msg.state?.audioTime || 0,
        at: performance.now(),
        playing: !!msg.state?.audioPlaying,
      }
    })
    const offEnd = ch.on('end', () => {
      setEnded(true)
      // 발표가 끝나면 청중 화면에 잔상이 남지 않도록 스스로 닫는다.
      // (스크립트로 연 창이라 close가 먹는다. 막히면 아래 종료 화면이 그대로 남는다.)
      setTimeout(() => { try { window.close() } catch { /* 무시 */ } }, 400)
    })

    ch.post('hello')
    // 생존 신호를 보내면서, 아직 덱이 없으면 계속 다시 요청한다 — 발표자 창이 채널을 열기 전에
    // 청중 창이 먼저 떴거나 hello 한 번이 유실돼도 스스로 회복한다.
    const alive = setInterval(() => {
      ch.post('alive')
      if (!deckRef.current) ch.post('hello')
    }, ALIVE_INTERVAL_MS)
    // 창이 닫히기 직전에 알려 발표자 창이 곧바로 "연결 끊김"으로 바꿀 수 있게 한다
    const onUnload = () => ch.post('bye')
    window.addEventListener('pagehide', onUnload)

    return () => {
      clearInterval(alive)
      window.removeEventListener('pagehide', onUnload)
      offDeck(); offState(); offEnd()
      ch.post('bye')
      ch.close()
    }
  }, [sessionId])

  const sortedKeys = useMemo(() => (deck ? sortedPageKeys(deck) : []), [deck])
  const page = deck && state ? deck[sortedKeys[state.slide]] : null
  const elements = useMemo(() => resolveConnectors(page?.elements || []), [page])
  const animInfo = useMemo(() => computeSteps(elements), [elements])
  const canvasSize = useMemo(() => page?.canvasSize || { w: 1280, h: 720 }, [page])

  useWakeLock(!ended)
  useWebFontImports(deck, sortedKeys)

  // 뷰포트에 맞춘 배율 — 창 크기는 상태로 두고 배율은 파생값으로 계산한다.
  // resize 이벤트 대신 문서 크기를 직접 관찰한다: 전체화면 전환이나 다른 해상도의
  // 디스플레이로 창을 옮길 때 resize가 오지 않는 경우가 있어 슬라이드가 작게 남는다.
  useEffect(() => {
    const el = document.documentElement
    const ro = new ResizeObserver(() => {
      setViewport({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = Math.min(viewport.w / canvasSize.w, viewport.h / canvasSize.h)

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    onFs()
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setHintVisible(false), 4000)
    return () => clearTimeout(t)
  }, [])

  // 화면 배치 권한이 없어 일반 창으로 열렸을 때의 수동 전체화면.
  // (requestFullscreen은 사용자 제스처가 필요해 창 안에서 한 번 눌러야 한다.)
  const goFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => { /* 거부 무시 */ })
  }, [])

  // 자막은 매 프레임 재생 위치를 묻는다 — 마지막으로 받은 값에 경과를 더해 추정한다.
  const getAudioTime = useCallback(() => {
    const b = audioBaseRef.current
    if (!b.playing) return b.time
    return b.time + (performance.now() - b.at) / 1000
  }, [])

  const waiting = !deck || !state || !page

  return (
    <div
      onClick={isFullscreen ? undefined : goFullscreen}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        cursor: isFullscreen ? 'none' : 'pointer',
        overflow: 'hidden',
      }}
    >
      {waiting && !ended && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>발표자 창을 기다리는 중…</span>
        </div>
      )}

      {ended && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', gap: 10,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15 }}>발표가 끝났습니다</span>
          <button
            type="button"
            onClick={() => window.close()}
            style={{
              height: 30, padding: '0 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1',
            }}
          >창 닫기</button>
        </div>
      )}

      {!waiting && !ended && (
        <PresentedSlide
          slideKey={state.slide}
          page={page}
          elements={elements}
          animInfo={animInfo}
          revealed={state.revealed}
          playingStep={state.playingStep}
          scale={scale}
          canvasSize={canvasSize}
          penActive={false}
          blackout={!!state.blackout}
          strokes={state.strokes || []}
          captionWords={state.captionWords || null}
          getAudioTime={getAudioTime}
        />
      )}

      {/* 전체화면이 아닐 때만 잠깐 뜨는 안내 — 청중 화면에 크롬을 남기지 않기 위해 곧 사라진다 */}
      {!isFullscreen && hintVisible && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', borderRadius: 12,
          background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.07)',
          fontSize: 12, color: '#94a3b8', pointerEvents: 'none',
        }}>
          청중 화면으로 옮긴 뒤 클릭하면 전체화면이 됩니다
          <kbd style={{
            fontSize: 11, background: 'rgba(255,255,255,0.1)', color: '#cbd5e1',
            padding: '2px 6px', borderRadius: 4, fontFamily: 'monospace',
          }}>F11</kbd>
        </div>
      )}
    </div>
  )
}
