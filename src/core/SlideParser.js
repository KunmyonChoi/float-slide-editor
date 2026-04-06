/**
 * SlideParser
 * 멀티 슬라이드 덱 HTML 파일을 파싱하여 개별 슬라이드를 추출한다.
 */

/**
 * 덱 HTML을 파싱하여 개별 슬라이드 배열을 반환한다.
 * @param {string} deckHtml — 전체 덱 HTML 문자열
 * @returns {{
 *   slides: Array<{ index: number, html: string, title: string }>,
 *   globalStyles: string,
 *   slideCount: number
 * }}
 */
export function parseSlideDeck(deckHtml) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(deckHtml, 'text/html')

  // 글로벌 <style> 블록 수집
  const styleTags = doc.querySelectorAll('style')
  const globalStyles = Array.from(styleTags)
    .map(s => s.textContent)
    .filter(t => !t.includes('.nav-injected')) // 네비게이션 스타일 제외
    .join('\n')

  // .slide 요소 수집
  const slideEls = doc.querySelectorAll('.slide')
  const slides = Array.from(slideEls).map((el, index) => {
    // 제목 추출: h1 > h2 > .tag > 첫 텍스트
    const title = extractSlideTitle(el, index)

    // 슬라이드 HTML: 인라인 스타일 포함한 outerHTML
    const html = el.outerHTML

    return { index, html, title }
  })

  return {
    slides,
    globalStyles,
    slideCount: slides.length,
  }
}

/**
 * 개별 슬라이드를 독립 HTML 문서로 래핑한다.
 * 브라우저에서 바로 열 수 있는 완전한 HTML을 반환.
 * @param {{ html: string }} slide
 * @param {string} globalStyles
 * @returns {string}
 */
export function wrapSlideAsDocument(slide, globalStyles) {
  // .slide 요소에 active 클래스 + display:flex 강제
  const activeHtml = slide.html
    .replace(/class="slide"/, 'class="slide active"')
    .replace(/class="slide /, 'class="slide active ')

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${globalStyles}
.slide { display: flex !important; }
</style>
</head>
<body>
${activeHtml}
</body>
</html>`
}

/**
 * HTML 문자열에서 모든 시각적 텍스트를 추출한다.
 * 비교용: 태그 제거 후 트리밍된 텍스트 배열 반환.
 * @param {string} html
 * @returns {string[]}
 */
export function extractVisibleTexts(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  // script, style, nav 요소 제거
  doc.querySelectorAll('script, style, .nav-injected').forEach(el => el.remove())

  const texts = []
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim()
      if (t) texts.push(t)
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // display:none 요소 내부 텍스트 제외
      if (node.style && node.style.display === 'none') return
      for (const child of node.childNodes) walk(child)
    }
  }
  walk(doc.body || doc.documentElement)
  return texts
}

/**
 * HTML에서 서식이 적용된 텍스트 정보를 추출한다.
 * @param {string} html
 * @returns {Array<{ text: string, bold: boolean, italic: boolean, tag: string }>}
 */
export function extractFormattedText(html) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style').forEach(el => el.remove())

  const results = []
  const BOLD_TAGS = new Set(['strong', 'b'])
  const ITALIC_TAGS = new Set(['em', 'i'])

  const walk = (node, isBold, isItalic) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim()
      if (t) results.push({ text: t, bold: isBold, italic: isItalic, tag: node.parentElement?.tagName?.toLowerCase() || '' })
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase()
      // node.style.fontWeight가 jsdom DOMParser에서 빈 문자열일 수 있으므로
      // style 속성 문자열도 직접 검사한다
      const styleAttr = node.getAttribute('style') || ''
      const bold = isBold || BOLD_TAGS.has(tag)
        || (node.style.fontWeight && parseInt(node.style.fontWeight) >= 700)
        || /font-weight:\s*(bold|[7-9]\d{2}|1000)/.test(styleAttr)
      const italic = isItalic || ITALIC_TAGS.has(tag)
        || node.style.fontStyle === 'italic'
        || /font-style:\s*italic/.test(styleAttr)
      for (const child of node.childNodes) walk(child, bold, italic)
    }
  }
  walk(doc.body || doc.documentElement, false, false)
  return results
}

// ── 내부 헬퍼 ────────────────────────────────────────────────

function extractSlideTitle(el, index) {
  // h1~h6 순서대로 찾기
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const heading = el.querySelector(level)
    if (heading) return heading.textContent.trim()
  }
  const tag = el.querySelector('.tag')
  if (tag) return tag.textContent.trim()
  return `Slide ${index}`
}
