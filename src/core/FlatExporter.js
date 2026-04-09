/**
 * FlatExporter
 * 원본 iframe과 Flat 변환 결과를 독립 HTML 파일로 내보낸다.
 */

/**
 * iframe의 현재 렌더링 상태를 정적 HTML로 내보낸다.
 * 에디터 에이전트 스크립트와 편집 속성을 제거한다.
 */
export function exportOriginalHtml(iframeRef) {
  const iframe = iframeRef?.current
  if (!iframe) return null
  const doc = iframe.contentDocument
  if (!doc) return null

  // deep clone
  const clone = doc.documentElement.cloneNode(true)

  // 에디터 에이전트/스타일 제거
  const agentScript = clone.querySelector('#__fe-agent')
  if (agentScript) agentScript.remove()
  const histPatch = clone.querySelector('#__fe-history-patch')
  if (histPatch) histPatch.remove()
  const agentStyle = clone.querySelector('#__fe-style')
  if (agentStyle) agentStyle.remove()

  // 편집 관련 속성 제거
  clone.querySelectorAll('[data-editor-id]').forEach(el => {
    el.removeAttribute('data-editor-id')
    el.removeAttribute('data-editor-type')
    el.removeAttribute('data-editor-selected')
  })

  // 삽입 플레이스홀더/리사이즈 핸들 제거
  clone.querySelectorAll('.__fe-insert-ph, .__fe-resize-handle').forEach(el => el.remove())

  return `<!DOCTYPE html>\n<html lang="ko">\n${clone.innerHTML}\n</html>`
}

/**
 * Flat 요소 배열을 독립 HTML 파일로 내보낸다.
 */
export function exportFlatHtml(flatElements, canvasSize, fontImports = []) {
  const els = flatElements.map(el => {
    if (el.type === 'image') {
      const objPos = el.styles.objectPosition && el.styles.objectPosition !== 'center center' && el.styles.objectPosition !== '50% 50%'
        ? `object-position:${el.styles.objectPosition};` : ''
      return `<div style="${flatStyle(el)}"><img src="${escHtml(el.content)}" alt="" style="width:100%;height:100%;object-fit:${el.styles.objectFit || 'cover'};${objPos}display:block;border-radius:${el.styles.borderRadius || '0'};" /></div>`
    }
    if (el.type === 'text') {
      const textContent = el.isRich ? el.content : escHtml(el.content)
      const hasBg = el.styles.backgroundColor && el.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && el.styles.backgroundColor !== 'transparent'
      const needsFlex = el.merged || hasBg
      const gapStyle = (el.styles.gap && el.styles.gap !== '0px' && el.styles.gap !== 'normal') ? `gap:${el.styles.gap};` : ''
      const mergedFlex = needsFlex ? `display:flex;align-items:${el.styles.isFlex ? (el.styles.alignItems || 'center') : 'center'};justify-content:${el.styles.isFlex ? (el.styles.justifyContent || 'center') : (el.styles.textAlign === 'center' ? 'center' : el.styles.textAlign === 'right' ? 'flex-end' : 'flex-start')};${gapStyle}` : ''
      const isGradientText = el.styles.webkitBackgroundClip === 'text'
      if (isGradientText) {
        // 그래디언트 텍스트: 외부 div에 배경색 (textShadow 제외), 내부 span에 gradient+clip+drop-shadow
        const dropShadow = el.styles.textShadow && el.styles.textShadow !== 'none'
          ? `;filter:${textShadowToFilter(el.styles.textShadow)}` : ''
        const gradSpan = `background-image:${el.styles.backgroundImage || 'none'};-webkit-background-clip:text;-webkit-text-fill-color:${el.styles.webkitTextFillColor || 'transparent'}${dropShadow}`
        return `<div style="${flatStyle(el)};${mergedFlex}${textStyleNoGradient(el.styles, true)}"><span style="${gradSpan}">${textContent}</span></div>`
      }
      return `<div style="${flatStyle(el)};${mergedFlex}${textStyle(el.styles)}">${textContent}</div>`
    }
    if (el.type === 'svg') {
      return `<div style="${flatStyle(el)}">${el.content}</div>`
    }
    // shape
    return `<div style="${flatStyle(el)};${shapeStyle(el.styles)}"></div>`
  })

  // 폰트 임포트를 <link> 태그와 <style> 블록으로 분리
  // @import url(...) → <link rel="stylesheet"> (더 빠른 로딩)
  // @font-face → <style> 블록
  let fontLinks = ''
  let fontStyleBlock = ''
  if (fontImports.length > 0) {
    const links = []
    const styles = []
    for (const imp of fontImports) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        links.push(`<link rel="stylesheet" href="${urlMatch[1]}">`)
      } else {
        styles.push(imp)
      }
    }
    fontLinks = links.length > 0 ? '\n' + links.join('\n') : ''
    fontStyleBlock = styles.length > 0 ? `\n<style>${styles.join('\n')}</style>` : ''
  }

  const preconnect = fontLinks
    ? '\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    : ''

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Flat Export</title>${preconnect}${fontLinks}
<style>* { box-sizing: border-box; margin: 0; padding: 0; }</style>${fontStyleBlock}
</head>
<body style="width:${canvasSize.w}px;height:${canvasSize.h}px;overflow:hidden;position:relative;">
${els.join('\n')}
</body>
</html>`
}

/** 다운로드 트리거 */
export function downloadHtml(htmlString, filename) {
  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── 헬퍼 ─────────────────────────────────────────────────────

function flatStyle(el) {
  // 텍스트 요소: 기본 overflow:visible (한글 descender 클리핑 방지)
  // 단, 원본이 hidden/auto/scroll이면 보존 (코드 블록 등)
  let overflow = el.type === 'text' ? 'visible' : 'hidden'
  if (el.type === 'text' && el.styles) {
    const origOvf = el.styles.overflow || ''
    const origOvfX = el.styles.overflowX || ''
    if (origOvf.includes('hidden') || origOvf.includes('auto') || origOvf.includes('scroll') ||
        origOvfX === 'hidden' || origOvfX === 'auto' || origOvfX === 'scroll') {
      overflow = 'hidden'
    }
  }
  return [
    `position:absolute`,
    `left:${r(el.x)}px`,
    `top:${r(el.y)}px`,
    `width:${r(el.width)}px`,
    `height:${r(el.height)}px`,
    `z-index:${el.zIndex}`,
    `box-sizing:border-box`,
    `overflow:${overflow}`,
    el.rotation ? `transform:rotate(${el.rotation}deg);transform-origin:center center` : '',
  ].filter(Boolean).join(';')
}

function textStyleBase(s, includeGradient, excludeTextShadow) {
  return [
    s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `background-color:${s.backgroundColor}` : '',
    includeGradient && s.backgroundImage && s.backgroundImage !== 'none' ? `background-image:${s.backgroundImage}` : '',
    s.color ? `color:${s.color}` : '',
    s.fontSize ? `font-size:${s.fontSize}` : '',
    s.fontFamily ? `font-family:${s.fontFamily.replace(/"/g, "'")}` : '',
    s.fontWeight ? `font-weight:${s.fontWeight}` : '',
    s.fontStyle && s.fontStyle !== 'normal' ? `font-style:${s.fontStyle}` : '',
    s.lineHeight ? `line-height:${s.lineHeight}` : '',
    s.textAlign ? `text-align:${s.textAlign}` : '',
    s.letterSpacing && s.letterSpacing !== 'normal' ? `letter-spacing:${s.letterSpacing}` : '',
    s.textTransform && s.textTransform !== 'none' ? `text-transform:${s.textTransform}` : '',
    s.textDecoration && s.textDecoration !== 'none' ? `text-decoration:${s.textDecoration}` : '',
    includeGradient && s.webkitBackgroundClip === 'text' ? `-webkit-background-clip:text` : '',
    includeGradient && s.webkitBackgroundClip === 'text' ? `-webkit-text-fill-color:${s.webkitTextFillColor || 'transparent'}` : '',
    s.borderRadius && s.borderRadius !== '0px' ? `border-radius:${s.borderRadius}` : '',
    ...borderStyles(s),
    s.boxShadow && s.boxShadow !== 'none' ? `box-shadow:${s.boxShadow}` : '',
    // 그래디언트 텍스트: textShadow는 내부 span의 drop-shadow filter로 처리
    !excludeTextShadow && s.textShadow && s.textShadow !== 'none' ? `text-shadow:${s.textShadow}` : '',
    s.padding && s.padding !== '0px' ? `padding:${s.padding}` : '',
    s.opacity && s.opacity !== '1' ? `opacity:${s.opacity}` : '',
    `white-space:pre-wrap`,
    `word-break:break-word`,
  ].filter(Boolean).join(';')
}

function textStyle(s) { return textStyleBase(s, true, false) }
function textStyleNoGradient(s, excludeTextShadow) { return textStyleBase(s, false, excludeTextShadow) }

function shapeStyle(s) {
  return [
    s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' ? `background-color:${s.backgroundColor}` : '',
    s.backgroundImage && s.backgroundImage !== 'none' ? `background-image:${s.backgroundImage}` : '',
    s.borderRadius && s.borderRadius !== '0px' ? `border-radius:${s.borderRadius}` : '',
    ...borderStyles(s),
    s.boxShadow && s.boxShadow !== 'none' ? `box-shadow:${s.boxShadow}` : '',
    s.opacity && s.opacity !== '1' ? `opacity:${s.opacity}` : '',
  ].filter(Boolean).join(';')
}

/** border 단축 속성 또는 개별 border-side 속성 반환 */
function borderStyles(s) {
  // 단축 border가 유효하면 그것만 사용
  if (s.border && !s.border.startsWith('0px')) return [`border:${s.border}`]
  // 개별 side 체크
  const sides = []
  if (s.borderTop && !s.borderTop.startsWith('0px')) sides.push(`border-top:${s.borderTop}`)
  if (s.borderRight && !s.borderRight.startsWith('0px')) sides.push(`border-right:${s.borderRight}`)
  if (s.borderBottom && !s.borderBottom.startsWith('0px')) sides.push(`border-bottom:${s.borderBottom}`)
  if (s.borderLeft && !s.borderLeft.startsWith('0px')) sides.push(`border-left:${s.borderLeft}`)
  return sides
}

/** text-shadow CSS → filter: drop-shadow() 변환 (그래디언트 텍스트용) */
function textShadowToFilter(textShadow) {
  if (!textShadow || textShadow === 'none') return 'none'
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

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function r(n) { return Math.round(n * 10) / 10 }
