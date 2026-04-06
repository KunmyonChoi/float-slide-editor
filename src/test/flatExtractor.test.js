import { describe, it, expect, beforeEach } from 'vitest'
import {
  isVisuallyMeaningful,
  isNavigationElement,
  hasChildTextElements,
  hasDistinctStyle,
  isEmbeddedInline,
  INLINE_TAGS,
  resetFlatCounter,
} from '../core/FlatExtractor'

// ── DOM 헬퍼 ─────────────────────────────────────────────────
function createElement(tag, attrs = {}, innerHTML = '') {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(el.style, v)
    } else {
      el.setAttribute(k, v)
    }
  }
  if (innerHTML) el.innerHTML = innerHTML
  return el
}

/** getComputedStyle 대용 — 필요한 속성만 채운 객체 */
function fakeCS(overrides = {}) {
  return {
    backgroundColor: 'rgba(0, 0, 0, 0)',
    backgroundImage: 'none',
    borderWidth: '0px',
    boxShadow: 'none',
    position: 'static',
    display: 'block',
    overflow: 'visible',
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════
//  isVisuallyMeaningful
// ═══════════════════════════════════════════════════════════════
describe('isVisuallyMeaningful — 시각적 의미 판별', () => {
  it('투명 배경 + 테두리/그림자 없음 → false', () => {
    expect(isVisuallyMeaningful(fakeCS())).toBe(false)
  })

  it('배경색이 있으면 → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundColor: 'rgb(255, 255, 255)',
    }))).toBe(true)
  })

  it('background-image가 있으면 → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'linear-gradient(135deg, #052e16, #166534)',
    }))).toBe(true)
  })

  it('border-width가 있으면 → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      borderWidth: '2px',
    }))).toBe(true)
  })

  it('box-shadow가 있으면 → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    }))).toBe(true)
  })

  it('배경이 transparent 문자열이면 → false', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundColor: 'transparent',
    }))).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  isNavigationElement
// ═══════════════════════════════════════════════════════════════
describe('isNavigationElement — 네비게이션/UI 요소 감지', () => {
  it('position:fixed 요소 → true', () => {
    const el = createElement('div')
    expect(isNavigationElement(el, fakeCS({ position: 'fixed' }))).toBe(true)
  })

  it('onclick 속성을 가진 요소 → true', () => {
    const el = createElement('button', { onclick: 'nav(1)' })
    document.body.appendChild(el)
    expect(isNavigationElement(el, fakeCS())).toBe(true)
    el.remove()
  })

  it('슬라이드 카운터 패턴 "3 / 7" → true', () => {
    const el = createElement('span', {}, '3 / 7')
    document.body.appendChild(el)
    expect(isNavigationElement(el, fakeCS())).toBe(true)
    el.remove()
  })

  it('일반 텍스트 요소 → false', () => {
    const el = createElement('p', {}, '일반 텍스트')
    document.body.appendChild(el)
    expect(isNavigationElement(el, fakeCS())).toBe(false)
    el.remove()
  })

  it('onclick 가진 부모의 자식 → true', () => {
    const parent = createElement('div', { onclick: 'nav(1)' })
    const child = createElement('span', {}, '›')
    parent.appendChild(child)
    document.body.appendChild(parent)
    expect(isNavigationElement(child, fakeCS())).toBe(true)
    parent.remove()
  })
})

// ═══════════════════════════════════════════════════════════════
//  hasDistinctStyle — 인라인 요소 고유 스타일 판별
// ═══════════════════════════════════════════════════════════════
describe('hasDistinctStyle — 인라인 요소 고유 스타일 판별', () => {
  it('인라인 style 없는 <strong> → false', () => {
    const el = createElement('strong', {}, '볼드')
    expect(hasDistinctStyle(el)).toBe(false)
  })

  it('style.color 있는 <strong> → true', () => {
    const el = createElement('strong', { style: { color: '#fff' } })
    expect(hasDistinctStyle(el)).toBe(true)
  })

  it('style.backgroundColor 있는 <span> → true', () => {
    const el = createElement('span', { style: { backgroundColor: 'yellow' } })
    expect(hasDistinctStyle(el)).toBe(true)
  })

  it('style.fontWeight 있는 <em> → true', () => {
    const el = createElement('em', { style: { fontWeight: '700' } })
    expect(hasDistinctStyle(el)).toBe(true)
  })

  it('style.fontSize 있는 요소 → true', () => {
    const el = createElement('span', { style: { fontSize: '20px' } })
    expect(hasDistinctStyle(el)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  isEmbeddedInline — 텍스트 흐름 속 인라인 판별
// ═══════════════════════════════════════════════════════════════
describe('isEmbeddedInline — 텍스트 흐름 내 삽입 판별', () => {
  it('주변에 텍스트 노드가 있으면 → true', () => {
    // "대용량 메모리 <strong>강점</strong> · LLM"
    const parent = createElement('td')
    parent.appendChild(document.createTextNode('대용량 메모리 '))
    const strong = createElement('strong', { 'data-editor-id': 'fe-1' }, '강점')
    parent.appendChild(strong)
    parent.appendChild(document.createTextNode(' · LLM'))
    expect(isEmbeddedInline(strong)).toBe(true)
  })

  it('주변에 의미있는 텍스트 노드가 없으면 → false', () => {
    const parent = createElement('div')
    const span = createElement('span', { 'data-editor-id': 'fe-2' }, '단독 텍스트')
    parent.appendChild(span)
    expect(isEmbeddedInline(span)).toBe(false)
  })

  it('공백만 있는 텍스트 노드 → false', () => {
    const parent = createElement('div')
    parent.appendChild(document.createTextNode('   '))
    const span = createElement('span', {}, '텍스트')
    parent.appendChild(span)
    parent.appendChild(document.createTextNode('  \n  '))
    expect(isEmbeddedInline(span)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════
//  hasChildTextElements — 자식 텍스트 요소 존재 판별
// ═══════════════════════════════════════════════════════════════
describe('hasChildTextElements — 자식 텍스트 요소 판별', () => {
  it('블록 자식(p, h2) 있으면 → true', () => {
    const div = createElement('div')
    const p = createElement('p', { 'data-editor-id': 'fe-10' }, '단락')
    div.appendChild(p)
    expect(hasChildTextElements(div)).toBe(true)
  })

  it('인라인 자식만(strong, em) — 고유 스타일 없음 → false', () => {
    const td = createElement('td')
    const strong = createElement('strong', { 'data-editor-id': 'fe-20' }, '볼드')
    td.appendChild(document.createTextNode('텍스트 '))
    td.appendChild(strong)
    expect(hasChildTextElements(td)).toBe(false)
  })

  it('인라인 자식 — 고유 스타일 + embedded → false', () => {
    const td = createElement('td')
    td.appendChild(document.createTextNode('메모리 '))
    const strong = createElement('strong', {
      'data-editor-id': 'fe-30',
      style: { color: '#fff' },
    }, '2배')
    td.appendChild(strong)
    td.appendChild(document.createTextNode(' 증가'))
    expect(hasChildTextElements(td)).toBe(false)
  })

  it('인라인 자식 — 고유 스타일 + 비embedded → true', () => {
    const div = createElement('div')
    const span = createElement('span', {
      'data-editor-id': 'fe-40',
      style: { color: 'red' },
    }, '독립 텍스트')
    div.appendChild(span)
    expect(hasChildTextElements(div)).toBe(true)
  })
})
