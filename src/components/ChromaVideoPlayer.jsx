import { useRef, useEffect, useState } from 'react'
import { BlobStore } from '../core/BlobStore'
import { applyChromaToImageData, despillImageData, detectBgColorFromCtx, chromaEntries } from '../core/chromaKey'

// 프레임 처리 캔버스 긴 변 상한 — getImageData/putImageData 픽셀 루프 부하 억제.
// 표시 크기는 CSS로 박스에 맞추므로(요소 width/height) 처리 해상도만 캡한다.
const PROC_MAX = 960

/**
 * ChromaVideoPlayer — 크로마키(배경 단색 제거)가 켜진 영상을 실시간 합성 재생.
 *
 * 숨긴 <video>를 매 프레임 <canvas>에 그리고 키색 기준으로 알파를 깎아 표시한다.
 * 비파괴: 원본 영상은 그대로, element.chroma 설정(key/tolerance/feather)만으로 렌더.
 * 오디오는 <video>가 그대로 재생(canvas는 영상 픽셀만 담당).
 *
 * @param {object} chroma { key:{r,g,b}|null(자동), tolerance, feather }
 */
export default function ChromaVideoPlayer({ content, playNow, autoplay, loop, muted, hideControls, objectFit, chroma }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const usingVfcRef = useRef(false)
  // 자동(키색 null)일 때 첫 프레임에서 추정한 색을 보관 — 매 프레임 재추정 방지.
  const autoKeyRef = useRef(null)

  useEffect(() => {
    if (!isIdb) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content)).then(url => { if (!cancelled) setIdbUrl(url) })
    return () => { cancelled = true }
  }, [content, isIdb])

  const blobUrl = isIdb ? idbUrl : content

  // 키 항목 배열로 정규화(구버전 단일 키 호환). 매 렌더 새 배열이라 effect 의존엔 직렬화 키 사용.
  const entries = chromaEntries(chroma)
  // 키 + 디스필을 합친 시그니처 — 슬라이더 변경 시 정지 프레임도 다시 그리도록.
  const chromaSig = JSON.stringify({ entries, despill: chroma?.despill ?? 0 })

  // 설정이 바뀌면 자동 추정 캐시 무효화
  useEffect(() => { autoKeyRef.current = null }, [chromaSig])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !blobUrl) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    let proc = { w: 0, h: 0 }

    const sizeCanvas = () => {
      const vw = video.videoWidth || 0, vh = video.videoHeight || 0
      if (!vw || !vh) return false
      const scale = Math.min(1, PROC_MAX / Math.max(vw, vh))
      proc = { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round(vh * scale)) }
      if (canvas.width !== proc.w || canvas.height !== proc.h) {
        canvas.width = proc.w; canvas.height = proc.h
      }
      return true
    }

    const drawFrame = () => {
      // 실제 디코딩된 프레임이 없으면(메타데이터만 로드 등) 그리지 않는다.
      // 안 그러면 빈/검은 프레임으로 키색을 잘못 추정해 전체가 투명해지는 버그 발생.
      if (video.readyState < 2) return
      if (!sizeCanvas()) return
      try {
        ctx.drawImage(video, 0, 0, proc.w, proc.h)
        const frame = ctx.getImageData(0, 0, proc.w, proc.h)
        // 자동(key=null) 항목은 대표 프레임 모서리 색을 1회 추정해 캐시.
        // 여러 키를 '순차' 적용 — 1차 제거 후 잔류색을 2차로 더 깎음.
        let primaryKey = null
        for (const e of entries) {
          let key = e.key
          if (!key) {
            if (!autoKeyRef.current) autoKeyRef.current = detectBgColorFromCtx(ctx, proc.w, proc.h)
            key = autoKeyRef.current
          }
          if (!primaryKey) primaryKey = key
          applyChromaToImageData(frame, key, e.tolerance ?? 18, e.feather)
        }
        // 디스필: 키 제거 후 전경에 남은 색번짐을 1차 키색 기준으로 보정
        if (chroma?.despill > 0 && primaryKey) despillImageData(frame, primaryKey, chroma.despill)
        ctx.putImageData(frame, 0, 0)
      } catch {
        // CORS 등으로 캔버스가 tainted면 읽기 불가 — 루프 중단(호출부가 외부 URL은 차단함)
      }
    }

    // 정지 미리보기(비재생): 검은 인트로 프레임을 피해 대표 프레임(0.1초)으로 seek해 디코딩 강제.
    // 포스터 생성이 #t=0.1을 쓰던 것과 동일한 이유 — 일관된 첫 프레임 확보.
    const ensureStillFrame = () => {
      if (playNow) return
      try { if ((video.currentTime || 0) < 0.05 && (video.duration || 1) > 0.15) video.currentTime = 0.1 } catch { /* 메타데이터 전이면 무시 */ }
    }

    // requestVideoFrameCallback 우선(프레임 정확), 미지원 시 rAF 폴백.
    const hasVfc = typeof video.requestVideoFrameCallback === 'function'
    usingVfcRef.current = hasVfc

    const vfcLoop = () => { drawFrame(); rafRef.current = video.requestVideoFrameCallback(vfcLoop) }
    const rafLoop = () => { drawFrame(); rafRef.current = requestAnimationFrame(rafLoop) }

    const start = () => {
      if (hasVfc) rafRef.current = video.requestVideoFrameCallback(vfcLoop)
      else rafRef.current = requestAnimationFrame(rafLoop)
    }
    const stop = () => {
      if (!rafRef.current) return
      if (hasVfc) video.cancelVideoFrameCallback?.(rafRef.current)
      else cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }

    // 메타데이터 로드 후: 정지면 대표 프레임 seek, 재생이면 루프 시작.
    const onLoadedMeta = () => ensureStillFrame()
    const onLoaded = () => { drawFrame(); if (!video.paused) start() }
    video.addEventListener('loadedmetadata', onLoadedMeta)
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    video.addEventListener('seeked', drawFrame)
    // 이미 준비된 상태로 마운트된 경우(예: 설정 변경 재실행) 즉시 반영
    if (video.readyState >= 1) ensureStillFrame()
    if (video.readyState >= 2) onLoaded()

    return () => {
      stop()
      video.removeEventListener('loadedmetadata', onLoadedMeta)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('seeked', drawFrame)
    }
  }, [blobUrl, playNow, chromaSig]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!blobUrl) {
    return <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>로딩...</span>
    </div>
  }

  const controls = playNow && !hideControls
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* 표시: 합성된 캔버스 (투명 배경) */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', objectFit: objectFit || 'contain', display: 'block', pointerEvents: 'none' }}
      />
      {/* 원본 영상: 화면에 안 보이게 숨김(오디오/디코딩 소스). 컨트롤이 필요하면 위에 겹쳐 노출 */}
      <video
        ref={videoRef}
        src={blobUrl}
        preload="metadata"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: controls ? 0.001 : 0, // 컨트롤 노출 시 클릭 받도록 거의 투명, 아니면 완전 숨김
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
