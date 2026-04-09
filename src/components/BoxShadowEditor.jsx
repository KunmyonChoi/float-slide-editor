import { useState, useEffect } from 'react'
import { parseBoxShadow, serializeBoxShadow } from '../core/BoxShadowParser'
import { parseColor, hexToRgba } from './ColorPicker'

const labelClass = 'text-xs text-slate-500'

// offsetX/Y ↔ 각도+거리 변환
function toAngleDistance(offsetX, offsetY) {
  const distance = Math.round(Math.sqrt(offsetX * offsetX + offsetY * offsetY))
  if (distance === 0) return { angle: 135, distance: 0 }
  const rad = Math.atan2(offsetY, offsetX)
  const angle = ((Math.round(rad * 180 / Math.PI) % 360) + 360) % 360
  return { angle, distance }
}

function toOffsets(angle, distance) {
  const rad = angle * Math.PI / 180
  return {
    offsetX: Math.round(distance * Math.cos(rad)),
    offsetY: Math.round(distance * Math.sin(rad)),
  }
}

// 프리셋
const PRESETS = [
  { label: '없음', shadow: null },
  { label: '바깥 아래', shadow: { offsetX: 0, offsetY: 4, blur: 8, spread: 0, color: 'rgba(0, 0, 0, 0.3)', inset: false } },
  { label: '바깥 주변', shadow: { offsetX: 0, offsetY: 0, blur: 12, spread: 2, color: 'rgba(0, 0, 0, 0.2)', inset: false } },
  { label: '바깥 깊은', shadow: { offsetX: 0, offsetY: 8, blur: 24, spread: -4, color: 'rgba(0, 0, 0, 0.4)', inset: false } },
  { label: '안쪽', shadow: { offsetX: 0, offsetY: 2, blur: 6, spread: 0, color: 'rgba(0, 0, 0, 0.25)', inset: true } },
]

/**
 * BoxShadowEditor — PowerPoint 스타일 그림자 편집 UI
 * 각도+거리 모델 + 프리셋
 */
export default function BoxShadowEditor({ value, onChange }) {
  const [shadows, setShadows] = useState(() => parseBoxShadow(value))

  useEffect(() => {
    setShadows(parseBoxShadow(value))
  }, [value])

  const commit = (next) => {
    setShadows(next)
    onChange(serializeBoxShadow(next))
  }

  const updateShadow = (idx, changes) => {
    const updated = shadows.map((s, i) => i === idx ? { ...s, ...changes } : s)
    commit(updated)
  }

  const removeShadow = (idx) => {
    commit(shadows.filter((_, i) => i !== idx))
  }

  const addShadow = () => {
    commit([...shadows, {
      offsetX: 0, offsetY: 4, blur: 8, spread: 0,
      color: 'rgba(0, 0, 0, 0.2)', inset: false,
    }])
  }

  const applyPreset = (preset) => {
    if (!preset.shadow) {
      commit([])
    } else {
      // 기존 그림자 색상 보존
      const prevColor = shadows.length > 0 ? shadows[0].color : preset.shadow.color
      commit([{ ...preset.shadow, color: prevColor }])
    }
  }

  return (
    <div className="space-y-2">
      {/* 프리셋 */}
      <div className="flex flex-wrap gap-1">
        {PRESETS.map(p => {
          const isActive = !p.shadow
            ? shadows.length === 0
            : shadows.length === 1 && shadows[0].blur === p.shadow.blur && shadows[0].inset === p.shadow.inset
              && shadows[0].offsetY === p.shadow.offsetY
          return (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`text-xs px-1.5 py-0.5 rounded ${
                isActive
                  ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {shadows.map((shadow, idx) => (
        <ShadowRow
          key={idx}
          shadow={shadow}
          onUpdate={(changes) => updateShadow(idx, changes)}
          onRemove={() => removeShadow(idx)}
        />
      ))}

      {shadows.length > 0 && (
        <button
          onClick={addShadow}
          className="text-xs text-indigo-400 hover:text-indigo-300 px-1"
        >
          + 그림자 추가
        </button>
      )}
    </div>
  )
}

function ShadowRow({ shadow, onUpdate, onRemove }) {
  const colorRef = { current: null }
  const { hex, opacity } = parseColor(shadow.color)
  const { angle, distance } = toAngleDistance(shadow.offsetX, shadow.offsetY)

  const handleColorChange = (e) => {
    const newOpacity = opacity === 0 ? 1 : opacity
    onUpdate({ color: hexToRgba(e.target.value, newOpacity) })
  }

  const handleOpacityChange = (e) => {
    const newOpacity = parseFloat(e.target.value)
    onUpdate({ color: hexToRgba(hex, newOpacity) })
  }

  const handleAngleChange = (newAngle) => {
    const offsets = toOffsets(newAngle, distance)
    onUpdate(offsets)
  }

  const handleDistanceChange = (newDist) => {
    const offsets = toOffsets(angle, Math.max(0, newDist))
    onUpdate(offsets)
  }

  const numInput = (label, value, onChangeFn, min, max) => (
    <div className="flex flex-col items-center">
      <span className={`${labelClass} text-center`} style={{ fontSize: 9 }}>{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChangeFn(parseFloat(e.target.value) || 0)}
        onKeyDown={e => e.stopPropagation()}
        min={min} max={max}
        className="text-xs bg-white/5 rounded px-1 py-0.5 border border-white/10 text-slate-200 w-11 text-center"
      />
    </div>
  )

  return (
    <div className="bg-white/5 rounded-lg p-2 space-y-1.5 border border-white/5">
      {/* 상단: 색상 + 타입 + 삭제 */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => colorRef.current?.click()}
          style={{
            width: 18, height: 18, borderRadius: 3,
            background: hex, border: '1px solid rgba(255,255,255,0.15)',
            cursor: 'pointer', flexShrink: 0,
          }}
        />
        <input
          ref={el => colorRef.current = el}
          type="color" value={hex}
          onChange={handleColorChange}
          style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        />

        <button
          onClick={() => onUpdate({ inset: !shadow.inset })}
          className={`text-xs px-1.5 py-0.5 rounded ${
            shadow.inset
              ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
              : 'bg-white/5 text-slate-400 border border-white/10'
          }`}
        >
          {shadow.inset ? '안쪽' : '바깥쪽'}
        </button>

        <button
          onClick={onRemove}
          className="text-xs text-slate-500 hover:text-red-400 ml-auto"
          title="삭제"
        >✕</button>
      </div>

      {/* 투명도 슬라이더 */}
      <div className="flex items-center gap-1.5">
        <span className={labelClass} style={{ fontSize: 9, width: 28 }}>투명도</span>
        <input
          type="range" min="0" max="1" step="0.05"
          value={opacity}
          onChange={handleOpacityChange}
          className="flex-1" style={{ accentColor: '#6366f1' }}
        />
        <span className="text-xs text-slate-400 w-7 text-right">{Math.round(opacity * 100)}%</span>
      </div>

      {/* 각도 + 거리 + 흐림 + 확산 */}
      <div className="flex gap-1.5 justify-between">
        {numInput('각도', angle, handleAngleChange, 0, 359)}
        {numInput('거리', distance, handleDistanceChange, 0)}
        {numInput('흐림', shadow.blur, v => onUpdate({ blur: Math.max(0, v) }), 0)}
        {numInput('확산', shadow.spread, v => onUpdate({ spread: v }))}
      </div>
    </div>
  )
}
