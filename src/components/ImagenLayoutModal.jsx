import { create } from 'zustand'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildCaption } from '../core/ideogramCaption'
import {
  checkImagenBackend, isImagenReady, getImagenPresets, getImagenDevice,
  imagenDockerRunCommand, IMAGEN_DOCKER_IMAGE,
} from '../core/ImagenBackendClient'
import { startImagenJob } from '../core/imagenRunner'
import { useFlatStore } from '../store/flatStore'

/**
 * ImagenLayoutModal — 선택한 텍스트 박스들로 Ideogram 4 레이아웃 이미지를 생성.
 * 컨텍스트 메뉴에서 openImagenLayout({ els, canvasSize, pageKey })로 연다.
 * 전역 설명/배경/프리셋을 받아 캡션을 만들고 전역 작업(트레이)으로 시작한다.
 */
const PRESET_LABELS = {
  V4_TURBO_12: '빠름 (~30초)',
  V4_DEFAULT_20: '보통 (~50초)',
  V4_QUALITY_48: '고품질 (~2분)',
}
const DEFAULT_PRESETS = ['V4_TURBO_12', 'V4_DEFAULT_20', 'V4_QUALITY_48']

const useStore = create(() => ({ open: false, els: [], canvasSize: null, pageKey: null }))
// eslint-disable-next-line react-refresh/only-export-components -- 모달 오프너(CapabilitiesModal와 동일 패턴)
export function openImagenLayout({ els, canvasSize, pageKey }) {
  useStore.setState({ open: true, els: els || [], canvasSize: canvasSize || null, pageKey: pageKey || null })
}
function close() { useStore.setState({ open: false }) }

export function ImagenLayoutHost() {
  const open = useStore(s => s.open)
  if (!open) return null
  return <Dialog />
}

function Dialog() {
  const { els, canvasSize, pageKey } = useStore.getState()
  const [description, setDescription] = useState('')
  const [background, setBackground] = useState('')
  const [preset, setPreset] = useState('V4_TURBO_12')
  const [status, setStatus] = useState('checking') // checking | ready | down
  const [device, setDevice] = useState(null)
  const [copied, setCopied] = useState(false)

  const textEls = (els || []).filter(e => e && e.type === 'text')
  const presets = getImagenPresets() || DEFAULT_PRESETS

  useEffect(() => {
    let alive = true
    checkImagenBackend(true).then(ok => {
      if (!alive) return
      setStatus(ok && isImagenReady() ? 'ready' : ok ? 'loading' : 'down')
      setDevice(getImagenDevice())
    })
    return () => { alive = false }
  }, [])

  const generate = () => {
    const caption = buildCaption(textEls, canvasSize, { description: description.trim(), background: background.trim() })
    startImagenJob({ caption, canvasSize, preset, pageKey: pageKey || useFlatStore.getState().getCurrentPageKey() })
    close()
  }

  const copyCmd = () => {
    try { navigator.clipboard?.writeText(imagenDockerRunCommand({})); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const canGenerate = status === 'ready' && textEls.length > 0

  return createPortal(
    <div onMouseDown={close} style={overlay}>
      <div onMouseDown={e => e.stopPropagation()} style={panel}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>AI 레이아웃 이미지 생성</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>
          선택한 <b>텍스트 {textEls.length}개</b>의 위치·내용을 그대로 살려 Ideogram 4가 정밀한 레이아웃 이미지를 만듭니다.
          결과는 작업 트레이에서 캔버스에 적용합니다.
        </div>

        {status === 'down' ? (
          <div style={{ fontSize: 12, color: '#fca5a5', lineHeight: 1.6, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 8, padding: 10 }}>
            이미지 생성 서버에 연결할 수 없습니다. NVIDIA GPU(40GB+) 머신에서 아래 Docker로 실행하세요
            (게이트·비상업 모델 → 유효한 HF 토큰 필요):
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 10.5, color: '#cbd5e1', background: 'rgba(0,0,0,0.35)', padding: 8, borderRadius: 6, margin: '8px 0 0' }}>{imagenDockerRunCommand({})}</pre>
            <button type="button" onClick={copyCmd} style={ghostBtn}>{copied ? '복사됨 ✓' : '명령 복사'}</button>
            <span style={{ marginLeft: 8, color: '#64748b' }}>{IMAGEN_DOCKER_IMAGE}</span>
          </div>
        ) : (
          <>
            <label style={field}>
              <span style={fieldLabel}>전체 설명 (선택)</span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                placeholder="예: 미니멀한 테크 컨퍼런스 슬라이드, 네이비 배경" style={textarea} />
            </label>
            <label style={field}>
              <span style={fieldLabel}>배경 설명 (선택)</span>
              <input value={background} onChange={e => setBackground(e.target.value)}
                placeholder="예: 짙은 네이비 그라데이션" style={input} />
            </label>
            <label style={field}>
              <span style={fieldLabel}>품질/속도</span>
              <select value={preset} onChange={e => setPreset(e.target.value)} style={input}>
                {presets.map(p => <option key={p} value={p}>{PRESET_LABELS[p] || p}</option>)}
              </select>
            </label>
            <div style={{ fontSize: 11, color: status === 'ready' ? '#6ee7b7' : '#fbbd23' }}>
              {status === 'ready' ? `서버 준비됨${device ? ` (${device})` : ''}`
                : status === 'loading' ? '서버 모델 로딩 중… 잠시 후 다시 시도(기동 ~3분)'
                : '서버 확인 중…'}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={close} style={ghostBtn}>취소</button>
          <button type="button" onClick={generate} disabled={!canGenerate}
            style={{ ...primaryBtn, opacity: canGenerate ? 1 : 0.5, cursor: canGenerate ? 'pointer' : 'default' }}>
            생성
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const overlay = { position: 'fixed', inset: 0, zIndex: 20000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const panel = { width: 'min(460px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: 'rgba(15,23,42,0.98)', color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.55)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }
const field = { display: 'flex', flexDirection: 'column', gap: 4 }
const fieldLabel = { fontSize: 11.5, color: '#94a3b8' }
const input = { background: 'rgba(255,255,255,0.06)', color: '#e2e8f0', fontSize: 13, border: '1px solid rgba(255,255,255,0.12)', borderRadius: 6, padding: '6px 8px', outline: 'none' }
const textarea = { ...input, resize: 'vertical', fontFamily: 'inherit' }
const ghostBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#cbd5e1' }
const primaryBtn = { padding: '7px 14px', fontSize: 13, borderRadius: 8, border: 'none', background: 'rgba(99,102,241,0.9)', color: '#fff', fontWeight: 600 }
