import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import { VIDEO_RESOLUTIONS, VIDEO_FPS, VIDEO_QUALITIES, videoOutputSize, formatElapsed } from '../core/videoExport'
import { useVideoExportStore, closeVideoExport, startExport, recorderModule } from './videoExportState'

/**
 * 영상으로 내보내기(MP4) — 파일 ▸ 내보내기 메뉴에서 부르는 옵션 대화창 + 결과 안내.
 *
 * 앱 어딘가에 <VideoExportHost />를 한 번 마운트하고 openVideoExport()(videoExportState.js)를 부른다.
 * "녹화 시작"을 누르면 브라우저가 "이 탭" 공유를 묻고, 허락하면 대화창이 닫히고 덱이 발표
 * 화면에서 처음(또는 현재 장)부터 끝까지 재생되는 동안 녹화된다(videoRecorder.js).
 */

const PREF_KEY = 'video-export-options'
const DEFAULTS = { resolution: 'canvas', fps: 30, quality: 'normal', range: 'all' }

function loadPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || '{}')
    return {
      resolution: VIDEO_RESOLUTIONS.some(r => r.id === v.resolution) ? v.resolution : DEFAULTS.resolution,
      fps: VIDEO_FPS.includes(v.fps) ? v.fps : DEFAULTS.fps,
      quality: VIDEO_QUALITIES.some(q => q.id === v.quality) ? v.quality : DEFAULTS.quality,
      range: v.range === 'current' ? 'current' : 'all',
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)) } catch { /* 무시 */ }
}

/** 옵션 대화창 + 결과 안내를 담는 호스트. 앱에 한 번만 마운트한다. */
export function VideoExportHost() {
  const view = useVideoExportStore(s => s.view)
  useEffect(() => { if (view === 'options') recorderModule() }, [view])
  if (view === 'options') return <VideoExportModal />
  if (view === 'result') return <VideoExportResult />
  return null
}

function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20000,
        background: 'rgba(0,0,0,0.45)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div role="dialog" aria-label={title} style={{
        width: 420, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12, color: '#e2e8f0',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

function VideoExportModal() {
  const busy = useVideoExportStore(s => s.busy)
  const error = useVideoExportStore(s => s.error)
  const canvasSize = useFlatStore(s => s.canvasSize)
  const currentPage = useFlatStore(s => s.flatCurrentPage) || 0
  const [opts, setOpts] = useState(loadPrefs)
  const set = (patch) => setOpts(o => { const n = { ...o, ...patch }; savePrefs(n); return n })

  const sizeOf = (id) => { const s = videoOutputSize(canvasSize, id); return `${s.w}×${s.h}` }

  return (
    <Modal title="영상으로 내보내기 (MP4)" onClose={closeVideoExport}>
      <Group label="해상도">
        {VIDEO_RESOLUTIONS.map(r => (
          <Choice key={r.id} checked={opts.resolution === r.id} label={r.label} hint={sizeOf(r.id)}
            onClick={() => set({ resolution: r.id })} />
        ))}
      </Group>
      <Group label="프레임 속도">
        {VIDEO_FPS.map(f => (
          <Choice key={f} checked={opts.fps === f} label={`${f} fps`} hint={f === 30 ? '기본' : '부드러움 · 파일 큼'}
            onClick={() => set({ fps: f })} />
        ))}
      </Group>
      <Group label="화질">
        {VIDEO_QUALITIES.map(q => (
          <Choice key={q.id} checked={opts.quality === q.id} label={q.label} hint={q.hint}
            onClick={() => set({ quality: q.id })} />
        ))}
      </Group>
      <Group label="슬라이드 범위">
        <Choice checked={opts.range === 'all'} label="전체" hint="첫 장부터" onClick={() => set({ range: 'all' })} />
        <Choice checked={opts.range === 'current'} label="현재 장부터" hint={`${currentPage + 1}번째 장부터`}
          onClick={() => set({ range: 'current' })} />
      </Group>

      <div style={{
        fontSize: 11.5, lineHeight: 1.55, color: 'rgba(255,255,255,0.6)',
        background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: '8px 10px',
      }}>
        녹화 시작을 누르면 브라우저가 화면 공유를 묻습니다 — <b style={{ color: '#e2e8f0' }}>“이 탭”</b>을 고르고
        <b style={{ color: '#e2e8f0' }}> 탭 오디오 공유</b>를 켜 두세요(나레이션·배경음악이 함께 담깁니다).
        덱이 실제로 재생되는 시간만큼 녹화가 걸리고, 클릭으로 넘기는 장은 10초 뒤 넘어갑니다.
        녹화 중에는 다른 탭으로 옮기거나 창을 가리지 마세요. Esc 또는 정지를 누르면 거기까지 저장합니다.
      </div>

      {error && (
        <div style={{
          fontSize: 12, color: '#fecaca', background: 'rgba(239,68,68,0.15)',
          border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, padding: '8px 10px',
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={closeVideoExport} disabled={busy} style={btnGhost}>취소</button>
        <button onClick={() => startExport(opts)} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>
          {busy ? '화면 공유 대기 중…' : '녹화 시작'}
        </button>
      </div>
      <style>{`.video-export-item:hover { background: rgba(255,255,255,0.1) }`}</style>
    </Modal>
  )
}

function VideoExportResult() {
  const result = useVideoExportStore(s => s.result)
  if (!result) return null
  const mb = result.size ? (result.size / (1024 * 1024)).toFixed(1) : '0'
  return (
    <Modal title="영상 저장 완료" onClose={closeVideoExport}>
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <div><b>{result.fileName}</b></div>
        <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
          길이 {formatElapsed(result.durationMs)} · {mb} MB
          {result.stoppedEarly ? ' · 도중에 멈춘 곳까지 저장' : ''}
        </div>
      </div>
      {result.noAudio && (
        <div style={{
          fontSize: 12, color: '#fde68a', background: 'rgba(245,158,11,0.15)',
          border: '1px solid rgba(245,158,11,0.35)', borderRadius: 8, padding: '8px 10px',
        }}>
          탭 오디오가 공유되지 않아 소리 없이 영상만 저장했습니다. 소리까지 담으려면 화면 공유 창에서
          “탭 오디오도 공유”를 켜 주세요.
        </div>
      )}
      {/\.webm$/i.test(result.fileName || '') && (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.5)' }}>
          이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장했습니다.
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={closeVideoExport} style={btnPrimary}>닫기</button>
      </div>
    </Modal>
  )
}

function Group({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', padding: '0 12px 4px' }}>{label}</div>
      {children}
    </div>
  )
}

function Choice({ checked, label, hint, onClick }) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="video-export-item"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 12px', borderRadius: 6, cursor: 'pointer', color: '#e2e8f0',
      }}
    >
      <span style={{ width: 14, fontSize: 12, color: '#22c55e' }}>{checked ? '✓' : ''}</span>
      <span style={{ fontSize: 13 }}>{label}</span>
      {hint && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginLeft: 'auto' }}>{hint}</span>}
    </div>
  )
}

const btnPrimary = {
  background: 'rgba(99,102,241,0.9)', color: '#fff', border: 'none',
  borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
}
const btnGhost = {
  background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
}
