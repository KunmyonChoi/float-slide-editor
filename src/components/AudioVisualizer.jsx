import { useRef, useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'
import { DEFAULT_VIZ, barCount, staticFrame, barsFromFrequency, drawViz } from '../core/audioViz'

/**
 * 오디오 비주얼라이저 요소 렌더러.
 * - 편집 모드(!playNow): 정적 대표 프레임만 그려 소리 없이 디자인 가능.
 * - 발표 모드(playNow): 자체 Audio 객체 + Web Audio AnalyserNode로 실시간 주파수 반응.
 * 막대 배치는 '폭에 채우기'(요소 폭에서 막대 개수 산출). 크기 조정 시 반응형 재계산.
 */
export default function AudioVisualizer({ element, playNow }) {
  const { content, styles = {} } = element
  // 외부/계약 경로에서 크기 없이 들어온 요소 대비 — 0/NaN이면 기본값(빈 캔버스 방지)
  const width = Number.isFinite(element.width) && element.width > 0 ? element.width : 320
  const height = Number.isFinite(element.height) && element.height > 0 ? element.height : 120
  const viz = { ...DEFAULT_VIZ, ...(element.viz || {}) }
  const canvasRef = useRef(null)
  const isIdb = BlobStore.isIdbRef(content)
  const [url, setUrl] = useState(isIdb ? null : (content || null))
  const [failed, setFailed] = useState(false)

  // idb 참조 → blob URL 해석(영상/이미지와 동일 패턴)
  useEffect(() => {
    if (!isIdb) { setUrl(content || null); setFailed(!content); return }
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content)).then(u => {
      if (cancelled) return
      setUrl(u || null); setFailed(!u)
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [content, isIdb])

  const volume = Number.isFinite(element.volume) ? Math.max(0, Math.min(1, element.volume)) : 1
  // 라이브 루프가 최신 viz/크기/볼륨을 재구독 없이 읽도록 ref에 보관(오디오 그래프 재생성 방지)
  const liveRef = useRef({ viz, width, height, volume })
  liveRef.current = { viz, width, height, volume }
  const gainRef = useRef(null) // GainNode — 볼륨 실시간 반영

  // 캔버스 backing store를 DPR·크기에 맞춤(선명도)
  const syncCanvasSize = (cv) => {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const bw = Math.max(1, Math.round(width * dpr)), bh = Math.max(1, Math.round(height * dpr))
    if (cv.width !== bw) cv.width = bw
    if (cv.height !== bh) cv.height = bh
    const ctx = cv.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  // 발표 모드라도 자동재생이 꺼져 있으면 정적(소리 없음). 음악 화면 기본은 autoplay=true.
  const live = playNow && (element.autoplay ?? false)

  // 정적 프레임 1장 — 편집/자동재생 off, 또는 발표라도 url 미해석(idb 로딩 중)일 때.
  // (둘 다 아니면 라이브 effect가 그림). url 미해석 동안 빈 캔버스 방지.
  const staticNow = !live || !url
  useEffect(() => {
    if (!staticNow) return
    const cv = canvasRef.current
    if (!cv) return
    const ctx = syncCanvasSize(cv)
    const n = barCount(width, viz.barWidth, viz.barGap)
    drawViz(ctx, width, height, staticFrame(n), viz)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staticNow, width, height, viz.shape, viz.barWidth, viz.barGap, viz.barRadius, viz.color])

  // 발표 모드: 실시간 주파수 반응. 자체 Audio 객체를 만들어 그래프 once-only 제약/StrictMode 회피.
  useEffect(() => {
    if (!live || !url) return
    const cv = canvasRef.current
    if (!cv) return
    let stopped = false, raf = 0, ctxAudio = null
    const audio = new Audio()
    audio.src = url
    audio.loop = !!element.loop
    // 음소거는 GainNode로만 처리 — audio.muted는 MediaElementSource 신호까지 끊어
    // 분석기에 무음이 들어가 '음소거(파형만 보기)'에서 막대가 멈춘다.
    audio.crossOrigin = 'anonymous'
    audio.preload = 'auto'

    const paintStatic = () => {
      const ctx = syncCanvasSize(cv)
      drawViz(ctx, liveRef.current.width, liveRef.current.height,
        staticFrame(barCount(liveRef.current.width, liveRef.current.viz.barWidth, liveRef.current.viz.barGap)),
        liveRef.current.viz)
    }

    try {
      const AC = window.AudioContext || window.webkitAudioContext
      ctxAudio = new AC()
      const srcNode = ctxAudio.createMediaElementSource(audio)
      const analyser = ctxAudio.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = Math.max(0, Math.min(0.99, viz.smoothing))
      const gain = ctxAudio.createGain()
      gain.gain.value = element.muted ? 0 : liveRef.current.volume
      gainRef.current = gain
      srcNode.connect(analyser); analyser.connect(gain); gain.connect(ctxAudio.destination)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        if (stopped) return
        // 볼륨 실시간 반영(음소거 우선)
        if (gainRef.current) {
          gainRef.current.gain.value = element.muted ? 0 : liveRef.current.volume
        }
        analyser.getByteFrequencyData(data)
        const { viz: v, width: w, height: h } = liveRef.current
        const ctx = syncCanvasSize(cv)
        drawViz(ctx, w, h, barsFromFrequency(data, barCount(w, v.barWidth, v.barGap), v.sensitivity), v)
        raf = requestAnimationFrame(loop)
      }
      ctxAudio.resume().catch(() => {})
      audio.play().catch(() => { /* 자동재생 차단(비음소거) — 사용자 상호작용 후 재생 */ })
      loop()
    } catch {
      // Web Audio 실패 시: 분석기 없이 소리만 재생(이 경로엔 gain이 없으므로 muted/volume 직접 적용) + 정적 프레임
      audio.muted = !!element.muted
      audio.volume = liveRef.current.volume
      audio.play().catch(() => {})
      paintStatic()
    }

    return () => {
      stopped = true
      gainRef.current = null
      cancelAnimationFrame(raf)
      try { audio.pause() } catch { /* 무시 */ }
      audio.src = ''
      try { ctxAudio && ctxAudio.close() } catch { /* 무시 */ }
    }
    // smoothing은 분석기 생성 시 1회 설정 → 변경 시 재구독 필요(나머지 viz는 ref로 라이브 반영)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, url, element.loop, element.muted, viz.smoothing])

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: styles.backgroundColor || 'transparent',
      borderRadius: styles.borderRadius || '0px',
      overflow: 'hidden', opacity: styles.opacity ?? 1,
    }}>
      {failed ? (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#94a3b8', fontSize: 12, background: 'rgba(30,41,59,0.6)' }}>♪ 오디오를 불러올 수 없음</div>
      ) : (
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      )}
    </div>
  )
}
