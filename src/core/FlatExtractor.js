/**
 * FlatExtractor
 * iframe DOM의 렌더링 결과를 스캔하여 시각적 말단 요소를 FlatElement[] 로 추출한다.
 * getBoundingClientRect() + getComputedStyle() 기반.
 *
 * 품질 규칙:
 * 1. 텍스트 중복 방지 — 자식 텍스트 요소를 가진 부모의 textContent는 추출하지 않음
 * 2. 네비게이션 요소 제외 — fixed, onclick, 슬라이드 카운터/네비 패턴 감지
 * 3. 빈 요소 제외 — 시각 속성(배경/테두리/그림자)도 없고 텍스트도 없는 요소 스킵
 */

let _flatCounter = 0
function nextFlatId() { return `flat-${++_flatCounter}` }
export function resetFlatCounter() { _flatCounter = 0 }

/** 컨테이너가 시각적으로 의미 있는지 판별 (배경/테두리/그림자) */
export function isVisuallyMeaningful(cs) {
  const bg = cs.backgroundColor
  const hasBackground = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
  const hasBgImage = cs.backgroundImage && cs.backgroundImage !== 'none'
  const hasBorder = cs.borderWidth && !cs.borderWidth.split(' ').every(v => v === '0px')
  const hasShadow = cs.boxShadow && cs.boxShadow !== 'none'
  return hasBackground || hasBgImage || hasBorder || hasShadow
}

/**
 * 네비게이션/UI 요소인지 판별
 * - position: fixed
 * - onclick 속성
 * - 슬라이드 카운터 패턴 (숫자 / 숫자)
 * - 조상 중 네비게이션 요소가 있음
 */
export function isNavigationElement(el, cs) {
  if (cs.position === 'fixed') return true
  if (el.hasAttribute('onclick')) return true

  // 조상 중 position:fixed 또는 onclick이 있으면 네비게이션 하위 요소
  let parent = el.parentElement
  while (parent && parent !== el.ownerDocument.body) {
    if (parent.hasAttribute('onclick')) return true
    // fixed 조상도 체크 (카운터가 fixed 컨테이너 안에 있을 수 있음)
    const pStyle = parent.style
    if (pStyle && pStyle.position === 'fixed') return true
    parent = parent.parentElement
  }

  // 슬라이드 카운터 패턴: "N / M" 형태의 짧은 텍스트
  const text = (el.textContent || '').trim()
  if (/^\d+\s*\/\s*\d+$/.test(text)) return true

  return false
}

/**
 * 독립적인(블록 레벨) 자식 텍스트 요소가 있는지 확인.
 * 인라인 서식 요소(strong, em, span 등)는 부모 텍스트의 일부이므로 제외.
 * 독립 텍스트 자식 = 자체 data-editor-id를 가지면서 별도 블록을 형성하는 요소.
 */
export const INLINE_TAGS = new Set(['strong', 'em', 'span', 'a', 'b', 'i', 'u', 'mark', 'sub', 'sup', 'code', 'label'])
const SEMANTIC_FORMAT_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 'mark', 'sub', 'sup', 'code'])

export function hasChildTextElements(el) {
  const children = el.querySelectorAll('[data-editor-id]')
  for (const child of children) {
    const tag = child.tagName.toLowerCase()
    // 인라인 태그가 아니면 항상 독립적
    if (!INLINE_TAGS.has(tag)) return true
    // 인라인 태그라도 직접 자식이 아니면 독립적
    if (child.parentElement !== el) return true
    // 인라인 태그 + 고유 스타일 + 텍스트 흐름 속이 아님 → 독립적
    if (hasDistinctStyle(child) && !isEmbeddedInline(child)) return true
  }
  return false
}

/** 인라인 요소가 부모와 구별되는 시각 스타일을 가지는지 판별 */
export function hasDistinctStyle(el) {
  const s = el.style
  if (!s) return false
  if (s.color) return true
  if (s.backgroundColor) return true
  if (s.background) return true
  if (s.backgroundImage) return true
  if (s.webkitTextFillColor) return true
  if (s.fontSize) return true
  if (s.fontWeight) return true
  return false
}

/**
 * 인라인 요소가 텍스트 흐름 속에 삽입되어 있는지 판별.
 * 주변에 의미 있는 텍스트 노드가 있으면 embedded (텍스트 흐름의 일부).
 */
export function isEmbeddedInline(el) {
  const parent = el.parentElement
  if (!parent) return false
  for (const node of parent.childNodes) {
    if (node === el) continue
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true
  }
  return false
}

/**
 * 자식 요소를 포함한 리치 텍스트를 추출.
 * - 독립 추출 대상(블록 자식, 비embedded 스타일 인라인) → 제외
 * - embedded 스타일 인라인 → outerHTML 보존 (스타일 유지)
 * - 일반 인라인/텍스트 → textContent 포함
 */
function getRichTextContent(el) {
  let html = ''
  let plain = ''
  let hasHtml = false
  let afterBr = false
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent
      // <br> 뒤의 소스 코드 들여쓰기(줄바꿈+공백) 제거
      if (afterBr) { text = text.replace(/^\s+/, ''); afterBr = false }
      html += escapeHtml(text)
      plain += text
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      afterBr = false
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') { html += '<br>'; plain += '\n'; hasHtml = true; afterBr = true; continue }
      if (node.hasAttribute('data-editor-id')) {
        // 블록 요소 → 제외
        if (!INLINE_TAGS.has(tag)) continue
        // 인라인 + 고유 스타일 + embedded → outerHTML로 스타일 보존
        if (hasDistinctStyle(node) && isEmbeddedInline(node)) {
          html += cleanInlineHtml(node)
          hasHtml = true
          continue
        }
        // 인라인 + 고유 스타일 + 비embedded → 독립 추출 대상, 제외
        if (hasDistinctStyle(node) && !isEmbeddedInline(node)) continue
      }
      // 시맨틱 서식 태그(strong, em, b, i, u 등) → 태그 보존
      if (SEMANTIC_FORMAT_TAGS.has(tag)) {
        html += `<${tag}>${escapeHtml(node.textContent)}</${tag}>`
        plain += node.textContent
        hasHtml = true
        continue
      }
      // 일반 인라인 서식 또는 editor-id 없는 요소 → textContent 포함
      html += escapeHtml(node.textContent)
      plain += node.textContent
    }
  }
  // isRich=true → HTML 문자열 (dangerouslySetInnerHTML용)
  // isRich=false → plain text (React 자동 이스케이프 / exporter에서 escHtml 1회)
  return { text: hasHtml ? html.trim() : plain.trim(), isRich: hasHtml }
}

/** 인라인 요소의 HTML을 에디터 속성 제거 후 반환 */
function cleanInlineHtml(el) {
  const clone = el.cloneNode(true)
  clone.removeAttribute('data-editor-id')
  clone.removeAttribute('data-editor-type')
  clone.removeAttribute('data-editor-selected')
  return clone.outerHTML
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 요소에서 시각적 스타일을 추출 */
function extractStyles(cs) {
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    textAlign: cs.textAlign,
    borderRadius: cs.borderRadius,
    border: cs.border,
    borderTop: cs.borderTop,
    borderRight: cs.borderRight,
    borderBottom: cs.borderBottom,
    borderLeft: cs.borderLeft,
    boxShadow: cs.boxShadow,
    opacity: cs.opacity,
    backgroundImage: cs.backgroundImage,
    backgroundClip: cs.backgroundClip || cs.webkitBackgroundClip,
    webkitBackgroundClip: cs.webkitBackgroundClip,
    webkitTextFillColor: cs.webkitTextFillColor,
    padding: cs.padding,
    letterSpacing: cs.letterSpacing,
    textTransform: cs.textTransform,
    textDecoration: cs.textDecoration,
    objectFit: cs.objectFit,
  }
}

/**
 * 부모의 overflow:hidden + border-radius에 의한 클리핑을 감지하여
 * 자식 요소에 적용할 유효 border-radius를 계산한다.
 * 자식이 부모 모서리에 붙어있는 경우에만 해당 코너의 radius를 상속.
 */
function getInheritedBorderRadius(el, rect) {
  const TOLERANCE = 4 // px (border 두께 감안)
  const win = el.ownerDocument.defaultView
  let parent = el.parentElement
  while (parent && parent.tagName !== 'BODY') {
    const pcs = win.getComputedStyle(parent)
    // overflow 체크: shorthand 또는 개별 속성
    const ovf = pcs.overflow || ''
    const ovfX = pcs.overflowX || ''
    const ovfY = pcs.overflowY || ''
    const isClipped = ovf.includes('hidden') || ovf.includes('clip') ||
                      ovfX === 'hidden' || ovfX === 'clip' ||
                      ovfY === 'hidden' || ovfY === 'clip'
    if (isClipped) {
      // border-radius: 개별 코너 속성으로 직접 읽기
      const rTL_raw = pcs.borderTopLeftRadius || '0px'
      const rTR_raw = pcs.borderTopRightRadius || '0px'
      const rBR_raw = pcs.borderBottomRightRadius || '0px'
      const rBL_raw = pcs.borderBottomLeftRadius || '0px'
      if (rTL_raw !== '0px' || rTR_raw !== '0px' || rBR_raw !== '0px' || rBL_raw !== '0px') {
        const pRect = parent.getBoundingClientRect()
        // 자식이 부모 모서리에 붙어있는지 체크
        const atTop = Math.abs(rect.top - pRect.top) <= TOLERANCE
        const atBottom = Math.abs(rect.bottom - pRect.bottom) <= TOLERANCE
        const atLeft = Math.abs(rect.left - pRect.left) <= TOLERANCE
        const atRight = Math.abs(rect.right - pRect.right) <= TOLERANCE
        const rTL = (atTop && atLeft) ? rTL_raw : '0px'
        const rTR = (atTop && atRight) ? rTR_raw : '0px'
        const rBR = (atBottom && atRight) ? rBR_raw : '0px'
        const rBL = (atBottom && atLeft) ? rBL_raw : '0px'
        if (rTL !== '0px' || rTR !== '0px' || rBR !== '0px' || rBL !== '0px') {
          return `${rTL} ${rTR} ${rBR} ${rBL}`
        }
      }
    }
    parent = parent.parentElement
  }
  return null
}

/**
 * 요소 자신과 조상을 탐색하여 유효한 z-index를 계산.
 * CSS stacking context: 자신 또는 조상 중 명시적 z-index가 있으면 그 값을 반환.
 * 자식은 부모의 stacking context 안에 있으므로 부모의 z-index를 상속받아야 한다.
 */
function getEffectiveZIndex(el) {
  let maxZ = null
  let node = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const z = node.style.zIndex
    if (z && z !== 'auto') {
      const parsed = parseInt(z, 10)
      if (!isNaN(parsed) && (maxZ === null || parsed > maxZ)) {
        maxZ = parsed
      }
    }
    node = node.parentElement
  }
  return maxZ
}

/** FlatElement 하나 생성 */
function buildFlatElement(el, rect, cs, domOrder, forceType) {
  const editorType = el.getAttribute('data-editor-type')
  let type = forceType
  if (!type) {
    if (editorType === 'image') type = 'image'
    else if (editorType === 'text') type = 'text'
    else type = 'shape'
  }

  let content = ''
  let isRich = false
  if (type === 'image') {
    content = el.getAttribute('src') || ''
  } else if (type === 'text') {
    const rich = getRichTextContent(el)
    content = rich.text
    isRich = rich.isRich
  }

  // 원본 CSS z-index 캡처: 자신 또는 조상 중 가장 높은 명시적 z-index 사용
  const effectiveZIndex = getEffectiveZIndex(el)

  const styles = extractStyles(cs)
  // 자신의 border-radius가 없으면 부모 클리핑에서 상속
  if (!styles.borderRadius || styles.borderRadius === '0px') {
    const inherited = getInheritedBorderRadius(el, rect)
    if (inherited) styles.borderRadius = inherited
  }

  return {
    id: nextFlatId(),
    sourceId: el.getAttribute('data-editor-id'),
    type,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    zIndex: 0, // 후처리에서 재할당
    _domOrder: domOrder,
    _originalZIndex: effectiveZIndex,
    content,
    isRich,
    styles,
  }
}

/**
 * 시각적 컨테이너 + 단일 텍스트 자식 → 하나의 텍스트 요소로 병합.
 * 컨테이너의 위치/크기/배경/테두리 + 텍스트의 내용/색상/폰트를 결합.
 * padding이 보존되어 텍스트가 자연스럽게 중앙 배치됨.
 * 병합 불가시 null 반환.
 */
function tryMergeContainerText(containerEl, containerRect, containerCs, win) {
  // 자식 에디터 요소 수집
  const childEditors = containerEl.querySelectorAll('[data-editor-id]')

  // 원본 컨테이너의 flex 정렬 속성 (inline style 우선, computed 보조)
  const isFlex = containerCs.display === 'flex' || containerCs.display === 'inline-flex'
  const origJustify = containerEl.style.justifyContent || containerCs.justifyContent
  const origAlign = containerEl.style.alignItems || containerCs.alignItems

  if (childEditors.length === 0) {
    // 자식 에디터 없음 — 컨테이너 자체에 텍스트가 있으면 텍스트 요소로 병합
    const text = (containerEl.textContent || '').trim()
    if (!text) return null
    return {
      sourceId: containerEl.getAttribute('data-editor-id'),
      type: 'text',
      x: containerRect.left,
      y: containerRect.top,
      width: containerRect.width,
      height: containerRect.height,
      content: text,
      isRich: false,
      styles: {
        backgroundColor: containerCs.backgroundColor,
        backgroundImage: containerCs.backgroundImage,
        borderRadius: containerCs.borderRadius,
        border: containerCs.border,
        borderTop: containerCs.borderTop,
        borderRight: containerCs.borderRight,
        borderBottom: containerCs.borderBottom,
        borderLeft: containerCs.borderLeft,
        boxShadow: containerCs.boxShadow,
        opacity: containerCs.opacity,
        padding: containerCs.padding,
        color: containerCs.color,
        fontSize: containerCs.fontSize,
        fontFamily: containerCs.fontFamily,
        fontWeight: containerCs.fontWeight,
        lineHeight: containerCs.lineHeight,
        textAlign: containerCs.textAlign,
        letterSpacing: containerCs.letterSpacing,
        textTransform: containerCs.textTransform,
        textDecoration: containerCs.textDecoration,
        isFlex,
        justifyContent: origJustify,
        alignItems: origAlign,
      },
      merged: true,
    }
  }

  // 자식이 모두 인라인 텍스트인지, 아니면 단일 텍스트인지 확인
  let singleTextChild = null
  let allInlineChildren = true
  let hasNonDirectChild = false

  for (const child of childEditors) {
    const childType = child.getAttribute('data-editor-type')
    // 컨테이너 자식이 또 있으면 병합 불가
    if (childType === 'container' || childType === 'image') return null
    // 직접 자식이 아닌 손자가 있으면 복잡한 구조 → 병합 불가
    if (child.parentElement !== containerEl) { hasNonDirectChild = true; break }
    // 인라인 태그인지 확인
    if (!INLINE_TAGS.has(child.tagName.toLowerCase())) { allInlineChildren = false }
    // 단일 자식 추적
    if (singleTextChild === null) singleTextChild = child
    else singleTextChild = false // 2개 이상
  }

  if (hasNonDirectChild) return null

  // Case A: 단일 텍스트 자식 → 기존 병합 (텍스트 스타일 사용)
  if (singleTextChild && singleTextChild !== false) {
    const text = (singleTextChild.textContent || '').trim()
    if (!text) return null
    const textCs = win.getComputedStyle(singleTextChild)
    return {
      sourceId: containerEl.getAttribute('data-editor-id'),
      type: 'text',
      x: containerRect.left,
      y: containerRect.top,
      width: containerRect.width,
      height: containerRect.height,
      content: text,
      isRich: false,
      styles: {
        backgroundColor: containerCs.backgroundColor,
        backgroundImage: containerCs.backgroundImage,
        borderRadius: containerCs.borderRadius,
        border: containerCs.border,
        borderTop: containerCs.borderTop,
        borderRight: containerCs.borderRight,
        borderBottom: containerCs.borderBottom,
        borderLeft: containerCs.borderLeft,
        boxShadow: containerCs.boxShadow,
        opacity: containerCs.opacity,
        padding: containerCs.padding,
        color: textCs.color,
        fontSize: textCs.fontSize,
        fontFamily: textCs.fontFamily,
        fontWeight: textCs.fontWeight,
        lineHeight: textCs.lineHeight,
        textAlign: textCs.textAlign,
        letterSpacing: textCs.letterSpacing,
        textTransform: textCs.textTransform,
        textDecoration: textCs.textDecoration,
        isFlex,
        justifyContent: origJustify,
        alignItems: origAlign,
      },
      merged: true,
    }
  }

  // Case B: 여러 인라인 자식 → getRichTextContent로 리치 텍스트 병합
  if (allInlineChildren && childEditors.length > 1) {
    const rich = getRichTextContent(containerEl)
    const text = rich.text
    if (!text || text.replace(/<br\s*\/?>/gi, '').trim() === '') return null
    return {
      sourceId: containerEl.getAttribute('data-editor-id'),
      type: 'text',
      x: containerRect.left,
      y: containerRect.top,
      width: containerRect.width,
      height: containerRect.height,
      content: text,
      isRich: rich.isRich,
      styles: {
        backgroundColor: containerCs.backgroundColor,
        backgroundImage: containerCs.backgroundImage,
        borderRadius: containerCs.borderRadius,
        border: containerCs.border,
        borderTop: containerCs.borderTop,
        borderRight: containerCs.borderRight,
        borderBottom: containerCs.borderBottom,
        borderLeft: containerCs.borderLeft,
        boxShadow: containerCs.boxShadow,
        opacity: containerCs.opacity,
        padding: containerCs.padding,
        color: containerCs.color,
        fontSize: containerCs.fontSize,
        fontFamily: containerCs.fontFamily,
        fontWeight: containerCs.fontWeight,
        lineHeight: containerCs.lineHeight,
        textAlign: containerCs.textAlign,
        letterSpacing: containerCs.letterSpacing,
        textTransform: containerCs.textTransform,
        textDecoration: containerCs.textDecoration,
        isFlex,
        justifyContent: origJustify,
        alignItems: origAlign,
      },
      merged: true,
    }
  }

  return null
}

/**
 * iframe DOM에서 모든 시각적 요소를 추출한다.
 * @param {React.RefObject} iframeRef
 * @returns {{ elements: FlatElement[], canvasSize: { w: number, h: number } }}
 */
export function extractFlatElements(iframeRef) {
  const iframe = iframeRef?.current
  if (!iframe) return { elements: [], canvasSize: { w: 1280, h: 800 } }

  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) return { elements: [], canvasSize: { w: 1280, h: 800 } }

  resetFlatCounter()
  const result = []
  let zCounter = 0

  // body 배경 추출 (특수 shape)
  const bodyCS = win.getComputedStyle(doc.body)
  const bodyRect = doc.body.getBoundingClientRect()
  if (isVisuallyMeaningful(bodyCS) && bodyRect.width > 0) {
    result.push({
      id: nextFlatId(),
      sourceId: '__body',
      type: 'shape',
      x: 0,
      y: 0,
      width: bodyRect.width,
      height: bodyRect.height,
      zIndex: zCounter++,
      content: '',
      styles: extractStyles(bodyCS),
    })
  }

  // data-editor-id 가진 모든 요소 수집
  const allEls = doc.querySelectorAll('[data-editor-id]')
  const mergedContainerIds = new Set() // 병합된 컨테이너의 ID (자식 스킵용)

  for (const el of allEls) {
    // 병합된 컨테이너의 자식이면 스킵
    if (mergedContainerIds.size > 0) {
      let ancestor = el.parentElement
      while (ancestor && ancestor !== doc.body) {
        const aid = ancestor.getAttribute('data-editor-id')
        if (aid && mergedContainerIds.has(aid)) break
        ancestor = ancestor.parentElement
      }
      if (ancestor && ancestor !== doc.body) continue
    }

    const cs = win.getComputedStyle(el)
    // display:none 스킵
    if (cs.display === 'none') continue

    // 네비게이션/UI 요소 스킵
    if (isNavigationElement(el, cs)) continue

    const rect = el.getBoundingClientRect()
    // 크기 0 스킵
    if (rect.width < 1 || rect.height < 1) continue

    const editorType = el.getAttribute('data-editor-type')

    if (editorType === 'text') {
      // 인라인 서식 요소이면서 부모 텍스트에 포함되는 경우 스킵
      // - 고유 스타일 없음 → 항상 부모에 포함
      // - 고유 스타일 있음 + embedded(텍스트 흐름 속) → 부모에 HTML로 포함
      // - 고유 스타일 있음 + 비embedded → 독립 추출
      const tag = el.tagName.toLowerCase()
      if (INLINE_TAGS.has(tag)) {
        const parent = el.parentElement
        if (parent && parent.hasAttribute('data-editor-id')) {
          const parentType = parent.getAttribute('data-editor-type')
          // 부모가 text이거나, 부모가 container이면서 텍스트 흐름 속에 있는 경우
          if (parentType === 'text' || (parentType === 'container' && isEmbeddedInline(el))) {
            if (!hasDistinctStyle(el) || isEmbeddedInline(el)) continue
          }
        }
      }

      // 자식 독립 텍스트 요소가 있으면: 고유 텍스트가 비어있고 시각 속성도 없으면 스킵
      if (hasChildTextElements(el)) {
        const { text: ownText } = getRichTextContent(el)
        // <br>만 남은 경우도 빈 텍스트로 취급
        const plainText = ownText.replace(/<br\s*\/?>/gi, '').trim()
        if (!plainText && !isVisuallyMeaningful(cs)) continue
      } else {
        // 자식도 없고, 텍스트도 비어있고, 시각 속성도 없으면 스킵
        const text = (el.textContent || '').trim()
        if (!text && !isVisuallyMeaningful(cs)) continue
      }
      result.push(buildFlatElement(el, rect, cs, zCounter++))
    } else if (editorType === 'image') {
      result.push(buildFlatElement(el, rect, cs, zCounter++))
    } else if (editorType === 'container') {
      if (isVisuallyMeaningful(cs)) {
        // 시각적 컨테이너 + 단일 텍스트 자식 → 병합 텍스트 요소
        const merged = tryMergeContainerText(el, rect, cs, win)
        if (merged) {
          mergedContainerIds.add(el.getAttribute('data-editor-id'))
          // 병합 요소에도 부모 클리핑 border-radius 상속
          if (!merged.styles.borderRadius || merged.styles.borderRadius === '0px') {
            const inherited = getInheritedBorderRadius(el, rect)
            if (inherited) merged.styles.borderRadius = inherited
          }
          result.push({ ...merged, id: nextFlatId(), zIndex: 0, _domOrder: zCounter++, _originalZIndex: getEffectiveZIndex(el) })
        } else {
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape'))
        }
      } else {
        // 비시각 컨테이너: 텍스트 내용이 있으면 text로 추출
        const text = (el.textContent || '').trim()
        if (!text) continue // eslint-disable-line no-continue
        const childEditorEls = el.querySelectorAll('[data-editor-id]')
        if (childEditorEls.length === 0) {
          // 자식 에디터 없음 → 단순 텍스트 추출
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'text'))
        } else {
          // 자식이 모두 인라인 텍스트(strong, em, span 등)이고 직접 자식인 경우
          // → 리치 텍스트로 추출 (컨테이너를 텍스트로 취급)
          let allInline = true
          for (const child of childEditorEls) {
            const childTag = child.tagName.toLowerCase()
            if (!INLINE_TAGS.has(childTag) || child.parentElement !== el) {
              allInline = false
              break
            }
          }
          if (allInline) {
            // flex 컨테이너는 병합하지 않음 — 자식들이 각각 독립 위치를 가짐
            const isFlex = cs.display === 'flex' || cs.display === 'inline-flex'
            if (!isFlex) {
              mergedContainerIds.add(el.getAttribute('data-editor-id'))
              result.push(buildFlatElement(el, rect, cs, zCounter++, 'text'))
            }
            // flex인 경우: 컨테이너 스킵, 자식 span들이 독립 추출됨
          }
        }
      }
    }
  }

  // SVG 요소 추출 — data-editor-id가 없는 SVG를 별도 스캔
  const allSvgs = doc.querySelectorAll('svg')
  for (const svg of allSvgs) {
    const svgRect = svg.getBoundingClientRect()
    if (svgRect.width < 1 || svgRect.height < 1) continue
    // display:none 체크
    const svgCs = win.getComputedStyle(svg)
    if (svgCs.display === 'none') continue
    if (isNavigationElement(svg, svgCs)) continue
    // SVG outerHTML 보존
    const svgHtml = svg.outerHTML
    result.push({
      id: nextFlatId(),
      sourceId: null,
      type: 'svg',
      x: svgRect.left,
      y: svgRect.top,
      width: svgRect.width,
      height: svgRect.height,
      zIndex: 0,
      _domOrder: zCounter++,
      _originalZIndex: getEffectiveZIndex(svg),
      content: svgHtml,
      isRich: false,
      styles: {},
    })
  }

  // z-index 재정렬: 원본 CSS z-index를 반영
  // auto → 0으로 처리 (CSS 표준), 같은 값이면 DOM 순서 유지
  result.sort((a, b) => {
    const aZ = a._originalZIndex ?? 0
    const bZ = b._originalZIndex ?? 0
    if (aZ !== bZ) return aZ - bZ
    return a._domOrder - b._domOrder
  })

  // 순차적 z-index 재할당 및 임시 필드 제거
  result.forEach((el, i) => {
    el.zIndex = i
    delete el._domOrder
    delete el._originalZIndex
  })

  const canvasSize = {
    w: bodyRect.width || 1280,
    h: bodyRect.height || 800,
  }

  return { elements: result, canvasSize }
}
