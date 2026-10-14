import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MM_PER_IN } from '../core/printSize'

/**
 * PDF 페이지가 **의도한 물리 크기**로 나가는지.
 *
 * 전에는 CSS px을 96dpi로 환산했다. 화면용 덱에는 맞지만 인쇄물에는 틀린 가정이다 —
 * 750mm 포스터를 2250px 캔버스로 만들면 2250 × 0.75pt = 1687pt = 595mm가 되어
 * 79% 크기로 나갔다. 인쇄소가 그대로 찍으면 포스터가 작아진다.
 */
const pages = []
vi.mock('jspdf', () => ({
  jsPDF: class {
    deletePage() {}
    addPage(size) { pages.push(size) }
    addImage() {}
    save() {}
  },
}))
vi.mock('../core/ImageExporter', () => ({
  exportAsImage: async () => 'data:image/png;base64,AA',
  exportAllPagesAsImages: async () => [{ key: 'p1', dataUrl: 'data:image/png;base64,AA' }],
}))

const MM_TO_PT = 72 / MM_PER_IN
const ptToMm = (pt) => pt / MM_TO_PT

function fakeStore(cs) {
  return { getState: () => ({ canvasSize: cs }), canvasSize: cs, getAllPages: () => ({ pages: { p1: { canvasSize: cs } } }) }
}

beforeEach(() => { pages.length = 0 })

describe('PDF 페이지 물리 크기', () => {
  it('인쇄 크기(mm)를 주면 그 크기로 나간다', async () => {
    const { exportCurrentPageToPdf } = await import('../core/PdfExporter')
    await exportCurrentPageToPdf({}, fakeStore({ w: 2250, h: 3750 }), { printMm: { w: 750, h: 1250 } })
    const [w, h] = pages[0]
    expect(ptToMm(w)).toBeCloseTo(750, 1)
    expect(ptToMm(h)).toBeCloseTo(1250, 1)
  })

  it('주지 않으면 종전대로 96dpi 환산 — 화면용 덱의 동작은 그대로다', async () => {
    const { exportCurrentPageToPdf } = await import('../core/PdfExporter')
    await exportCurrentPageToPdf({}, fakeStore({ w: 1920, h: 1080 }), {})
    expect(pages[0]).toEqual([1440, 810])   // 1920 × 0.75
  })

  it('고치기 전이라면 750mm가 595mm로 나갔다 — 그 값이 다시 나오지 않는다', async () => {
    const { exportCurrentPageToPdf } = await import('../core/PdfExporter')
    await exportCurrentPageToPdf({}, fakeStore({ w: 2250, h: 3750 }), { printMm: { w: 750, h: 1250 } })
    expect(ptToMm(pages[0][0])).not.toBeCloseTo(595, 0)
  })

  it('전체 페이지 내보내기에도 같이 적용된다', async () => {
    const { exportToPdf } = await import('../core/PdfExporter')
    await exportToPdf({}, fakeStore({ w: 2250, h: 3750 }), { printMm: { w: 750, h: 1250 } })
    expect(ptToMm(pages[0][0])).toBeCloseTo(750, 1)
  })

  it('A4는 210×297mm로', async () => {
    const { exportCurrentPageToPdf } = await import('../core/PdfExporter')
    await exportCurrentPageToPdf({}, fakeStore({ w: 630, h: 891 }), { printMm: { w: 210, h: 297 } })
    expect(ptToMm(pages[0][0])).toBeCloseTo(210, 1)
    expect(ptToMm(pages[0][1])).toBeCloseTo(297, 1)
  })
})
