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
      addText(slide, el, { x, y, w, h, rotate })
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
      addVideoPlaceholder(slide, el, { x, y, w, h, rotate })
      break
  }
}

function addText(slide, el, pos) {
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
  } else {
    const opts = {}
    if (effectiveColor) opts.color = cssColorToHex(effectiveColor)
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
    margin: [0, 0, 0, 0],
  }

  if (pos.rotate) textOpts.rotate = pos.rotate

  // 텍스트 정렬
  if (s.textAlign === 'center') textOpts.align = 'center'
  else if (s.textAlign === 'right') textOpts.align = 'right'
  else textOpts.align = 'left'

  // 배경색 (pptxgenjs는 solid fill만 지원)
  const bgColor = parseSolidFill(s)
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

  if (el.content.startsWith('data:image/svg')) {
    imgOpts.data = await svgToPngDataUrl(el.content, el.width, el.height)
  } else if (el.content.startsWith('data:')) {
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

async function addShape(slide, el, pos) {
  const s = el.styles || {}

  const border = parseBorder(s)
  const shadow = parseShadow(s.boxShadow)
  const hasGradient = s.backgroundImage && s.backgroundImage !== 'none' &&
    parseGradient(s.backgroundImage).type !== 'none'
  const solidFill = parseSolidFill(s)

  if (!hasGradient && !solidFill && !border && !shadow) return

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
