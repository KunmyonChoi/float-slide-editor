import { useEffect, useRef, useState, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from '../core/BlobStore'
import { nextFlatId } from '../core/FlatExtractor'

// avatar-recorder 연동 규약(integration-api.md): 팝업 + postMessage. Genitor는 호출자(opener).
const RECORDER_URL = 'https://avatar-recorder.netlify.app'
const RECORDER_ORIGIN = 'https://avatar-recorder.netlify.app'

// 결과 Blob → 현재 슬라이드에 비디오 요소로 삽입(기존 비디오 삽입 경로와 동일 구성)
async function insertVideoBlob(blob, filename) {
  const st = useFlatStore.getState()
  const key = await BlobStore.put(blob)
  const blobUrl = await BlobStore.getUrl(key)
  // 메타데이터로 내재 해상도 측정 → 캔버스의 60% 이내로 축소 배치
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = blobUrl
  await new Promise(r => { video.onloadedmetadata = r; video.onerror = r })
  let w = video.videoWidth || 560
  let h = video.videoHeight || 315
  const cs = st.canvasSize || { w: 1920, h: 1080 }
  const maxW = cs.w * 0.6, maxH = cs.h * 0.6
  if (w > maxW || h > maxH) {
    const ratio = Math.min(maxW / w, maxH / h)
    w = Math.round(w * ratio); h = Math.round(h * ratio)
  }
  const els = st.flatElements
  const maxZ = els.length > 0 ? Math.max(...els.map(e => e.zIndex)) : 0
  const el = {
    id: nextFlatId(), sourceId: null,
    type: 'video', width: w, height: h,
    content: BlobStore.toRef(key),
    isRich: false, merged: false,
    // 튜토리얼 영상: 컨트롤 표시 + 자동재생 off
    autoplay: false, loop: false, muted: false, hideControls: false,
    filename: filename || undefined,
    x: Math.round((cs.w - w) / 2), y: Math.round((cs.h - h) / 2),
    zIndex: maxZ + 1,
    styles: { backgroundColor: 'rgba(0,0,0,0)', borderRadius: '8px', opacity: '1' },
  }
  st.addFlatElement(el)
  st.setSelectedFlat(el.id)
}

/**
 * 튜토리얼 녹화 — avatar-recorder 팝업을 열어(음성+화면 녹화) 결과 영상을
 * 현재 슬라이드에 비디오 요소로 삽입한다. 녹화 제어/해상도 선택은 팝업 자체 UI가 담당.
 */
export default function AvatarRecorderButton() {
  const [active, setActive] = useState(false)
  const winRef = useRef(null)
  const sessionRef = useRef(null)

  const cleanup = useCallback((closeWin = false) => {
    if (closeWin && winRef.current && !winRef.current.closed) {
      try { winRef.current.close() } catch { /* 무시 */ }
    }
    winRef.current = null
    sessionRef.current = null
    setActive(false)
  }, [])

  // 결과/취소/오류 수신 (반드시 origin + session 검증)
  useEffect(() => {
    const onMsg = async (e) => {
      if (e.origin !== RECORDER_ORIGIN) return
      const { type, sessionId, blob, filename } = e.data || {}
      if (sessionRef.current && sessionId && sessionId !== sessionRef.current) return
      switch (type) {
        case 'avatar-recorder:result':
          if (blob) {
            try { await insertVideoBlob(blob, filename) }
            catch (err) { console.warn('[avatar-recorder] 삽입 실패:', err?.message) }
          }
          cleanup(true)
          break
        case 'avatar-recorder:cancelled':
        case 'avatar-recorder:error':
          cleanup(false)
          break
        // ready / recording-started / recording-stopped: 팝업 UI가 제어하므로 별도 처리 없음
        default: break
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [cleanup])

  // 사용자가 팝업을 직접 닫은 경우 감지 → 상태 정리
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      if (!winRef.current || winRef.current.closed) cleanup(false)
    }, 1000)
    return () => clearInterval(t)
  }, [active, cleanup])

  const onClick = useCallback(() => {
    // 이미 세션이 열려 있으면 그 창으로 포커스
    if (active && winRef.current && !winRef.current.closed) {
      try { winRef.current.focus() } catch { /* 무시 */ }
      return
    }
    const sessionId = (globalThis.crypto?.randomUUID?.() || `genitor-${Date.now()}`)
    sessionRef.current = sessionId
    const params = new URLSearchParams({ mode: 'popup', origin: window.location.origin, session: sessionId })
    // noopener=0 필수 — opener 참조 유지(결과 postMessage 수신)
    const w = window.open(`${RECORDER_URL}?${params}`, 'avatar-recorder', 'width=1280,height=800,noopener=0')
    if (!w) {
      sessionRef.current = null
      alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용한 뒤 다시 시도하세요.')
      return
    }
    winRef.current = w
    setActive(true)
  }, [active])

  return (
    <button
      onClick={onClick}
      title={active ? '녹화 창 열림 — 클릭하여 창으로 이동' : '튜토리얼 녹화 (화면+음성) → 현재 슬라이드에 삽입'}
      className={[
        'flex items-center px-2.5 py-1.5 rounded-lg text-sm transition-colors',
        active ? 'text-red-300 bg-red-500/15 hover:bg-red-500/25' : 'text-slate-300 hover:text-white hover:bg-white/10',
      ].join(' ')}
    >
      <RecordIcon active={active} />
      <span className="text-xs ml-1 tb-label">{active ? '녹화 중…' : '튜토리얼 녹화'}</span>
    </button>
  )
}

function RecordIcon({ active }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" fill={active ? '#f87171' : 'currentColor'} stroke="none" />
    </svg>
  )
}
