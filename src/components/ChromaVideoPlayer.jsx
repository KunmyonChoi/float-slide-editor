import { useRef, useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'
import { useEditorStore } from '../store/editorStore'
import { applyChromaToImageData, despillImageData, detectBgColorFromCtx, chromaEntries } from '../core/chromaKey'
import { createChromaRenderer, prepareChromaUniforms } from '../core/chromaGL'

// 2D 폴백 처리 캔버스 긴 변 상한 — getImageData/putImageData 픽셀 루프 부하 억제.
const PROC_MAX = 960

/**
 * ChromaVideoPlayer — 크로마키(배경 단색 제거)가 켜진 영상을 실시간 합성 재생.
 *
 * 기본 경로는 WebGL 셰이더(GPU). 미지원/실패 시 CPU(canvas 2D) 폴백.
 * 숨긴 <video>를 매 프레임 표시 <canvas>에 합성해 키색 알파를 깎고 디스필을 적용한다.
 * 비파괴: 원본 영상은 그대로, element.chroma 설정(keys/despill)만으로 렌더.
 * 오디오는 <video>가 그대로 재생(canvas는 영상 픽셀만 담당).
 */
export default function ChromaVideoPlayer({ content, playNow, autoplay, loop, muted, hideControls, objectFit, chroma, radius }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const autoKeyRef = useRef(null)     // 자동 키색 1회 추정 캐시
  const sampleCanvasRef = useRef(null) // 자동 키색 코너 샘플용 오프스크린 2D
  const paramsRef = useRef({ entries: [], despill: 0 }) // 최신 파라미터(재컴파일 없이 매 프레임 참조)
  const drawFrameRef = useRef(null)   // 정지 프레임 강제 재그리기용
  // 발표 종료 시 캔버스를 새 요소로 remount해 WebGL 컨텍스트 재확보(손실된 컨텍스트는
  // 같은 canvas에서 getContext로 못 살리므로 key를 바꿔 새 canvas를 만든다).
  const [glGen, setGlGen] = useState(0)
  const mode = useEditorStore(s => s.mode)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current === 'present' && mode !== 'present') setGlGen(g => g + 1)
    prevModeRef.current = mode
  }, [mode])

  useEffect(() => {
    if (!isIdb) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content)).then(url => { if (!cancelled) setIdbUrl(url) })
    return () => { cancelled = true }
  }, [content, isIdb])

  const blobUrl = isIdb ? idbUrl : content

  const entries = chromaEntries(chroma) // 구버전 단일 키도 배열로 정규화
  const chromaSig = JSON.stringify({ entries, despill: chroma?.despill ?? 0 })

  // 파라미터 변경: 최신값 저장 + 자동키 캐시 무효화 + 정지 프레임이면 1회 재그리기.
  useEffect(() => {
    paramsRef.current = { entries, despill: chroma?.despill ?? 0 }
    autoKeyRef.current = null
    drawFrameRef.current?.()
  }, [chromaSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // GL/2D 셋업 + 비디오 루프 — blobUrl/playNow 바뀔 때만(셰이더 재컴파일 회피).
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !blobUrl) return

    // WebGL 우선, 실패 시 2D 폴백. 컨텍스트 손실(발표 모드 등 다중 WebGL로 한도 초과)에
    // 대비해 glRenderer는 mutable — 손실 시 null, 복구 시 재생성.
    let glRenderer = createChromaRenderer(canvas)
    const ctx2d = glRenderer ? null : canvas.getContext('2d', { willReadFrequently: true })
    let proc = { w: 0, h: 0 }

    // 자동 키색: 작은 오프스크린 2D에 코너만 샘플(1회 캐시)
    const getAutoKey = () => {
      if (autoKeyRef.current) return autoKeyRef.current
      const vw = video.videoWidth || 0, vh = video.videoHeight || 0
      if (!vw || !vh) return null
      const sc = sampleCanvasRef.current || (sampleCanvasRef.current = document.createElement('canvas'))
      const s = Math.min(1, 64 / Math.max(vw, vh))
      sc.width = Math.max(2, Math.round(vw * s)); sc.height = Math.max(2, Math.round(vh * s))
      const sctx = sc.getContext('2d', { willReadFrequently: true })
      try {
        sctx.drawImage(video, 0, 0, sc.width, sc.height)
        autoKeyRef.current = detectBgColorFromCtx(sctx, sc.width, sc.height)
      } catch { /* tainted */ }
      return autoKeyRef.current
    }

    const sizeCanvas2D = () => {
      const vw = video.videoWidth || 0, vh = video.videoHeight || 0
      if (!vw || !vh) return false
      const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
      proc = { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round(vh * scale)) }
      if (canvas.width !== proc.w || canvas.height !== proc.h) { canvas.width = proc.w; canvas.height = proc.h }
      return true
    }

    const drawFrame = () => {
      if (video.readyState < 2) return // 디코딩된 프레임 없으면 스킵(검은 첫프레임 오추정 방지)
      const { entries: ents, despill } = paramsRef.current
      const needAuto = ents.some(e => !e.key)
      const auto = needAuto ? getAutoKey() : null
      const resolved = ents.map(e => (e.key ? e : { ...e, key: auto })).filter(e => e.key)
      const primaryKey = resolved[0]?.key || null

      if (glRenderer) {
        glRenderer.render(video, prepareChromaUniforms(resolved, despill, primaryKey))
        return
      }
      // 2D 폴백
      if (!ctx2d || !sizeCanvas2D()) return
      try {
        ctx2d.drawImage(video, 0, 0, proc.w, proc.h)
        const frame = ctx2d.getImageData(0, 0, proc.w, proc.h)
        for (const e of resolved) applyChromaToImageData(frame, e.key, e.tolerance ?? 18, e.feather)
        if (despill > 0 && primaryKey) despillImageData(frame, primaryKey, despill)
        ctx2d.putImageData(frame, 0, 0)
      } catch { /* tainted */ }
    }
    drawFrameRef.current = drawFrame

    // 정지 미리보기(비재생): 검은 인트로 프레임 회피 위해 대표 프레임(0.1초)로 seek.
    const ensureStillFrame = () => {
      if (playNow) return
      try { if ((video.currentTime || 0) < 0.05 && (video.duration || 1) > 0.15) video.currentTime = 0.1 } catch { /* 메타데이터 전 */ }
    }

    const hasVfc = typeof video.requestVideoFrameCallback === 'function'
    const vfcLoop = () => { drawFrame(); rafRef.current = video.requestVideoFrameCallback(vfcLoop) }
    const rafLoop = () => { drawFrame(); rafRef.current = requestAnimationFrame(rafLoop) }
    const start = () => { rafRef.current = hasVfc ? video.requestVideoFrameCallback(vfcLoop) : requestAnimationFrame(rafLoop) }
    const stop = () => {
      if (!rafRef.current) return
      if (hasVfc) video.cancelVideoFrameCallback?.(rafRef.current); else cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    const onLoadedMeta = () => ensureStillFrame()
    const onLoaded = () => { drawFrame(); if (!video.paused) start() }

    // WebGL 컨텍스트 손실/복구 — 발표 모드가 추가 컨텍스트를 만들어 편집 캔버스 컨텍스트가
    // 회수되면(빈 화면) 자동 복구되지 않으므로 직접 처리. lost는 preventDefault해야 복구 가능.
    const onCtxLost = (e) => { e.preventDefault(); stop(); glRenderer = null }
    const onCtxRestored = () => {
      glRenderer = createChromaRenderer(canvas)
      autoKeyRef.current = null
      if (video.readyState >= 2) { drawFrame(); if (!video.paused) start() }
    }
    canvas.addEventListener('webglcontextlost', onCtxLost, false)
    canvas.addEventListener('webglcontextrestored', onCtxRestored, false)

    video.addEventListener('loadedmetadata', onLoadedMeta)
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    video.addEventListener('seeked', drawFrame)
    if (video.readyState >= 1) ensureStillFrame()
    if (video.readyState >= 2) onLoaded()

    return () => {
      stop()
      drawFrameRef.current = null
      canvas.removeEventListener('webglcontextlost', onCtxLost, false)
      canvas.removeEventListener('webglcontextrestored', onCtxRestored, false)
      video.removeEventListener('loadedmetadata', onLoadedMeta)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('seeked', drawFrame)
      // 언마운트/소스 변경 시 오디오 정지 — DOM에서 분리된 <video>는 그냥 두면 소리가 계속 난다
      // (발표 모드 페이지 전환 시 이전 슬라이드 휴먼 영상 음성이 남던 문제 방지).
      try { video.pause() } catch { /* noop */ }
      glRenderer?.dispose()
    }
  }, [blobUrl, playNow, glGen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!blobUrl) {
    return <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>로딩...</span>
    </div>
  }

  const controls = playNow && !hideControls
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
        key={glGen}
        ref={canvasRef}
        // 재생 중 캔버스는 자체 컴포지팅 레이어라 상위 overflow:hidden+radius 클립을 벗어난다
        // (발표 모드에서 모서리 안 둥글던 문제) → border-radius를 캔버스에 직접 적용.
        style={{ width: '100%', height: '100%', objectFit: objectFit || 'contain', display: 'block', borderRadius: radius, pointerEvents: 'none' }}
      />
      <video
        ref={videoRef}
        src={blobUrl}
        preload="metadata"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: controls ? 0.001 : 0,
          pointerEvents: controls ? 'auto' : 'none',
        }}
        controls={controls}
        autoPlay={playNow && autoplay}
        loop={loop}
        muted={muted}
        playsInline
      />
    </div>
  )
}
