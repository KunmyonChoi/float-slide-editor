import { useRef, useState, useEffect } from 'react'

// ── 색상 변환 유틸 ──────────────────────────────────

/** CSS 색상 문자열 → { hex, opacity } */
export function parseColor(value) {
  if (!value || value === 'none') return { hex: '#000000', opacity: 1 }
  if (value === 'transparent') return { hex: '#000000', opacity: 0 }

  // rgba(r, g, b, a) 또는 rgb(r, g, b)
  const rgbaMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1])
    const g = parseInt(rgbaMatch[2])
    const b = parseInt(rgbaMatch[3])
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1
    return { hex: rgbToHex(r, g, b), opacity: a }
  }

  // #rrggbb 또는 #rgb
  if (value.startsWith('#')) {
    let hex = value
    if (hex.length === 4) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
    }
    return { hex: hex.toLowerCase(), opacity: 1 }
  }

  // named colors — 브라우저 canvas로 변환
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.fillStyle = value
    const computed = ctx.fillStyle // #rrggbb 형태로 변환됨
    return { hex: computed, opacity: 1 }
  } catch {
    return { hex: '#000000', opacity: 1 }
  }
}

/** hex + opacity → rgba 문자열 */
export function hexToRgba(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

// ── ColorPicker 컴포넌트 ────────────────────────────

/**
 * ColorPicker — 색상 프리뷰 + hex 입력 + native color picker
 * @param {string} value - CSS 색상 값 (hex, rgb, rgba 등)
 * @param {(value: string) => void} onChange - 변경된 rgba 문자열
 * @param {boolean} showOpacity - opacity 슬라이더 표시 여부 (기본 false)
 */
export default function ColorPicker({ value, onChange, showOpacity = false }) {
  const colorRef = useRef(null)
  const { hex, opacity } = parseColor(value)
  const [localHex, setLocalHex] = useState(hex)
  const [localOpacity, setLocalOpacity] = useState(opacity)

  // 외부 value 변경 시 로컬 상태 동기화
  useEffect(() => {
    const parsed = parseColor(value)
    setLocalHex(parsed.hex)
    setLocalOpacity(parsed.opacity)
  }, [value])

  const commitColor = (h, o) => {
    onChange(hexToRgba(h, o))
  }

  const handleColorInput = (e) => {
    const newHex = e.target.value
    setLocalHex(newHex)
    // 색상 선택 시 opacity가 0이면 1로 올림 (투명 → 불투명)
    const newOpacity = localOpacity === 0 ? 1 : localOpacity
    if (newOpacity !== localOpacity) setLocalOpacity(newOpacity)
    commitColor(newHex, newOpacity)
  }

  const handleHexChange = (e) => {
    const v = e.target.value
    setLocalHex(v)
  }

  const handleHexBlur = () => {
    // hex 유효성 검사
    const newOpacity = localOpacity === 0 ? 1 : localOpacity
    if (newOpacity !== localOpacity) setLocalOpacity(newOpacity)
    if (/^#[0-9a-fA-F]{6}$/.test(localHex)) {
      commitColor(localHex.toLowerCase(), newOpacity)
    } else if (/^#[0-9a-fA-F]{3}$/.test(localHex)) {
      const expanded = '#' + localHex[1] + localHex[1] + localHex[2] + localHex[2] + localHex[3] + localHex[3]
      setLocalHex(expanded)
      commitColor(expanded.toLowerCase(), newOpacity)
    } else {
      setLocalHex(hex) // 잘못된 입력 → 복원
    }
  }

  const handleHexKeyDown = (e) => {
    if (e.key === 'Enter') handleHexBlur()
    e.stopPropagation()
  }

  const handleOpacityChange = (e) => {
    const o = parseFloat(e.target.value)
    setLocalOpacity(o)
    commitColor(localHex, o)
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* 색상 프리뷰 + native picker */}
      <button
        onClick={() => colorRef.current?.click()}
        style={{
          width: 22, height: 22,
          borderRadius: 4,
          background: localHex,
          border: '1px solid rgba(255,255,255,0.15)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
        title="색상 선택"
      />
      <input
        ref={colorRef}
        type="color"
        value={localHex}
        onChange={handleColorInput}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
      />

      {/* hex 텍스트 입력 */}
      <input
        type="text"
        value={localHex}
        onChange={handleHexChange}
        onBlur={handleHexBlur}
        onKeyDown={handleHexKeyDown}
        className="text-xs bg-white/5 rounded px-1.5 py-1 border border-white/10 text-slate-200"
        style={{ width: 72, fontFamily: 'monospace' }}
      />

      {/* opacity 슬라이더 */}
      {showOpacity && (
        <input
          type="range"
          min="0" max="1" step="0.01"
          value={localOpacity}
          onChange={handleOpacityChange}
          className="flex-1"
          style={{ accentColor: '#6366f1', minWidth: 50 }}
          title={`투명도: ${localOpacity}`}
        />
      )}
    </div>
  )
}
