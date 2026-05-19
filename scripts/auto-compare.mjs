/**
 * PPTX 품질 자동 비교 파이프라인
 *
 * 1. 원본 HTML → 브라우저 flat 렌더링 → 레퍼런스 PNG
 * 2. flat JSON → Python 백엔드 → PPTX → LibreOffice → PPTX PNG
 * 3. 레퍼런스 PNG vs PPTX PNG 픽셀 비교 → diff + 점수
 *
 * Usage: node scripts/auto-compare.mjs [html파일경로] [--slide N]
 *   예: node scripts/auto-compare.mjs /path/to/slides.html
 *       node scripts/auto-compare.mjs /path/to/slides.html --slide 3
 *       node scripts/auto-compare.mjs --slide 3  (기본 HTML 사용)
 */
import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

// HTML 파일 경로: 첫 번째 인자 또는 기본값
const args = process.argv.slice(2)
const htmlArg = args.find(a => !a.startsWith('--'))
const SOURCE_HTML = htmlArg || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const OUT_DIR = 'scripts/pptx-compare'
const REF_DIR = `${OUT_DIR}/reference`
const PPTX_DIR = `${OUT_DIR}/pptx-png`
const DIFF_DIR = `${OUT_DIR}/diff`

const targetSlide = process.argv.includes('--slide')
  ? parseInt(process.argv[process.argv.indexOf('--slide') + 1])
  : null

mkdirSync(REF_DIR, { recursive: true })
mkdirSync(PPTX_DIR, { recursive: true })
mkdirSync(DIFF_DIR, { recursive: true })

async function main() {
  console.log('=== PPTX 품질 자동 비교 ===\n')

  // Step 1: Extract flat data & generate reference PNGs
  console.log('[1/4] Flat 추출 + 레퍼런스 PNG 생성...')
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2', timeout: 15000 })

  // Load HTML
  const htmlContent = readFileSync(SOURCE_HTML, 'utf-8')
  await page.evaluate(async (html) => {
    const { useEditorStore } = await import('/src/store/editorStore.js')
    const { useFlatStore } = await import('/src/store/flatStore.js')
    useFlatStore.getState().clearPageCache()
    useEditorStore.getState().loadHtml(html)
  }, htmlContent)
  await new Promise(r => setTimeout(r, 5000))

  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Flat') { b.click(); break }
    }
  })
  await new Promise(r => setTimeout(r, 3000))

  // Get all pages data
  const pagesData = await page.evaluate(async () => {
    const { useFlatStore } = await import('/src/store/flatStore.js')
    const { pages } = await useFlatStore.getState().getAllPagesAsync()
    return { pages, defaultCanvasSize: useFlatStore.getState().canvasSize }
  })

  const sortedKeys = Object.keys(pagesData.pages).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })

  writeFileSync(`${OUT_DIR}/source-data.json`, JSON.stringify(pagesData, null, 2))
  console.log(`  ${sortedKeys.length} 페이지 추출 완료`)

  // Generate reference PNGs: render each page as standalone HTML & screenshot
  console.log('  레퍼런스 PNG 생성 중...')

  // Collect fontImports from all pages for CSS injection
  const allFontCss = new Set()
  for (const key of sortedKeys) {
    for (const fi of (pagesData.pages[key].fontImports || [])) allFontCss.add(fi)
  }
  const fontCssBlock = [...allFontCss].join('\n')

  // New lightweight browser for rendering
  const renderBrowser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], protocolTimeout: 30000 })

  for (let si = 0; si < sortedKeys.length; si++) {
    if (targetSlide && si + 1 !== targetSlide) continue

    const key = sortedKeys[si]
    const pageData = pagesData.pages[key]
    const cs = pageData.canvasSize || pagesData.defaultCanvasSize
    const elements = pageData.elements || []

    // Build standalone HTML for this page
    const html = buildFlatPageHtml(elements, cs, fontCssBlock)
    const tmpPath = `${OUT_DIR}/_tmp_page.html`
    writeFileSync(tmpPath, html)

    const rPage = await renderBrowser.newPage()
    await rPage.setViewport({ width: cs.w, height: cs.h })
    await rPage.goto(`file://${process.cwd()}/${tmpPath}`, { waitUntil: 'networkidle2', timeout: 15000 })
    await new Promise(r => setTimeout(r, 1500))
    await rPage.screenshot({ path: `${REF_DIR}/slide-${si + 1}.png`, clip: { x: 0, y: 0, width: cs.w, height: cs.h } })
    await rPage.close()
    console.log(`    slide ${si + 1} captured (${cs.w}x${cs.h})`)
  }

  await renderBrowser.close()
  await browser.close()
  console.log('  레퍼런스 PNG 완료')

  // Step 2: Generate PPTX via Python backend (with font data)
  console.log('\n[2/4] Python PPTX 생성...')
  const fonts = collectFontData(pagesData.pages)
  console.log(`  폰트 ${fonts.length}개 수집`)
  const res = await fetch('http://127.0.0.1:8321/api/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...pagesData, fonts }),
  })
  if (!res.ok) {
    console.error('  PPTX 생성 실패:', await res.text())
    process.exit(1)
  }
  const pptxPath = `${OUT_DIR}/export.pptx`
  writeFileSync(pptxPath, Buffer.from(await res.arrayBuffer()))
  console.log(`  ${pptxPath} 생성 완료`)

  // Step 3: PPTX → PDF → PNG via LibreOffice (match flat canvas resolution)
  console.log('\n[3/4] PPTX → PNG 변환 (LibreOffice)...')
  execSync(`rm -f ${PPTX_DIR}/*.png ${PPTX_DIR}/*.pdf`)
  execSync(`libreoffice --headless --convert-to pdf --outdir ${PPTX_DIR} ${pptxPath} 2>/dev/null`)
  const pdfPath = `${PPTX_DIR}/export.pdf`
  const cs = pagesData.defaultCanvasSize || { w: 1280, h: 800 }
  execSync(`pdftoppm -png -W ${cs.w} -H ${cs.h} ${pdfPath} ${PPTX_DIR}/slide`)
  console.log('  변환 완료')

  // Step 4: Pixel comparison
  console.log('\n[4/4] 픽셀 비교\n')
  const results = []

  for (let si = 0; si < sortedKeys.length; si++) {
    if (targetSlide && si + 1 !== targetSlide) continue

    const num = String(si + 1).padStart(2, '0')
    const refPath = `${REF_DIR}/slide-${si + 1}.png`
    // pdftoppm outputs 1-indexed with padding: slide-01.png, slide-02.png, ...
    const pptxPngPath = `${PPTX_DIR}/slide-${num}.png`
    // Also try without padding (some pdftoppm versions)
    const pptxPngPathAlt = `${PPTX_DIR}/slide-${si + 1}.png`

    const actualPptxPath = existsSync(pptxPngPath) ? pptxPngPath : existsSync(pptxPngPathAlt) ? pptxPngPathAlt : null
    if (!existsSync(refPath) || !actualPptxPath) {
      console.log(`  Slide ${si + 1}: 파일 없음 (ref=${existsSync(refPath)} pptx=${!!actualPptxPath})`)
      results.push({ slide: si + 1, score: -1, error: 'missing file' })
      continue
    }

    const refImg = PNG.sync.read(readFileSync(refPath))
    const pptxImg = PNG.sync.read(readFileSync(actualPptxPath))

    // Resize to match if needed (use smaller dimensions)
    const w = Math.min(refImg.width, pptxImg.width)
    const h = Math.min(refImg.height, pptxImg.height)

    // Crop both to same size
    const refCropped = cropPng(refImg, w, h)
    const pptxCropped = cropPng(pptxImg, w, h)

    const diff = new PNG({ width: w, height: h })
    const mismatchCount = pixelmatch(
      refCropped.data, pptxCropped.data, diff.data,
      w, h,
      { threshold: 0.15 }
    )

    const totalPixels = w * h
    const matchPct = ((1 - mismatchCount / totalPixels) * 100).toFixed(1)

    writeFileSync(`${DIFF_DIR}/slide-${si + 1}-diff.png`, PNG.sync.write(diff))

    const icon = matchPct >= 95 ? '✓' : matchPct >= 80 ? '△' : '✗'
    console.log(`  Slide ${si + 1}: ${icon} ${matchPct}% 일치 (diff: ${mismatchCount}/${totalPixels}px)`)

    results.push({ slide: si + 1, matchPct: parseFloat(matchPct), mismatchPixels: mismatchCount, totalPixels })
  }

  // Summary
  const valid = results.filter(r => r.score !== -1)
  const avgMatch = valid.length > 0
    ? (valid.reduce((s, r) => s + (r.matchPct || 0), 0) / valid.length).toFixed(1)
    : 0

  console.log(`\n=== 요약 ===`)
  console.log(`평균 일치율: ${avgMatch}%`)
  console.log(`슬라이드: ${results.length}`)
  console.log(`출력:`)
  console.log(`  레퍼런스: ${REF_DIR}/`)
  console.log(`  PPTX PNG: ${PPTX_DIR}/`)
  console.log(`  Diff:     ${DIFF_DIR}/`)

  writeFileSync(`${OUT_DIR}/pixel-report.json`, JSON.stringify(results, null, 2))
}

function cropPng(img, w, h) {
  const out = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcIdx = (y * img.width + x) * 4
      const dstIdx = (y * w + x) * 4
      if (srcIdx + 3 < img.data.length) {
        out.data[dstIdx] = img.data[srcIdx]
        out.data[dstIdx + 1] = img.data[srcIdx + 1]
        out.data[dstIdx + 2] = img.data[srcIdx + 2]
        out.data[dstIdx + 3] = img.data[srcIdx + 3]
      }
    }
  }
  return out
}

/** Flat element 배열 → 독립 HTML 페이지 (레퍼런스 렌더링용) */
function buildFlatPageHtml(elements, canvasSize, fontCss) {
  const w = canvasSize.w || 1280
  const h = canvasSize.h || 800

  const elHtmls = elements.map(el => {
    const s = el.styles || {}
    const type = el.type || 'shape'
    const content = el.content || ''

    // Build inline style from flat styles
    const styleProps = []
    styleProps.push(`position:absolute`)
    styleProps.push(`left:${el.x || 0}px; top:${el.y || 0}px`)
    styleProps.push(`width:${el.width || 0}px; height:${el.height || 0}px`)
    if (el.rotation) styleProps.push(`transform:rotate(${el.rotation}deg)`)
    if (s.backgroundColor) styleProps.push(`background-color:${s.backgroundColor}`)
    if (s.backgroundImage && s.backgroundImage !== 'none') styleProps.push(`background-image:${s.backgroundImage}`)
    if (s.borderRadius) styleProps.push(`border-radius:${s.borderRadius}`)
    if (s.border) styleProps.push(`border:${s.border}`)
    if (s.borderTop) styleProps.push(`border-top:${s.borderTop}`)
    if (s.borderRight) styleProps.push(`border-right:${s.borderRight}`)
    if (s.borderBottom) styleProps.push(`border-bottom:${s.borderBottom}`)
    if (s.borderLeft) styleProps.push(`border-left:${s.borderLeft}`)
    if (s.boxShadow) styleProps.push(`box-shadow:${s.boxShadow}`)
    if (s.opacity && s.opacity !== '1') styleProps.push(`opacity:${s.opacity}`)
    if (s.overflow) styleProps.push(`overflow:${s.overflow}`)
    if (s.zIndex != null) styleProps.push(`z-index:${s.zIndex}`)
    // Text styles
    if (s.fontFamily) styleProps.push(`font-family:${s.fontFamily}`)
    if (s.fontSize) styleProps.push(`font-size:${s.fontSize}`)
    if (s.fontWeight) styleProps.push(`font-weight:${s.fontWeight}`)
    if (s.fontStyle) styleProps.push(`font-style:${s.fontStyle}`)
    if (s.color) styleProps.push(`color:${s.color}`)
    if (s.textAlign) styleProps.push(`text-align:${s.textAlign}`)
    if (s.lineHeight) styleProps.push(`line-height:${s.lineHeight}`)
    if (s.letterSpacing) styleProps.push(`letter-spacing:${s.letterSpacing}`)
    if (s.padding) styleProps.push(`padding:${s.padding}`)
    if (s.fontVariationSettings) styleProps.push(`font-variation-settings:${s.fontVariationSettings}`)
    if (s.fontFeatureSettings) styleProps.push(`font-feature-settings:${s.fontFeatureSettings}`)
    if (s.whiteSpace) styleProps.push(`white-space:${s.whiteSpace}`)
    if (s.wordBreak) styleProps.push(`word-break:${s.wordBreak}`)
    if (s.webkitBackgroundClip) styleProps.push(`-webkit-background-clip:${s.webkitBackgroundClip}`)
    if (s.backgroundClip) styleProps.push(`background-clip:${s.backgroundClip}`)
    if (s.webkitTextFillColor) styleProps.push(`-webkit-text-fill-color:${s.webkitTextFillColor}`)
    if (s.textShadow) styleProps.push(`text-shadow:${s.textShadow}`)
    // Flex
    if (s.display) styleProps.push(`display:${s.display}`)
    if (s.alignItems) styleProps.push(`align-items:${s.alignItems}`)
    if (s.justifyContent) styleProps.push(`justify-content:${s.justifyContent}`)

    const style = styleProps.join('; ')

    if (type === 'image') {
      return `<img src="${content}" style="${style}" />`
    }
    if (type === 'svg') {
      return `<div style="${style}">${content}</div>`
    }
    // text or shape
    const inner = (type === 'text' && el.isRich) ? content : escapeHtml(content)
    return `<div style="${style}">${inner}</div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
${fontCss}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${w}px; height: ${h}px; overflow: hidden; background: white; }
</style>
</head>
<body>
<div style="position:relative; width:${w}px; height:${h}px; overflow:hidden;">
${elHtmls}
</div>
</body></html>`
}

function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** fontImports CSS에서 폰트 디스크립터 추출 (PptxBackendClient.js와 동일 로직) */
function collectFontData(pages) {
  const fonts = []
  const seen = new Set()
  for (const page of Object.values(pages)) {
    for (const css of (page.fontImports || [])) {
      const trimmed = css.trim()
      if (seen.has(trimmed)) continue
      seen.add(trimmed)

      const importMatch = trimmed.match(/@import\s+url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)
      if (importMatch) {
        fonts.push({ type: 'google-import', url: importMatch[1] })
        continue
      }
      if (trimmed.startsWith('@font-face')) {
        const family = cssProp(trimmed, 'font-family')?.replace(/['"]/g, '')
        const src = cssProp(trimmed, 'src')
        const weight = cssProp(trimmed, 'font-weight') || '400'
        const style = cssProp(trimmed, 'font-style') || 'normal'
        if (!family || !src) continue
        const urlMatch = src.match(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/)
        if (urlMatch) fonts.push({ type: 'font-face', family, url: urlMatch[1], weight: parseInt(weight) || 400, style })
      }
    }
  }
  return fonts
}

function cssProp(css, prop) {
  const m = css.match(new RegExp(`${prop}\\s*:\\s*([^;]+)`, 'i'))
  return m ? m[1].trim() : null
}

main().catch(console.error)
