import { useState, useRef, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import ColorPicker, { parseColor } from './ColorPicker'
import FontComboBox from './FontComboBox'
import GradientEditor from './GradientEditor'
import BoxShadowEditor from './BoxShadowEditor'
import TextShadowEditor from './TextShadowEditor'
import { computeAlignmentChanges, computeDistributionChanges, isBackgroundElement } from '../core/SnapEngine'
import { nextFlatId } from '../core/FlatExtractor'

// ── 글꼴 크기 프리셋 ────────────────────────────────

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96]

const FLAT_TYPE_LABEL = { text: '텍스트', image: '이미지', shape: '도형', svg: 'SVG', video: '영상' }
const FLAT_TYPE_COLOR = {
  text: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  image: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  shape: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  svg: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  video: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
}

// ── 공통 입력 헬퍼 ──────────────────────────────────

const inputClass = 'w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors'
const labelClass = 'text-xs text-slate-500'

/**
 * FlatPropertyContent — Flat 모드 속성 패널 콘텐츠
 * PropertyPanel 셸 안에 렌더링된다.
 */
export default function FlatPropertyContent() {
  const { selectedFlatIds, flatElements, updateFlatElement, previewFlatElement, removeFlatElement,
          batchUpdateFlatElements, removeSelectedElements } = useFlatStore()
  const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))

  if (selectedEls.length === 0) return <SlideBackgroundPanel />
  if (selectedEls.length > 1) return <MultiElementPanel elements={selectedEls} />

  const el = selectedEls[0]
  const update = (changes) => updateFlatElement(el.id, changes)
  const updateStyle = (key, value) => updateFlatElement(el.id, { styles: { [key]: value } })
  const updateStyles = (styleChanges) => updateFlatElement(el.id, { styles: styleChanges })
  const previewStyle = (key, value) => previewFlatElement(el.id, { styles: { [key]: value } })

  return (
    <>
      {/* 헤더 — 타입 배지 + ID + 잠금 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${FLAT_TYPE_COLOR[el.type] || FLAT_TYPE_COLOR.shape}`}>
          {FLAT_TYPE_LABEL[el.type] || el.type}
        </span>
        <code className="text-xs text-slate-500 truncate flex-1">{el.id}</code>
        <button
          onClick={() => update({ locked: !el.locked })}
          className={`text-xs px-1.5 py-0.5 rounded ${
            el.locked
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : 'bg-white/5 text-slate-500 border border-white/10 hover:bg-white/10'
          }`}
          title={el.locked ? '잠금 해제' : '잠금'}
        >
          {el.locked ? '🔒' : '🔓'}
        </button>
      </div>

      <div className="p-3 space-y-3">
        <PositionSection el={el} update={update} />

        {el.type === 'text' && (
          <div className="pt-1 border-t border-white/5">
            <FontSection styles={el.styles} updateStyle={updateStyle} isGradientText={el.styles.webkitBackgroundClip === 'text'} />
          </div>
        )}

        {el.type === 'image' && (
          <div className="pt-1 border-t border-white/5">
            <ImageSection styles={el.styles} updateStyle={updateStyle} elementId={el.id} />
          </div>
        )}

        <div className="pt-1 border-t border-white/5">
          <FillSection styles={el.styles} updateStyle={updateStyle} updateStyles={updateStyles} previewStyle={previewStyle} isText={el.type === 'text'} />
        </div>

        <div className="pt-1 border-t border-white/5">
          <LineSection styles={el.styles} updateStyle={updateStyle} updateStyles={updateStyles} />
        </div>

        <div className="pt-1 border-t border-white/5">
          <EffectSection styles={el.styles} updateStyle={updateStyle} isText={el.type === 'text'} />
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

// ── 다중 선택 패널 ──────────────────────────────────

function MultiElementPanel({ elements }) {
  const { batchUpdateFlatElements, batchUpdateFlatElementsIndividual, removeSelectedElements, selectedFlatIds } = useFlatStore()

  // 공통 값 계산 헬퍼: 모든 요소에서 동일하면 그 값, 아니면 null
  const getCommon = (getter) => {
    const vals = elements.map(getter)
    return vals.every(v => v === vals[0]) ? vals[0] : null
  }

  const getCommonStyle = (key) => getCommon(el => el.styles?.[key])

  const updateAllStyle = (key, value) => {
    batchUpdateFlatElements(selectedFlatIds, { styles: { [key]: value } })
  }

  // 그룹 바운딩 박스
  const bbox = getGroupBBox(elements)
  const allText = elements.every(e => e.type === 'text')

  const commonBg = getCommonStyle('backgroundColor')
  const commonOpacity = getCommonStyle('opacity')
  const commonBorderRadius = getCommonStyle('borderRadius')

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-white/10 text-slate-300 border border-white/10">
          {elements.length}개 선택
        </span>
      </div>

      <div className="p-3 space-y-3">
        {/* 그룹 바운딩 박스 위치/크기 (읽기 전용) */}
        <div>
          <SectionTitle>그룹 위치</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <p className={`${labelClass} mb-0.5`}>X</p>
              <div className={`${inputClass} opacity-60`}>{Math.round(bbox.x)}</div>
            </div>
            <div>
              <p className={`${labelClass} mb-0.5`}>Y</p>
              <div className={`${inputClass} opacity-60`}>{Math.round(bbox.y)}</div>
            </div>
            <div>
              <p className={`${labelClass} mb-0.5`}>W</p>
              <div className={`${inputClass} opacity-60`}>{Math.round(bbox.w)}</div>
            </div>
            <div>
              <p className={`${labelClass} mb-0.5`}>H</p>
              <div className={`${inputClass} opacity-60`}>{Math.round(bbox.h)}</div>
            </div>
          </div>
        </div>

        {/* 정렬 / 분배 */}
        <div className="pt-1 border-t border-white/5">
          <SectionTitle>정렬</SectionTitle>
          <div className="flex gap-1">
            {[
              { action: 'alignLeft', label: '왼쪽', icon: <AlignLeftIcon /> },
              { action: 'alignCenterH', label: '가운데', icon: <AlignCenterHIcon /> },
              { action: 'alignRight', label: '오른쪽', icon: <AlignRightIcon /> },
              { action: 'alignTop', label: '위', icon: <AlignTopIcon /> },
              { action: 'alignMiddleV', label: '중간', icon: <AlignMiddleVIcon /> },
              { action: 'alignBottom', label: '아래', icon: <AlignBottomIcon /> },
            ].map(({ action, label, icon }) => (
              <button
                key={action}
                title={label}
                onClick={() => {
                  const changes = computeAlignmentChanges(elements, action)
                  if (changes.length > 0) batchUpdateFlatElementsIndividual(changes)
                }}
                className="flex-1 flex items-center justify-center py-1.5 rounded text-slate-300 hover:bg-white/10 transition-colors"
              >
                {icon}
              </button>
            ))}
          </div>
          {elements.length >= 3 && (
            <>
              <SectionTitle>분배</SectionTitle>
              <div className="flex gap-1">
                {[
                  { action: 'distributeH', label: '가로 균등', icon: <DistributeHIcon /> },
                  { action: 'distributeV', label: '세로 균등', icon: <DistributeVIcon /> },
                ].map(({ action, label, icon }) => (
                  <button
                    key={action}
                    title={label}
                    onClick={() => {
                      const changes = computeDistributionChanges(elements, action)
                      if (changes.length > 0) batchUpdateFlatElementsIndividual(changes)
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-slate-300 hover:bg-white/10 transition-colors"
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 텍스트 전용: 전체가 text일 때만 */}
        {allText && (
          <div className="pt-1 border-t border-white/5">
            <SectionTitle>글꼴</SectionTitle>
            <div>
              <p className={`${labelClass} mb-0.5`}>글꼴 색</p>
              <ColorPicker
                value={getCommonStyle('color') || '#000000'}
                onChange={v => updateAllStyle('color', v)}
              />
            </div>
            <div className="mt-2">
              <p className={`${labelClass} mb-0.5`}>맞춤</p>
              <div className="flex gap-1.5">
                {[
                  { value: 'left', label: '왼쪽', icon: <TextAlignLeftIcon /> },
                  { value: 'center', label: '가운데', icon: <TextAlignCenterIcon /> },
                  { value: 'right', label: '오른쪽', icon: <TextAlignRightIcon /> },
                ].map(a => (
                  <button
                    key={a.value}
                    onClick={() => updateAllStyle('textAlign', a.value)}
                    title={a.label + ' 맞춤'}
                    className={[
                      'flex-1 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center border',
                      getCommonStyle('textAlign') === a.value
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {a.icon}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 채우기 — 공통 */}
        <div className="pt-1 border-t border-white/5">
          <SectionTitle>채우기</SectionTitle>
          <div>
            <p className={`${labelClass} mb-0.5`}>배경색 {commonBg === null && <span className="text-slate-600">(혼합)</span>}</p>
            <ColorPicker
              value={commonBg || '#ffffff'}
              onChange={v => updateAllStyle('backgroundColor', v)}
              showOpacity
            />
          </div>
          <div className="mt-2">
            <p className={`${labelClass} mb-0.5`}>
              투명도 <span className="text-slate-600">{commonOpacity ?? '--'}</span>
            </p>
            <input
              type="range"
              min="0" max="1" step="0.01"
              value={commonOpacity || '1'}
              onChange={e => updateAllStyle('opacity', e.target.value)}
              className="w-full"
              style={{ accentColor: '#6366f1' }}
            />
          </div>
        </div>

        {/* 모서리 둥글기 */}
        <div className="pt-1 border-t border-white/5">
          <SectionTitle>선</SectionTitle>
          <NumInput
            label="모서리 둥글기"
            value={parseFloat(commonBorderRadius) || 0}
            onChange={v => updateAllStyle('borderRadius', v + 'px')}
            min={0} unit="px"
          />
        </div>

        {/* 삭제 */}
        <div className="pt-1 border-t border-white/5">
          <button
            onClick={removeSelectedElements}
            className="flex items-center justify-center w-full text-xs text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg px-2.5 py-1.5 border border-red-500/20 transition-colors"
          >
            <TrashIcon />
            <span className="ml-1">{elements.length}개 삭제</span>
          </button>
        </div>
      </div>
    </>
  )
}

/** 그룹 바운딩 박스 계산 */
function getGroupBBox(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const el of elements) {
    minX = Math.min(minX, el.x)
    minY = Math.min(minY, el.y)
    maxX = Math.max(maxX, el.x + el.width)
    maxY = Math.max(maxY, el.y + el.height)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
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
        <NumInput label="회전" value={el.rotation || 0} onChange={v => update({ rotation: v })} unit="°" />
      </div>
    </div>
  )
}

function FontSection({ styles, updateStyle, isGradientText }) {
  const parseFontSize = (v) => parseFloat(v) || 16
  const isBold = parseInt(styles.fontWeight) >= 700
  const isItalic = styles.fontStyle === 'italic'
  const decoration = styles.textDecoration || ''
  const isUnderline = decoration.includes('underline')
  const isStrike = decoration.includes('line-through')

  return (
    <div className="space-y-2">
      <SectionTitle>글꼴</SectionTitle>

      <FontComboBox
        value={styles.fontFamily || ''}
        onChange={v => updateStyle('fontFamily', v)}
      />

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
        <ToggleBtn active={isUnderline} onClick={() => {
          const parts = decoration.split(/\s+/).filter(d => d && d !== 'none')
          const next = isUnderline ? parts.filter(d => d !== 'underline') : [...parts, 'underline']
          updateStyle('textDecoration', next.length ? next.join(' ') : 'none')
        }} title="밑줄 (Underline)">
          <u>U</u>
        </ToggleBtn>
        <ToggleBtn active={isStrike} onClick={() => {
          const parts = decoration.split(/\s+/).filter(d => d && d !== 'none')
          const next = isStrike ? parts.filter(d => d !== 'line-through') : [...parts, 'line-through']
          updateStyle('textDecoration', next.length ? next.join(' ') : 'none')
        }} title="취소선 (Strikethrough)">
          <s>S</s>
        </ToggleBtn>
      </div>

      <div style={isGradientText ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
        <p className={`${labelClass} mb-0.5`}>글꼴 색{isGradientText ? ' (그래디언트 사용 중)' : ''}</p>
        <ColorPicker value={styles.color} onChange={v => updateStyle('color', v)} />
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>맞춤</p>
        <div className="flex gap-1.5">
          {[
            { value: 'left', label: '왼쪽', icon: <TextAlignLeftIcon /> },
            { value: 'center', label: '가운데', icon: <TextAlignCenterIcon /> },
            { value: 'right', label: '오른쪽', icon: <TextAlignRightIcon /> },
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
        <SelectInput
          label="텍스트 변환"
          value={styles.textTransform || 'none'}
          onChange={v => updateStyle('textTransform', v)}
          options={[
            { value: 'none', label: '없음' },
            { value: 'uppercase', label: 'ABC 대문자' },
            { value: 'lowercase', label: 'abc 소문자' },
            { value: 'capitalize', label: 'Abc 첫글자' },
          ]}
        />
        <SelectInput
          label="수직 정렬"
          value={styles.alignItems || 'center'}
          onChange={v => updateStyle('alignItems', v)}
          options={[
            { value: 'flex-start', label: '위' },
            { value: 'center', label: '중간' },
            { value: 'flex-end', label: '아래' },
          ]}
        />
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

function FillSection({ styles, updateStyle, updateStyles, previewStyle, isText }) {
  const opacityRef = useRef(null)
  const hasGradient = styles.backgroundImage && styles.backgroundImage !== 'none'
    && (styles.backgroundImage.includes('gradient'))
  const isGradientText = styles.webkitBackgroundClip === 'text'
  const handleGradientChange = (v) => {
    if (v === 'none' && isGradientText) {
      // 그래디언트 제거 시 background-clip:text 관련 속성도 정리
      updateStyles({
        backgroundImage: 'none',
        webkitBackgroundClip: '',
        webkitTextFillColor: '',
      })
    } else {
      updateStyle('backgroundImage', v)
    }
  }

  const toggleGradientText = () => {
    if (isGradientText) {
      updateStyles({ webkitBackgroundClip: '', webkitTextFillColor: '' })
    } else {
      updateStyles({ webkitBackgroundClip: 'text', webkitTextFillColor: 'transparent' })
    }
  }

  const handleOpacityChange = (e) => {
    previewStyle('opacity', e.target.value)
  }
  const handleOpacityCommit = () => {
    updateStyle('opacity', opacityRef.current?.value || styles.opacity)
  }

  return (
    <div className="space-y-2">
      <SectionTitle>채우기</SectionTitle>
      <div style={hasGradient && !isGradientText ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
        <p className={`${labelClass} mb-0.5`}>배경색{hasGradient && !isGradientText ? ' (그래디언트 사용 중)' : ''}</p>
        <ColorPicker
          value={styles.backgroundColor}
          onChange={v => updateStyle('backgroundColor', v)}
          showOpacity
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <p className={labelClass}>그래디언트</p>
          {isText && hasGradient && (
            <button
              onClick={toggleGradientText}
              className={`text-xs px-1.5 py-0.5 rounded ${
                isGradientText
                  ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
              title="그래디언트를 텍스트 색상에 적용"
            >
              텍스트에 적용
            </button>
          )}
        </div>
        <GradientEditor
          value={hasGradient ? styles.backgroundImage : 'none'}
          onChange={handleGradientChange}
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

function LineSection({ styles, updateStyle, updateStyles }) {
  const parseBorder = (border) => {
    if (!border || border === 'none' || border === '0px none' || border.startsWith('0px')) {
      return { width: 0, style: 'none', color: '#000000' }
    }
    const match = border.match(/^([\d.]+)px\s+(\w+)\s+(.+)$/)
    if (match) {
      const parsed = parseColor(match[3])
      return { width: parseFloat(match[1]), style: match[2], color: parsed.hex }
    }
    return { width: 0, style: 'none', color: '#000000' }
  }

  const SIDES = [
    { key: 'borderTop', icon: '━', label: '상', rotate: '' },
    { key: 'borderRight', icon: '┃', label: '우', rotate: '' },
    { key: 'borderBottom', icon: '━', label: '하', rotate: '' },
    { key: 'borderLeft', icon: '┃', label: '좌', rotate: '' },
  ]

  // 개별 면 border가 있는지 감지
  const hasIndividual = SIDES.some(s => {
    const v = styles[s.key]
    return v && !v.startsWith('0px') && v !== 'none'
  })

  // 현재 모드: 'all' (4면 균일) 또는 'sides' (개별 면)
  const [mode, setMode] = useState(hasIndividual ? 'sides' : 'all')

  // 균일 border
  const b = parseBorder(styles.border)

  const updateBorder = (key, val) => {
    const next = { ...b, [key]: val }
    if (next.style === 'none' || next.width === 0) {
      updateStyle('border', '0px none')
    } else {
      updateStyle('border', `${next.width}px ${next.style} ${next.color}`)
    }
  }

  // 개별 면 편집
  const getSideBorder = (sideKey) => {
    return parseBorder(styles[sideKey])
  }

  const updateSideBorder = (sideKey, key, val) => {
    const current = getSideBorder(sideKey)
    const next = { ...current, [key]: val }
    if (next.style === 'none' || next.width === 0) {
      updateStyle(sideKey, '0px none transparent')
    } else {
      updateStyle(sideKey, `${next.width}px ${next.style} ${next.color}`)
    }
  }

  const toggleSide = (sideKey) => {
    const current = getSideBorder(sideKey)
    if (current.width > 0 && current.style !== 'none') {
      updateStyle(sideKey, '0px none transparent')
    } else {
      // 기본값: 1px solid 현재 색
      const refColor = b.color || '#000000'
      updateStyle(sideKey, `1px solid ${refColor}`)
    }
  }

  // 모드 전환
  const switchToSides = () => {
    setMode('sides')
    // 현재 uniform border를 4면으로 분배
    if (b.width > 0 && b.style !== 'none') {
      const val = `${b.width}px ${b.style} ${b.color}`
      updateStyles({
        border: '0px none',
        borderTop: val,
        borderRight: val,
        borderBottom: val,
        borderLeft: val,
      })
    }
  }

  const switchToAll = () => {
    setMode('all')
    // 개별 면 중 가장 두꺼운 것을 uniform으로 적용
    let best = null
    for (const s of SIDES) {
      const parsed = getSideBorder(s.key)
      if (parsed.width > 0 && parsed.style !== 'none') {
        if (!best || parsed.width > best.width) best = parsed
      }
    }
    const changes = {
      borderTop: '',
      borderRight: '',
      borderBottom: '',
      borderLeft: '',
    }
    if (best) {
      changes.border = `${best.width}px ${best.style} ${best.color}`
    } else {
      changes.border = '0px none'
    }
    updateStyles(changes)
  }

  // 활성 면 수 표시
  const activeSideCount = SIDES.filter(s => {
    const v = getSideBorder(s.key)
    return v.width > 0 && v.style !== 'none'
  }).length

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>선</SectionTitle>
        <div className="flex gap-0.5">
          <button
            onClick={mode === 'all' ? switchToSides : switchToAll}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              mode === 'sides'
                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                : 'bg-white/5 text-slate-500 border border-white/10 hover:bg-white/10'
            }`}
            title={mode === 'all' ? '개별 면 편집' : '전체 면 편집'}
          >
            {mode === 'sides' ? `개별 (${activeSideCount}면)` : '전체'}
          </button>
        </div>
      </div>

      {mode === 'all' ? (
        /* ── 전체 모드 ── */
        <>
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
        </>
      ) : (
        /* ── 개별 면 모드 ── */
        <>
          {/* 면 토글 다이어그램 */}
          <div className="flex items-center justify-center gap-1 py-1">
            <div className="relative w-16 h-12 border border-white/10 rounded">
              {/* 상 */}
              <button
                onClick={() => toggleSide('borderTop')}
                className={`absolute -top-px left-1 right-1 h-[3px] rounded-full transition-colors ${
                  getSideBorder('borderTop').width > 0 && getSideBorder('borderTop').style !== 'none'
                    ? 'bg-indigo-400' : 'bg-white/15 hover:bg-white/30'
                }`}
                title="상단 선"
              />
              {/* 하 */}
              <button
                onClick={() => toggleSide('borderBottom')}
                className={`absolute -bottom-px left-1 right-1 h-[3px] rounded-full transition-colors ${
                  getSideBorder('borderBottom').width > 0 && getSideBorder('borderBottom').style !== 'none'
                    ? 'bg-indigo-400' : 'bg-white/15 hover:bg-white/30'
                }`}
                title="하단 선"
              />
              {/* 좌 */}
              <button
                onClick={() => toggleSide('borderLeft')}
                className={`absolute top-1 bottom-1 -left-px w-[3px] rounded-full transition-colors ${
                  getSideBorder('borderLeft').width > 0 && getSideBorder('borderLeft').style !== 'none'
                    ? 'bg-indigo-400' : 'bg-white/15 hover:bg-white/30'
                }`}
                title="좌측 선"
              />
              {/* 우 */}
              <button
                onClick={() => toggleSide('borderRight')}
                className={`absolute top-1 bottom-1 -right-px w-[3px] rounded-full transition-colors ${
                  getSideBorder('borderRight').width > 0 && getSideBorder('borderRight').style !== 'none'
                    ? 'bg-indigo-400' : 'bg-white/15 hover:bg-white/30'
                }`}
                title="우측 선"
              />
            </div>
          </div>

          {/* 활성 면 속성 편집 */}
          {SIDES.map(side => {
            const sb = getSideBorder(side.key)
            if (sb.width === 0 || sb.style === 'none') return null
            return (
              <div key={side.key} className="space-y-1 pl-1 border-l-2 border-indigo-500/30 ml-1">
                <p className="text-[10px] text-indigo-300">{side.label}단</p>
                <div className="grid grid-cols-2 gap-1">
                  <NumInput
                    label="너비"
                    value={sb.width}
                    onChange={v => updateSideBorder(side.key, 'width', v)}
                    min={0} unit="px"
                  />
                  <SelectInput
                    label="종류"
                    value={sb.style}
                    onChange={v => updateSideBorder(side.key, 'style', v)}
                    options={[
                      { value: 'none', label: '없음' },
                      { value: 'solid', label: '실선' },
                      { value: 'dashed', label: '파선' },
                      { value: 'dotted', label: '점선' },
                    ]}
                  />
                </div>
                <div>
                  <p className={`${labelClass} mb-0.5`}>색</p>
                  <ColorPicker value={sb.color} onChange={v => updateSideBorder(side.key, 'color', v)} />
                </div>
              </div>
            )
          })}
        </>
      )}

      <NumInput
        label="모서리 둥글기"
        value={parseFloat(styles.borderRadius) || 0}
        onChange={v => updateStyle('borderRadius', v + 'px')}
        min={0} unit="px"
      />
    </div>
  )
}

function ImageSection({ styles, updateStyle, elementId }) {
  const { setCroppingFlat } = useFlatStore()
  const objFit = styles.objectFit || 'cover'
  const objPos = styles.objectPosition || 'center center'

  // objectPosition → %값 파싱
  const parsePos = (pos) => {
    if (!pos || pos === 'center center') return { px: 50, py: 50 }
    const parts = pos.trim().split(/\s+/)
    return { px: parseFloat(parts[0]) || 50, py: parseFloat(parts[1]) || 50 }
  }
  const { px, py } = parsePos(objPos)

  return (
    <div className="space-y-2">
      <SectionTitle>이미지</SectionTitle>
      <div>
        <p className={`${labelClass} mb-0.5`}>맞춤</p>
        <div className="flex gap-1">
          {['cover', 'contain', 'fill'].map(fit => (
            <button key={fit} onClick={() => updateStyle('objectFit', fit)}
              className={`text-xs px-2 py-0.5 rounded ${
                objFit === fit
                  ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10'
              }`}
            >
              {fit === 'cover' ? '채우기' : fit === 'contain' ? '맞추기' : '늘리기'}
            </button>
          ))}
        </div>
      </div>
      {objFit === 'cover' && (
        <div>
          <p className={`${labelClass} mb-0.5`}>위치</p>
          <div className="flex items-center gap-2">
            {/* 9 포인트 그리드 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, width: 42 }}>
              {[
                { px: 0, py: 0 }, { px: 50, py: 0 }, { px: 100, py: 0 },
                { px: 0, py: 50 }, { px: 50, py: 50 }, { px: 100, py: 50 },
                { px: 0, py: 100 }, { px: 50, py: 100 }, { px: 100, py: 100 },
              ].map((pos, i) => {
                const isActive = Math.abs(px - pos.px) < 5 && Math.abs(py - pos.py) < 5
                return (
                  <button key={i}
                    onClick={() => updateStyle('objectPosition', `${pos.px}% ${pos.py}%`)}
                    style={{
                      width: 12, height: 12, borderRadius: 2,
                      background: isActive ? 'rgba(99, 102, 241, 0.6)' : 'rgba(255, 255, 255, 0.1)',
                      border: `1px solid ${isActive ? 'rgba(99, 102, 241, 0.8)' : 'rgba(255, 255, 255, 0.15)'}`,
                      cursor: 'pointer',
                    }}
                  />
                )
              })}
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-1">
                <span className={labelClass} style={{ fontSize: 9, width: 12 }}>X</span>
                <input type="range" min="0" max="100" step="1" value={Math.round(px)}
                  onChange={e => updateStyle('objectPosition', `${e.target.value}% ${Math.round(py)}%`)}
                  className="flex-1" style={{ accentColor: '#6366f1' }}
                />
                <span className="text-xs text-slate-400 w-7 text-right">{Math.round(px)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <span className={labelClass} style={{ fontSize: 9, width: 12 }}>Y</span>
                <input type="range" min="0" max="100" step="1" value={Math.round(py)}
                  onChange={e => updateStyle('objectPosition', `${Math.round(px)}% ${e.target.value}%`)}
                  className="flex-1" style={{ accentColor: '#6366f1' }}
                />
                <span className="text-xs text-slate-400 w-7 text-right">{Math.round(py)}%</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setCroppingFlat(elementId)}
            className="mt-1.5 flex items-center justify-center w-full text-xs text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg px-2.5 py-1.5 border border-indigo-500/20 transition-colors"
          >
            드래그로 위치 조정
          </button>
        </div>
      )}
    </div>
  )
}

function EffectSection({ styles, updateStyle, isText }) {
  return (
    <div className="space-y-2">
      <SectionTitle>효과</SectionTitle>
      <div>
        <p className={`${labelClass} mb-0.5`}>그림자</p>
        <BoxShadowEditor
          value={styles.boxShadow || 'none'}
          onChange={v => updateStyle('boxShadow', v)}
        />
      </div>
      {isText && (
        <div>
          <p className={`${labelClass} mb-0.5`}>텍스트 그림자</p>
          <TextShadowEditor
            value={styles.textShadow || 'none'}
            onChange={v => updateStyle('textShadow', v)}
          />
        </div>
      )}
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

// ── 오브젝트 정렬/분배 아이콘 (속성 패널 다중 선택용) ──

function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="1" x2="1" y2="15" strokeWidth="2" />
      <rect x="3" y="3" width="8" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="3" y="9" width="5" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function AlignCenterHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="8" y1="1" x2="8" y2="15" strokeDasharray="2 1.5" />
      <rect x="2" y="3" width="12" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="4" y="9" width="8" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="15" y1="1" x2="15" y2="15" strokeWidth="2" />
      <rect x="5" y="3" width="8" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="8" y="9" width="5" height="4" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function AlignTopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="1" x2="15" y2="1" strokeWidth="2" />
      <rect x="3" y="3" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="9" y="3" width="4" height="5" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function AlignMiddleVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="8" x2="15" y2="8" strokeDasharray="2 1.5" />
      <rect x="3" y="2" width="4" height="12" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="9" y="4" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function AlignBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="15" x2="15" y2="15" strokeWidth="2" />
      <rect x="3" y="5" width="4" height="8" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="9" y="8" width="4" height="5" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function DistributeHIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="1" x2="1" y2="15" strokeWidth="1.5" opacity="0.5" />
      <line x1="15" y1="1" x2="15" y2="15" strokeWidth="1.5" opacity="0.5" />
      <rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="10" y="4" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

function DistributeVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <line x1="1" y1="1" x2="15" y2="1" strokeWidth="1.5" opacity="0.5" />
      <line x1="1" y1="15" x2="15" y2="15" strokeWidth="1.5" opacity="0.5" />
      <rect x="4" y="3" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
      <rect x="4" y="10" width="8" height="3" rx="0.5" fill="currentColor" opacity="0.4" stroke="none" />
    </svg>
  )
}

// ── 텍스트 정렬 아이콘 (텍스트 속성 패널용) ──

function TextAlignLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 10H3M21 6H3M21 14H3M17 18H3" />
    </svg>
  )
}

function TextAlignCenterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 10H6M21 6H3M21 14H3M18 18H6" />
    </svg>
  )
}

function TextAlignRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10H7M21 6H3M21 14H3M21 18H7" />
    </svg>
  )
}


// ── 슬라이드 배경 패널 (선택 없을 때 표시) ──

const BG_DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  color: '#000', fontSize: '16px', fontFamily: 'sans-serif',
  fontWeight: '400', lineHeight: '1.5', textAlign: 'left',
  letterSpacing: 'normal', textTransform: 'none', textDecoration: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px', objectFit: 'cover',
}

function SlideBackgroundPanel() {
  const { flatElements, canvasSize, updateFlatElement, previewFlatElement, addFlatElement } = useFlatStore()
  const opacityRef = useRef(null)

  // 배경 요소 찾기 또는 생성
  const bgEl = flatElements.find(el => isBackgroundElement(el, canvasSize))

  const ensureBgElement = useCallback(() => {
    if (bgEl) return bgEl.id
    // 배경 요소가 없으면 자동 생성 (맨 뒤 z-index)
    const minZ = flatElements.length > 0
      ? Math.min(...flatElements.map(e => e.zIndex)) - 1
      : 0
    const newEl = {
      id: nextFlatId(),
      sourceId: null,
      type: 'shape',
      content: '',
      isRich: false,
      merged: false,
      x: 0, y: 0,
      width: canvasSize.w,
      height: canvasSize.h,
      zIndex: minZ,
      locked: true,
      styles: { ...BG_DEFAULT_STYLES, backgroundColor: '#ffffff' },
    }
    addFlatElement(newEl)
    return newEl.id
  }, [bgEl, flatElements, canvasSize, addFlatElement])

  const updateBgStyle = useCallback((key, value) => {
    const id = ensureBgElement()
    updateFlatElement(id, { styles: { [key]: value } })
  }, [ensureBgElement, updateFlatElement])

  const updateBgStyles = useCallback((styleChanges) => {
    const id = ensureBgElement()
    updateFlatElement(id, { styles: styleChanges })
  }, [ensureBgElement, updateFlatElement])

  const previewBgStyle = useCallback((key, value) => {
    if (!bgEl) return
    previewFlatElement(bgEl.id, { styles: { [key]: value } })
  }, [bgEl, previewFlatElement])

  const styles = bgEl?.styles || BG_DEFAULT_STYLES
  const hasGradient = styles.backgroundImage && styles.backgroundImage !== 'none'
    && styles.backgroundImage.includes('gradient')

  return (
    <>
      {/* 헤더 */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-500/20 text-slate-300 border border-slate-500/30">
          슬라이드 배경
        </span>
        <span className="text-xs text-slate-500 flex-1">{canvasSize.w} x {canvasSize.h}</span>
      </div>

      <div className="p-3 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 140px)' }}>
        {/* 배경색 */}
        <div className="space-y-2">
          <SectionTitle>배경색</SectionTitle>
          <div style={hasGradient ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
            <ColorPicker
              value={styles.backgroundColor || 'rgba(0,0,0,0)'}
              onChange={v => updateBgStyle('backgroundColor', v)}
              showOpacity
            />
          </div>
        </div>

        {/* 그래디언트 */}
        <div className="space-y-2">
          <SectionTitle>그래디언트</SectionTitle>
          <GradientEditor
            value={hasGradient ? styles.backgroundImage : 'none'}
            onChange={v => updateBgStyle('backgroundImage', v)}
          />
        </div>

        {/* 투명도 */}
        <div className="space-y-2">
          <SectionTitle>
            투명도 <span className="text-slate-600 font-normal">{styles.opacity || '1'}</span>
          </SectionTitle>
          <input
            ref={opacityRef}
            type="range"
            min="0" max="1" step="0.01"
            value={styles.opacity || '1'}
            onChange={e => previewBgStyle('opacity', e.target.value)}
            onMouseUp={() => updateBgStyle('opacity', opacityRef.current?.value || styles.opacity)}
            onTouchEnd={() => updateBgStyle('opacity', opacityRef.current?.value || styles.opacity)}
            className="w-full"
            style={{ accentColor: '#6366f1' }}
          />
        </div>

        {/* 배경 이미지 (파일 선택) */}
        <div className="space-y-2">
          <SectionTitle>배경 이미지</SectionTitle>
          {bgEl?.styles?.backgroundImage?.startsWith('url(') && (
            <div className="mb-2">
              <div style={{
                width: '100%', height: 80, borderRadius: 6,
                backgroundImage: styles.backgroundImage,
                backgroundSize: 'cover', backgroundPosition: 'center',
                border: '1px solid rgba(255,255,255,0.1)',
              }} />
              <button
                onClick={() => updateBgStyles({ backgroundImage: 'none' })}
                className="text-xs text-red-400 mt-1 hover:text-red-300"
              >이미지 제거</button>
            </div>
          )}
          <label
            className="flex items-center justify-center gap-1 w-full py-2 rounded-lg text-xs text-slate-400 border border-dashed border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 cursor-pointer transition-colors"
          >
            <span>이미지 선택</span>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = (ev) => {
                  updateBgStyle('backgroundImage', `url(${ev.target.result})`)
                }
                reader.readAsDataURL(file)
                e.target.value = ''
              }}
            />
          </label>
        </div>
      </div>
    </>
  )
}
