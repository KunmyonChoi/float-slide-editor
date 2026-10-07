import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements, pseudoContentText } from '../core/FlatExtractor'

describe('의사 요소 content → 글자', () => {
  it('따옴표 문자열만 글자로 친다', () => {
    expect(pseudoContentText('"→ "')).toBe('→ ')
    expect(pseudoContentText("'•'")).toBe('•')
    expect(pseudoContentText('"a" "b"')).toBe('ab')
    expect(pseudoContentText('""')).toBe('')
  })
  it('키워드·함수·none은 글자가 아니다(Firefox -moz-alt-content 포함)', () => {
    for (const v of ['-moz-alt-content', 'none', 'normal', 'open-quote', 'attr(data-x)', 'counter(n)', '', undefined]) {
      expect(pseudoContentText(v)).toBe('')
    }
  })
})

// jsdom은 레이아웃이 없으므로 인라인 left/top/width/height로 사각형을 흉내 낸다.
function fakeRect() {
  let x = 0, y = 0
  for (let n = this.parentElement; n && n.tagName !== 'BODY'; n = n.parentElement) {
    x += parseFloat(n.style.left) || 0; y += parseFloat(n.style.top) || 0
  }
  x += parseFloat(this.style.left) || 0; y += parseFloat(this.style.top) || 0
  const w = this.tagName === 'BODY' ? 1920 : parseFloat(this.style.width) || 0
  const h = this.tagName === 'BODY' ? 1080 : parseFloat(this.style.height) || 0
  return { left: x, top: y, x, y, width: w, height: h, right: x + w, bottom: y + h }
}

describe('Firefox의 img::before(-moz-alt-content)를 텍스트로 가져오지 않는다', () => {
  let origRect, origCs
  beforeEach(() => {
    origRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = fakeRect
    // Firefox 흉내: 모든 요소의 ::before content가 기본 none이지만 <img>만 -moz-alt-content
    origCs = window.getComputedStyle
    window.getComputedStyle = (el, pseudo) => {
      const cs = origCs.call(window, el, pseudo)
      if (pseudo === '::before' && el.tagName === 'IMG') {
        return new Proxy(cs, { get: (t, k) => (k === 'content' ? '-moz-alt-content' : (typeof t[k] === 'function' ? t[k].bind(t) : t[k])) })
      }
      return cs
    }
  })
  afterEach(() => {
    Element.prototype.getBoundingClientRect = origRect
    window.getComputedStyle = origCs
    document.body.innerHTML = ''
  })

  const extract = (body) => {
    const { html } = prepareHtmlForEditor(`<!DOCTYPE html><html><body>${body}</body></html>`)
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
    return extractFlatElements(document, window).elements
  }
  const mozText = (els) => els.filter(e => (typeof e.content === 'string' && e.content.includes('moz-alt'))
    || e._pseudoBefore?.content)

  it('일반 이미지 — 이미지 요소만 생기고 글자는 없다', () => {
    const els = extract(`<div style="position:absolute;left:100px;top:100px;width:800px;height:450px;overflow:hidden;">
      <img src="x.png" alt="" style="width:800px;height:450px;border-radius:24px;" /></div>`)
    expect(els.some(e => e.type === 'image')).toBe(true)
    expect(mozText(els)).toEqual([])
  })

  it('화면을 덮는 배경 이미지 — 좌상단에 글자 요소가 생기지 않는다', () => {
    const els = extract(`<div style="position:absolute;left:0px;top:0px;width:1920px;height:1080px;overflow:hidden;">
      <img src="x.png" alt="" style="position:absolute;left:0px;top:0px;width:1920px;height:1080px;border-radius:0px;" /></div>`)
    expect(mozText(els)).toEqual([])
    expect(els.filter(e => e.type === 'text')).toEqual([])
  })
})
