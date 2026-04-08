import { useState, useEffect, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'

export const STYLE_SECTIONS = [
  {
    label: '색상',
    props: [
      { key: 'color',           label: '글자색',  type: 'color' },
      { key: 'backgroundColor', label: '배경색',  type: 'color' },
    ],
  },
  {
    label: '타이포그래피',
    props: [
      { key: 'fontSize',   label: '글자 크기', type: 'text',   placeholder: '16px' },
      { key: 'fontWeight',  label: '굵기',     type: 'select', options: [
        { value: '',        label: '기본' },
        { value: 'normal',  label: 'Normal (400)' },
        { value: 'bold',    label: 'Bold (700)' },
        { value: '100',     label: '100' },
        { value: '200',     label: '200' },
        { value: '300',     label: '300' },
        { value: '500',     label: '500' },
        { value: '600',     label: '600' },
        { value: '800',     label: '800' },
        { value: '900',     label: '900' },
      ]},
      { key: 'textAlign',  label: '정렬',     type: 'select', options: [
        { value: '',       label: '기본' },
        { value: 'left',   label: '좌측' },
        { value: 'center', label: '가운데' },
        { value: 'right',  label: '우측' },
        { value: 'justify',label: '양쪽' },
      ]},
      { key: 'lineHeight', label: '줄 높이',  type: 'text',   placeholder: '1.5' },
    ],
  },
  {
    label: '여백 · 테두리',
    props: [
      { key: 'padding',      label: '안쪽 여백', type: 'text', placeholder: '10px' },
      { key: 'margin',       label: '바깥 여백', type: 'text', placeholder: '0px' },
      { key: 'borderRadius', label: '모서리',    type: 'text', placeholder: '0px' },
    ],
  },
]

/** flex 아이템일 때 표시되는 속성 */
const FLEX_ITEM_SECTION = {
  label: '크기 (Flex 아이템)',
  props: [
    { key: 'flex',      label: '비율',     type: 'text', placeholder: '1' },
    { key: 'width',     label: '너비',     type: 'text', placeholder: 'auto' },
    { key: 'minWidth',  label: '최소 너비', type: 'text', placeholder: '0' },
    { key: 'maxWidth',  label: '최대 너비', type: 'text', placeholder: 'none' },
    { key: 'alignSelf', label: '개별 정렬', type: 'select', options: [
      { value: '',        label: '기본' },
      { value: 'stretch', label: 'Stretch' },
      { value: 'center',  label: 'Center' },
      { value: 'flex-start', label: 'Start' },
      { value: 'flex-end',   label: 'End' },
    ]},
  ],
}

/** flex 컨테이너일 때 표시되는 속성 */
const FLEX_CONTAINER_SECTION = {
  label: '레이아웃 (컨테이너)',
  props: [
    { key: 'display', label: '디스플레이', type: 'select', options: [
      { value: '',      label: '기본' },
      { value: 'flex',  label: 'Flex' },
      { value: 'block', label: 'Block' },
      { value: 'grid',  label: 'Grid' },
    ]},
    { key: 'flexDirection', label: '방향', type: 'select', options: [
      { value: '',          label: '기본' },
      { value: 'row',       label: 'Row →' },
      { value: 'column',    label: 'Column ↓' },
      { value: 'row-reverse',    label: 'Row ←' },
      { value: 'column-reverse', label: 'Column ↑' },
    ]},
    { key: 'gap', label: '간격', type: 'text', placeholder: '0px' },
    { key: 'alignItems', label: 'Cross축', type: 'select', options: [
      { value: '',           label: '기본' },
      { value: 'stretch',   label: 'Stretch' },
      { value: 'center',    label: 'Center' },
      { value: 'flex-start', label: 'Start' },
      { value: 'flex-end',   label: 'End' },
    ]},
    { key: 'justifyContent', label: 'Main축', type: 'select', options: [
      { value: '',              label: '기본' },
      { value: 'flex-start',   label: 'Start' },
      { value: 'center',       label: 'Center' },
      { value: 'flex-end',     label: 'End' },
      { value: 'space-between', label: 'Space Between' },
      { value: 'space-around',  label: 'Space Around' },
      { value: 'space-evenly',  label: 'Space Evenly' },
    ]},
  ],
}

export default function StyleEditor({ id }) {
  const { readStyle, previewStyle, applyStyle, elements, iframeRef } = useEditorStore()
  const [values, setValues] = useState({})
  const [originals, setOriginals] = useState({})

  // 선택된 요소의 컨텍스트 감지
  const context = useFlexContext(id, iframeRef, elements)

  // 표시할 섹션 결정
  const sections = buildSections(context)

  // 선택 요소 변경 시 모든 스타일 값 읽기
  useEffect(() => {
    const v = {}
    for (const section of sections) {
      for (const prop of section.props) {
        v[prop.key] = readStyle(id, prop.key)
      }
    }
    setValues(v)
    setOriginals(v)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, readStyle, context.isFlexItem, context.isFlexContainer])

  const handleChange = useCallback((key, val) => {
    setValues(prev => ({ ...prev, [key]: val }))
    previewStyle(id, key, val)
  }, [id, previewStyle])

  const handleCommit = useCallback((key) => {
    applyStyle(id, key, values[key] ?? '')
  }, [id, values, applyStyle])

  const handleReset = useCallback((key) => {
    const orig = originals[key] ?? ''
    setValues(prev => ({ ...prev, [key]: orig }))
    previewStyle(id, key, orig)
  }, [id, originals, previewStyle])

  return (
    <div className="space-y-3">
      {sections.map(section => (
        <div key={section.label}>
          <p className="text-xs text-slate-500 mb-1.5">{section.label}</p>
          <div className="space-y-1.5">
            {section.props.map(prop => (
              <StyleRow
                key={prop.key}
                prop={prop}
                value={values[prop.key] ?? ''}
                onChange={(val) => handleChange(prop.key, val)}
                onCommit={() => handleCommit(prop.key)}
                onReset={() => handleReset(prop.key)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 선택된 요소의 flex 컨텍스트를 감지하는 훅
 */
function useFlexContext(id, iframeRef, elements) {
  const [context, setContext] = useState({ isFlexItem: false, isFlexContainer: false })

  useEffect(() => {
    const doc = iframeRef?.current?.contentDocument
    if (!doc || !id) {
      setContext({ isFlexItem: false, isFlexContainer: false })
      return
    }

    const el = doc.querySelector(`[data-editor-id="${id}"]`)
    if (!el) {
      setContext({ isFlexItem: false, isFlexContainer: false })
      return
    }

    const win = doc.defaultView
    let isFlexItem = false
    let isFlexContainer = false

    if (win && el.parentElement) {
      const parentCS = win.getComputedStyle(el.parentElement)
      const parentDisplay = parentCS.display
      isFlexItem = parentDisplay === 'flex' || parentDisplay === 'inline-flex'
    }

    const meta = elements.get(id)
    if (meta?.type === 'container') {
      isFlexContainer = true
    }

    setContext({ isFlexItem, isFlexContainer })
  }, [id, iframeRef, elements])

  return context
}

/**
 * 컨텍스트에 따라 표시할 섹션 목록을 구성한다.
 */
function buildSections(context) {
  const sections = []

  // 컨테이너면 레이아웃 섹션 먼저
  if (context.isFlexContainer) {
    sections.push(FLEX_CONTAINER_SECTION)
  }

  // flex 아이템이면 크기 섹션
  if (context.isFlexItem) {
    sections.push(FLEX_ITEM_SECTION)
  }

  // 기본 섹션
  sections.push(...STYLE_SECTIONS)

  return sections
}

function StyleRow({ prop, value, onChange, onCommit, onReset }) {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { onCommit(); e.target.blur() }
    if (e.key === 'Escape') { onReset(); e.target.blur() }
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs text-slate-400 w-16 shrink-0 truncate" title={prop.label}>
        {prop.label}
      </span>

      {prop.type === 'color' && (
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <input
            type="color"
            value={toHex(value) || '#000000'}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            className="w-6 h-6 rounded border border-white/10 cursor-pointer shrink-0"
            style={{ padding: 0, background: 'transparent' }}
          />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={handleKeyDown}
            className={inputClass}
            placeholder="#000000"
          />
        </div>
      )}

      {prop.type === 'text' && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          className={inputClass}
          placeholder={prop.placeholder}
        />
      )}

      {prop.type === 'select' && (
        <select
          value={value}
          onChange={(e) => { onChange(e.target.value); /* select은 즉시 commit */ }}
          onBlur={onCommit}
          className={inputClass}
          style={{ appearance: 'none', paddingRight: 20, backgroundImage: chevronBg, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', backgroundSize: '10px' }}
        >
          {prop.options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  )
}

const inputClass = 'flex-1 min-w-0 text-xs text-slate-200 bg-white/5 rounded px-2 py-1 border border-white/10 outline-none focus:border-indigo-500/50 transition-colors'

const chevronBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`

function toHex(str) {
  if (!str) return ''
  if (str.startsWith('#')) return str
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return ''
  return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('')
}
