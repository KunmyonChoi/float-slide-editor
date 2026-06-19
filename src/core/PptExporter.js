/**
 * PptExporter — PPTX 내보내기 (pptxgenjs, lazy import)
 */
import { htmlToTextRuns, cssColorToHex, applyTextTransform } from './HtmlToTextRuns'
import { parseGradient } from './GradientParser'
import { cssColorToRgba } from './CssColor'
import { BlobStore } from './BlobStore'

// px → inches (96 DPI 기준)
const PX_TO_INCH = 1 / 96

/** nowrap 텍스트 박스에 더할 폭 여유(px) — exporter.py _nowrap_buffer_px 미러 */
function nowrapBufferPx(s) {
  const fs = parseFloat(s.fontSize) || 16
  return Math.max(8, fs * 0.6)
}

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

  // 텍스트 정렬
  const align = s.textAlign === 'center' ? 'center' : (s.textAlign === 'right' ? 'right' : 'left')

  // nowrap 텍스트(FlatExtractor 단일행 판정): PowerPoint 폰트가 브라우저보다 살짝 넓어
  // 빠듯한 박스가 줄바꿈되는 사례 방지 — 박스를 여유분만큼 넓히고(정렬 보정) 줄바꿈을 끈다.
  // (배경/테두리는 원래 박스 기준이므로 텍스트 박스 좌표만 확장한다)
  const noWrap = s.whiteSpace === 'nowrap'
  let tx = pos.x, tw = pos.w
  if (noWrap) {
    const buf = nowrapBufferPx(s) * PX_TO_INCH
    if (align === 'center') tx -= buf / 2
    else if (align === 'right') tx -= buf
    tw += buf
  }

  const textOpts = {
    x: tx, y: pos.y, w: tw, h: pos.h,
    valign,
    align,
    wrap: !noWrap,
    shrinkText: false,
    margin: [0, 0, 0, 0],
  }

  if (pos.rotate) textOpts.rotate = pos.rotate

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
  const bgImage = s.backgroundImage || 'none'
  // 복잡 배경(radial/repeating/다층)은 단순 그라데이션 경로 대신 SVG→PNG 래스터화
  const complexBg = isComplexBg(bgImage)
  const hasGradient = !complexBg && bgImage !== 'none' &&
    parseGradient(bgImage).type !== 'none'
  const solidFill = parseSolidFill(s)

  // 복잡 배경 → 그림으로 그려 도형 뒤(먼저)에 배치
  if (complexBg) {
    try {
      const pngData = await cssBgToPng(bgImage, el.width, el.height, s.backgroundColor)
      if (pngData) {
        slide.addImage({
          data: pngData,
          x: pos.x, y: pos.y, w: pos.w, h: pos.h,
          ...(pos.rotate ? { rotate: pos.rotate } : {}),
        })
      }
    } catch { /* 실패 시 무시(테두리/부분채움은 아래 계속) */ }
    // 테두리/부분채움이 없으면 그림만으로 충분
    const sidePresent2 = (v) => v && v !== 'none' && !v.startsWith('0px')
    const anyBorder = border || [s.borderTop, s.borderRight, s.borderBottom, s.borderLeft].some(sidePresent2)
    if (!anyBorder && el.fillRatio == null) return
  }

  if (!complexBg && !hasGradient && !solidFill && !border && !shadow && el.fillRatio == null) return

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

  // 부분 채우기(진행률/악센트) — 트랙 위에 N% 솔리드 사각형 (exporter.py _add_partial_fill 미러)
  if (el.fillRatio != null) addPartialFill(slide, el, pos)
}

/** fillRatio/fillDir/fillColor → 네이티브 솔리드 사각형(부분 채움) */
function addPartialFill(slide, el, pos) {
  const ratio = Math.max(0, Math.min(1, Number(el.fillRatio) || 0))
  if (ratio <= 0) return
  const s = el.styles || {}
  const dir = el.fillDir || 'left'
  const rgba = cssColorToRgba(el.fillColor)
  const color = (rgba && rgba.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')) || parseSolidFill(s)?.color || '4F46E5'
  let { x, y, w, h } = pos
  if (dir === 'left' || dir === 'right') {
    const fw = w * ratio
    x = dir === 'right' ? x + (w - fw) : x
    w = fw
  } else { // top/bottom
    const fh = h * ratio
    y = dir === 'bottom' ? y + (h - fh) : y
    h = fh
  }
  const opts = { x, y, w, h, fill: { color } }
  if (rgba && rgba[3] < 1) opts.transparency = Math.round((1 - rgba[3]) * 100)
  if (pos.rotate) opts.rotate = pos.rotate
  if (s.borderRadius && s.borderRadius !== '0px') {
    const isCircle = s.borderRadius === '50%' || s.borderRadius === '9999px'
    opts.rectRadius = isCircle ? Math.min(w, h) / 2 : Math.round(parseFloat(s.borderRadius) * PX_TO_INCH * 100) / 100
  }
  slide.addShape('rect', opts)
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

// ── 복잡 CSS 배경 래스터화(radial/repeating/다층) — exporter.py 미러 ──
// python-pptx 백엔드와 동일하게, 네이티브로 표현 못 하는 배경을 SVG→PNG로 그려 넣는다.

/** 괄호 깊이를 고려한 top-level 콤마 분리 */
function splitTop(s, sep = ',') {
  const out = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === sep && depth === 0) { out.push(cur); cur = '' }
    else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(x => x.trim())
}

/** 네이티브 fill로 표현 못 하는 배경(radial/repeating/conic/다층)인지 */
function isComplexBg(bg) {
  if (!bg || bg === 'none') return false
  if (bg.includes('radial-gradient') || bg.includes('repeating-') || bg.includes('conic-gradient')) return true
  return splitTop(bg).length >= 2
}

function maxPx(items) {
  const pxs = (items.join(' ').match(/([\d.]+)px/g) || []).map(x => parseFloat(x))
  return pxs.length ? Math.max(...pxs) : 0
}

/** ['color [pos]', ...] → [[rgba, frac]] (px는 lengthPx 기준 비율) */
function parseRasterStops(items, lengthPx) {
  const stops = []
  for (const a of items) {
    const m = a.match(/\s*((?:rgba?|oklch|oklab|hsla?)\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+)\s*(.*)$/)
    if (!m) continue
    const rgba = cssColorToRgba(m[1])
    if (!rgba) continue
    const positions = m[2].trim() ? m[2].trim().split(/\s+/) : [null]
    for (const pos of positions) {
      let frac = null
      if (pos) {
        if (pos.endsWith('%')) frac = parseFloat(pos) / 100
        else if (pos.endsWith('px')) frac = lengthPx ? parseFloat(pos) / lengthPx : 0
        else { const f = parseFloat(pos); frac = Number.isNaN(f) ? null : f }
      }
      stops.push([rgba, frac])
    }
  }
  const n = stops.length
  stops.forEach((st, i) => {
    if (st[1] === null) st[1] = i === 0 ? 0 : (i === n - 1 ? 1 : i / (n - 1))
  })
  let last = 0
  for (const st of stops) { st[1] = Math.max(0, Math.min(1, Math.max(st[1], last))); last = st[1] }
  return stops
}

function svgStopsXml(stops) {
  return stops.map(([rgba, frac]) =>
    `<stop offset="${frac.toFixed(4)}" stop-color="rgb(${rgba[0]},${rgba[1]},${rgba[2]})" stop-opacity="${rgba[3].toFixed(3)}"/>`
  ).join('')
}

/** CSS 그라데이션 레이어 1개 → { defs, rect } | null */
function layerToSvg(layer, idx, w, h) {
  const m = layer.match(/(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)\s*$/)
  if (!m) return null
  const repeating = !!m[1], kind = m[2], inner = m[3]
  const parts = splitTop(inner)
  if (!parts.length) return null
  const gid = `g${idx}`
  const head = parts[0].trim()
  const hasDir = /^(to\s|-?[\d.]+deg|circle|ellipse|closest|farthest|at\s)/i.test(head)
  const stopItems = hasDir ? parts.slice(1) : parts
  const spread = repeating ? ' spreadMethod="repeat"' : ''
  let defs
  if (kind === 'linear') {
    let ang = 180
    const md = head.match(/(-?[\d.]+)deg/)
    if (md) ang = parseFloat(md[1])
    else if (head.includes('to right')) ang = 90
    else if (head.includes('to left')) ang = 270
    else if (head.includes('to top')) ang = 0
    const rad = ang * Math.PI / 180
    const dx = Math.sin(rad), dy = -Math.cos(rad)
    const cx = w / 2, cy = h / 2
    const extent = Math.abs(dx) * w + Math.abs(dy) * h
    let x1, y1, x2, y2, stops
    if (repeating) {
      const period = maxPx(stopItems) || extent
      stops = parseRasterStops(stopItems, period)
      x1 = cx; y1 = cy; x2 = cx + dx * period; y2 = cy + dy * period
    } else {
      stops = parseRasterStops(stopItems, extent)
      x1 = cx - dx * extent / 2; y1 = cy - dy * extent / 2
      x2 = cx + dx * extent / 2; y2 = cy + dy * extent / 2
    }
    if (stops.length < 2) return null
    defs = `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"${spread}>${svgStopsXml(stops)}</linearGradient>`
  } else {
    let cx = w / 2, cy = h / 2
    const mpct = head.match(/at\s+([\d.]+)%\s+([\d.]+)%/)
    const mpx = head.match(/at\s+([\d.]+)px\s+([\d.]+)px/)
    if (mpct) { cx = parseFloat(mpct[1]) / 100 * w; cy = parseFloat(mpct[2]) / 100 * h }
    else if (mpx) { cx = parseFloat(mpx[1]); cy = parseFloat(mpx[2]) }
    const r = maxPx(stopItems) || (Math.hypot(w, h) * 0.6)
    const stops = parseRasterStops(stopItems, r)
    if (stops.length < 2) return null
    defs = `<radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}" fx="${cx.toFixed(2)}" fy="${cy.toFixed(2)}"${spread}>${svgStopsXml(stops)}</radialGradient>`
  }
  const rect = `<rect x="0" y="0" width="${w}" height="${h}" fill="url(#${gid})"/>`
  return { defs, rect }
}

/** 복잡 CSS 배경 → PNG data URL. baseColor는 맨 아래 솔리드. 실패 시 null */
async function cssBgToPng(bg, wPx, hPx, baseColor) {
  const w = Math.max(1, Math.round(wPx)), h = Math.max(1, Math.round(hPx))
  const layers = splitTop(bg)
  let defs = '', rects = ''
  if (baseColor) {
    const b = cssColorToRgba(baseColor)
    if (b && b[3] > 0) rects += `<rect x="0" y="0" width="${w}" height="${h}" fill="rgb(${b[0]},${b[1]},${b[2]})" fill-opacity="${b[3].toFixed(3)}"/>`
  }
  // CSS 첫 레이어 = 맨 위 → SVG는 나중에 그린 게 위 → 역순
  layers.slice().reverse().forEach((layer, i) => {
    const res = layerToSvg(layer, i, w, h)
    if (res) { defs += res.defs; rects += res.rect }
  })
  if (!rects) return null
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${rects}</svg>`
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  return svgToPngDataUrl(dataUrl, w, h)
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
