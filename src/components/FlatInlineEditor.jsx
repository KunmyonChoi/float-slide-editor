import { useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFlatStore } from '../store/flatStore'
import EmojiPicker from './EmojiPicker'
import { promptUrl } from './UrlPrompt'
import { isCoarsePointer, useIsTouch } from '../core/pointerEnv'
import { useVisualViewport } from './useVisualViewport'

// 선택 툴바 팔레트
const TEXT_COLORS = ['#0f172a', '#ffffff', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']
const HL_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#e9d5ff']
const FONT_STEP = 2
const FONT_MIN = 8
const FONT_MAX = 200

/** contentEditable → 원본 plain 텍스트 (코드 모드 커밋용, <br>/<div> → 줄바꿈) */
function editorToPlain(el) {
  if (!el) return ''
  let html = el.innerHTML || ''
  html = html.replace(/<div><br><\/div>/gi, '\n').replace(/<div>/gi, '\n').replace(/<\/div>/gi, '').replace(/<br\s*\/?>/gi, '\n')
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || ''
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
  const touch = useIsTouch()
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
  const [linkHover, setLinkHover] = useState(null) // 호버한 링크 { rect, anchor, href } 또는 null
  const linkHideTimerRef = useRef(null)

  const { x, y, width, height, content, styles, merged } = element

  // 현재 선택 상태 → 툴바 위치/활성 서식 갱신 + caret 보존
  const refreshSelection = useCallback(() => {
    const el = ref.current
    const s = window.getSelection()
    if (!el || !s || s.rangeCount === 0) { setSel(null); return }
    const range = s.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) { setSel(null); return }
    lastRangeRef.current = range.cloneRange() // caret/선택 보존 (collapsed 포함)
    // 리스트/서식 활성 상태 — caret만 있어도 갱신 (모바일 고정 서식바가 정확히 표시되도록)
    try {
      setListFmt({
        ul: document.queryCommandState('insertUnorderedList'),
        ol: document.queryCommandState('insertOrderedList'),
      })
    } catch { /* noop */ }
    try {
      setFmt({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
      })
    } catch { /* queryCommandState 미지원 무시 */ }
    if (s.isCollapsed) { setSel(null); return }
    const rect = range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) { setSel(null); return }
    setSel({ left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom })
  }, [])

  // 마운트 시 innerHTML 설정 + 포커스 + 커밋 콜백 등록
  useEffect(() => {
    if (!ref.current) return
    // plain text → innerHTML용 HTML 인코딩. 이미 &amp; 등 엔티티가 섞여 있을 수 있으므로
    // 먼저 디코딩(textContent trick)한 뒤 인코딩해 이중인코딩 방지.
    const escapePlain = (t) => {
      if (!t) return ''
      // &amp; 등 기존 HTML 엔티티를 먼저 디코딩(브라우저 DOM으로)
      const tmp = document.createElement('div')
      tmp.innerHTML = t.replace(/\n/g, '⁠') // 줄바꿈 임시 보존(U+2060 WORD JOINER, 텍스트에 거의 안 쓰임)
      const decoded = tmp.textContent.replace(/⁠/g, '\n')
      return decoded.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
    }
    if (element.isCode) {
      // 코드 모드: 색칠 content 대신 원본 code(plain)를 편집
      ref.current.innerHTML = escapePlain(element.code || '')
    } else if (element.isMarkdown) {
      // 마크다운 모드: 렌더 content 대신 원본 md(plain)를 편집
      ref.current.innerHTML = escapePlain(element.md || '')
    } else if (element.isRich) {
      ref.current.innerHTML = content || ''
    } else {
      // plain text: escape 후 줄바꿈 변환
      ref.current.innerHTML = escapePlain(content)
    }
    // 편집 중 캐럿이 캔버스 밖으로 나가면 브라우저가 캐럿을 보이려 조상의 scrollTop을 바꿔
    // (overflow:hidden 이라 스크롤바 없어도 가능) 캔버스가 통째로 밀려 올라간다.
    //  - hidden/clip 조상: 사용자가 스크롤할 수 없으니 편집 세션 내내 위치를 지속 고정(모든 스크롤=자동).
    //  - auto/scroll 조상 + scrollingElement: 진입 시 1회 복원(사용자 스크롤은 허용).
    const hardLock = [], softRestore = []
    for (let p = ref.current.parentElement; p; p = p.parentElement) {
      const o = (() => { const c = getComputedStyle(p); return `${c.overflow} ${c.overflowY} ${c.overflowX}` })()
      if (/hidden|clip/.test(o)) hardLock.push(p)
      else if (/auto|scroll|overlay/.test(o)) softRestore.push(p)
    }
    const sc = document.scrollingElement || document.documentElement
    if (sc) softRestore.push(sc)
    const snap = (els) => els.map(s => [s, s.scrollTop, s.scrollLeft])
    const savedHard = snap(hardLock), savedSoft = snap(softRestore)
    const apply = (arr) => arr.forEach(([s, t, l]) => { if (s.scrollTop !== t) s.scrollTop = t; if (s.scrollLeft !== l) s.scrollLeft = l })
    const restoreAll = () => { apply(savedHard); apply(savedSoft) }
    const onAnyScroll = () => apply(savedHard) // 편집 중 자동 스크롤은 hidden 컨테이너를 즉시 되돌림
    document.addEventListener('scroll', onAnyScroll, true)

    ref.current.focus({ preventScroll: true })
    // 데스크톱: 전체 선택 / 터치: 끝에 캐럿만 (진입 즉시 선택바·OS 메뉴가 글씨를 가리지 않도록)
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    if (isCoarsePointer()) range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
    restoreAll()
    requestAnimationFrame(restoreAll)
    committedRef.current = false
    setEditorRect(ref.current.getBoundingClientRect()) // 이모지 버튼 앵커
    // 오토핏 요소: 진입 즉시 실제 높이로 컨테이너 동기화
    if (element.autoHeight) useFlatStore.getState().reflowAutoFit({ [element.id]: ref.current.scrollHeight })
    // 인라인 서식이 <span style>로 생성되도록 (export 파서가 인라인 스타일을 읽음)
    try { document.execCommand('styleWithCSS', false, true) } catch { /* noop */ }
    // Enter 줄바꿈을 <div> 블록 대신 <br>(단일 블록)으로 — 멀티라인 선택에 형광펜(hiliteColor) 등
    // 서식이 줄별로 끊기지 않고 일관 적용되게(블록 경계에서 execCommand가 첫 줄만 처리하는 문제 완화).
    try { document.execCommand('defaultParagraphSeparator', false, 'br') } catch { /* noop */ }
    document.addEventListener('selectionchange', refreshSelection)

    // 페이지 이동/모드 전환 시 _saveCurrentPage가 이 콜백을 호출하여 커밋
    const flushCommit = () => {
      if (committedRef.current || !ref.current) return
      committedRef.current = true
      if (element.isCode) {
        // 코드 모드: 편집기 → 원본 텍스트(줄바꿈 보존)로 추출 후 재색칠 커밋
        const raw = editorToPlain(ref.current)
        useFlatStore.getState().commitCodeEdit(element.id, raw)
        return
      }
      if (element.isMarkdown) {
        useFlatStore.getState().commitMarkdownEdit(element.id, editorToPlain(ref.current))
        return
      }
      const html = (ref.current?.innerHTML || '').trim()
      // <br>/<div> 줄바꿈 구조만 있고 인라인 서식(<span>/<b>/<a> 등)이 없으면 plain.
      // ⚠ <br>/<div>는 줄바꿈 표현이므로 hasHtmlTags에서 제외해야 순수 plain 판정이 정확.
      const hasInlineStyle = /<(?!br|div|\/div|\/br)([a-z][\s\S]*?)>/i.test(html)
      if (!hasInlineStyle) {
        // plain text: innerHTML의 &amp; 등 엔티티를 textContent(자동 디코딩)로 추출.
        // editorToPlain: <br>/<div> → \n 변환 후 textContent → 원본 문자열 그대로.
        const plain = editorToPlain(ref.current)
        commitTextEdit(element.id, plain, false)
      } else {
        commitTextEdit(element.id, html, true)
      }
    }
    useFlatStore.getState()._setPendingEditCommit(flushCommit)

    return () => {
      document.removeEventListener('selectionchange', refreshSelection)
      document.removeEventListener('scroll', onAnyScroll, true)
      // unmount 시 미커밋 상태면 커밋 시도
      flushCommit()
      useFlatStore.getState()._setPendingEditCommit(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 선택 영역에 서식 적용 (포커스/선택 유지 → blur 커밋 방지는 툴바 mousedown preventDefault가 담당)
  // 형광펜(배경색): execCommand('hiliteColor')는 기존 styled span이 섞인 멀티라인 선택에서
  // 일부 줄을 건너뛴다(예: 글자크기 바꾼 줄). 선택과 교차하는 모든 텍스트 노드를 직접 배경 span으로
  // 감싸(또는 지우기 시 조상 배경 제거) 줄·중첩 무관하게 적용한다.
  const applyHighlight = useCallback((color) => {
    const el = ref.current
    if (!el) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (range.collapsed) return
    const clearing = color === 'transparent'

    const targets = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let n
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !range.intersectsNode(n)) continue
      let s = 0, e = n.nodeValue.length
      if (n === range.startContainer) s = range.startOffset
      if (n === range.endContainer) e = range.endOffset
      if (s < e) targets.push([n, s, e])
    }
    if (!targets.length) return

    if (clearing) {
      // 선택 영역 조상 span들의 background-color 제거(투명 span만으론 조상 색이 남음)
      targets.forEach(([node]) => {
        for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
          if (p.style && p.style.backgroundColor) {
            p.style.removeProperty('background-color')
            if (p.getAttribute('style') === '') p.removeAttribute('style')
          }
        }
      })
      refreshSelection()
      return
    }

    const spans = []
    targets.forEach(([node, s, e]) => {
      const r = document.createRange()
      r.setStart(node, s); r.setEnd(node, e)
      const span = document.createElement('span')
      span.style.backgroundColor = color
      try { r.surroundContents(span) }
      catch { const f = r.extractContents(); span.appendChild(f); r.insertNode(span) }
      spans.push(span)
    })
    if (spans.length) { // 선택 복원(첫~끝 span)
      const nr = document.createRange()
      nr.setStartBefore(spans[0]); nr.setEndAfter(spans[spans.length - 1])
      sel.removeAllRanges(); sel.addRange(nr)
    }
    refreshSelection()
  }, [refreshSelection])

  const applyCmd = useCallback((cmd, value) => {
    const el = ref.current
    if (!el) return
    if (cmd === 'hiliteColor') { applyHighlight(value); return } // 멀티라인·기존 span 무관 견고 적용
    el.focus()
    try {
      document.execCommand('styleWithCSS', false, true)
      document.execCommand(cmd, false, value)
    } catch { /* execCommand 미지원 무시 */ }
    refreshSelection()
  }, [refreshSelection, applyHighlight])

  // 선택 영역 글자크기 상대 증감 — 전체 박스 단축키(bumpFontSizePx)와 동일하게 위계 유지.
  // 기존 font-size 조상은 제자리에서 가감(누적 없음), base(상속) 런만 현재크기+delta로 1회 래핑.
  // (일괄 통일은 속성창 폰트크기 직접 지정으로 별도 제공)
  const changeFontSize = useCallback((delta) => {
    const el = ref.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    const clampSz = (v) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(v)))
    // 전체 선택 여부(공백 무시) — 전체면 요소 base font-size도 함께 가감해 줄 높이 strut를
    // 박스/엔터 적용과 일치시킨다(줄간격이 달라 보이던 문제).
    const allTxt = (el.textContent || '').replace(/\s/g, '')
    const selTxt = (sel.toString() || '').replace(/\s/g, '')
    const wholeSelected = allTxt.length > 0 && selTxt.length >= allTxt.length

    const targets = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
    let n
    while ((n = walker.nextNode())) {
      if (!n.nodeValue || !range.intersectsNode(n)) continue
      let s = 0, e = n.nodeValue.length
      if (n === range.startContainer) s = range.startOffset
      if (n === range.endContainer) e = range.endOffset
      if (s < e) targets.push([n, s, e])
    }
    if (!targets.length) return

    const carriers = new Set()
    const baseRuns = []
    targets.forEach(([node, s, e]) => {
      let carrier = null
      for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
        if (p.style && p.style.fontSize) { carrier = p; break }
      }
      if (carrier) carriers.add(carrier)
      else baseRuns.push([node, s, e])
    })

    const touched = []
    carriers.forEach(c => {
      const curC = parseFloat(c.style.fontSize) || parseFloat(getComputedStyle(c).fontSize) || 16
      c.style.fontSize = clampSz(curC + delta) + 'px'
      touched.push(c)
    })
    baseRuns.forEach(([node, s, e]) => {
      const curB = parseFloat(getComputedStyle(node.parentElement).fontSize) || 16
      const r = document.createRange()
      r.setStart(node, s); r.setEnd(node, e)
      const span = document.createElement('span')
      span.style.fontSize = clampSz(curB + delta) + 'px'
      try { r.surroundContents(span) } catch { const f = r.extractContents(); span.appendChild(f); r.insertNode(span) }
      touched.push(span)
    })
    if (touched.length) { // 가감된 영역 전체로 선택 복원
      touched.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
      const nr = document.createRange()
      nr.setStartBefore(touched[0]); nr.setEndAfter(touched[touched.length - 1])
      sel.removeAllRanges(); sel.addRange(nr)
    }
    // 전체 선택이면 요소 base font-size도 가감 → strut(줄 높이 기준)가 박스/엔터 적용과 동일
    if (wholeSelected) {
      const base = parseFloat(styles.fontSize) || 16
      useFlatStore.getState().updateFlatElement(element.id, { styles: { fontSize: clampSz(base + delta) + 'px' } })
    }
    refreshSelection()
  }, [refreshSelection, styles.fontSize, element.id])

  // 선택 영역에 하이퍼링크 적용 (Ctrl+K / 툴바)
  const applyLink = useCallback(async () => {
    const el = ref.current
    const sel = window.getSelection()
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const saved = sel.getRangeAt(0).cloneRange()
    suppressCommitRef.current = true // 팝업이 포커스를 가져가도 커밋 금지
    const url = await promptUrl({ title: '링크 URL을 입력하세요', placeholder: 'https://', initialValue: 'https://' })
    suppressCommitRef.current = false
    el.focus()
    sel.removeAllRanges()
    sel.addRange(saved)
    if (url) {
      try { document.execCommand('createLink', false, url) } catch { /* noop */ }
    }
    refreshSelection()
  }, [refreshSelection])

  // ── 링크 호버 버블 (열기/편집/제거) ──────────────────────
  const cancelHideLink = useCallback(() => {
    if (linkHideTimerRef.current) { clearTimeout(linkHideTimerRef.current); linkHideTimerRef.current = null }
  }, [])
  const scheduleHideLink = useCallback(() => {
    cancelHideLink()
    linkHideTimerRef.current = setTimeout(() => setLinkHover(null), 200)
  }, [cancelHideLink])

  const handleEditorMouseOver = useCallback((e) => {
    const a = e.target.closest?.('a')
    if (a && ref.current?.contains(a)) {
      cancelHideLink()
      setLinkHover({ rect: a.getBoundingClientRect(), anchor: a, href: a.getAttribute('href') || '' })
    }
  }, [cancelHideLink])

  const handleEditorMouseOut = useCallback((e) => {
    const a = e.target.closest?.('a')
    if (!a) return
    // 링크를 벗어나 버블이 아닌 곳으로 이동하면 잠시 후 숨김
    const to = e.relatedTarget
    if (to && to.closest && to.closest('[data-link-bubble]')) return
    scheduleHideLink()
  }, [scheduleHideLink])

  const openHoverLink = useCallback(() => {
    const href = linkHover?.href
    if (href) window.open(href, '_blank', 'noopener,noreferrer')
  }, [linkHover])

  const editHoverLink = useCallback(async () => {
    const anchor = linkHover?.anchor
    if (!anchor) return
    suppressCommitRef.current = true
    const url = await promptUrl({ title: '링크 URL 편집', initialValue: anchor.getAttribute('href') || 'https://' })
    suppressCommitRef.current = false
    ref.current?.focus()
    if (url) {
      anchor.setAttribute('href', url)
      setLinkHover({ rect: anchor.getBoundingClientRect(), anchor, href: url })
    }
  }, [linkHover])

  const removeHoverLink = useCallback(() => {
    const anchor = linkHover?.anchor
    const parent = anchor?.parentNode
    if (!anchor || !parent) return
    while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor)
    parent.removeChild(anchor)
    ref.current?.normalize?.()
    setLinkHover(null)
    ref.current?.focus()
  }, [linkHover])

  useEffect(() => () => cancelHideLink(), [cancelHideLink])

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
    if (element.isCode) {
      useFlatStore.getState().commitCodeEdit(element.id, editorToPlain(ref.current))
      return
    }
    if (element.isMarkdown) {
      useFlatStore.getState().commitMarkdownEdit(element.id, editorToPlain(ref.current))
      return
    }
    const html = (ref.current?.innerHTML || '').trim()
    const hasInlineStyle = /<(?!br|div|\/div|\/br)([a-z][\s\S]*?)>/i.test(html)
    if (!hasInlineStyle) {
      commitTextEdit(element.id, editorToPlain(ref.current), false)
    } else {
      commitTextEdit(element.id, html, true)
    }
  }, [element.id, element.isCode, element.isMarkdown, commitTextEdit])

  // 오토핏 요소: 입력마다 에디터 실제 높이로 컨테이너 라이브 신축(히스토리 없이, 캐럿 안전)
  const handleInput = useCallback(() => {
    if (!element.autoHeight || !ref.current) return
    useFlatStore.getState().reflowAutoFit({ [element.id]: ref.current.scrollHeight })
  }, [element.autoHeight, element.id])

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
    // Backspace: 캐럿이 줄(블록/div 또는 <br>) 맨 앞에 있을 때 위 줄과 합치기.
    // defaultParagraphSeparator='br'이지만 기존 content에 <div> 구조가 섞이면
    // 브라우저가 Backspace로 <div> 경계를 제대로 합치지 못하는 경우 보완.
    // flex column 컨테이너에서 <br> 구분자도 브라우저 기본 처리가 안 되므로 직접 처리.
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const sel = window.getSelection()
      if (sel && sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0)
        const { startContainer, startOffset } = range
        // 캐럿이 노드 맨 앞(offset 0)이고 현재 노드 자체 또는 부모가 <div>인 경우
        const block = startContainer.nodeType === Node.TEXT_NODE
          ? startContainer.parentElement
          : startContainer
        if (startOffset === 0 && block) {
          const div = block.closest?.('div[contenteditable="true"] > div') ||
                      (block.tagName === 'DIV' && block.parentElement === ref.current ? block : null)
          if (div && div.previousSibling) {
            e.preventDefault()
            e.stopPropagation()
            // 이전 블록의 끝으로 캐럿 이동 후 두 블록 내용을 합침
            const prev = div.previousSibling
            const prevRange = document.createRange()
            prevRange.selectNodeContents(prev)
            prevRange.collapse(false)
            sel.removeAllRanges()
            sel.addRange(prevRange)
            // div의 내용을 prev로 이동(빈 <br>이면 그냥 제거)
            if (div.innerHTML.trim() === '' || div.innerHTML === '<br>') {
              div.remove()
            } else {
              while (div.firstChild) prev.appendChild(div.firstChild)
              div.remove()
            }
            return
          }
          // <br> 줄 구분자 (offset === 0): startContainer부터 위로 올라가며 직전 형제 탐색.
          // span 안 텍스트 / span 자체 등 inline 중첩에서도 동작.
          let brNode = null
          for (let n = startContainer; n && n !== ref.current; n = n.parentElement) {
            if (n.previousSibling) {
              if (n.previousSibling.nodeName === 'BR') brNode = n.previousSibling
              break
            }
          }
          if (brNode) {
            e.preventDefault()
            e.stopPropagation()
            const beforeBr = brNode.previousSibling
            const nr = document.createRange()
            if (beforeBr?.nodeType === Node.TEXT_NODE) {
              nr.setStart(beforeBr, beforeBr.textContent.length)
            } else if (beforeBr) {
              nr.setStartAfter(beforeBr)
            } else {
              const afterBr = brNode.nextSibling
              if (afterBr) nr.setStart(afterBr, 0)
              else nr.setStart(brNode.parentNode, 0)
            }
            nr.collapse(true)
            sel.removeAllRanges()
            sel.addRange(nr)
            brNode.remove()
            return
          }
        }

        // element-level 캐럿 (offset > 0): 직전 자식이 <br>인 경우
        if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
          const prevChild = startContainer.childNodes[startOffset - 1]
          if (prevChild?.nodeName === 'BR') {
            e.preventDefault()
            e.stopPropagation()
            const beforeBr = prevChild.previousSibling
            const nr = document.createRange()
            if (beforeBr?.nodeType === Node.TEXT_NODE) {
              nr.setStart(beforeBr, beforeBr.textContent.length)
            } else if (beforeBr) {
              nr.setStartAfter(beforeBr)
            } else {
              const afterBr = prevChild.nextSibling
              if (afterBr) nr.setStart(afterBr, 0)
              else nr.setStart(startContainer, 0)
            }
            nr.collapse(true)
            sel.removeAllRanges()
            sel.addRange(nr)
            prevChild.remove()
            return
          }
        }
      }
    }

    // Enter → 항상 <br> 직접 삽입 (브라우저가 만드는 div/span 분기 제거 → Backspace 병합 신뢰성 확보)
    // list 안에서는 기본 동작(새 li 생성) 유지.
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (!isCaretInList()) {
        e.preventDefault()
        e.stopPropagation()
        const s = window.getSelection()
        if (s?.rangeCount > 0) {
          const r = s.getRangeAt(0)
          r.deleteContents()
          const br = document.createElement('br')
          r.insertNode(br)
          const nr = document.createRange()
          nr.setStartAfter(br)
          nr.collapse(true)
          s.removeAllRanges()
          s.addRange(nr)
          if (element.autoHeight && ref.current) {
            useFlatStore.getState().reflowAutoFit({ [element.id]: ref.current.scrollHeight })
          }
        }
        return
      }
      e.stopPropagation()
      return
    }

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
    // Ctrl/Cmd+Shift+>(.) / <(,) → 선택 범위 글자 크기 ±
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'Period' || e.code === 'Comma')) {
      e.preventDefault()
      e.stopPropagation()
      changeFontSize(e.code === 'Period' ? FONT_STEP : -FONT_STEP)
      return
    }
    // Ctrl/Cmd+B/I/U → 선택 범위 굵게/이탤릭/밑줄
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase()
      const cmd = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null
      if (cmd) {
        e.preventDefault()
        e.stopPropagation()
        applyCmd(cmd)
        return
      }
    }
    // 모든 키 이벤트를 캔버스로 전파하지 않음
    e.stopPropagation()
  }, [commit, applyLink, toggleList, isCaretInList, refreshSelection, changeFontSize, applyCmd])

  // 세로 정렬: 배경 색 유무와 무관(렌더러와 일치). 명시적 세로정렬·자체flex·병합·도형만 flex.
  const isShape = element.type === 'shape'
  const vAlign = styles.alignItems
  const hasVAlign = vAlign === 'center' || vAlign === 'flex-end'
  const needsFlex = merged || isShape || styles.display === 'flex' || styles.display === 'inline-flex' || hasVAlign

  const editorStyle = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    // 오토핏(autoHeight) 요소는 내용에 따라 줄고 늘게 minHeight를 한 줄로 — 편집 중 라이브 신축
    // 오토핏: 내용에 따라 신축(minHeight 한 줄). 고정 박스: 표시와 동일하게 height 고정 —
    // 안 그러면 편집 시 박스가 글자 전체로 커지며 캔버스를 벗어나 레이아웃이 쏠림(넘침은 overflow visible로 흐름).
    ...(element.autoHeight
      ? { minHeight: (parseFloat(styles.fontSize) || 15) * (parseFloat(styles.lineHeight) || 1.4) }
      : { height }),
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
    // 배경 + 테두리 (코드 블록 신호등 배경 SVG가 편집 중에도 동일 위치/크기로 보이게)
    backgroundColor: styles.backgroundColor || 'transparent',
    backgroundImage: styles.backgroundImage,
    backgroundRepeat: styles.backgroundRepeat,
    backgroundSize: styles.backgroundSize,
    backgroundPosition: styles.backgroundPosition,
    borderRadius: styles.borderRadius,
    border: styles.border,
    boxShadow: styles.boxShadow,
    opacity: styles.opacity,
    // flex 레이아웃. 병합/자체-flex 컨테이너는 가로(기존 동작) 유지.
    // 도형/세로정렬 텍스트는 '세로 방향(column)' flex로 — Enter 줄바꿈이 아래로 쌓이게
    // (가로 flex면 Enter가 만든 블록이 옆으로 붙어 줄바꿈이 안 됨).
    ...(needsFlex ? (
      (merged || styles.isFlex || styles.display === 'flex' || styles.display === 'inline-flex')
        ? {
            display: 'flex',
            alignItems: vAlign || (styles.isFlex ? (styles.alignItems || 'center') : 'center'),
            justifyContent: styles.isFlex
              ? (styles.justifyContent || 'center')
              : (styles.textAlign === 'center' ? 'center'
                : styles.textAlign === 'right' ? 'flex-end' : 'flex-start'),
          }
        : {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: vAlign || 'center', // 세로 정렬(주축)
            alignItems: styles.textAlign === 'left' ? 'flex-start'
              : styles.textAlign === 'right' ? 'flex-end' : 'center', // 가로(교차축)
          }
    ) : {}),
    // 편집 시각 피드백
    outline: '2px solid rgba(99, 102, 241, 0.8)',
    outlineOffset: -1,
    cursor: 'text',
    userSelect: 'text',
    // 편집 중엔 입력 내용이 모두 보이도록 visible — auto면 내용이 박스보다 클 때(예: 줄마다
    // 글자 크기가 다른 rich text) 세로 스크롤바가 생겨 거슬림. 표시 모드도 기본 overflow visible.
    overflow: 'visible',
    // 세로 오프셋(양수=위로)을 편집 중에도 동일 적용 — 표시와 위치 일치(커밋 시 점프 방지).
    ...(parseFloat(styles.baselineOffset) ? { transform: `translateY(${-parseFloat(styles.baselineOffset)}px)` } : {}),
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
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          // 편집 중 붙여넣기는 평문만 — 리치 HTML/이미지가 들어와 깨진 글자가 삽입되는 것 방지
          e.preventDefault()
          const text = e.clipboardData?.getData('text/plain') || ''
          if (text) document.execCommand('insertText', false, text)
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseOver={handleEditorMouseOver}
        onMouseOut={handleEditorMouseOut}
      />
      {linkHover && createPortal(
        <LinkBubble
          rect={linkHover.rect}
          sel={sel}
          href={linkHover.href}
          onOpen={openHoverLink}
          onEdit={editHoverLink}
          onRemove={removeHoverLink}
          onEnter={cancelHideLink}
          onLeave={scheduleHideLink}
        />,
        document.body
      )}
      {/* 데스크톱: 선택 시 플로팅 / 모바일: 편집 중 항상 키보드 위 고정 (OS 선택 메뉴와 중첩 회피) */}
      {(touch || sel) && createPortal(
        <SelectionToolbar sel={sel} mobile={touch} fmt={fmt} onCmd={applyCmd} onFontSize={changeFontSize} onLink={applyLink} />,
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
  const vp = useVisualViewport()
  const touch = useIsTouch()
  const BTN = 28
  const CLUSTER_W = BTN * 3 + 4 * 2 + 8 // 버튼 3 + gap + padding
  const CLUSTER_H = BTN + 4 * 2
  let top = rect.top - CLUSTER_H - 6
  if (top < 8) top = rect.bottom + 4
  let left = Math.min(window.innerWidth - CLUSTER_W - 8, Math.max(8, rect.right - CLUSTER_W))

  if (touch) {
    // 모바일: 항상 떠 있는 고정 서식바 위에 한 단 더 올려 우측 정렬 (키보드 위 / 없으면 화면 하단)
    const dockBase = vp.isKeyboardOpen ? vp.visibleBottom : window.innerHeight
    top = dockBase - SEL_TOOLBAR_H - 8 - CLUSTER_H - 6
    left = window.innerWidth - CLUSTER_W - 8
  } else if (sel) {
    // 선택 바가 동시에 보이고 겹치면 세로로 비켜서기 (선택 바가 우선, 도구 묶음이 양보)
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
        onPointerDown={(e) => { e.preventDefault(); onToggleList(false) }}
        style={toolBtn(listFmt.ul)}>•</button>
      <button type="button" title="번호 매기기 (Ctrl+Shift+7)"
        onPointerDown={(e) => { e.preventDefault(); onToggleList(true) }}
        style={{ ...toolBtn(listFmt.ol), fontSize: 11 }}>1.</button>
      <button type="button" title="이모지·기호 삽입"
        onPointerDown={(e) => { e.preventDefault(); onToggleEmoji() }}
        style={{ ...toolBtn(open), fontSize: 16 }}>😊</button>
      {open && (
        // 모바일: 키보드 위 도킹이라 위로 열어야 가려지지 않음
        <div style={{ position: 'absolute', right: 0, ...(touch ? { bottom: 'calc(100% + 6px)' } : { top: BTN + 8 }) }}>
          <EmojiPicker onPick={onPick} />
        </div>
      )}
    </div>
  )
}

// ── 선택 영역 부분 서식 툴바 ──────────────────────────

function SelectionToolbar({ sel, mobile, fmt, onCmd, onFontSize, onLink }) {
  const vp = useVisualViewport()
  // 데스크톱: 마우스가 툴바 위에 있는 동안 위치 고정 — A−/A+ 연속 클릭으로 글자 크기가 바뀌어
  // 선택 rect가 변해도 버튼이 커서 밑에서 도망가지 않게 한다(hover 벗어나면 다시 따라감).
  const [frozen, setFrozen] = useState(null)
  let top, left
  if (mobile) {
    // 모바일: 선택 유무와 무관하게 키보드 바로 위(없으면 화면 하단)에 가로 중앙 고정
    const dockBase = vp.isKeyboardOpen ? vp.visibleBottom : window.innerHeight
    top = dockBase - SEL_TOOLBAR_H - 8
    left = window.innerWidth / 2
  } else {
    const p = computeSelToolbarPos(sel)
    top = p.top; left = p.left
    if (frozen) { top = frozen.top; left = frozen.left }
  }

  // 툴바 영역 pointerdown/mousedown 기본동작 차단 → 에디터 포커스/선택 유지 (blur 커밋 방지, 터치 포함)
  const keepSelection = (e) => e.preventDefault()
  const cmd = (c, v) => (e) => { e.preventDefault(); onCmd(c, v) }

  return (
    <div
      onMouseDown={keepSelection}
      onPointerDown={keepSelection}
      onMouseEnter={() => { if (!mobile) setFrozen({ top, left }) }}
      onMouseLeave={() => setFrozen(null)}
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
        maxWidth: mobile ? 'calc(100vw - 16px)' : undefined,
        overflowX: mobile ? 'auto' : undefined,
        background: 'rgba(15,23,42,0.97)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <FmtBtn active={fmt.bold} onPointerDown={cmd('bold')} title="굵게 (Ctrl+B)" style={{ fontWeight: 700 }}>B</FmtBtn>
      <FmtBtn active={fmt.italic} onPointerDown={cmd('italic')} title="기울임 (Ctrl+I)" style={{ fontStyle: 'italic' }}>I</FmtBtn>
      <FmtBtn active={fmt.underline} onPointerDown={cmd('underline')} title="밑줄 (Ctrl+U)" style={{ textDecoration: 'underline' }}>U</FmtBtn>
      <Sep />
      <FmtBtn onPointerDown={(e) => { e.preventDefault(); onFontSize(-FONT_STEP) }} title="글자 작게" style={{ fontSize: 11 }}>A−</FmtBtn>
      <FmtBtn onPointerDown={(e) => { e.preventDefault(); onFontSize(FONT_STEP) }} title="글자 크게" style={{ fontSize: 14 }}>A+</FmtBtn>
      <FmtBtn onPointerDown={(e) => { e.preventDefault(); onLink() }} title="링크 (Ctrl+K)">🔗</FmtBtn>
      <Sep />
      <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 1 }}>가</span>
      {TEXT_COLORS.map(c => (
        <Swatch key={c} color={c} round onPointerDown={cmd('foreColor', c)} title={`글자색 ${c}`} />
      ))}
      <Sep />
      {HL_COLORS.map(c => (
        <Swatch key={c} color={c} onPointerDown={cmd('hiliteColor', c)} title={`형광펜 ${c}`} />
      ))}
      <FmtBtn onPointerDown={cmd('hiliteColor', 'transparent')} title="형광펜 지우기" style={{ fontSize: 11 }}>✕</FmtBtn>
    </div>
  )
}

function FmtBtn({ children, active, onPointerDown, title, style }) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
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

function Swatch({ color, round, onPointerDown, title }) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
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

// ── 링크 호버 버블: 열기/편집/제거 ─────────────────────────
function LinkBubble({ rect, sel, href, onOpen, onEdit, onRemove, onEnter, onLeave }) {
  const H = 34
  const W = 240
  const left = Math.max(8, Math.min(window.innerWidth - 248, rect.left))
  const aboveTop = rect.top - H - 6
  const belowTop = rect.bottom + 6
  let top = aboveTop >= 8 ? aboveTop : belowTop // 기본 위, 공간 없으면 아래
  // 텍스트 선택 툴바와 겹치면 반대쪽으로 회피
  if (sel) {
    const tb = computeSelToolbarPos(sel)
    const tbRect = { x0: tb.left - tb.halfW, x1: tb.left + tb.halfW, y0: tb.top, y1: tb.top + tb.height }
    const bubbleRect = (t) => ({ x0: left, x1: left + W, y0: t, y1: t + H })
    if (rectsOverlap(bubbleRect(top), tbRect)) {
      const alt = top === aboveTop ? belowTop : aboveTop
      const fits = alt >= 8 && alt + H <= window.innerHeight - 8 && !rectsOverlap(bubbleRect(alt), tbRect)
      top = fits ? alt : belowTop
    }
  }
  const short = !href ? '(빈 링크)' : (href.length > 36 ? href.slice(0, 35) + '…' : href)
  const noBlur = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn() }
  const btn = {
    border: 'none', background: 'transparent', color: '#cbd5e1',
    fontSize: 12, padding: '4px 7px', borderRadius: 6, cursor: 'pointer',
  }
  return (
    <div
      data-link-bubble
      data-edit-accessory
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed', left, top, zIndex: 10050,
        display: 'flex', alignItems: 'center', gap: 2,
        height: H, padding: '0 4px',
        background: 'rgba(15,23,42,0.97)', color: '#e2e8f0',
        border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)',
      }}
    >
      <button
        onMouseDown={noBlur(onOpen)}
        title={href || ''}
        style={{ ...btn, color: '#93c5fd', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >{short}</button>
      <Sep />
      <button onMouseDown={noBlur(onEdit)} style={btn} title="링크 편집">편집</button>
      <button onMouseDown={noBlur(onRemove)} style={{ ...btn, color: '#fca5a5' }} title="링크 제거">제거</button>
    </div>
  )
}
