/**
 * PdfExporter — 슬라이드를 PDF로 내보내기.
 *
 * 브라우저가 (웹폰트 포함) 정확히 렌더한 화면을 PNG로 캡처해 페이지마다
 * 한 장씩 PDF에 박는다. 래스터 방식이라 폰트 설치·플랫폼과 무관하게
 * 어디서나 동일하게 보인다(PowerPoint for Mac의 임베드 폰트 한계 회피).
 * 대신 텍스트 선택/검색은 불가(보기·배포·인쇄용).
 *
 * 인쇄 크기(mm)를 함께 주면 페이지를 그 물리 크기로 만든다. 주지 않으면 CSS px을
 * 96dpi로 환산하는데, 인쇄물 캔버스에는 그 가정이 맞지 않는다("pageSizePt" 참고).
 */
import { exportAsImage, exportAllPagesAsImages } from './ImageExporter'
import { MM_PER_IN } from './printSize'

const PX_TO_PT = 0.75 // CSS px(1/96in) → PDF pt(1/72in)
const MM_TO_PT = 72 / MM_PER_IN // 1mm = 2.8346pt

/**
 * 페이지 크기(pt)를 정한다.
 *
 * 인쇄 크기(mm)를 알면 그것이 답이다. 모르면 CSS px을 96dpi로 보고 환산한다 —
 * 화면용 덱에는 맞지만 **인쇄물에는 틀린 값**이다. 750mm 포스터를 2250px 캔버스로
 * 만들었을 때 96dpi 환산은 595mm가 되어 79% 크기로 나간다. 인쇄소가 그대로 찍으면
 * 포스터가 작아진다.
 */
function pageSizePt(cs, printMm) {
  if (printMm?.w > 0 && printMm?.h > 0) {
    return { w: printMm.w * MM_TO_PT, h: printMm.h * MM_TO_PT }
  }
  return { w: (cs?.w || 1280) * PX_TO_PT, h: (cs?.h || 720) * PX_TO_PT }
}

function addImagePage(pdf, dataUrl, cs, first, printMm) {
  const { w, h } = pageSizePt(cs, printMm)
  const orientation = w >= h ? 'landscape' : 'portrait'
  if (first) {
    pdf.deletePage(1) // 생성자 기본 페이지 제거 후 정확한 크기로 추가
  }
  pdf.addPage([w, h], orientation)
  pdf.addImage(dataUrl, 'PNG', 0, 0, w, h, undefined, 'FAST')
}

/** 전체 페이지를 PDF로 내보내 다운로드 */
export async function exportToPdf(canvasNode, store, { scale = 2, filename = 'slide-export.pdf', printMm = null } = {}) {
  const images = await exportAllPagesAsImages(canvasNode, store, { format: 'png', scale })
  if (!images.length) throw new Error('내보낼 페이지가 없습니다')

  const { pages } = store.getAllPages()
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' }) // 첫 페이지는 곧 교체됨

  images.forEach(({ key, dataUrl }, i) => {
    addImagePage(pdf, dataUrl, pages[key]?.canvasSize, i === 0, printMm)
  })

  pdf.save(filename)
}

/** 현재 페이지만 PDF로 내보내 다운로드 */
export async function exportCurrentPageToPdf(canvasNode, store, { scale = 2, filename = 'slide-export.pdf', printMm = null } = {}) {
  const dataUrl = await exportAsImage(canvasNode, { format: 'png', scale })
  const cs = store.getState ? store.getState().canvasSize : store.canvasSize
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  addImagePage(pdf, dataUrl, cs, true, printMm)
  pdf.save(filename)
}
