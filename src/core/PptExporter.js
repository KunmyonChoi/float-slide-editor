/**
 * PptExporter — PPTX 내보내기 (pptxgenjs, lazy import)
 */
import { htmlToTextRuns, cssColorToHex, applyTextTransform } from './HtmlToTextRuns'
import { parseGradient } from './GradientParser'
import { BlobStore } from './BlobStore'

// px → inches (96 DPI 기준)
const PX_TO_INCH = 1 / 96

// 콘텐츠(content)를 base64 data URL로 해석 — data:는 그대로, idb://는 BlobStore에서, http(s)는 fetch.
async function contentToDataUrl(content) {
  if (!content) return null
  if (content.startsWith('data:')) return content
  if (BlobStore.isIdbRef && BlobStore.isIdbRef(content)) {
    try {
      const blob = await BlobStore.get(BlobStore.parseRef(content))
      return blob ? await blobToDataUrl(blob) : null
    } catch { return null }
  }
  try {
    const resp = await fetch(content)
    return await blobToDataUrl(await resp.blob())
  } catch { return null }
}

/**
 * 모든 페이지를 PPTX로 내보내고 다운로드
 * @param {Object} pages - { [pageKey]: { elements, canvasSize, fontImports } }
 * @param {Object} defaultCanvasSize - 기본 캔버스 크기
 */
export async function exportToPptx(pages, defaultCanvasSize, { editorVersion = '' } = {}) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

  // 파일 메타정보에 에디터/변환기 버전 기록 (변환기=pptxgenjs 폴백)
  pptx.author = 'Genitor'
  pptx.company = 'Genitor'
  pptx.subject = `editor=${editorVersion || 'unknown'}; converter=pptxgenjs`

  // 슬라이드 크기 설정 (첫 페이지의 canvasSize 기준)
  const firstPage = Object.values(pages)[0]
  const cs = firstPage?.canvasSize || defaultCanvasSize
  const slideW = cs.w * PX_TO_INCH
  const slideH = cs.h * PX_TO_INCH
  pptx.defineLayout({ name: 'CUSTOM', width: slideW, height: slideH })
  pptx.layout = 'CUSTOM'

  // 페이지 키 정렬 (숫자 순)
  const sortedKeys = Object.keys(pages).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })

  for (const key of sortedKeys) {
    const page = pages[key]
    const pageCs = page.canvasSize || cs
    const slide = pptx.addSlide()
    const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex)

    for (const el of elements) {
      try {
        await addElementToSlide(slide, el, pageCs)
      } catch (e) {
        console.warn(`PPT export: element ${el.id} skipped:`, e.message)
      }
    }
  }

  const filename = `slide-export.pptx`
  await pptx.writeFile({ fileName: filename })
}

async function addElementToSlide(slide, el, canvasSize) {
  const x = el.x * PX_TO_INCH
  const y = el.y * PX_TO_INCH
  let w = el.width * PX_TO_INCH
  const h = el.height * PX_TO_INCH
  const rotate = el.rotation || 0

  const s = el.styles || {}

  switch (el.type) {
    case 'text':
      await addText(slide, el, { x, y, w, h, rotate })
      break
    case 'image':
      await addImage(slide, el, { x, y, w, h, rotate })
      break
    case 'shape':
      await addShape(slide, el, { x, y, w, h, rotate })
      break
    case 'svg':
      await addSvg(slide, el, { x, y, w, h, rotate })
      break
    case 'video':
      await addVideo(slide, el, { x, y, w, h, rotate })
      break
    case 'table':
      addTable(slide, el, { x, y, w, h, rotate })
      break
  }
}

/** 표 → pptxgenjs 네이티브 표 (편집 가능) */
function addTable(slide, el, pos) {
  const t = el.table
  if (!t || !t.cells || t.cells.length === 0) return
  const s = el.styles || {}
  const fontSizePt = s.fontSize ? Math.round(parseFloat(s.fontSize) * 0.75) : 11
  const bodyColor = cssColorToHex(s.color) || '334155'
  const headerBg = 'F1F5F9'
  const headerColor = '0F172A'
  const bw = (t.border && t.border.width) ?? 1
  const bc = cssColorToHex((t.border && t.border.color) || '#cbd5e1') || 'CBD5E1'
  const border = bw > 0 ? { type: 'solid', pt: Math.max(0.5, bw * 0.75), color: bc } : { type: 'none' }

  const rows = t.cells.map((row, r) => {
    const out = []
    row.forEach((cell, c) => {
      if (cell.covered) return // 병합으로 가려진 셀은 생략
      const isHeader = t.headerRow && r === 0
      const cellFs = cell.fontSize ? Math.round(parseFloat(cell.fontSize) * 0.75) : fontSizePt
      const cellColor = cell.color ? (cssColorToHex(cell.color) || bodyColor) : (isHeader ? headerColor : bodyColor)
      const cellBold = cell.fontWeight != null ? (String(cell.fontWeight) === '700' || Number(cell.fontWeight) >= 600) : isHeader
      const cellFill = cell.bg ? { color: cssColorToHex(cell.bg) || 'FFFFFF' }
        : (isHeader ? { color: headerBg } : undefined)
      const cellBorder = cell.border
        ? (cell.border.width > 0
          ? { type: 'solid', pt: Math.max(0.5, (cell.border.width || 1) * 0.75), color: cssColorToHex(cell.border.color || '#cbd5e1') || 'CBD5E1' }
          : { type: 'none' })
        : border
      const options = {
        fontSize: cellFs,
        color: cellColor,
        bold: cellBold,
        align: cell.align || 'left',
        valign: cell.valign || 'middle',
        fill: cellFill,
        border: cellBorder,
      }
      if (cell.colSpan > 1) options.colspan = cell.colSpan
      if (cell.rowSpan > 1) options.rowspan = cell.rowSpan
      out.push({ text: cell.text || '', options })
    })
    return out
  })

  const total = t.colFractions.reduce((a, b) => a + b, 0) || 1
  const colW = t.colFractions.map(f => (f / total) * pos.w)
  const rowTotal = t.rowFractions.reduce((a, b) => a + b, 0) || 1
  const rowH = t.rowFractions.map(f => (f / rowTotal) * pos.h)

  slide.addTable(rows, {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    colW, rowH,
    fontFace: 'Arial',
    border,
    valign: 'middle',
  })
}

/**
 * htmlToTextRuns 결과(평면 런 + '\n')를 리스트 문단 구조로 변환.
 * pptxgenjs는 런별 bullet/indentLevel/breakLine으로 문단 글머리를 표현하므로
 * '\n'을 줄 단위로 풀어 각 줄의 첫 런에 bullet을, 끝 런에 breakLine을 부여한다.
 * (listType이 하나라도 있을 때만 호출 — 일반 리치 텍스트는 그대로 둠)
 */
function applyListStructure(textRuns) {
  const lines = [[]]
  for (const run of textRuns) {
    const parts = String(run.text ?? '').split('\n')
    parts.forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part !== '') lines[lines.length - 1].push({ text: part, options: { ...run.options } })
    })
  }
  const out = []
  for (const lineRuns of lines) {
    if (lineRuns.length === 0) {
      out.push({ text: '', options: { breakLine: true } })
      continue
    }
    let listType = null
    let listLevel = 0
    for (const r of lineRuns) {
      if (r.options.listType) { listType = r.options.listType; listLevel = r.options.listLevel || 0; break }
    }
    lineRuns.forEach((r, ri) => {
      delete r.options.listType
      delete r.options.listLevel
      if (ri === 0 && listType) {
        r.options.bullet = listType === 'ol' ? { type: 'number' } : true
        if (listLevel > 0) r.options.indentLevel = listLevel
      }
      if (ri === lineRuns.length - 1) r.options.breakLine = true
      out.push(r)
    })
  }
  return out
}

async function addText(slide, el, pos) {
  const s = el.styles || {}

  // 그라데이션 텍스트 감지: background-clip: text + gradient background
  const isGradientText = (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') &&
    s.backgroundImage && s.backgroundImage !== 'none'

  // 그라데이션 텍스트의 실제 표시 색상 결정
  let effectiveColor = s.color
  if (isGradientText) {
    const grad = parseGradient(s.backgroundImage)
    if (grad.stops.length > 0) {
      effectiveColor = grad.stops[0].color
    }
  }
  // webkitTextFillColor가 transparent면 그라데이션 텍스트
  if (s.webkitTextFillColor === 'transparent' || s.webkitTextFillColor === 'rgba(0, 0, 0, 0)') {
    if (!isGradientText) effectiveColor = s.color
  }

  let textRuns
  if (el.isRich && el.content) {
    textRuns = htmlToTextRuns(el.content, { ...s, color: effectiveColor })
    if (textRuns.some(r => r.options && r.options.listType)) {
      textRuns = applyListStructure(textRuns)
    }
  } else {
    const opts = {}
    if (effectiveColor) opts.color = cssColorToHex(effectiveColor)
    if (s.fontSize) opts.fontSize = Math.round(parseFloat(s.fontSize) * 0.75)
    if (s.fontFamily) opts.fontFace = s.fontFamily.split(',')[0].trim().replace(/['"]/g, '')
    if (s.fontWeight && (s.fontWeight === 'bold' || parseInt(s.fontWeight) >= 700)) opts.bold = true
    if (s.fontStyle === 'italic') opts.italic = true
    textRuns = [{ text: applyTextTransform(el.content || '', s.textTransform), options: opts }]
  }

  // 수직 정렬: 편집기와 동일하게 alignItems를 항상 반영(미설정=위).
  // 기존엔 merged/배경 있을 때만 반영해, 배경 없는 가운데정렬 텍스트가 위로 붙어 어긋났음.
  const ai = s.alignItems || (s.isFlex ? 'center' : undefined)
  let valign = 'top'
  if (ai === 'center') valign = 'middle'
  else if (ai === 'flex-end') valign = 'bottom'

  const textOpts = {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    valign,
    wrap: true,
    shrinkText: false,
    margin: [0, 0, 0, 0],
  }

  if (pos.rotate) textOpts.rotate = pos.rotate

  // 텍스트 정렬
  if (s.textAlign === 'center') textOpts.align = 'center'
  else if (s.textAlign === 'right') textOpts.align = 'right'
  else textOpts.align = 'left'

  // 배경: 그라데이션이면 PNG로 래스터화해 텍스트 뒤(먼저 추가)에 배치하고,
  // 아니면 solid fill. (pptxgenjs 텍스트 fill은 solid만 지원하므로 그라데이션은 이미지로)
  const hasGradientBg = s.backgroundImage && s.backgroundImage !== 'none' &&
    parseGradient(s.backgroundImage).type !== 'none'
  if (hasGradientBg) {
    try {
      const pngData = await cssGradientToPng(s.backgroundImage, el.width, el.height, s.borderRadius)
      slide.addImage({
        data: pngData,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
    } catch { /* 래스터화 실패 시 아래 solid fill 시도 */ }
  }
  const bgColor = parseSolidFill(s)
  if (bgColor && !hasGradientBg) textOpts.fill = bgColor

  // 테두리
  const border = parseBorder(s)
  if (border) textOpts.border = border

  // 그림자
  const shadow = parseShadow(s.boxShadow)
  if (shadow) textOpts.shadow = shadow

  // 투명도
  if (s.opacity && s.opacity !== '1') {
    textOpts.transparency = Math.round((1 - parseFloat(s.opacity)) * 100)
  }

  // borderRadius
  if (s.borderRadius && s.borderRadius !== '0px') {
    textOpts.rectRadius = Math.round(parseFloat(s.borderRadius) * PX_TO_INCH * 100) / 100
  }

  // padding (multi-value 지원: "16px", "8px 16px", "8px 16px 12px", "8px 16px 12px 24px")
  if (s.padding && s.padding !== '0px') {
    const parts = s.padding.split(/\s+/).map(v => parseFloat(v) * PX_TO_INCH)
    if (parts.length === 1) {
      textOpts.margin = [parts[0], parts[0], parts[0], parts[0]]
    } else if (parts.length === 2) {
      textOpts.margin = [parts[0], parts[1], parts[0], parts[1]] // top/bottom, left/right
    } else if (parts.length === 3) {
      textOpts.margin = [parts[0], parts[1], parts[2], parts[1]] // top, left/right, bottom
    } else {
      textOpts.margin = [parts[0], parts[1], parts[2], parts[3]] // top, right, bottom, left
    }
  }

  // 행간
  if (s.lineHeight) {
    const lh = parseFloat(s.lineHeight)
    if (!isNaN(lh) && lh > 0) {
      // pptxgenjs lineSpacing은 pt 단위 — lineHeight * fontSize
      const fontSize = parseFloat(s.fontSize) || 16
      textOpts.lineSpacing = Math.round(lh * fontSize * 0.75)
    }
  }

  slide.addText(textRuns, textOpts)
}

async function addImage(slide, el, pos) {
  const s = el.styles || {}
  const imgOpts = {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
  }

  if (pos.rotate) imgOpts.rotate = pos.rotate

  // objectFit: 'contain' → sizing: 'contain' (pptxgenjs sizing option)
  if (s.objectFit === 'contain') {
    imgOpts.sizing = { type: 'contain', w: pos.w, h: pos.h }
  } else if (s.objectFit === 'cover') {
    imgOpts.sizing = { type: 'cover', w: pos.w, h: pos.h }
  }

  // 투명도
  if (s.opacity && s.opacity !== '1') {
    imgOpts.transparency = Math.round((1 - parseFloat(s.opacity)) * 100)
  }

  // borderRadius → rounding
  if (s.borderRadius && s.borderRadius !== '0px') {
    imgOpts.rounding = true
  }

  if (el.content && el.content.startsWith('data:image/svg')) {
    imgOpts.data = await svgToPngDataUrl(el.content, el.width, el.height)
  } else {
    // data:/idb://(BlobStore)/http(s) 모두 data URL로 해석
    imgOpts.data = await contentToDataUrl(el.content)
  }

  if (!imgOpts.data) {
    // 해석 실패 시 플레이스홀더
    slide.addText([{ text: `[이미지: ${el.content || ''}]`, options: { fontSize: 10, color: '666666' } }], {
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      fill: { color: 'F0F0F0' },
      border: { pt: 1, color: 'CCCCCC' },
      valign: 'middle', align: 'center',
    })
    return
  }

  slide.addImage(imgOpts)
}

async function addShape(slide, el, pos) {
  const s = el.styles || {}

  const border = parseBorder(s)
  const shadow = parseShadow(s.boxShadow)
  const hasGradient = s.backgroundImage && s.backgroundImage !== 'none' &&
    parseGradient(s.backgroundImage).type !== 'none'
  const solidFill = parseSolidFill(s)

  if (!hasGradient && !solidFill && !border && !shadow) return

  // 부분 테두리(일부 변만 있는 장식, 예: .flow-step::after 꺾인 화살표는
  // border-top+border-right + rotate(45deg))는 pptxgenjs 균일 테두리로 표현하면
  // 사각형 외곽 → 회전 시 다이아몬드가 된다. 채움이 없으면 PNG로 래스터화해 정확히 그린다.
  const sidePresent = (v) => v && v !== 'none' && !v.startsWith('0px')
  const presentSides = [s.borderTop, s.borderRight, s.borderBottom, s.borderLeft].filter(sidePresent).length
  if (!hasGradient && !solidFill && presentSides > 0 && presentSides < 4) {
    try {
      const pngData = await borderBoxToPng(s, el.width, el.height)
      slide.addImage({
        data: pngData,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
      return
    } catch { /* 실패 시 아래 균일 테두리 rect로 폴백 */ }
  }

  // 그라데이션 배경은 pptxgenjs가 지원하지 않으므로 Canvas로 래스터라이즈
  if (hasGradient) {
    try {
      const pngData = await cssGradientToPng(s.backgroundImage, el.width, el.height, s.borderRadius)
      slide.addImage({
        data: pngData,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
    } catch {
      // 래스터라이즈 실패 시 첫 번째 색상으로 대체
      const grad = parseGradient(s.backgroundImage)
      const fallbackColor = grad.stops.length > 0 ? cssColorToHex(grad.stops[0].color) : null
      slide.addShape('rect', {
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        fill: fallbackColor ? { color: fallbackColor } : { type: 'none' },
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
    }
    return
  }

  const shapeOpts = {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    fill: solidFill || { type: 'none' },
  }

  if (pos.rotate) shapeOpts.rotate = pos.rotate
  if (border) shapeOpts.border = border
  if (shadow) shapeOpts.shadow = shadow

  if (s.opacity && s.opacity !== '1') {
    shapeOpts.transparency = Math.round((1 - parseFloat(s.opacity)) * 100)
  }

  const isCircle = s.borderRadius && (s.borderRadius === '50%' || s.borderRadius === '9999px')
  if (isCircle) {
    shapeOpts.rectRadius = Math.min(pos.w, pos.h) / 2
  } else if (s.borderRadius && s.borderRadius !== '0px') {
    shapeOpts.rectRadius = Math.round(parseFloat(s.borderRadius) * PX_TO_INCH * 100) / 100
  }

  slide.addShape('rect', shapeOpts)
}

async function addSvg(slide, el, pos) {
  try {
    const blob = new Blob([el.content], { type: 'image/svg+xml' })
    const dataUrl = await blobToDataUrl(blob)
    const pngData = await svgToPngDataUrl(dataUrl, el.width, el.height)
    slide.addImage({
      data: pngData,
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      ...(pos.rotate ? { rotate: pos.rotate } : {}),
    })
  } catch {
    console.warn('SVG rasterization failed, skipping element')
  }
}

async function addVideo(slide, el, pos) {
  const content = el.content || ''
  const isEmbed = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i.test(content)
  try {
    if (isEmbed) {
      // 유튜브/비메오 등 임베드 → 온라인 비디오 링크
      slide.addMedia({
        type: 'online', link: content,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
      return
    }
    // 파일/idb 영상 → base64로 임베드
    const dataUrl = await contentToDataUrl(content)
    if (dataUrl) {
      slide.addMedia({
        type: 'video', data: dataUrl,
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        ...(pos.rotate ? { rotate: pos.rotate } : {}),
      })
      return
    }
  } catch (e) {
    console.warn('PPT export: 영상 임베드 실패, 플레이스홀더로 대체:', e.message)
  }
  addVideoPlaceholder(slide, el, pos)
}

function addVideoPlaceholder(slide, el, pos) {
  slide.addText([{
    text: `▶ 영상\n${el.content || ''}`,
    options: { fontSize: 10, color: 'FFFFFF' },
  }], {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    fill: { color: '1E293B' },
    border: { pt: 1, color: '475569' },
    valign: 'middle', align: 'center',
    ...(pos.rotate ? { rotate: pos.rotate } : {}),
  })
}

// ── 헬퍼 ──

function parseSolidFill(s) {
  if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
    const hex = cssColorToHex(s.backgroundColor)
    if (hex) return { color: hex }
  }
  return null
}

function parseFill(s) {
  const solid = parseSolidFill(s)
  if (solid) return solid
  if (s.backgroundImage && s.backgroundImage !== 'none') {
    const grad = parseGradient(s.backgroundImage)
    if (grad.type !== 'none' && grad.stops.length >= 2) {
      const hex = cssColorToHex(grad.stops[0].color)
      if (hex) return { color: hex }
    }
  }
  return null
}

function parseBorder(s) {
  // 개별 border 속성 우선 (FlatExporter/FlatElementRenderer와 동일 로직)
  const sides = [s.borderTop, s.borderRight, s.borderBottom, s.borderLeft]
    .filter(v => v && !v.startsWith('0px'))
  if (sides.length > 0) {
    // 가장 두꺼운 border 사용 (pptxgenjs는 균일 border만 지원)
    let maxPt = 0, maxColor = '000000'
    for (const side of sides) {
      const m = side.match(/([\d.]+)px\s+\w+\s+(.+)/)
      if (m) {
        const pt = parseFloat(m[1])
        if (pt > maxPt) {
          maxPt = pt
          maxColor = cssColorToHex(m[2].trim()) || '000000'
        }
      }
    }
    if (maxPt > 0) return { pt: maxPt, color: maxColor }
  }
  // 단축 속성 fallback
  const borderStr = s.border || ''
  if (!borderStr || borderStr.startsWith('0px') || borderStr === 'none') return null
  const m = borderStr.match(/([\d.]+)px\s+\w+\s+(.+)/)
  if (!m) return null
  const hex = cssColorToHex(m[2].trim())
  return { pt: parseFloat(m[1]), color: hex || '000000' }
}

function parseShadow(boxShadow) {
  if (!boxShadow || boxShadow === 'none') return null
  // 첫 번째 shadow만 사용: "4px 4px 8px rgba(0,0,0,0.3)"
  const m = boxShadow.match(/([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+(?:([-\d.]+)px\s+)?(.+)/)
  if (!m) return null
  const offsetX = parseFloat(m[1])
  const offsetY = parseFloat(m[2])
  const blur = parseFloat(m[3])
  const color = cssColorToHex(m[5].trim())
  // pptxgenjs shadow
  const angle = Math.round(Math.atan2(offsetY, offsetX) * 180 / Math.PI)
  const dist = Math.sqrt(offsetX * offsetX + offsetY * offsetY)
  return {
    type: 'outer',
    blur: Math.round(blur * 0.75), // px → pt
    offset: Math.round(dist * 0.75),
    angle: (angle + 360) % 360,
    color: color || '000000',
    opacity: 0.4,
  }
}

/** 일부 변만 있는 테두리(꺾인 화살표 등)를 투명 배경 PNG로 그린다.
 *  각 변을 실제 색·두께로 선으로 그려, 회전은 호출부에서 pptx rotate로 적용한다. */
function borderBoxToPng(s, width, height) {
  return new Promise((resolve, reject) => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const ctx = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height
    const sides = [
      [s.borderTop, [0, 0, W, 0]],
      [s.borderRight, [W, 0, W, H]],
      [s.borderBottom, [0, H, W, H]],
      [s.borderLeft, [0, 0, 0, H]],
    ]
    let drew = false
    for (const [val, [x0, y0, x1, y1]] of sides) {
      if (!val || val === 'none' || val.startsWith('0px')) continue
      const m = val.match(/([\d.]+)px\s+\w+\s+(.+)/)
      if (!m) continue
      const lw = parseFloat(m[1]) * scale
      ctx.strokeStyle = m[2].trim()
      ctx.lineWidth = lw
      // 모서리 선이 캔버스 밖으로 잘리지 않도록 두께의 절반만큼 안쪽으로
      const off = lw / 2
      const adj = (a, edge) => (a === 0 ? off : a === edge ? a - off : a)
      ctx.beginPath()
      ctx.moveTo(adj(x0, W), adj(y0, H))
      ctx.lineTo(adj(x1, W), adj(y1, H))
      ctx.stroke()
      drew = true
    }
    if (!drew) { reject(new Error('no border to draw')); return }
    resolve(canvas.toDataURL('image/png'))
  })
}

function cssGradientToPng(cssGradient, width, height, borderRadius) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const scale = 2
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')

    // borderRadius 클리핑
    const br = borderRadius ? parseFloat(borderRadius) * scale : 0
    if (br > 0) {
      ctx.beginPath()
      ctx.roundRect(0, 0, canvas.width, canvas.height, br)
      ctx.clip()
    }

    const grad = parseGradient(cssGradient)
    if (grad.type === 'linear' && grad.stops.length >= 2) {
      const angle = (grad.angle - 90) * Math.PI / 180
      const cx = canvas.width / 2, cy = canvas.height / 2
      const len = Math.max(canvas.width, canvas.height)
      const x0 = cx - Math.cos(angle) * len, y0 = cy - Math.sin(angle) * len
      const x1 = cx + Math.cos(angle) * len, y1 = cy + Math.sin(angle) * len
      const lg = ctx.createLinearGradient(x0, y0, x1, y1)
      for (const stop of grad.stops) {
        lg.addColorStop(stop.position / 100, stop.color)
      }
      ctx.fillStyle = lg
    } else if (grad.type === 'radial' && grad.stops.length >= 2) {
      const rg = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 0,
        canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2
      )
      for (const stop of grad.stops) {
        rg.addColorStop(stop.position / 100, stop.color)
      }
      ctx.fillStyle = rg
    } else {
      reject(new Error('Unsupported gradient'))
      return
    }

    ctx.fillRect(0, 0, canvas.width, canvas.height)
    resolve(canvas.toDataURL('image/png'))
  })
}

function svgToPngDataUrl(svgDataUrl, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = (width || 200) * 2
      canvas.height = (height || 200) * 2
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('SVG rasterization failed'))
    img.src = svgDataUrl
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Blob 변환 실패'))
    reader.readAsDataURL(blob)
  })
}
