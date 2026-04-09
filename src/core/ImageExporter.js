/**
 * ImageExporter — 캔버스를 PNG/JPEG 이미지로 내보내기
 * dom-to-image-more 사용 (lazy import)
 */

/**
 * 캔버스 DOM 노드를 이미지 data URL로 변환
 * @param {HTMLElement} canvasNode - 캡처할 DOM 노드
 * @param {Object} options
 * @param {string} options.format - 'png' | 'jpeg' (기본: 'png')
 * @param {number} options.scale - 스케일 배율 (기본: 2, 레티나 품질)
 * @param {number} options.quality - JPEG 품질 0~1 (기본: 0.92)
 * @returns {Promise<string>} data URL
 */
export async function exportAsImage(canvasNode, { format = 'png', scale = 2, quality = 0.92 } = {}) {
  // 웹폰트 로딩 대기
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready
  }

  const domtoimage = (await import('dom-to-image-more')).default

  const width = canvasNode.offsetWidth
  const height = canvasNode.offsetHeight

  const config = {
    width: width * scale,
    height: height * scale,
    style: {
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    },
  }

  if (format === 'jpeg') {
    return domtoimage.toJpeg(canvasNode, { ...config, quality })
  }
  return domtoimage.toPng(canvasNode, config)
}

/**
 * 전체 페이지를 이미지로 내보내기
 * 페이지를 순회하며 캔버스를 캡처한다.
 * @param {HTMLElement} canvasNode - 캡처할 DOM 노드
 * @param {Object} store - useFlatStore 인스턴스 (getState())
 * @param {Object} options - exportAsImage 옵션
 * @returns {Promise<Array<{ key: string, dataUrl: string }>>}
 */
export async function exportAllPagesAsImages(canvasNode, store, options = {}) {
  const { pages, currentPageKey } = store.getAllPages()
  const sortedKeys = Object.keys(pages).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })

  const results = []
  for (const key of sortedKeys) {
    // 페이지 전환
    store._restoreFromCache(key)
    // React 렌더링 대기
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    await new Promise(r => setTimeout(r, 100))
    if (document.fonts?.ready) await document.fonts.ready

    const dataUrl = await exportAsImage(canvasNode, options)
    results.push({ key, dataUrl })
  }

  // 원래 페이지 복원
  store._restoreFromCache(currentPageKey)

  return results
}

/**
 * data URL을 파일로 다운로드
 */
export function downloadImage(dataUrl, filename = 'export.png') {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
