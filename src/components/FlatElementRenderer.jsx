import { useCallback } from 'react'
import { useFlatStore } from '../store/flatStore'

/**
 * FlatElementRenderer
 * 단일 FlatElement를 절대 좌표로 렌더링한다.
 * 클릭으로 선택, 드래그로 이동 (Phase 3에서 추가).
 */
export default function FlatElementRenderer({ element, isSelected, scale }) {
  const { setSelectedFlat } = useFlatStore()

  const handleMouseDown = useCallback((e) => {
    e.stopPropagation()
    setSelectedFlat(element.id)
  }, [element.id, setSelectedFlat])

  const { x, y, width, height, zIndex, type, content, isRich, merged, styles } = element

  const baseStyle = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    zIndex,
    boxSizing: 'border-box',
    cursor: 'default',
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
          border: styles.border,
          borderTop: styles.borderTop,
          borderRight: styles.borderRight,
          borderBottom: styles.borderBottom,
          borderLeft: styles.borderLeft,
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
          } : {}),
        }}
        onMouseDown={handleMouseDown}
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
  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: styles.backgroundColor,
        backgroundImage: styles.backgroundImage,
        borderRadius: styles.borderRadius,
        border: styles.border,
        borderTop: styles.borderTop,
        borderRight: styles.borderRight,
        borderBottom: styles.borderBottom,
        borderLeft: styles.borderLeft,
        boxShadow: styles.boxShadow,
        opacity: styles.opacity,
      }}
      onMouseDown={handleMouseDown}
    />
  )
}
