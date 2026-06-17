import { useState, useEffect, useRef } from 'react'
import { parseColor, hexToRgba } from './ColorPicker'

/**
 * TextStrokeEditor — 텍스트 외곽선(-webkit-text-stroke) 편집기.
 * 다른 효과(그림자) 편집기와 동일한 패턴: 프리셋 버튼 + 색/투명도/굵기 블록.
 * value: 'none' 또는 '<width>px <color>'. onChange(value)로 통지.
 */
const labelClass = 'text-xs text-slate-500'

const PRESETS = [
  { label: '없음', w: 0 },
  { label: '얇게', w: 1 },
  { label: '보통', w: 2 },
  { label: '두껍게', w: 4 },
]

function parseStroke(value) {
  const m = (value || '').match(/^([\d.]+)px\s+(.+)$/)
  if (!m) return { width: 0, color: 'rgba(0, 0, 0, 1)' }
  return { width: parseFloat(m[1]) || 0, color: m[2].trim() }
}
const serialize = (width, color) => (width > 0 ? `${width}px ${color}` : 'none')

export default function TextStrokeEditor({ value, onChange }) {
  const [st, setSt] = useState(() => parseStroke(value))
  const colorRef = useRef(null)

  useEffect(() => { setSt(parseStroke(value)) }, [value])

  const commit = (width, color) => {
    setSt({ width, color })
    onChange(serialize(width, color))
  }

  const on = st.width > 0
  const { hex, opacity } = parseColor(st.color)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(p => {
          const active = p.w === 0 ? !on : (on && Math.round(st.width) === p.w)
          return (
            <button
              key={p.label}
              onClick={() => commit(p.w, st.color)}
              className={`text-xs px-1.5 py-0.5 rounded ${
                active
                  ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {on && (
        <div className="bg-white/5 rounded-lg p-2 space-y-1.5 border border-white/5">
          {/* 색 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => colorRef.current?.click()}
              style={{
                width: 18, height: 18, borderRadius: 3,
                background: hex, border: '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer', flexShrink: 0,
              }}
              title="외곽선 색"
            />
            <input
              ref={colorRef}
              type="color" value={hex}
              onChange={e => commit(st.width, hexToRgba(e.target.value, opacity === 0 ? 1 : opacity))}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
            />
            <span className={labelClass}>외곽선 색</span>
          </div>

          {/* 투명도 */}
          <div className="flex items-center gap-1.5">
            <span className={labelClass} style={{ fontSize: 9, width: 28 }}>투명도</span>
            <input
              type="range" min="0" max="1" step="0.05"
              value={opacity}
              onChange={e => commit(st.width, hexToRgba(hex, parseFloat(e.target.value)))}
              className="flex-1" style={{ accentColor: '#6366f1' }}
            />
            <span className="text-xs text-slate-400 w-7 text-right">{Math.round(opacity * 100)}%</span>
          </div>

          {/* 굵기 */}
          <div className="flex items-center gap-1.5">
            <span className={labelClass} style={{ fontSize: 9, width: 28 }}>굵기</span>
            <input
              type="range" min="0.5" max="10" step="0.5"
              value={st.width}
              onChange={e => commit(parseFloat(e.target.value), st.color)}
              className="flex-1" style={{ accentColor: '#6366f1' }}
            />
            <span className="text-xs text-slate-400 w-7 text-right">{st.width}px</span>
          </div>
        </div>
      )}
    </div>
  )
}
