import { useRef, useEffect, useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'

/**
 * FlatInlineEditor
 * 선택된 텍스트 요소 위에 contentEditable div를 겹쳐 인라인 편집.
 * 요소의 폰트/색상/정렬 스타일을 그대로 적용.
 * blur 또는 Escape로 커밋.
 */
export default function FlatInlineEditor({ element }) {
  const ref = useRef(null)
  const { commitTextEdit } = useFlatStore()
  const committedRef = useRef(false)

  const { x, y, width, height, content, styles, merged } = element

  // 마운트 시 innerHTML 설정 + 포커스 + 커밋 콜백 등록
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = content || ''
    ref.current.focus()
    // 전체 선택
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(ref.current)
    sel.removeAllRanges()
    sel.addRange(range)
    committedRef.current = false

    // 페이지 이동/모드 전환 시 _saveCurrentPage가 이 콜백을 호출하여 커밋
    const flushCommit = () => {
      if (committedRef.current || !ref.current) return
      committedRef.current = true
      const html = (ref.current?.innerHTML || '').trim()
      const stripped = html.replace(/<br\s*\/?>/gi, '')
      const hasHtmlTags = /<[a-z][\s\S]*>/i.test(stripped)
      commitTextEdit(element.id, html, hasHtmlTags)
    }
    useFlatStore.getState()._setPendingEditCommit(flushCommit)

    return () => {
      // unmount 시 미커밋 상태면 커밋 시도
      flushCommit()
      useFlatStore.getState()._setPendingEditCommit(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(() => {
    if (committedRef.current) return
    committedRef.current = true
    const html = (ref.current?.innerHTML || '').trim()
    // <br> 외에 HTML 태그가 있으면 isRich
    const stripped = html.replace(/<br\s*\/?>/gi, '')
    const hasHtmlTags = /<[a-z][\s\S]*>/i.test(stripped)
    commitTextEdit(element.id, html, hasHtmlTags)
  }, [element.id, commitTextEdit])

  const handleBlur = useCallback(() => {
    commit()
  }, [commit])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      commit()
      return
    }
    // 모든 키 이벤트를 캔버스로 전파하지 않음
    e.stopPropagation()
  }, [commit])

  // 배경이 있는 텍스트 / merged 요소의 flex 레이아웃 재현
  const hasBg = styles.backgroundColor
    && styles.backgroundColor !== 'rgba(0, 0, 0, 0)'
    && styles.backgroundColor !== 'transparent'
  const needsFlex = merged || hasBg

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
    padding: styles.padding,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    // 배경
    backgroundColor: styles.backgroundColor || 'transparent',
    backgroundImage: styles.backgroundImage,
    borderRadius: styles.borderRadius,
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
    overflow: 'auto',
  }

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      style={editorStyle}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
