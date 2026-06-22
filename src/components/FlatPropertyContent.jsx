import { useState, useRef, useCallback, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import ColorPicker, { parseColor } from './ColorPicker'
import FontComboBox from './FontComboBox'
import GradientEditor from './GradientEditor'
import BoxShadowEditor from './BoxShadowEditor'
import TextShadowEditor from './TextShadowEditor'
import TextStrokeEditor from './TextStrokeEditor'
import { computeAlignmentChanges, computeDistributionChanges, isBackgroundElement } from '../core/SnapEngine'
import { nextFlatId } from '../core/FlatExtractor'
import { BlobStore } from '../core/BlobStore'
import { detectListType, applyListType } from '../core/TextListTransform'
import { addRow, removeRow, addCol, removeCol, setHeaderRow, setBorder } from '../core/slideTable'
import { useScrub } from './useScrub'
import { setFontSizeUniformPx, stripInlineFormatting, FORMAT_STRIP } from '../core/TextStyleScope'
import { generateImage, hasApiKey } from '../core/OpenAIClient'
import { openAiSettings } from './AiSettingsModal'
import { BACKGROUND_STYLES, BACKGROUND_GROUPS, DEFAULT_BACKGROUND_STYLE_ID, getBackgroundStyle, buildBackgroundPrompt } from '../core/backgroundStyles'
import { detectBgColor, applyChromaKey } from '../core/chromaKey'
import { highlightCode, CODE_FONT } from '../core/codeHighlight'
import { renderMarkdown } from '../core/markdown'
import { EFFECTS, effectHasDir } from '../core/slideAnimation'

// ── 글꼴 크기 프리셋 ────────────────────────────────

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96]

const FLAT_TYPE_LABEL = { text: '텍스트', image: '이미지', shape: '도형', svg: 'SVG', video: '영상', table: '표' }
const FLAT_TYPE_COLOR = {
  text: 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30',
  image: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  shape: 'bg-violet-500/20 text-violet-300 border border-violet-500/30',
  svg: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  video: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  table: 'bg-sky-500/20 text-sky-300 border border-sky-500/30',
}

// ── 공통 입력 헬퍼 ──────────────────────────────────

const inputClass = 'w-full text-xs text-slate-200 bg-white/5 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors'
const selectClass = 'w-full text-xs text-slate-200 rounded-lg px-2.5 py-1.5 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors appearance-none cursor-pointer'
const selectStyle = { backgroundColor: '#1e293b' }  // 불투명 배경 — 드롭다운 옵션 가독성
const labelClass = 'text-xs text-slate-500'
// 스크럽(드래그로 값 변경) 가능한 레이블 — 점선 밑줄로 일반 레이블과 시각 구분
// 라벨 전체(숫자 박스 너비)가 스크럽 영역 — 짧은 글자 의존 X, 일관된 큰 가로 타깃.
// (패딩/마진은 다른 라벨과 행 높이가 어긋나므로 쓰지 않음 — w-full로만 넓힘)
const scrubLabelClass = `${labelClass} w-full mb-0.5 underline decoration-dotted decoration-slate-500 underline-offset-2 hover:text-slate-200 hover:decoration-slate-300`

/**
 * FlatPropertyContent — Flat 모드 속성 패널 콘텐츠
 * PropertyPanel 셸 안에 렌더링된다.
 */
export default function FlatPropertyContent() {
  const { selectedFlatIds, flatElements, updateFlatElement, previewFlatElement,
          editingFlatId } = useFlatStore()
  const selectedEls = flatElements.filter(e => selectedFlatIds.includes(e.id))

  const [animTab, setAnimTab] = useState(false)
  const singleSel = selectedEls.length === 1
  // 애니메이션 탭이 단일 선택 상태에서 활성일 때만 캔버스 순서 배지 표시
  useEffect(() => {
    useFlatStore.getState().setAnimPanelOpen(animTab && singleSel)
    return () => useFlatStore.getState().setAnimPanelOpen(false)
  }, [animTab, singleSel])

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
          {el.locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </button>
      </div>

      {/* 탭: 속성 / 애니메이션 (정보 과다 방지) */}
      <div className="flex border-b border-white/5 px-2">
        {[['props', '속성'], ['anim', '애니메이션']].map(([k, label]) => {
          const active = (k === 'anim') === animTab
          return (
            <button key={k} onClick={() => setAnimTab(k === 'anim')}
              className={`text-xs px-3 py-1.5 -mb-px border-b-2 transition-colors ${
                active ? 'border-indigo-400 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >{label}</button>
          )
        })}
      </div>

      {animTab && (
        <div className="p-3">
          <AnimationTab el={el} />
        </div>
      )}

      <div className="p-3 space-y-3" style={animTab ? { display: 'none' } : undefined}>
        <PositionSection el={el} update={update} preview={(changes) => previewFlatElement(el.id, changes)} />

        <div className="pt-1 border-t border-white/5">
          <OrderSection el={el} />
        </div>

        {(el.type === 'text' || (el.type === 'shape' && el.content)) && (
          <div className="pt-1 border-t border-white/5">
            <FontSection
              el={el} styles={el.styles} updateStyle={updateStyle} previewStyle={previewStyle}
              isGradientText={el.styles.webkitBackgroundClip === 'text'}
              listType={detectListType(el.content, el.isRich)}
              onSetListType={editingFlatId === el.id ? undefined : (target) => update(applyListType(el.content, el.isRich, target))}
            />
          </div>
        )}

        {el.type === 'text' && (
          <div className="pt-1 border-t border-white/5">
            <CodeSection el={el} update={update} />
          </div>
        )}

        {el.type === 'text' && (
          <div className="pt-1 border-t border-white/5">
            <MarkdownSection el={el} />
          </div>
        )}

        {el.type === 'image' && (
          <div className="pt-1 border-t border-white/5">
            <ImageSection styles={el.styles} updateStyle={updateStyle} previewStyle={previewStyle} elementId={el.id} />
          </div>
        )}

        {el.type === 'video' && (
          <div className="pt-1 border-t border-white/5">
            <VideoSection el={el} update={update} />
          </div>
        )}

        {el.type === 'table' && el.table && (
          <div className="pt-1 border-t border-white/5">
            <TableSection el={el} update={update} updateStyle={updateStyle} />
          </div>
        )}

        {/* 포인트 기반 shape (선/폴리라인/폴리곤) */}
        {/* 포인트 기반 shape (선/폴리라인/폴리곤) — 전용 섹션만 표시 */}
        {el.shapeType && el.points && (
          <div className="pt-1 border-t border-white/5">
            <PolyShapeSection el={el} update={update} updateStyle={updateStyle} previewStyle={previewStyle} />
          </div>
        )}

        {/* 선 전용 편집 (가로/세로 얇은 shape — 구 방식) */}
        {!el.shapeType && el.type === 'shape' && (el.width <= 4 || el.height <= 4) && (
          <div className="pt-1 border-t border-white/5">
            <ShapeLineSection el={el} update={update} updateStyle={updateStyle} preview={(changes) => previewFlatElement(el.id, changes)} />
          </div>
        )}

        {/* 채우기 — text, normal shape, image만 (poly shape는 PolyShapeSection에서 처리) */}
        {!el.shapeType && (el.type === 'text' || el.type === 'shape' || el.type === 'image') && (
          <div className="pt-1 border-t border-white/5">
            <FillSection styles={el.styles} updateStyle={updateStyle} updateStyles={updateStyles} previewStyle={previewStyle} isText={el.type === 'text'} />
          </div>
        )}

        {/* 부분 채우기 — normal shape만 (진행률/악센트: 일부만 솔리드. PPT는 솔리드 사각형으로 변환) */}
        {!el.shapeType && el.type === 'shape' && (
          <div className="pt-1 border-t border-white/5">
            <PartialFillSection el={el} update={update} />
          </div>
        )}

        {/* 테두리 — text, normal shape, image만 (poly shape는 stroke로 처리) */}
        {!el.shapeType && (el.type === 'text' || el.type === 'shape' || el.type === 'image') && (
          <div className="pt-1 border-t border-white/5">
            <LineSection styles={el.styles} updateStyle={updateStyle} updateStyles={updateStyles} previewStyle={previewStyle} />
          </div>
        )}

        {/* 효과 — text, normal shape만 (boxShadow는 CSS box model에만 적용) */}
        {!el.shapeType && (el.type === 'text' || el.type === 'shape') && (
          <div className="pt-1 border-t border-white/5">
            <EffectSection styles={el.styles} updateStyle={updateStyle} isText={el.type === 'text'} />
          </div>
        )}

        {/* 투명도 전용 — video, svg만 (poly shape는 PolyShapeSection 내 투명도 사용) */}
        {!el.shapeType && (el.type === 'video' || el.type === 'svg') && (
          <div className="pt-1 border-t border-white/5">
            <OpacityOnlySection styles={el.styles} updateStyle={updateStyle} previewStyle={previewStyle} />
          </div>
        )}

        {/* 삭제 버튼은 PropertyPanel 푸터(스크롤 영역 밖)에서 항상 표시 */}
      </div>
    </>
  )
}

// ── 다중 선택 패널 ──────────────────────────────────

function MultiElementPanel({ elements }) {
  const { batchUpdateFlatElements, batchUpdateFlatElementsIndividual, selectedFlatIds } = useFlatStore()

  // 공통 값 계산 헬퍼: 모든 요소에서 동일하면 그 값, 아니면 null
  const getCommon = (getter) => {
    const vals = elements.map(getter)
    return vals.every(v => v === vals[0]) ? vals[0] : null
  }

  const getCommonStyle = (key) => getCommon(el => el.styles?.[key])

  const updateAllStyle = (key, value) => {
    batchUpdateFlatElements(selectedFlatIds, { styles: { [key]: value } })
  }

  // 텍스트 속성이 있는 요소 (text + content 있는 shape)
  const textEls = elements.filter(e => e.type === 'text' || (e.type === 'shape' && e.content))
  const hasTextEls = textEls.length > 0
  const textIds = textEls.map(e => e.id)

  const getTextCommon = (key) => {
    const vals = textEls.map(e => e.styles?.[key])
    return vals.every(v => v === vals[0]) ? vals[0] : null
  }

  const updateTextStyle = (key, value) => {
    batchUpdateFlatElements(textIds, { styles: { [key]: value } })
  }

  // 선택된 텍스트 요소들의 공통 리스트 상태 (다르면 'none')
  const listTypes = textEls.map(e => detectListType(e.content, e.isRich))
  const commonListType = listTypes.every(t => t === listTypes[0]) ? (listTypes[0] || 'none') : 'none'
  const setListTypeAll = (target) => batchUpdateFlatElementsIndividual(
    textEls.map(e => ({ id: e.id, changes: applyListType(e.content, e.isRich, target) }))
  )

  // 그룹 바운딩 박스
  const bbox = getGroupBBox(elements)

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

        {/* 텍스트 속성 — text 또는 content 있는 shape 포함 시 */}
        {hasTextEls && (
          <div className="pt-1 border-t border-white/5">
            <SectionTitle>글꼴</SectionTitle>
            {/* 글꼴 */}
            <FontComboBox
              value={getTextCommon('fontFamily') || ''}
              onChange={v => updateTextStyle('fontFamily', v)}
            />
            {/* 크기 + 굵기/이탈릭/밑줄 */}
            <div className="flex items-end gap-1.5 mt-2">
              <div className="flex-1">
                <p className={`${labelClass} mb-0.5`}>크기</p>
                <input
                  type="number"
                  value={parseFloat(getTextCommon('fontSize') || '16')}
                  onChange={e => updateTextStyle('fontSize', `${e.target.value}px`)}
                  onKeyDown={e => e.stopPropagation()}
                  min="8" step="1"
                  className={inputClass}
                  style={{ width: '100%' }}
                />
              </div>
              <button
                onClick={() => {
                  const isBold = parseInt(getTextCommon('fontWeight') || '400') >= 700
                  updateTextStyle('fontWeight', isBold ? '400' : '700')
                }}
                title="굵게 (Ctrl+B)"
                className={`px-2 py-1.5 rounded-lg text-xs border transition-colors ${
                  parseInt(getTextCommon('fontWeight') || '400') >= 700
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 font-bold'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10 font-bold'
                }`}
              >B</button>
              <button
                onClick={() => {
                  const isItalic = getTextCommon('fontStyle') === 'italic'
                  updateTextStyle('fontStyle', isItalic ? 'normal' : 'italic')
                }}
                title="이탈릭 (Ctrl+I)"
                className={`px-2 py-1.5 rounded-lg text-xs border transition-colors italic ${
                  getTextCommon('fontStyle') === 'italic'
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                }`}
              >I</button>
              <button
                onClick={() => {
                  const hasU = (getTextCommon('textDecoration') || '').includes('underline')
                  updateTextStyle('textDecoration', hasU ? 'none' : 'underline')
                }}
                title="밑줄 (Ctrl+U)"
                className={`px-2 py-1.5 rounded-lg text-xs border transition-colors underline ${
                  (getTextCommon('textDecoration') || '').includes('underline')
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                }`}
              >U</button>
            </div>
            {/* 색상 */}
            <div className="mt-2">
              <p className={`${labelClass} mb-0.5`}>글꼴 색</p>
              <ColorPicker
                value={getTextCommon('color') || '#000000'}
                onChange={v => updateTextStyle('color', v)}
              />
            </div>
            {/* 정렬 */}
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
                    onClick={() => updateTextStyle('textAlign', a.value)}
                    title={a.label + ' 맞춤'}
                    className={[
                      'flex-1 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center border',
                      getTextCommon('textAlign') === a.value
                        ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                    ].join(' ')}
                  >
                    {a.icon}
                  </button>
                ))}
              </div>
            </div>
            {/* 줄바꿈 — 자동(pre-wrap) / 안 함(nowrap) */}
            <div className="mt-2">
              <p className={`${labelClass} mb-0.5`}>줄바꿈</p>
              <div className="flex gap-1.5">
                {[
                  { value: 'pre-wrap', label: '자동', title: '자동 줄바꿈' },
                  { value: 'nowrap', label: '안 함', title: '줄바꿈 안 함 (한 줄 고정)' },
                ].map(o => {
                  const ws = getTextCommon('whiteSpace')
                  const active = o.value === 'nowrap' ? ws === 'nowrap' : ws !== 'nowrap'
                  return (
                    <button
                      key={o.value}
                      onClick={() => updateTextStyle('whiteSpace', o.value)}
                      title={o.title}
                      className={[
                        'flex-1 py-1.5 rounded-lg text-xs transition-colors border',
                        active
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                          : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                      ].join(' ')}
                    >
                      {o.label}
                    </button>
                  )
                })}
              </div>
            </div>
            {/* 리스트 (선택된 모든 텍스트 박스에 적용) */}
            <div className="mt-2">
              <ListToggle value={commonListType} onChange={setListTypeAll} />
            </div>
          </div>
        )}

        {/* 채우기 — 공통 */}
        <div className="pt-1 border-t border-white/5">
          <SectionTitle>채우기</SectionTitle>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <p className={labelClass}>배경색 {commonBg === null && <span className="text-slate-600">(혼합)</span>}</p>
              <button
                onClick={() => updateAllStyle('backgroundColor', 'transparent')}
                className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                title="배경 없음(투명)으로"
              >투명</button>
            </div>
            <ColorPicker
              value={commonBg && commonBg !== 'transparent' && commonBg !== 'rgba(0, 0, 0, 0)' ? commonBg : 'transparent'}
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

        {/* 삭제 버튼은 PropertyPanel 푸터(스크롤 영역 밖)에서 항상 표시 */}
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

// 순서(z-order) — 배경 레이어는 맨 뒤 고정이라 비활성
function OrderSection({ el }) {
  const isBg = isBackgroundElement(el)
  const hint = isBg ? ' (배경은 맨 뒤 고정)' : ''
  const act = (fn) => () => useFlatStore.getState()[fn](el.id)
  const btn = 'flex-1 flex items-center justify-center text-sm px-2 py-1.5 rounded bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div>
      <SectionTitle>순서</SectionTitle>
      <div className="flex gap-1">
        <button className={btn} disabled={isBg} onClick={act('sendToBack')} title={'맨 뒤로 (Ctrl+Shift+[)' + hint}>⤓</button>
        <button className={btn} disabled={isBg} onClick={act('sendBackward')} title={'뒤로 (Ctrl+[)' + hint}>↓</button>
        <button className={btn} disabled={isBg} onClick={act('bringForward')} title={'앞으로 (Ctrl+])' + hint}>↑</button>
        <button className={btn} disabled={isBg} onClick={act('bringToFront')} title={'맨 앞으로 (Ctrl+Shift+])' + hint}>⤒</button>
      </div>
    </div>
  )
}

function PositionSection({ el, update, preview }) {
  // 캔버스에 꽉 채우기 (위치 0,0 + 캔버스 크기)
  const fillCanvas = () => {
    const cs = useFlatStore.getState().canvasSize
    update({ x: 0, y: 0, width: cs.w, height: cs.h })
  }
  // 이미지 원본(실제 픽셀) 크기로 복원 — 현재 중심을 유지한 채 자연 크기 적용
  const originalSize = async () => {
    if (el.type !== 'image' || !el.content) return
    const src = BlobStore.isIdbRef(el.content) ? await BlobStore.getUrl(BlobStore.parseRef(el.content)) : el.content
    const img = new Image()
    img.onload = () => {
      const nw = img.naturalWidth, nh = img.naturalHeight
      if (!nw || !nh) return
      const cx = el.x + el.width / 2, cy = el.y + el.height / 2
      update({ x: Math.round(cx - nw / 2), y: Math.round(cy - nh / 2), width: nw, height: nh })
    }
    img.src = src
  }
  return (
    <div>
      <SectionTitle>크기 및 위치</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5">
        <NumInput label="X" value={el.x} onChange={v => update({ x: v })} onPreview={preview && (v => preview({ x: v }))} />
        <NumInput label="Y" value={el.y} onChange={v => update({ y: v })} onPreview={preview && (v => preview({ y: v }))} />
        <NumInput label="W" value={el.width} onChange={v => update({ width: v })} onPreview={preview && (v => preview({ width: v }))} min={1} />
        <NumInput label="H" value={el.height} onChange={v => update({ height: v })} onPreview={preview && (v => preview({ height: v }))} min={1} />
        <NumInput label="회전" value={el.rotation || 0} onChange={v => update({ rotation: v })} onPreview={preview && (v => preview({ rotation: v }))} unit="°" />
        {/* 화면 채우기 / 원본 크기 — 아이콘 버튼(공간 절약) */}
        <div className="flex items-end gap-1">
          <button
            type="button"
            onClick={fillCanvas}
            title="화면 채우기 (캔버스에 꽉 채움)"
            className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <FillCanvasIcon />
          </button>
          {el.type === 'image' && (
            <button
              type="button"
              onClick={originalSize}
              title="원본 크기 (이미지 실제 픽셀 크기로)"
              className="flex items-center justify-center px-2 py-1.5 rounded-lg bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors"
            >
              <OriginalSizeIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function FillCanvasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3H5a2 2 0 0 0-2 2v3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v3" />
      <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
      <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

function OriginalSizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  )
}

/**
 * 리치 텍스트 요소의 부분 서식이 섞여 있는지 감지.
 * 요소 기본 스타일을 시작 컨텍스트로 두고 자식 span/태그의 override를 추적,
 * 텍스트 노드별로 본 값이 2종 이상이면 'mixed'. (패널 토글의 혼합 상태 표시용)
 */
function detectTextMixed(el) {
  const none = { bold: false, italic: false, underline: false, strike: false }
  if (!el || !el.isRich || !el.content) return none
  let doc
  try { doc = new DOMParser().parseFromString(`<body>${el.content}</body>`, 'text/html') }
  catch { return none }

  const s = el.styles || {}
  const base = {
    bold: parseInt(s.fontWeight) >= 700,
    italic: s.fontStyle === 'italic',
    underline: (s.textDecoration || '').includes('underline'),
    strike: (s.textDecoration || '').includes('line-through'),
  }
  const seen = { bold: new Set(), italic: new Set(), underline: new Set(), strike: new Set() }
  const pick = (style, prop) => {
    const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style)
    return m ? m[1].trim().toLowerCase() : null
  }
  const walk = (node, ctx) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (!child.textContent || !child.textContent.trim()) continue
        seen.bold.add(ctx.bold); seen.italic.add(ctx.italic)
        seen.underline.add(ctx.underline); seen.strike.add(ctx.strike)
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase()
        const style = child.getAttribute('style') || ''
        const c = { ...ctx }
        if (tag === 'b' || tag === 'strong') c.bold = true
        if (tag === 'i' || tag === 'em') c.italic = true
        if (tag === 'u') c.underline = true
        if (tag === 's' || tag === 'del' || tag === 'strike') c.strike = true
        const fw = pick(style, 'font-weight')
        if (fw) c.bold = (fw === 'bold' || parseInt(fw) >= 700)
        const fst = pick(style, 'font-style')
        if (fst) c.italic = (fst === 'italic')
        const td = pick(style, 'text-decoration') || pick(style, 'text-decoration-line')
        if (td) { c.underline = td.includes('underline'); c.strike = td.includes('line-through') }
        walk(child, c)
      }
    }
  }
  walk(doc.body, base)
  const mixed = (set) => set.size > 1
  return { bold: mixed(seen.bold), italic: mixed(seen.italic), underline: mixed(seen.underline), strike: mixed(seen.strike) }
}

const CODE_LANGS = [
  { id: 'auto', label: '자동 감지' }, { id: 'js', label: 'JavaScript' }, { id: 'ts', label: 'TypeScript' },
  { id: 'python', label: 'Python' }, { id: 'bash', label: 'Bash' }, { id: 'json', label: 'JSON' },
]

// 코드 모드 — 텍스트 박스를 코드 하이라이트로(편집=원본, 표시=색칠, 커밋 시 재색칠)
function CodeSection({ el }) {
  const isCode = !!el.isCode
  const update = (changes) => useFlatStore.getState().updateFlatElement(el.id, changes)
  // 현재 텍스트를 원본 코드(plain)로 추출
  const rawText = () => {
    if (el.isRich && el.content) {
      try { return new DOMParser().parseFromString(`<body>${el.content}</body>`, 'text/html').body.textContent || '' }
      catch { return '' }
    }
    return el.content || ''
  }
  const enable = () => {
    const raw = rawText()
    const { html, lang } = highlightCode(raw, 'auto')
    update({ isCode: true, isMarkdown: false, code: raw, content: html, isRich: true, lang, styles: { fontFamily: CODE_FONT, whiteSpace: 'pre-wrap' } })
  }
  const disable = () => {
    update({ isCode: false, content: el.code || rawText(), isRich: false })
  }
  const setLang = (lang) => {
    update({ lang, content: highlightCode(el.code || '', lang).html })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>코드 하이라이트</SectionTitle>
        <button
          onClick={isCode ? disable : enable}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            isCode ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
              : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
          }`}
        >{isCode ? 'ON' : 'OFF'}</button>
      </div>
      {isCode && (
        <div>
          <p className={`${labelClass} mb-0.5`}>언어</p>
          <select value={el.lang || 'auto'} onChange={e => setLang(e.target.value)} className={selectClass} style={selectStyle}>
            {CODE_LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <p className="text-[10px] text-slate-600 mt-1">더블클릭하면 원본 코드로 편집, 끝내면 자동 색칠됩니다.</p>
        </div>
      )}
    </div>
  )
}

// 마크다운 — 텍스트 박스를 마크다운으로(편집=원본, 표시=렌더, 커밋 시 재렌더). 코드 모드와 상호배타.
function MarkdownSection({ el }) {
  const isMd = !!el.isMarkdown
  const update = (changes) => useFlatStore.getState().updateFlatElement(el.id, changes)
  const rawText = () => {
    if (el.isRich && el.content) {
      try { return new DOMParser().parseFromString(`<body>${el.content}</body>`, 'text/html').body.textContent || '' }
      catch { return '' }
    }
    return el.content || ''
  }
  const enable = () => {
    const raw = el.md || rawText()
    // 렌더 HTML이 블록 흐름(위→아래)으로 쌓이도록 flex/세로정렬 잔재 제거
    update({
      isMarkdown: true, isCode: false, md: raw, content: renderMarkdown(raw), isRich: true, merged: false,
      styles: { whiteSpace: 'normal', display: undefined, alignItems: undefined, justifyContent: undefined, isFlex: undefined },
    })
  }
  const disable = () => {
    update({ isMarkdown: false, content: el.md || rawText(), isRich: false, styles: { whiteSpace: 'pre-wrap' } })
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionTitle>마크다운</SectionTitle>
        <button
          onClick={isMd ? disable : enable}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            isMd ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
              : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
          }`}
        >{isMd ? 'ON' : 'OFF'}</button>
      </div>
      {isMd && (
        <p className="text-[10px] text-slate-600">더블클릭하면 마크다운 원본으로 편집, 끝내면 렌더됩니다. (# 제목, **굵게**, - 목록, &gt; 인용)</p>
      )}
    </div>
  )
}

function FontSection({ el, styles, updateStyle, previewStyle, isGradientText, listType, onSetListType }) {
  const parseFontSize = (v) => parseFloat(v) || 16
  const isBold = parseInt(styles.fontWeight) >= 700
  const isItalic = styles.fontStyle === 'italic'
  const decoration = styles.textDecoration || ''
  const isUnderline = decoration.includes('underline')
  const isStrike = decoration.includes('line-through')
  const mixed = detectTextMixed(el)

  // 속성 패널 = 항상 전체 적용: base 스타일 + 인라인 override(부분 수정분)까지 함께 처리.
  // 글자 크기는 절대값이므로 "전체 통일"(인라인 font-size 제거).
  const setUniformSize = (px) => {
    const r = setFontSizeUniformPx(el.content, el.isRich, px)
    useFlatStore.getState().updateFlatElement(el.id, { content: r.content, styles: { fontSize: r.fontSize } })
  }
  const previewUniformSize = (px) => {
    const r = setFontSizeUniformPx(el.content, el.isRich, px)
    useFlatStore.getState().previewFlatElement(el.id, { content: r.content, styles: { fontSize: r.fontSize } })
  }
  // 굵게/이탤릭/밑줄/취소선: base 설정 + 해당 인라인 override 제거 → 전체 통일
  const applyWholeFormat = (which, styleChanges) => {
    const content = stripInlineFormatting(el.content, el.isRich, FORMAT_STRIP[which])
    useFlatStore.getState().updateFlatElement(el.id, { content, styles: styleChanges })
  }

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
          onChange={setUniformSize}
          onPreview={previewUniformSize}
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
        <ToggleBtn active={isBold} mixed={mixed.bold} onClick={() => {
          // 혼합이면 전체 ON, 아니면 토글 — 전체 적용(인라인 굵게 override 제거)
          const turnOn = mixed.bold ? true : !isBold
          applyWholeFormat('bold', { fontWeight: turnOn ? '700' : '400' })
        }} title="굵게 (Bold)">
          <b>B</b>
        </ToggleBtn>
        <ToggleBtn active={isItalic} mixed={mixed.italic} onClick={() => {
          const turnOn = mixed.italic ? true : !isItalic
          applyWholeFormat('italic', { fontStyle: turnOn ? 'italic' : 'normal' })
        }} title="기울임 (Italic)">
          <i>I</i>
        </ToggleBtn>
        <ToggleBtn active={isUnderline} mixed={mixed.underline} onClick={() => {
          const turnOn = mixed.underline ? true : !isUnderline
          const parts = decoration.split(/\s+/).filter(d => d && d !== 'none' && d !== 'underline')
          if (turnOn) parts.push('underline')
          applyWholeFormat('underline', { textDecoration: parts.length ? parts.join(' ') : 'none' })
        }} title="밑줄 (Underline)">
          <u>U</u>
        </ToggleBtn>
        <ToggleBtn active={isStrike} mixed={mixed.strike} onClick={() => {
          const turnOn = mixed.strike ? true : !isStrike
          const parts = decoration.split(/\s+/).filter(d => d && d !== 'none' && d !== 'line-through')
          if (turnOn) parts.push('line-through')
          applyWholeFormat('strike', { textDecoration: parts.length ? parts.join(' ') : 'none' })
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

      {/* 텍스트 세로 정렬 — 박스 안에서 텍스트의 상/중/하 위치 */}
      <div>
        <p className={`${labelClass} mb-0.5`}>텍스트 세로 정렬</p>
        <div className="flex gap-1.5">
          {[
            { value: 'flex-start', label: '위', icon: <TextVAlignTopIcon /> },
            { value: 'center', label: '중간', icon: <TextVAlignMiddleIcon /> },
            { value: 'flex-end', label: '아래', icon: <TextVAlignBottomIcon /> },
          ].map(a => (
            <button
              key={a.value}
              onClick={() => updateStyle('alignItems', a.value)}
              title={'텍스트 ' + a.label + ' 정렬'}
              className={[
                'flex-1 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center border',
                (styles.alignItems || (el.type === 'shape' ? 'center' : 'flex-start')) === a.value
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
              ].join(' ')}
            >
              {a.icon}
            </button>
          ))}
        </div>
      </div>

      {/* 줄바꿈 — 자동(pre-wrap) / 안 함(nowrap) */}
      <div>
        <p className={`${labelClass} mb-0.5`}>줄바꿈</p>
        <div className="flex gap-1.5">
          {[
            { value: 'pre-wrap', label: '자동', title: '자동 줄바꿈' },
            { value: 'nowrap', label: '안 함', title: '줄바꿈 안 함 (한 줄 고정)' },
          ].map(o => {
            const active = o.value === 'nowrap'
              ? styles.whiteSpace === 'nowrap'
              : styles.whiteSpace !== 'nowrap'
            return (
              <button
                key={o.value}
                onClick={() => updateStyle('whiteSpace', o.value)}
                title={o.title}
                className={[
                  'flex-1 py-1.5 rounded-lg text-xs transition-colors border',
                  active
                    ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                ].join(' ')}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      </div>

      {onSetListType && <ListToggle value={listType} onChange={onSetListType} />}

      <div>
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
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <NumInput
          label="줄 간격"
          value={parseFloat(styles.lineHeight) || 1.5}
          onChange={v => updateStyle('lineHeight', String(v))}
          onPreview={previewStyle && (v => previewStyle('lineHeight', String(v)))}
          min={0.5} max={5} step={0.1}
        />
        <NumInput
          label="문자 간격"
          value={parseFloat(styles.letterSpacing) || 0}
          onChange={v => updateStyle('letterSpacing', v + 'px')}
          onPreview={previewStyle && (v => previewStyle('letterSpacing', v + 'px'))}
          unit="px" step={0.5}
        />
      </div>

      {/* 내부 여백 — 상/하/좌/우 개별 설정(padding 4값 shorthand로 저장) */}
      {(() => {
        const pad = parsePadding4(styles.padding)
        const setPad = (next) => updateStyle('padding', `${next.t}px ${next.r}px ${next.b}px ${next.l}px`)
        const prevPad = (next) => previewStyle('padding', `${next.t}px ${next.r}px ${next.b}px ${next.l}px`)
        return (
          <div>
            <p className={`${labelClass} mb-0.5`}>내부 여백</p>
            <div className="grid grid-cols-2 gap-1.5">
              <NumInput label="위" value={pad.t} unit="px" min={0}
                onChange={v => setPad({ ...pad, t: v })} onPreview={previewStyle && (v => prevPad({ ...pad, t: v }))} />
              <NumInput label="아래" value={pad.b} unit="px" min={0}
                onChange={v => setPad({ ...pad, b: v })} onPreview={previewStyle && (v => prevPad({ ...pad, b: v }))} />
              <NumInput label="왼쪽" value={pad.l} unit="px" min={0}
                onChange={v => setPad({ ...pad, l: v })} onPreview={previewStyle && (v => prevPad({ ...pad, l: v }))} />
              <NumInput label="오른쪽" value={pad.r} unit="px" min={0}
                onChange={v => setPad({ ...pad, r: v })} onPreview={previewStyle && (v => prevPad({ ...pad, r: v }))} />
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// CSS padding shorthand → {t,r,b,l}
function parsePadding4(p) {
  const parts = String(p || '0').trim().split(/\s+/).map(v => parseFloat(v) || 0)
  if (parts.length <= 1) { const a = parts[0] || 0; return { t: a, r: a, b: a, l: a } }
  if (parts.length === 2) return { t: parts[0], r: parts[1], b: parts[0], l: parts[1] }
  if (parts.length === 3) return { t: parts[0], r: parts[1], b: parts[2], l: parts[1] }
  return { t: parts[0], r: parts[1], b: parts[2], l: parts[3] }
}

// 부분 채우기 — 도형 일부만 솔리드(진행률/악센트). fillRatio/fillDir/fillColor 메타속성.
function PartialFillSection({ el, update }) {
  const on = el.fillRatio != null
  const dir = el.fillDir || 'left'
  const pct = Math.round((el.fillRatio ?? 0.5) * 100)
  const color = el.fillColor || 'rgba(99,102,241,1)'
  const DIRS = [
    { id: 'left', label: '왼→오' }, { id: 'right', label: '오→왼' },
    { id: 'bottom', label: '아래→위' }, { id: 'top', label: '위→아래' },
  ]
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <SectionTitle>부분 채우기</SectionTitle>
        <button
          onClick={() => on ? update({ fillRatio: undefined, fillDir: undefined, fillColor: undefined })
            : update({ fillRatio: 0.5, fillDir: 'left', fillColor: color })}
          className="text-xs text-indigo-400 hover:text-indigo-300 px-1"
        >{on ? '끄기' : '켜기'}</button>
      </div>
      {on && (
        <>
          <div className="flex gap-1">
            {DIRS.map(d => (
              <button key={d.id} onClick={() => update({ fillDir: d.id })}
                className={[
                  'flex-1 py-1 rounded-md text-[10px] border transition-colors',
                  dir === d.id ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
                ].join(' ')}
              >{d.label}</button>
            ))}
          </div>
          <p className={`${labelClass} mb-0.5`}>채움 비율 <span className="text-slate-600">{pct}%</span></p>
          <input type="range" min="0" max="100" value={pct}
            onChange={e => update({ fillRatio: parseInt(e.target.value) / 100 })}
            className="w-full" style={{ accentColor: '#6366f1' }} />
          <p className={`${labelClass} mb-0.5`}>채움 색</p>
          <ColorPicker value={color} onChange={v => update({ fillColor: v })} showOpacity />
        </>
      )}
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
        {(() => {
          const bg = styles.backgroundColor
          const isTransparent = !bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)'
          return (
            <div className="flex items-center justify-between mb-0.5">
              <p className={labelClass}>배경색{hasGradient && !isGradientText ? ' (그래디언트 사용 중)' : isTransparent ? ' (투명)' : ''}</p>
              {!isTransparent && (
                <button
                  onClick={() => updateStyle('backgroundColor', 'transparent')}
                  className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10"
                  title="배경 없음(투명)으로"
                >투명</button>
              )}
            </div>
          )
        })()}
        <ColorPicker
          value={styles.backgroundColor || 'transparent'}
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

function LineSection({ styles, updateStyle, updateStyles, previewStyle }) {
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

  // 4면이 모두 동일한지 확인
  const allSame = hasIndividual && (() => {
    const vals = SIDES.map(s => styles[s.key] || '0px none')
    return vals.every(v => v === vals[0])
  })()

  // 현재 모드 — styles가 바뀔 때 (다른 요소 선택 등) 자동 갱신
  const detectedMode = hasIndividual && !allSame ? 'sides' : 'all'
  const [mode, setMode] = useState(detectedMode)
  // 요소 변경 시 mode 재감지
  useEffect(() => { setMode(detectedMode) }, [detectedMode])

  // 균일 border: 개별이 모두 같으면 그 값 사용, 아니면 shorthand
  const b = allSame
    ? parseBorder(styles[SIDES[0].key])
    : parseBorder(styles.border)

  const updateBorder = (key, val) => {
    const next = { ...b, [key]: val }
    // 한쪽만 바꿔도 테두리가 그려지도록 나머지를 합리적 기본값으로 보정
    // (너비만 올리면 style이 none이라, 종류만 바꾸면 width가 0이라 무효화되던 문제)
    if (key === 'width' && val > 0 && next.style === 'none') next.style = 'solid'
    if (key === 'style' && val !== 'none' && next.width === 0) next.width = 1
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
    // 한쪽만 바꿔도 테두리가 그려지도록 나머지를 합리적 기본값으로 보정
    if (key === 'width' && val > 0 && next.style === 'none') next.style = 'solid'
    if (key === 'style' && val !== 'none' && next.width === 0) next.width = 1
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
        onPreview={previewStyle && (v => previewStyle('borderRadius', v + 'px'))}
        min={0} unit="px"
      />
    </div>
  )
}

function ImageSection({ styles, updateStyle, previewStyle, elementId }) {
  const { setCroppingFlat } = useFlatStore()
  const objFit = styles.objectFit || 'contain'
  const objPos = styles.objectPosition || 'center center'

  // objectPosition → %값 파싱
  const parsePos = (pos) => {
    if (!pos || pos === 'center center') return { px: 50, py: 50 }
    const parts = pos.trim().split(/\s+/)
    // 0%는 falsy라 `|| 50`이면 0이 50으로 둔갑 → 상/좌 프리셋이 활성표시·숫자 반영 안 됨.
    const fx = parseFloat(parts[0]), fy = parseFloat(parts[1])
    return { px: Number.isFinite(fx) ? fx : 50, py: Number.isFinite(fy) ? fy : 50 }
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
            {/* 9 포인트 그리드 — 버튼이 셀을 꽉 채워 클릭 영역 확보(작은 점은 미스클릭 유발) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3, width: 54 }}>
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
                      width: '100%', height: 16, borderRadius: 3,
                      background: isActive ? 'rgba(99, 102, 241, 0.6)' : 'rgba(255, 255, 255, 0.1)',
                      border: `1px solid ${isActive ? 'rgba(99, 102, 241, 0.8)' : 'rgba(255, 255, 255, 0.15)'}`,
                      cursor: 'pointer',
                    }}
                  />
                )
              })}
            </div>
            <div className="flex-1 grid grid-cols-2 gap-1">
              <NumInput
                label="X" unit="%" min={0} max={100}
                value={Math.round(px)}
                onChange={v => updateStyle('objectPosition', `${v}% ${Math.round(py)}%`)}
                onPreview={previewStyle && (v => previewStyle('objectPosition', `${v}% ${Math.round(py)}%`))}
              />
              <NumInput
                label="Y" unit="%" min={0} max={100}
                value={Math.round(py)}
                onChange={v => updateStyle('objectPosition', `${Math.round(px)}% ${v}%`)}
                onPreview={previewStyle && (v => previewStyle('objectPosition', `${Math.round(px)}% ${v}%`))}
              />
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

      <ImageChromaKey elementId={elementId} />
    </div>
  )
}

// 모듈 세션 동안 크로마키 원본 보존 (재조정/되돌리기용)
const _chromaOriginals = {}

// 이미지 배경 지우기(크로마키) — 색 기준 투명화
function ImageChromaKey({ elementId }) {
  const [keyColor, setKeyColor] = useState(null) // {r,g,b} | null(자동)
  const [tol, setTol] = useState(18)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const resolveSrc = async (content) =>
    BlobStore.isIdbRef(content) ? await BlobStore.getUrl(BlobStore.parseRef(content)) : content

  const apply = async () => {
    const el = useFlatStore.getState().flatElements.find(e => e.id === elementId)
    if (!el) return
    if (!_chromaOriginals[elementId]) _chromaOriginals[elementId] = el.content // 최초 원본 보존
    setBusy(true); setError('')
    try {
      const src = await resolveSrc(_chromaOriginals[elementId])
      const key = keyColor || await detectBgColor(src)
      setKeyColor(key)
      const out = await applyChromaKey(src, key, tol)
      useFlatStore.getState().updateFlatElement(elementId, { content: out })
    } catch (e) {
      setError(e?.message || '처리 실패 (외부 이미지는 불가)')
    } finally {
      setBusy(false)
    }
  }

  const revert = () => {
    const orig = _chromaOriginals[elementId]
    if (!orig) return
    useFlatStore.getState().updateFlatElement(elementId, { content: orig })
    delete _chromaOriginals[elementId]
    setKeyColor(null)
  }

  const pickColor = async () => {
    if (!window.EyeDropper) return
    try {
      const { sRGBHex } = await new window.EyeDropper().open()
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(sRGBHex)
      if (m) setKeyColor({ r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) })
    } catch { /* 취소 */ }
  }

  const keyHex = keyColor ? `rgb(${keyColor.r},${keyColor.g},${keyColor.b})` : 'transparent'
  return (
    <div className="border-t border-white/5 pt-2 space-y-1.5">
      <p className={labelClass}>배경 지우기 (크로마키)</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 w-9 shrink-0">제거색</span>
        <span className="w-5 h-5 rounded border border-white/20 shrink-0"
          style={{ background: keyColor ? keyHex : 'repeating-conic-gradient(#64748b 0% 25%, #334155 0% 50%) 50%/8px 8px' }}
          title={keyColor ? keyHex : '자동(모서리 색)'} />
        <button onClick={() => setKeyColor(null)} className="text-[10px] text-slate-400 hover:text-slate-200 px-1 py-0.5 rounded border border-white/10">자동</button>
        {window.EyeDropper && (
          <button onClick={pickColor} title="스포이드로 제거색 지정" className="text-sm px-1 rounded border border-white/10 hover:bg-white/10">💧</button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 w-9 shrink-0">허용</span>
        <input type="range" min="2" max="60" step="1" value={tol}
          onChange={e => setTol(Number(e.target.value))} className="flex-1" style={{ accentColor: '#6366f1' }} />
        <span className="text-[10px] text-slate-500 w-5 text-right">{tol}</span>
      </div>
      <div className="flex gap-1.5">
        <button onClick={apply} disabled={busy}
          className={`flex-1 py-1.5 rounded-lg text-xs border transition-colors ${
            busy ? 'bg-white/5 text-slate-500 border-white/10'
              : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/30'
          }`}>{busy ? '처리 중…' : '배경 지우기 적용'}</button>
        <button onClick={revert} disabled={busy || !_chromaOriginals[elementId]}
          className="px-2.5 py-1.5 rounded-lg text-xs text-slate-400 border border-white/10 hover:bg-white/10 disabled:opacity-40">되돌리기</button>
      </div>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
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
      {isText && (
        <div>
          <p className={`${labelClass} mb-0.5`}>외곽선</p>
          <TextStrokeEditor
            value={styles.textStroke || 'none'}
            onChange={v => updateStyle('textStroke', v)}
          />
        </div>
      )}
    </div>
  )
}

// ── 입력 헬퍼 ───────────────────────────────────────

function NumInput({ label, value, onChange, onPreview, unit = '', min, max, step = 1 }) {
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100))
  const prevValue = useRef(value)

  if (Math.abs(value - prevValue.current) > 0.001) {
    prevValue.current = value
    const rounded = String(Math.round(value * 100) / 100)
    if (local !== rounded) setLocal(rounded)
  }

  const clampVal = (n) =>
    min !== undefined && max !== undefined ? Math.min(max, Math.max(min, n))
      : min !== undefined ? Math.max(min, n)
      : max !== undefined ? Math.min(max, n) : n

  const commit = () => {
    const n = parseFloat(local)
    if (isNaN(n)) { setLocal(String(Math.round(value * 100) / 100)); return }
    onChange(clampVal(n))
  }

  const fmt = (v) => String(Math.round(v * 100) / 100)
  const scrub = useScrub({
    value, step, min, max,
    onPreview: (v) => { setLocal(fmt(v)); onPreview && onPreview(v) },
    onCommit: (v) => { setLocal(fmt(v)); onChange(v) },
  })

  return (
    <div>
      {label && (
        // 점선 밑줄 + ew-resize 커서로 드래그 가능함을 표시(일반 레이블과 구분)
        <p className={scrubLabelClass}
           title="드래그하여 조절" {...scrub}>{label}</p>
      )}
      <div className="flex items-center">
        <input
          type="text"
          inputMode="decimal"
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

function FontSizeInput({ value, onChange, onPreview }) {
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

  const scrub = useScrub({
    value, step: 1, min: 1,
    onPreview: (v) => { setLocal(String(Math.round(v))); onPreview && onPreview(v) },
    onCommit: (v) => { setLocal(String(Math.round(v))); onChange(v) },
  })

  return (
    <div>
      <p className={scrubLabelClass} title="드래그하여 조절" {...scrub}>크기</p>
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
          className={selectClass}
          style={{ ...selectStyle, width: 28, padding: '6px 2px' }}
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
        className={selectClass}
        style={selectStyle}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── B/I/U 토글 버튼 ─────────────────────────────────

/** 리스트 3-상태 토글 (없음 / 글머리 / 번호) — 요소·문단 레벨 */
function ListToggle({ value, onChange }) {
  const opts = [
    { v: 'none', glyph: '없음', title: '리스트 없음' },
    { v: 'ul', glyph: '•', title: '글머리 기호' },
    { v: 'ol', glyph: '1.', title: '번호 매기기' },
  ]
  return (
    <div>
      <p className={`${labelClass} mb-0.5`}>리스트</p>
      <div className="flex gap-1.5">
        {opts.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            title={o.title}
            className={[
              'flex-1 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center border',
              value === o.v
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
            ].join(' ')}
          >
            {o.glyph}
          </button>
        ))}
      </div>
    </div>
  )
}

function ToggleBtn({ active, mixed, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={mixed ? `${title || ''} — 혼합 (부분마다 다름)`.trim() : title}
      className={[
        'relative w-8 h-8 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center border',
        mixed
          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 border-dashed'
          : active
            ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
            : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10',
      ].join(' ')}
    >
      {children}
      {mixed && (
        <span
          className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400"
          aria-hidden="true"
        />
      )}
    </button>
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

// 텍스트 세로 정렬 아이콘 — 박스(프레임) 안의 텍스트 줄 위치(상/중/하)
function TextVAlignTopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="2" width="12" height="12" rx="1.5" opacity="0.45" />
      <line x1="4.5" y1="5" x2="11.5" y2="5" strokeWidth="1.6" />
      <line x1="4.5" y1="7.3" x2="9" y2="7.3" strokeWidth="1.6" />
    </svg>
  )
}
function TextVAlignMiddleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="2" width="12" height="12" rx="1.5" opacity="0.45" />
      <line x1="4.5" y1="6.85" x2="11.5" y2="6.85" strokeWidth="1.6" />
      <line x1="4.5" y1="9.15" x2="9" y2="9.15" strokeWidth="1.6" />
    </svg>
  )
}
function TextVAlignBottomIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="2" width="12" height="12" rx="1.5" opacity="0.45" />
      <line x1="4.5" y1="8.7" x2="11.5" y2="8.7" strokeWidth="1.6" />
      <line x1="4.5" y1="11" x2="9" y2="11" strokeWidth="1.6" />
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


// ── 투명도 전용 섹션 (video, svg, poly shape 등) ──

function OpacityOnlySection({ styles, updateStyle, previewStyle }) {
  return (
    <div className="space-y-2">
      <SectionTitle>
        투명도 <span className="text-slate-600 font-normal">{styles.opacity || '1'}</span>
      </SectionTitle>
      <input
        type="range" min="0" max="1" step="0.01"
        value={styles.opacity || '1'}
        onChange={e => previewStyle('opacity', e.target.value)}
        onMouseUp={e => updateStyle('opacity', e.target.value)}
        onTouchEnd={e => updateStyle('opacity', e.target.value)}
        className="w-full" style={{ accentColor: '#6366f1' }}
      />
    </div>
  )
}

// ── 포인트 기반 shape 섹션 (line, polyline, polygon) ──

function PolyShapeSection({ el, update, updateStyle, previewStyle }) {
  const isPolygon = el.closed || el.shapeType === 'polygon'
  const pointCount = el.points?.length || 0

  return (
    <div className="space-y-2">
      <SectionTitle>
        {el.shapeType === 'line' ? '선' : el.shapeType === 'polygon' || isPolygon ? '폴리곤' : '폴리라인'}
        <span className="text-slate-600 font-normal ml-1">({pointCount}개 점)</span>
      </SectionTitle>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className={`${labelClass} mb-0.5`}>선 색상</p>
          <ColorPicker
            value={el.styles?.stroke || '#1e293b'}
            onChange={v => updateStyle('stroke', v)}
          />
        </div>
        <NumInput
          label="선 굵기"
          value={parseFloat(el.styles?.strokeWidth || '2')}
          onChange={v => updateStyle('strokeWidth', `${v}`)}
          onPreview={previewStyle && (v => previewStyle('strokeWidth', `${v}`))}
          min={1} max={20}
        />
      </div>

      {/* 선 스타일 */}
      <div>
        <p className={`${labelClass} mb-0.5`}>스타일</p>
        <div className="flex gap-1">
          {[
            { id: '', label: '───' },
            { id: '8,4', label: '- - -' },
            { id: '2,4', label: '· · ·' },
          ].map(s => (
            <button
              key={s.id}
              onClick={() => updateStyle('strokeDasharray', s.id)}
              className={`flex-1 text-xs py-1 rounded-md border transition-colors ${
                (el.styles?.strokeDasharray || '') === s.id
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
              }`}
            >{s.label}</button>
          ))}
        </div>
      </div>

      {/* 화살표 (닫힌 도형이 아닐 때) */}
      {!el.closed && (
        <div className="space-y-1.5">
          <p className={labelClass}>끝 모양</p>
          <div className="grid grid-cols-2 gap-2">
            <ArrowSelect label="시작" value={el.startArrow || 'none'} onChange={v => update({ startArrow: v })} />
            <ArrowSelect label="끝" value={el.endArrow || 'none'} onChange={v => update({ endArrow: v })} />
          </div>
        </div>
      )}

      {/* 라우팅 + 라벨 (커넥터만) */}
      {el.shapeType === 'connector' && (
        <>
          <div>
            <p className={`${labelClass} mb-0.5`}>모양</p>
            <div className="flex gap-1">
              {[
                { id: 'straight', label: '직선' },
                { id: 'curved', label: '곡선' },
              ].map(r => (
                <button
                  key={r.id}
                  onClick={() => update({ routing: r.id })}
                  className={`flex-1 text-xs py-1 rounded-md border transition-colors ${
                    (el.routing || 'straight') === r.id
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
                  }`}
                >{r.label}</button>
              ))}
            </div>
          </div>
          <div>
            <p className={`${labelClass} mb-0.5`}>라벨</p>
            <input
              type="text"
              value={el.content || ''}
              onChange={e => update({ content: e.target.value })}
              placeholder="가운데 표시될 텍스트"
              className="w-full text-xs px-2 py-1 rounded-md bg-white/5 text-slate-200 border border-white/10 focus:border-indigo-500/40 outline-none"
            />
          </div>
        </>
      )}

      {/* 채우기 (폴리곤만) */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <p className={labelClass}>닫힌 도형</p>
          <button
            onClick={() => update({ closed: !el.closed, shapeType: !el.closed ? 'polygon' : 'polyline' })}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              el.closed
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
            }`}
          >{el.closed ? 'ON' : 'OFF'}</button>
        </div>
        {el.closed && (
          <div className="mt-1 space-y-2">
            <p className={`${labelClass} mb-0.5`}>채우기</p>
            <ColorPicker
              value={el.styles?.fill || 'none'}
              onChange={v => updateStyle('fill', v)}
              showOpacity
            />
          </div>
        )}
      </div>

      {/* 투명도 */}
      <div>
        <p className={`${labelClass} mb-0.5`}>
          투명도 <span className="text-slate-600">{el.styles?.opacity || '1'}</span>
        </p>
        <input
          type="range" min="0" max="1" step="0.01"
          value={el.styles?.opacity || '1'}
          onChange={e => updateStyle('opacity', e.target.value)}
          className="w-full" style={{ accentColor: '#6366f1' }}
        />
      </div>
    </div>
  )
}

// '화살표'(열린 V)는 두꺼운 선에서 채운 삼각형처럼 보여 어색 → 선택 옵션에서 제외.
// (기존/임포트 데이터의 'arrow' 값은 렌더러가 계속 지원)
const ARROW_OPTIONS = [
  { id: 'none', label: '없음', icon: '─' },
  { id: 'triangle', label: '삼각형', icon: '▶' },
  { id: 'circle', label: '원', icon: '●' },
  { id: 'diamond', label: '다이아', icon: '◆' },
]

function ArrowSelect({ label, value, onChange }) {
  return (
    <div>
      <p className={`${labelClass} mb-0.5`}>{label}</p>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={selectClass}
        style={selectStyle}
      >
        {ARROW_OPTIONS.map(o => (
          <option key={o.id} value={o.id}>{o.icon} {o.label}</option>
        ))}
      </select>
    </div>
  )
}

// ── 선 전용 섹션 (shape 중 width 또는 height가 4px 이하) ──

function ShapeLineSection({ el, update, updateStyle, preview }) {
  const isHorizontal = el.height <= 4
  const thickness = isHorizontal ? el.height : el.width
  const length = isHorizontal ? el.width : el.height
  const color = el.styles?.backgroundColor || '#94a3b8'

  const thicknessChange = (val, fn) => (isHorizontal ? fn({ height: val }) : fn({ width: val }))
  const lengthChange = (val, fn) => (isHorizontal ? fn({ width: val }) : fn({ height: val }))

  const setThickness = (v) => thicknessChange(Math.max(1, Math.min(20, Number(v) || 1)), update)
  const setLength = (v) => lengthChange(Math.max(10, Number(v) || 100), update)
  const previewThickness = (v) => preview && thicknessChange(Math.max(1, Math.min(20, Number(v) || 1)), preview)
  const previewLength = (v) => preview && lengthChange(Math.max(10, Number(v) || 100), preview)

  const setDash = (v) => {
    if (v === 'solid') {
      updateStyle('borderTop', '')
      updateStyle('backgroundImage', 'none')
    } else {
      // 점선 효과: 배경 repeating-linear-gradient로 구현
      const gap = v === 'dashed' ? 10 : 4
      const dir = isHorizontal ? '90deg' : '0deg'
      updateStyle('backgroundColor', 'transparent')
      updateStyle('backgroundImage',
        `repeating-linear-gradient(${dir}, ${color} 0px, ${color} ${gap}px, transparent ${gap}px, transparent ${gap * 2}px)`)
    }
  }

  // 현재 점선 상태 감지
  const bgImg = el.styles?.backgroundImage || ''
  const isDashed = bgImg.includes('repeating-linear-gradient')
  const currentDash = isDashed
    ? (bgImg.includes('4px') ? 'dotted' : 'dashed')
    : 'solid'

  return (
    <div className="space-y-2">
      <SectionTitle>선</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <NumInput
          label="두께" value={thickness} min={1} max={20}
          onChange={setThickness} onPreview={previewThickness}
        />
        <NumInput
          label="길이" value={Math.round(length)} min={10}
          onChange={setLength} onPreview={previewLength}
        />
      </div>
      <div>
        <p className={`${labelClass} mb-0.5`}>색상</p>
        <ColorPicker
          value={color}
          onChange={v => updateStyle('backgroundColor', v)}
          showOpacity
        />
      </div>
      <div>
        <p className={`${labelClass} mb-0.5`}>스타일</p>
        <div className="flex gap-1">
          {[
            { id: 'solid', label: '───' },
            { id: 'dashed', label: '- - -' },
            { id: 'dotted', label: '· · ·' },
          ].map(s => (
            <button
              key={s.id}
              onClick={() => setDash(s.id)}
              className={`flex-1 text-xs py-1 rounded-md border transition-colors ${
                currentDash === s.id
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'
              }`}
            >{s.label}</button>
          ))}
        </div>
      </div>
      <div>
        <p className={`${labelClass} mb-0.5`}>
          회전 <span className="text-slate-600">{el.rotation || 0}°</span>
        </p>
        <input
          type="range"
          min="0" max="360" step="1"
          value={el.rotation || 0}
          onChange={e => update({ rotation: Number(e.target.value) })}
          className="w-full"
          style={{ accentColor: '#6366f1' }}
        />
      </div>
    </div>
  )
}

// ── 영상 섹션 ──

function TableSection({ el, update, updateStyle }) {
  const t = el.table
  // 편집 중 패널 조작 시 클로저의 stale table 대신 스토어 최신 table을 읽어 변형
  // (셀 편집기의 바깥-클릭 커밋이 mousedown 단계에서 먼저 반영되므로 안전)
  const applyTable = (mutator) => {
    const cur = useFlatStore.getState().flatElements.find(e => e.id === el.id)
    if (!cur || !cur.table) return
    update({ table: mutator(cur.table) })
  }
  const borderColor = (t.border && t.border.color) || '#cbd5e1'
  const borderWidth = (t.border && t.border.width) ?? 1

  const miniBtn = 'flex-1 text-xs px-2 py-1 rounded bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="space-y-2.5">
      <SectionTitle>표 ({t.rows}×{t.cols})</SectionTitle>

      <div>
        <p className={`${labelClass} mb-0.5`}>행</p>
        <div className="flex gap-1">
          <button className={miniBtn} onClick={() => applyTable(tb => addRow(tb))}>+ 행 추가</button>
          <button className={miniBtn} onClick={() => applyTable(tb => removeRow(tb, tb.rows - 1))} disabled={t.rows <= 1}>− 행 삭제</button>
        </div>
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>열</p>
        <div className="flex gap-1">
          <button className={miniBtn} onClick={() => applyTable(tb => addCol(tb))}>+ 열 추가</button>
          <button className={miniBtn} onClick={() => applyTable(tb => removeCol(tb, tb.cols - 1))} disabled={t.cols <= 1}>− 열 삭제</button>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={!!t.headerRow}
          onChange={(e) => applyTable(tb => setHeaderRow(tb, e.target.checked))}
          className="accent-indigo-500"
        />
        <span className="text-xs text-slate-300">첫 행을 헤더로</span>
      </label>

      <div>
        <p className={`${labelClass} mb-0.5`}>테두리 색</p>
        <ColorPicker value={borderColor} onChange={v => applyTable(tb => setBorder(tb, { color: v }))} />
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>테두리 두께 ({borderWidth}px)</p>
        <input
          type="range" min="0" max="6" step="1" value={borderWidth}
          onChange={(e) => applyTable(tb => setBorder(tb, { width: parseInt(e.target.value, 10) }))}
          className="w-full accent-indigo-500"
        />
      </div>

      <div>
        <p className={`${labelClass} mb-0.5`}>글자 색</p>
        <ColorPicker value={el.styles.color} onChange={v => updateStyle('color', v)} />
      </div>
    </div>
  )
}

function VideoSection({ el, update }) {
  const autoplay = el.autoplay ?? false
  const loop = el.loop ?? false
  const muted = el.muted ?? true
  const hideControls = el.hideControls ?? false

  return (
    <div className="space-y-2">
      <SectionTitle>영상 옵션</SectionTitle>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoplay}
          onChange={e => update({ autoplay: e.target.checked })}
          className="accent-indigo-500"
        />
        <span className={labelClass}>자동 재생</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={loop}
          onChange={e => update({ loop: e.target.checked })}
          className="accent-indigo-500"
        />
        <span className={labelClass}>반복 재생</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={muted}
          onChange={e => update({ muted: e.target.checked })}
          className="accent-indigo-500"
        />
        <span className={labelClass}>음소거</span>
      </label>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={hideControls}
          onChange={e => update({ hideControls: e.target.checked })}
          className="accent-indigo-500"
        />
        <span className={labelClass}>컨트롤 숨기기 (발표 화면)</span>
      </label>
    </div>
  )
}

// ── 잠금 아이콘 ──

function LockClosedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function LockOpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )
}


// ── 슬라이드 배경 패널 (선택 없을 때 표시) ──

const BG_DEFAULT_STYLES = {
  backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
  borderRadius: '0px', border: '0px none',
  borderTop: '0px none', borderRight: '0px none',
  borderBottom: '0px none', borderLeft: '0px none',
  boxShadow: 'none', opacity: '1', padding: '0px',
}

// AI 슬라이드 배경 생성 — 스타일 프리셋 + 주제 → generateImage(16:9) → 배경 적용
function AiBackgroundSection({ onApply }) {
  const [styleId, setStyleId] = useState(DEFAULT_BACKGROUND_STYLE_ID)
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [pickOpen, setPickOpen] = useState(false)
  const pickRef = useRef(null)

  useEffect(() => {
    if (!pickOpen) return
    const onDown = (e) => { if (pickRef.current && !pickRef.current.contains(e.target)) setPickOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [pickOpen])

  const generate = async () => {
    if (!hasApiKey()) { openAiSettings(); return }
    const style = BACKGROUND_STYLES.find(s => s.id === styleId)
    setStatus('loading'); setError('')
    try {
      const dataUrl = await generateImage(buildBackgroundPrompt(style, prompt), { width: 1280, height: 720 })
      onApply(dataUrl)
      setStatus('idle')
    } catch (e) {
      setError(e?.message || '생성 실패')
      setStatus('idle')
    }
  }

  const loading = status === 'loading'
  const sel = getBackgroundStyle(styleId)
  return (
    <div className="border-t border-white/5 pt-3 space-y-2">
      <SectionTitle>AI 배경 생성</SectionTitle>
      {/* 커스텀 드롭다운 — 섹션 구분 + 항목별 설명 + 기존 thin-scrollbar 적용 */}
      <div ref={pickRef} className="relative">
        <button
          type="button"
          onClick={() => !loading && setPickOpen(o => !o)}
          disabled={loading}
          className={`${selectClass} flex items-center justify-between text-left`}
          style={selectStyle}
        >
          <span className="truncate">{sel.label}</span>
          <span className="text-slate-500 ml-1 shrink-0">▾</span>
        </button>
        {pickOpen && (
          <div
            className="thin-scrollbar absolute left-0 right-0 mt-1 z-[10060] rounded-lg border border-white/10 shadow-xl overflow-y-auto"
            style={{ maxHeight: 260, backgroundColor: '#1e293b' }}
          >
            {BACKGROUND_GROUPS.map(g => (
              <div key={g}>
                <p className="px-2.5 pt-2 pb-1 text-[9px] uppercase tracking-wide text-slate-500">{g}</p>
                {BACKGROUND_STYLES.filter(s => s.group === g).map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setStyleId(s.id); setPickOpen(false) }}
                    className={`w-full text-left px-2.5 py-1.5 transition-colors ${
                      s.id === styleId ? 'bg-indigo-500/20' : 'hover:bg-white/5'
                    }`}
                  >
                    <span className={`block text-xs ${s.id === styleId ? 'text-indigo-200' : 'text-slate-200'}`}>{s.label}</span>
                    <span className="block text-[10px] text-slate-500">{s.desc}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {/* 닫혀 있을 때도 선택 스타일 설명 노출 */}
      <p className="text-[10px] text-slate-500">{sel.desc}</p>
      <input
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
        placeholder="주제(선택): 예) 우주, 핀테크, 봄"
        className={inputClass}
        disabled={loading}
      />
      <button
        onClick={generate}
        disabled={loading}
        className={`w-full py-1.5 rounded-lg text-xs border transition-colors ${
          loading ? 'bg-white/5 text-slate-500 border-white/10'
            : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30 hover:bg-indigo-500/30'
        }`}
      >{loading ? '생성 중…' : '✨ AI 배경 생성'}</button>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <p className="text-[9px] text-slate-600">한 장 생성(비용 발생). 텍스트 자리를 비운 16:9 배경입니다.</p>
    </div>
  )
}

// 요소 애니메이션 탭 — 효과·방향·시간·트리거 지정. (발표 모드/미리보기에서 재생)
const TRIGGER_MODES = [['click', '클릭 시'], ['after', '다음에'], ['with', '동시에']]
const DIRS = [['up', '↑'], ['down', '↓'], ['left', '←'], ['right', '→']]
function effectLabel(id) { return (EFFECTS.find(e => e.id === id) || {}).label || id }
function shortDesc(el) {
  if (el.type === 'text') {
    const t = (el.md || el.code || el.content || '').replace(/<[^>]+>/g, '').trim()
    return t ? t.slice(0, 12) : '텍스트'
  }
  return { image: '이미지', shape: '도형', video: '영상', table: '표', svg: 'SVG' }[el.type] || el.type
}
function AnimationTab({ el }) {
  const flatElements = useFlatStore(s => s.flatElements)
  const setEl = (anim) => useFlatStore.getState().updateFlatElement(el.id, { anim })
  const anim = el.anim || null
  const effect = anim?.effect || 'none'
  const hasAnim = effect !== 'none'

  const setEffect = (eff) => {
    if (eff === 'none') { setEl(undefined); return }
    if (!hasAnim) {
      const maxSeq = Math.max(0, ...flatElements.filter(e => e.anim?.seq != null).map(e => e.anim.seq))
      setEl({ effect: eff, durationMs: 500, delayMs: 0, trigger: { mode: 'click', ref: null }, seq: maxSeq + 1, dir: 'left' })
    } else {
      setEl({ ...anim, effect: eff })
    }
  }
  const patch = (changes) => setEl({ ...anim, ...changes })

  // 트리거 대상 후보: 나 외 애니메이션 요소(작성 순)
  const targets = flatElements
    .filter(e => e.id !== el.id && e.anim?.effect && e.anim.effect !== 'none')
    .sort((a, b) => (a.anim.seq || 0) - (b.anim.seq || 0))

  const setMode = (mode) => {
    if (mode === 'click') { patch({ trigger: { mode: 'click', ref: null } }); return }
    const ref = anim.trigger?.ref && targets.some(t => t.id === anim.trigger.ref)
      ? anim.trigger.ref : (targets[targets.length - 1]?.id || null)
    patch({ trigger: { mode, ref } })
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => useFlatStore.getState().playAnimPreview()}
        className="w-full text-xs py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-colors"
        title="이 슬라이드의 애니메이션을 순서대로 미리 재생"
      >▶ 슬라이드 애니메이션 미리보기</button>
      <div>
        <p className={`${labelClass} mb-0.5`}>효과</p>
        <select value={effect} onChange={e => setEffect(e.target.value)} className={selectClass} style={selectStyle}>
          <option value="none">없음</option>
          <optgroup label="등장">
            {EFFECTS.filter(e => e.kind === 'enter').map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </optgroup>
          <optgroup label="퇴장">
            {EFFECTS.filter(e => e.kind === 'exit').map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
          </optgroup>
        </select>
      </div>

      {hasAnim && (
        <>
          {effectHasDir(effect) && (
            <div>
              <p className={`${labelClass} mb-0.5`}>방향</p>
              <div className="grid grid-cols-4 gap-1">
                {DIRS.map(([d, label]) => (
                  <button key={d} onClick={() => patch({ dir: d })}
                    className={`text-xs py-1 rounded border transition-colors ${
                      (anim.dir || 'left') === d ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                        : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
                  >{label}</button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <NumInput label="시간" unit="ms" min={50} max={5000} step={50}
              value={anim.durationMs || 500} onChange={v => patch({ durationMs: v })} />
            <NumInput label="지연" unit="ms" min={0} max={5000} step={50}
              value={anim.delayMs || 0} onChange={v => patch({ delayMs: v })} />
          </div>

          <div>
            <p className={`${labelClass} mb-0.5`}>시작</p>
            <div className="grid grid-cols-3 gap-1">
              {TRIGGER_MODES.map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`text-xs py-1 rounded border transition-colors ${
                    (anim.trigger?.mode || 'click') === m ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
                >{label}</button>
              ))}
            </div>
            {(anim.trigger?.mode === 'after' || anim.trigger?.mode === 'with') && (
              <div className="mt-1.5">
                <p className={`${labelClass} mb-0.5`}>대상 애니메이션</p>
                {targets.length === 0 ? (
                  <p className="text-[10px] text-slate-600">대상이 없습니다 — 다른 요소에 먼저 애니메이션을 추가하세요.</p>
                ) : (
                  <select value={anim.trigger.ref || ''} onChange={e => patch({ trigger: { ...anim.trigger, ref: e.target.value } })}
                    className={selectClass} style={selectStyle}>
                    {targets.map((t, i) => (
                      <option key={t.id} value={t.id}>{i + 1}. {effectLabel(t.anim.effect)} — {shortDesc(t)}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          <p className="text-[10px] text-slate-600">발표 모드에서 클릭(또는 ←/→)으로 단계 진행됩니다. 캔버스의 번호는 진행 순서입니다.</p>
        </>
      )}
    </div>
  )
}

// 슬라이드 전환 — 현재 슬라이드별 개별 지정. 발표 모드에서 들어올 때 적용.
const TRANSITION_TYPES = [['none', '없음'], ['fade', '페이드'], ['slide', '슬라이드'], ['zoom', '줌']]
function SlideTransitionSection() {
  const t = useFlatStore(s => s.pageTransition)
  const setT = useFlatStore(s => s.setPageTransition)
  const type = t?.type || 'none'
  const dur = t?.durationMs || 400
  const dir = t?.dir || 'right'
  const setType = (v) => setT(v === 'none' ? null : { type: v, durationMs: dur, ...(v === 'slide' ? { dir } : {}) })
  return (
    <div className="space-y-1.5">
      <SectionTitle>슬라이드 전환</SectionTitle>
      <div className="grid grid-cols-4 gap-1">
        {TRANSITION_TYPES.map(([v, label]) => (
          <button key={v} onClick={() => setType(v)} onMouseDown={e => e.preventDefault()}
            className={`text-xs px-1 py-1 rounded border transition-colors ${
              type === v ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
          >{label}</button>
        ))}
      </div>
      {type === 'slide' && (
        <div>
          <p className={`${labelClass} mb-0.5`}>방향(들어오는 쪽)</p>
          <div className="grid grid-cols-4 gap-1">
            {DIRS.map(([d, label]) => (
              <button key={d} onClick={() => setT({ type, durationMs: dur, dir: d })} onMouseDown={e => e.preventDefault()}
                className={`text-xs py-1 rounded border transition-colors ${
                  dir === d ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:bg-white/10'}`}
              >{label}</button>
            ))}
          </div>
        </div>
      )}
      {type !== 'none' && (
        <NumInput label="시간" unit="ms" min={50} max={3000} step={50}
          value={dur} onChange={(v) => setT({ type, durationMs: v, ...(type === 'slide' ? { dir } : {}) })} />
      )}
    </div>
  )
}

function SlideBackgroundPanel() {
  const { flatElements, canvasSize, updateFlatElement, previewFlatElement,
          addFlatElement, removeFlatElement } = useFlatStore()
  const [activeLayer, setActiveLayer] = useState(0)
  const listRef = useRef(null)
  // 드래그 재정렬 상태: { id, order }(order = 화면 표시 순서 = 앞→뒤 id 배열)
  const [drag, setDrag] = useState(null)

  // 모든 배경 레이어 찾기 — 표시 순서는 z-index 내림차순(맨 위 = 가장 앞, 디자인 툴 관례).
  const bgLayers = flatElements
    .filter(el => isBackgroundElement(el, canvasSize))
    .sort((a, b) => b.zIndex - a.zIndex)

  // 드래그 중에는 로컬 order로, 아니면 실제 z-순서로 렌더
  const displayLayers = drag
    ? drag.order.map(id => bgLayers.find(e => e.id === id)).filter(Boolean)
    : bgLayers

  // 레이어 추가
  const addLayer = useCallback(() => {
    const minZ = flatElements.length > 0
      ? Math.min(...flatElements.map(e => e.zIndex)) - 1 : 0
    // 기존 배경 최상위 z보다 위에, 콘텐츠 최하위보다 아래
    const bgMaxZ = bgLayers.length > 0
      ? Math.max(...bgLayers.map(e => e.zIndex)) : minZ
    const newEl = {
      id: nextFlatId(), sourceId: '__bg',
      type: 'shape', content: '', isRich: false, merged: false,
      isBackground: true, // 명시 배경 플래그(크기 추론 제거 후 필수)
      x: 0, y: 0, width: canvasSize.w, height: canvasSize.h,
      zIndex: bgMaxZ + 1,
      locked: true,
      styles: { ...BG_DEFAULT_STYLES, backgroundColor: 'rgba(0,0,0,0)' },
    }
    addFlatElement(newEl)
    setActiveLayer(0) // 새 레이어는 최상위 z → 목록 맨 위(idx 0)
  }, [flatElements, bgLayers, canvasSize, addFlatElement])

  // ── 드래그 재정렬 (포인터 기반 — 마우스+터치) ──
  const beginDrag = useCallback((e, id) => {
    e.stopPropagation()
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ id, order: bgLayers.map(b => b.id) })
  }, [bgLayers])

  const moveDrag = useCallback((e) => {
    setDrag(prev => {
      if (!prev) return prev
      const rows = listRef.current ? Array.from(listRef.current.children) : []
      const y = e.clientY
      // 포인터가 지나친 행 수 = 삽입 위치(행 중앙선 기준)
      let target = rows.length
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect()
        if (y < r.top + r.height / 2) { target = i; break }
      }
      const without = prev.order.filter(id => id !== prev.id)
      const cur = prev.order.indexOf(prev.id)
      let insert = cur < target ? target - 1 : target // 끌던 항목 제거로 인한 인덱스 보정
      insert = Math.max(0, Math.min(insert, without.length))
      without.splice(insert, 0, prev.id)
      return without.join() === prev.order.join() ? prev : { id: prev.id, order: without }
    })
  }, [])

  const endDrag = useCallback((e) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (drag) {
      // order는 앞→뒤(z 내림차순). store는 뒤→앞(z 오름차순)을 받음.
      useFlatStore.getState().setBackgroundOrder([...drag.order].reverse())
      setActiveLayer(drag.order.indexOf(drag.id)) // 끌어놓은 레이어를 계속 선택
    }
    setDrag(null)
  }, [drag])

  // 레이어 삭제 (0개까지 허용 — 배경 없음=투명/흰 캔버스)
  const removeLayer = useCallback((idx) => {
    if (!bgLayers[idx]) return
    removeFlatElement(bgLayers[idx].id)
    setActiveLayer(Math.max(0, Math.min(idx, bgLayers.length - 2)))
  }, [bgLayers, removeFlatElement])

  // 활성 레이어 범위 보정
  const safeIdx = Math.min(activeLayer, Math.max(bgLayers.length - 1, 0))
  const currentBg = bgLayers[safeIdx]

  const updateStyle = useCallback((key, value) => {
    if (!currentBg) return
    updateFlatElement(currentBg.id, { styles: { [key]: value } })
  }, [currentBg, updateFlatElement])

  const updateStyles = useCallback((changes) => {
    if (!currentBg) return
    updateFlatElement(currentBg.id, { styles: changes })
  }, [currentBg, updateFlatElement])

  const previewStyle = useCallback((key, value) => {
    if (!currentBg) return
    previewFlatElement(currentBg.id, { styles: { [key]: value } })
  }, [currentBg, previewFlatElement])

  // 배경 이미지 적용(AI 생성·파일 선택 공용) — 이미지 '요소' 배경으로 만든다.
  // (CSS backgroundImage를 입힌 shape이 아니라 type:'image' 요소 → 변환된 이미지 배경과
  //  동일한 미디어 속성창: 썸네일·맞춤·투명도·이미지 교체·일반 요소로 복원)
  const applyBgImage = useCallback((dataUrl) => {
    if (currentBg) {
      // 현재 배경을 이미지 요소로 전환(맞춤=cover). shape의 CSS 배경 흔적 제거.
      updateFlatElement(currentBg.id, {
        type: 'image', content: dataUrl, isRich: false,
        styles: { ...(currentBg.styles || {}), backgroundImage: 'none', backgroundColor: 'rgba(0,0,0,0)', objectFit: 'cover' },
      })
    } else {
      const minZ = flatElements.length > 0 ? Math.min(...flatElements.map(e => e.zIndex)) - 1 : 0
      addFlatElement({
        id: nextFlatId(), sourceId: '__bg', type: 'image', content: dataUrl, isRich: false, merged: false,
        isBackground: true,
        x: 0, y: 0, width: canvasSize.w, height: canvasSize.h, zIndex: minZ, locked: true,
        styles: { ...BG_DEFAULT_STYLES, objectFit: 'cover' },
      })
    }
  }, [currentBg, updateFlatElement, flatElements, canvasSize, addFlatElement])

  // 레이어 미리보기 색상 (썸네일용)
  const layerPreviewStyle = (el) => {
    // 이미지/영상 요소 배경: content가 곧 소스 (CSS backgroundImage가 아님)
    if (el.type === 'image' && el.content) {
      return { backgroundImage: `url("${el.content}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    }
    if (el.type === 'video') {
      return { backgroundColor: '#1e293b' } // 영상 프레임은 못 그리므로 어두운 스와치
    }
    const s = el.styles || {}
    const bg = s.backgroundColor || 'transparent'
    const bgImg = s.backgroundImage
    if (bgImg && bgImg !== 'none') {
      if (bgImg.startsWith('url(')) return { backgroundImage: bgImg, backgroundSize: 'cover' }
      return { backgroundImage: bgImg }
    }
    return { backgroundColor: bg }
  }

  const layerLabel = (el) => {
    if (el.type === 'image') return `이미지`
    if (el.type === 'video') return `영상`
    const s = el.styles || {}
    if (s.backgroundImage?.startsWith('url(')) return `이미지`
    if (s.backgroundImage?.includes('gradient')) return `그래디언트`
    const bg = s.backgroundColor || ''
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return `단색`
    return `투명`
  }

  // 이미지/영상 '요소' 배경 — 전용 디테일 패널(썸네일/맞춤/교체) 사용
  const isMediaEl = (el) => el.type === 'image' || el.type === 'video'
  // 일반 요소로 변환 가능한 배경: 이미지/영상 요소 또는 이미지가 설정된 shape 배경
  // (어떤 경로로 만든 이미지 배경이든 목록/패널에서 일관되게 변환 가능)
  const canRestore = (el) => isMediaEl(el) || !!el.styles?.backgroundImage?.startsWith('url(')

  const styles = currentBg?.styles || BG_DEFAULT_STYLES
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

      {/* 스크롤은 패널 셸(DockedShell/FloatingShell)이 담당 — 내부 overflow를 두면 스크롤바가 중첩됨 */}
      <div className="p-3 space-y-3">

        {/* ── 슬라이드 전환 ── */}
        <SlideTransitionSection />

        {/* ── 레이어 목록 ── */}
        <div className="space-y-1.5 pt-3 border-t border-white/5">
          <div className="flex items-center justify-between">
            <SectionTitle>배경 레이어</SectionTitle>
            <button
              onClick={addLayer}
              className="text-xs text-indigo-400 hover:text-indigo-300 px-1"
              title="레이어 추가"
            >+ 추가</button>
          </div>

          {bgLayers.length > 1 && (
            <p className="text-[10px] text-slate-600">맨 위가 가장 앞(앞쪽) · 손잡이를 끌어 순서 변경</p>
          )}
          <div className="space-y-1" ref={listRef}>
            {displayLayers.map((el) => {
              const idx = bgLayers.indexOf(el) // 실제 z-순서 기준 인덱스(선택/삭제용)
              const dragging = drag?.id === el.id
              return (
              <div
                key={el.id}
                onClick={() => setActiveLayer(idx)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  idx === safeIdx
                    ? 'bg-indigo-500/20 border border-indigo-500/30'
                    : 'bg-white/5 border border-transparent hover:bg-white/10'
                } ${dragging ? 'opacity-60 ring-1 ring-indigo-400/50' : ''}`}
              >
                {bgLayers.length > 1 && (
                  <button
                    onPointerDown={(e) => beginDrag(e, el.id)}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onClick={(e) => e.stopPropagation()}
                    className="text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing px-0.5 -ml-0.5 leading-none"
                    style={{ touchAction: 'none' }}
                    title="끌어서 순서 변경"
                  >⠿</button>
                )}
                {/* 미리보기 썸네일 */}
                <div style={{
                  width: 28, height: 18, borderRadius: 3, flexShrink: 0,
                  border: '1px solid rgba(255,255,255,0.15)',
                  ...layerPreviewStyle(el),
                }} />
                <span className="text-xs text-slate-300 flex-1">
                  {layerLabel(el)}
                </span>
                {canRestore(el) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); useFlatStore.getState().restoreBackgroundToNormal(el.id) }}
                    className="text-xs text-slate-400 hover:text-indigo-300 px-0.5"
                    title="일반 요소로 복원"
                  >↩</button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeLayer(idx) }}
                  className="text-xs text-slate-600 hover:text-red-400 px-0.5"
                  title="레이어 삭제"
                >&times;</button>
              </div>
              )
            })}
          </div>

          {bgLayers.length === 0 && (
            <button
              onClick={addLayer}
              className="w-full py-2 rounded-lg text-xs text-slate-400 border border-dashed border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
            >배경 레이어 추가</button>
          )}
        </div>

        {/* ── AI 배경 생성 ── */}
        <AiBackgroundSection onApply={applyBgImage} />

        {/* ── 선택된 레이어 편집 (이미지/영상 요소 배경) ── */}
        {currentBg && isMediaEl(currentBg) && (
          <div className="border-t border-white/5 pt-3 space-y-3">
            {/* 미디어 미리보기 */}
            <div className="space-y-1.5">
              <p className={labelClass}>{currentBg.type === 'video' ? '배경 영상' : '배경 이미지'}</p>
              {currentBg.type === 'image' && currentBg.content ? (
                <div style={{
                  width: '100%', height: 60, borderRadius: 4,
                  backgroundImage: `url("${currentBg.content}")`,
                  backgroundSize: 'cover', backgroundPosition: 'center',
                  border: '1px solid rgba(255,255,255,0.1)',
                }} />
              ) : (
                <div style={{
                  width: '100%', height: 60, borderRadius: 4, background: '#1e293b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#64748b', fontSize: 12, border: '1px solid rgba(255,255,255,0.1)',
                }}>🎬 영상 배경</div>
              )}
            </div>

            {/* 맞춤 (이미지만 — 영상은 항상 cover) */}
            {currentBg.type === 'image' && (
              <div className="space-y-1.5">
                <p className={labelClass}>맞춤</p>
                <select
                  value={styles.objectFit || 'cover'}
                  onChange={e => updateStyle('objectFit', e.target.value)}
                  className="w-full px-2 py-1 rounded-md text-xs text-slate-200 border border-white/10"
                  style={selectStyle}
                >
                  <option value="cover">채우기 (cover)</option>
                  <option value="contain">맞추기 (contain)</option>
                  <option value="fill">늘이기 (fill)</option>
                </select>
              </div>
            )}

            {/* 투명도 */}
            <div className="space-y-1.5">
              <p className={labelClass}>
                투명도 <span className="text-slate-600">{styles.opacity || '1'}</span>
              </p>
              <input
                type="range" min="0" max="1" step="0.01"
                value={styles.opacity || '1'}
                onChange={e => previewStyle('opacity', e.target.value)}
                onMouseUp={e => updateStyle('opacity', e.target.value)}
                onTouchEnd={e => updateStyle('opacity', e.target.value)}
                className="w-full" style={{ accentColor: '#6366f1' }}
              />
            </div>

            {/* 이미지 교체 (이미지만) */}
            {currentBg.type === 'image' && (
              <label className="flex items-center justify-center gap-1 w-full py-1.5 rounded-lg text-xs text-slate-400 border border-dashed border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 cursor-pointer transition-colors">
                <span>이미지 교체</span>
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = (ev) => updateFlatElement(currentBg.id, { content: ev.target.result })
                  reader.readAsDataURL(file)
                  e.target.value = ''
                }} />
              </label>
            )}

            <button
              onClick={() => useFlatStore.getState().restoreBackgroundToNormal(currentBg.id)}
              className="w-full py-1.5 rounded-lg text-xs text-slate-400 border border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
            >일반 요소로 복원</button>
          </div>
        )}

        {/* ── 선택된 레이어 편집 (shape 배경) ── */}
        {currentBg && !isMediaEl(currentBg) && (
          <>
            <div className="border-t border-white/5 pt-3 space-y-3">
              {/* 배경색 */}
              <div className="space-y-1.5">
                <p className={labelClass}>배경색</p>
                <div style={hasGradient ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
                  <ColorPicker
                    value={styles.backgroundColor || 'rgba(0,0,0,0)'}
                    onChange={v => updateStyle('backgroundColor', v)}
                    showOpacity
                  />
                </div>
              </div>

              {/* 그래디언트 */}
              <div className="space-y-1.5">
                <p className={labelClass}>그래디언트</p>
                <GradientEditor
                  value={hasGradient ? styles.backgroundImage : 'none'}
                  onChange={v => updateStyle('backgroundImage', v)}
                />
              </div>

              {/* 투명도 */}
              <div className="space-y-1.5">
                <p className={labelClass}>
                  투명도 <span className="text-slate-600">{styles.opacity || '1'}</span>
                </p>
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={styles.opacity || '1'}
                  onChange={e => previewStyle('opacity', e.target.value)}
                  onMouseUp={e => updateStyle('opacity', e.target.value)}
                  onTouchEnd={e => updateStyle('opacity', e.target.value)}
                  className="w-full" style={{ accentColor: '#6366f1' }}
                />
              </div>

              {/* 배경 이미지 */}
              <div className="space-y-1.5">
                <p className={labelClass}>배경 이미지</p>
                {styles.backgroundImage?.startsWith('url(') && (
                  <div className="mb-1.5">
                    <div style={{
                      width: '100%', height: 60, borderRadius: 4,
                      backgroundImage: styles.backgroundImage,
                      backgroundSize: 'cover', backgroundPosition: 'center',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }} />
                    <button
                      onClick={() => updateStyles({ backgroundImage: 'none' })}
                      className="text-xs text-red-400 mt-1 hover:text-red-300"
                    >이미지 제거</button>
                  </div>
                )}
                <label className="flex items-center justify-center gap-1 w-full py-1.5 rounded-lg text-xs text-slate-400 border border-dashed border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 cursor-pointer transition-colors">
                  <span>이미지 선택</span>
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    const reader = new FileReader()
                    // 이미지 요소 배경으로 전환 → 미디어 속성창(맞춤/투명도/교체/복원) 표시
                    reader.onload = (ev) => applyBgImage(ev.target.result)
                    reader.readAsDataURL(file)
                    e.target.value = ''
                  }} />
                </label>
              </div>

              {/* 이미지가 설정된 shape 배경 → 일반 요소로 변환 (이미지 요소 배경과 동작 일치) */}
              {canRestore(currentBg) && (
                <button
                  onClick={() => useFlatStore.getState().restoreBackgroundToNormal(currentBg.id)}
                  className="w-full py-1.5 rounded-lg text-xs text-slate-400 border border-white/10 hover:border-indigo-500/40 hover:text-indigo-300 transition-colors"
                >일반 요소로 변환</button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
