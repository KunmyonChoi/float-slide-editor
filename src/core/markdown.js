// 마크다운 → 안전한 HTML. 코드 하이라이트(codeHighlight.js)와 같은 위치(편집=원본, 표시=렌더).
// 렌더 결과는 dangerouslySetInnerHTML로 삽입되므로 반드시 새니타이즈한다.
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ gfm: true, breaks: true })

// 링크는 새 탭 + 안전 rel (한 번만 등록)
let hookAdded = false
function ensureHook() {
  if (hookAdded || typeof DOMPurify.addHook !== 'function') return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookAdded = true
}

/** 마크다운 원본 → 새니타이즈된 HTML 문자열 */
export function renderMarkdown(src) {
  const text = String(src || '')
  if (!text.trim()) return ''
  ensureHook()
  let html = ''
  try { html = marked.parse(text, { async: false }) } catch { return '' }
  try { return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }) }
  catch { return '' }
}
