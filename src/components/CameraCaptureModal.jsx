import { create } from 'zustand'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { insertVideoBlob } from '../core/insertVideoBlob'

/**
 * 웹캠 녹화 모달 (셀프 아바타 Phase 1) — openCameraCapture()로 연다.
 * getUserMedia({video,audio}) 라이브 프리뷰 → MediaRecorder 녹화 → 리뷰 →
 * insertVideoBlob으로 현재 슬라이드에 비디오 요소 삽입. (이후 립싱크→배경제거 파이프라인의 입력)
 */
const useStore = create(() => ({ open: false }))
// eslint-disable-next-line react-refresh/only-export-components -- 모달 오프너(다른 모달과 동일 패턴)
export function openCameraCapture() { useStore.setState({ open: true }) }
function close() { useStore.setState({ open: false }) }

const MAX_SEC = 120 // 안전 상한(자동 정지)

// MediaRecorder 지원 mime 우선순위(webm vp9 → vp8 → 기본 → mp4)
function pickMime() {
  const cands = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  if (typeof MediaRecorder === 'undefined') return ''
  return cands.find(t => MediaRecorder.isTypeSupported?.(t)) || ''
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function CameraCaptureHost() {
  const open = useStore(s => s.open)
  if (!open) return null
  return <Dialog />
}

function Dialog() {
  const videoRef = useRef(null)          // 라이브 프리뷰 <video>
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const [phase, setPhase] = useState('init')   // init | ready | recording | review | error
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [mirror, setMirror] = useState(true)
  const [recordedUrl, setRecordedUrl] = useState('')
  const recordedUrlRef = useRef('')
  const recordedBlobRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const setRecorded = useCallback((url) => {
    if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    recordedUrlRef.current = url
    setRecordedUrl(url)
  }, [])

  const stopStream = useCallback(() => {
    const s = streamRef.current
    if (s) { s.getTracks().forEach(t => { try { t.stop() } catch { /* 무시 */ } }) }
    streamRef.current = null
  }, [])

  // 스트림 획득(디바이스 지정 가능)
  const acquire = useCallback(async (wantId) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('이 브라우저는 카메라 캡처(getUserMedia)를 지원하지 않습니다.'); setPhase('error'); return
    }
    if (!window.isSecureContext) {
      setError('보안 컨텍스트(HTTPS)에서만 카메라를 쓸 수 있습니다.'); setPhase('error'); return
    }
    try {
      stopStream()
      const video = wantId ? { deviceId: { exact: wantId } } : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: true })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; await videoRef.current.play().catch(() => {}) }
      // 권한 후에야 label이 채워짐 → 디바이스 목록 갱신
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput')
      setDevices(list)
      const active = stream.getVideoTracks()[0]?.getSettings?.().deviceId
      if (active) setDeviceId(active)
      setPhase('ready')
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다. 브라우저 주소창의 카메라 아이콘에서 허용해 주세요.' : `카메라를 열 수 없습니다: ${e?.message || e}`)
      setPhase('error')
    }
  }, [stopStream])

  // 마운트 시 스트림 획득 / 언마운트 정리
  useEffect(() => {
    acquire('')
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      try { recorderRef.current?.state === 'recording' && recorderRef.current.stop() } catch { /* 무시 */ }
      stopStream()
      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startRec = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    chunksRef.current = []
    const mime = pickMime()
    let rec
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream) }
    catch (e) { setError(`녹화를 시작할 수 없습니다: ${e?.message || e}`); setPhase('error'); return }
    rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm'
      const blob = new Blob(chunksRef.current, { type })
      recordedBlobRef.current = blob
      setRecorded(URL.createObjectURL(blob))
      setPhase('review')
    }
    recorderRef.current = rec
    rec.start()
    setElapsed(0)
    setPhase('recording')
    timerRef.current = setInterval(() => {
      setElapsed(prev => {
        const next = prev + 1
        if (next >= MAX_SEC) { try { rec.state === 'recording' && rec.stop() } catch { /* 무시 */ } clearInterval(timerRef.current) }
        return next
      })
    }, 1000)
  }, [setRecorded])

  const stopRec = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop() } catch { /* 무시 */ }
  }, [])

  const retake = useCallback(() => {
    setRecorded('')
    recordedBlobRef.current = null
    setElapsed(0)
    setPhase(streamRef.current ? 'ready' : 'init')
    if (!streamRef.current) acquire(deviceId)
  }, [setRecorded, deviceId, acquire])

  const insert = useCallback(async () => {
    const blob = recordedBlobRef.current
    if (!blob) return
    setBusy(true)
    try {
      const ext = (blob.type.includes('mp4')) ? 'mp4' : 'webm'
      // 구동 영상(립싱크 입력): 자동재생 off, 컨트롤 표시
      await insertVideoBlob(blob, `webcam-${Date.now()}.${ext}`, { autoplay: false, muted: false, hideControls: false })
      stopStream()
      close()
    } catch (e) {
      alert('삽입에 실패했습니다: ' + (e?.message || e))
    } finally { setBusy(false) }
  }, [stopStream])

  const onClose = useCallback(() => { stopStream(); close() }, [stopStream])

  return createPortal(
    <div onMouseDown={onClose} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>📹 웹캠 녹화</div>
          {phase === 'recording' && <div style={{ fontSize: 13, color: '#fca5a5', fontWeight: 700 }}>● REC {fmt(elapsed)} / {fmt(MAX_SEC)}</div>}
        </div>

        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#000', borderRadius: 12, overflow: 'hidden' }}>
          {/* 라이브 프리뷰 (리뷰 단계에선 숨김) */}
          <video ref={videoRef} autoPlay playsInline muted
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: phase === 'review' ? 'none' : 'block', transform: mirror ? 'scaleX(-1)' : 'none' }} />
          {/* 녹화 리뷰 재생 */}
          {phase === 'review' && recordedUrl && (
            <video src={recordedUrl} controls playsInline
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
          )}
          {phase === 'error' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#fca5a5', fontSize: 13, lineHeight: 1.6 }}>{error}</div>
          )}
          {phase === 'init' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>카메라 준비 중…</div>
          )}
        </div>

        {/* 컨트롤 바 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {(phase === 'ready' || phase === 'recording') && devices.length > 1 && (
            <select value={deviceId} disabled={phase === 'recording'}
              onChange={e => { setDeviceId(e.target.value); acquire(e.target.value) }}
              style={selectStyle}>
              {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `카메라 ${i + 1}`}</option>)}
            </select>
          )}
          {phase !== 'review' && phase !== 'error' && (
            <label style={{ fontSize: 12.5, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={mirror} onChange={e => setMirror(e.target.checked)} disabled={phase === 'recording'} /> 좌우 반전(미리보기)
            </label>
          )}

          <div style={{ flex: 1 }} />

          {phase === 'error' && <button type="button" style={ghostBtn} onClick={() => acquire('')}>다시 시도</button>}
          {phase === 'ready' && <button type="button" style={recBtn} onClick={startRec}>● 녹화 시작</button>}
          {phase === 'recording' && <button type="button" style={stopBtn} onClick={stopRec}>■ 정지</button>}
          {phase === 'review' && (
            <>
              <button type="button" style={ghostBtn} onClick={retake} disabled={busy}>↺ 다시 촬영</button>
              <button type="button" style={{ ...primaryBtn, opacity: busy ? 0.6 : 1 }} onClick={insert} disabled={busy}>
                {busy ? '삽입 중…' : '슬라이드에 삽입'}
              </button>
            </>
          )}
          <button type="button" style={ghostBtn} onClick={onClose} disabled={busy}>닫기</button>
        </div>

        <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          녹화 영상은 <b style={{ color: '#94a3b8' }}>구동 영상</b>으로 쓸 수 있습니다 — 삽입 후 영상 선택 ▸ 🎬 AI 립싱크로
          노트 음성에 맞춰 입을 합성하고, 배경 제거로 투명 아바타를 만들 수 있습니다.
        </div>
      </div>
    </div>,
    document.body,
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(640px, 96vw)', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
const ghostBtn = { padding: '7px 12px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.16)', background: 'transparent', color: '#cbd5e1', fontWeight: 600 }
const recBtn = { ...primaryBtn, background: 'rgba(239,68,68,0.9)' }
const stopBtn = { ...primaryBtn, background: 'rgba(239,68,68,0.9)' }
const selectStyle = { fontSize: 12.5, padding: '6px 8px', borderRadius: 8, background: '#0b1220', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)', maxWidth: 220 }
