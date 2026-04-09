import { useState, useEffect } from 'react'
import { parseGradient, serializeGradient } from '../core/GradientParser'
import { parseColor, hexToRgba } from './ColorPicker'

const labelClass = 'text-xs text-slate-500'

/**
 * GradientEditor — 그래디언트 편집 UI
 * @param {string} value - CSS backgroundImage 값
 * @param {(css: string) => void} onChange
 */
export default function GradientEditor({ value, onChange }) {
  const [grad, setGrad] = useState(() => parseGradient(value))

  useEffect(() => {
    setGrad(parseGradient(value))
  }, [value])

  const commit = (next) => {
    setGrad(next)
    onChange(serializeGradient(next))
  }

  const setType = (type) => {
    if (type === 'none') {
      commit({ type: 'none', angle: 0, stops: [] })
    } else {
      const stops = grad.stops.length >= 2 ? grad.stops : [
        { color: 'rgba(99, 102, 241, 1)', position: 0 },
        { color: 'rgba(168, 85, 247, 1)', position: 100 },
      ]
      commit({ type, angle: type === 'linear' ? (grad.angle || 180) : 0, stops })
    }
  }

  const updateStop = (idx, changes) => {
    const stops = grad.stops.map((s, i) => i === idx ? { ...s, ...changes } : s)
    commit({ ...grad, stops })
  }

  const removeStop = (idx) => {
    if (grad.stops.length <= 2) return
    commit({ ...grad, stops: grad.stops.filter((_, i) => i !== idx) })
  }

  const addStop = () => {
    const last = grad.stops[grad.stops.length - 1]
    const prev = grad.stops[grad.stops.length - 2]
    const pos = last && prev ? Math.round((prev.position + last.position) / 2) : 50
    const newStop = { color: 'rgba(255, 255, 255, 1)', position: pos }
    const stops = [...grad.stops, newStop].sort((a, b) => a.position - b.position)
    commit({ ...grad, stops })
  }

  // 미리보기 CSS
  const previewCss = grad.type !== 'none' ? serializeGradient(grad) : 'linear-gradient(180deg, #6366f1 0%, #a855f7 100%)'

  return (
    <div className="space-y-1.5">
      {/* 타입 선택 */}
      <div className="flex gap-1">
        {['none', 'linear', 'radial'].map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`text-xs px-2 py-0.5 rounded ${
              grad.type === t
                ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            {t === 'none' ? '없음' : t === 'linear' ? '선형' : '방사형'}
          </button>
        ))}
      </div>

      {grad.type !== 'none' && (
        <>
          {/* 미리보기 바 */}
          <div
            style={{
              height: 20, borderRadius: 4,
              background: previewCss,
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          />

          {/* 각도 (선형만) */}
          {grad.type === 'linear' && (
            <div className="flex items-center gap-2">
              <span className={labelClass}>각도</span>
              <input
                type="range" min="0" max="360" step="1"
                value={grad.angle}
                onChange={e => commit({ ...grad, angle: parseInt(e.target.value) })}
                className="flex-1" style={{ accentColor: '#6366f1' }}
              />
              <span className="text-xs text-slate-300 w-8 text-right">{grad.angle}°</span>
            </div>
          )}

          {/* 색상 스톱 */}
          {grad.stops.map((stop, idx) => (
            <StopRow
              key={idx}
              stop={stop}
              onUpdate={(changes) => updateStop(idx, changes)}
              onRemove={() => removeStop(idx)}
              canRemove={grad.stops.length > 2}
            />
          ))}

          {/* 스톱 추가 */}
          <button
            onClick={addStop}
            className="text-xs text-indigo-400 hover:text-indigo-300 px-1"
          >
            + 색상 추가
          </button>
        </>
      )}
    </div>
  )
}

function StopRow({ stop, onUpdate, onRemove, canRemove }) {
  const colorRef = { current: null }
  const { hex } = parseColor(stop.color)

  const handleColorChange = (e) => {
    onUpdate({ color: hexToRgba(e.target.value, parseColor(stop.color).opacity) })
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => colorRef.current?.click()}
        style={{
          width: 18, height: 18, borderRadius: 3,
          background: hex,
          border: '1px solid rgba(255,255,255,0.15)',
          cursor: 'pointer', flexShrink: 0,
        }}
      />
      <input
        ref={el => colorRef.current = el}
        type="color"
        value={hex}
        onChange={handleColorChange}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />
      <input
        type="number" min="0" max="100"
        value={Math.round(stop.position)}
        onChange={e => onUpdate({ position: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
        onKeyDown={e => e.stopPropagation()}
        className="text-xs bg-white/5 rounded px-1.5 py-0.5 border border-white/10 text-slate-200 w-12 text-center"
      />
      <span className="text-xs text-slate-500">%</span>
      {canRemove && (
        <button
          onClick={onRemove}
          className="text-xs text-slate-500 hover:text-red-400 ml-auto px-1"
          title="삭제"
        >✕</button>
      )}
    </div>
  )
}
