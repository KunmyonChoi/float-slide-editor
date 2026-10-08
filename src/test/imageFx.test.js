import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizeFx, fullFx, fxFilterCss, warmthTint, vignetteGradient, fxOverlayStyles, parseFxAttr, fxToAttr, fxFromCssFilter, bakeFxToDataUrl, FX_DEFAULTS } from '../core/imageFx'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements } from '../core/FlatExtractor'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'

vi.mock('pptxgenjs', () => ({
  default: class MockPptxGenJS {
    constructor() { this.slides = []; this._layouts = {} }
    defineLayout(l) { this._layouts[l.name] = l }
    addSlide() {
      const slide = { _items: [], addText(r, o) { this._items.push({ type: 'text', r, o }) }, addImage(o) { this._items.push({ type: 'image', opts: o }) },
        addShape(sh, o) { this._items.push({ type: 'shape', sh, o }) }, addNotes() {} }
      this.slides.push(slide); return slide
    }
    async writeFile() {}
  },
}))
const { exportToPptx } = await import('../core/PptExporter')

describe('그림 보정 — 값', () => {
  it('기본값과 같은 항목은 빼고, 남는 게 없으면 null', () => {
    expect(normalizeFx(FX_DEFAULTS)).toBeNull()
    expect(normalizeFx({ brightness: 120, contrast: 100 })).toEqual({ brightness: 120 })
    expect(normalizeFx({ brightness: 999, warmth: -300, blur: 7.4 })).toEqual({ brightness: 200, warmth: -100, blur: 7 })
    expect(normalizeFx(null)).toBeNull()
    expect(fullFx({ vignette: 30 })).toEqual({ ...FX_DEFAULTS, vignette: 30 })
  })

  it('밝기·대비·채도·흐림 → CSS filter', () => {
    expect(fxFilterCss({ brightness: 110, contrast: 90, saturation: 130, blur: 3 })).toBe('brightness(1.1) contrast(0.9) saturate(1.3) blur(3px)')
    expect(fxFilterCss({ warmth: 40 })).toBe('')
  })

  it('색온도는 따뜻하면 주황·차가우면 파랑 레이어(soft-light), 비네팅은 원형 그라디언트', () => {
    expect(warmthTint({ warmth: 100 })).toBe('rgba(255, 150, 50, 0.55)')
    expect(warmthTint({ warmth: -50 })).toBe('rgba(60, 130, 255, 0.275)')
    expect(vignetteGradient({ vignette: 100 })).toBe('radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0.85) 100%)')
    const layers = fxOverlayStyles({ warmth: 20, vignette: 40 })
    expect(layers).toHaveLength(2)
    expect(layers[0].mixBlendMode).toBe('soft-light')
    expect(fxOverlayStyles({ brightness: 120 })).toEqual([])
  })
})

describe('HTML 규약', () => {
  it('data-img-fx 왕복', () => {
    const fx = { brightness: 110, warmth: -20, vignette: 35 }
    expect(fxToAttr(fx)).toBe('brightness:110;warmth:-20;vignette:35')
    expect(parseFxAttr('brightness:110;warmth:-20;vignette:35')).toEqual(fx)
    expect(parseFxAttr('bogus:3;brightness:abc')).toBeNull()
    expect(fxToAttr(null)).toBe('')
  })
  it('CSS filter에서도 밝기·대비·채도·흐림을 읽는다', () => {
    expect(fxFromCssFilter('brightness(1.2) contrast(90%) saturate(1.5) blur(4px)')).toEqual({ brightness: 120, contrast: 90, saturation: 150, blur: 4 })
    expect(fxFromCssFilter('none')).toBeNull()
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

describe('가져오기·내보내기', () => {
  let orig
  beforeEach(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = fakeRect })
  afterEach(() => { Element.prototype.getBoundingClientRect = orig })
  const extract = (body) => {
    const { html } = prepareHtmlForEditor(`<!DOCTYPE html><html><body>${body}</body></html>`)
    const doc = document.implementation.createHTMLDocument('')
    doc.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML
    return extractFlatElements(doc, window).elements
  }

  it('래퍼에 단 data-img-fx를 이미지 요소의 imageFx로', () => {
    const els = extract(`<div data-img-fx="brightness:115;vignette:40" style="position:absolute;left:100px;top:100px;width:800px;height:450px;overflow:hidden;border-radius:12px;">
      <img src="x.png" alt="" style="width:800px;height:450px;border-radius:12px;" /></div>`)
    expect(els.find(e => e.type === 'image')?.imageFx).toEqual({ brightness: 115, vignette: 40 })
  })

  it('내보내면 data-img-fx와 img의 CSS filter가 남는다', () => {
    const out = exportFlatHtmlAllPages({ '0-0': { canvasSize: { w: 1920, h: 1080 }, elements: [{
      id: 'flat-1', type: 'image', content: 'x.png', x: 0, y: 0, width: 800, height: 450, zIndex: 1, styles: { objectFit: 'cover' },
      imageFx: { brightness: 110, warmth: 30 } }] } })
    expect(out).toContain('data-img-fx="brightness:110;warmth:30"')
    expect(out).toContain('filter:brightness(1.1);')
  })
})

describe('PPTX', () => {
  async function run(elements) {
    const PptxGenJS = (await import('pptxgenjs')).default
    const seen = []
    const orig = PptxGenJS.prototype.addSlide
    PptxGenJS.prototype.addSlide = function () { const s = orig.call(this); seen.push(s); return s }
    await exportToPptx({ '0-0': { elements, canvasSize: { w: 1280, h: 720 } } }, { w: 1280, h: 720 }, { filename: 'x.pptx' })
    PptxGenJS.prototype.addSlide = orig
    return seen[0]._items
  }

  it('url 배경 그림 도형은 그림으로 깐다(전에는 빠졌다)', async () => {
    const items = await run([{ id: 'bg', type: 'shape', content: '', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
      styles: { backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'url("data:image/png;base64,iVBORw0KGgo=")', backgroundSize: 'cover' } }])
    const img = items.find(i => i.type === 'image')
    expect(img?.opts.data).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(img.opts.sizing.type).toBe('cover')
    expect(items.some(i => i.type === 'shape')).toBe(false)
  })

  it('캔버스가 없는 환경에서는 보정 굽기를 건너뛰고 원본을 쓴다', async () => {
    expect(await bakeFxToDataUrl('data:image/png;base64,AAAA', { brightness: 120 })).toBe('data:image/png;base64,AAAA')
  })
})
