import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import EmojiPicker from './EmojiPicker'

// 선택 툴바 팔레트
const TEXT_COLORS = ['#0f172a', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']
const HL_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff']
const FONT_STEP = 2
const FONT_MIN = 8
const FONT_MAX = 200

/** 현재 선택 영역을 style 한 속성으로 감싼다 (execCommand가 px를 못 주는 fontSize 등에 사용) */
function wrapSelection(prop, value) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  if (range.collapsed) return
  const span = document.createElement('span')
  span.style[prop] = value
  try {
    range.surroundContents(span)
  } catch {
    // 노드 경계를 가로지르는 선택: 추출 후 래핑
    const frag = range.extractContents()
    span.appendChild(frag)
    range.insertNode(span)
  }
  const nr = document.createRange()
  nr.selectNodeContents(span)
  sel.removeAllRanges()
  sel.addRange(nr)
}

/**
 * FlatInlineEditor
 * 선택된 텍스트 요소 위에 contentEditable div를 겹쳐 인라인 편집.
 * 요소의 폰트/색상/정렬 스타일을 그대로 적용.
 * blur 또는 Escape로 커밋.
 * 텍스트 일부를 선택하면 선택 위에 부분 서식 툴바(B/I/U/색상/형광펜)가 뜬다.
 */
export default function FlatInlineEditor({ element }) {
  const ref = useRef(null)
  const { commitTextEdit } = useFlatStore()
  const committedRef = useRef(false)
  const suppressCommitRef = useRef(false) // prompt 등 일시적 포커스 이탈 시 blur 커밋 차단
  const lastRangeRef = useRef(null)       // 마지막 caret/선택 (이모지 삽입 시 복원용)
  const accessoryRef = useRef(null)       // 이모지 버튼+픽커 컨테이너
  const [sel, setSel] = useState(null) // { left, top, bottom } 뷰포트 좌표 또는 null
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false })
  const [listFmt, setListFmt] = useState({ ul: false, ol: false }) // 리스트 활성 상태
  const [editorRect, setEditorRect] = useState(null) // 편집 도구 묶음 앵커용
  const [emojiOpen, setEmojiOpen] = useState(false)

  const { x, y, width, height, content, styles, merged } = element

  // 현재 선택 상태 → 툴바 위치/활성 서식 갱신 + caret 보존
  const refreshSelection = useCallback(() => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0) { setSel(null); return }
    const range = s.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) { setSel(null); return }
    lastRangeRef.current = range.cloneRange() // caret/선택 보존 (collapsed 포함)
    // 리스트 활성 상태 — caret만 있어도 갱신
    try {
      setListFmt({
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      })
    } catch { /* noop */ }
    if (s.isCollapsed) { setSel(null); return }
    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) { setSel(null); return }
    setSel({ left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom })
    try {
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      })
    } catch { /* queryCommandState 미지원 무시 */ }
  }, [])

  // 마운트 시 innerHTML 설정 + 포커스 + 커밋 콜백 등록
  useEffect(() => {
    if (!ref.current) return
    if (element.isRich) {
      ref.current.innerHTML = content || ''
    } else {
      // plain text: escape 후 줄바꿈 변환
      const displayContent = (content || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      ref.current.innerHTML = displayContent
    }
    ref.current.focus()
    // 전체 선택
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    sel.removeAllRanges()
    sel.addRange(range)
    committedRef.current = false
    setEditorRect(ref.current.getBoundingClientRect()) // 이모지 버튼 앵커
    // 인라인 서식이 <span style>로 생성되도록 (export 파서가 인라인 스타일을 읽음)
    try { document.execCommand('styleWithCSS', false, true) } catch { /* noop */ }
    document.addEventListener('selectionchange', refreshSelection)

    // 페이지 이동/모드 전환 시 _saveCurrentPage가 이 콜백을 호출하여 커밋
    const flushCommit = () => {
      if (committedRef.current || !ref.current) return
      committedRef.current = true
      const html = (ref.current?.innerHTML || '').trim()
      const hasHtmlTags = /<[a-z][\s\S]*>/i.test(html)
      commitTextEdit(element.id, html, hasHtmlTags)
    }
    useFlatStore.getState()._setPendingEditCommit(flushCommit)

    return () => {
      document.removeEventListener('selectionchange', refreshSelection)
      // unmount 시 미커밋 상태면 커밋 시도
      flushCommit()
      useFlatStore.getState()._setPendingEditCommit(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 영역에 서식 적용 (포커스/선택 유지 → blur 커밋 방지는 툴바 mousedown preventDefault가 담당)
  const applyCmd = useCallback((cmd, value) => {
    const el = ref.current
    if (!el) return
    el.focus()
    try {
      document.execCommand('styleWithCSS', false, true)
      document.execCommand(cmd, false, value)
    } catch { /* execCommand 미지원 무시 */ }
    refreshSelection()
  }, [refreshSelection])

  // 선택 영역 글자크기 증감 (앵커의 계산된 크기 기준 ±step)
  const changeFontSize = useCallback((delta) => {
    const el = ref.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    el.focus()
    const anchor = sel.anchorNode
    const probe = anchor && anchor.nodeType === 3 ? anchor.parentElement : anchor
    const cur = probe ? (parseFloat(getComputedStyle(probe).fontSize) || 16) : 16
    const next = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(cur) + delta))
    wrapSelection('fontSize', next + 'px')
    refreshSelection()
  }, [refreshSelection])

  // 선택 영역에 하이퍼링크 적용 (Ctrl+K / 툴바)
  const applyLink = useCallback(() => {
    const el = ref.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const saved = sel.getRangeAt(0).cloneRange()
    suppressCommitRef.current = true // prompt가 포커스를 가져가도 커밋 금지
    const url = window.prompt('링크 URL을 입력하세요', 'https://')
    suppressCommitRef.current = false
    el.focus()
    sel.removeAllRanges()
    sel.addRange(saved)
    if (url) {
      try { document.execCommand('createLink', false, url) } catch { /* noop */ }
    }
    refreshSelection()
  }, [refreshSelection])

  // 저장된 caret 위치에 이모지 삽입 (선택이 있으면 대체)
  const insertEmoji = useCallback((emoji) => {
    const el = ref.current
    if (!el) return
    el.focus()
    const s = window.getSelection()
    if (lastRangeRef.current) {
      s.removeAllRanges()
      s.addRange(lastRangeRef.current)
    }
    try {
      document.execCommand('insertText', false, emoji)
    } catch {
      if (s.rangeCount) {
        const r = s.getRangeAt(0)
        r.deleteContents()
        r.insertNode(document.createTextNode(emoji))
        r.collapse(false)
      }
    }
    if (s.rangeCount) lastRangeRef.current = s.getRangeAt(0).cloneRange()
  }, [])

  // 글머리/번호 리스트 토글 (네이티브 contentEditable 명령)
  // collapsed caret에선 네이티브 토글의 리스트-조상 판정이 불안정하므로,
  // 전체 선택일 때와 동일하게 콘텐츠 전체 Range로 확장한 뒤 명령을 건다.
  const toggleList = useCallback((ordered) => {
    const el = ref.current
    if (!el) return
    // 포커스가 떠 있을 때만 복귀 (focus()가 caret을 맨 앞으로 되돌리는 부작용 방지)
    if (document.activeElement !== el) el.focus()

    const sel = window.getSelection()
    let hasSelInEditor = sel.rangeCount > 0 && el.contains(sel.anchorNode)
    if (!hasSelInEditor && lastRangeRef.current && el.contains(lastRangeRef.current.commonAncestorContainer)) {
      sel.removeAllRanges()
      sel.addRange(lastRangeRef.current)
      hasSelInEditor = true
    }

    // 선택이 없거나 collapsed → 전체 콘텐츠로 확장 (안정 경로)
    const collapsed = !hasSelInEditor || sel.getRangeAt(0).collapsed
    if (collapsed) {
      const r = document.createRange()
      r.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(r)
    }

    try {
      document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList')
    } catch { /* noop */ }

    // 확장했던 경우 caret을 끝으로 모아 다음 토글도 같은 경로를 타게 함
    if (collapsed) {
      const s = window.getSelection()
      if (s.rangeCount) {
        const r = s.getRangeAt(0)
        r.collapse(false)
        s.removeAllRanges()
        s.addRange(r)
      }
    }
    refreshSelection()
  }, [refreshSelection])

  // caret이 리스트(li/ul/ol) 안에 있는지
  const isCaretInList = useCallback(() => {
    const s = window.getSelection()
    const el = ref.current
    if (!s || s.rangeCount === 0 || !el) return false
    let n = s.anchorNode
    while (n && n !== el) {
      if (n.nodeType === 1 && (n.tagName === 'LI' || n.tagName === 'UL' || n.tagName === 'OL')) return true
      n = n.parentNode
    }
    return false
  }, [])

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const html = (ref.current?.innerHTML || '').trim()
    const hasHtmlTags = /<[a-z][\s\S]*>/i.test(html)
    commitTextEdit(element.id, html, hasHtmlTags)
  }, [element.id, commitTextEdit])

  const handleBlur = useCallback((e) => {
    if (suppressCommitRef.current) return
    // 포커스가 이모지 버튼/픽커 등 부속 UI로 이동하면 커밋 보류 (편집 유지)
    const rt = e?.relatedTarget
    if (rt && rt.closest && rt.closest('[data-edit-accessory]')) return
    commit()
  }, [commit])

  // 이모지 픽커 열려 있을 때 바깥 클릭 → 닫기
  useEffect(() => {
    if (!emojiOpen) return
    const onDown = (e) => {
      if (accessoryRef.current && !accessoryRef.current.contains(e.target)) setEmojiOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [emojiOpen])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      commit()
      return
    }
    // Ctrl/Cmd+K → 하이퍼링크
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      e.stopPropagation()
      applyLink()
      return
    }
    // Ctrl/Cmd+Shift+8 → 글머리, +7 → 번호 (Shift로 key가 '*'/'&'가 되므로 code 사용)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Digit8' || e.code === 'Digit7')) {
      e.preventDefault()
      e.stopPropagation()
      toggleList(e.code === 'Digit7')
      return
    }
    // Tab → 리스트 안에서 들여쓰기/내어쓰기, 밖에서는 포커스 이탈만 차단
    if (e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      if (isCaretInList()) {
        try { document.execCommand(e.shiftKey ? 'outdent' : 'indent') } catch { /* noop */ }
        refreshSelection()
      }
      return
    }
    // 모든 키 이벤트를 캔버스로 전파하지 않음
    e.stopPropagation()
  }, [commit, applyLink, toggleList, isCaretInList, refreshSelection])

  // shape 또는 배경 있는 텍스트 → flex 레이아웃으로 중앙 정렬
  const isShape = element.type === 'shape'
  const hasBg = styles.backgroundColor
    && styles.backgroundColor !== 'rgba(0, 0, 0, 0)'
    && styles.backgroundColor !== 'transparent'
  const needsFlex = merged || hasBg || isShape

  const editorStyle = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    minHeight: height,
    zIndex: 10001,
    boxSizing: 'border-box',
    // 텍스트 스타일 복제
    color: styles.color,
    fontSize: styles.fontSize,
    fontFamily: styles.fontFamily,
    fontWeight: styles.fontWeight,
    lineHeight: styles.lineHeight,
    textAlign: styles.textAlign,
    letterSpacing: styles.letterSpacing,
    textTransform: styles.textTransform,
    textDecoration: styles.textDecoration,
    padding: (isShape && (!styles.padding || styles.padding === '0px')) ? '8px' : styles.padding,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    // 배경 + 테두리
    backgroundColor: styles.backgroundColor || 'transparent',
    backgroundImage: styles.backgroundImage,
    borderRadius: styles.borderRadius,
    border: styles.border,
    boxShadow: styles.boxShadow,
    opacity: styles.opacity,
    // flex 레이아웃 (merged/배경 있는 텍스트)
    ...(needsFlex ? {
      display: 'flex',
      alignItems: styles.isFlex ? (styles.alignItems || 'center') : 'center',
      justifyContent: styles.isFlex
        ? (styles.justifyContent || 'center')
        : (styles.textAlign === 'center' ? 'center'
          : styles.textAlign === 'right' ? 'flex-end' : 'flex-start'),
    } : {}),
    // 편집 시각 피드백
    outline: '2px solid rgba(99, 102, 241, 0.8)',
    outlineOffset: -1,
    cursor: 'text',
    userSelect: 'text',
    overflow: 'auto',
  }

  return (
    <>
      <div
        ref={ref}
        className="flat-text-edit"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={element.placeholder || ''}
        style={editorStyle}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      />
      {sel && createPortal(
        <SelectionToolbar sel={sel} fmt={fmt} onCmd={applyCmd} onFontSize={changeFontSize} onLink={applyLink} />,
        document.body
      )}
      {editorRect && createPortal(
        <EditAccessory
          rect={editorRect}
          sel={sel}
          open={emojiOpen}
          accessoryRef={accessoryRef}
          listFmt={listFmt}
          onToggleList={toggleList}
          onToggleEmoji={() => {
            if (ref.current) setEditorRect(ref.current.getBoundingClientRect())
            setEmojiOpen(o => !o)
          }}
          onPick={insertEmoji}
        />,
        document.body
      )}
    </>
  )
}

// ── 선택 바 위치 계산 (충돌 회피 공유) ──────────────────
const SEL_TOOLBAR_H = 38
const SEL_TOOLBAR_HALF_W = 200
function computeSelToolbarPos(sel) {
  let top = sel.top - SEL_TOOLBAR_H - 8
  let below = false
  if (top < 8) { top = sel.bottom + 8; below = true } // 위 공간 부족 시 아래로
  const left = Math.max(SEL_TOOLBAR_HALF_W + 8, Math.min(window.innerWidth - SEL_TOOLBAR_HALF_W - 8, sel.left))
  return { left, top, below, halfW: SEL_TOOLBAR_HALF_W, height: SEL_TOOLBAR_H }
}
const rectsOverlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

// ── 편집 도구 묶음: 글머리/번호 리스트 + 이모지 (편집 중 항상 노출) ──

function EditAccessory({ rect, sel, open, accessoryRef, listFmt, onToggleList, onToggleEmoji, onPick }) {
  const BTN = 28
  const CLUSTER_W = BTN * 3 + 4 * 2 + 8 // 버튼 3 + gap + padding
  const CLUSTER_H = BTN + 4 * 2
  let top = rect.top - CLUSTER_H - 6
  if (top < 8) top = rect.bottom + 4
  const left = Math.min(window.innerWidth - CLUSTER_W - 8, Math.max(8, rect.right - CLUSTER_W))

  // 선택 바가 동시에 보이고 겹치면 세로로 비켜서기 (선택 바가 우선, 도구 묶음이 양보)
  if (sel) {
    const st = computeSelToolbarPos(sel)
    const selBox = { x0: st.left - st.halfW, x1: st.left + st.halfW, y0: st.top, y1: st.top + st.height }
    const accBox = { x0: left, x1: left + CLUSTER_W, y0: top, y1: top + CLUSTER_H }
    if (rectsOverlap(accBox, selBox)) {
      const above = st.top - CLUSTER_H - 6
      top = above >= 8 ? above : st.top + st.height + 6 // 위에 자리 없으면 선택 바 아래로
    }
  }

  const toolBtn = (active) => ({
    width: BTN, height: BTN, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1,
    color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.12)',
    background: active ? 'rgba(99,102,241,0.55)' : 'rgba(255,255,255,0.06)',
  })

  return (
    <div
      ref={accessoryRef}
      data-edit-accessory="true"
      style={{
        position: 'fixed', top, left, zIndex: 10050,
        display: 'flex', gap: 4, padding: 4, borderRadius: 9,
        background: 'rgba(15,23,42,0.95)', border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
      }}
    >
      <button type="button" title="글머리 기호 (Ctrl+Shift+8)"
        onMouseDown={(e) => { e.preventDefault(); onToggleList(false) }}
        style={toolBtn(listFmt.ul)}>•</button>
      <button type="button" title="번호 매기기 (Ctrl+Shift+7)"
        onMouseDown={(e) => { e.preventDefault(); onToggleList(true) }}
        style={{ ...toolBtn(listFmt.ol), fontSize: 11 }}>1.</button>
      <button type="button" title="이모지·기호 삽입"
        onMouseDown={(e) => { e.preventDefault(); onToggleEmoji() }}
        style={{ ...toolBtn(open), fontSize: 16 }}>😊</button>
      {open && (
        <div style={{ position: 'absolute', top: BTN + 8, right: 0 }}>
          <EmojiPicker onPick={onPick} />
        </div>
      )}
    </div>
  )
}

// ── 선택 영역 부분 서식 툴바 ──────────────────────────

function SelectionToolbar({ sel, fmt, onCmd, onFontSize, onLink }) {
  const { top, left } = computeSelToolbarPos(sel)

  // 툴바 영역 mousedown은 기본동작 차단 → 에디터 포커스/선택 유지 (blur 커밋 방지)
  const keepSelection = (e) => e.preventDefault()
  const cmd = (c, v) => (e) => { e.preventDefault(); onCmd(c, v) }

  return (
    <div
      onMouseDown={keepSelection}
      style={{
        position: 'fixed',
        top,
        left,
        transform: 'translateX(-50%)',
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 8px',
        background: 'rgba(15,23,42,0.97)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <FmtBtn active={fmt.bold} onMouseDown={cmd('bold')} title="굵게 (Ctrl+B)" style={{ fontWeight: 700 }}>B</FmtBtn>
      <FmtBtn active={fmt.italic} onMouseDown={cmd('italic')} title="기울임 (Ctrl+I)" style={{ fontStyle: 'italic' }}>I</FmtBtn>
      <FmtBtn active={fmt.underline} onMouseDown={cmd('underline')} title="밑줄 (Ctrl+U)" style={{ textDecoration: 'underline' }}>U</FmtBtn>
      <Sep />
      <FmtBtn onMouseDown={(e) => { e.preventDefault(); onFontSize(-FONT_STEP) }} title="글자 작게" style={{ fontSize: 11 }}>A−</FmtBtn>
      <FmtBtn onMouseDown={(e) => { e.preventDefault(); onFontSize(FONT_STEP) }} title="글자 크게" style={{ fontSize: 14 }}>A+</FmtBtn>
      <FmtBtn onMouseDown={(e) => { e.preventDefault(); onLink() }} title="링크 (Ctrl+K)">🔗</FmtBtn>
      <Sep />
      <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 1 }}>가</span>
      {TEXT_COLORS.map(c => (
        <Swatch key={c} color={c} round onMouseDown={cmd('foreColor', c)} title={`글자색 ${c}`} />
      ))}
      <Sep />
      {HL_COLORS.map(c => (
        <Swatch key={c} color={c} onMouseDown={cmd('hiliteColor', c)} title={`형광펜 ${c}`} />
      ))}
      <FmtBtn onMouseDown={cmd('hiliteColor', 'transparent')} title="형광펜 지우기" style={{ fontSize: 11 }}>✕</FmtBtn>
    </div>
  )
}

function FmtBtn({ children, active, onMouseDown, title, style }) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      title={title}
      style={{
        minWidth: 24,
        height: 24,
        padding: '0 5px',
        borderRadius: 5,
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        lineHeight: 1,
        color: '#e2e8f0',
        background: active ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.08)',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function Swatch({ color, round, onMouseDown, title }) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      title={title}
      style={{
        width: 16,
        height: 16,
        padding: 0,
        borderRadius: round ? '50%' : 3,
        border: '1px solid rgba(255,255,255,0.25)',
        background: color,
        cursor: 'pointer',
      }}
    />
  )
}

function Sep() {
  return <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.12)', margin: '0 2px' }} />
}
