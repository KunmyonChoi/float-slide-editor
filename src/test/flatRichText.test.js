import { describe, it, expect } from 'vitest'

/**
 * getRichTextContent는 내부(비export) 함수이므로
 * extractFlatElements 통합 테스트 대신, DOM 구조를 만들어
 * 동일 로직을 직접 검증한다.
 *
 * 검증 대상 버그/개선:
 * 1. 이중 인코딩 방지 (& → &amp; 1회만)
 * 2. <br> 뒤 소스 들여쓰기 공백 제거
 * 3. 시맨틱 서식 태그(strong, em 등) 볼드/이탤릭 보존
 * 4. 스타일 있는 인라인 요소 HTML 보존
 * 5. 복수 인라인 자식 리치 텍스트 병합
 */

// getRichTextContent 동일 로직 재현 (내부 함수 테스트용)
const INLINE_TAGS = new Set(['strong', 'em', 'span', 'a', 'b', 'i', 'u', 'mark', 'sub', 'sup', 'code', 'label'])
const SEMANTIC_FORMAT_TAGS = new Set(['strong', 'em', 'b', 'i', 'u', 'mark', 'sub', 'sup', 'code'])

function hasDistinctStyle(el) {
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

function isEmbeddedInline(el) {
  const parent = el.parentElement
  if (!parent) return false
  for (const node of parent.childNodes) {
    if (node === el) continue
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return true
  }
  return false
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cleanInlineHtml(el) {
  const clone = el.cloneNode(true)
  clone.removeAttribute('data-editor-id')
  clone.removeAttribute('data-editor-type')
  clone.removeAttribute('data-editor-selected')
  return clone.outerHTML
}

function getRichTextContent(el) {
  let html = ''
  let plain = ''
  let hasHtml = false
  let afterBr = false
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent
      if (afterBr) { text = text.replace(/^\s+/, ''); afterBr = false }
      html += escapeHtml(text)
      plain += text
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      afterBr = false
      const tag = node.tagName.toLowerCase()
      if (tag === 'br') { html += '<br>'; plain += '\n'; hasHtml = true; afterBr = true; continue }
      // SVG 요소 → outerHTML 보존 (인라인 아이콘 등)
      if (tag === 'svg') { html += node.outerHTML; hasHtml = true; continue }
      if (node.hasAttribute('data-editor-id')) {
        if (!INLINE_TAGS.has(tag)) continue
        if (hasDistinctStyle(node) && isEmbeddedInline(node)) {
          html += cleanInlineHtml(node)
          hasHtml = true
          continue
        }
        if (hasDistinctStyle(node) && !isEmbeddedInline(node)) continue
      }
      if (SEMANTIC_FORMAT_TAGS.has(tag)) {
        html += `<${tag}>${escapeHtml(node.textContent)}</${tag}>`
        plain += node.textContent
        hasHtml = true
        continue
      }
      html += escapeHtml(node.textContent)
      plain += node.textContent
    }
  }
  return { text: hasHtml ? html.trim() : plain.trim(), isRich: hasHtml }
}

// ── DOM 헬퍼 ─────────────────────────────────────────────────
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v)
    } else {
      el.setAttribute(k, v)
    }
  }
  for (const child of children) {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child))
    else el.appendChild(child)
  }
  return el
}

// ═══════════════════════════════════════════════════════════════
//  1. 이중 인코딩 방지
// ═══════════════════════════════════════════════════════════════
describe('getRichTextContent — 이중 인코딩 방지', () => {
  it('& 문자가 한 번만 인코딩된다 (plain text)', () => {
    const el = h('p', {}, 'A & B')
    const { text, isRich } = getRichTextContent(el)
    // isRich=false → plain text → 외부에서 escHtml 1회 적용
    expect(isRich).toBe(false)
    expect(text).toBe('A & B')
    expect(text).not.toContain('&amp;')
  })

  it('& 문자가 한 번만 인코딩된다 (rich text with <br>)', () => {
    const el = h('p', {})
    el.appendChild(document.createTextNode('A & B'))
    el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode('C < D'))
    const { text, isRich } = getRichTextContent(el)
    expect(isRich).toBe(true)
    // rich text → HTML 문자열 → 이미 1회 이스케이프됨
    expect(text).toContain('A &amp; B')
    expect(text).toContain('C &lt; D')
    // 이중 인코딩 없음
    expect(text).not.toContain('&amp;amp;')
    expect(text).not.toContain('&amp;lt;')
  })
})

// ═══════════════════════════════════════════════════════════════
//  2. <br> 뒤 소스 들여쓰기 공백 제거
// ═══════════════════════════════════════════════════════════════
describe('getRichTextContent — <br> 뒤 들여쓰기 제거', () => {
  it('<br> 뒤 탭+공백 들여쓰기가 제거된다', () => {
    const el = h('div', {})
    el.appendChild(document.createTextNode('첫째 줄'))
    el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode('\t    둘째 줄'))
    const { text } = getRichTextContent(el)
    expect(text).toContain('둘째 줄')
    expect(text).not.toMatch(/<br>\s+둘/)
    expect(text).toContain('<br>둘째 줄')
  })

  it('<br> 뒤 줄바꿈(\\n)+공백 들여쓰기가 제거된다', () => {
    // 실제 슬라이드 HTML 패턴:
    // 트랜지스터 <strong>2배</strong><br>\n          처리 성능
    const el = h('div', {})
    el.appendChild(document.createTextNode('트랜지스터 2배'))
    el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode('\n          처리 성능 2.5배'))
    el.appendChild(document.createElement('br'))
    el.appendChild(document.createTextNode("\n          '24 4Q 출시 예정"))
    const { text } = getRichTextContent(el)
    expect(text).toContain('<br>처리 성능')
    expect(text).toContain("<br>'24 4Q 출시 예정")
    expect(text).not.toContain('\n')
    expect(text).not.toMatch(/  /)  // 연속 공백 없음
  })

  it('<br> 없는 일반 텍스트의 공백은 보존된다', () => {
    const el = h('p', {}, '여러  단어  사이  공백')
    const { text } = getRichTextContent(el)
    expect(text).toBe('여러  단어  사이  공백')
  })
})

// ═══════════════════════════════════════════════════════════════
//  3. 시맨틱 서식 태그 보존
// ═══════════════════════════════════════════════════════════════
describe('getRichTextContent — 시맨틱 서식 태그 보존', () => {
  it('스타일 없는 <strong>의 볼드가 보존된다', () => {
    // <td><strong>대용량 메모리</strong> 강점 · LLM 추론 최적</td>
    const td = h('td', {})
    const strong = h('strong', { 'data-editor-id': 'fe-1', 'data-editor-type': 'text' }, '대용량 메모리')
    td.appendChild(strong)
    td.appendChild(document.createTextNode(' 강점 · LLM 추론 최적'))
    const { text, isRich } = getRichTextContent(td)
    expect(isRich).toBe(true)
    expect(text).toContain('<strong>대용량 메모리</strong>')
    expect(text).toContain('강점 · LLM 추론 최적')
  })

  it('스타일 없는 <em>의 이탤릭이 보존된다', () => {
    const p = h('p', {})
    p.appendChild(document.createTextNode('일반 텍스트 '))
    p.appendChild(h('em', {}, '강조'))
    p.appendChild(document.createTextNode(' 나머지'))
    const { text, isRich } = getRichTextContent(p)
    expect(isRich).toBe(true)
    expect(text).toContain('<em>강조</em>')
  })

  it('스타일 없는 <b>, <i>, <u> 태그도 보존된다', () => {
    const div = h('div', {})
    div.appendChild(h('b', {}, '굵게'))
    div.appendChild(document.createTextNode(' '))
    div.appendChild(h('i', {}, '기울임'))
    div.appendChild(document.createTextNode(' '))
    div.appendChild(h('u', {}, '밑줄'))
    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(true)
    expect(text).toContain('<b>굵게</b>')
    expect(text).toContain('<i>기울임</i>')
    expect(text).toContain('<u>밑줄</u>')
  })
})

// ═══════════════════════════════════════════════════════════════
//  4. 스타일 있는 인라인 요소 HTML 보존 (embedded)
// ═══════════════════════════════════════════════════════════════
describe('getRichTextContent — 스타일 인라인 요소 보존', () => {
  it('color 스타일 있는 embedded <strong>의 outerHTML이 보존된다', () => {
    // 트랜지스터 <strong style="color: #fff;">2배</strong><br>...
    const div = h('div', {})
    div.appendChild(document.createTextNode('트랜지스터 '))
    const strong = h('strong', {
      'data-editor-id': 'fe-377',
      'data-editor-type': 'text',
      style: { color: '#fff' },
    }, '2배')
    div.appendChild(strong)
    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(true)
    // data-editor-id 제거 확인
    expect(text).not.toContain('data-editor-id')
    // style 보존 확인
    expect(text).toContain('<strong')
    expect(text).toContain('2배</strong>')
    expect(text).toContain('color')
  })

  it('스타일 있는 비embedded <span>은 독립 추출 대상으로 제외된다', () => {
    const div = h('div', {})
    const span = h('span', {
      'data-editor-id': 'fe-50',
      'data-editor-type': 'text',
      style: { color: 'red', fontSize: '20px' },
    }, '독립 텍스트')
    div.appendChild(span)
    const { text } = getRichTextContent(div)
    // 독립 추출 대상은 제외
    expect(text).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════
//  5. 복합 리치 텍스트 — 실제 슬라이드 패턴
// ═══════════════════════════════════════════════════════════════
describe('getRichTextContent — 복합 리치 텍스트 (실제 패턴)', () => {
  it('Blackwell B200 설명: <strong> + <br> + 들여쓰기 조합', () => {
    // 원본 HTML:
    // 트랜지스터 <strong style="color:#fff;">2배</strong><br>
    //           처리 성능 <strong style="color:#fff;">2.5배 ↑</strong><br>
    //           '24 4Q 출시 예정
    const div = h('div', {
      'data-editor-id': 'fe-376',
      'data-editor-type': 'container',
      style: { fontSize: '11.5px', color: '#D1FAE5', lineHeight: '1.7' },
    })
    div.appendChild(document.createTextNode('\n          트랜지스터 '))
    const s1 = h('strong', {
      'data-editor-id': 'fe-377',
      'data-editor-type': 'text',
      style: { color: '#fff' },
    }, '2배')
    div.appendChild(s1)
    div.appendChild(document.createElement('br'))
    div.appendChild(document.createTextNode('\n          처리 성능 '))
    const s2 = h('strong', {
      'data-editor-id': 'fe-378',
      'data-editor-type': 'text',
      style: { color: '#fff' },
    }, '2.5배 ↑')
    div.appendChild(s2)
    div.appendChild(document.createElement('br'))
    div.appendChild(document.createTextNode("\n          '24 4Q 출시 예정\n        "))

    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(true)

    // strong 태그 + style 보존
    expect(text).toMatch(/<strong[^>]*>2배<\/strong>/)
    expect(text).toMatch(/<strong[^>]*>2\.5배 ↑<\/strong>/)

    // <br> 뒤 들여쓰기 제거
    expect(text).not.toMatch(/<br>\s+처리/)
    expect(text).toContain('<br>처리 성능')

    // data-editor 속성 제거
    expect(text).not.toContain('data-editor-id')

    // 이중 인코딩 없음
    expect(text).not.toContain('&amp;')

    // 앞뒤 공백 trim됨
    expect(text).not.toMatch(/^\s/)
    expect(text).not.toMatch(/\s$/)
  })

  it('인라인 SVG 아이콘이 outerHTML로 보존된다', () => {
    // <div>AI 가속화 <svg viewBox="0 0 24 24"><path d="M12 ..."/></svg></div>
    const div = h('div', { 'data-editor-id': 'fe-200', 'data-editor-type': 'container' })
    div.appendChild(document.createTextNode('AI 가속화 '))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z')
    svg.appendChild(path)
    div.appendChild(svg)

    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(true)
    expect(text).toContain('AI 가속화')
    expect(text).toContain('<svg')
    expect(text).toContain('viewBox')
    expect(text).toContain('<path')
  })

  it('SVG 없이 텍스트만 있으면 plain text 반환', () => {
    const div = h('div', {}, '순수 텍스트')
    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(false)
    expect(text).toBe('순수 텍스트')
  })

  it('핵심 메시지 배너: <span> + 일반 텍스트 혼합', () => {
    const div = h('div', { 'data-editor-id': 'fe-100', 'data-editor-type': 'container' })
    const span = h('span', {
      'data-editor-id': 'fe-101',
      'data-editor-type': 'text',
      style: { fontWeight: '700' },
    }, '핵심 메시지 ▶')
    div.appendChild(span)
    div.appendChild(document.createTextNode(' 서버용 GPU 시장은 Nvidia가 90% 이상을 독점'))

    const { text, isRich } = getRichTextContent(div)
    expect(isRich).toBe(true)
    expect(text).toContain('핵심 메시지 ▶')
    expect(text).toContain('서버용 GPU 시장은')
  })
})
