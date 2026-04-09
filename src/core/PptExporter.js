/**
 * PptExporter — PPTX 내보내기 (pptxgenjs, lazy import)
 */
import { htmlToTextRuns, cssColorToHex } from './HtmlToTextRuns'
import { parseGradient } from './GradientParser'

// px → inches (96 DPI 기준)
const PX_TO_INCH = 1 / 96

/**
 * 모든 페이지를 PPTX로 내보내고 다운로드
 * @param {Object} pages - { [pageKey]: { elements, canvasSize, fontImports } }
 * @param {Object} defaultCanvasSize - 기본 캔버스 크기
 */
export async function exportToPptx(pages, defaultCanvasSize) {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()

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
    const slide = pptx.addSlide()
    const elements = [...page.elements].sort((a, b) => a.zIndex - b.zIndex)

    for (const el of elements) {
      try {
        await addElementToSlide(slide, el, cs)
      } catch (e) {
        // 개별 요소 실패 시 스킵 (graceful degradation)
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
  const w = el.width * PX_TO_INCH
  const h = el.height * PX_TO_INCH
  const rotate = el.rotation || 0

  const s = el.styles || {}

  switch (el.type) {
    case 'text':
      addText(slide, el, { x, y, w, h, rotate })
      break
    case 'image':
      await addImage(slide, el, { x, y, w, h, rotate })
      break
    case 'shape':
      addShape(slide, el, { x, y, w, h, rotate })
      break
    case 'svg':
      await addSvg(slide, el, { x, y, w, h, rotate })
      break
    case 'video':
      addVideoPlaceholder(slide, el, { x, y, w, h, rotate })
      break
  }
}

function addText(slide, el, pos) {
  const s = el.styles || {}
  let textRuns
  if (el.isRich && el.content) {
    textRuns = htmlToTextRuns(el.content, s)
  } else {
    const opts = {}
    if (s.color) opts.color = cssColorToHex(s.color)
    if (s.fontSize) opts.fontSize = Math.round(parseFloat(s.fontSize) * 0.75)
    if (s.fontFamily) opts.fontFace = s.fontFamily.split(',')[0].trim().replace(/['"]/g, '')
    if (s.fontWeight && (s.fontWeight === 'bold' || parseInt(s.fontWeight) >= 700)) opts.bold = true
    if (s.fontStyle === 'italic') opts.italic = true
    textRuns = [{ text: el.content || '', options: opts }]
  }

  // 수직 정렬: merged/배경 있는 텍스트는 alignItems 반영
  const hasBg = s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
  const needsFlex = el.merged || hasBg
  let valign = 'top'
  if (needsFlex) {
    const ai = s.isFlex ? (s.alignItems || 'center') : 'center'
    if (ai === 'center') valign = 'middle'
    else if (ai === 'flex-end') valign = 'bottom'
    else valign = 'top'
  }

  const textOpts = {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
    valign,
    wrap: true,
    shrinkText: false,
  }

  if (pos.rotate) textOpts.rotate = pos.rotate

  // 텍스트 정렬
  if (s.textAlign === 'center') textOpts.align = 'center'
  else if (s.textAlign === 'right') textOpts.align = 'right'
  else textOpts.align = 'left'

  // 배경색
  const bgColor = parseFill(s)
  if (bgColor) textOpts.fill = bgColor

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

  if (el.content.startsWith('data:')) {
    imgOpts.data = el.content
  } else {
    // 외부 URL → fetch로 base64 변환 시도
    try {
      const resp = await fetch(el.content)
      const blob = await resp.blob()
      imgOpts.data = await blobToDataUrl(blob)
    } catch {
      // CORS 실패 시 플레이스홀더
      slide.addText([{ text: `[이미지: ${el.content}]`, options: { fontSize: 10, color: '666666' } }], {
        x: pos.x, y: pos.y, w: pos.w, h: pos.h,
        fill: { color: 'F0F0F0' },
        border: { pt: 1, color: 'CCCCCC' },
        valign: 'middle', align: 'center',
      })
      return
    }
  }

  slide.addImage(imgOpts)
}

function addShape(slide, el, pos) {
  const s = el.styles || {}
  const shapeOpts = {
    x: pos.x, y: pos.y, w: pos.w, h: pos.h,
  }

  if (pos.rotate) shapeOpts.rotate = pos.rotate

  // 채우기
  const fill = parseFill(s)
  if (fill) shapeOpts.fill = fill

  // 테두리
  const border = parseBorder(s)
  if (border) shapeOpts.border = border

  // 그림자
  const shadow = parseShadow(s.boxShadow)
  if (shadow) shapeOpts.shadow = shadow

  // 투명도
  if (s.opacity && s.opacity !== '1') {
    shapeOpts.transparency = Math.round((1 - parseFloat(s.opacity)) * 100)
  }

  // 원형 (borderRadius 50%)
  const isCircle = s.borderRadius && (s.borderRadius === '50%' || s.borderRadius === '9999px')

  if (isCircle) {
    shapeOpts.rectRadius = Math.min(pos.w, pos.h) / 2
  } else if (s.borderRadius && s.borderRadius !== '0px') {
    shapeOpts.rectRadius = Math.round(parseFloat(s.borderRadius) * PX_TO_INCH * 100) / 100
  }

  slide.addShape('rect', shapeOpts)
}

async function addSvg(slide, el, pos) {
  // SVG → data URL → addImage
  try {
    const blob = new Blob([el.content], { type: 'image/svg+xml' })
    const dataUrl = await blobToDataUrl(blob)
    slide.addImage({
      data: dataUrl,
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      ...(pos.rotate ? { rotate: pos.rotate } : {}),
    })
  } catch {
    slide.addText([{ text: '[SVG]', options: { fontSize: 10, color: '666666' } }], {
      x: pos.x, y: pos.y, w: pos.w, h: pos.h,
      fill: { color: 'F0F0F0' }, valign: 'middle', align: 'center',
    })
  }
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

function parseFill(s) {
  // 그래디언트 채우기
  if (s.backgroundImage && s.backgroundImage !== 'none') {
    const grad = parseGradient(s.backgroundImage)
    if (grad.type === 'linear' && grad.stops.length >= 2) {
      return {
        type: 'gradient',
        rotate: grad.angle,
        stops: grad.stops.map(stop => ({
          color: cssColorToHex(stop.color) || '000000',
          position: Math.round(stop.position),
        })),
      }
    }
  }
  // 단색 채우기
  if (s.backgroundColor && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent') {
    const hex = cssColorToHex(s.backgroundColor)
    if (hex) return { color: hex }
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Blob 변환 실패'))
    reader.readAsDataURL(blob)
  })
}
