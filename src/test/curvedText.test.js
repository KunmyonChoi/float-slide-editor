import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { textArcOf, isCurvedText, plainTextOf, arcGeometry, curvedTextSvg, shadowToFilter } from '../core/curvedText'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements } from '../core/FlatExtractor'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'

const txt = (over = {}) => ({ id: 'flat-1', type: 'text', content: 'SUMMER FUNK', x: 0, y: 0, width: 600, height: 200, zIndex: 1,
  styles: { fontSize: '48px', fontFamily: '"Bebas Neue", sans-serif', color: 'rgb(255, 255, 255)' }, textArc: 60, ...over })

describe('곡선 글자 — 값·판정', () => {
  it('휘기는 −100~100 정수로 자르고 0·숫자 아님은 곧게', () => {
    expect(textArcOf({ textArc: 150 })).toBe(100)
    expect(textArcOf({ textArc: -42.6 })).toBe(-43)
    expect(textArcOf({ textArc: 0 })).toBe(0)
    expect(textArcOf({})).toBe(0)
    expect(isCurvedText(txt())).toBe(true)
    expect(isCurvedText(txt({ textArc: 0 }))).toBe(false)
    expect(isCurvedText({ type: 'shape', textArc: 50 })).toBe(false)
  })

  it('리치 텍스트는 한 줄 평문으로', () => {
    expect(plainTextOf('A<br>B <strong>C</strong> &amp; D', true)).toBe('A B C & D')
    expect(plainTextOf('  여러\n줄  ', false)).toBe('여러 줄')
  })
})

describe('원호 기하', () => {
  it('+는 위로 볼록(시계 방향 sweep 1), −는 아래로(sweep 0)', () => {
    expect(arcGeometry(600, 200, 60, 48).d).toMatch(/ 0 0 1 /)
    expect(arcGeometry(600, 200, -60, 48).d).toMatch(/ 0 0 0 /)
  })
  it('휘기 100이면 반원 — 볼록한 높이가 현의 절반', () => {
    const g = arcGeometry(600, 400, 100, 40)
    const pad = Math.min(60, 10)
    expect(g.sagitta).toBeCloseTo((600 - 2 * pad) / 2)
    expect(g.r).toBeCloseTo((600 - 2 * pad) / 2)
  })
})

describe('SVG', () => {
  it('textPath를 가운데에 얹고 글자 모양을 따른다', () => {
    const svg = curvedTextSvg(txt({ styles: { fontSize: '48px', fontFamily: '"Bebas Neue", sans-serif', color: 'rgb(255, 255, 255)',
      letterSpacing: '6px', textStroke: '2px rgb(0, 0, 0)', textShadow: '0px 2px 6px rgba(0, 0, 0, 0.5)' } }), 'u1')
    expect(svg).toContain('<textPath href="#fe-arc-flat-1-u1" startOffset="50%" text-anchor="middle">SUMMER FUNK</textPath>')
    expect(svg).toContain('fill="rgb(255, 255, 255)"')
    expect(svg).toContain('stroke="rgb(0, 0, 0)" stroke-width="2"')
    expect(svg).toContain("font-family:'Bebas Neue', sans-serif")
    expect(svg).toContain('letter-spacing:6px')
    expect(svg).toContain('filter:drop-shadow(0px 2px 6px rgba(0, 0, 0, 0.5))')
  })
  it('글자 속 특수문자는 이스케이프', () => {
    expect(curvedTextSvg(txt({ content: 'R&B <live>' }))).toContain('R&amp;B &lt;live&gt;')
  })
  it('여러 그림자는 drop-shadow 연쇄로', () => {
    expect(shadowToFilter('0 0 6px #f0f, 0 0 18px rgba(1,2,3,.5)')).toBe('drop-shadow(0 0 6px #f0f) drop-shadow(0 0 18px rgba(1,2,3,.5))')
    expect(shadowToFilter('none')).toBe('')
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

describe('HTML 가져오기·내보내기', () => {
  let orig
  beforeEach(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = fakeRect })
  afterEach(() => { Element.prototype.getBoundingClientRect = orig })

  it('data-text-arc를 읽어 textArc로', () => {
    const { html } = prepareHtmlForEditor(`<!DOCTYPE html><html><body>
      <div data-text-arc="-70" style="position:absolute;left:100px;top:100px;width:600px;height:200px;font-size:48px;">SUMMER FUNK</div></body></html>`)
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML
    expect(extractFlatElements(doc, window).elements.find(e => e.type === 'text')?.textArc).toBe(-70)
  })

  it('내보내면 data-text-arc가 남는다', () => {
    const out = exportFlatHtmlAllPages({ '0-0': { canvasSize: { w: 1920, h: 1080 }, elements: [txt({ textArc: 45 })] } })
    expect(out).toContain('data-text-arc="45"')
  })
})
