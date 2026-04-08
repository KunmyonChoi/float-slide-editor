import { useState, useRef } from 'react'
import { useFlatStore } from '../store/flatStore'
import ColorPicker, { parseColor } from './ColorPicker'

// ── 글꼴 크기 프리셋 ────────────────────────────────

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96]

const FLAT_TYPE_LABEL = { text: '텍스트', image: '이미지', shape: '도형', svg: 'SVG' }
const FLAT_TYPE_COLOR = {
  text: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  image: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  shape: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  svg: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
}

// ── 공통 입력 헬퍼 ──────────────────────────────────

const inputClass = 'w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors'
const labelClass = 'text-xs text-slate-500'

/**
 * FlatPropertyContent — Flat 모드 속성 패널 콘텐츠
 * PropertyPanel 셸 안에 렌더링된다.
 */
export default function FlatPropertyContent() {
  const { selectedFlatId, flatElements, updateFlatElement, previewFlatElement, removeFlatElement } = useFlatStore()
  const el = flatElements.find(e => e.id === selectedFlatId)

  if (!el) return null

  const update = (changes) => updateFlatElement(el.id, changes)
  const updateStyle = (key, value) => updateFlatElement(el.id, { styles: { [key]: value } })
  const previewStyle = (key, value) => previewFlatElement(el.id, { styles: { [key]: value } })

  return (
    <>
      {/* 헤더 — 타입 배지 + ID */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${FLAT_TYPE_COLOR[el.type] || FLAT_TYPE_COLOR.shape}`}>
          {FLAT_TYPE_LABEL[el.type] || el.type}
        </span>
        <code className="text-xs text-slate-500 truncate">{el.id}</code>
      </div>

      <div className="p-3 space-y-3">
        <PositionSection el={el} update={update} />

        {el.type === 'text' && (
          <div className="pt-1 border-t border-white/5">
            <FontSection styles={el.styles} updateStyle={updateStyle} />
          </div>
        )}

        <div className="pt-1 border-t border-white/5">
          <FillSection styles={el.styles} updateStyle={updateStyle} previewStyle={previewStyle} />
        </div>

        <div className="pt-1 border-t border-white/5">
          <LineSection styles={el.styles} updateStyle={updateStyle} />
        </div>

        <div className="pt-1 border-t border-white/5">
          <EffectSection styles={el.styles} updateStyle={updateStyle} />
        </div>

        <div className="pt-1 border-t border-white/5">
          <button
            onClick={() => removeFlatElement(el.id)}
            className="flex items-center justify-center w-full text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg px-2.5 py-1.5 border border-red-500/20 transition-colors"
          >
            <TrashIcon />
            <span className="ml-1">삭제</span>
          </button>
        </div>
      </div>
    </>
  )
}

// ── 섹션 컴포넌트 ───────────────────────────────────

function PositionSection({ el, update }) {
  return (
    <div>
      <SectionTitle>크기 및 위치</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        <NumInput label="X" value={el.x} onChange={v => update({ x: v })} />
        <NumInput label="Y" value={el.y} onChange={v => update({ y: v })} />
        <NumInput label="W" value={el.width} onChange={v => update({ width: v })} min={1} />
        <NumInput label="H" value={el.height} onChange={v => update({ height: v })} min={1} />
      </div>
    </div>
  )
}

function FontSection({ styles, updateStyle }) {
  const parseFontSize = (v) => parseFloat(v) || 16
  const isBold = parseInt(styles.fontWeight) >= 700
  const isItalic = styles.fontStyle === 'italic'
  const isUnderline = (styles.textDecoration || '').includes('underline')

  return (
    <div className="space-y-2">
      <SectionTitle>글꼴</SectionTitle>

      <div>
        <p className={`${labelClass} mb-0.5`}>글꼴</p>
        <input
          type="text"
          value={styles.fontFamily || ''}
          onChange={e => updateStyle('fontFamily', e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <FontSizeInput
          value={parseFontSize(styles.fontSize)}
          onChange={v => updateStyle('fontSize', v + 'px')}
        />
        <SelectInput
          label="굵기"
          value={styles.fontWeight || '400'}
          onChange={v => updateStyle('fontWeight', v)}
          options={[
            { value: '100', label: '100 Thin' },
            { value: '200', label: '200' },
            { value: '300', label: '300 Light' },
            { value: '400', label: '400 Normal' },
            { value: '500', label: '500 Medium' },
            { value: '600', label: '600 Semi' },
            { value: '700', label: '700 Bold' },
            { value: '800', label: '800' },
            { value: '900', label: '900 Black' },
          ]}
        />
      </div>

      <div className="flex gap-1.5">
        <ToggleBtn active={isBold} onClick={() => updateStyle('fontWeight', isBold ? '400' : '700')} title="굵게 (Bold)">
          <b>B</b>
        </ToggleBtn>
        <ToggleBtn active={isItalic} onClick={() => updateStyle('fontStyle', isItalic ? 'normal' : 'italic')} title="기울임 (Italic)">
          <i>I</i>
        </ToggleBtn>
        <ToggleBtn active={isUnderline} onClick={() => updateStyle('textDecoration', isUnderline ? 'none' : 'underline')} title="밑줄 (Underline)">
          <u>U</u>
        </ToggleBtn>
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>글꼴 색</p>
        <ColorPicker value={styles.color} onChange={v => updateStyle('color', v)} />
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>맞춤</p>
        <div className="flex gap-1.5">
          {[
            { value: 'left', label: '왼쪽', icon: <AlignLeftIcon /> },
            { value: 'center', label: '가운데', icon: <AlignCenterIcon /> },
            { value: 'right', label: '오른쪽', icon: <AlignRightIcon /> },
          ].map(a => (
            <button
              key={a.value}
              onClick={() => updateStyle('textAlign', a.value)}
              title={a.label + ' 맞춤'}
              className={[
                'flex-1 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center border',
                styles.textAlign === a.value
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
              ].join(' ')}
            >
              {a.icon}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <NumInput
          label="줄 간격"
          value={parseFloat(styles.lineHeight) || 1.5}
          onChange={v => updateStyle('lineHeight', String(v))}
          min={0.5} max={5}
        />
        <NumInput
          label="문자 간격"
          value={parseFloat(styles.letterSpacing) || 0}
          onChange={v => updateStyle('letterSpacing', v + 'px')}
          unit="px"
        />
      </div>

      <NumInput
        label="내부 여백"
        value={parseFloat(styles.padding) || 0}
        onChange={v => updateStyle('padding', v + 'px')}
        min={0} unit="px"
      />
    </div>
  )
}

function FillSection({ styles, updateStyle, previewStyle }) {
  const opacityRef = useRef(null)

  const handleOpacityChange = (e) => {
    previewStyle('opacity', e.target.value)
  }
  const handleOpacityCommit = () => {
    updateStyle('opacity', opacityRef.current?.value || styles.opacity)
  }

  return (
    <div className="space-y-2">
      <SectionTitle>채우기</SectionTitle>
      <div>
        <p className={`${labelClass} mb-0.5`}>배경색</p>
        <ColorPicker
          value={styles.backgroundColor}
          onChange={v => updateStyle('backgroundColor', v)}
          showOpacity
        />
      </div>
      <div>
        <p className={`${labelClass} mb-0.5`}>
          투명도 <span className="text-slate-600">{styles.opacity}</span>
        </p>
        <input
          ref={opacityRef}
          type="range"
          min="0" max="1" step="0.01"
          value={styles.opacity || '1'}
          onChange={handleOpacityChange}
          onMouseUp={handleOpacityCommit}
          onTouchEnd={handleOpacityCommit}
          className="w-full"
          style={{ accentColor: '#6366f1' }}
        />
      </div>
    </div>
  )
}

function LineSection({ styles, updateStyle }) {
  const parseBorder = (border) => {
    if (!border || border === 'none' || border === '0px none') {
      return { width: 0, style: 'none', color: '#000000' }
    }
    const match = border.match(/^([\d.]+)px\s+(\w+)\s+(.+)$/)
    if (match) {
      const parsed = parseColor(match[3])
      return { width: parseFloat(match[1]), style: match[2], color: parsed.hex }
    }
    return { width: 0, style: 'none', color: '#000000' }
  }

  const b = parseBorder(styles.border)

  const updateBorder = (key, val) => {
    const next = { ...b, [key]: val }
    if (next.style === 'none' || next.width === 0) {
      updateStyle('border', '0px none')
    } else {
      updateStyle('border', `${next.width}px ${next.style} ${next.color}`)
    }
  }

  return (
    <div className="space-y-2">
      <SectionTitle>선</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        <NumInput
          label="너비"
          value={b.width}
          onChange={v => updateBorder('width', v)}
          min={0} unit="px"
        />
        <SelectInput
          label="종류"
          value={b.style}
          onChange={v => updateBorder('style', v)}
          options={[
            { value: 'none', label: '없음' },
            { value: 'solid', label: '실선' },
            { value: 'dashed', label: '파선' },
            { value: 'dotted', label: '점선' },
          ]}
        />
      </div>
      <div>
        <p className={`${labelClass} mb-0.5`}>선 색</p>
        <ColorPicker value={b.color} onChange={v => updateBorder('color', v)} />
      </div>
      <NumInput
        label="모서리 둥글기"
        value={parseFloat(styles.borderRadius) || 0}
        onChange={v => updateStyle('borderRadius', v + 'px')}
        min={0} unit="px"
      />
    </div>
  )
}

function EffectSection({ styles, updateStyle }) {
  return (
    <div className="space-y-2">
      <SectionTitle>효과</SectionTitle>
      <div>
        <p className={`${labelClass} mb-0.5`}>그림자</p>
        <input
          type="text"
          value={styles.boxShadow || 'none'}
          onChange={e => updateStyle('boxShadow', e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          className={inputClass}
          placeholder="0px 4px 8px rgba(0,0,0,0.2)"
        />
      </div>
    </div>
  )
}

// ── 입력 헬퍼 ───────────────────────────────────────

function NumInput({ label, value, onChange, unit = '', min, max }) {
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100))
  const prevValue = useRef(value)

  if (Math.abs(value - prevValue.current) > 0.001) {
    prevValue.current = value
    const rounded = String(Math.round(value * 100) / 100)
    if (local !== rounded) setLocal(rounded)
  }

  const commit = () => {
    const n = parseFloat(local)
    if (isNaN(n)) { setLocal(String(Math.round(value * 100) / 100)); return }
    const clamped = min !== undefined && max !== undefined
      ? Math.min(max, Math.max(min, n))
      : min !== undefined ? Math.max(min, n) : n
    onChange(clamped)
  }

  return (
    <div>
      {label && <p className={`${labelClass} mb-0.5`}>{label}</p>}
      <div className="flex items-center">
        <input
          type="text"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur() } e.stopPropagation() }}
          className={inputClass}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        />
        {unit && <span className="text-[10px] text-slate-600 ml-1 shrink-0">{unit}</span>}
      </div>
    </div>
  )
}

function FontSizeInput({ value, onChange }) {
  const [local, setLocal] = useState(String(Math.round(value)))
  const prevValue = useRef(value)

  if (Math.abs(value - prevValue.current) > 0.5) {
    prevValue.current = value
    const rounded = String(Math.round(value))
    if (local !== rounded) setLocal(rounded)
  }

  const commit = () => {
    const n = parseFloat(local)
    if (isNaN(n) || n < 1) { setLocal(String(Math.round(value))); return }
    onChange(n)
  }

  return (
    <div>
      <p className={`${labelClass} mb-0.5`}>크기</p>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={local}
          onChange={e => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { commit(); e.target.blur() } e.stopPropagation() }}
          className={inputClass}
          style={{ width: 52, fontVariantNumeric: 'tabular-nums' }}
        />
        <select
          value={FONT_SIZE_PRESETS.includes(Math.round(value)) ? Math.round(value) : ''}
          onChange={e => { if (e.target.value) onChange(Number(e.target.value)) }}
          className="text-xs text-slate-300 bg-white/5 rounded-lg px-1 py-1.5 border border-white/10 appearance-none cursor-pointer outline-none focus:border-indigo-500/50 transition-colors"
          style={{ width: 28 }}
          title="글꼴 크기 프리셋"
        >
          <option value="">▾</option>
          {FONT_SIZE_PRESETS.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function SectionTitle({ children }) {
  return <p className="text-xs text-slate-500 mb-1.5">{children}</p>
}

function SelectInput({ label, value, options, onChange }) {
  return (
    <div>
      {label && <p className={`${labelClass} mb-0.5`}>{label}</p>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${inputClass} appearance-none cursor-pointer`}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── B/I/U 토글 버튼 ─────────────────────────────────

function ToggleBtn({ active, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'w-8 h-8 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center border',
        active
          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
          : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── 아이콘 ─────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
    </svg>
  )
}

function AlignLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 10H3M21 6H3M21 14H3M17 18H3" />
    </svg>
  )
}

function AlignCenterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10H6M21 6H3M21 14H3M18 18H6" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10H7M21 6H3M21 14H3M21 18H7" />
    </svg>
  )
}
