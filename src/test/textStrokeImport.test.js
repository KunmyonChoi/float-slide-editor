import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements } from '../core/FlatExtractor'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'

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

describe('글자 외곽선(-webkit-text-stroke) 가져오기·내보내기', () => {
  let origRect, origCs
  beforeEach(() => {
    origRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = fakeRect
    // 브라우저처럼 외곽선 두께·색을 계산 스타일로 돌려준다(jsdom은 이 속성을 계산하지 않음)
    origCs = window.getComputedStyle
    window.getComputedStyle = (el, pseudo) => {
      const cs = origCs.call(window, el, pseudo)
      const stroke = !pseudo && el.style?.getPropertyValue?.('-webkit-text-stroke-width')
      if (!stroke) return cs
      return new Proxy(cs, { get: (t, k) => {
        if (k === 'webkitTextStrokeWidth') return stroke
        if (k === 'webkitTextStrokeColor') return el.style.getPropertyValue('-webkit-text-stroke-color')
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v
      } })
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

  it('속이 빈 외곽선 글자의 외곽선을 textStroke로 가져온다', () => {
    const els = extract(`<div style="position:absolute;left:100px;top:100px;width:600px;height:130px;font-size:120px;color:transparent;
      -webkit-text-stroke-width:2px;-webkit-text-stroke-color:rgb(127, 231, 255);">FOCUS</div>`)
    const t = els.find(e => e.type === 'text')
    expect(t.styles.textStroke).toBe('2px rgb(127, 231, 255)')
  })

  it('외곽선이 없으면 textStroke를 두지 않는다', () => {
    const els = extract(`<div style="position:absolute;left:100px;top:100px;width:600px;height:80px;font-size:60px;">보통 글자</div>`)
    expect(els.find(e => e.type === 'text').styles.textStroke).toBeUndefined()
  })

  it('내보낼 때 -webkit-text-stroke로 되돌린다', () => {
    const html = exportFlatHtmlAllPages({ '0-0': { canvasSize: { w: 1920, h: 1080 }, elements: [{
      id: 'flat-1', type: 'text', content: 'FOCUS', x: 0, y: 0, width: 600, height: 130, zIndex: 1,
      styles: { color: 'rgba(0, 0, 0, 0)', fontSize: '120px', textStroke: '2px rgb(127, 231, 255)' } }] } })
    expect(html).toContain('-webkit-text-stroke:2px rgb(127, 231, 255)')
  })
})
