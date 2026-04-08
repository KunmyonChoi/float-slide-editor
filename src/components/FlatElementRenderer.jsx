import { useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'

/**
 * FlatElementRenderer
 * 단일 FlatElement를 절대 좌표로 렌더링한다.
 * 클릭으로 선택, 드래그로 이동 (Phase 3에서 추가).
 */
export default function FlatElementRenderer({ element, isSelected, isEditing, scale }) {
  const { setSelectedFlat, setEditingFlat, canvasSize } = useFlatStore()

  const handleMouseDown = useCallback((e) => {
    e.stopPropagation()
    setSelectedFlat(element.id)
    // split 모드: HTML 쪽 선택 해제
    useEditorStore.getState().setSelected(null)
  }, [element.id, setSelectedFlat])

  const handleDoubleClick = useCallback((e) => {
    if (element.type === 'text') {
      e.stopPropagation()
      setEditingFlat(element.id)
    }
  }, [element.id, element.type, setEditingFlat])

  const { x, y, width, height, zIndex, type, content, isRich, merged, styles } = element

  // 전체 캔버스를 덮는 배경 shape → 클릭 통과 (콘텐츠 선택 방해 방지)
  const isFullCanvasBg = type === 'shape' && !content
    && Math.abs(width - canvasSize.w) < 2 && Math.abs(height - canvasSize.h) < 2
    && Math.abs(x) < 2 && Math.abs(y) < 2

  const baseStyle = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    zIndex,
    boxSizing: 'border-box',
    cursor: isFullCanvasBg ? 'default' : 'default',
    pointerEvents: isFullCanvasBg ? 'none' : undefined,
    outline: isSelected
      ? '2px solid rgba(99,102,241,0.8)'
      : undefined,
    outlineOffset: isSelected ? -1 : undefined,
  }

  if (type === 'image') {
    return (
      <div style={baseStyle} onMouseDown={handleMouseDown}>
        <img
          src={content}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: styles.objectFit || 'cover',
            borderRadius: styles.borderRadius,
            border: styles.border,
            opacity: styles.opacity,
            display: 'block',
          }}
        />
      </div>
    )
  }

  if (type === 'text') {
    // border 단축 속성과 개별 속성 충돌 방지 (React 경고)
    const borderProps = resolveBorders(styles)
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: styles.backgroundColor,
          backgroundImage: styles.backgroundImage,
          color: styles.color,
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily,
          fontWeight: styles.fontWeight,
          lineHeight: styles.lineHeight,
          textAlign: styles.textAlign,
          letterSpacing: styles.letterSpacing,
          textTransform: styles.textTransform,
          textDecoration: styles.textDecoration,
          ...(styles.webkitBackgroundClip === 'text' ? {
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: styles.webkitTextFillColor || 'transparent',
          } : {}),
          borderRadius: styles.borderRadius,
          ...borderProps,
          boxShadow: styles.boxShadow,
          opacity: styles.opacity,
          padding: styles.padding,
          overflow: 'visible',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          // 배경이 있는 텍스트 또는 병합 요소: flex로 텍스트 중앙 배치
          ...((merged || (styles.backgroundColor && styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && styles.backgroundColor !== 'transparent')) ? {
            display: 'flex',
            alignItems: styles.isFlex ? (styles.alignItems || 'center') : 'center',
            justifyContent: styles.isFlex ? (styles.justifyContent || 'center') : (styles.textAlign === 'center' ? 'center' : styles.textAlign === 'right' ? 'flex-end' : 'flex-start'),
            ...(styles.gap && styles.gap !== '0px' && styles.gap !== 'normal' ? { gap: styles.gap } : {}),
          } : {}),
          visibility: isEditing ? 'hidden' : undefined,
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        {isRich
          ? <span dangerouslySetInnerHTML={{ __html: content }} />
          : content}
      </div>
    )
  }

  if (type === 'svg') {
    return (
      <div
        style={baseStyle}
        onMouseDown={handleMouseDown}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    )
  }

  // shape (시각적 컨테이너)
  const shapeBorderProps = resolveBorders(styles)
  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        borderRadius: styles.borderRadius,
        ...shapeBorderProps,
        boxShadow: styles.boxShadow,
        opacity: styles.opacity,
      }}
      onMouseDown={handleMouseDown}
    />
  )
}

/**
 * border 단축 속성과 개별 속성이 동시에 존재하면 React 경고가 발생한다.
 * 개별 속성(borderTop 등)이 하나라도 유효하면 단축 속성을 제외하고 개별만 사용한다.
 */
function resolveBorders(s) {
  const hasIndividual = [s.borderTop, s.borderRight, s.borderBottom, s.borderLeft]
    .some(v => v && !v.startsWith('0px'))
  if (hasIndividual) {
    return {
      borderTop: s.borderTop,
      borderRight: s.borderRight,
      borderBottom: s.borderBottom,
      borderLeft: s.borderLeft,
    }
  }
  return { border: s.border }
}
