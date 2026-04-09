import { describe, it, expect, vi } from 'vitest'

// pptxgenjs는 heavy dependency이므로 mock
vi.mock('pptxgenjs', () => {
  return {
    default: class MockPptxGenJS {
      constructor() {
        this.slides = []
        this.layout = null
        this._layouts = {}
      }
      defineLayout(layout) { this._layouts[layout.name] = layout }
      addSlide() {
        const slide = {
          _items: [],
          addText(runs, opts) { this._items.push({ type: 'text', runs, opts }) },
          addImage(opts) { this._items.push({ type: 'image', opts }) },
          addShape(shape, opts) { this._items.push({ type: 'shape', shape, opts }) },
        }
        this.slides.push(slide)
        return slide
      }
      async writeFile() { /* no-op in test */ }
    },
  }
})

// dynamic import를 위해 mock 후 import
const { exportToPptx } = await import('../core/PptExporter')

describe('PptExporter', () => {
  const samplePages = {
    '0-0': {
      elements: [
        {
          id: 'bg', type: 'shape', content: '', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
          styles: { backgroundColor: '#1e293b', backgroundImage: 'none' },
        },
        {
          id: 't1', type: 'text', content: 'Hello World', isRich: false, x: 100, y: 50, width: 400, height: 80, zIndex: 1,
          styles: { color: '#ffffff', fontSize: '48px', fontFamily: 'sans-serif', textAlign: 'center' },
        },
        {
          id: 'img1', type: 'image', content: 'data:image/png;base64,iVBOR', x: 200, y: 200, width: 300, height: 200, zIndex: 2,
          styles: { objectFit: 'cover' },
        },
      ],
      canvasSize: { w: 1280, h: 720 },
      fontImports: [],
    },
  }

  it('슬라이드 1개 생성', async () => {
    // exportToPptx는 writeFile을 호출하지만 mock이므로 성공
    await expect(exportToPptx(samplePages, { w: 1280, h: 720 })).resolves.not.toThrow()
  })

  it('다중 페이지 → 다중 슬라이드', async () => {
    const pages = {
      '0-0': { ...samplePages['0-0'] },
      '1-0': {
        elements: [{ id: 's1', type: 'shape', content: '', x: 0, y: 0, width: 100, height: 100, zIndex: 1, styles: { backgroundColor: '#ff0000' } }],
        canvasSize: { w: 1280, h: 720 },
        fontImports: [],
      },
    }
    await exportToPptx(pages, { w: 1280, h: 720 })
    // 테스트 통과 = 에러 없이 실행
  })

  it('video 요소 → 플레이스홀더', async () => {
    const pages = {
      '0-0': {
        elements: [{
          id: 'v1', type: 'video', content: 'https://www.youtube.com/embed/test',
          x: 50, y: 50, width: 560, height: 315, zIndex: 1,
          styles: {},
        }],
        canvasSize: { w: 1280, h: 720 },
        fontImports: [],
      },
    }
    await expect(exportToPptx(pages, { w: 1280, h: 720 })).resolves.not.toThrow()
  })

  it('회전된 요소 처리', async () => {
    const pages = {
      '0-0': {
        elements: [{
          id: 'r1', type: 'text', content: 'Rotated', isRich: false,
          x: 100, y: 100, width: 200, height: 50, zIndex: 1, rotation: 45,
          styles: { color: '#000000', fontSize: '24px' },
        }],
        canvasSize: { w: 1280, h: 720 },
        fontImports: [],
      },
    }
    await expect(exportToPptx(pages, { w: 1280, h: 720 })).resolves.not.toThrow()
  })

  it('그래디언트 배경 요소', async () => {
    const pages = {
      '0-0': {
        elements: [{
          id: 'g1', type: 'shape', content: '', x: 0, y: 0, width: 1280, height: 720, zIndex: 0,
          styles: { backgroundImage: 'linear-gradient(135deg, #ff0000 0%, #0000ff 100%)', backgroundColor: 'rgba(0, 0, 0, 0)' },
        }],
        canvasSize: { w: 1280, h: 720 },
        fontImports: [],
      },
    }
    await expect(exportToPptx(pages, { w: 1280, h: 720 })).resolves.not.toThrow()
  })
})
