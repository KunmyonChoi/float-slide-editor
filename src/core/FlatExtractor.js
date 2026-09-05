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

import { parseAnimAttrs, parseTransitionAttrs, readSlideNotes, resolveAnimSpecs } from './deckMotion.js'
import { normFractions, MAX_ROWS, MAX_COLS, TABLE_BORDER_COLOR } from './slideTable.js'

let _flatCounter = 0
export function nextFlatId() { return `flat-${++_flatCounter}` }
export function resetFlatCounter() { _flatCounter = 0 }
// 프로젝트 로드 시 기존 최대 ID로 카운터를 올려, 새 요소 ID가 기존 ID와 충돌하지 않게 한다.
export function bumpFlatCounterTo(n) { if (Number.isFinite(n) && n > _flatCounter) _flatCounter = n }

/**
 * 모션 컨텍스트 — 추출 1회 동안만 유효한 모듈 스코프 상태.
 * `[data-anim]` 호스트(=애니메이션을 선언한 DOM 요소) 목록과 파싱된 스펙을 담아,
 * 요소 생성 지점(buildFlatElement 등)에서 "이 요소가 어느 호스트에서 왔는지"만
 * 기록해 두고(_animIdx), 마지막 후처리에서 seq·참조를 해소해 el.anim으로 굳힌다.
 * (생성 지점이 여러 곳이라 인자 추가 대신 컨텍스트를 쓴다. 카운터와 동일한 패턴.)
 */
let _animCtx = null

function setupAnimContext(slideRoot) {
  const hosts = []
  const specs = []
  const byName = new Map()
  const nodes = slideRoot?.querySelectorAll?.('[data-anim]') || []
  for (const node of nodes) {
    const spec = parseAnimAttrs(node)
    if (!spec) continue          // 알 수 없는 효과/none → 무시
    const idx = hosts.length
    hosts.push(node)
    specs.push(spec)
    if (spec.name && !byName.has(spec.name)) byName.set(spec.name, idx)
  }
  _animCtx = hosts.length ? { hosts, specs, byName } : null
}

/** 이 DOM 요소를 덮는 가장 가까운 `[data-anim]` 호스트의 인덱스(없으면 -1). */
function animIdxFor(el) {
  if (!_animCtx || typeof el?.closest !== 'function') return -1
  const host = el.closest('[data-anim]')
  if (!host) return -1
  return _animCtx.hosts.indexOf(host)
}

/** 요소 리터럴에 펼쳐 넣는 `_animIdx` 필드(해당 없으면 빈 객체). */
function animField(el) {
  const i = animIdxFor(el)
  return i >= 0 ? { _animIdx: i } : {}
}

/**
 * 렌더되는 텍스트만 모은다 — `el.textContent`와 달리 `<script>`(발표자 노트 포함)나
 * `<style>`처럼 화면에 나오지 않는 자식은 뺀다.
 * 노트가 도입되기 전에는 textContent로 충분했지만, 이제 슬라이드 안에
 * `<script class="fe-notes">`가 있어 그대로 쓰면 원고가 텍스트 요소로 추출된다.
 */
function visibleTextContent(el) {
  if (!el) return ''
  let out = ''
  for (const node of el.childNodes) {
    if (node.nodeType === 3) { out += node.textContent; continue }   // TEXT_NODE
    if (node.nodeType !== 1) continue                                 // ELEMENT_NODE만
    const tag = node.tagName
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE') continue
    if (node.classList?.contains('fe-notes')) continue
    out += visibleTextContent(node)
  }
  return out
}

/** 후처리 — _animIdx가 붙은 flat 요소에 el.anim을 확정한다(해소 규칙은 deckMotion). */
function applyAnimSpecs(elements) {
  if (!_animCtx) {
    for (const el of elements) delete el._animIdx
    return
  }
  resolveAnimSpecs(elements, _animCtx.specs, _animCtx.byName)
}

/** 컨테이너가 시각적으로 의미 있는지 판별 (배경/테두리/그림자) */
export function isVisuallyMeaningful(cs) {
  const bg = cs.backgroundColor
  const hasBackground = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
  const bgImg = cs.backgroundImage
  const hasBgImage = bgImg && bgImg !== 'none' && !isSubtleGradient(bgImg)
  const hasBorder = cs.borderWidth && !cs.borderWidth.split(' ').every(v => v === '0px')
  const hasShadow = cs.boxShadow && cs.boxShadow !== 'none'
  return hasBackground || hasBgImage || hasBorder || hasShadow
}

/**
 * 미세한 장식용 그래디언트인지 판별.
 * radial-gradient가 투명으로 fade되면서 최대 rgba alpha가 낮으면 장식 효과로 간주.
 * 예: radial-gradient(rgba(14, 165, 233, 0.06) 0%, rgba(0, 0, 0, 0) 70%)
 */
const SUBTLE_GRADIENT_THRESHOLD = 0.25
export function isSubtleGradient(bgImage) {
  if (!bgImage || bgImage === 'none') return false
  // radial-gradient만 대상 (linear-gradient는 대부분 의미 있음)
  if (!bgImage.startsWith('radial-gradient')) return false
  // 투명으로 끝나는지 확인: rgba(..., 0) 이 포함되어야 함
  if (!/ 0\)/.test(bgImage)) return false
  // 모든 색상 stop의 alpha 값을 추출하여 최대값 확인.
  const alphas = []
  // rgba(...,a) / hsla(...,a) — 콤마 구분 alpha
  for (const m of bgImage.matchAll(/(?:rgba|hsla)\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*([\d.]+)\s*\)/g)) {
    alphas.push(parseFloat(m[1]))
  }
  // oklch/oklab/lch/lab/hwb/color(... / a) — 슬래시 구분 alpha.
  // 이게 없으면 선명한 oklch 그래디언트(예: .hm-frame 히트맵)가 rgba 투명 endpoint(alpha 0)만
  // 잡혀 'subtle'로 오판→배경 통째로 누락된다.
  for (const m of bgImage.matchAll(/(?:oklch|oklab|lch|lab|hwb|color)\([^)]*\/\s*([\d.]+%?)\s*\)/gi)) {
    const v = m[1]
    alphas.push(v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))
  }
  if (alphas.length === 0) return false
  return Math.max(...alphas) < SUBTLE_GRADIENT_THRESHOLD
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

  // 슬라이드 카운터 패턴: "N / M" 형태의 짧은 텍스트.
  // 슬래시 양쪽에 공백을 요구해 "24/7"(24시간 연중무휴) 같은 콘텐츠 비율 표현이
  // 페이지 카운터로 오인되지 않도록 한다. (실제 카운터는 보통 "01 / 10"처럼 공백 포함)
  const text = (el.textContent || '').trim()
  if (/^\d+\s+\/\s+\d+$/.test(text)) return true

  return false
}

/**
 * 배지/태그 패턴 감지: 라운드 테두리 + 배경/보더 + 단일행 짧은 텍스트.
 * 이 패턴은 flat 렌더링에서 가운데 정렬 + padding 제거가 편집에 유리하다.
 * flex 센터링이 시각적 위치를 유지하므로 padding 없이도 외관이 동일하다.
 */
export function isBadgeElement(styles, height, text) {
  if (!styles.borderRadius || styles.borderRadius === '0px') return false
  const hasBg = styles.backgroundColor &&
    styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
    styles.backgroundColor !== 'transparent'
  const hasBorder = (styles.border && !styles.border.startsWith('0px')) ||
    (styles.borderTop && !styles.borderTop.startsWith('0px'))
  if (!hasBg && !hasBorder) return false
  if (height > 60) return false
  const plain = (text || '').replace(/<[^>]+>/g, '').trim()
  if (plain.includes('\n') || plain.length > 50) return false
  return true
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
 * 인라인 요소가 시각적 박스(배경/테두리/radius/padding) 스타일을 computed로 가지는지 판별.
 * CSS 클래스로만 적용되어 inline `style=""`에 없는 케이스도 포함 (예: `.tag .tag-blue`).
 * 이 경우 해당 요소는 텍스트 흐름의 일부가 아니라 독립적인 시각 배지로 취급되어야 한다.
 */
export function hasVisualBoxStyle(el) {
  if (!el || !el.ownerDocument) return false
  const win = el.ownerDocument.defaultView
  if (!win) return false
  const cs = win.getComputedStyle(el)
  const bg = cs.backgroundColor
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return true
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true
  const bw = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0) +
             (parseFloat(cs.borderBottomWidth) || 0) + (parseFloat(cs.borderLeftWidth) || 0)
  if (bw > 0) return true
  if (cs.borderRadius && cs.borderRadius !== '0px' && cs.borderRadius !== '0%') return true
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingRight) || 0) +
              (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.paddingLeft) || 0)
  if (pad > 0) return true
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
        // 인라인 + CSS 박스 스타일(.tag 류 배지) + 비embedded → 독립 추출 대상이므로 제외.
        // embedded(주변에 텍스트 형제가 있는 경우, 예: <li>... <code>X</code> ...</li>)은
        // 텍스트 흐름의 일부로 유지해 위치 정합성을 보존해야 한다.
        if (hasVisualBoxStyle(node) && !isEmbeddedInline(node)) continue
        // 시각 박스가 없는 고유 스타일 인라인(색/폰트만)은 텍스트 흐름의 일부이므로
        // (예: <div><strong>A</strong><br><span style="color">B</span></div> 의 둘째 줄)
        // embedded 여부와 무관하게 스타일을 보존해 인라인으로 유지한다.
        // (배지=hasVisualBoxStyle만 독립 추출 — 그 외 스타일 인라인을 제외하면
        //  <br> 뒤 styled span 같은 흐름 텍스트가 통째로 소실된다)
        if (hasDistinctStyle(node)) {
          html += cleanInlineHtml(node)
          hasHtml = true
          continue
        }
      }
      // <li> 요소 → 부모(ul/ol)에 맞춰 리스트 마커 삽입
      // (CSS list-style 또는 li::before로 렌더링되어 textContent에 없으므로 직접 prefix)
      if (tag === 'li') {
        const m = computeListMarker(node)
        html += m.rich + escapeHtml(node.textContent)
        plain += m.plain + node.textContent
        if (m.rich) hasHtml = true
        continue
      }
      // 시맨틱 서식 태그(strong, em, b, i, u 등) → 태그 + 인라인 스타일 보존
      if (SEMANTIC_FORMAT_TAGS.has(tag)) {
        // 아이콘 폰트(예: Font Awesome <i class="fas fa-target">) 처리:
        // 실제 텍스트가 없고 ::before content에 글리프가 들어있는 경우,
        // 글리프를 폰트와 함께 인라인 <span>으로 emit하여 flat 결과에 보존한다.
        let nodeText = node.textContent
        if (!nodeText && win && (tag === 'i' || tag === 'span')) {
          const iconSpan = getIconGlyphSpan(node, win)
          if (iconSpan) {
            html += iconSpan
            plain += '' // 글리프는 의미 텍스트가 아니므로 plain에는 추가하지 않음
            hasHtml = true
            continue
          }
        }
        const inlineStyle = getSemanticInlineStyle(node)
        if (inlineStyle) {
          html += `<${tag} style="${inlineStyle}">${escapeHtml(nodeText)}</${tag}>`
        } else {
          html += `<${tag}>${escapeHtml(nodeText)}</${tag}>`
        }
        plain += nodeText
        hasHtml = true
        continue
      }
      // data-editor-id 없는 인라인 요소(예: <span class="c">, <span class="k">,
      // 또는 .tag .tag-blue 같은 CSS 배지). CSS 클래스로만 스타일된 경우
      // computed style을 인라인으로 보존.
      if (tag === 'span' && win) {
        const spanCs = win.getComputedStyle(node)
        const parentCs = win.getComputedStyle(el)
        const diffs = []
        // 텍스트 서식 차이
        if (spanCs.color !== parentCs.color) diffs.push(`color:${spanCs.color}`)
        if (spanCs.fontWeight !== parentCs.fontWeight) diffs.push(`font-weight:${spanCs.fontWeight}`)
        if (spanCs.fontStyle !== parentCs.fontStyle) diffs.push(`font-style:${spanCs.fontStyle}`)
        if (spanCs.fontSize !== parentCs.fontSize) diffs.push(`font-size:${spanCs.fontSize}`)
        if (spanCs.fontFamily !== parentCs.fontFamily) diffs.push(`font-family:${spanCs.fontFamily.replace(/"/g, "'")}`)
        // 배지/태그 박스 시각 속성 (배경/테두리/radius/padding)
        const bg = spanCs.backgroundColor
        const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
        if (hasBg) diffs.push(`background-color:${bg}`)
        const bgImage = spanCs.backgroundImage
        if (bgImage && bgImage !== 'none') diffs.push(`background-image:${bgImage}`)
        const borderW = (parseFloat(spanCs.borderTopWidth) || 0) + (parseFloat(spanCs.borderRightWidth) || 0) +
                        (parseFloat(spanCs.borderBottomWidth) || 0) + (parseFloat(spanCs.borderLeftWidth) || 0)
        const hasBorder = borderW > 0
        if (hasBorder) {
          const same = spanCs.borderTopColor === spanCs.borderRightColor &&
                       spanCs.borderTopColor === spanCs.borderBottomColor &&
                       spanCs.borderTopColor === spanCs.borderLeftColor &&
                       spanCs.borderTopWidth === spanCs.borderRightWidth &&
                       spanCs.borderTopWidth === spanCs.borderBottomWidth &&
                       spanCs.borderTopWidth === spanCs.borderLeftWidth &&
                       spanCs.borderTopStyle === spanCs.borderRightStyle &&
                       spanCs.borderTopStyle === spanCs.borderBottomStyle &&
                       spanCs.borderTopStyle === spanCs.borderLeftStyle
          if (same) {
            diffs.push(`border:${spanCs.borderTopWidth} ${spanCs.borderTopStyle} ${spanCs.borderTopColor}`)
          } else {
            diffs.push(`border-top:${spanCs.borderTopWidth} ${spanCs.borderTopStyle} ${spanCs.borderTopColor}`)
            diffs.push(`border-right:${spanCs.borderRightWidth} ${spanCs.borderRightStyle} ${spanCs.borderRightColor}`)
            diffs.push(`border-bottom:${spanCs.borderBottomWidth} ${spanCs.borderBottomStyle} ${spanCs.borderBottomColor}`)
            diffs.push(`border-left:${spanCs.borderLeftWidth} ${spanCs.borderLeftStyle} ${spanCs.borderLeftColor}`)
          }
        }
        const br = spanCs.borderRadius
        const hasRadius = br && br !== '0px' && br !== '0%'
        if (hasRadius) diffs.push(`border-radius:${br}`)
        const padTop = parseFloat(spanCs.paddingTop) || 0
        const padRight = parseFloat(spanCs.paddingRight) || 0
        const padBottom = parseFloat(spanCs.paddingBottom) || 0
        const padLeft = parseFloat(spanCs.paddingLeft) || 0
        const hasPad = padTop + padRight + padBottom + padLeft > 0
        if (hasPad) diffs.push(`padding:${spanCs.paddingTop} ${spanCs.paddingRight} ${spanCs.paddingBottom} ${spanCs.paddingLeft}`)
        // 박스 시각 속성이 있으면 display:inline-block을 강제하여 배경/테두리/padding이
        // 인라인 텍스트 흐름에서 박스로 렌더되도록 한다.
        const hasBox = hasBg || hasBorder || hasRadius || hasPad
        if (hasBox) {
          const d = spanCs.display
          diffs.push(`display:${(d === 'inline-block' || d === 'block') ? d : 'inline-block'}`)
        }
        if (diffs.length > 0) {
          html += `<span style="${diffs.join(';')}">${escapeHtml(node.textContent)}</span>`
          plain += node.textContent
          hasHtml = true
          continue
        }
      }
      // 스타일 차이 없으면 plain text로 포함
      html += escapeHtml(node.textContent)
      plain += node.textContent
    }
  }
  // isRich=true → HTML 문자열 (dangerouslySetInnerHTML용)
  // isRich=false → plain text (React 자동 이스케이프 / exporter에서 escHtml 1회)
  // 주의: 일반 trim() 은 \s 가 nbsp(U+00A0)까지 매칭하여 들여쓰기로 쓰인 nbsp 가
  // 제거된다(파일 트리 등). ASCII 공백/탭/개행만 trim.
  return { text: hasHtml ? trimAsciiWs(html) : trimAsciiWs(plain), isRich: hasHtml }
}

/** ASCII 공백·탭·개행만 trim (nbsp/em-space 등 의미 있는 들여쓰기 문자는 보존). */
function trimAsciiWs(s) {
  return String(s).replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')
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
 * 아이콘 폰트(`<i class="fas fa-target">`, `<span class="material-icons">` 등)에서
 * ::before로 그려지는 글리프를 인라인 텍스트로 변환한다.
 * textContent가 비어있고 ::before content가 실제 글리프(빈 문자열 아님)인 경우에만 동작.
 *
 * @returns {string|null} `<span style="...">글리프</span>` HTML, 글리프 없으면 null
 */
export function getIconGlyphSpan(el, win) {
  if (!win) return null
  const pcs = win.getComputedStyle(el, '::before')
  if (!pcs) return null
  const rawContent = pcs.content
  if (!rawContent || rawContent === 'none' || rawContent === 'normal') return null
  // content는 보통 따옴표로 둘러싸여 있음: '"\f140"' 또는 "'\f140'"
  let glyph = rawContent
  // attr()/counter()/var() 등 함수형 content는 텍스트로 추출 불가 → 스킵
  if (/^(attr|counter|counters|var|url|element|target-text|leader)\s*\(/i.test(glyph)) return null
  // 양 끝 따옴표 제거
  const quoted = glyph.match(/^["'](.*)["']$/)
  if (quoted) glyph = quoted[1]
  // CSS 이스케이프 해제: "\f140" → 실제 Unicode 코드포인트
  glyph = decodeCssEscapes(glyph)
  if (!glyph) return null

  // ::before 의 폰트 정보 (FA 폰트 패밀리/굵기)
  const fontFamily = pcs.fontFamily || ''
  const fontWeight = pcs.fontWeight || ''
  const fontStyle = pcs.fontStyle || ''
  const color = pcs.color || ''
  const styleParts = []
  if (fontFamily) styleParts.push(`font-family:${fontFamily.replace(/"/g, "'")}`)
  if (fontWeight && fontWeight !== '400' && fontWeight !== 'normal') styleParts.push(`font-weight:${fontWeight}`)
  if (fontStyle && fontStyle !== 'normal') styleParts.push(`font-style:${fontStyle}`)
  // 색상은 요소 자체의 color와 다를 때만 명시 (보통 동일)
  const elColor = win.getComputedStyle(el).color
  if (color && color !== elColor) styleParts.push(`color:${color}`)
  // FA 글리프는 가변폭 무관 — 줄바꿈 방지
  styleParts.push('font-variant:normal')
  styleParts.push('text-rendering:auto')
  styleParts.push('line-height:1')

  return `<span style="${styleParts.join(';')}">${escapeHtml(glyph)}</span>`
}

/**
 * `<li>`의 리스트 마커를 계산.
 * 우선순위:
 *   1. `list-style-type`이 `none`이 아니면: `<ol>`은 `1. `, 그 외(`<ul>` 등)는 `• `.
 *   2. `list-style-type: none`이지만 `::before`에 텍스트 글리프가 있으면(예: `→ `):
 *      그 글리프를 마커로 사용. ::before 자체 color/font-weight가 li와 다르면
 *      `<span style="…">` 으로 감싸 rich 형식으로 반환.
 *   3. 둘 다 없으면 빈 마커.
 *
 * @param {Element} li
 * @returns {{ plain: string, rich: string }} plain = 텍스트 prefix,
 *          rich = HTML prefix (rich !== plain이면 컨텐츠를 isRich=true로 승격해야 함)
 */
export function computeListMarker(li) {
  const EMPTY = { plain: '', rich: '' }
  if (!li || li.tagName.toLowerCase() !== 'li') return EMPTY
  const win = li.ownerDocument?.defaultView
  if (!win) return EMPTY
  const liCs = win.getComputedStyle(li)
  // 1. CSS list-style이 살아있으면 그 우선
  if (liCs.listStyleType !== 'none') {
    const parent = li.parentElement
    const parentTag = parent?.tagName?.toLowerCase()
    if (parentTag === 'ol') {
      const start = parseInt(parent.getAttribute('start'), 10)
      const base = isFinite(start) ? start : 1
      let idx = 0
      for (const sib of parent.children) {
        if (sib.tagName.toLowerCase() === 'li') {
          if (sib === li) break
          idx += 1
        }
      }
      const s = `${base + idx}. `
      return { plain: s, rich: s }
    }
    return { plain: '• ', rich: '• ' }
  }
  // 2. list-style:none 일 때 ::before content를 마커로 사용
  const pcs = win.getComputedStyle(li, '::before')
  const rawContent = pcs?.content
  if (!rawContent || rawContent === 'none' || rawContent === 'normal') return EMPTY
  // attr()/counter()/url() 등 함수형은 텍스트로 변환 불가
  if (/^(attr|counter|counters|var|url|element|target-text|leader)\s*\(/i.test(rawContent)) return EMPTY
  let glyph = rawContent
  const quoted = glyph.match(/^["'](.*)["']$/)
  if (quoted) glyph = quoted[1]
  glyph = decodeCssEscapes(glyph)
  if (!glyph) return EMPTY
  // ::before의 색/굵기가 li와 다르면 inline 스타일 보존
  const styleParts = []
  if (pcs.color && pcs.color !== liCs.color) styleParts.push(`color:${pcs.color}`)
  if (pcs.fontWeight && pcs.fontWeight !== liCs.fontWeight) styleParts.push(`font-weight:${pcs.fontWeight}`)
  if (pcs.fontStyle && pcs.fontStyle !== liCs.fontStyle && pcs.fontStyle !== 'normal') styleParts.push(`font-style:${pcs.fontStyle}`)
  const richGlyph = styleParts.length
    ? `<span style="${styleParts.join(';')}">${escapeHtml(glyph)}</span>`
    : escapeHtml(glyph)
  return { plain: glyph, rich: richGlyph }
}

/** CSS content의 이스케이프 시퀀스를 실제 문자로 변환.
 *  e.g. "\f140" → "", "\\41 a" → "Aa". 공백 1개는 종결자로 소비된다. */
function decodeCssEscapes(str) {
  if (!str) return str
  // \HHHHHH (1~6자리 hex) + 선택적 공백 1개
  return str.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => {
    const code = parseInt(hex, 16)
    if (!isFinite(code) || code === 0) return ''
    try { return String.fromCodePoint(code) } catch { return '' }
  }).replace(/\\(.)/g, '$1')
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

/**
 * getComputedStyle().fontFamily는 CSS 변수와 유틸리티 클래스가 해석된
 * 긴 시스템 폰트 스택을 반환할 수 있다.
 * 예: 'JetBrains Mono', monospace → ui-monospace, SFMono-Regular, Menlo, ...
 *
 * 이 함수는 요소의 조상 체인에서 인라인 style이나 CSS 규칙에 명시된
 * 원본 font-family를 찾아 computed 값보다 우선 사용한다.
 */
function _resolveComputedFontFamily(computedFF, el) {
  if (!el || !computedFF) return computedFF

  // 1. 요소 자체 또는 조상의 인라인 style.fontFamily 확인
  let node = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const inlineFF = node.style?.fontFamily
    if (inlineFF) return inlineFF
    node = node.parentElement
  }

  // 2. computed 값에서 시스템 폰트만 있는 긴 스택 감지
  //    (4개 이상의 폰트가 나열되고, 첫 폰트가 시스템 폰트이면 확장된 스택)
  const families = computedFF.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, ''))
  if (families.length >= 4) {
    const firstLower = families[0].toLowerCase()
    if (SYSTEM_FONTS.has(firstLower) || firstLower.startsWith('ui-')) {
      // CSS 규칙에서 원본 font-family 찾기
      const origFF = _findOriginalFontFamily(el)
      if (origFF) return origFF
    }
  }

  return computedFF
}

/**
 * 요소에 적용된 CSS 규칙에서 원본 font-family 값을 찾는다.
 * getComputedStyle이 해석한 값 대신 CSS에 선언된 원래 값을 반환.
 */
function _findOriginalFontFamily(el) {
  const win = el.ownerDocument?.defaultView
  if (!win) return null

  // 요소에 매치된 CSS 규칙에서 font-family 찾기
  try {
    const matched = win.getMatchedCSSRules?.(el)
    if (matched) {
      for (let i = matched.length - 1; i >= 0; i--) {
        const ff = matched[i].style?.fontFamily
        if (ff) return ff
      }
    }
  } catch {}

  // getMatchedCSSRules가 없는 브라우저: CSSOM으로 직접 탐색
  try {
    for (const sheet of el.ownerDocument.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules
        if (!rules) continue
        for (const rule of rules) {
          if (rule.style?.fontFamily && el.matches?.(rule.selectorText)) {
            return rule.style.fontFamily
          }
        }
      } catch { /* cross-origin */ }
    }
  } catch {}

  return null
}

/** 요소에서 시각적 스타일을 추출 */
function extractStyles(cs, el) {
  const fontFamily = _resolveComputedFontFamily(cs.fontFamily, el)
  return {
    backgroundColor: cs.backgroundColor,
    color: cs.color,
    fontSize: cs.fontSize,
    fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    fontVariationSettings: cs.fontVariationSettings,
    fontFeatureSettings: cs.fontFeatureSettings,
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
    // 배경 이미지 배치(코드 블록 신호등 SVG 등) — 이미지 있을 때만 보존(없으면 기본값 노이즈 방지)
    ...(cs.backgroundImage && cs.backgroundImage !== 'none' ? {
      backgroundRepeat: cs.backgroundRepeat,
      backgroundSize: cs.backgroundSize,
      backgroundPosition: cs.backgroundPosition,
    } : {}),
    backgroundClip: cs.backgroundClip || cs.webkitBackgroundClip,
    webkitBackgroundClip: cs.webkitBackgroundClip,
    webkitTextFillColor: cs.webkitTextFillColor,
    padding: cs.padding,
    letterSpacing: cs.letterSpacing,
    textTransform: cs.textTransform,
    textDecoration: cs.textDecoration,
    objectFit: cs.objectFit,
    objectPosition: cs.objectPosition,
    overflow: cs.overflow,
    overflowX: cs.overflowX,
    // pre 계열 white-space만 보존(코드 블록 <pre> 등 — 소프트 줄바꿈 금지).
    // normal/pre-wrap은 미설정 → 렌더러 기본값 pre-wrap으로 \n·공백 보존.
    ...(/^(pre|pre-line|nowrap)$/.test(cs.whiteSpace || '') ? { whiteSpace: cs.whiteSpace } : {}),
    textShadow: cs.textShadow,
    // flex 정렬 (inline-flex/flex 요소의 내부 정렬)
    display: cs.display,
    alignItems: cs.alignItems,
    justifyContent: cs.justifyContent,
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
  // z-index는 클래스 규칙으로 설정되는 경우가 많아(예: .evidence-stamp{z-index:3})
  // 인라인 스타일만 보면 놓친다. 인라인 우선, 없으면 계산된 z-index를 사용해
  // 이미지 위에 겹쳐진 라벨/스탬프 등이 이미지에 가려지지 않게 한다.
  const win = el.ownerDocument && el.ownerDocument.defaultView
  let maxZ = null
  let node = el
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    let z = node.style.zIndex
    if ((!z || z === 'auto') && win) {
      try { z = win.getComputedStyle(node).zIndex } catch { z = '' }
    }
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
    else if (editorType === 'video') type = 'video'
    else if (editorType === 'text') type = 'text'
    else type = 'shape'
  }

  let content = ''
  let isRich = false
  let liMarkerFromBefore = false // <li> 마커가 ::before content에서 온 경우(중복 추출 방지)
  if (type === 'image') {
    content = el.getAttribute('src') || ''
  } else if (type === 'video') {
    // 실제 재생 중인 src 우선(번들 미디어 세터가 data-res-id→data:URL로 설정),
    // 없으면 src 속성 또는 <source> 자식. (자동재생/음소거 등 속성도 보존)
    content = el.currentSrc || el.getAttribute('src') ||
      el.querySelector('source')?.getAttribute('src') || ''
  } else if (type === 'text') {
    const rich = getRichTextContent(el)
    content = rich.text
    isRich = rich.isRich

    // <li>가 단독 추출될 때 부모 ul/ol의 리스트 마커를 content 앞에 prefix.
    // (ul/ol을 통한 getRichTextContent 경로에서는 이미 line 200-205에서 처리되지만,
    //  메인 루프에서 각 <li>가 독립 추출되는 경로에는 마커가 없음 — 여기서 보완)
    if (el.tagName.toLowerCase() === 'li') {
      const m = computeListMarker(el)
      if (m.rich) {
        const richIsHtml = m.rich !== m.plain
        if (isRich) {
          content = m.rich + content
        } else if (richIsHtml) {
          // 마커가 HTML(span style …)이면 컨텐츠를 isRich로 승격
          content = m.rich + escapeHtml(content)
          isRich = true
        } else {
          content = m.plain + content
        }
        // list-style:none + ::before content를 마커로 쓴 경우, 그 ::before는 이미
        // 텍스트 마커로 포함됐으므로 별도 pseudo 요소로 추출하지 않는다(화살표 중복 방지).
        const win = el.ownerDocument?.defaultView
        if (win && win.getComputedStyle(el).listStyleType === 'none') {
          liMarkerFromBefore = true
        }
      }
    }
  }

  // 원본 CSS z-index 캡처: 자신 또는 조상 중 가장 높은 명시적 z-index 사용
  const effectiveZIndex = getEffectiveZIndex(el)

  const styles = extractStyles(cs, el)
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

    // (조상 너비 클리핑은 모든 너비 보정 이후에 적용 — 아래 참조)

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
    // textContent의 개행은 white-space가 pre 계열일 때만 실제 줄바꿈이다. normal이면 HTML
    // 소스 들여쓰기 개행(인라인 span 사이 등)이 렌더 시 공백으로 collapse되므로 줄바꿈으로
    // 세면 안 된다. (예: .qa-title "Q & A"는 span 사이 소스 개행 때문에 의도된 줄바꿈으로
    //  오판→nowrap 보정이 누락되어 빠듯한 박스가 flat 렌더에서 줄바꿈됨)
    const wsPre = cs.whiteSpace === 'pre' || cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'pre-line'
    const nlCount = wsPre ? ((el.textContent || '').match(/\n/g) || []).length : 0
    const intendedBreaks = brCount + nlCount
    // pre/code 블록은 줄바꿈이 의도된 것이므로 스킵
    // (monospace 폰트 사용 여부가 아닌, 실제 pre 태그 기반으로 판별)
    const elTag = el.tagName.toLowerCase()
    const isCodeBlock = elTag === 'pre' || elTag === 'code' || !!el.closest('pre')
    // 원본이 이미 여러 줄이면(높이 기준) 의도된 줄바꿈이므로 nowrap 보정을 건너뛴다.
    // 판단은 너비가 아닌 높이/lineHeight로 한다 — nowrap 측정 시 요소 자신의 max-width에
    // 캡되어 단일행 너비가 실제보다 좁게(=현재 너비와 동일하게) 잡혀 단일행으로 오판되는
    // 문제를 피하기 위함. (줄바꿈 판단에만 소폭 마진: 1.5줄)
    const isOriginalSingleLine = lineHeight > 0 ? rect.height <= lineHeight * 1.5 : true
    // pre/code 블록 감지 (nowrap 보정 스킵용)
    if (!isCodeBlock && intendedBreaks === 0 && isOriginalSingleLine) {
      // 부모 컨테이너가 너비를 제한하는지 확인:
      // 요소 너비가 부모 내부 너비(padding 제외)와 거의 같으면
      // 부모에 의한 의도된 줄바꿈이므로 보정하지 않는다.
      // 단, 부모 자체가 row-flex의 shrink-wrapped 아이템이면 제약이 아님:
      // 부모 너비가 콘텐츠에 맞게 축소된 것이므로 nowrap 보정이 필요하다.
      let parentConstrained = false
      // 독립 추출된 인라인 태그(span, strong 등)는 flat 렌더링에서
      // 부모 제약 없이 독립 div로 배치되므로 항상 nowrap 보정이 필요
      const tag = el.tagName.toLowerCase()
      const isIndependentInline = INLINE_TAGS.has(tag)
      if (!isIndependentInline) {
        // 직접 부모 또는 조상 중 overflow:hidden이 있으면 너비가 제한됨
        const win = el.ownerDocument.defaultView
        if (win) {
          let ancestor = el.parentElement
          while (ancestor && ancestor.tagName !== 'BODY') {
            const ancCs = win.getComputedStyle(ancestor)
            const ancRect = unscaleRect(ancestor.getBoundingClientRect(), transformScale, originRect)
            const ancPadL = parseFloat(ancCs.paddingLeft) || 0
            const ancPadR = parseFloat(ancCs.paddingRight) || 0
            const ancContentW = ancRect.width - ancPadL - ancPadR
            const ancOverflow = ancCs.overflow || ''
            const ancOverflowX = ancCs.overflowX || ''
            const isClipped = ancOverflow.includes('hidden') || ancOverflowX === 'hidden'
            // 요소 너비가 조상 내부 너비의 95% 이상이면 제약 확인
            if (ancContentW > 0 && width >= ancContentW * 0.95) {
              if (isClipped) {
                // overflow:hidden 조상에 의해 확실히 제약됨
                parentConstrained = true
                break
              }
              // overflow:hidden이 아니어도 직접 부모이면 추가 체크
              if (ancestor === el.parentElement) {
                let parentIsShrinkWrapped = false
                const grandParent = ancestor.parentElement
                if (grandParent && grandParent.tagName !== 'BODY') {
                  const gpCs = win.getComputedStyle(grandParent)
                  const gpIsFlex = gpCs.display === 'flex' || gpCs.display === 'inline-flex'
                  if (gpIsFlex) {
                    const gpFlexDir = gpCs.flexDirection || 'row'
                    const isRowFlex = gpFlexDir === 'row' || gpFlexDir === 'row-reverse'
                    const parentFlexGrow = parseFloat(win.getComputedStyle(ancestor).flexGrow) || 0
                    if (isRowFlex && parentFlexGrow === 0) {
                      parentIsShrinkWrapped = true
                    }
                  }
                }
                if (!parentIsShrinkWrapped) {
                  parentConstrained = true
                  break
                }
              }
            }
            ancestor = ancestor.parentElement
          }
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
          // nowrap 너비가 원래보다 넓음 → 줄바꿈이 있었음 (원본이 단일행인 경우만
          // 여기 도달 — 다중행은 상단 isOriginalSingleLine 게이트에서 제외됨).
          // overflow:visible 등으로 높이엔 안 드러난 단일행 너비 부족을 교정한다.
          // 단, 확장 너비가 가장 가까운 editor 조상 가용 너비를 초과하면 의도된 줄바꿈.
          let ancestorMaxW = Infinity
          const nWin = el.ownerDocument.defaultView
          if (nWin) {
            let nAnc = el.parentElement
            while (nAnc && nAnc.tagName !== 'BODY') {
              if (nAnc.hasAttribute('data-editor-id')) {
                const nAncRect = unscaleRect(nAnc.getBoundingClientRect(), transformScale, originRect)
                const nAncCs = nWin.getComputedStyle(nAnc)
                const nPadL = parseFloat(nAncCs.paddingLeft) || 0
                const nPadR = parseFloat(nAncCs.paddingRight) || 0
                ancestorMaxW = nAncRect.width - nPadL - nPadR
                break
              }
              nAnc = nAnc.parentElement
            }
          }
          const expandedW = Math.ceil(nowrapRect.width) + 4
          if (expandedW <= ancestorMaxW + 2) {
            width = expandedW
            height = Math.ceil(lineHeight) || Math.ceil(nowrapRect.height)
            styles.whiteSpace = 'nowrap'
          }
          // 조상 범위 초과 → 원래 너비 유지 (의도된 줄바꿈)
        } else if (nowrapRect.width > 0 && nowrapRect.width >= width - 1) {
          // 단일행이지만 측정 너비와 nowrap 너비가 거의 동일 (경계값):
          // 렌더링 컨텍스트 차이로 인한 폰트 메트릭 미세 차이로 줄바꿈이 발생할 수 있음.
          // 배경 없음 + 그래디언트 텍스트 없음 요소에 +4px 버퍼 적용.
          // center/right 정렬은 너비 확장 시 시각적 중심이 이동하므로 x도 함께 보정.
          const hasBg = styles.backgroundColor &&
                        styles.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                        styles.backgroundColor !== 'transparent'
          const hasGradientText = styles.webkitBackgroundClip === 'text' ||
                                  (styles.backgroundImage && styles.backgroundImage !== 'none')
          if (!hasBg && !hasGradientText) {
            // 단일행 보존: 너비·위치는 그대로 두고 nowrap만 적용해 서브픽셀
            // 재줄바꿈만 방지한다. (너비 버퍼를 더하면 center/right 정렬에서
            // 시각적 중심이 이동하므로 사용하지 않는다 — 줄바꿈 판단에만 의존)
            styles.whiteSpace = 'nowrap'
          }
        }
      }
    }
  }

  // 배지 패턴: padding 제거 + 가운데 정렬 (편집 편의 + 줄바꿈 방지)
  // 비배지: padding이 있으면 서브픽셀 보정 (+2px)
  if (hasTextContent && styles.padding && styles.padding !== '0px') {
    if (isBadgeElement(styles, height, content)) {
      // 배지(예: .take "TAKE 01"): padding 제거 후 박스 높이가 텍스트보다 크므로
      // flex 가운데 정렬을 명시해 텍스트를 세로·가로 중앙에 둔다.
      // (병합 컨테이너 배지 경로와 동일하게 처리 — 누락 시 텍스트가 위로 붙는다)
      styles.padding = '0px'
      styles.textAlign = 'center'
      styles.isFlex = true
      styles.justifyContent = 'center'
      styles.alignItems = 'center'
    } else {
      const padParts = styles.padding.split(' ').map(p => parseFloat(p) || 0)
      const padH = padParts.length === 4 ? padParts[1] + padParts[3]
                 : padParts.length >= 2 ? padParts[1] * 2
                 : padParts[0] * 2
      if (padH > 0) {
        width = Math.ceil(width) + 2
      }
    }
  }

  // 최종 너비 클리핑: 조상 중 overflow:hidden 컨테이너가 있으면
  // 텍스트 너비를 그 조상의 가용 영역으로 제한
  // (nowrap 보정 등으로 확장된 후에도 적용)
  // 주의: overflow:visible인 shrink-wrapped 부모는 클리핑하지 않음
  if (hasTextContent) {
    const clipWin = el.ownerDocument.defaultView
    if (clipWin) {
      let clipAnc = el.parentElement
      while (clipAnc && clipAnc.tagName !== 'BODY') {
        const clipAncCs = clipWin.getComputedStyle(clipAnc)
        const ancOverflow = clipAncCs.overflow || ''
        const ancOverflowX = clipAncCs.overflowX || ''
        const isClipped = ancOverflow.includes('hidden') || ancOverflow.includes('clip') ||
                          ancOverflowX === 'hidden' || ancOverflowX === 'clip'
        if (isClipped) {
          const clipAncRect = unscaleRect(clipAnc.getBoundingClientRect(), transformScale, originRect)
          const padL = parseFloat(clipAncCs.paddingLeft) || 0
          const padR = parseFloat(clipAncCs.paddingRight) || 0
          const clipContentW = clipAncRect.width - padL - padR
          if (clipContentW > 0 && width > clipContentW + 2) {
            width = clipContentW
          }
          break
        }
        clipAnc = clipAnc.parentElement
      }
    }
  }

  // transform: rotate() 추출 (컨테이너 스케일과 구분)
  let rotation = 0
  const elTransform = cs.transform
  if (elTransform && elTransform !== 'none') {
    const m = elTransform.match(/matrix\(([^)]+)\)/)
    if (m) {
      const vals = m[1].split(',').map(Number)
      const angle = Math.round(Math.atan2(vals[1], vals[0]) * 180 / Math.PI)
      // 스케일만 있는 경우(angle≈0) 무시
      if (Math.abs(angle) > 0.5) rotation = angle
    }
  }

  let elemX = flexParentX !== null ? flexParentX : rect.left
  let elemY = rect.top
  // 회전된 요소: getBoundingClientRect()는 회전 후 축정렬 bbox(예: 6×70 막대를 -45° 회전 →
  // 약 54×54)를 돌려준다. 그대로 width/height로 쓰고 rotation까지 다시 적용하면 회전이
  // 이중 적용돼 가는 선이 회전된 사각형이 된다. 회전 시엔 회전 전 레이아웃 크기
  // (offsetWidth/Height = CSS px = 비스케일 논리 좌표)를 쓰고 bbox 중심 기준으로 배치한다.
  if (rotation !== 0 && el.offsetWidth > 0 && el.offsetHeight > 0) {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    width = el.offsetWidth
    height = el.offsetHeight
    elemX = cx - width / 2
    elemY = cy - height / 2
  }

  const animIdx = animIdxFor(el)
  const result = {
    id: nextFlatId(),
    sourceId: el.getAttribute('data-editor-id'),
    type,
    x: elemX,
    y: elemY,
    width,
    height,
    rotation,
    zIndex: 0, // 후처리에서 재할당
    ...(animIdx >= 0 ? { _animIdx: animIdx } : {}),
    _domOrder: domOrder,
    _originalZIndex: effectiveZIndex,
    content,
    isRich,
    styles,
    // 원본 레이아웃 (너비 보정 전 getBoundingClientRect 결과)
    originalRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
  }

  // ::before / ::after 의사 요소 추출 — CSS로 렌더링되는 불릿, 도트, 장식 등.
  // 단, <li> 마커로 이미 텍스트에 포함된 ::before(화살표·불릿)는 중복이므로 제외.
  const pseudoBefore = liMarkerFromBefore ? null : extractPseudoElement(el, rect, '::before')
  if (pseudoBefore) result._pseudoBefore = pseudoBefore
  const pseudoAfter = extractPseudoElement(el, rect, '::after')
  if (pseudoAfter) result._pseudoAfter = pseudoAfter

  // inline-flex/flex 요소에 선두 ::before 장식(불릿)이 가로로 배치되고 직접 텍스트가 있으면,
  // 텍스트 박스를 불릿+gap만큼 오른쪽으로 밀어 겹침을 막는다. 불릿은 별도 요소로 왼쪽에 남는다.
  // (예: .chip — display:inline-flex; gap:14px; ::before 원형 불릿 + "SOLUTION / ARCHITECTURE")
  if (type === 'text' && content && pseudoBefore && pseudoBefore.w > 0) {
    const isFlex = cs.display === 'flex' || cs.display === 'inline-flex'
    const beforeAtLeft = Math.abs(pseudoBefore.x - rect.left) < 2 && pseudoBefore.h < rect.height + 2
    if (isFlex && beforeAtLeft) {
      const gap = parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0
      const offset = pseudoBefore.w + gap
      if (offset > 0 && offset < result.width) {
        result.x += offset
        result.width -= offset
      }
    }
  }

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

  let w = parseFloat(pcs.width) || 0
  let h = parseFloat(pcs.height) || 0
  const bg = pcs.backgroundColor
  const bgImage = pcs.backgroundImage
  const hasBg = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') ||
                (bgImage && bgImage !== 'none')

  // 텍스트 content ('')이 아닌 실제 텍스트도 있을 수 있음
  const isEmptyContent = content === '""' || content === "''" || content === 'normal' || content === 'none'
  const textContent = isEmptyContent ? '' : content.replace(/^["']|["']$/g, '')

  // 텍스트 글리프인데 width/height가 0(auto)으로 잡히면 font-size 기준으로 보정
  const fontSizePx = parseFloat(pcs.fontSize) || 0
  if (textContent && fontSizePx > 0) {
    if (w < 1) w = Math.ceil(fontSizePx * Math.max(1, textContent.length))
    if (h < 1) h = Math.ceil(fontSizePx * 1.4)
  }

  // padding/border를 더해 border-box 크기로 확장한다.
  // getComputedStyle().width/height는 content-box 값이라, padding 있는 배지(예:
  // .clip.lip::before "AI" — padding:1px 4px)는 그대로 쓰면 박스가 텍스트만큼 작아진다.
  // flat 렌더러는 box-sizing:border-box이므로 padding을 함께 보존하면 내부에 텍스트가 들어간다.
  const padL = parseFloat(pcs.paddingLeft) || 0
  const padR = parseFloat(pcs.paddingRight) || 0
  const padT = parseFloat(pcs.paddingTop) || 0
  const padB = parseFloat(pcs.paddingBottom) || 0
  const bdL = parseFloat(pcs.borderLeftWidth) || 0
  const bdR = parseFloat(pcs.borderRightWidth) || 0
  const bdT = parseFloat(pcs.borderTopWidth) || 0
  const bdB = parseFloat(pcs.borderBottomWidth) || 0
  if (w > 0) w += padL + padR + bdL + bdR
  if (h > 0) h += padT + padB + bdT + bdB
  const hasPadding = (padL + padR + padT + padB) > 0

  // 테두리(border-only 장식: 예 .flow-step::after 화살표 — border-top/right + rotate)
  const borderW = bdT + bdR + bdB + bdL
  const hasBorder = borderW > 0

  // 시각적 의미 없으면 무시 (content·배경·테두리 없고 크기도 없음)
  if (!hasBg && !textContent && !hasBorder && (w < 1 || h < 1)) return null

  // 위치 계산: absolute면 left/right, top/bottom 어느 쪽이든 지정된 기준으로.
  // (예: ●  점이 top:3px;right:5px로 우상단에 위치 — right/bottom도 처리)
  const elCs = win.getComputedStyle(el)
  let x = parentRect.left
  if (pcs.left && pcs.left !== 'auto') x = parentRect.left + (parseFloat(pcs.left) || 0)
  else if (pcs.right && pcs.right !== 'auto') x = parentRect.left + parentRect.width - (parseFloat(pcs.right) || 0) - w
  let y = parentRect.top
  if (pcs.top && pcs.top !== 'auto') y = parentRect.top + (parseFloat(pcs.top) || 0)
  else if (pcs.bottom && pcs.bottom !== 'auto') y = parentRect.top + parentRect.height - (parseFloat(pcs.bottom) || 0) - h
  else if (elCs.display === 'flex' || elCs.display === 'inline-flex') {
    // top/bottom 미지정 + flex 부모: 부모의 세로 정렬(align-items)을 반영한다.
    // (정적 위치 의사요소는 flex 흐름에 참여해 세로 중앙/하단에 배치되는데,
    //  CSS top/left가 auto라 기존엔 부모 top에 붙어 위로 떠 보였다 — 예: .kicker::before 불릿)
    const ai = elCs.alignItems
    if (ai === 'center') y = parentRect.top + (parentRect.height - h) / 2
    else if (ai === 'flex-end' || ai === 'end') y = parentRect.top + parentRect.height - h
  }

  // transform: rotate() 추출 (회전 장식 — 꺾인 화살표 등)
  let rotation = 0
  const t = pcs.transform
  if (t && t !== 'none') {
    const m = t.match(/matrix\(([^)]+)\)/)
    if (m) {
      const v = m[1].split(',').map(Number)
      const ang = Math.round(Math.atan2(v[1], v[0]) * 180 / Math.PI)
      if (Math.abs(ang) > 0.5) rotation = ang
    }
  }

  const out = {
    x,
    y,
    w,
    h,
    backgroundColor: bg,
    backgroundImage: bgImage && bgImage !== 'none' ? bgImage : undefined,
    borderRadius: pcs.borderRadius || '0px',
    content: textContent,
  }
  // 테두리로 그린 장식은 각 변 테두리 보존
  if (hasBorder) {
    out.borderTop = `${pcs.borderTopWidth} ${pcs.borderTopStyle} ${pcs.borderTopColor}`
    out.borderRight = `${pcs.borderRightWidth} ${pcs.borderRightStyle} ${pcs.borderRightColor}`
    out.borderBottom = `${pcs.borderBottomWidth} ${pcs.borderBottomStyle} ${pcs.borderBottomColor}`
    out.borderLeft = `${pcs.borderLeftWidth} ${pcs.borderLeftStyle} ${pcs.borderLeftColor}`
  }
  if (rotation) out.rotation = rotation
  // 텍스트 글리프(불릿/도트 등)는 색·폰트도 보존
  if (textContent) {
    out.color = pcs.color
    out.fontSize = pcs.fontSize
    out.fontFamily = pcs.fontFamily
    // 의사요소가 flex로 글자를 중앙정렬하는 경우(예: .glass::after '?' — inset:0 +
    // display:flex; align-items/justify-content:center) 정렬을 보존한다. 없으면 flat
    // 렌더러가 좌상단에 붙여 '?'가 원 중앙에서 벗어난다.
    if (pcs.display === 'flex' || pcs.display === 'inline-flex') {
      out.display = pcs.display
      out.alignItems = pcs.alignItems
      out.justifyContent = pcs.justifyContent
      if (pcs.justifyContent === 'center') out.textAlign = 'center'
      else if (pcs.justifyContent === 'flex-end' || pcs.justifyContent === 'end') out.textAlign = 'right'
    }
    // 배지(예: "AI" 라벨)의 padding 보존 — w/h를 border-box로 확장했으므로
    // box-sizing:border-box인 flat 렌더러에서 텍스트가 안쪽에 배치된다.
    if (hasPadding) {
      out.padding = `${pcs.paddingTop} ${pcs.paddingRight} ${pcs.paddingBottom} ${pcs.paddingLeft}`
      out.textAlign = 'center'
    }
  }
  return out
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
    const text = visibleTextContent(containerEl).trim()
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
        fontVariationSettings: containerCs.fontVariationSettings,
        fontFeatureSettings: containerCs.fontFeatureSettings,
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
          fontVariationSettings: containerCs.fontVariationSettings,
          fontFeatureSettings: containerCs.fontFeatureSettings,
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
          fontVariationSettings: containerCs.fontVariationSettings,
          fontFeatureSettings: containerCs.fontFeatureSettings,
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
        fontVariationSettings: textCs.fontVariationSettings,
        fontFeatureSettings: textCs.fontFeatureSettings,
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

  // Case B: 여러 인라인 자식 → getRichTextContent로 리치 텍스트 병합.
  //   단, flex 컨테이너는 자식들이 독립 위치를 가지므로 병합하지 않는다(null 반환 →
  //   호출부에서 shape + 자식 독립 추출로 처리). 병합 시 getRichTextContent가
  //   배지/도트(hasVisualBoxStyle) 자식을 제외해 텍스트에서 빠지는데, 컨테이너가
  //   mergedContainerIds에 등록되면 그 자식들이 통째로 스킵되어 소실된다.
  if (allInlineChildren && childEditors.length > 1 && !isFlex) {
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
 * flex 컨테이너의 "직접 텍스트 노드"(자식 요소가 아닌 bare 텍스트)를 각각 독립
 * 텍스트 요소로 추출해 pushFn으로 전달한다. flex 자식 요소는 별도 위치를 가지므로
 * 컨테이너를 병합하지 않고 bare 텍스트만 Range로 측정해 보존한다.
 * 예: <div class="kicker"><span>기능 ④</span> 마스터 편집</div> → "마스터 편집"
 *     <div class="live-flag"><span class="rec"></span>LIVE COMPOSITE</div> → "LIVE COMPOSITE"
 */
function extractFlexOwnTextNodes(el, cs, transformScale, originRect, pushFn) {
  for (const node of el.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue
    const text = node.textContent.trim()
    // 텍스트 노드의 위치를 Range로 측정
    const range = el.ownerDocument.createRange()
    range.selectNodeContents(node)
    const rangeRect = unscaleRect(range.getBoundingClientRect(), transformScale, originRect)
    if (rangeRect.width < 1 || rangeRect.height < 1) continue
    const styles = extractStyles(cs, el)
    // 컨테이너의 박스 장식(배경/테두리/radius/그림자/padding)은 제거한다.
    // flex 컨테이너 자체가 별도 shape로 추출되므로, bare 텍스트까지 같은 박스를
    // 그리면 라운드 라벨(.pill 등)이 이중으로 겹쳐 보인다. 또 패딩은 이미 Range
    // 좌표에 반영돼 있어 텍스트에 남기면 이중 오프셋이 된다. 텍스트 스타일만 유지.
    styles.backgroundColor = 'rgba(0, 0, 0, 0)'
    styles.backgroundImage = 'none'
    styles.border = 'none'
    styles.borderTop = 'none'
    styles.borderRight = 'none'
    styles.borderBottom = 'none'
    styles.borderLeft = 'none'
    styles.borderRadius = '0px'
    styles.boxShadow = 'none'
    styles.padding = '0px'
    // 단일행일 때만 nowrap으로 서브픽셀 재줄바꿈을 방지한다.
    // Range 높이가 lineHeight의 1.5배를 넘으면 원본이 여러 줄로 감긴 것이므로
    // (의도된 줄바꿈) nowrap을 적용하지 않고 자연 줄바꿈을 유지한다.
    const _fs = parseFloat(cs.fontSize) || 0
    const _lh = cs.lineHeight === 'normal' ? _fs * 1.2 : (parseFloat(cs.lineHeight) || 0)
    if (!(_lh > 0 && rangeRect.height > _lh * 1.5)) {
      styles.whiteSpace = 'nowrap'
    }
    pushFn({
      id: nextFlatId(),
      sourceId: el.getAttribute('data-editor-id'),
      type: 'text',
      ...animField(el),
      x: rangeRect.left,
      y: rangeRect.top,
      width: Math.ceil(rangeRect.width),
      height: rangeRect.height,
      rotation: 0,
      zIndex: 0,
      _originalZIndex: getEffectiveZIndex(el),
      content: text,
      isRich: false,
      styles,
      originalRect: { x: rangeRect.left, y: rangeRect.top, w: rangeRect.width, h: rangeRect.height },
    })
  }
}

/**
 * extractPseudoElement 결과(pb)를 flat 요소로 변환한다.
 * 배경/배경이미지/radius + (있으면) 테두리·회전·텍스트 색/폰트를 모두 반영.
 * @param {object} pb extractPseudoElement 반환값
 * @param {string|null} baseSourceId 호스트 sourceId (`${id}::before|after`로 접미)
 * @param {'before'|'after'} which
 */
function pseudoToFlatElement(pb, baseSourceId, which, domOrder, originalZIndex) {
  const styles = {
    backgroundColor: pb.backgroundColor,
    backgroundImage: pb.backgroundImage,
    borderRadius: pb.borderRadius,
  }
  if (pb.borderTop) {
    styles.borderTop = pb.borderTop
    styles.borderRight = pb.borderRight
    styles.borderBottom = pb.borderBottom
    styles.borderLeft = pb.borderLeft
  }
  if (pb.content) {
    if (pb.color) styles.color = pb.color
    if (pb.fontSize) styles.fontSize = pb.fontSize
    if (pb.fontFamily) styles.fontFamily = pb.fontFamily
    if (pb.padding) styles.padding = pb.padding
    if (pb.textAlign) styles.textAlign = pb.textAlign
    // flex 중앙정렬 의사요소(예: '?')의 정렬 보존
    if (pb.display) styles.display = pb.display
    if (pb.alignItems) styles.alignItems = pb.alignItems
    if (pb.justifyContent) styles.justifyContent = pb.justifyContent
  }
  return {
    id: nextFlatId(),
    sourceId: baseSourceId ? `${baseSourceId}::${which}` : null,
    type: pb.content ? 'text' : 'shape',
    x: pb.x,
    y: pb.y,
    width: pb.w,
    height: pb.h,
    rotation: pb.rotation || 0,
    zIndex: 0,
    _domOrder: domOrder,
    _originalZIndex: originalZIndex,
    content: pb.content || '',
    isRich: false,
    styles,
    originalRect: { x: pb.x, y: pb.y, w: pb.w, h: pb.h },
  }
}

/**
 * 요소의 ::before/::after 의사 요소를 독립 flat 요소 배열로 변환(없으면 []).
 * buildFlatElement/병합 경로를 거치지 않는 요소(예: 배경 없는 .kicker, .flow-step)의
 * 불릿/도트/꺾인 화살표 같은 장식 pseudo를 보존하기 위해 사용한다.
 */
function buildPseudoFlatElements(el, rect, domOrder) {
  const out = []
  const sid = el.getAttribute('data-editor-id')
  const z = getEffectiveZIndex(el)
  const anim = animField(el)   // 불릿/도트도 본체와 같은 등장 단계로
  for (const which of ['before', 'after']) {
    const pb = extractPseudoElement(el, rect, `::${which}`)
    if (pb) out.push({ ...pseudoToFlatElement(pb, sid, which, domOrder, z), ...anim })
  }
  return out
}

/**
 * iframe DOM에서 모든 시각적 요소를 추출한다.
 * @param {React.RefObject} iframeRef
 * @returns {{ elements: FlatElement[], canvasSize: { w: number, h: number } }}
 */
/**
 * iframe ref 편의 래퍼 — React ref(iframeRef)의 contentDocument/contentWindow를
 * 풀어 코어 extractFlatElements(doc, win)를 호출. (앱 내부용; 코어는 비의존 유지)
 */
export function extractFlatElementsFromIframe(iframeRef, existingMaxId = 0) {
  const iframe = iframeRef?.current
  if (!iframe) return { elements: [], canvasSize: { w: 1280, h: 800 }, notes: '', transition: null }
  // existingMaxId를 extractFlatElements에 전달해 내부 resetFlatCounter() 대신
  // 기존 최대 ID부터 카운터를 시작하게 한다.
  // (충돌 시 같은 id 두 요소가 함께 선택돼 그룹처럼 핸들이 표시되는 버그 방지)
  return extractFlatElements(iframe.contentDocument, iframe.contentWindow, existingMaxId)
}

/**
 * 진행 중인 CSS 애니메이션/트랜지션을 추출 직전에 최종 상태로 고정(settle)한다.
 *
 * 배경: "순차 등장(reveal)" 패턴 덱은 `.r{opacity:0;transform:translateY(22px)}` +
 * `animation-delay`(최대 ~0.7s)로 요소를 시차 등장시킨다. 추출은 슬라이드 전환 후
 * 고정 대기(~400ms)만으로 실행되므로, 지연이 끝나지 않은 요소는 추출 시점에
 *   - opacity:0  → 조상이면 isHiddenByAncestor에 걸려 자식이 통째로 누락되고,
 *   - translateY(22px) → getBoundingClientRect가 아래로 밀린 좌표로 캡처된다.
 * 유한(1회/N회) 애니메이션·트랜지션을 finish()로 끝 상태(opacity:1, transform:none)에
 * 고정하면 이 두 문제가 모두 사라진다.
 *
 * 무한 반복 애니메이션(장식용 펄스/파형/캐럿 등)은 finish()가 InvalidStateError를
 * 던지므로 건너뛴다(현 동작 유지 — 임의 프레임 캡처).
 *
 * jsdom 등 getAnimations 미구현 환경에서는 안전하게 no-op.
 */
export function settleAnimations(doc) {
  if (!doc || typeof doc.getAnimations !== 'function') return
  let anims
  try { anims = doc.getAnimations() } catch { return }
  for (const anim of anims) {
    try {
      const timing = anim.effect && typeof anim.effect.getTiming === 'function'
        ? anim.effect.getTiming() : null
      // 무한 반복(iterations === Infinity)은 finish 불가 → 스킵
      if (timing && timing.iterations === Infinity) continue
      anim.finish()
    } catch {
      // finish 불가(무한/비정상 효과 등) → 무시하고 현재 프레임 유지
    }
  }
}

/**
 * flat 변환 코어 — 렌더된 document/window를 받아 FlatElement[]를 추출.
 * 프레임워크/iframe 비의존(브라우저 레이아웃만 필요) → slide-flat 패키지의 공개 API.
 * iframe에서 쓰려면 extractFlatElementsFromIframe(ref)를 사용.
 * @param {Document} doc @param {Window} win
 */
/**
 * 렌더된 <table> → 편집 가능한 표 요소 데이터(slideTable 모델).
 * 열 폭·행 높이는 computed geometry에서 읽으므로 브라우저가 내용에 맞게 잡은 비율이 그대로 온다.
 * 지원 밖(중첩 표·미디어 포함·상한 초과)이면 null → 호출부가 기존 셀별 텍스트 추출로 폴백한다.
 * @returns {{ table: object, font: object } | null}
 */
export function extractTableData(tableEl, win) {
  if (!tableEl || !win) return null
  // 중첩 표·미디어가 든 표는 모델이 표현하지 못한다 → 기존 동작 유지
  if (tableEl.querySelector('table')) return null
  if (tableEl.querySelector('img, svg, video, canvas, iframe')) return null

  const trs = [...tableEl.querySelectorAll('tr')]
  if (!trs.length) return null

  // 1) colspan/rowspan을 반영한 그리드 배치 (가려지는 칸은 'covered')
  const grid = []
  let cols = 0
  trs.forEach((tr, r) => {
    grid[r] = grid[r] || []
    let c = 0
    for (const cellEl of tr.children) {
      const tag = cellEl.tagName.toLowerCase()
      if (tag !== 'td' && tag !== 'th') continue
      while (grid[r][c] !== undefined) c++
      const colSpan = Math.max(1, cellEl.colSpan || 1)
      const rowSpan = Math.max(1, cellEl.rowSpan || 1)
      grid[r][c] = { el: cellEl, colSpan, rowSpan }
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue
          grid[r + dr] = grid[r + dr] || []
          grid[r + dr][c + dc] = 'covered'
        }
      }
      c += colSpan
      if (c > cols) cols = c
    }
  })
  const rows = grid.length
  if (rows < 1 || cols < 1 || rows > MAX_ROWS || cols > MAX_COLS) return null

  const tRect = tableEl.getBoundingClientRect()
  if (!(tRect.width > 0) || !(tRect.height > 0)) return null

  // 2) 열 폭 — colSpan=1 셀의 실제 폭에서 채우고, 못 채운 열은 평균으로 보정
  const colW = new Array(cols).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const g = grid[r]?.[c]
      if (!g || g === 'covered' || g.colSpan !== 1 || colW[c]) continue
      colW[c] = g.el.getBoundingClientRect().width
    }
  }
  const known = colW.filter(w => w > 0)
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : tRect.width / cols
  for (let c = 0; c < cols; c++) if (!colW[c]) colW[c] = avg

  // 3) 행 높이
  const rowH = []
  for (let r = 0; r < rows; r++) {
    const h = trs[r]?.getBoundingClientRect?.().height
    rowH.push(h > 0 ? h : tRect.height / rows)
  }

  // 4) 헤더 판정 — <thead> 또는 첫 행이 전부 <th>
  const firstRowEls = (grid[0] || []).filter(g => g && g !== 'covered').map(g => g.el)
  const headerRow = !!tableEl.querySelector('thead')
    || (firstRowEls.length > 0 && firstRowEls.every(e => e.tagName.toLowerCase() === 'th'))

  // 5) 셀 데이터 — 본문 첫 셀의 서식을 표 기본값으로 삼고, 다른 셀만 개별 저장
  const bodyRef = (grid[headerRow && rows > 1 ? 1 : 0] || []).find(g => g && g !== 'covered')
  const refCs = bodyRef ? win.getComputedStyle(bodyRef.el) : null
  const font = {
    fontSize: refCs?.fontSize || '',
    fontFamily: refCs?.fontFamily || '',
    color: refCs?.color || '',
  }
  let border = null
  const cells = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols; c++) {
      const g = grid[r]?.[c]
      if (g === 'covered') { row.push({ text: '', covered: true }); continue }
      if (!g) { row.push({ text: '' }); continue }
      const ccs = win.getComputedStyle(g.el)
      if (!border) {
        const bw = Math.round(parseFloat(ccs.borderTopWidth) || 0)
        border = { width: bw, color: ccs.borderTopColor || TABLE_BORDER_COLOR }
      }
      const cell = { text: (g.el.textContent || '').trim() }
      if (g.colSpan > 1) cell.colSpan = g.colSpan
      if (g.rowSpan > 1) cell.rowSpan = g.rowSpan
      const align = ccs.textAlign
      if (align === 'center' || align === 'right' || align === 'end') cell.align = align === 'end' ? 'right' : align
      const valign = ccs.verticalAlign
      if (valign === 'top' || valign === 'bottom') cell.valign = valign
      const bg = ccs.backgroundColor
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') cell.bg = bg
      if (ccs.color && ccs.color !== font.color) cell.color = ccs.color
      const fw = parseInt(ccs.fontWeight, 10)
      if (Number.isFinite(fw) && fw >= 600) cell.fontWeight = String(fw)
      row.push(cell)
    }
    cells.push(row)
  }

  return {
    table: {
      rows, cols,
      colFractions: normFractions(colW),
      rowFractions: normFractions(rowH),
      headerRow,
      cells,
      border: border || { width: 1, color: TABLE_BORDER_COLOR },
    },
    font,
  }
}

export function extractFlatElements(doc, win, existingMaxId = 0) {
  if (!doc || !win) return { elements: [], canvasSize: { w: 1280, h: 800 }, notes: '', transition: null }

  // 좌표/가시성 측정 전에 진행 중인 등장 애니메이션을 최종 상태로 고정한다.
  settleAnimations(doc)

  // existingMaxId가 있으면 기존 요소 최대 ID부터 발급(충돌 방지), 없으면 0부터 시작.
  // 기존 resetFlatCounter()는 항상 0 리셋이라 멀티페이지/프로젝트 혼용 시 ID 충돌 유발.
  resetFlatCounter()
  if (existingMaxId > 0) bumpFlatCounterTo(existingMaxId)
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

  // canvasSize 계산
  const bodyCS = win.getComputedStyle(doc.body)
  const bodyRectRaw = doc.body.getBoundingClientRect()
  const canvasW = originRect ? originRect.cssWidth : bodyRectRaw.width
  const canvasH = originRect ? originRect.cssHeight : bodyRectRaw.height

  // 슬라이드 프레임워크 감지: 현재 활성 슬라이드만 추출
  // 여러 슬라이드가 같은 위치에 겹쳐져 있고 표시/숨김으로 전환하는 패턴을 감지한다.
  // - reveal.js: .present 클래스
  // - opacity 기반: .active 클래스 + opacity:0/1
  // - display 기반: display:none/flex
  let revealPresent = null

  // 1. reveal.js 패턴
  revealPresent = doc.querySelector('.reveal .slides > section.present > section.present')
  if (!revealPresent) revealPresent = doc.querySelector('.reveal .slides > section.present')
  if (!revealPresent) {
    const firstSection = doc.querySelector('.reveal .slides > section')
    if (firstSection) revealPresent = firstSection
  }

  // 2. 일반 슬라이드 패턴: .slide.active 또는 .active가 있는 같은 위치 겹침 슬라이드
  if (!revealPresent) {
    const activeSlide = doc.querySelector('.slide.active')
    if (activeSlide) {
      // 형제 .slide 요소가 있고 같은 위치에 겹쳐져 있는지 확인
      const siblings = activeSlide.parentElement?.querySelectorAll(':scope > .slide')
      if (siblings && siblings.length > 1) {
        revealPresent = activeSlide
      }
    }
  }

  // 모션 호스트는 문서 전체에서 모아도 안전하다 — 각 요소가 closest()로 제 호스트를 찾으므로
  // 다른 슬라이드의 선언이 섞이지 않는다.
  setupAnimContext(revealPresent || doc.body)

  // 반면 노트·전환은 "이 페이지의 값"이라 활성 슬라이드를 특정할 수 있을 때만 읽는다.
  // 특정 못 한 채 첫 .slide로 폴백하면 모든 페이지가 1장의 원고를 물려받는다.
  const slideEls = doc.querySelectorAll('.slide')
  const noteRoot = revealPresent || doc.querySelector('.slide.active')
    || (slideEls.length === 1 ? slideEls[0] : (slideEls.length === 0 ? doc.body : null))
  const notes = noteRoot ? readSlideNotes(noteRoot) : ''
  const transition = noteRoot ? parseTransitionAttrs(noteRoot) : null

  // 3. opacity:0 또는 visibility:hidden으로 숨겨진 슬라이드 감지를 위한 추가 필터
  // (revealPresent가 없어도 개별 요소 단위로 체크)
  const isHiddenByAncestor = (el) => {
    let node = el.parentElement
    while (node && node !== doc.body) {
      const nodeCs = win.getComputedStyle(node)
      if (nodeCs.opacity === '0' || nodeCs.visibility === 'hidden') return true
      // display:none은 이미 querySelectorAll에서 제외됨
      node = node.parentElement
    }
    return false
  }

  // 배경 추출: 슬라이드 배경 체인 탐색 → 배경 요소로 변환 (잠금, z=0)
  // 활성 슬라이드 → 부모 체인 순으로 배경색/그래디언트를 찾는다.
  // 여러 레이어(body 배경 + 슬라이드 배경)가 있으면 각각 별도 요소로 추출한다.
  {
    const bgLayers = []

    // 슬라이드 컨테이너에서 배경 체인 탐색
    const bgRoot = revealPresent || doc.body
    let bgNode = bgRoot
    while (bgNode && bgNode !== doc.documentElement) {
      const bgCs = win.getComputedStyle(bgNode)
      const bg = bgCs.backgroundColor
      const bgImg = bgCs.backgroundImage
      const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
      const hasBgImg = bgImg && bgImg !== 'none'
      if (hasBg || hasBgImg) {
        bgLayers.push(extractStyles(bgCs, bgNode))
      }
      bgNode = bgNode.parentElement
    }

    // body 배경 (위에서 못 잡힌 경우)
    if (bgLayers.length === 0 && isVisuallyMeaningful(bodyCS)) {
      bgLayers.push(extractStyles(bodyCS, doc.body))
    }

    // 배경 레이어를 역순으로 (가장 먼 조상부터) 요소로 추가
    for (let i = bgLayers.length - 1; i >= 0; i--) {
      result.push({
        id: nextFlatId(),
        sourceId: '__bg',
        type: 'shape',
        x: 0, y: 0,
        width: canvasW,
        height: canvasH,
        zIndex: zCounter++,
        content: '',
        locked: true,
        isBackground: true,
        styles: bgLayers[i],
      })
    }

    // 배경이 전혀 없으면 흰색 기본 배경 생성
    if (bgLayers.length === 0 && canvasW > 0) {
      result.push({
        id: nextFlatId(),
        sourceId: '__bg',
        type: 'shape',
        x: 0, y: 0,
        width: canvasW,
        height: canvasH,
        zIndex: zCounter++,
        content: '',
        locked: true,
        isBackground: true,
        styles: {
          backgroundColor: 'rgb(255, 255, 255)',
          backgroundImage: 'none',
          borderRadius: '0px',
          border: '0px none',
          borderTop: '0px none', borderRight: '0px none',
          borderBottom: '0px none', borderLeft: '0px none',
          boxShadow: 'none',
          opacity: '1',
        },
      })
    }
  }

  // data-editor-id 가진 모든 요소 수집
  const allEls = doc.querySelectorAll('[data-editor-id]')
  const mergedContainerIds = new Set() // 병합된 컨테이너의 ID (자식 스킵용)

  for (const el of allEls) {
    // 활성 슬라이드 밖의 요소 스킵
    if (revealPresent && !revealPresent.contains(el)) continue

    // opacity:0 또는 visibility:hidden인 조상 아래의 요소 스킵 (비활성 슬라이드)
    if (isHiddenByAncestor(el)) continue

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

    // <table> → 편집 가능한 표 요소 하나. 셀들은 mergedContainerIds로 스킵된다.
    // (지원 밖이면 null → 아래 기존 경로가 셀별 텍스트로 추출)
    if (el.tagName === 'TABLE') {
      const td = extractTableData(el, win)
      if (td) {
        const tableEl = buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect)
        tableEl.type = 'table'
        tableEl.table = td.table
        tableEl.content = ''
        tableEl.isRich = false
        tableEl.styles = { ...tableEl.styles, ...td.font }
        result.push(tableEl)
        const tid = el.getAttribute('data-editor-id')
        if (tid) mergedContainerIds.add(tid)
        continue
      }
    }

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
          // CSS 박스 스타일(배경/테두리/padding) + 비embedded → 독립 시각 배지로 취급.
          // embedded(주변에 텍스트 형제가 있는 inline code 등)는 텍스트 흐름의 일부로 두어
          // 부모 텍스트와 좌표가 겹치는 문제를 방지한다.
          const isVisualBadge = hasVisualBoxStyle(el) && !isEmbeddedInline(el)
          // 부모가 flex이면 자식은 독립 위치 → 스킵하지 않고 독립 추출.
          // 그 외에는 시각 배지가 아닌 인라인은 부모 텍스트(getRichTextContent)에
          // 인라인으로 포함되므로 독립 추출하지 않는다(중복 방지). 시각 배지만 독립 추출.
          if (!parentIsFlex && !isVisualBadge) {
            if (parentType === 'text' || (parentType === 'container' && isEmbeddedInline(el))) {
              continue
            }
          }
        }
      }

      // display:flex인 텍스트 요소(예: li, h3 flex): 자식들이 독립 위치를 가지므로
      // 부모 자체는 시각 속성이 있을 때만 shape로 추출하고, 텍스트는 자식에 맡긴다
      const isFlex = cs.display === 'flex' || cs.display === 'inline-flex'
      if (isFlex) {
        const editorChildren = el.querySelectorAll(':scope > [data-editor-id]')
        if (editorChildren.length > 0) {
          // 부모 자체의 배경/테두리가 있으면 shape로 추출(buildFlatElement가 ::before/::after 처리).
          // 시각 속성이 없으면 shape는 없지만 ::before/::after 불릿·도트·화살표는 별도로 보존한다.
          if (isVisuallyMeaningful(cs)) {
            result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect))
          } else {
            for (const pe of buildPseudoFlatElements(el, rect, zCounter++)) result.push(pe)
          }
          // flex 부모의 고유 텍스트 노드(자식 요소가 아닌)를 별도 요소로 추출
          // 예: <h3 flex><span>①</span> Worker</h3> → "Worker"를 h3 스타일로 독립 추출
          extractFlexOwnTextNodes(el, cs, transformScale, originRect, (elem) => {
            elem._domOrder = zCounter++
            result.push(elem)
          })
          // 자식 요소는 메인 루프에서 독립 추출됨
          continue
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
        const text = visibleTextContent(el).trim()
        if (!text && !isVisuallyMeaningful(cs)) continue
      }
      result.push(buildFlatElement(el, rect, cs, zCounter++, undefined, transformScale, originRect))
    } else if (editorType === 'image') {
      result.push(buildFlatElement(el, rect, cs, zCounter++, undefined, transformScale, originRect))
    } else if (editorType === 'video') {
      const vEl = buildFlatElement(el, rect, cs, zCounter++, undefined, transformScale, originRect)
      // <video> 재생 속성 보존 (렌더러/익스포트가 참조)
      vEl.autoplay = el.autoplay || el.hasAttribute('autoplay')
      vEl.loop = el.loop || el.hasAttribute('loop')
      vEl.muted = el.muted || el.hasAttribute('muted')
      result.push(vEl)
    } else if (editorType === 'container') {
      // flex 컨테이너(예: .win-bar, .live-flag, .kicker): 자식들이 독립 위치를
      // 가지므로 병합하지 않는다. 컨테이너 시각 속성이 있으면 shape로, 컨테이너
      // 직속 텍스트 노드는 독립 텍스트로 추출하고, 자식 요소는 메인 루프에서 독립
      // 추출되도록 둔다(mergedContainerIds에 등록하지 않음 → 자식 소실 방지).
      const containerIsFlex = cs.display === 'flex' || cs.display === 'inline-flex'
      if (containerIsFlex && el.querySelector(':scope > [data-editor-id]')) {
        if (isVisuallyMeaningful(cs)) {
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect))
        } else {
          // 시각 박스가 없는 flex 컨테이너(.kicker 등)의 ::before/::after 불릿·장식 보존
          for (const pe of buildPseudoFlatElements(el, rect, zCounter++)) result.push(pe)
        }
        extractFlexOwnTextNodes(el, cs, transformScale, originRect, (elem) => {
          elem._domOrder = zCounter++
          result.push(elem)
        })
        continue
      }
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
          // 배지 패턴: padding 제거 + 가운데 정렬 (편집 편의 + 줄바꿈 방지)
          if (isBadgeElement(merged.styles, merged.height, merged.content)) {
            merged.styles.padding = '0px'
            merged.styles.textAlign = 'center'
            merged.styles.isFlex = true
            merged.styles.justifyContent = 'center'
            merged.styles.alignItems = 'center'
            merged.merged = true
          } else if (merged.styles.padding && merged.styles.padding !== '0px') {
            // 비배지 병합 텍스트: 서브픽셀 보정
            const pp = merged.styles.padding.split(' ').map(p => parseFloat(p) || 0)
            const padH = pp.length === 4 ? pp[1] + pp[3] : pp.length >= 2 ? pp[1] * 2 : pp[0] * 2
            if (padH > 0) merged.width = Math.ceil(merged.width) + 2
          }
          const mergedEl = { ...merged, ...animField(el), id: nextFlatId(), zIndex: 0, _domOrder: zCounter++, _originalZIndex: getEffectiveZIndex(el) }
          // 병합된 컨테이너에도 ::before / ::after 의사 요소 추출
          const pseudoBefore = extractPseudoElement(el, rect, '::before')
          if (pseudoBefore) mergedEl._pseudoBefore = pseudoBefore
          const pseudoAfter = extractPseudoElement(el, rect, '::after')
          if (pseudoAfter) mergedEl._pseudoAfter = pseudoAfter
          result.push(mergedEl)
        } else {
          result.push(buildFlatElement(el, rect, cs, zCounter++, 'shape', transformScale, originRect))
        }
      } else {
        // 비시각 컨테이너: 텍스트 내용이 있으면 text로 추출
        const text = visibleTextContent(el).trim()
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
          } else {
            // 블록 자식이 있어 병합 불가(예: <div class="lip-script">본문…<div class="cap">…</div></div>):
            // 컨테이너 직속 bare 텍스트 노드를 독립 추출한다. (자식 요소는 메인 루프에서 추출)
            extractFlexOwnTextNodes(el, cs, transformScale, originRect, (elem) => {
              elem._domOrder = zCounter++
              result.push(elem)
            })
            // 컨테이너의 ::before/::after 장식(예: .flow-step 사이 꺾인 화살표)도 보존
            for (const pe of buildPseudoFlatElements(el, rect, zCounter++)) result.push(pe)
          }
        }
      }
    }
  }

  // SVG 요소 추출 — data-editor-id가 없는 SVG를 별도 스캔
  const allSvgs = doc.querySelectorAll('svg')
  for (const svg of allSvgs) {
    // 활성 슬라이드 밖 / 숨김(opacity:0·visibility:hidden) 조상 아래 SVG 스킵.
    // (비활성 슬라이드는 opacity:0만 적용되고 display:none이 아니어서 레이아웃이
    //  살아있다 → 이 가드가 없으면 다른 슬라이드의 SVG가 같은 위치/크기로 중복 추출됨)
    if (revealPresent && !revealPresent.contains(svg)) continue
    if (isHiddenByAncestor(svg)) continue
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
      ...animField(svg),
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

  // image-slot(섀도우 DOM 이미지 플레이스홀더): 박스(호스트)는 컨테이너로 이미 추출됨.
  // 아이콘/안내문/실제 이미지는 shadow DOM 안에 있어 [data-editor-id] 워크가 못 봄
  // → shadowRoot를 직접 읽어 합성 추출(섀도우 요소도 getBoundingClientRect는 동작).
  for (const slot of doc.querySelectorAll('image-slot')) {
    if (revealPresent && !revealPresent.contains(slot)) continue
    if (isHiddenByAncestor(slot)) continue
    const slotCs = win.getComputedStyle(slot)
    if (slotCs.display === 'none') continue
    const slotRect = unscaleRect(slot.getBoundingClientRect(), transformScale, originRect)
    if (slotRect.width < 1 || slotRect.height < 1) continue
    const sr = slot.shadowRoot
    const baseZ = getEffectiveZIndex(slot)
    // 1) 실제 이미지가 채워진 슬롯 → 이미지 요소
    const img = sr && sr.querySelector('img')
    const imgSrc = img && (img.currentSrc || img.getAttribute('src'))
    if (imgSrc && /^(https?:|data:|blob:)/i.test(imgSrc)) {
      result.push({
        id: nextFlatId(), sourceId: null, type: 'image', ...animField(slot),
        x: slotRect.left, y: slotRect.top, width: slotRect.width, height: slotRect.height,
        zIndex: 0, _domOrder: zCounter++, _originalZIndex: baseZ,
        content: imgSrc, isRich: false,
        styles: { objectFit: slot.getAttribute('fit') || 'cover', borderRadius: slotCs.borderRadius || '0px' },
      })
      continue
    }
    // 2) 빈 플레이스홀더 → 아이콘(svg) + 안내문(placeholder 속성)
    const phSvg = sr && sr.querySelector('svg')
    if (phSvg) {
      const r = unscaleRect(phSvg.getBoundingClientRect(), transformScale, originRect)
      if (r.width >= 1 && r.height >= 1) {
        result.push({
          id: nextFlatId(), sourceId: null, type: 'svg', ...animField(slot),
          x: r.left, y: r.top, width: r.width, height: r.height,
          zIndex: 0, _domOrder: zCounter++, _originalZIndex: baseZ,
          content: phSvg.outerHTML, isRich: false, styles: {},
        })
      }
    }
    const ph = (slot.getAttribute('placeholder') || '').trim()
    if (sr && ph) {
      // 안내문은 shadow의 실제 텍스트 요소(div.cap 등) 위치로 추출 — 슬롯 전체에
      // flex-center로 넣으면 박스 중앙(=아이콘 위치)에 와 아이콘과 겹친다.
      let capEl = null
      for (const el of sr.querySelectorAll('*')) {
        if (el.children.length === 0 && (el.textContent || '').trim() === ph) { capEl = el; break }
      }
      const tr = capEl ? unscaleRect(capEl.getBoundingClientRect(), transformScale, originRect) : slotRect
      const capCs = capEl ? win.getComputedStyle(capEl) : slotCs
      if (tr.width >= 1 && tr.height >= 1) {
        result.push({
          id: nextFlatId(), sourceId: null, type: 'text', ...animField(slot),
          x: tr.left, y: tr.top, width: tr.width, height: tr.height,
          zIndex: 0, _domOrder: zCounter++, _originalZIndex: baseZ,
          content: ph, isRich: false,
          styles: {
            color: capCs.color || 'rgba(0,0,0,0.55)',
            fontSize: capCs.fontSize || '13px',
            fontFamily: capCs.fontFamily || 'sans-serif',
            lineHeight: capCs.lineHeight && capCs.lineHeight !== 'normal' ? capCs.lineHeight : '1.3',
            textAlign: 'center', whiteSpace: 'nowrap', backgroundColor: 'rgba(0,0,0,0)',
          },
        })
      }
    }
  }

  // 아이콘 폰트 요소 추출 — data-editor-id 없는 <i> / <span>의 ::before 글리프를
  // 텍스트 요소로 별도 스캔. <i>가 text 컨테이너의 인라인 자식이면 이미 F2(getRichTextContent)에서
  // 처리되었으므로, 가장 가까운 [data-editor-id] 조상이 'text' 타입이면 스킵한다.
  // 조상이 container이거나 없으면(컨테이너 직속 자식: 예 .icon-item > <i>) 독립 추출.
  const iconCandidates = doc.querySelectorAll('i, span')
  for (const ic of iconCandidates) {
    // 활성 슬라이드 밖 스킵
    if (revealPresent && !revealPresent.contains(ic)) continue
    if (isHiddenByAncestor(ic)) continue
    if (ic.hasAttribute('data-editor-id')) continue
    // 텍스트 콘텐츠가 있으면 일반 텍스트로 부모를 통해 추출됨 → 스킵
    if (ic.textContent && ic.textContent.trim()) continue
    const icCs = win.getComputedStyle(ic)
    if (icCs.display === 'none' || icCs.visibility === 'hidden') continue
    // 가장 가까운 [data-editor-id] 조상 탐색
    let nearestEditor = ic.parentElement
    while (nearestEditor && nearestEditor !== doc.body) {
      if (nearestEditor.hasAttribute('data-editor-id')) break
      nearestEditor = nearestEditor.parentElement
    }
    if (nearestEditor && nearestEditor !== doc.body) {
      const nearestType = nearestEditor.getAttribute('data-editor-type')
      const nearestId = nearestEditor.getAttribute('data-editor-id')
      // text 조상이면서 병합되지 않은 경우: 인라인 텍스트로 이미 포함됨
      if (nearestType === 'text' && !mergedContainerIds.has(nearestId)) continue
      // 병합 컨테이너 내부면 이미 포함됨
      if (mergedContainerIds.has(nearestId)) continue
    }
    const iconSpan = getIconGlyphSpan(ic, win)
    if (!iconSpan) continue
    const icRectRaw = ic.getBoundingClientRect()
    if (icRectRaw.width < 1 || icRectRaw.height < 1) continue
    const icRect = unscaleRect(icRectRaw, transformScale, originRect)
    if (icRect.right < -10 || icRect.bottom < -10 || icRect.left > canvasW + 10 || icRect.top > canvasH + 10) continue
    // 글리프만으로 구성된 텍스트 요소로 추출
    const fontSizePx = parseFloat(icCs.fontSize) || icRect.height
    result.push({
      id: nextFlatId(),
      sourceId: null,
      type: 'text',
      ...animField(ic),
      x: icRect.left,
      y: icRect.top,
      width: Math.ceil(icRect.width) + 2,
      height: icRect.height,
      rotation: 0,
      zIndex: 0,
      _domOrder: zCounter++,
      _originalZIndex: getEffectiveZIndex(ic),
      content: iconSpan,
      isRich: true,
      styles: {
        color: icCs.color,
        fontSize: `${fontSizePx}px`,
        textAlign: 'center',
        backgroundColor: 'transparent',
        backgroundImage: 'none',
        borderRadius: '0px',
        border: '0px none',
        borderTop: '0px none', borderRight: '0px none',
        borderBottom: '0px none', borderLeft: '0px none',
        boxShadow: 'none',
        opacity: '1',
      },
      originalRect: { x: icRect.left, y: icRect.top, w: icRect.width, h: icRect.height },
    })
  }

  // ::before / ::after 의사 요소를 별도 shape/text 요소로 변환하여 삽입.
  // ::before는 부모 바로 앞(domOrder-0.5), ::after는 부모 바로 뒤(domOrder+0.5)에 둔다.
  const pseudoElements = []
  for (const el of result) {
    if (el._pseudoBefore) {
      const pe = pseudoToFlatElement(el._pseudoBefore, el.sourceId, 'before', el._domOrder - 0.5, el._originalZIndex)
      if (el._animIdx != null) pe._animIdx = el._animIdx   // 불릿/장식도 본체와 같은 단계로
      pseudoElements.push(pe)
    }
    if (el._pseudoAfter) {
      const pe = pseudoToFlatElement(el._pseudoAfter, el.sourceId, 'after', el._domOrder + 0.5, el._originalZIndex)
      if (el._animIdx != null) pe._animIdx = el._animIdx
      pseudoElements.push(pe)
    }
    delete el._pseudoBefore
    delete el._pseudoAfter
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

  // data-anim 선언을 el.anim으로 확정(seq·참조 해소) 후 컨텍스트 해제
  applyAnimSpecs(result)
  _animCtx = null

  const canvasSize = {
    w: canvasW || 1280,
    h: canvasH || 800,
  }

  // 폰트 임포트 추출 — flat HTML에서도 동일 폰트 로드를 위해
  const fontImports = extractFontImports(doc)

  // 추출된 요소의 font-family에서 누락된 웹폰트 감지 → Google Fonts 임포트 자동 추가
  addMissingFontImports(result, fontImports)

  // 전체 크기 빈 shape → 배경 레이어로 병합
  // 배경 추출(sourceId='__bg')과 data-editor-id 순회에서 중복 추출된 전체 크기 shape을
  // 배경 레이어로 통합하고, 중복은 제거한다.
  {
    const isBgLike = (el) => {
      const isFullSize = Math.abs(el.width - canvasSize.w) < 5
        && Math.abs(el.height - canvasSize.h) < 5
        && Math.abs(el.x) < 5 && Math.abs(el.y) < 5
      if (!isFullSize) return false
      // 빈 shape (배경색/그래디언트만)
      if (el.type === 'shape' && !el.content) return true
      // 전체 크기 이미지 (배경 이미지로 사용된 것)
      if (el.type === 'image' && el.content) return true
      return false
    }

    // 이미 배경으로 추출된 요소 (sourceId === '__bg')
    const existingBgs = result.filter(el => el.sourceId === '__bg')
    // data-editor-id에서 추출된 전체 크기 빈 shape 또는 전체 크기 이미지
    const duplicateBgs = result.filter(el => el.sourceId !== '__bg' && isBgLike(el))

    if (duplicateBgs.length > 0) {
      // 기존 배경과 동일한 중복은 제거, 다른 스타일/내용이면 배경 레이어로 편입
      const bgSig = (el) => {
        if (el.type === 'image') return `img:${(el.content || '').slice(0, 100)}`
        const s = el.styles || {}
        return `${s.backgroundColor || ''}|${s.backgroundImage || ''}`
      }
      const existingBgSigs = new Set(existingBgs.map(bgSig))

      for (const dup of duplicateBgs) {
        const sig = bgSig(dup)

        if (existingBgSigs.has(sig)) {
          // 동일 → 중복 제거
          const idx = result.indexOf(dup)
          if (idx !== -1) result.splice(idx, 1)
        } else {
          // 다른 내용 → 배경 레이어로 전환
          if (dup.type === 'image') {
            // 이미지 → shape으로 변환하여 backgroundImage: url(...) 로 설정
            const imgUrl = dup.content
            dup.type = 'shape'
            dup.content = ''
            dup.styles = {
              ...(dup.styles || {}),
              backgroundImage: `url(${imgUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          }
          dup.sourceId = '__bg'
          dup.locked = true
          dup.x = 0
          dup.y = 0
          dup.width = canvasSize.w
          dup.height = canvasSize.h
          existingBgSigs.add(sig)
        }
      }
    }

    // 나머지 배경 요소 잠금 보완
    for (const el of result) {
      if (isBgLike(el) && !el.locked) {
        el.locked = true
      }
    }
  }

  return { elements: result, canvasSize, fontImports, notes, transition }
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
    const baseUrl = sheet.href || doc.baseURI || ''
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
        // @font-face의 상대 URL을 절대 URL로 변환
        const cssText = resolveRelativeUrls(rule.cssText, baseUrl)
        addUnique(cssText)
      }
    }
  }

  // 2. <style> 텍스트 파싱 (CSSOM 접근 실패 대비)
  for (const style of doc.querySelectorAll('style')) {
    // 에디터 삽입 스타일 제외
    if (style.id && style.id.startsWith('__fe-')) continue
    const text = style.textContent || ''
    const styleBaseUrl = doc.baseURI || ''
    const importMatches = text.match(/@import\s+url\([^)]+\)\s*;?/g)
    if (importMatches) {
      for (const m of importMatches) {
        // 폰트 @import만 — 레이아웃/리셋 CSS(@import url(reveal.css) 등)가 섞여
        // 부모 문서에 주입되는 것을 차단
        const um = m.match(/url\(['"]?([^'")\s]+)['"]?\)/)
        if (um && !isFontUrl(um[1])) continue
        addUnique(m.endsWith(';') ? m : m + ';')
      }
    }
    const fontFaceMatches = text.match(/@font-face\s*\{[^}]+\}/g)
    if (fontFaceMatches) {
      for (const m of fontFaceMatches) addUnique(resolveRelativeUrls(m, styleBaseUrl))
    }
  }

  // 3. <link> 폰트 스타일시트 직접 참조 (CSSOM에서 못 잡은 것 보완)
  for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
    if (link.id && link.id.startsWith('__fe-')) continue
    const href = link.getAttribute('href') || ''
    if (!href) continue
    try {
      const absHref = new URL(href, doc.baseURI).href
      if (isFontUrl(absHref)) {
        addUnique(`@import url('${absHref}');`)
      }
    } catch { /* about:srcdoc 등에서 상대 URL 해석 실패 시 무시 */ }
  }

  // 3-1. HTML 소스에서 Google Fonts URL 직접 탐색
  // "웹페이지 완전 저장" 시 <link>가 로컬 경로로 변환되어 CSS 미로드 →
  // HTML 주석이나 원본 URL에서 Google Fonts 주소를 복구
  {
    const htmlSource = doc.documentElement?.outerHTML || ''
    const gfMatches = htmlSource.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"'\s<>)]+/g)
    if (gfMatches) {
      for (const url of gfMatches) {
        const cleanUrl = url.replace(/&amp;/g, '&')
        addUnique(`@import url('${cleanUrl}');`)
      }
    }
  }

  // 3-2. <style> 태그에서 선언된 font-family 이름을 수집하여
  // CSSOM 실패 시 addMissingFontImports의 폴백으로 사용
  for (const style of doc.querySelectorAll('style')) {
    if (style.id && style.id.startsWith('__fe-')) continue
    const text = style.textContent || ''
    // font-family: 'FontName' 패턴에서 폰트명 추출
    const ffMatches = text.matchAll(/font-family:\s*'([^']+)'/g)
    for (const m of ffMatches) {
      const fontName = m[1]
      // 시스템 폰트가 아닌 웹폰트만
      if (!SYSTEM_FONTS.has(fontName.toLowerCase())) {
        // 이미 import에 포함되어 있는지 확인
        const importText = imports.join(' ').toLowerCase()
        const encoded = fontName.toLowerCase().replace(/\s+/g, '+')
        if (!importText.includes(encoded)) {
          addUnique(`@import url('https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;500;600;700&display=swap');`)
        }
      }
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

  // 방법 -1: deck-stage(커스텀 무대 웹컴포넌트) 감지.
  //   deck-stage는 scale을 shadow DOM 내부 래퍼에 적용하므로 light-DOM 조상 transform
  //   탐색(방법 1)으로는 못 잡고, :host가 position:fixed라 body가 0 높이가 되어 캔버스가
  //   1280×0으로 폴백된다. 게다가 방법 2는 scale만 잡고 origin=null을 반환해 모든 요소가
  //   캔버스 밖으로 밀려 빈 슬라이드가 된다.
  //   → 현재 활성 섹션(data-deck-active)을 무대로 보고 scale/origin/캔버스를 직접 계산한다.
  //     (offsetWidth/Height는 스케일 전 CSS 크기 = 논리 슬라이드 크기 1920×1080)
  {
    const deckStage = doc.querySelector('deck-stage')
    if (deckStage) {
      const activeSec = deckStage.querySelector(':scope > section[data-deck-active]') ||
        deckStage.querySelector(':scope > section')
      if (activeSec) {
        const rect = activeSec.getBoundingClientRect()
        const offsetW = activeSec.offsetWidth
        const offsetH = activeSec.offsetHeight
        if (offsetW > 1 && offsetH > 1 && rect.width > 1) {
          let scale = rect.width / offsetW
          if (!(scale > 0.1 && scale < 10)) scale = 1
          return {
            transformScale: scale,
            originRect: {
              screenLeft: rect.left,
              screenTop: rect.top,
              cssWidth: offsetW,
              cssHeight: offsetH,
            },
          }
        }
      }
    }
  }

  // 방법 0: JS로 scale()을 인라인 적용한 고정 크기 무대(stage) 감지.
  //   fit() 류 스크립트가 `stage.style.transform = 'scale(s)'`로 무대를 축소/확대하는
  //   패턴(예: 1600×900 고정 무대). 창이 무대보다 크면 scale이 정확히 1이 되는데,
  //   이때 matrix 기반 방법 1은 sx≈1을 무시(Math.abs(sx-1)>0.005)하여 무대를 놓치고
  //   캔버스가 body(iframe) 크기로 잘못 폴백된다.
  //   → 인라인 transform에 'scale'이 있는 최외곽 조상을 무대로 보고,
  //     scale = rect.width / offsetWidth 로 직접 계산(scale=1도 정상 처리),
  //     offsetWidth/Height(미스케일 CSS 크기)를 캔버스로 사용한다.
  {
    let scaleStageEl = null
    let node = testEl.parentElement
    while (node && node !== doc.documentElement) {
      const inlineT = node.style && node.style.transform
      if (inlineT && inlineT.includes('scale')) scaleStageEl = node // 바깥쪽으로 갱신
      node = node.parentElement
    }
    if (scaleStageEl) {
      // 무대가 flex/grid 자식이면 창보다 좁을 때 flex-shrink로 offsetWidth가
      // 의도된 크기(예: 1600)보다 작게 줄어든다. flex-shrink:0을 강제해 의도된
      // 고정 크기를 복원한다(측정 후 복원하지 않음 → 이후 잎 요소 추출도 동일한
      // 비축소 레이아웃에서 측정되어 캔버스·좌표가 일관됨).
      scaleStageEl.style.flexShrink = '0'
      const rect = scaleStageEl.getBoundingClientRect() // 강제 reflow + 측정
      const offsetW = scaleStageEl.offsetWidth
      const offsetH = scaleStageEl.offsetHeight
      if (offsetW > 1 && offsetH > 1 && rect.width > 1) {
        let scale = rect.width / offsetW
        if (!(scale > 0.1 && scale < 10)) scale = 1
        return {
          transformScale: scale,
          originRect: {
            screenLeft: rect.left,
            screenTop: rect.top,
            cssWidth: offsetW,
            cssHeight: offsetH,
          },
        }
      }
    }
  }

  // 방법 1: 조상 체인에서 transform scale 추출 + 가장 바깥쪽 transform 컨테이너 기억
  //   (CSS 클래스 등으로 transform이 적용되어 인라인에 'scale' 문자열이 없는 경우 폴백)
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

/**
 * @font-face 등 CSS 내의 상대 url()을 절대 URL로 변환한다.
 * iframe 내부의 @font-face를 부모 문서에 주입할 때, 기준 URL이 달라져
 * 상대 경로가 깨지는 문제를 방지한다.
 */
function resolveRelativeUrls(cssText, baseUrl) {
  if (!baseUrl || !cssText) return cssText
  return cssText.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, url) => {
    // 이미 절대 URL이면 그대로
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('blob:')) {
      return match
    }
    try {
      const absUrl = new URL(url, baseUrl).href
      return `url('${absUrl}')`
    } catch {
      return match
    }
  })
}

/** 폰트 관련 URL인지 판별 */
export function isFontUrl(href) {
  if (!href) return false
  const lower = href.toLowerCase()
  return lower.includes('fonts.googleapis.com') ||
         lower.includes('fonts.gstatic.com') ||
         lower.includes('pretendard') ||
         lower.includes('typekit') ||
         lower.includes('use.typekit.net') ||
         lower.endsWith('.woff2') ||
         lower.endsWith('.woff') ||
         lower.endsWith('.ttf') ||
         lower.endsWith('.otf') ||
         // font 전용 서비스 URL (단순 'font' 포함은 false positive 방지를 위해 제거)
         lower.includes('/fonts/') ||
         lower.includes('font-face')
}

/** 시스템/일반 폰트 (Google Fonts 임포트 불필요) */
const SYSTEM_FONTS = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  'arial', 'helvetica', 'times new roman', 'times', 'georgia', 'courier', 'courier new',
  'verdana', 'tahoma', 'trebuchet ms', 'impact', 'comic sans ms', 'lucida console',
  'apple sd gothic neo', 'malgun gothic', 'segoe ui', 'sf pro', 'sf pro display',
  'sfmono-regular', 'menlo', 'monaco', 'consolas', 'liberation mono',
  'microsoft yahei', 'nanum gothic', 'gulim', 'dotum', 'batang',
  'apple color emoji', 'segoe ui emoji', 'segoe ui symbol', 'noto color emoji',
  'calibri', 'cambria', 'palatino linotype', 'book antiqua',
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
