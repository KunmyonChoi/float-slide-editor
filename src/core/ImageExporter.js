/**
 * ImageExporter — 캔버스를 PNG/JPEG 이미지로 내보내기
 * dom-to-image-more 사용 (lazy import)
 */

let _cloneSeq = 0 // offscreen 복제본 스코프 id 카운터

/**
 * 캔버스 DOM 노드를 이미지 data URL로 변환
 * @param {HTMLElement} canvasNode - 캡처할 DOM 노드
 * @param {Object} options
 * @param {string} options.format - 'png' | 'jpeg' (기본: 'png')
 * @param {number} options.scale - 스케일 배율 (기본: 2, 레티나 품질)
 * @param {number} options.quality - JPEG 품질 0~1 (기본: 0.92)
 * @returns {Promise<string>} data URL
 */
export async function exportAsImage(canvasNode, { format = 'png', scale = 2, quality = 0.92, offscreen = false } = {}) {
  // 웹폰트 로딩 대기
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready
  }

  // 텍스트 선택 해제 (contentEditable 하이라이트 제거)
  window.getSelection()?.removeAllRanges()

  // offscreen: 살아있는 캔버스를 건드리지 않도록 복제본에서 캡처한다(캡처 중 화면 '움찔' 방지).
  // 임시 스타일/인라인 보정을 복제본에만 스코프해 실제 캔버스는 그대로 유지한다.
  let target = canvasNode
  let cloneWrap = null
  let scope = '[data-flat-canvas]'
  if (offscreen) {
    const id = `export-clone-${++_cloneSeq}`
    cloneWrap = document.createElement('div')
    cloneWrap.id = id
    cloneWrap.style.cssText = 'position:fixed;left:-100000px;top:0;margin:0;padding:0;pointer-events:none;'
    cloneWrap.appendChild(canvasNode.cloneNode(true))
    document.body.appendChild(cloneWrap)
    target = cloneWrap.firstElementChild
    scope = `#${id}`
    // 복제된 이미지가 아직 로드 전이면 캡처가 비어버릴 수 있어 로드 완료를 기다린다
    await Promise.all([...target.querySelectorAll('img')].map(im => im.complete ? null : new Promise(r => { im.onload = im.onerror = r })))
  }

  // 선택 UI 숨기기: outline, 커서 등을 캡처에서 제거하는 임시 스타일 주입(offscreen이면 복제본에만 적용)
  const exportStyle = document.createElement('style')
  exportStyle.setAttribute('data-export-style', 'true')
  exportStyle.textContent = `
    ${scope} * { outline: none !important; caret-color: transparent !important; border-style: none; }
    ${scope} ::selection { background: transparent !important; }
  `
  document.head.appendChild(exportStyle)

  const domtoimage = (await import('dom-to-image-more')).default

  // 캡처 시 의도치 않은 줄바꿈 방지: dom-to-image는 SVG foreignObject로
  // 렌더하는데 letter-spacing·가변폰트의 sub-pixel 차이로, 화면에선 딱 맞던
  // 텍스트가 캡처에서만 소프트 줄바꿈되는 경우가 있다(큰 챕터 번호 "02",
  // 코드 블록의 긴 줄 등). 소프트 줄바꿈만 끄되(명시적 \n·<br>는 유지),
  // 끄면 가로 오버플로가 생기는(=원래 줄바꿈이 필요한) 요소는 그대로 둔다.
  const styleRestore = [] // [el, {prop: origValue}]
  const setTemp = (el, prop, value) => {
    if (!styleRestore.some(([e, m]) => e === el && prop in m)) {
      const entry = styleRestore.find(([e]) => e === el)
      if (entry) entry[1][prop] = el.style[prop]
      else styleRestore.push([el, { [prop]: el.style[prop] }])
    }
    el.style[prop] = value
  }
  target.querySelectorAll('.flat-text').forEach((el) => {
    const cs = window.getComputedStyle(el)
    const ws = cs.whiteSpace
    // 1) 소프트 줄바꿈만 제거(명시적 \n·<br>는 유지). 끄면 가로 오버플로가
    //    생기는(=원래 줄바꿈이 필요한) 요소는 되돌린다.
    if (ws !== 'nowrap' && ws !== 'pre') {
      const orig = el.style.whiteSpace
      el.style.whiteSpace = (ws === 'pre-wrap' || ws === 'pre-line') ? 'pre' : 'nowrap'
      if (el.scrollWidth > el.clientWidth + 1) {
        el.style.whiteSpace = orig
      } else {
        styleRestore.push([el, { whiteSpace: orig }])
      }
    }
    // 2) 배지(배경 있는 flex)의 정렬: dom-to-image가 flex 정렬을 화면과 다르게
    //    렌더해 pill 텍스트가 가운데에서 벗어나는 경우가 있다. 캡처 동안만
    //    center로 고정(화면상 이미 가운데인 tight 박스는 변화 없음).
    const disp = cs.display
    if (disp === 'flex' || disp === 'inline-flex') {
      const bg = cs.backgroundColor
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
        setTemp(el, 'justifyContent', 'center')
        setTemp(el, 'alignItems', 'center')
      }
    }
  })

  const width = target.offsetWidth
  const height = target.offsetHeight

  // data-export-ignore 속성을 가진 노드(선택 오버레이 등)는 캡처에서 제외
  const filter = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.dataset?.exportIgnore === 'true') {
      return false
    }
    return true
  }

  const config = {
    width: width * scale,
    height: height * scale,
    style: {
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    },
    filter,
  }

  try {
    if (format === 'jpeg') {
      return await domtoimage.toJpeg(target, { ...config, quality })
    }
    return await domtoimage.toPng(target, config)
  } finally {
    // 임시 스타일/인라인 보정 복원(offscreen이면 복제본은 곧 제거되므로 복원은 무해).
    exportStyle.remove()
    styleRestore.forEach(([el, props]) => {
      Object.entries(props).forEach(([prop, val]) => { el.style[prop] = val })
    })
    if (cloneWrap) cloneWrap.remove()
  }
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
 * 여러 페이지 이미지(data URL)를 ZIP 한 파일로 묶어 다운로드
 * @param {Array<{ key: string, dataUrl: string }>} results - exportAllPagesAsImages 결과
 * @param {Object} options
 * @param {string} options.zipName - ZIP 파일명 (기본 'slide-images.zip')
 * @param {string} options.format - 'png' | 'jpeg' (확장자 결정)
 */
export async function downloadImagesAsZip(results, { zipName = 'slide-images.zip', format = 'png' } = {}) {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  const pad = String(results.length).length
  results.forEach((r, i) => {
    const base64 = (r.dataUrl.split(',')[1]) || ''
    zip.file(`slide-${String(i + 1).padStart(pad, '0')}.${ext}`, base64, { base64: true })
  })
  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
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
