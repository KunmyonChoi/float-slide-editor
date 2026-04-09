/**
 * HtmlToTextRuns — 리치 HTML을 pptxgenjs 텍스트 런으로 변환
 */

/**
 * HTML 문자열을 pptxgenjs text runs 배열로 변환
 * @param {string} html - HTML 콘텐츠
 * @param {Object} baseStyles - 기본 스타일 (fontSize, fontFamily, color 등)
 * @returns {Array<{ text: string, options: Object }>}
 */
export function htmlToTextRuns(html, baseStyles = {}) {
  if (!html || typeof html !== 'string') return [{ text: '', options: {} }]

  // DOMParser로 파싱
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const runs = []

  walkNode(doc.body, {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    color: null,
    fontSize: null,
    fontFace: null,
  }, runs, baseStyles)

  // 빈 결과 방지
  if (runs.length === 0) return [{ text: '', options: {} }]

  return runs
}

function walkNode(node, inherited, runs, baseStyles) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      // 텍스트 노드
      const text = child.textContent
      if (!text) continue
      const opts = buildOptions(inherited, baseStyles)
      runs.push({ text, options: opts })
    } else if (child.nodeType === 1) {
      // 요소 노드
      const tag = child.tagName.toLowerCase()
      const style = child.getAttribute('style') || ''
      const ctx = { ...inherited }

      // 태그 기반 서식
      if (tag === 'b' || tag === 'strong') ctx.bold = true
      if (tag === 'i' || tag === 'em') ctx.italic = true
      if (tag === 'u') ctx.underline = true
      if (tag === 's' || tag === 'del' || tag === 'strike') ctx.strike = true

      // 인라인 스타일에서 서식 추출
      if (style) {
        const color = extractStyle(style, 'color')
        if (color) ctx.color = color
        const fontSize = extractStyle(style, 'font-size')
        if (fontSize) ctx.fontSize = fontSize
        const fontFamily = extractStyle(style, 'font-family')
        if (fontFamily) ctx.fontFace = fontFamily
        const fontWeight = extractStyle(style, 'font-weight')
        if (fontWeight === 'bold' || fontWeight === '700' || fontWeight === '800' || fontWeight === '900') ctx.bold = true
        const fontStyle = extractStyle(style, 'font-style')
        if (fontStyle === 'italic') ctx.italic = true
        const textDecoration = extractStyle(style, 'text-decoration')
        if (textDecoration?.includes('underline')) ctx.underline = true
        if (textDecoration?.includes('line-through')) ctx.strike = true
      }

      // <br> → 줄바꿈
      if (tag === 'br') {
        runs.push({ text: '\n', options: buildOptions(inherited, baseStyles) })
        continue
      }

      // 블록 레벨 요소 앞에 줄바꿈 (div, p 등)
      if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tag)) {
        if (runs.length > 0 && runs[runs.length - 1].text !== '\n') {
          runs.push({ text: '\n', options: buildOptions(inherited, baseStyles) })
        }
      }

      walkNode(child, ctx, runs, baseStyles)

      // 블록 레벨 요소 뒤에 줄바꿈
      if (['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].includes(tag)) {
        if (runs.length > 0 && runs[runs.length - 1].text !== '\n') {
          runs.push({ text: '\n', options: buildOptions(inherited, baseStyles) })
        }
      }
    }
  }
}

function buildOptions(ctx, baseStyles) {
  const opts = {}
  if (ctx.bold) opts.bold = true
  if (ctx.italic) opts.italic = true
  if (ctx.underline) opts.underline = { style: 'sng' }
  if (ctx.strike) opts.strike = 'sngStrike'

  // 색상: ctx > baseStyles
  const color = ctx.color || baseStyles.color
  if (color) opts.color = cssColorToHex(color)

  // 폰트 크기: ctx > baseStyles (pptxgenjs는 pt 단위)
  const fontSize = ctx.fontSize || baseStyles.fontSize
  if (fontSize) opts.fontSize = parsePxToPt(fontSize)

  // 폰트 패밀리
  const fontFace = ctx.fontFace || baseStyles.fontFamily
  if (fontFace) opts.fontFace = cleanFontFamily(fontFace)

  return opts
}

/** CSS color → 6자리 hex (# 없이) */
export function cssColorToHex(color) {
  if (!color) return undefined
  // 이미 hex
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    if (hex.length === 3) return hex.split('').map(c => c + c).join('')
    if (hex.length === 6) return hex
    if (hex.length === 8) return hex.slice(0, 6) // alpha 무시
    return hex
  }
  // rgb/rgba
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) {
    return [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('')
  }
  // 이름 색상 → 기본값
  return undefined
}

/** px 문자열 → pt 숫자 */
function parsePxToPt(size) {
  if (typeof size === 'number') return Math.round(size * 0.75)
  const px = parseFloat(size)
  if (isNaN(px)) return undefined
  return Math.round(px * 0.75) // 1px ≈ 0.75pt
}

/** font-family 정리 (따옴표 제거, 첫 번째 폰트만) */
function cleanFontFamily(ff) {
  if (!ff) return undefined
  return ff.split(',')[0].trim().replace(/['"]/g, '')
}

/** 인라인 style 문자열에서 특정 속성 추출 */
function extractStyle(style, prop) {
  const regex = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i')
  const m = style.match(regex)
  return m ? m[1].trim() : null
}
