/**
 * TextStyleScope — 리치 텍스트 요소의 "전체(element) 적용" 서식 유틸.
 *
 * 부분(run) 서식은 인라인 <span style>/<b>/<i> 등으로 표현되어 base 스타일을 덮는다.
 * 따라서 base 스타일만 바꾸면 부분 수정분이 그대로 남는다(우선순위). 전체 적용은
 * base + 인라인 override를 함께 처리해야 사용자가 기대하는 동작이 된다.
 *
 *  - bumpFontSizePx: 증감(델타) — base와 모든 인라인 font-size를 함께 가감 → 위계 유지
 *  - setFontSizeUniformPx: 절대값 — 인라인 font-size 제거 + base 설정 → 전체 통일
 *  - stripInlineFormatting: 굵게/이탤릭 등 인라인 override 제거 + 태그 unwrap → base가 지배
 */

const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

function parseBody(html) {
  return new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html').body
}

function cleanupStyleAttr(el) {
  if (el.getAttribute && el.getAttribute('style') === '') el.removeAttribute('style')
}

/**
 * 글자 크기 상대 증감 — base와 모든 인라인 font-size를 deltaPx만큼 가감(위계 유지).
 * @returns {{ content: string, fontSize: string }}
 */
export function bumpFontSizePx(content, isRich, baseSizePx, deltaPx, { min = 8, max = 400 } = {}) {
  const newBase = clamp(Math.round((baseSizePx || 16) + deltaPx), min, max)
  if (!isRich || !content || !/font-size/i.test(content)) {
    return { content, fontSize: `${newBase}px` }
  }
  const body = parseBody(content)
  body.querySelectorAll('*').forEach(el => {
    const fs = el.style && el.style.fontSize
    if (fs) {
      const cur = parseFloat(fs)
      if (!isNaN(cur)) el.style.fontSize = `${clamp(Math.round(cur + deltaPx), min, max)}px`
    }
  })
  return { content: body.innerHTML, fontSize: `${newBase}px` }
}

/**
 * 글자 크기 절대 통일 — 인라인 font-size 모두 제거 + base를 sizePx로.
 * @returns {{ content: string, fontSize: string }}
 */
export function setFontSizeUniformPx(content, isRich, sizePx, { min = 1, max = 400 } = {}) {
  const size = clamp(Math.round(sizePx), min, max)
  if (!isRich || !content || !/font-size/i.test(content)) {
    return { content, fontSize: `${size}px` }
  }
  const body = parseBody(content)
  body.querySelectorAll('*').forEach(el => {
    if (el.style && el.style.fontSize) el.style.removeProperty('font-size')
    cleanupStyleAttr(el)
  })
  return { content: body.innerHTML, fontSize: `${size}px` }
}

/**
 * 전체 적용용 — 인라인 서식 override 제거(지정 style prop 제거 + 지정 태그 unwrap).
 * 이후 base 스타일이 전체를 지배하게 된다.
 * @returns {string} 정리된 content (비-rich/빈 값이면 원본 그대로)
 */
export function stripInlineFormatting(content, isRich, { styleProps = [], tags = [] } = {}) {
  if (!isRich || !content) return content
  const body = parseBody(content)
  if (styleProps.length) {
    body.querySelectorAll('*').forEach(el => {
      if (el.style) styleProps.forEach(p => el.style.removeProperty(p))
      cleanupStyleAttr(el)
    })
  }
  tags.forEach(tag => {
    body.querySelectorAll(tag).forEach(el => {
      const parent = el.parentNode
      if (!parent) return
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
    })
  })
  return body.innerHTML
}

// 서식별 인라인 override 정의 (전체 적용 시 제거 대상)
export const FORMAT_STRIP = {
  bold: { styleProps: ['font-weight'], tags: ['b', 'strong'] },
  italic: { styleProps: ['font-style'], tags: ['i', 'em'] },
  underline: { styleProps: ['text-decoration', 'text-decoration-line'], tags: ['u'] },
  strike: { styleProps: ['text-decoration', 'text-decoration-line'], tags: ['s', 'strike', 'del'] },
}
