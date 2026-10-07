import { describe, it, expect, beforeEach } from 'vitest'
import {
  isVisuallyMeaningful,
  isSubtleGradient,
  isNavigationElement,
  hasChildTextElements,
  hasDistinctStyle,
  isEmbeddedInline,
  INLINE_TAGS,
  resetFlatCounter,
  settleAnimations,
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

  it('미세한 radial-gradient만 있으면 → false', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'radial-gradient(rgba(14, 165, 233, 0.06) 0%, rgba(0, 0, 0, 0) 70%)',
    }))).toBe(false)
  })

  it('미세한 radial-gradient(circle)만 있으면 → false', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'radial-gradient(circle, rgba(0, 229, 255, 0.15) 0%, rgba(0, 0, 0, 0) 70%)',
    }))).toBe(false)
  })

  it('뚜렷한 radial-gradient → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'radial-gradient(rgba(79, 70, 229, 0.5) 0%, rgba(0, 0, 0, 0) 70%)',
    }))).toBe(true)
  })

  it('linear-gradient → true (장식 필터 적용 안 함)', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'linear-gradient(135deg, rgb(10, 15, 44) 0%, rgb(13, 27, 62) 100%)',
    }))).toBe(true)
  })

  it('미세한 radial-gradient + border 있으면 → true', () => {
    expect(isVisuallyMeaningful(fakeCS({
      backgroundImage: 'radial-gradient(rgba(14, 165, 233, 0.06) 0%, rgba(0, 0, 0, 0) 70%)',
      borderWidth: '1px',
    }))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════
//  isSubtleGradient — 미세한 장식 그래디언트 판별
// ═══════════════════════════════════════════════════════════════
describe('isSubtleGradient — 미세한 장식 그래디언트 판별', () => {
  it('none → false', () => {
    expect(isSubtleGradient('none')).toBe(false)
  })

  it('빈 문자열 → false', () => {
    expect(isSubtleGradient('')).toBe(false)
  })

  it('linear-gradient → false (대상 아님)', () => {
    expect(isSubtleGradient('linear-gradient(135deg, #f00, #00f)')).toBe(false)
  })

  it('alpha 0.06 radial-gradient → true', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgba(14, 165, 233, 0.06) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
  })

  it('alpha 0.05 radial-gradient → true', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgba(79, 70, 229, 0.05) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
  })

  it('alpha 0.15 radial-gradient (circle) → true', () => {
    expect(isSubtleGradient(
      'radial-gradient(circle, rgba(0, 229, 255, 0.15) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
  })

  it('alpha 0.2 radial-gradient → true', () => {
    expect(isSubtleGradient(
      'radial-gradient(circle, rgba(79, 70, 229, 0.2) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
  })

  it('alpha 0.5 radial-gradient → false (뚜렷함)', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgba(79, 70, 229, 0.5) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(false)
  })

  it('투명으로 끝나지 않는 radial-gradient → false', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgba(79, 70, 229, 0.1) 0%, rgba(0, 0, 0, 0.3) 70%)'
    )).toBe(false)
  })

  it('rgb만 있는 radial-gradient (alpha 없음) → false', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgb(79, 70, 229), rgb(0, 0, 0))'
    )).toBe(false)
  })

  // ── 아래 둘은 실제로 그림을 통째로 날렸던 경우다(카세트 릴). ──

  it('레이어가 여러 장이면 모두 장식일 때만 장식 — 선명한 conic이 섞이면 false', () => {
    // 카세트 릴: radial(구멍) + radial(테두리) + conic(무늬). 첫 장만 보면 장식으로 읽힌다.
    expect(isSubtleGradient(
      'radial-gradient(circle at 50% 50%, rgb(28, 23, 38) 0px, rgb(28, 23, 38) 12px, rgba(0, 0, 0, 0) 13px), '
      + 'radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0) 42px, rgb(168, 207, 142) 43px), '
      + 'conic-gradient(rgb(255, 248, 238) 0deg, rgb(58, 50, 71) 22deg)'
    )).toBe(false)
  })

  it('장식 레이어만 여러 장이면 true', () => {
    expect(isSubtleGradient(
      'radial-gradient(rgba(14, 165, 233, 0.06) 0%, rgba(0, 0, 0, 0) 70%), '
      + 'radial-gradient(rgba(79, 70, 229, 0.05) 0%, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
  })

  it('alpha를 밝히지 않은 색은 불투명으로 센다 — 투명 끝점이 있어도 false', () => {
    // rgb()는 alpha 1인데, alpha를 "선언한" 색만 세면 0만 잡혀 장식으로 오판된다.
    expect(isSubtleGradient(
      'radial-gradient(circle, rgb(168, 207, 142) 0px, rgba(0, 0, 0, 0) 70%)'
    )).toBe(false)
  })

  it('#hex도 불투명으로 센다', () => {
    expect(isSubtleGradient(
      'radial-gradient(circle, #A8CF8E 0px, transparent 70%)'
    )).toBe(false)
  })

  it('8자리 hex의 alpha를 읽는다 — 낮으면 장식', () => {
    expect(isSubtleGradient(
      'radial-gradient(circle, #A8CF8E1A 0px, transparent 70%)'
    )).toBe(true)
  })

  it('슬래시 구분 alpha를 읽는다', () => {
    expect(isSubtleGradient(
      'radial-gradient(circle, rgb(168 207 142 / 10%) 0px, rgba(0, 0, 0, 0) 70%)'
    )).toBe(true)
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

describe('settleAnimations', () => {
  function fakeAnim(iterations, { throwOnFinish = false } = {}) {
    return {
      finished: false,
      effect: { getTiming: () => ({ iterations }) },
      finish() {
        if (throwOnFinish) throw new Error('InvalidStateError')
        this.finished = true
      },
    }
  }

  it('getAnimations 미구현 환경(jsdom)에서 안전하게 no-op', () => {
    const doc = {} // getAnimations 없음
    expect(() => settleAnimations(doc)).not.toThrow()
  })

  it('유한 애니메이션은 finish() 호출', () => {
    const a = fakeAnim(1)
    const b = fakeAnim(3)
    settleAnimations({ getAnimations: () => [a, b] })
    expect(a.finished).toBe(true)
    expect(b.finished).toBe(true)
  })

  it('무한 반복(iterations=Infinity)은 finish() 미호출', () => {
    const inf = fakeAnim(Infinity)
    settleAnimations({ getAnimations: () => [inf] })
    expect(inf.finished).toBe(false)
  })

  it('finish()가 throw해도 다른 애니메이션 처리 계속', () => {
    const bad = fakeAnim(1, { throwOnFinish: true })
    const ok = fakeAnim(1)
    expect(() => settleAnimations({ getAnimations: () => [bad, ok] })).not.toThrow()
    expect(ok.finished).toBe(true)
  })

  it('getAnimations 자체가 throw해도 안전', () => {
    const doc = { getAnimations: () => { throw new Error('boom') } }
    expect(() => settleAnimations(doc)).not.toThrow()
  })
})
