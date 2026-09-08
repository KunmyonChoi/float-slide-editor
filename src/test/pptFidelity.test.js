import { describe, it, expect, vi } from 'vitest'

// pptxgenjs는 무겁고 파일까지 쓰므로 mock — 넘긴 인자를 그대로 들여다본다.
vi.mock('pptxgenjs', () => ({
  default: class MockPptxGenJS {
    constructor() { this.slides = []; this._layouts = {} }
    defineLayout(l) { this._layouts[l.name] = l }
    addSlide() {
      const slide = {
        _items: [],
        addText(runs, opts) { this._items.push({ type: 'text', runs, opts }) },
        addImage(opts) { this._items.push({ type: 'image', opts }) },
        addShape(shape, opts) { this._items.push({ type: 'shape', shape, opts }) },
        addNotes() {},
      }
      this.slides.push(slide)
      return slide
    }
    async writeFile() {}
  },
}))

const { exportToPptx } = await import('../core/PptExporter')

const CS = { w: 1280, h: 720 }
const page = (elements) => ({ '0-0': { elements, canvasSize: CS } })

async function run(elements) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const seen = []
  const orig = PptxGenJS.prototype.addSlide
  PptxGenJS.prototype.addSlide = function () { const s = orig.call(this); seen.push(s); return s }
  await exportToPptx(page(elements), CS, { filename: 'x.pptx' })
  PptxGenJS.prototype.addSlide = orig
  return seen[0]._items
}

const text = (over = {}) => ({
  id: 't', type: 'text', content: 'A', x: 0, y: 0, width: 400, height: 100, zIndex: 1,
  styles: { fontSize: '30px', color: '#ffffff' }, ...over,
})
const shape = (over = {}) => ({
  id: 's', type: 'shape', content: '', x: 0, y: 0, width: 200, height: 100, zIndex: 1,
  styles: { backgroundColor: '#123456' }, ...over,
})

// 이 세 가지는 XML상으로는 멀쩡해 보여서 구조 검증을 통과한다. 실제 뷰어에서만
// 드러나던 것들이라(LibreOffice 렌더로 발견) 회귀 테스트로 못을 박아둔다.
describe('PPT 내보내기 — 뷰어에서만 드러나던 결함', () => {
  it('border-radius가 있으면 roundRect로 나간다 (rect는 반경을 무시한다)', async () => {
    const items = await run([shape({ styles: { backgroundColor: '#123456', borderRadius: '20px' } })])
    const sp = items.find(i => i.type === 'shape')
    expect(sp.shape).toBe('roundRect')
    expect(sp.opts.rectRadius).toBeGreaterThan(0)
  })

  it('반경이 없으면 그대로 rect', async () => {
    const items = await run([shape()])
    expect(items.find(i => i.type === 'shape').shape).toBe('rect')
  })

  it('둥근 텍스트 상자는 shape까지 roundRect로 바꾼다', async () => {
    const items = await run([text({ styles: { fontSize: '20px', borderRadius: '12px', backgroundColor: '#222' } })])
    expect(items.find(i => i.type === 'text').opts.shape).toBe('roundRect')
  })

  it('요소 스타일의 굵기가 rich 텍스트에서도 살아남는다', async () => {
    // <br>이 있으면 isRich 경로를 타는데, 예전엔 여기서 font-weight가 통째로 빠졌다.
    const items = await run([text({
      isRich: true, content: '첫 줄<br>둘째 줄',
      styles: { fontSize: '30px', fontWeight: '900', color: '#ffffff' },
    })])
    const runs = items.find(i => i.type === 'text').runs
    expect(runs.every(r => r.text === '' || r.options.bold)).toBe(true)
  })

  it('<br>은 breakLine 런으로 갈라진다 (\\n을 런 텍스트에 실어 보내지 않는다)', async () => {
    const items = await run([text({ isRich: true, content: '첫 줄<br>둘째 줄' })])
    const runs = items.find(i => i.type === 'text').runs
    expect(runs.some(r => String(r.text).includes('\n'))).toBe(false)
    expect(runs.filter(r => r.options.breakLine).length).toBe(1) // 줄 사이에만, 끝에는 없다
    expect(runs.map(r => r.text).join('')).toBe('첫 줄둘째 줄')
  })

  it('px 단위 line-height를 pt로 환산한다 (fontSize를 다시 곱하지 않는다)', async () => {
    const items = await run([text({ styles: { fontSize: '30px', lineHeight: '43.5px' } })])
    expect(items.find(i => i.type === 'text').opts.lineSpacing).toBe(33) // 43.5px * 0.75
  })

  it('단위 없는 line-height는 배수로 본다', async () => {
    const items = await run([text({ styles: { fontSize: '30px', lineHeight: '1.5' } })])
    expect(items.find(i => i.type === 'text').opts.lineSpacing).toBe(34) // 1.5 * 30px * 0.75
  })
  it('반투명 배경(rgba)의 알파가 fill transparency로 살아남는다', async () => {
    // rgba(255,255,255,0.07) 카드가 불투명 흰 덩어리로 나가 그 위 흰 글씨가 사라졌다.
    const items = await run([shape({ styles: { backgroundColor: 'rgba(255, 255, 255, 0.07)' } })])
    const fill = items.find(i => i.type === 'shape').opts.fill
    expect(fill.color.toUpperCase()).toBe('FFFFFF')
    expect(fill.transparency).toBe(93)
  })

  it('요소 opacity와 색 알파가 함께 곱해진다', async () => {
    const items = await run([shape({ styles: { backgroundColor: 'rgba(0, 0, 0, 0.5)', opacity: '0.5' } })])
    expect(items.find(i => i.type === 'shape').opts.fill.transparency).toBe(75)
  })

  it('테두리는 border가 아니라 line 옵션으로 나간다 (pptxgenjs가 border를 무시한다)', async () => {
    const items = await run([shape({ styles: { backgroundColor: '#111', border: '1px solid rgba(255, 255, 255, 0.15)' } })])
    const opts = items.find(i => i.type === 'shape').opts
    expect(opts.border).toBeUndefined()
    expect(opts.line.color.toUpperCase()).toBe('FFFFFF')
    expect(opts.line.transparency).toBe(85)
    expect(opts.line.width).toBeGreaterThan(0)
  })
})
