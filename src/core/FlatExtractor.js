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
  // pre/pre-wrap 계열 요소는 줄바꿈 보존 (코드 블록 등)
  const win = el.ownerDocument?.defaultView
  const ws = win ? win.getComputedStyle(el).whiteSpace : 'normal'
  const preserveNewlines = ws.startsWith('pre')
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent
      // <br> 뒤의 소스 코드 들여쓰기(줄바꿈+공백) 제거
      if (afterBr) { text = text.replace(/^\s+/, ''); afterBr = false }
      // 일반 텍스트: 소스 줄바꿈+들여쓰기를 공백으로 축소 (브라우저 정규화 모방)
      // pre 계열: 줄바꿈 보존
      if (!preserveNewlines) text = text.replace(/\n\s*/g, ' ')
      html += escapeHtml(text)
      plain += text
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      afterBr = false
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') { html += '<br>'; plain += '\n'; hasHtml = true; afterBr = true; continue }
      // SVG 요소 → outerHTML 보존 (인라인 아이콘 등)
      if (tag === 'svg') { html += node.outerHTML; hasHtml = true; continue }
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
      // <li> 요소 → 불릿 마커 삽입 (CSS list-style로 렌더링되어 textContent에 없음)
      if (tag === 'li') {
        const bullet = '• '
        html += escapeHtml(bullet + node.textContent)
        plain += bullet + node.textContent
        continue
      }
      // 시맨틱 서식 태그(strong, em, b, i, u 등) → 태그 + 인라인 스타일 보존
      if (SEMANTIC_FORMAT_TAGS.has(tag)) {
        const inlineStyle = getSemanticInlineStyle(node)
        if (inlineStyle) {
          html += `<${tag} style="${inlineStyle}">${escapeHtml(node.textContent)}</${tag}>`
        } else {
          html += `<${tag}>${escapeHtml(node.textContent)}</${tag}>`
        }
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

/** 인라인 요소의 HTML을 에디터 속성 제거 후 반환.
 *  CSS 변수(var(--*))를 computed 값으로 해석하여 flat HTML에서도 동작하도록 한다. */
function cleanInlineHtml(el) {
  const clone = el.cloneNode(true)
  clone.removeAttribute('data-editor-id')
  clone.removeAttribute('data-editor-type')
  clone.removeAttribute('data-editor-selected')
  // 인라인 style에 CSS 변수가 있으면 computed 값으로 치환
  resolveStyleVars(el, clone)
  // 자식 요소의 CSS 변수도 치환
  const origChildren = el.querySelectorAll('*')
  const cloneChildren = clone.querySelectorAll('*')
  for (let i = 0; i < origChildren.length; i++) {
    if (cloneChildren[i]) resolveStyleVars(origChildren[i], cloneChildren[i])
  }
  return clone.outerHTML
}

/** el의 인라인 style 중 CSS 변수를 computed 값으로 치환하여 target에 적용 */
function resolveStyleVars(el, target) {
  const style = target.getAttribute('style')
  if (!style || !style.includes('var(')) return
  const win = el.ownerDocument?.defaultView
  if (!win) return
  const cs = win.getComputedStyle(el)
  // 각 속성에서 var(...) 패턴 치환
  const resolved = style.replace(/var\(--[^)]+\)/g, (match) => {
    // 속성 이름으로 computed 값 매핑: color:var(--green) → color 속성의 computed 값
    // 직접 매핑이 어려우므로, 해당 속성을 개별 검출
    return match
  })
  // 더 정확한 방법: 각 CSS 속성별로 computed 값을 직접 설정
  const newParts = []
  const props = style.split(';').filter(Boolean)
  for (const prop of props) {
    const [name, ...valParts] = prop.split(':')
    const propName = name.trim()
    const val = valParts.join(':').trim()
    if (val.includes('var(')) {
      // computed style에서 해당 속성의 resolved 값 가져오기
      const computedVal = cs.getPropertyValue(propName)
      if (computedVal) {
        newParts.push(`${propName}:${computedVal}`)
      }
    } else {
      newParts.push(`${propName}:${val}`)
    }
  }
  target.setAttribute('style', newParts.join(';'))
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * 시맨틱 서식 태그(code, mark 등)의 시각적 스타일을 인라인 CSS로 추출.
 * 글로벌 CSS로 적용되는 배경색, padding, border-radius 등을 보존한다.
 * strong/em/b/i/u 등 순수 서식 태그는 별도 스타일 불필요 → null 반환.
 */
function getSemanticInlineStyle(el) {
  const tag = el.tagName.toLowerCase()
  const win = el.ownerDocument.defaultView
  if (!win) return null
  const cs = win.getComputedStyle(el)

  // 순수 서식 태그: CSS에 의한 시각적 차이가 있으면 inline style로 보존
  if (tag === 'strong' || tag === 'b' || tag === 'em' || tag === 'i' || tag === 'u' ||
      tag === 'sub' || tag === 'sup') {
    const parts = []
    const parent = el.parentElement
    if (parent) {
      const parentCs = win.getComputedStyle(parent)
      // display: block (CSS에서 강제 블록화된 경우)
      if (cs.display === 'block' || cs.display === 'list-item') {
        parts.push('display:block')
        // 블록화된 경우 margin-bottom도 보존
        const mb = cs.marginBottom
        if (mb && mb !== '0px') parts.push(`margin-bottom:${mb}`)
      }
      // 색상 차이
      if (cs.color && cs.color !== parentCs.color) parts.push(`color:${cs.color}`)
      // 폰트 크기 차이
      if (cs.fontSize && cs.fontSize !== parentCs.fontSize) parts.push(`font-size:${cs.fontSize}`)
    }
    return parts.length > 0 ? parts.join(';') : null
  }

  const parts = []
  const bg = cs.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') parts.push(`background:${bg}`)
  const ff = cs.fontFamily
  if (ff) parts.push(`font-family:${ff.replace(/"/g, "'")}`)
  const fs = cs.fontSize
  if (fs) parts.push(`font-size:${fs}`)
  const pad = cs.padding
  if (pad && pad !== '0px') parts.push(`padding:${pad}`)
  const br = cs.borderRadius
  if (br && br !== '0px') parts.push(`border-radius:${br}`)
  const color = cs.color
  if (color) parts.push(`color:${color}`)

  return parts.length > 0 ? parts.join(';') : null
}

/** 요소에서 시각적 스타일을 추출 */
function extractStyles(cs) {
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize,
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
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
    overflow: cs.overflow,
    overflowX: cs.overflowX,
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
function buildFlatElement(el, rect, cs, domOrder, forceType, transformScale = 1, originRect = null) {
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

  // 텍스트 요소의 높이 보정: 인라인 요소의 getBoundingClientRect 높이가
  // 실제 텍스트 렌더링(font descender 포함)보다 작을 수 있음
  // 단, 텍스트 없는 시각 요소(장식 라인 등)는 원본 높이 유지
  let height = rect.height
  let width = rect.width
  let flexParentX = null // flex 부모 가용 너비 사용 시 x 좌표 오버라이드
  const hasTextContent = type === 'text' && (el.textContent || '').trim().length > 0
  if (hasTextContent) {
    const fontSize = parseFloat(cs.fontSize) || 0
    const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight) || 0
    const minHeight = Math.max(fontSize, lineHeight)
    if (height < minHeight) height = Math.ceil(minHeight)

    // flex 부모 가용 너비 보정:
    // flex 부모의 align-items:center/start/end는 cross-axis 방향으로
    // 자식을 콘텐츠 너비로 축소시킨다 (flex-direction:row일 때는 height,
    // flex-direction:column일 때는 width).
    // getBoundingClientRect()가 축소된 너비를 반환하므로,
    // 이 너비를 flat 컨테이너에 그대로 사용하면 미세한 폰트 메트릭 차이로
    // 원본과 다른 줄바꿈이 발생한다.
    // → 부모의 가용 너비(padding 제외)를 사용하여 원본과 동일한 여유를 확보한다.
    // 단, align-items:stretch(기본값)일 때는 자식이 이미 부모 너비를 채우므로 보정 불필요.
    const parent = el.parentElement
    if (parent && parent.tagName !== 'BODY') {
      const parentCs = el.ownerDocument.defaultView.getComputedStyle(parent)
      const parentDisplay = parentCs.display
      const parentIsFlex = parentDisplay === 'flex' || parentDisplay === 'inline-flex'
      const parentIsGrid = parentDisplay === 'grid' || parentDisplay === 'inline-grid'
      if (parentIsFlex || parentIsGrid) {
        // cross-axis shrink 여부 판단:
        // flex-direction:column에서 align-items가 stretch가 아니면 width가 축소됨
        // flex-direction:row에서는 width = main axis이므로 align-items와 무관
        const flexDir = parentCs.flexDirection || 'row'
        const alignItems = parentCs.alignItems || 'stretch'
        const isColumnFlex = flexDir === 'column' || flexDir === 'column-reverse'
        const crossAxisShrinks = isColumnFlex && alignItems !== 'stretch' && alignItems !== 'normal'
        if (crossAxisShrinks) {
          const parentRect = unscaleRect(parent.getBoundingClientRect(), transformScale, originRect)
          const padL = parseFloat(parentCs.paddingLeft) || 0
          const padR = parseFloat(parentCs.paddingRight) || 0
          const parentContentW = parentRect.width - padL - padR
          // 요소 너비가 부모 가용 너비보다 좁으면 부모 가용 너비로 확장
          // 단, 요소가 부모 폭의 70% 이상을 차지할 때만 — 작은 중앙 정렬 텍스트는 유지
          const widthRatio = parentContentW > 0 ? width / parentContentW : 1
          if (parentContentW > width + 2 && parentContentW > 0 && widthRatio > 0.7) {
            flexParentX = parentRect.left + padL
            width = parentContentW
          }
        }
      }
    }

    // 너비 보정: 텍스트가 줄바꿈되어 실제 필요 너비보다 좁게 측정되는 문제 방지.
    // overflow:visible인 경우 줄바꿈되어도 box 높이가 늘어나지 않아
    // getBoundingClientRect().height로는 줄바꿈 여부를 알 수 없다.
    // → white-space:nowrap으로 일시 전환하여 한 줄일 때의 실제 필요 너비를 측정하고,
    //   현재 너비보다 넓으면 줄바꿈이 발생한 것이므로 너비를 교정한다.
    const brCount = (el.innerHTML || '').match(/<br\s*\/?>/gi)?.length || 0
    const nlCount = ((el.textContent || '').match(/\n/g) || []).length
    const intendedBreaks = brCount + nlCount
    // pre/code 계열은 줄바꿈이 의도된 것이므로 스킵
    const ffamily = (cs.fontFamily || '').toLowerCase()
    const isCodeBlock = ffamily.includes('monospace') || ffamily.includes('fira code') ||
                        el.tagName.toLowerCase() === 'pre' || el.closest('pre')
    if (!isCodeBlock && intendedBreaks === 0) {
      // 부모 컨테이너가 너비를 제한하는지 확인:
      // 요소 너비가 부모 내부 너비(padding 제외)와 거의 같으면
      // 부모에 의한 의도된 줄바꿈이므로 보정하지 않는다.
      let parentConstrained = false
      if (parent && parent.tagName !== 'BODY') {
        const parentRect = unscaleRect(parent.getBoundingClientRect(), transformScale, originRect)
        const parentCs = el.ownerDocument.defaultView.getComputedStyle(parent)
        const padL = parseFloat(parentCs.paddingLeft) || 0
        const padR = parseFloat(parentCs.paddingRight) || 0
        const parentContentW = parentRect.width - padL - padR
        // 요소 너비가 부모 내부 너비의 95% 이상이면 부모 제약
        if (parentContentW > 0 && width >= parentContentW * 0.95) {
          parentConstrained = true
        }
      }
      if (!parentConstrained) {
        const origWS = el.style.whiteSpace
        const origWB = el.style.wordBreak
        const origW = el.style.width
        el.style.whiteSpace = 'nowrap'
        el.style.wordBreak = 'normal'
        el.style.width = 'auto'
        const nowrapRect = unscaleRect(el.getBoundingClientRect(), transformScale, originRect)
        el.style.whiteSpace = origWS
        el.style.wordBreak = origWB
        el.style.width = origW
        if (nowrapRect.width > width + 2) {
          width = Math.ceil(nowrapRect.width)
          // 줄바꿈이 해소되었으므로 높이는 1줄분
          height = Math.ceil(lineHeight) || Math.ceil(nowrapRect.height)
        }
      }
    }
  }

  const result = {
    id: nextFlatId(),
    sourceId: el.getAttribute('data-editor-id'),
    type,
    x: flexParentX !== null ? flexParentX : rect.left,
    y: rect.top,
    width,
    height,
    zIndex: 0, // 후처리에서 재할당
    _domOrder: domOrder,
    _originalZIndex: effectiveZIndex,
    content,
    isRich,
    styles,
    // 원본 레이아웃 (너비 보정 전 getBoundingClientRect 결과)
    originalRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
  }

  // ::before 의사 요소 추출 — CSS로 렌더링되는 불릿, 장식 등
  const pseudoBefore = extractPseudoElement(el, rect, '::before')
  if (pseudoBefore) result._pseudoBefore = pseudoBefore

  return result
}

/**
 * ::before / ::after 의사 요소의 시각적 속성을 추출한다.
 * content가 있거나 (비어있어도) 배경/크기가 있으면 shape로 생성.
 * @returns {{ x, y, w, h, backgroundColor, borderRadius, content }|null}
 */
function extractPseudoElement(el, parentRect, pseudo) {
  const win = el.ownerDocument.defaultView
  if (!win) return null
  const pcs = win.getComputedStyle(el, pseudo)
  // display: none이면 무시
  if (pcs.display === 'none') return null
  // content가 'none'이면 의사 요소 없음
  const content = pcs.content
  if (!content || content === 'none') return null

  const w = parseFloat(pcs.width) || 0
  const h = parseFloat(pcs.height) || 0
  const bg = pcs.backgroundColor
  const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'

  // 텍스트 content ('')이 아닌 실제 텍스트도 있을 수 있음
  const isEmptyContent = content === '""' || content === "''" || content === 'normal' || content === 'none'
  const textContent = isEmptyContent ? '' : content.replace(/^["']|["']$/g, '')

  // 시각적 의미 없으면 무시 (빈 content + 배경 없음 + 크기 없음)
  if (!hasBg && !textContent && (w < 1 || h < 1)) return null

  // 위치 계산: position이 absolute면 부모 기준 left/top
  const left = parseFloat(pcs.left) || 0
  const top = parseFloat(pcs.top) || 0

  return {
    x: parentRect.left + left,
    y: parentRect.top + top,
    w,
    h,
    backgroundColor: bg,
    borderRadius: pcs.borderRadius || '0px',
    content: textContent,
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
        fontStyle: containerCs.fontStyle,
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

  // Case A: 단일 텍스트 자식 → 컨테이너에 자체 텍스트 노드가 있으면
  // getRichTextContent로 전체 콘텐츠 추출 (예: "CPU / GPU<br><span>핫스팟</span>")
  // 자체 텍스트가 없으면 자식 텍스트만 사용
  if (singleTextChild && singleTextChild !== false) {
    // 컨테이너에 자식 외의 텍스트 노드가 있는지 확인
    let hasOwnText = false
    for (const node of containerEl.childNodes) {
      if (node === singleTextChild) continue
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) { hasOwnText = true; break }
    }

    if (hasOwnText) {
      // 부모 텍스트 + 자식 텍스트를 함께 추출 (getRichTextContent)
      const rich = getRichTextContent(containerEl)
      const richText = rich.text
      if (!richText || richText.replace(/<br\s*\/?>/gi, '').trim() === '') return null
      return {
        sourceId: containerEl.getAttribute('data-editor-id'),
        type: 'text',
        x: containerRect.left,
        y: containerRect.top,
        width: containerRect.width,
        height: containerRect.height,
        content: richText,
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
          fontStyle: containerCs.fontStyle,
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

    // 자체 텍스트 없음 — 비에디터 형제 요소(SVG 아이콘 등)가 있으면
    // getRichTextContent로 전체 콘텐츠를 보존 (인라인 아이콘+텍스트 레이아웃 유지)
    let hasSiblingElements = false
    for (const node of containerEl.childNodes) {
      if (node === singleTextChild) continue
      if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute('data-editor-id')) {
        hasSiblingElements = true; break
      }
    }

    if (hasSiblingElements) {
      const rich = getRichTextContent(containerEl)
      const richText = rich.text
      if (!richText || richText.replace(/<br\s*\/?>/gi, '').replace(/<svg[\s\S]*?<\/svg>/gi, '').trim() === '') return null
      return {
        sourceId: containerEl.getAttribute('data-editor-id'),
        type: 'text',
        x: containerRect.left,
        y: containerRect.top,
        width: containerRect.width,
        height: containerRect.height,
        content: richText,
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
          fontStyle: containerCs.fontStyle,
          lineHeight: containerCs.lineHeight,
          textAlign: containerCs.textAlign,
          letterSpacing: containerCs.letterSpacing,
          textTransform: containerCs.textTransform,
          textDecoration: containerCs.textDecoration,
          isFlex,
          justifyContent: origJustify,
          alignItems: origAlign,
          gap: containerCs.gap,
        },
        merged: true,
        _hasMergedSvg: true,
      }
    }

    // 자식 텍스트만 사용
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
        fontStyle: textCs.fontStyle,
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
        fontStyle: containerCs.fontStyle,
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

  // CSS transform scale 감지 + 좌표 원점 설정.
  // reveal.js 등은 .slides 컨테이너에 transform: scale()을 적용하므로
  // getBoundingClientRect()는 스크린 픽셀(확대/축소 후),
  // getComputedStyle()의 font-size 등은 CSS 픽셀(확대/축소 전)을 반환한다.
  // 이 불일치를 보정하기 위해:
  //   1. 변환된 조상을 찾아 scale factor를 추출
  //   2. 해당 조상의 bounding rect를 좌표 원점으로 사용
  //   3. 모든 요소 좌표를 원점 기준 상대값으로 변환 후 scale로 나눔
  const { transformScale, originRect } = detectTransformContext(doc)

  // body 배경 추출 (특수 shape)
  const bodyCS = win.getComputedStyle(doc.body)
  const bodyRectRaw = doc.body.getBoundingClientRect()
  // canvasSize는 원점 컨테이너 기준 CSS 크기 사용
  const canvasW = originRect ? originRect.cssWidth : bodyRectRaw.width
  const canvasH = originRect ? originRect.cssHeight : bodyRectRaw.height
  if (isVisuallyMeaningful(bodyCS) && bodyRectRaw.width > 0) {
    result.push({
      id: nextFlatId(),
      sourceId: '__body',
      type: 'shape',
      x: 0,
      y: 0,
      width: canvasW,
      height: canvasH,
      zIndex: zCounter++,
      content: '',
      styles: extractStyles(bodyCS),
    })
  }

  // reveal.js: 현재 활성 섹션만 추출 (.present 클래스)
  // reveal.js는 모든 section을 DOM에 유지하므로 비활성 슬라이드 요소를 필터링해야 한다.
  // 수직 슬라이드가 있으면 현재 수직 섹션(.present > .present)을 우선 사용
  let revealPresent = doc.querySelector('.reveal .slides > section.present > section.present')
  if (!revealPresent) revealPresent = doc.querySelector('.reveal .slides > section.present')
  // reveal.js 초기화 전이면 첫 번째 섹션 사용
  if (!revealPresent) {
    const firstSection = doc.querySelector('.reveal .slides > section')
    if (firstSection) revealPresent = firstSection
  }

  // data-editor-id 가진 모든 요소 수집
  const allEls = doc.querySelectorAll('[data-editor-id]')
  const mergedContainerIds = new Set() // 병합된 컨테이너의 ID (자식 스킵용)

  for (const el of allEls) {
    // reveal.js: 활성 섹션 밖의 요소 스킵
    if (revealPresent && !revealPresent.contains(el)) continue

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

    const rectRaw = el.getBoundingClientRect()
    // 크기 0 스킵
    if (rectRaw.width < 1 || rectRaw.height < 1) continue
    const rect = unscaleRect(rectRaw, transformScale, originRect)

    // 캔버스 영역 밖 요소 스킵
    if (rect.right < -10 || rect.bottom < -10 || rect.left > canvasW + 10 || rect.top > canvasH + 10) continue

    const editorType = el.getAttribute('data-editor-type')

    if (editorType === 'text') {
      // 인라인 서식 요소이면서 부모 텍스트에 포함되는 경우 스킵
      // - 고유 스타일 없음 → 항상 부모에 포함
      // - 고유 스타일 있음 + embedded(텍스트 흐름 속) → 부모에 HTML로 포함
      // - 고유 스타일 있음 + 비embedded → 독립 추출
      // 단, 부모가 display:flex이면 자식들이 각각 독립 위치를 가지므로 스킵하지 않음
      const tag = el.tagName.toLowerCase()
      if (INLINE_TAGS.has(tag)) {
        const parent = el.parentElement
        if (parent && parent.hasAttribute('data-editor-id')) {
          const parentType = parent.getAttribute('data-editor-type')
          const parentCs = win.getComputedStyle(parent)
          const parentIsFlex = parentCs.display === 'flex' || parentCs.display === 'inline-flex'
          // 부모가 flex이면 자식은 독립 위치 → 스킵하지 않고 독립 추출
          if (!parentIsFlex) {
            if (parentType === 'text' || (parentType === 'container' && isEmbeddedInline(el))) {
              if (!hasDistinctStyle(el) || isEmbeddedInline(el)) continue
            }
          }
        }
      }

      // display:flex인 텍스트 요소(예: li): 자식들이 독립 위치를 가지므로
      // 부모 자체는 시각 속성이 있을 때만 shape로 추출하고, 텍스트는 자식에 맡긴다
      const isFlex = cs.display === 'flex' || cs.display === 'inline-flex'
      if (isFlex && hasChildTextElements(el)) {
        if (isVisuallyMeaningful(cs)) {
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect))
        }
        continue
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
      result.push(buildFlatElement(el, rect, cs, zCounter++, undefined, transformScale, originRect))
    } else if (editorType === 'image') {
      result.push(buildFlatElement(el, rect, cs, zCounter++, undefined, transformScale, originRect))
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
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect))
        }
      } else {
        // 비시각 컨테이너: 텍스트 내용이 있으면 text로 추출
        const text = (el.textContent || '').trim()
        if (!text) continue // eslint-disable-line no-continue
        const childEditorEls = el.querySelectorAll('[data-editor-id]')
        if (childEditorEls.length === 0) {
          // 자식 에디터 없음 → 단순 텍스트 추출
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'text', transformScale, originRect))
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
              // 병합 전 실제 콘텐츠 확인: getRichTextContent가 빈 문자열을 반환하면
              // (자식이 모두 독립 추출 대상이어서 스킵될 때) 병합하지 않고
              // 자식들이 독립적으로 추출되도록 한다.
              const { text: mergeText } = getRichTextContent(el)
              const mergeContent = mergeText.replace(/<br\s*\/?>/gi, '').trim()
              if (mergeContent) {
                mergedContainerIds.add(el.getAttribute('data-editor-id'))
                result.push(buildFlatElement(el, rect, cs, zCounter++, 'text', transformScale, originRect))
              }
              // mergeContent가 비어있으면: 컨테이너 스킵, 자식들이 독립 추출됨
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
    const svgRect = unscaleRect(svg.getBoundingClientRect(), transformScale, originRect)
    if (svgRect.width < 1 || svgRect.height < 1) continue
    // display:none 체크
    const svgCs = win.getComputedStyle(svg)
    if (svgCs.display === 'none') continue
    if (isNavigationElement(svg, svgCs)) continue
    // 병합된 컨테이너 내부의 SVG는 이미 텍스트 콘텐츠에 포함됨 → 중복 추출 방지
    let insideMerged = false
    let ancestor = svg.parentElement
    while (ancestor && ancestor !== doc.body) {
      const aid = ancestor.getAttribute?.('data-editor-id')
      if (aid && mergedContainerIds.has(aid)) { insideMerged = true; break }
      ancestor = ancestor.parentElement
    }
    if (insideMerged) continue
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

  // ::before 의사 요소를 별도 shape/text 요소로 변환하여 삽입
  // 부모 요소 바로 앞에 위치 (같은 z-index, domOrder - 0.5)
  const pseudoElements = []
  for (const el of result) {
    if (el._pseudoBefore) {
      const pb = el._pseudoBefore
      const pseudoEl = {
        id: nextFlatId(),
        sourceId: el.sourceId ? `${el.sourceId}::before` : null,
        type: pb.content ? 'text' : 'shape',
        x: pb.x,
        y: pb.y,
        width: pb.w,
        height: pb.h,
        zIndex: 0,
        _domOrder: el._domOrder - 0.5, // 부모 바로 앞
        _originalZIndex: el._originalZIndex,
        content: pb.content || '',
        isRich: false,
        styles: {
          backgroundColor: pb.backgroundColor,
          borderRadius: pb.borderRadius,
        },
        originalRect: { x: pb.x, y: pb.y, w: pb.w, h: pb.h },
      }
      pseudoElements.push(pseudoEl)
    }
    delete el._pseudoBefore
  }
  result.push(...pseudoElements)

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
    w: canvasW || 1280,
    h: canvasH || 800,
  }

  // 폰트 임포트 추출 — flat HTML에서도 동일 폰트 로드를 위해
  const fontImports = extractFontImports(doc)

  // 추출된 요소의 font-family에서 누락된 웹폰트 감지 → Google Fonts 임포트 자동 추가
  addMissingFontImports(result, fontImports)

  return { elements: result, canvasSize, fontImports }
}

/**
 * iframe 문서에서 폰트 관련 CSS를 추출한다.
 * CSSOM을 사용하여 모든 스타일시트(외부 CSS 포함)에서 @import와 @font-face를 탐색한다.
 * @returns {string[]} CSS 문자열 배열
 */
function extractFontImports(doc) {
  const imports = []
  const seen = new Set()

  function addUnique(css) {
    const key = css.replace(/\s+/g, ' ').trim()
    if (seen.has(key)) return
    seen.add(key)
    imports.push(css)
  }

  // 1. CSSOM 기반: 모든 스타일시트에서 @import, @font-face 규칙 추출
  try {
    for (const sheet of doc.styleSheets) {
      try { extractFromSheet(sheet) } catch { /* cross-origin 접근 불가 시 무시 */ }
    }
  } catch { /* styleSheets 접근 불가 */ }

  function extractFromSheet(sheet) {
    let rules
    try { rules = sheet.cssRules || sheet.rules } catch { return }
    if (!rules) return
    for (const rule of rules) {
      if (rule.type === CSSRule.IMPORT_RULE) {
        // @import → 폰트 관련 URL이면 추가
        const href = rule.href || ''
        if (isFontUrl(href)) {
          addUnique(`@import url('${href}');`)
        }
        // 중첩 스타일시트도 탐색
        if (rule.styleSheet) {
          try { extractFromSheet(rule.styleSheet) } catch {}
        }
      } else if (rule.type === CSSRule.FONT_FACE_RULE) {
        addUnique(rule.cssText)
      }
    }
  }

  // 2. <style> 텍스트 파싱 (CSSOM 접근 실패 대비)
  for (const style of doc.querySelectorAll('style')) {
    // 에디터 삽입 스타일 제외
    if (style.id && style.id.startsWith('__fe-')) continue
    const text = style.textContent || ''
    const importMatches = text.match(/@import\s+url\([^)]+\)\s*;?/g)
    if (importMatches) {
      for (const m of importMatches) addUnique(m.endsWith(';') ? m : m + ';')
    }
    const fontFaceMatches = text.match(/@font-face\s*\{[^}]+\}/g)
    if (fontFaceMatches) {
      for (const m of fontFaceMatches) addUnique(m)
    }
  }

  // 3. <link> 폰트 스타일시트 직접 참조 (CSSOM에서 못 잡은 것 보완)
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (link.id && link.id.startsWith('__fe-')) continue
    const href = link.getAttribute('href') || ''
    if (isFontUrl(href)) {
      addUnique(`@import url('${href}');`)
    }
  }

  // 4. 프레젠테이션 프레임워크 테마 CSS (reveal.js 등)
  // cross-origin CSSOM 접근 불가로 @font-face를 직접 읽을 수 없으므로
  // 테마 CSS 자체를 link로 주입하여 폰트 정의를 포함시킨다.
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (link.id && link.id.startsWith('__fe-')) continue
    const href = link.getAttribute('href') || ''
    if (href.includes('/theme/') || href.includes('reveal') && href.includes('.css')) {
      addUnique(`@import url('${href}');`)
    }
  }

  return imports
}

/**
 * CSS transform이 적용된 조상 컨테이너를 감지하고 scale + 원점 정보를 반환한다.
 * reveal.js 등 프레젠테이션 프레임워크에서 .slides 컨테이너에 transform: scale() 적용 시,
 * getBoundingClientRect()는 스크린 픽셀을, getComputedStyle()은 CSS 픽셀을 반환하므로
 * 이 불일치를 보정하기 위해 사용한다.
 *
 * @returns {{ transformScale: number, originRect: { screenLeft, screenTop, cssWidth, cssHeight } | null }}
 */
function detectTransformContext(doc) {
  const win = doc.defaultView
  if (!win) return { transformScale: 1, originRect: null }

  // 잎(leaf) 레벨 [data-editor-id] 요소를 선택 — 최상위 컨테이너(.reveal 등)가 아닌
  // 실제 콘텐츠 요소를 기준으로 조상 체인의 transform을 탐색해야 한다.
  // 자식에 [data-editor-id]가 없는 요소 = 잎 노드
  const allEditorEls = doc.querySelectorAll('[data-editor-id]')
  if (allEditorEls.length === 0) return { transformScale: 1, originRect: null }
  let testEl = allEditorEls[0]
  for (const el of allEditorEls) {
    if (!el.querySelector('[data-editor-id]')) {
      testEl = el
      break
    }
  }

  // 방법 1: 조상 체인에서 transform scale 추출 + 가장 바깥쪽 transform 컨테이너 기억
  let cumulativeScale = 1
  let outermostTransformEl = null
  let ancestor = testEl.parentElement
  while (ancestor && ancestor !== doc.documentElement) {
    const cs = win.getComputedStyle(ancestor)
    const t = cs.transform
    if (t && t !== 'none') {
      // matrix(a, b, c, d, tx, ty) 또는 matrix3d(16 values)
      const m = t.match(/matrix(?:3d)?\(([^)]+)\)/)
      if (m) {
        const vals = m[1].split(',').map(Number)
        // matrix3d: vals[0]=m11, vals[5]=m22 (scale x, y)
        // matrix:   vals[0]=a,   vals[3]=d   (scale x, y)
        const sx = t.startsWith('matrix3d')
          ? Math.sqrt(vals[0] * vals[0] + vals[1] * vals[1] + vals[2] * vals[2])
          : Math.sqrt(vals[0] * vals[0] + vals[1] * vals[1])
        if (sx > 0.1 && sx < 10 && Math.abs(sx - 1) > 0.005) {
          cumulativeScale *= sx
          outermostTransformEl = ancestor
        }
      }
    }
    ancestor = ancestor.parentElement
  }

  if (Math.abs(cumulativeScale - 1) > 0.005 && outermostTransformEl) {
    const containerRect = outermostTransformEl.getBoundingClientRect()
    return {
      transformScale: cumulativeScale,
      originRect: {
        screenLeft: containerRect.left,
        screenTop: containerRect.top,
        cssWidth: outermostTransformEl.offsetWidth,
        cssHeight: outermostTransformEl.offsetHeight,
      }
    }
  }

  // 방법 2: offsetWidth vs getBoundingClientRect 비교 (폴백)
  const rect = testEl.getBoundingClientRect()
  const offsetW = testEl.offsetWidth
  if (offsetW > 1 && rect.width > 1) {
    const scale = rect.width / offsetW
    if (scale >= 0.5 && scale <= 2.0 && Math.abs(scale - 1) > 0.005) {
      return { transformScale: scale, originRect: null }
    }
  }

  return { transformScale: 1, originRect: null }
}

/**
 * getBoundingClientRect 값을 CSS 픽셀로 변환한다.
 * originRect가 있으면 해당 컨테이너를 기준으로 상대 좌표를 계산한 뒤 scale로 나눈다.
 * originRect가 없으면 절대 좌표를 scale로 나눈다.
 */
function unscaleRect(rect, scale, originRect) {
  if (scale === 1 && !originRect) return rect
  if (originRect) {
    // 스크린 좌표에서 원점 컨테이너 기준 상대값 계산 → scale로 나눔
    return {
      left: (rect.left - originRect.screenLeft) / scale,
      top: (rect.top - originRect.screenTop) / scale,
      right: (rect.right - originRect.screenLeft) / scale,
      bottom: (rect.bottom - originRect.screenTop) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    }
  }
  return {
    left: rect.left / scale,
    top: rect.top / scale,
    right: rect.right / scale,
    bottom: rect.bottom / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  }
}

/** 폰트 관련 URL인지 판별 */
function isFontUrl(href) {
  if (!href) return false
  const lower = href.toLowerCase()
  return lower.includes('fonts.googleapis.com') ||
         lower.includes('fonts.gstatic.com') ||
         lower.includes('font') ||
         lower.includes('pretendard') ||
         lower.includes('typekit') ||
         lower.includes('use.typekit.net')
}

/** 시스템/일반 폰트 (Google Fonts 임포트 불필요) */
const SYSTEM_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif',
  'arial', 'helvetica', 'times new roman', 'times', 'georgia', 'courier', 'courier new',
  'verdana', 'tahoma', 'trebuchet ms', 'impact', 'comic sans ms', 'lucida console',
  'apple sd gothic neo', 'malgun gothic', 'segoe ui', 'sf pro', 'sf pro display',
  'microsoft yahei', 'nanum gothic', 'gulim', 'dotum', 'batang',
])

/**
 * 추출된 요소들의 font-family를 스캔하여 기존 fontImports에 포함되지 않은
 * 웹폰트에 대해 Google Fonts import를 자동 생성한다.
 * cross-origin 스타일시트 안에 @import된 폰트를 보완하는 용도.
 */
function addMissingFontImports(elements, fontImports) {
  // 이미 import된 폰트명 수집 (URL에서 family= 파라미터 추출)
  const coveredFonts = new Set()
  const importText = fontImports.join(' ').toLowerCase()
  for (const el of elements) {
    if (!el.styles?.fontFamily) continue
    const families = parseFontFamilies(el.styles.fontFamily)
    for (const f of families) {
      if (importText.includes(f.toLowerCase().replace(/\s+/g, '+'))) {
        coveredFonts.add(f.toLowerCase())
      }
    }
  }

  // 누락된 웹폰트 수집
  const missingFonts = new Map() // fontName → Set of weights
  for (const el of elements) {
    if (!el.styles?.fontFamily) continue
    const families = parseFontFamilies(el.styles.fontFamily)
    const weight = el.styles.fontWeight || '400'
    for (const f of families) {
      const lower = f.toLowerCase()
      if (SYSTEM_FONTS.has(lower)) continue
      if (coveredFonts.has(lower)) continue
      if (!missingFonts.has(f)) missingFonts.set(f, new Set())
      missingFonts.get(f).add(weight)
      break // 첫 번째 폰트만 (나머지는 fallback)
    }
  }

  // Google Fonts import 생성
  for (const [fontName, weights] of missingFonts) {
    const sortedWeights = [...weights].sort().join(';')
    const encoded = fontName.replace(/\s+/g, '+')
    fontImports.push(`@import url('https://fonts.googleapis.com/css2?family=${encoded}:wght@${sortedWeights}&display=swap');`)
    coveredFonts.add(fontName.toLowerCase())
  }
}

/** font-family CSS 값에서 개별 폰트명 배열 추출 */
function parseFontFamilies(fontFamily) {
  return fontFamily
    .split(',')
    .map(f => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}
