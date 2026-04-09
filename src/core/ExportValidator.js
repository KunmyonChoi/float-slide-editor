/**
 * ExportValidator — 내보내기 라운드트립 비교 + 구조 검증
 */
import { exportFlatHtml, exportFlatHtmlAllPages } from './FlatExporter'
import { serializeProject, deserializeProject } from './ProjectSerializer'

// ── JSON/Project 라운드트립 검증 ──

/**
 * JSON 내보내기 → 파싱 라운드트립 검증
 * @returns {{ pass: boolean, diffs: Array<{elementId, field, expected, actual}> }}
 */
export function validateJsonRoundtrip(elements, canvasSize, fontImports = []) {
  const json = JSON.stringify({ version: 1, elements, canvasSize, fontImports })
  const parsed = JSON.parse(json)
  const diffs = []

  if (parsed.elements.length !== elements.length) {
    diffs.push({ elementId: '*', field: 'elements.length', expected: elements.length, actual: parsed.elements.length })
    return { pass: false, diffs }
  }

  for (let i = 0; i < elements.length; i++) {
    const orig = elements[i]
    const out = parsed.elements[i]
    compareElement(orig, out, diffs)
  }

  // canvasSize
  if (canvasSize.w !== parsed.canvasSize.w) diffs.push({ elementId: '*', field: 'canvasSize.w', expected: canvasSize.w, actual: parsed.canvasSize.w })
  if (canvasSize.h !== parsed.canvasSize.h) diffs.push({ elementId: '*', field: 'canvasSize.h', expected: canvasSize.h, actual: parsed.canvasSize.h })

  // fontImports
  if (fontImports.length !== parsed.fontImports.length) {
    diffs.push({ elementId: '*', field: 'fontImports.length', expected: fontImports.length, actual: parsed.fontImports.length })
  }

  return { pass: diffs.length === 0, diffs }
}

/**
 * Project serialize → deserialize 라운드트립 검증
 * @returns {Promise<{ pass: boolean, diffs: Array }>}
 */
export async function validateProjectRoundtrip(pages, currentPageKey) {
  const mockStore = {
    getAllPagesAsync: async () => ({ pages, currentPageKey }),
    getAllPages: () => ({ pages, currentPageKey }),
  }
  const json = await serializeProject(mockStore)
  const data = deserializeProject(json)
  const diffs = []

  const origKeys = Object.keys(pages).sort()
  const outKeys = Object.keys(data.pages).sort()

  if (origKeys.length !== outKeys.length) {
    diffs.push({ elementId: '*', field: 'pages.count', expected: origKeys.length, actual: outKeys.length })
    return { pass: false, diffs }
  }

  for (const key of origKeys) {
    if (!data.pages[key]) {
      diffs.push({ elementId: '*', field: `pages.${key}`, expected: 'exists', actual: 'missing' })
      continue
    }
    const origPage = pages[key]
    const outPage = data.pages[key]

    if (origPage.elements.length !== outPage.elements.length) {
      diffs.push({ elementId: '*', field: `pages.${key}.elements.length`, expected: origPage.elements.length, actual: outPage.elements.length })
    }

    for (let i = 0; i < Math.min(origPage.elements.length, outPage.elements.length); i++) {
      compareElement(origPage.elements[i], outPage.elements[i], diffs, `page[${key}].`)
    }

    if (origPage.canvasSize.w !== outPage.canvasSize.w || origPage.canvasSize.h !== outPage.canvasSize.h) {
      diffs.push({ elementId: '*', field: `pages.${key}.canvasSize`, expected: origPage.canvasSize, actual: outPage.canvasSize })
    }
  }

  if (data.currentPageKey !== currentPageKey) {
    diffs.push({ elementId: '*', field: 'currentPageKey', expected: currentPageKey, actual: data.currentPageKey })
  }

  return { pass: diffs.length === 0, diffs }
}

// ── HTML 구조 검증 ──

/**
 * HTML 내보내기 결과의 구조적 정확성 검증
 * @returns {{ pass: boolean, issues: Array<{type, message, elementId?}> }}
 */
export function validateHtmlExport(elements, canvasSize, fontImports = []) {
  const html = exportFlatHtml(elements, canvasSize, fontImports)
  const issues = []

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body

  // body 크기
  const bodyStyle = body.getAttribute('style') || ''
  if (!bodyStyle.includes(`width:${canvasSize.w}px`)) {
    issues.push({ type: 'canvas', message: `body width mismatch, expected ${canvasSize.w}px` })
  }
  if (!bodyStyle.includes(`height:${canvasSize.h}px`)) {
    issues.push({ type: 'canvas', message: `body height mismatch, expected ${canvasSize.h}px` })
  }

  // 요소 개수: body 직접 자식 중 position:absolute인 것
  const divs = Array.from(body.children).filter(el => {
    const s = el.getAttribute('style') || ''
    return s.includes('position:absolute')
  })

  if (divs.length !== elements.length) {
    issues.push({ type: 'count', message: `Element count: expected ${elements.length}, got ${divs.length}` })
  }

  // 각 요소의 position/size 검증
  for (let i = 0; i < Math.min(divs.length, elements.length); i++) {
    const el = elements[i]
    const div = divs[i]
    const style = div.getAttribute('style') || ''

    // position
    const leftMatch = style.match(/left:([\d.]+)px/)
    const topMatch = style.match(/top:([\d.]+)px/)
    const widthMatch = style.match(/width:([\d.]+)px/)
    const heightMatch = style.match(/height:([\d.]+)px/)

    if (leftMatch) {
      const actual = parseFloat(leftMatch[1])
      const expected = Math.round(el.x * 10) / 10
      if (Math.abs(actual - expected) > 0.5) {
        issues.push({ type: 'position', elementId: el.id, message: `x: expected ${expected}, got ${actual}` })
      }
    }
    if (topMatch) {
      const actual = parseFloat(topMatch[1])
      const expected = Math.round(el.y * 10) / 10
      if (Math.abs(actual - expected) > 0.5) {
        issues.push({ type: 'position', elementId: el.id, message: `y: expected ${expected}, got ${actual}` })
      }
    }
    if (widthMatch) {
      const actual = parseFloat(widthMatch[1])
      const expected = Math.round(el.width * 10) / 10
      if (Math.abs(actual - expected) > 0.5) {
        issues.push({ type: 'size', elementId: el.id, message: `width: expected ${expected}, got ${actual}` })
      }
    }
    if (heightMatch) {
      const actual = parseFloat(heightMatch[1])
      const expected = Math.round(el.height * 10) / 10
      if (Math.abs(actual - expected) > 0.5) {
        issues.push({ type: 'size', elementId: el.id, message: `height: expected ${expected}, got ${actual}` })
      }
    }

    // 텍스트 콘텐츠 보존
    if (el.type === 'text' && !el.isRich) {
      const text = div.textContent.trim()
      if (text !== (el.content || '').trim()) {
        issues.push({ type: 'content', elementId: el.id, message: `text: expected "${el.content}", got "${text}"` })
      }
    }

    // 이미지 src 보존
    if (el.type === 'image') {
      const img = div.querySelector('img')
      if (!img) {
        issues.push({ type: 'content', elementId: el.id, message: 'missing <img> tag' })
      } else if (img.getAttribute('src') !== el.content) {
        issues.push({ type: 'content', elementId: el.id, message: 'image src mismatch' })
      }
    }

    // SVG 콘텐츠 보존
    if (el.type === 'svg') {
      const svg = div.querySelector('svg')
      if (!svg) {
        issues.push({ type: 'content', elementId: el.id, message: 'missing <svg> tag' })
      }
    }

    // 비디오 iframe 보존
    if (el.type === 'video') {
      const iframe = div.querySelector('iframe')
      if (!iframe) {
        issues.push({ type: 'content', elementId: el.id, message: 'missing <iframe> tag' })
      } else if (iframe.getAttribute('src') !== el.content) {
        issues.push({ type: 'content', elementId: el.id, message: 'video src mismatch' })
      }
    }

    // rotation
    if (el.rotation) {
      if (!style.includes(`rotate(${el.rotation}deg)`)) {
        issues.push({ type: 'style', elementId: el.id, message: `rotation: expected rotate(${el.rotation}deg)` })
      }
    }

    // z-index
    const zMatch = style.match(/z-index:(\d+)/)
    if (zMatch && parseInt(zMatch[1]) !== el.zIndex) {
      issues.push({ type: 'style', elementId: el.id, message: `z-index: expected ${el.zIndex}, got ${zMatch[1]}` })
    }
  }

  // fontImports 검증
  if (fontImports.length > 0) {
    const htmlLower = html.toLowerCase()
    for (const imp of fontImports) {
      const urlMatch = imp.match(/@import\s+url\(['"]?([^'")\s]+)['"]?\)/)
      if (urlMatch) {
        if (!html.includes(urlMatch[1])) {
          issues.push({ type: 'font', message: `font import missing: ${urlMatch[1]}` })
        }
      }
    }
  }

  return { pass: issues.length === 0, issues }
}

/**
 * 전체 페이지 HTML 내보내기 구조 검증
 * @returns {{ pass: boolean, issues: Array }}
 */
export function validateHtmlAllPagesExport(pages) {
  const html = exportFlatHtmlAllPages(pages)
  const issues = []

  const doc = new DOMParser().parseFromString(html, 'text/html')

  const slideCount = Object.keys(pages).length
  const slides = doc.querySelectorAll('.slide')

  if (slides.length !== slideCount) {
    issues.push({ type: 'count', message: `Slide count: expected ${slideCount}, got ${slides.length}` })
  }

  // 첫 슬라이드만 active
  const activeSlides = doc.querySelectorAll('.slide.active')
  if (activeSlides.length !== 1) {
    issues.push({ type: 'state', message: `Active slides: expected 1, got ${activeSlides.length}` })
  }

  // 다중 페이지일 때 네비게이션 존재
  if (slideCount > 1) {
    const nav = doc.getElementById('nav')
    if (!nav) {
      issues.push({ type: 'navigation', message: 'Navigation buttons missing for multi-page export' })
    }
    const counter = doc.getElementById('counter')
    if (!counter) {
      issues.push({ type: 'navigation', message: 'Page counter missing for multi-page export' })
    }
    // 스크립트 존재
    const scripts = doc.querySelectorAll('script')
    const hasNavScript = Array.from(scripts).some(s => s.textContent.includes('nav('))
    if (!hasNavScript) {
      issues.push({ type: 'navigation', message: 'Navigation script missing' })
    }
  }

  // 타이틀에 슬라이드 수 포함
  const title = doc.querySelector('title')?.textContent || ''
  if (!title.includes(`${slideCount} slides`)) {
    issues.push({ type: 'metadata', message: `Title should contain "${slideCount} slides", got "${title}"` })
  }

  return { pass: issues.length === 0, issues }
}

// ── PPT 매핑 검증 (mock 기반) ──

const PX_TO_INCH = 1 / 96

/**
 * PPT 내보내기 매핑 검증 — mock된 pptxgenjs의 slide._items를 검사
 * @param {Array} items - mock slide._items
 * @param {Array} elements - 원본 요소 배열
 * @param {Object} canvasSize
 * @returns {{ pass: boolean, issues: Array }}
 */
export function validatePptMapping(items, elements, canvasSize) {
  const issues = []
  const sortedElements = [...elements].sort((a, b) => a.zIndex - b.zIndex)

  if (items.length !== sortedElements.length) {
    issues.push({ type: 'count', message: `PPT item count: expected ${sortedElements.length}, got ${items.length}` })
    return { pass: false, issues }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const el = sortedElements[i]
    const opts = item.opts || {}

    // 타입 매핑
    const expectedType = el.type === 'text' ? 'text'
      : el.type === 'image' ? 'image'
      : el.type === 'shape' ? 'shape'
      : el.type === 'video' ? 'text'  // placeholder
      : el.type === 'svg' ? 'image'   // svg→image
      : null

    if (item.type !== expectedType) {
      issues.push({ type: 'mapping', elementId: el.id, message: `type: expected ${expectedType}, got ${item.type}` })
    }

    // 좌표 변환 검증 (허용 오차 0.02 inch)
    const expectedX = el.x * PX_TO_INCH
    const expectedY = el.y * PX_TO_INCH
    const expectedW = el.width * PX_TO_INCH
    const expectedH = el.height * PX_TO_INCH
    const tolerance = 0.02

    if (Math.abs((opts.x || 0) - expectedX) > tolerance) {
      issues.push({ type: 'position', elementId: el.id, message: `PPT x: expected ~${expectedX.toFixed(3)}, got ${(opts.x || 0).toFixed(3)}` })
    }
    if (Math.abs((opts.y || 0) - expectedY) > tolerance) {
      issues.push({ type: 'position', elementId: el.id, message: `PPT y: expected ~${expectedY.toFixed(3)}, got ${(opts.y || 0).toFixed(3)}` })
    }
    if (Math.abs((opts.w || 0) - expectedW) > tolerance) {
      issues.push({ type: 'size', elementId: el.id, message: `PPT w: expected ~${expectedW.toFixed(3)}, got ${(opts.w || 0).toFixed(3)}` })
    }
    if (Math.abs((opts.h || 0) - expectedH) > tolerance) {
      issues.push({ type: 'size', elementId: el.id, message: `PPT h: expected ~${expectedH.toFixed(3)}, got ${(opts.h || 0).toFixed(3)}` })
    }

    // 회전
    if (el.rotation && el.rotation !== 0) {
      if (opts.rotate !== el.rotation) {
        issues.push({ type: 'style', elementId: el.id, message: `rotation: expected ${el.rotation}, got ${opts.rotate}` })
      }
    }

    // 텍스트 검증
    if (el.type === 'text' && item.runs) {
      const allText = item.runs.map(r => r.text).join('')
      if (!el.isRich && !allText.includes(el.content || '')) {
        issues.push({ type: 'content', elementId: el.id, message: `text content mismatch` })
      }

      // 서식 검증 (비리치 텍스트)
      if (!el.isRich && item.runs.length === 1) {
        const runOpts = item.runs[0].options || {}
        const s = el.styles || {}

        // fontSize (px → pt)
        if (s.fontSize) {
          const expectedPt = Math.round(parseFloat(s.fontSize) * 0.75)
          if (runOpts.fontSize && runOpts.fontSize !== expectedPt) {
            issues.push({ type: 'style', elementId: el.id, message: `fontSize: expected ${expectedPt}pt, got ${runOpts.fontSize}pt` })
          }
        }

        // bold
        if (s.fontWeight && (s.fontWeight === 'bold' || parseInt(s.fontWeight) >= 700)) {
          if (!runOpts.bold) {
            issues.push({ type: 'style', elementId: el.id, message: `bold: expected true` })
          }
        }
      }
    }

    // 투명도 검증
    if (el.styles?.opacity && el.styles.opacity !== '1') {
      const expectedTransp = Math.round((1 - parseFloat(el.styles.opacity)) * 100)
      if (opts.transparency !== expectedTransp) {
        issues.push({ type: 'style', elementId: el.id, message: `transparency: expected ${expectedTransp}, got ${opts.transparency}` })
      }
    }
  }

  return { pass: issues.length === 0, issues }
}

// ── 내부 헬퍼 ──

function compareElement(orig, out, diffs, prefix = '') {
  const fields = ['id', 'type', 'content', 'x', 'y', 'width', 'height', 'zIndex', 'rotation', 'isRich']
  for (const f of fields) {
    if (orig[f] !== out[f]) {
      diffs.push({ elementId: orig.id, field: `${prefix}${f}`, expected: orig[f], actual: out[f] })
    }
  }
  // styles deep compare
  if (orig.styles && out.styles) {
    for (const key of Object.keys(orig.styles)) {
      if (orig.styles[key] !== out.styles[key]) {
        diffs.push({ elementId: orig.id, field: `${prefix}styles.${key}`, expected: orig.styles[key], actual: out.styles[key] })
      }
    }
  }
}
