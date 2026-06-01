/**
 * TextListTransform — flat 텍스트 요소의 content(rich HTML)를
 * 편집기 없이 글머리/번호 리스트로 변환한다. (요소/문단 레벨 토글용)
 *
 * 산출물은 인라인 편집기의 execCommand 결과와 동일하게 <ul>/<ol><li>.
 */

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'SECTION', 'ARTICLE'])

/** body가 콘텐츠 전체를 감싸는 단일 ul/ol인지 */
function isWholeList(body) {
  const els = [...body.childNodes].filter(n => !(n.nodeType === 3 && !n.textContent.trim()))
  return els.length === 1 && els[0].nodeType === 1 && /^(UL|OL)$/.test(els[0].tagName)
}

/** 인라인/블록 혼합 콘텐츠를 <br>·블록 경계 기준으로 줄 HTML 배열로 분해 */
function splitInlineLines(root) {
  const lines = []
  let cur = ''
  const flush = () => { lines.push(cur.trim()); cur = '' }
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        cur += escapeHtml(child.textContent)
      } else if (child.nodeType === 1) {
        if (child.tagName === 'BR') { flush(); continue }
        if (BLOCK_TAGS.has(child.tagName)) {
          if (cur.trim()) flush()
          walk(child)
          if (cur.trim()) flush()
        } else {
          cur += child.outerHTML
        }
      }
    }
  }
  walk(root)
  if (cur.trim()) flush()
  return lines.length ? lines : ['']
}

/** content를 "줄 HTML" 배열로 분해 */
function contentToLines(content, isRich) {
  if (!isRich) {
    return (content || '').split('\n').map(escapeHtml)
  }
  let doc
  try { doc = new DOMParser().parseFromString(`<body>${content || ''}</body>`, 'text/html') }
  catch { return [''] }
  const body = doc.body

  // 이미 전체가 리스트면 li들을 줄로 (중첩은 평탄화)
  if (isWholeList(body)) {
    const lines = []
    body.querySelectorAll('li').forEach(li => {
      const clone = li.cloneNode(true)
      clone.querySelectorAll('ul, ol').forEach(n => n.remove()) // 중첩 li는 따로 순회됨
      const html = clone.innerHTML.trim()
      if (html) lines.push(html)
    })
    return lines.length ? lines : ['']
  }

  return splitInlineLines(body)
}

/** content의 현재 리스트 상태: 'ul' | 'ol' | 'none' */
export function detectListType(content, isRich) {
  if (!isRich || !content) return 'none'
  let doc
  try { doc = new DOMParser().parseFromString(`<body>${content}</body>`, 'text/html') }
  catch { return 'none' }
  const first = doc.body.querySelector('ul, ol')
  if (!first) return 'none'
  return first.tagName === 'OL' ? 'ol' : 'ul'
}

/**
 * content를 target 리스트로 변환.
 * @param {'ul'|'ol'|'none'} target
 * @returns {{ content: string, isRich: boolean }}
 */
export function applyListType(content, isRich, target) {
  const lines = contentToLines(content, isRich)
  if (target === 'none') {
    const html = lines.join('<br>')
    return { content: html, isRich: /<[a-z][\s\S]*>/i.test(html) }
  }
  const tag = target === 'ol' ? 'ol' : 'ul'
  const inner = lines.map(l => `<li>${l || '<br>'}</li>`).join('')
  return { content: `<${tag}>${inner}</${tag}>`, isRich: true }
}
