import { useRef, useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'
import { useEditorStore } from '../store/editorStore'
import { getSegmenter } from '../core/videoMatte'
import { createMatteRenderer } from '../core/matteGL'

// 2D 폴백 캔버스 긴 변 상한 — 그리기만 다운스케일(매트는 모델 해상도).
const PROC_MAX = 960

/**
 * MatteVideoPlayer — AI 배경 제거(element.chroma.matte==='ai')가 켜진 영상을 실시간 합성 재생.
 *
 * MediaPipe Selfie Segmentation으로 매 프레임 사람 전경 매트를 만든다. 기본 경로는 WebGL
 * (matteGL): 영상 프레임 텍스처 + 매트를 단일채널 Uint8 텍스처로 업로드해 셰이더가
 * vec4(RGB, maskAlpha)를 출력(JS 픽셀 루프 없음). 미지원/실패 시 2D(source-in) 폴백.
 * 비파괴: 원본 영상은 그대로, 요소 설정만으로 렌더. 오디오는 숨긴 <video>가 담당.
 * 세그멘터 로드 전/실패 시 원본 영상을 그대로 그린다(무해 폴백).
 */
export default function MatteVideoPlayer({ content, playNow, autoplay, loop, muted, hideControls, objectFit, objectPosition, transform, radius }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const maskCanvasRef = useRef(null)
  const maskBufRef = useRef(null) // f32 매트 → Uint8 텍스처용 재사용 버퍼(GL 경로)
  const rafRef = useRef(0)
  const segRef = useRef(null)
  const drawFrameRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | failed

  // 발표 종료 시 WebGL 컨텍스트 재확보를 위해 canvas를 remount(손실 컨텍스트는 같은 canvas에서
  // getContext로 못 살림 — ChromaVideoPlayer와 동일 패턴).
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

  // 세그멘터 로드(세션 싱글턴)
  useEffect(() => {
    let alive = true
    getSegmenter()
      .then(seg => { if (alive) { segRef.current = seg; setStatus('ready'); drawFrameRef.current?.() } })
      .catch(err => { if (alive) { setStatus('failed'); console.warn('[matte] 세그멘터 로드 실패:', err?.message) } })
    return () => { alive = false }
  }, [])

  // 비디오 루프 + 합성
  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !blobUrl) return

    // WebGL 우선, 실패 시 2D. 컨텍스트 손실 대비 glRenderer는 mutable.
    let glRenderer = createMatteRenderer(canvas)
    const ctx2d = glRenderer ? null : canvas.getContext('2d')
    let proc = { w: 0, h: 0 }

    const sizeCanvas2D = () => {
      const vw = video.videoWidth || 0, vh = video.videoHeight || 0
      if (!vw || !vh) return false
      const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
      proc = { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round(vh * scale)) }
      if (canvas.width !== proc.w || canvas.height !== proc.h) { canvas.width = proc.w; canvas.height = proc.h }
      return true
    }

    const drawPlain = () => {
      if (glRenderer) { glRenderer.render(video, null, 0, 0); return }
      if (!ctx2d || !sizeCanvas2D()) return
      try { ctx2d.clearRect(0, 0, proc.w, proc.h); ctx2d.drawImage(video, 0, 0, proc.w, proc.h) } catch { /* tainted */ }
    }

    // 2D 폴백 합성: 매트 Float32 → ImageData 알파 → source-in
    const composite2d = (mask) => {
      if (!ctx2d || !sizeCanvas2D()) return
      const mw = mask.width, mh = mask.height
      let f32
      try { f32 = mask.getAsFloat32Array() } catch { drawPlain(); return }
      const mc = maskCanvasRef.current || (maskCanvasRef.current = document.createElement('canvas'))
      if (mc.width !== mw || mc.height !== mh) { mc.width = mw; mc.height = mh }
      const mctx = mc.getContext('2d')
      const id = mctx.createImageData(mw, mh)
      const d = id.data
      for (let i = 0; i < f32.length; i++) {
        const a = f32[i] < 0 ? 0 : f32[i] > 1 ? 255 : (f32[i] * 255) | 0
        const j = i * 4
        d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = a
      }
      mctx.putImageData(id, 0, 0)
      ctx2d.save()
      ctx2d.clearRect(0, 0, proc.w, proc.h)
      ctx2d.imageSmoothingEnabled = true
      ctx2d.drawImage(mc, 0, 0, proc.w, proc.h)
      ctx2d.globalCompositeOperation = 'source-in'
      ctx2d.drawImage(video, 0, 0, proc.w, proc.h)
      ctx2d.globalCompositeOperation = 'source-over'
      ctx2d.restore()
    }

    const drawFrame = () => {
      if (video.readyState < 2) return
      const seg = segRef.current
      if (!seg) { drawPlain(); return }
      try {
        seg.segmentForVideo(video, performance.now(), (result) => {
          const mask = result.confidenceMasks?.[0]
          if (!mask) { drawPlain(); return }
          try {
            if (glRenderer) {
              // confidence 마스크는 0~1 float → Uint8(0~255)로 변환해 LUMINANCE 텍스처 업로드
              let f32 = null
              try { f32 = mask.getAsFloat32Array() } catch { f32 = null }
              if (f32) {
                const n = f32.length
                let u8 = maskBufRef.current
                if (!u8 || u8.length !== n) u8 = maskBufRef.current = new Uint8Array(n)
                for (let i = 0; i < n; i++) { const x = f32[i]; u8[i] = x < 0 ? 0 : x > 1 ? 255 : (x * 255) | 0 }
                glRenderer.render(video, u8, mask.width, mask.height)
              } else drawPlain()
            } else {
              composite2d(mask)
            }
          } finally { mask.close?.() }
        })
      } catch { drawPlain() }
    }
    drawFrameRef.current = drawFrame

    // 정지 미리보기: 검은 인트로 회피 위해 대표 프레임(0.1초)로 seek
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

    // WebGL 컨텍스트 손실/복구(발표 모드 다중 컨텍스트 등)
    const onCtxLost = (e) => { e.preventDefault(); stop(); glRenderer = null }
    const onCtxRestored = () => {
      glRenderer = createMatteRenderer(canvas)
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
      try { video.pause() } catch { /* noop */ }
      glRenderer?.dispose()
    }
  }, [blobUrl, playNow, status, glGen])

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
        style={{ width: '100%', height: '100%', objectFit: objectFit || 'contain', objectPosition, transform: transform || undefined, transformOrigin: 'center center', display: 'block', borderRadius: radius, pointerEvents: 'none' }}
      />
      {status !== 'ready' && (
        <div style={{ position: 'absolute', left: 6, top: 6, fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'rgba(2,6,23,0.7)', color: status === 'failed' ? '#fca5a5' : '#a5b4fc', pointerEvents: 'none' }}>
          {status === 'failed' ? 'AI 배경 제거 로드 실패' : 'AI 배경 준비 중…'}
        </div>
      )}
      <video
        ref={videoRef}
        src={blobUrl}
        preload="metadata"
        crossOrigin="anonymous"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: controls ? 0.001 : 0, pointerEvents: controls ? 'auto' : 'none' }}
        controls={controls}
        autoPlay={playNow && autoplay}
        loop={loop}
        muted={muted}
        playsInline
      />
    </div>
  )
}
