import { useCallback, useState, useEffect } from 'react'
import { useFlatStore } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { BlobStore } from '../core/BlobStore'

/**
 * FlatElementRenderer
 * 단일 FlatElement를 절대 좌표로 렌더링한다.
 * 클릭으로 선택, 드래그로 이동 (Phase 3에서 추가).
 */
export default function FlatElementRenderer({ element, isSelected, isEditing, scale }) {
  const { setSelectedFlat, toggleSelectFlat, setEditingFlat, canvasSize } = useFlatStore()

  const { x, y, width, height, type, content } = element

  // 전체 캔버스를 덮는 배경 shape 판정
  const isFullCanvasBg = type === 'shape' && !content
    && Math.abs(width - canvasSize.w) < 2 && Math.abs(height - canvasSize.h) < 2
    && Math.abs(x) < 2 && Math.abs(y) < 2

  const handleMouseDown = useCallback((e) => {
    if (isFullCanvasBg) {
      // 배경: stopPropagation 안 함 (마키 공존), 선택은 mouseup에서 처리
      return
    }
    e.stopPropagation()
    e.preventDefault() // 브라우저 텍스트 선택 방지
    if (e.shiftKey) {
      toggleSelectFlat(element.id)
    } else {
      setSelectedFlat(element.id)
    }
    useEditorStore.getState().setSelected(null)
  }, [element.id, isFullCanvasBg, setSelectedFlat, toggleSelectFlat])

  const handleClick = useCallback((e) => {
    if (!isFullCanvasBg) return
    // 마키 드래그 직후면 배경 선택 무시
    if (useFlatStore.getState()._skipBgClick) return
    // 배경 클릭 (드래그 없이) → 선택
    if (e.shiftKey) {
      toggleSelectFlat(element.id)
    } else {
      setSelectedFlat(element.id)
    }
    useEditorStore.getState().setSelected(null)
  }, [element.id, isFullCanvasBg, setSelectedFlat, toggleSelectFlat])

  const handleDoubleClick = useCallback((e) => {
    if (element.type === 'text') {
      e.stopPropagation()
      setEditingFlat(element.id)
    } else if (element.type === 'image') {
      e.stopPropagation()
      useFlatStore.getState().setCroppingFlat(element.id)
    }
  }, [element.id, element.type, setEditingFlat])

  const { zIndex, isRich, merged, styles } = element

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
      ? `2px solid ${element.locked ? 'rgba(148,163,184,0.6)' : 'rgba(99,102,241,0.8)'}`
      : undefined,
    outlineOffset: isSelected ? -1 : undefined,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    transformOrigin: element.rotation ? 'center center' : undefined,
  }

  if (type === 'image') {
    return (
      <div style={baseStyle} onMouseDown={handleMouseDown} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <img
          src={content}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: styles.objectFit || 'cover',
            objectPosition: styles.objectPosition || 'center center',
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
    const isGradientText = styles.webkitBackgroundClip === 'text'

    // 그래디언트 텍스트: backgroundImage + clip은 내부 span에, backgroundColor는 외부 div에
    // text-shadow는 투명 fill을 통해 비치므로 drop-shadow filter로 대체
    const gradientTextStyle = isGradientText ? {
      backgroundImage: styles.backgroundImage,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: styles.webkitTextFillColor || 'transparent',
      filter: textShadowToDropShadow(styles.textShadow),
    } : null

    const textContent = isRich
      ? <span dangerouslySetInnerHTML={{ __html: content }} />
      : content

    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: styles.backgroundColor,
          // 그래디언트 텍스트가 아닐 때만 외부 div에 backgroundImage 적용
          ...(!isGradientText ? { backgroundImage: styles.backgroundImage } : {}),
          color: styles.color,
          fontSize: styles.fontSize,
          fontFamily: styles.fontFamily,
          fontWeight: styles.fontWeight,
          fontStyle: styles.fontStyle,
          fontVariationSettings: styles.fontVariationSettings,
          fontFeatureSettings: styles.fontFeatureSettings,
          lineHeight: styles.lineHeight,
          textAlign: styles.textAlign,
          letterSpacing: styles.letterSpacing,
          textTransform: styles.textTransform,
          textDecoration: styles.textDecoration,
          borderRadius: styles.borderRadius,
          ...borderProps,
          boxShadow: styles.boxShadow,
          // 그래디언트 텍스트: textShadow는 내부 span의 drop-shadow로 처리
          textShadow: isGradientText ? undefined : styles.textShadow,
          opacity: styles.opacity,
          padding: styles.padding,
          overflow: (styles.overflow === 'hidden' || styles.overflow === 'auto' || styles.overflow === 'scroll' ||
                     styles.overflowX === 'hidden' || styles.overflowX === 'auto' || styles.overflowX === 'scroll')
            ? 'hidden' : 'visible',
          whiteSpace: styles.whiteSpace || 'pre-wrap',
          wordBreak: styles.whiteSpace === 'nowrap' ? 'normal' : 'break-word',
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
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {isGradientText
          ? <span style={gradientTextStyle}>{textContent}</span>
          : textContent}
      </div>
    )
  }

  if (type === 'video') {
    return (
      <div style={baseStyle} onMouseDown={handleMouseDown} onClick={handleClick}>
        <div style={{
          width: '100%', height: '100%', position: 'relative',
          borderRadius: styles.borderRadius,
          overflow: 'hidden',
          opacity: styles.opacity,
        }}>
          {BlobStore.isIdbRef(content)
            ? <IdbVideo src={content} />
            : <iframe
                src={content}
                style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
          }
        </div>
      </div>
    )
  }

  if (type === 'svg') {
    return (
      <div
        style={baseStyle}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
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
      onClick={handleClick}
    />
  )
}

/**
 * CSS text-shadow → CSS filter drop-shadow 변환
 * 그래디언트 텍스트에서 text-shadow가 투명 fill을 통해 비치는 문제 해결
 * drop-shadow()는 시각적 렌더링 결과의 그림자를 생성한다.
 * 주의: drop-shadow는 spread를 지원하지 않으므로 offsetX offsetY blur color만 변환
 */
function textShadowToDropShadow(textShadow) {
  if (!textShadow || textShadow === 'none') return undefined
  // 다중 그림자: 각각 drop-shadow()로 변환하여 연결
  // text-shadow: 2px 3px 4px rgba(0,0,0,0.5), ...
  // → filter: drop-shadow(2px 3px 4px rgba(0,0,0,0.5)) ...
  const parts = []
  let depth = 0, current = ''
  for (const ch of textShadow) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = '' }
    else current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts.map(p => `drop-shadow(${p})`).join(' ')
}

/**
 * border 단축 속성과 개별 속성이 동시에 존재하면 React 경고가 발생한다.
 * 개별 속성(borderTop 등)이 하나라도 유효하면 단축 속성을 제외하고 개별만 사용한다.
 *
 * 시각적 테두리가 없는 경우 `border: 'none'`을 명시적으로 반환한다.
 * dom-to-image-more 캡처 시 Tailwind 프리플라이트의 `border-style: solid`가
 * 인라인 스타일에 포함되면서 `border-width` 값이 누락될 경우 기본값(medium=3px)이
 * 적용되어 예상치 못한 테두리가 나타나는 문제를 방지한다.
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
  // 단축 속성에 실제 보이는 테두리 값이 있는 경우만 사용
  if (s.border && s.border !== '' && !s.border.startsWith('0px')) {
    return { border: s.border }
  }
  // 테두리 없음을 명시적으로 선언 — dom-to-image 렌더링 아티팩트 방지
  return { border: 'none' }
}

/**
 * IndexedDB 참조 비디오 — blob URL로 <video> 렌더링
 */
function IdbVideo({ src }) {
  const [blobUrl, setBlobUrl] = useState(null)
  useEffect(() => {
    if (!BlobStore.isIdbRef(src)) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(src)).then(url => {
      if (!cancelled) setBlobUrl(url)
    })
    return () => { cancelled = true }
  }, [src])

  if (!blobUrl) {
    return <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>로딩...</span>
    </div>
  }
  return (
    <video
      src={blobUrl}
      style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
      muted
      playsInline
    />
  )
}
