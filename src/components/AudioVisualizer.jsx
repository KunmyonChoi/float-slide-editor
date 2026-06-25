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
  const { content, width, height, styles = {} } = element
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

  // 라이브 루프가 최신 viz/크기를 재구독 없이 읽도록 ref에 보관(오디오 그래프 재생성 방지)
  const liveRef = useRef({ viz, width, height })
  liveRef.current = { viz, width, height }

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

  // 편집 모드(또는 재생 전/자동재생 off): 정적 프레임 1장. viz/크기 변경 시 다시 그림.
  useEffect(() => {
    if (live) return
    const cv = canvasRef.current
    if (!cv) return
    const ctx = syncCanvasSize(cv)
    const n = barCount(width, viz.barWidth, viz.barGap)
    drawViz(ctx, width, height, staticFrame(n), viz)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, width, height, viz.shape, viz.barWidth, viz.barGap, viz.barRadius, viz.color])

  // 발표 모드: 실시간 주파수 반응. 자체 Audio 객체를 만들어 그래프 once-only 제약/StrictMode 회피.
  useEffect(() => {
    if (!live || !url) return
    const cv = canvasRef.current
    if (!cv) return
    let stopped = false, raf = 0, ctxAudio = null
    const audio = new Audio()
    audio.src = url
    audio.loop = !!element.loop
    audio.muted = !!element.muted
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
      gain.gain.value = element.muted ? 0 : 1
      srcNode.connect(analyser); analyser.connect(gain); gain.connect(ctxAudio.destination)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        if (stopped) return
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
      // Web Audio 실패 시: 소리만 재생 시도 + 정적 프레임
      audio.play().catch(() => {})
      paintStatic()
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      try { audio.pause() } catch { /* 무시 */ }
      audio.src = ''
      try { ctxAudio && ctxAudio.close() } catch { /* 무시 */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, url, element.loop, element.muted])

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
