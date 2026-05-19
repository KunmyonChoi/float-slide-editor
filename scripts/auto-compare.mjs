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
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
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

  // Generate reference PNGs (browser rendering of flat HTML)
  console.log('  레퍼런스 PNG 생성 중...')
  for (let si = 0; si < sortedKeys.length; si++) {
    if (targetSlide && si + 1 !== targetSlide) continue

    const key = sortedKeys[si]
    // Navigate to this page
    await page.evaluate(async (pageKey) => {
      const { useFlatStore } = await import('/src/store/flatStore.js')
      const store = useFlatStore.getState()
      // Find page index from key
      const idx = parseInt(pageKey.split('-')[0])
      if (store.goToPage) store.goToPage(idx)
    }, key)
    await new Promise(r => setTimeout(r, 1500))

    // Screenshot the canvas
    const canvas = await page.$('[data-flat-canvas]')
    if (canvas) {
      await canvas.screenshot({ path: `${REF_DIR}/slide-${si + 1}.png` })
    }
  }
  await browser.close()
  console.log('  레퍼런스 PNG 완료')

  // Step 2: Generate PPTX via Python backend
  console.log('\n[2/4] Python PPTX 생성...')
  const res = await fetch('http://127.0.0.1:8321/api/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pagesData),
  })
  if (!res.ok) {
    console.error('  PPTX 생성 실패:', await res.text())
    process.exit(1)
  }
  const pptxPath = `${OUT_DIR}/export.pptx`
  writeFileSync(pptxPath, Buffer.from(await res.arrayBuffer()))
  console.log(`  ${pptxPath} 생성 완료`)

  // Step 3: PPTX → PDF → PNG via LibreOffice
  console.log('\n[3/4] PPTX → PNG 변환 (LibreOffice)...')
  execSync(`rm -f ${PPTX_DIR}/*.png ${PPTX_DIR}/*.pdf`)
  execSync(`libreoffice --headless --convert-to pdf --outdir ${PPTX_DIR} ${pptxPath} 2>/dev/null`)
  const pdfPath = `${PPTX_DIR}/export.pdf`
  execSync(`pdftoppm -png -r 150 ${pdfPath} ${PPTX_DIR}/slide`)
  console.log('  변환 완료')

  // Step 4: Pixel comparison
  console.log('\n[4/4] 픽셀 비교\n')
  const results = []

  for (let si = 0; si < sortedKeys.length; si++) {
    if (targetSlide && si + 1 !== targetSlide) continue

    const num = String(si + 1).padStart(2, '0')
    const refPath = `${REF_DIR}/slide-${si + 1}.png`
    const pptxPngPath = `${PPTX_DIR}/slide-${num}.png`

    if (!existsSync(refPath) || !existsSync(pptxPngPath)) {
      console.log(`  Slide ${si + 1}: 파일 없음 (ref=${existsSync(refPath)} pptx=${existsSync(pptxPngPath)})`)
      results.push({ slide: si + 1, score: -1, error: 'missing file' })
      continue
    }

    const refImg = PNG.sync.read(readFileSync(refPath))
    const pptxImg = PNG.sync.read(readFileSync(pptxPngPath))

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

    PNG.sync.write(diff, `${DIFF_DIR}/slide-${si + 1}-diff.png`)

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

main().catch(console.error)
