import { useCallback, useState, useEffect } from 'react'
import { useFlatStore, isBackgroundLayer } from '../store/flatStore'
import { useEditorStore } from '../store/editorStore'
import { BlobStore } from '../core/BlobStore'
import { pointsToSvgPath, connectorCurvePath, connectorLabelMid } from '../core/PolyShapeUtils'
import { tableContainerStyle, cellStyle } from '../core/slideTable'
import { isCoarsePointer } from '../core/pointerEnv'
import AudioVisualizer from './AudioVisualizer'

/**
 * FlatElementRenderer
 * 단일 FlatElement를 절대 좌표로 렌더링한다.
 * 클릭으로 선택, 드래그로 이동 (Phase 3에서 추가).
 */
export default function FlatElementRenderer({ element, isSelected, isEditing, scale, canvasSize: canvasSizeProp }) {
  // 개별 선택자 구독 — 스토어 전체를 구독하면 현재 페이지 변경 등 무관한 갱신마다
  // 모든 인스턴스(특히 썸네일)가 재렌더되어 깜빡임(움찔)이 생긴다. 함수는 안정 참조.
  const setSelectedFlat = useFlatStore(s => s.setSelectedFlat)
  const toggleSelectFlat = useFlatStore(s => s.toggleSelectFlat)
  const selectFlatGroupAware = useFlatStore(s => s.selectFlatGroupAware)
  const setEditingFlat = useFlatStore(s => s.setEditingFlat)
  // 썸네일·발표 등 비현재 페이지는 그 페이지의 canvasSize(prop)를 사용 → 배경/레이아웃
  // 판정이 '현재 페이지'에 좌우되지 않음. prop이 있으면 스토어 canvasSize를 구독하지 않아
  // (선택자 결과가 상수) 현재 페이지 변경 시 재렌더되지 않는다.
  const canvasSize = useFlatStore(s => canvasSizeProp || s.canvasSize)

  const { x, y, width, height, type, content } = element

  // 배경 레이어 판정(명시 플래그 또는 전체 캔버스 덮는 shape).
  // 배경은 캔버스에서 클릭으로 선택되지 않음 — pointer-events:none으로 클릭이
  // 위 요소/빈 캔버스로 통과(속성창 '배경 레이어'에서만 선택).
  const isFullCanvasBg = isBackgroundLayer(element, canvasSize)

  const handleMouseDown = useCallback((e) => {
    // 그리기 모드 중에는 요소 선택 차단
    if (useFlatStore.getState().drawMode) return
    // 다이어그램 모드 + Alt/⌘(Cmd) 드래그 → 이 도형에서 커넥터 시작(이동 대신)
    // (Ctrl은 맥에서 우클릭=컨텍스트 메뉴라 제외)
    const st = useFlatStore.getState()
    if (st.diagramMode && (e.altKey || e.metaKey)
        && element.shapeType !== 'connector' && !isFullCanvasBg) {
      e.stopPropagation(); e.preventDefault()
      const cur = st.flatElements.find(el => el.id === element.id) || element
      st.beginConnectorFrom(element.id, { x: cur.x + cur.width / 2, y: cur.y + cur.height / 2 })
      return
    }
    if (isFullCanvasBg) {
      // 배경: stopPropagation 안 함 (마키 공존), 선택은 mouseup에서 처리
      return
    }
    e.stopPropagation()
    e.preventDefault() // 브라우저 텍스트 선택 방지
    selectFlatGroupAware(element.id, e.shiftKey)
    useEditorStore.getState().setSelected(null)
  }, [element.id, isFullCanvasBg, selectFlatGroupAware])

  const handleClick = useCallback((e) => {
    if (useFlatStore.getState().drawMode) return
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
    if (element.type === 'text' || element.type === 'table' || element.shapeType === 'connector') {
      e.stopPropagation() // 커넥터: 라벨 인라인 편집 진입
      setEditingFlat(element.id)
    } else if (element.type === 'image') {
      e.stopPropagation()
      useFlatStore.getState().setCroppingFlat(element.id)
    }
  }, [element.id, element.type, element.shapeType, setEditingFlat])

  const { zIndex, isRich, merged, styles } = element

  const baseStyle = {
    position: 'absolute',
    left: x,
    top: y,
    width,
    height,
    // 배경 레이어는 항상 모든 콘텐츠(텍스트 등) 아래로 렌더 — 모델 zIndex와 무관하게 보장.
    // (모델 z는 그대로 두고 렌더 z만 큰 음수로 오프셋)
    zIndex: isFullCanvasBg ? zIndex - 1000000 : zIndex,
    boxSizing: 'border-box',
    cursor: 'default',
    // 배경 레이어: 클릭이 통과(선택 안 됨) — 단, 패널에서 선택된 동안엔 정상 처리.
    // clickThrough(예: '피사체 뒤 텍스트' 전경 컷아웃): 그룹에 속한 동안만 통과 → 아래 텍스트 클릭 가능
    //   (그룹 선택으로 함께 조작되므로 직접 클릭 불필요). 그룹 해제 시엔 다시 선택/수정 가능.
    pointerEvents: (element.clickThrough && element.groupId) ? 'none' : ((isFullCanvasBg && !isSelected) ? 'none' : undefined),
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
        <ImageContent content={content} styles={styles} />
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
      // 외곽선(텍스트 스트로크) — 그래디언트 텍스트는 내부 span에 적용
      ...(styles.textStroke && styles.textStroke !== 'none' ? { WebkitTextStroke: styles.textStroke, paintOrder: 'stroke fill' } : {}),
    } : null

    // 빈 레이아웃 텍스트: 흐린 안내문(placeholder) 표시 — 입력 시작하면 사라짐
    const showPlaceholder = !isEditing && !content && !!element.placeholder
    const textContent = isRich
      ? <span dangerouslySetInnerHTML={{ __html: content }} />
      : content

    return (
      <div
        className={element.isMarkdown ? 'flat-text flat-md' : 'flat-text'}
        style={{
          ...baseStyle,
          backgroundColor: styles.backgroundColor,
          // 그래디언트 텍스트가 아닐 때만 외부 div에 backgroundImage 적용
          // (코드 블록 신호등 등 배경 SVG는 size/position/repeat까지 따라가야 타일링·늘어남 방지)
          ...(!isGradientText ? {
            backgroundImage: styles.backgroundImage,
            backgroundRepeat: styles.backgroundRepeat,
            backgroundSize: styles.backgroundSize,
            backgroundPosition: styles.backgroundPosition,
          } : {}),
          color: showPlaceholder ? 'rgba(100,116,139,0.6)' : styles.color,
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
          // 외곽선(텍스트 스트로크) — 그래디언트가 아니면 div에 직접 적용
          ...(!isGradientText && styles.textStroke && styles.textStroke !== 'none' ? { WebkitTextStroke: styles.textStroke, paintOrder: 'stroke fill' } : {}),
          opacity: styles.opacity,
          padding: styles.padding,
          overflow: (styles.overflow === 'hidden' || styles.overflow === 'auto' || styles.overflow === 'scroll' ||
                     styles.overflowX === 'hidden' || styles.overflowX === 'auto' || styles.overflowX === 'scroll')
            ? 'hidden' : 'visible',
          whiteSpace: styles.whiteSpace || 'pre-wrap',
          wordBreak: styles.whiteSpace === 'nowrap' ? 'normal' : 'break-word',
          // 세로 정렬: 배경 색 유무와 무관하게 alignItems(세로정렬 설정)에만 의존.
          // 미설정이면 위(블록 흐름)가 기본. flex는 명시적 세로정렬·자체 flex·병합 요소일 때만.
          ...(() => {
            const isSelfFlex = styles.display === 'flex' || styles.display === 'inline-flex'
            const vAlign = styles.alignItems // 'flex-start' | 'center' | 'flex-end' | undefined
            // 명시적 수직정렬(위/중/아래)이면 셋 다 flex로 통일 — 위만 block-flow로 빠지면
            // border 등과 겹칠 때 정렬이 어긋나 보인다. 미설정(undefined)일 때만 블록 흐름(위).
            const hasVAlign = vAlign === 'center' || vAlign === 'flex-end' || vAlign === 'flex-start'
            if (!isSelfFlex && !merged && !hasVAlign) return {} // 기본: 위(블록 흐름)
            // 병합/자체-flex 컨테이너는 가로(기존 동작) 유지
            if (isSelfFlex || merged || styles.isFlex) {
              return {
                display: 'flex',
                alignItems: vAlign || (styles.isFlex ? (styles.alignItems || 'center') : 'center'),
                justifyContent: isSelfFlex ? (styles.justifyContent || 'center') : styles.isFlex ? (styles.justifyContent || 'center') : (styles.textAlign === 'center' ? 'center' : styles.textAlign === 'right' ? 'flex-end' : 'flex-start'),
                ...(styles.gap && styles.gap !== '0px' && styles.gap !== 'normal' ? { gap: styles.gap } : {}),
              }
            }
            // 명시적 세로정렬 텍스트: 세로 방향(column) flex — 여러 줄이 아래로 쌓이게
            return {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: vAlign || 'center', // 세로 정렬(주축)
              alignItems: styles.textAlign === 'center' ? 'center' : styles.textAlign === 'right' ? 'flex-end' : 'flex-start', // 가로(교차축)
            }
          })(),
          visibility: isEditing ? 'hidden' : undefined,
          // 빈 플레이스홀더: 점선 테두리로 배경색과 무관하게 위치 표시(선택 시엔 선택 외곽선 우선)
          ...(showPlaceholder && !isSelected
            ? { outline: '1px dashed rgba(148,163,184,0.5)', outlineOffset: -1 }
            : {}),
        }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {(() => {
          const inner = showPlaceholder
            ? element.placeholder
            : isGradientText
              ? <span style={gradientTextStyle}>{textContent}</span>
              : textContent
          // 세로 오프셋(양수=위로): 박스(배경/테두리)는 고정, 텍스트만 이동.
          // offset 있을 때만 내부 래퍼로 감싸 transform(없으면 DOM 동일 = 기존 무영향).
          const off = parseFloat(styles.baselineOffset) || 0
          if (!off) return inner
          return <div style={{ transform: `translateY(${-off}px)` }}>{inner}</div>
        })()}
      </div>
    )
  }

  if (type === 'video') {
    const isPresent = useEditorStore.getState().mode === 'present'
    // 배경 영상은 '라이브 배경' — 편집/발표 모드 모두에서 자동재생·루프·음소거·컨트롤 숨김으로
    // 캔버스를 꽉 채워 보이게 한다. 일반 영상은 발표 모드에서만 재생.
    const isBgVideo = isFullCanvasBg
    const autoplay = isBgVideo ? true : (element.autoplay ?? false)
    const loop = isBgVideo ? true : (element.loop ?? false)
    const muted = isBgVideo ? true : (element.muted ?? true)
    const hideControls = isBgVideo ? true : (element.hideControls ?? false)
    const playNow = isBgVideo || isPresent
    const vidFit = isBgVideo ? 'cover' : undefined

    // 직접 미디어 파일 URL(data:/blob:/http .mp4 등)인지 — 임베드(YouTube/Vimeo)와 구분.
    // 임베드는 <iframe>, 직접 파일은 네이티브 <video>로 재생한다(import된 <video> 추출 포함).
    const isEmbed = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i.test(content || '')
    const isDirectVideo = !BlobStore.isIdbRef(content) && !isEmbed && !!content

    // YouTube/Vimeo embed URL에 파라미터 추가
    let embedSrc = content
    if (!BlobStore.isIdbRef(content)) {
      const params = []
      if (playNow && autoplay) params.push('autoplay=1')
      if (muted) params.push('mute=1')
      if (loop) {
        params.push('loop=1')
        // YouTube loop에는 playlist 파라미터 필요
        const ytMatch = content.match(/youtube\.com\/embed\/([^?&]+)/)
        if (ytMatch) params.push(`playlist=${ytMatch[1]}`)
      }
      if (hideControls) {
        params.push('controls=0')
        params.push('showinfo=0')      // 제목 숨기기
        params.push('rel=0')           // 관련 영상 숨기기
        params.push('modestbranding=1') // YouTube 로고 최소화
        params.push('iv_load_policy=3') // 주석(annotations) 숨기기
        params.push('disablekb=1')      // 키보드 단축키 비활성화
      }
      if (params.length > 0) {
        const sep = content.includes('?') ? '&' : '?'
        embedSrc = `${content}${sep}${params.join('&')}`
      }
    }

    return (
      <div style={baseStyle} onMouseDown={handleMouseDown} onClick={handleClick}>
        <div style={{
          width: '100%', height: '100%', position: 'relative',
          borderRadius: styles.borderRadius,
          overflow: 'hidden',
          opacity: styles.opacity,
        }}>
          {(BlobStore.isIdbRef(content) || isDirectVideo)
            ? <VideoPlayer
                content={content}
                playNow={playNow}
                autoplay={autoplay}
                loop={loop}
                muted={muted}
                hideControls={hideControls}
                objectFit={vidFit}
              />
            : <>
                <iframe
                  src={playNow ? embedSrc : content}
                  style={{ width: '100%', height: '100%', border: 'none', pointerEvents: (playNow && !hideControls) ? 'auto' : 'none' }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
                {hideControls && <div style={{ position: 'absolute', inset: 0, zIndex: 1 }} />}
              </>
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

  if (type === 'table' && element.table) {
    const t = element.table
    return (
      <div
        style={{ ...baseStyle, visibility: isEditing ? 'hidden' : undefined }}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <table style={tableContainerStyle(styles)}>
          <colgroup>
            {t.colFractions.map((f, c) => <col key={c} style={{ width: `${f * 100}%` }} />)}
          </colgroup>
          <tbody>
            {t.cells.map((row, r) => (
              <tr key={r} style={{ height: `${t.rowFractions[r] * 100}%` }}>
                {row.map((cell, c) => cell.covered ? null : (
                  <td
                    key={c}
                    colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    style={cellStyle(t, r, c, styles)}
                  >{cell.text}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // 포인트 기반 shape (선, 폴리라인, 폴리곤)
  if (element.shapeType && element.points && element.points.length >= 2) {
    // 곡선 커넥터: ConnectorRouting이 변 수직 진출 기준으로 계산한 element.curve(제어점) 사용.
    const curve = element.routing === 'curved' && !element.closed && element.points.length === 2
      ? element.curve : null
    const isCurved = !!curve
    const d = isCurved ? connectorCurvePath(element.points, curve) : pointsToSvgPath(element.points, element.closed)
    const sw = parseFloat(styles.strokeWidth || '2')
    const strokeColor = styles.stroke || '#1e293b'
    const startArrow = element.startArrow || 'none'
    const endArrow = element.endArrow || 'none'
    const markerId = element.id
    // 화살표 마커 크기 — 선 두께에 따라 적당히 커진다(viewBox 0..12를 aMark px로 스케일).
    const aMark = Math.max(12, Math.min(32, Math.round(9 + sw * 2)))
    // 열린(뼈대) 화살표의 선 굵기를 본선 두께에 맞춘다(viewBox 단위로 환산) — 두꺼운 선에서
    // V가 가늘어 따로 노는 문제 방지. 렌더 px ≈ openSw * aMark/12 = sw.
    const openSw = Math.max(1.2, sw * 12 / aMark)
    // 보이는 선은 끝에서 안쪽으로 살짝 당긴다 — 마커(화살표)는 전체 길이 경로(투명)에 두어
    // 끝점/방향(도형 경계 위치)은 유지. 화살표 있는 끝: 화살표 길이만큼(앞 삐져나옴 방지).
    // 커넥터의 화살표 없는 끝: 선 두께만큼(두꺼운 선 끝이 도형을 가리지 않게). 일반 선은 안 당김.
    const isConn = element.shapeType === 'connector'
    const isTouch = isCoarsePointer() // 히트 폭 결정용(비반응형 — 리스너/상태 없이 1회 질의)
    const endInset = (k) => {
      if (k === 'triangle') return aMark * 0.8          // 채운 삼각: 선은 밑변까지(앞 삐져나옴 방지)
      if (k === 'circle' || k === 'diamond') return aMark * 0.5
      // 열린 화살표('arrow'): 선이 팁까지 가고 V 팔이 머리 → 두께만큼만 살짝(빈 공간 방지).
      // 화살표 없는 끝: 커넥터만 두께만큼 띄움(도형 안 가림), 일반 선은 그대로.
      if (k === 'arrow') return sw * 0.5 + 1
      return isConn ? sw * 0.5 + 1 : 0
    }
    const dVisible = (() => {
      const pts = element.points
      // 닫힌 도형(폴리곤)은 끝점 개념이 없어 당기면 외곽선이 일그러짐 → 원본 유지
      if (element.closed) return d
      const insetStart = endInset(startArrow)
      const insetEnd = endInset(endArrow)
      if ((insetStart <= 0 && insetEnd <= 0) || !pts || pts.length < 2) return d
      const moveToward = (p, q, inset) => {
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
        const t = Math.min(inset, len * 0.45) / len
        return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
      }
      if (isCurved) {
        // 곡선: 끝점을 접선(제어점) 방향으로 당김 — 제어점은 유지
        const s = insetStart > 0 ? moveToward(pts[0], curve.c1, insetStart) : pts[0]
        const e = insetEnd > 0 ? moveToward(pts[1], curve.c2, insetEnd) : pts[1]
        return connectorCurvePath([s, e], curve)
      }
      const out = pts.map(p => ({ ...p }))
      out[0] = insetStart > 0 ? moveToward(out[0], out[1], insetStart) : out[0]
      const li = out.length - 1
      out[li] = insetEnd > 0 ? moveToward(out[li], out[li - 1], insetEnd) : out[li]
      return pointsToSvgPath(out, element.closed)
    })()

    // 라벨(content) — 커넥터 전용. 직선/곡선 중점에 칩으로 표시(클릭은 통과).
    const labelText = element.shapeType === 'connector' ? (element.content || '').trim() : ''
    const labelMid = labelText ? connectorLabelMid(element.points, curve) : null
    return (
      // 컨테이너는 클릭 통과(빈 bbox가 뒤 도형을 가리지 않게). 실제 히트는 선/면 path만 받는다.
      // (path가 pointer-events:auto면 이벤트가 div로 버블되어 onClick/onMouseDown은 정상 동작)
      // 커넥터는 대각선 bbox라 선택 아웃라인(사각 boundary)이 의미 없음 → 숨기고 끝점 핸들로만 표시.
      <div style={{ ...baseStyle, overflow: 'visible', pointerEvents: 'none',
        outline: isConn ? undefined : baseStyle.outline, outlineOffset: isConn ? undefined : baseStyle.outlineOffset }}
        onMouseDown={handleMouseDown} onClick={handleClick} onDoubleClick={handleDoubleClick}>
        <svg
          width={width} height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          <defs>
            {startArrow !== 'none' && (
              <marker id={`ms-${markerId}`} markerWidth={aMark} markerHeight={aMark} viewBox="0 0 12 12" refX="10" refY="6"
                      orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                {startArrow === 'arrow' && <path d="M 0 1 L 10 6 L 0 11" fill="none" stroke={strokeColor} strokeWidth={openSw} strokeLinecap="round" strokeLinejoin="round" />}
                {startArrow === 'triangle' && <path d="M 0 1 L 10 6 L 0 11 Z" fill={strokeColor} />}
                {startArrow === 'circle' && <circle cx="6" cy="6" r="4" fill={strokeColor} />}
                {startArrow === 'diamond' && <path d="M 6 0 L 12 6 L 6 12 L 0 6 Z" fill={strokeColor} />}
              </marker>
            )}
            {endArrow !== 'none' && (
              <marker id={`me-${markerId}`} markerWidth={aMark} markerHeight={aMark} viewBox="0 0 12 12" refX="10" refY="6"
                      orient="auto" markerUnits="userSpaceOnUse">
                {endArrow === 'arrow' && <path d="M 0 1 L 10 6 L 0 11" fill="none" stroke={strokeColor} strokeWidth={openSw} strokeLinecap="round" strokeLinejoin="round" />}
                {endArrow === 'triangle' && <path d="M 0 1 L 10 6 L 0 11 Z" fill={strokeColor} />}
                {endArrow === 'circle' && <circle cx="6" cy="6" r="4" fill={strokeColor} />}
                {endArrow === 'diamond' && <path d="M 6 0 L 12 6 L 6 12 L 0 6 Z" fill={strokeColor} />}
              </marker>
            )}
          </defs>
          {/* 전체 길이(투명) — 히트영역 겸 마커(화살표) 캐리어: 끝점/방향 유지.
              열린 선=stroke만, 닫힌 도형=면 포함(all) 클릭 가능(빈 bbox는 통과).
              얇은 선을 모바일에서 쉽게 잡도록 히트 폭을 화면 기준으로 넓힌다(터치 24·데스크톱 12px). */}
          <path d={d} stroke="transparent" strokeWidth={Math.max(sw, (isTouch ? 24 : 12) / (scale || 1))} fill="none"
            pointerEvents={element.closed ? 'all' : 'stroke'}
            markerStart={startArrow !== 'none' ? `url(#ms-${markerId})` : undefined}
            markerEnd={endArrow !== 'none' ? `url(#me-${markerId})` : undefined} />
          {/* 보이는 선 — 화살표 있는 끝은 짧게(겹침 방지) */}
          <path
            d={dVisible}
            stroke={strokeColor}
            strokeWidth={sw}
            strokeDasharray={styles.strokeDasharray || ''}
            fill={element.closed ? (styles.fill || 'none') : 'none'}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={styles.opacity || 1}
          />
        </svg>
        {labelMid && (
          <div style={{
            position: 'absolute', left: labelMid.x, top: labelMid.y, transform: 'translate(-50%, -50%)',
            padding: '1px 6px', borderRadius: 5, pointerEvents: 'none', whiteSpace: 'nowrap',
            background: 'rgba(255,255,255,0.92)', color: styles.stroke || '#1e293b',
            fontSize: styles.fontSize || '13px', fontFamily: styles.fontFamily || 'sans-serif',
            lineHeight: 1.3, boxShadow: '0 0 0 1px rgba(0,0,0,0.06)',
          }}>{labelText}</div>
        )}
      </div>
    )
  }

  if (type === 'audio') {
    const isPresent = useEditorStore.getState().mode === 'present'
    return (
      <div style={baseStyle} onMouseDown={handleMouseDown} onClick={handleClick}>
        <AudioVisualizer element={element} playNow={isPresent} />
      </div>
    )
  }

  // shape (시각적 컨테이너 — 텍스트 내용 가능)
  const shapeBorderProps = resolveBorders(styles)
  const bgImage = styles.backgroundImage
  const hasIdbBg = bgImage && bgImage.includes('idb://')

  const shapeContentStyle = content ? {
    color: styles.color || '#000',
    fontSize: styles.fontSize || '16px',
    fontFamily: styles.fontFamily || 'sans-serif',
    fontWeight: styles.fontWeight || '400',
    fontStyle: styles.fontStyle || 'normal',
    lineHeight: styles.lineHeight || '1.5',
    textAlign: styles.textAlign || 'center',
    letterSpacing: styles.letterSpacing,
    padding: styles.padding || '8px',
    // 세로 방향 flex — Enter 줄바꿈이 아래로 쌓이도록(가로 flex면 블록이 옆으로 붙음).
    display: 'flex',
    flexDirection: 'column',
    // 세로 정렬(주축): 설정값 존중, 미설정이면 가운데(도형 텍스트 기본). 편집기/속성패널과 일치.
    justifyContent: styles.alignItems || 'center',
    // 가로 정렬(교차축): textAlign 기반
    alignItems: styles.textAlign === 'left' ? 'flex-start'
      : styles.textAlign === 'right' ? 'flex-end' : 'center',
    width: '100%', height: '100%',
    overflow: 'hidden',
    wordBreak: 'break-word',
  } : undefined

  const shapeStyle = {
    ...baseStyle,
    backgroundColor: styles.backgroundColor,
    backgroundImage: hasIdbBg ? undefined : bgImage,
    backgroundSize: styles.backgroundSize,
    backgroundPosition: styles.backgroundPosition,
    borderRadius: styles.borderRadius,
    ...shapeBorderProps,
    boxShadow: styles.boxShadow,
    opacity: styles.opacity,
  }

  if (hasIdbBg) {
    return (
      <IdbBgShape
        baseStyle={baseStyle}
        styles={styles}
        shapeBorderProps={shapeBorderProps}
        bgImageStr={bgImage}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        content={content}
        contentStyle={shapeContentStyle}
        isRich={element.isRich}
      />
    )
  }

  const partialFill = renderPartialFill(element)
  return (
    <div style={partialFill ? { ...shapeStyle, overflow: 'hidden' } : shapeStyle} onMouseDown={handleMouseDown} onClick={handleClick}>
      {partialFill}
      {content && (
        element.isRich
          ? <div style={shapeContentStyle} dangerouslySetInnerHTML={{ __html: content }} />
          : <div style={shapeContentStyle}>{content}</div>
      )}
    </div>
  )
}

/**
 * 부분 채우기(메타속성) — fillRatio(0~1)·fillDir·fillColor로 도형 일부만 솔리드로 채움.
 * 진행률 막대/악센트용. PPT 변환 시 별도 솔리드 사각형(네이티브 도형)으로 출력.
 */
export function renderPartialFill(el) {
  const r = el.fillRatio
  if (r == null || !(r > 0) || !el.fillColor) return null
  const pct = Math.max(0, Math.min(1, r)) * 100
  const dir = el.fillDir || 'left'
  const base = { position: 'absolute', background: el.fillColor, pointerEvents: 'none' }
  let pos
  if (dir === 'right') pos = { right: 0, top: 0, bottom: 0, width: pct + '%' }
  else if (dir === 'top') pos = { left: 0, right: 0, top: 0, height: pct + '%' }
  else if (dir === 'bottom') pos = { left: 0, right: 0, bottom: 0, height: pct + '%' }
  else pos = { left: 0, top: 0, bottom: 0, width: pct + '%' } // left(기본)
  return <div style={{ ...base, ...pos }} />
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
 * 비디오 첫 프레임을 poster용 PNG data URL로 캡처한다.
 * #t=0.1 미디어 프래그먼트는 preload=metadata에선 프레임을 디코드·페인트하지 않아
 * (스피커/빈 미디어 아이콘만 표시됨) 별도 video를 로드해 첫 프레임을 캔버스로 굽는다.
 * blob:/data: 소스는 taint 없이 캡처 가능, 외부 cross-origin은 실패 시 null(폴백).
 */
function useVideoPoster(url, enabled) {
  // url을 함께 저장해, 새 영상으로 바뀌면 이전 poster가 잠깐 비치지 않게 한다
  // (effect 본문에서 동기 setState를 피하려 상태 초기화 대신 url 매칭으로 처리).
  const [state, setState] = useState({ url: null, poster: null })
  useEffect(() => {
    if (!enabled || !url) return
    let cancelled = false
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    v.crossOrigin = 'anonymous'
    v.playsInline = true
    const cleanup = () => {
      v.removeEventListener('loadeddata', onLoaded)
      v.removeEventListener('seeked', onSeeked)
      v.removeAttribute('src')
      v.load()
    }
    const capture = () => {
      if (cancelled) return
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth || 0
        c.height = v.videoHeight || 0
        if (c.width && c.height) {
          c.getContext('2d').drawImage(v, 0, 0)
          setState({ url, poster: c.toDataURL('image/png') })
        }
      } catch { /* taint 등 → 폴백(poster 없음) */ }
      cleanup()
    }
    const onLoaded = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2) } catch { capture() } }
    const onSeeked = () => capture()
    v.addEventListener('loadeddata', onLoaded)
    v.addEventListener('seeked', onSeeked)
    v.src = url
    return () => { cancelled = true; cleanup() }
  }, [url, enabled])
  return state.url === url ? state.poster : null
}

/**
 * 이미지 요소 — content가 idb:// 참조면 blob URL로 해석해 표시(데이터/HTTP URL은 그대로).
 * (피사체 뒤 텍스트 컷아웃 등 idb 저장 이미지가 안 보이던 문제 수정)
 */
function ImageContent({ content, styles }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  useEffect(() => {
    if (!isIdb) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content)).then(u => { if (!cancelled) setIdbUrl(u) })
    return () => { cancelled = true }
  }, [content, isIdb])
  const src = isIdb ? idbUrl : content
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        width: '100%',
        height: '100%',
        objectFit: styles.objectFit || 'contain',
        objectPosition: styles.objectPosition || 'center center',
        borderRadius: styles.borderRadius,
        border: styles.border,
        opacity: styles.opacity,
        display: 'block',
      }}
    />
  )
}

/**
 * 직접 파일/IndexedDB 참조 비디오 — blob URL 해석 + 첫 프레임 poster 표시.
 */
function VideoPlayer({ content, playNow, autoplay, loop, muted, hideControls, objectFit }) {
  const isIdb = BlobStore.isIdbRef(content)
  const [idbUrl, setIdbUrl] = useState(null)
  useEffect(() => {
    if (!isIdb) return
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(content)).then(url => {
      if (!cancelled) setIdbUrl(url)
    })
    return () => { cancelled = true }
  }, [content, isIdb])
  const blobUrl = isIdb ? idbUrl : content

  // 재생하지 않을 때만(편집 화면 등) 썸네일 poster를 생성한다.
  const poster = useVideoPoster(blobUrl, !playNow)

  if (!blobUrl) {
    return <div style={{ width: '100%', height: '100%', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#475569', fontSize: 12 }}>로딩...</span>
    </div>
  }
  const controls = playNow && !hideControls
  return (
    <video
      src={playNow ? blobUrl : blobUrl + '#t=0.1'}
      poster={!playNow && poster ? poster : undefined}
      preload="metadata"
      style={{ width: '100%', height: '100%', objectFit: objectFit || 'cover', border: 'none', pointerEvents: controls ? 'auto' : 'none' }}
      controls={controls}
      autoPlay={playNow && autoplay}
      loop={loop}
      muted={muted}
      playsInline
    />
  )
}

/**
 * IndexedDB 참조 배경 이미지를 가진 shape — blob URL로 변환하여 렌더링
 */
function IdbBgShape({ baseStyle, styles, shapeBorderProps, bgImageStr, onMouseDown, onClick, content, contentStyle, isRich }) {
  const [resolvedBg, setResolvedBg] = useState(bgImageStr)

  useEffect(() => {
    if (!bgImageStr) return
    const m = bgImageStr.match(/url\(\s*['"]?(idb:\/\/[^'")\s]+)['"]?\s*\)/)
    if (!m) { setResolvedBg(bgImageStr); return }
    const ref = m[1]
    let cancelled = false
    BlobStore.getUrl(BlobStore.parseRef(ref)).then(blobUrl => {
      if (!cancelled && blobUrl) {
        setResolvedBg(bgImageStr.replace(ref, blobUrl))
      }
    })
    return () => { cancelled = true }
  }, [bgImageStr])

  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: styles.backgroundColor,
        backgroundImage: resolvedBg,
        backgroundSize: styles.backgroundSize || 'cover',
        backgroundPosition: styles.backgroundPosition || 'center',
        borderRadius: styles.borderRadius,
        ...shapeBorderProps,
        boxShadow: styles.boxShadow,
        opacity: styles.opacity,
      }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {content && (
        isRich
          ? <div style={contentStyle} dangerouslySetInnerHTML={{ __html: content }} />
          : <div style={contentStyle}>{content}</div>
      )}
    </div>
  )
}
