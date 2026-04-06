import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '../store/editorStore'

export const CANVAS_PRESETS = [
  { id: 'auto',      label: '자동 감지',    w: null, h: null,  ratio: null       },
  // ── 크기 오름차순 ──────────────────────────────────────────
  { id: '1024x768',  label: '1024 × 768',  w: 1024, h: 768,   ratio: '4 : 3'    },
  { id: '1280x720',  label: '1280 × 720',  w: 1280, h: 720,   ratio: '16 : 9'        },
  { id: '1280x800',  label: '1280 × 800',  w: 1280, h: 800,   ratio: '16 : 10  WXGA  (기본)' },
  { id: '1280x960',  label: '1280 × 960',  w: 1280, h: 960,   ratio: '4 : 3'         },
  { id: '1366x768',  label: '1366 × 768',  w: 1366, h: 768,   ratio: '16 : 9  노트북' },
  { id: '1440x900',  label: '1440 × 900',  w: 1440, h: 900,   ratio: '16 : 10' },
  { id: '1600x900',  label: '1600 × 900',  w: 1600, h: 900,   ratio: '16 : 9'   },
  { id: '1680x1050', label: '1680 × 1050', w: 1680, h: 1050,  ratio: '16 : 10'  },
  { id: '1920x1080', label: '1920 × 1080', w: 1920, h: 1080,  ratio: '16 : 9  FHD' },
  { id: '1920x1200', label: '1920 × 1200', w: 1920, h: 1200,  ratio: '16 : 10  WUXGA' },
  { id: '2560x1440', label: '2560 × 1440', w: 2560, h: 1440,  ratio: '16 : 9  QHD' },
]

/**
 * CanvasSizeSelector
 * 툴바에 삽입되는 캔버스 크기 선택기.
 * 현재 크기를 버튼으로 표시하고 클릭하면 드롭다운이 나타난다.
 */
export default function CanvasSizeSelector() {
  const { canvasSize, setCanvasSize } = useEditorStore()
  const [open, setOpen] = useState(false)
  const [customW, setCustomW] = useState('')
  const [customH, setCustomH] = useState('')
  const [customErr, setCustomErr] = useState('')
  const ref = useRef(null)

  // 현재 선택된 프리셋 찾기
  const activePreset = canvasSize === null
    ? CANVAS_PRESETS[0]  // 자동 감지
    : CANVAS_PRESETS.find(p => p.w === canvasSize.w && p.h === canvasSize.h) ?? null

  const label = activePreset
    ? activePreset.id === 'auto'
      ? '자동'
      : `${activePreset.w} × ${activePreset.h}`
    : `${canvasSize.w} × ${canvasSize.h}`

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectPreset = (preset) => {
    if (preset.id === 'auto') setCanvasSize(null)
    else setCanvasSize({ w: preset.w, h: preset.h })
    setOpen(false)
    setCustomErr('')
  }

  const applyCustom = () => {
    const w = parseInt(customW)
    const h = parseInt(customH)
    if (!w || !h || w < 200 || h < 100 || w > 7680 || h > 4320) {
      setCustomErr('200–7680 × 100–4320 범위로 입력하세요')
      return
    }
    setCanvasSize({ w, h })
    setOpen(false)
    setCustomErr('')
    setCustomW('')
    setCustomH('')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* 현재 크기 표시 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        title="캔버스 크기 선택"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
          background: open ? 'rgba(255,255,255,0.12)' : 'transparent',
          color: '#cbd5e1', fontSize: 12, fontFamily: 'monospace',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent' }}
      >
        <CanvasIcon />
        <span>{label}</span>
        <ChevronIcon open={open} />
      </button>

      {/* 드롭다운 */}
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
            transform: 'translateX(-50%)',
            width: 232,
            background: 'rgba(15,23,42,0.97)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
            zIndex: 100,
            overflow: 'hidden',
          }}
        >
          {/* 프리셋 목록 */}
          <div style={{ padding: '6px 6px 0' }}>
            {CANVAS_PRESETS.map(preset => {
              const isActive = preset.id === 'auto'
                ? canvasSize === null
                : canvasSize?.w === preset.w && canvasSize?.h === preset.h
              return (
                <button
                  key={preset.id}
                  onClick={() => selectPreset(preset)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '7px 10px', borderRadius: 7,
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: isActive ? 'rgba(99,102,241,0.25)' : 'transparent',
                    color: isActive ? '#a5b4fc' : '#94a3b8',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: 13, fontFamily: preset.id === 'auto' ? 'inherit' : 'monospace' }}>
                    {preset.label}
                  </span>
                  <span style={{ fontSize: 11, color: isActive ? '#818cf8' : '#475569' }}>
                    {preset.ratio ?? ''}
                  </span>
                </button>
              )
            })}
          </div>

          {/* 구분선 */}
          <div style={{ margin: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.07)' }} />

          {/* 직접 입력 */}
          <div style={{ padding: '0 10px 10px' }}>
            <p style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>직접 입력</p>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number" placeholder="너비"
                value={customW}
                onChange={e => { setCustomW(e.target.value); setCustomErr('') }}
                onKeyDown={e => e.key === 'Enter' && applyCustom()}
                style={inputStyle}
              />
              <span style={{ color: '#475569', fontSize: 12, flexShrink: 0 }}>×</span>
              <input
                type="number" placeholder="높이"
                value={customH}
                onChange={e => { setCustomH(e.target.value); setCustomErr('') }}
                onKeyDown={e => e.key === 'Enter' && applyCustom()}
                style={inputStyle}
              />
              <button onClick={applyCustom} style={applyBtnStyle} title="적용">
                ✓
              </button>
            </div>
            {customErr && (
              <p style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{customErr}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '5px 8px', borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.06)', color: '#cbd5e1',
  fontSize: 12, fontFamily: 'monospace',
  outline: 'none',
}

const applyBtnStyle = {
  flexShrink: 0, width: 28, height: 28,
  borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)',
  background: 'rgba(99,102,241,0.2)', color: '#a5b4fc',
  fontSize: 14, cursor: 'pointer',
}

function CanvasIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5"
      style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
