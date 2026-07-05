import { useRef, useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'
import { getSegmenter } from '../core/videoMatte'

// 표시 캔버스 긴 변 상한 — 합성 부하 억제(매트는 모델 해상도, 그리기만 다운스케일).
const PROC_MAX = 960

/**
 * MatteVideoPlayer — AI 배경 제거(element.chroma.matte==='ai')가 켜진 영상을 실시간 합성 재생.
 *
 * MediaPipe Selfie Segmentation으로 매 프레임 사람 전경 매트를 만들고, 2D 캔버스의
 * globalCompositeOperation='source-in'으로 영상을 매트에 클립한다(JS 픽셀 루프 없이 GPU 가속).
 * 비파괴: 원본 영상은 그대로, 요소 설정만으로 렌더. 오디오는 숨긴 <video>가 담당.
 * 세그멘터 로드 전/실패 시 원본 영상을 그대로 그린다(무해 폴백).
 */
export default function MatteVideoPlayer({ content, playNow, autoplay, loop, muted, hideControls, objectFit, objectPosition, transform, radius }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const maskCanvasRef = useRef(null)
  const rafRef = useRef(0)
  const segRef = useRef(null)
  const drawFrameRef = useRef(null)
  const [status, setStatus] = useState('loading') // loading | ready | failed

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
    const ctx = canvas.getContext('2d')
    let proc = { w: 0, h: 0 }

    const sizeCanvas = () => {
      const vw = video.videoWidth || 0, vh = video.videoHeight || 0
      if (!vw || !vh) return false
      const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
      proc = { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round(vh * scale)) }
      if (canvas.width !== proc.w || canvas.height !== proc.h) { canvas.width = proc.w; canvas.height = proc.h }
      return true
    }

    const drawPlain = () => { try { ctx.clearRect(0, 0, proc.w, proc.h); ctx.drawImage(video, 0, 0, proc.w, proc.h) } catch { /* tainted */ } }

    const composite = (mask) => {
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
      // 합성: 매트를 대상 알파로 깔고(source-in) 영상을 클립
      ctx.save()
      ctx.clearRect(0, 0, proc.w, proc.h)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(mc, 0, 0, proc.w, proc.h)
      ctx.globalCompositeOperation = 'source-in'
      ctx.drawImage(video, 0, 0, proc.w, proc.h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
    }

    const drawFrame = () => {
      if (video.readyState < 2 || !sizeCanvas()) return
      const seg = segRef.current
      if (!seg) { drawPlain(); return }
      try {
        seg.segmentForVideo(video, performance.now(), (result) => {
          const mask = result.confidenceMasks?.[0]
          if (!mask) { drawPlain(); return }
          try { composite(mask) } finally { mask.close?.() }
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
      video.removeEventListener('loadedmetadata', onLoadedMeta)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('seeked', drawFrame)
      try { video.pause() } catch { /* noop */ }
    }
  }, [blobUrl, playNow, status])

  if (!blobUrl) {
    return <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>로딩...</span>
    </div>
  }

  const controls = playNow && !hideControls
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <canvas
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
