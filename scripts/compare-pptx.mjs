/**
 * PPTX 품질 비교 스크립트
 * 1. 브라우저에서 flat 추출 → JSON
 * 2. Python 백엔드로 PPTX 생성
 * 3. PPTX XML 파싱해서 원본 JSON과 비교
 */
import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'

const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const OUT_DIR = 'scripts/pptx-compare'
mkdirSync(OUT_DIR, { recursive: true })

async function main() {
  console.log('=== PPTX 품질 비교 ===\n')

  // 1. Extract flat elements from browser
  console.log('[1/4] Flat 요소 추출 중...')
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle2', timeout: 15000 })

  // Load HTML file
  const htmlContent = readFileSync(SOURCE_HTML, 'utf-8')
  await page.evaluate((html) => {
    const { useEditorStore } = window.__stores || {}
    // Use file menu to load
  }, htmlContent)

  // Load via file menu approach - use the editor store
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.includes('파일')) { b.click(); break }
    }
  })
  await new Promise(r => setTimeout(r, 500))
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('div')) {
      if (d.textContent.trim() === 'HTML 열기') { d.click(); break }
    }
  })
  await new Promise(r => setTimeout(r, 500))

  // Inject the HTML via the editor store directly
  await page.evaluate(async (html) => {
    const { useEditorStore } = await import('/src/store/editorStore.js')
    const { useFlatStore } = await import('/src/store/flatStore.js')
    useFlatStore.getState().clearPageCache()
    useEditorStore.getState().loadHtml(html)
  }, htmlContent)

  await new Promise(r => setTimeout(r, 5000))

  // Switch to Flat mode
  await page.evaluate(() => {
    for (const b of document.querySelectorAll('button')) {
      if (b.textContent.trim() === 'Flat') { b.click(); break }
    }
  })
  await new Promise(r => setTimeout(r, 3000))

  // Get all pages
  const pagesData = await page.evaluate(async () => {
    const { useFlatStore } = await import('/src/store/flatStore.js')
    const { pages } = await useFlatStore.getState().getAllPagesAsync()
    return { pages, defaultCanvasSize: useFlatStore.getState().canvasSize }
  })

  await browser.close()

  const pageCount = Object.keys(pagesData.pages).length
  const totalElements = Object.values(pagesData.pages).reduce((sum, p) => sum + p.elements.length, 0)
  console.log(`  추출 완료: ${pageCount} 페이지, ${totalElements} 요소`)

  // Save JSON for reference
  writeFileSync(`${OUT_DIR}/source-data.json`, JSON.stringify(pagesData, null, 2))

  // 2. Send to Python backend
  console.log('\n[2/4] Python 백엔드로 PPTX 생성 중...')
  const res = await fetch('http://127.0.0.1:8321/api/export/pptx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pagesData),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    console.error('  PPTX 생성 실패:', err.error || res.status)
    process.exit(1)
  }

  const pptxBuffer = Buffer.from(await res.arrayBuffer())
  const pptxPath = `${OUT_DIR}/export.pptx`
  writeFileSync(pptxPath, pptxBuffer)
  console.log(`  생성 완료: ${pptxPath} (${pptxBuffer.length} bytes)`)

  // 3. Extract PPTX and compare
  console.log('\n[3/4] PPTX 구조 분석 중...')
  const extractDir = `${OUT_DIR}/pptx-extracted`
  execSync(`rm -rf ${extractDir} && mkdir -p ${extractDir} && unzip -o ${pptxPath} -d ${extractDir} > /dev/null 2>&1`)

  // 4. Compare each slide
  console.log('\n[4/4] 슬라이드별 비교\n')

  const sortedKeys = Object.keys(pagesData.pages).sort((a, b) => {
    const [aP, aV] = a.split('-').map(Number)
    const [bP, bV] = b.split('-').map(Number)
    return aP - bP || aV - bV
  })

  const report = []

  for (let si = 0; si < sortedKeys.length; si++) {
    const pageKey = sortedKeys[si]
    const page = pagesData.pages[pageKey]
    const slideFile = `${extractDir}/ppt/slides/slide${si + 1}.xml`

    let slideXml
    try {
      slideXml = readFileSync(slideFile, 'utf-8')
    } catch {
      console.log(`  Slide ${si + 1} (${pageKey}): XML 파일 없음!`)
      report.push({ slide: si + 1, pageKey, error: 'missing XML' })
      continue
    }

    const sourceElements = page.elements
    const pptxShapes = (slideXml.match(/<p:sp>/g) || []).length
    const pptxPics = (slideXml.match(/<p:pic>/g) || []).length
    const pptxGrads = (slideXml.match(/gradFill/g) || []).length
    const pptxTexts = [...slideXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1])
    const pptxNoFills = (slideXml.match(/<a:noFill\/>/g) || []).length
    const pptxBgFills = (slideXml.match(/background/gi) || []).length

    // Count source element types
    const srcTypes = {}
    const srcGrads = sourceElements.filter(e =>
      e.styles?.backgroundImage && e.styles.backgroundImage !== 'none'
    ).length
    const srcTexts = sourceElements.filter(e => e.type === 'text').map(e =>
      (e.content || '').replace(/<[^>]+>/g, '').trim().substring(0, 30)
    ).filter(t => t)

    for (const el of sourceElements) {
      srcTypes[el.type] = (srcTypes[el.type] || 0) + 1
    }

    const issues = []

    // Check element count
    const srcTotal = sourceElements.length
    const pptxTotal = pptxShapes + pptxPics
    if (pptxTotal < srcTotal * 0.8) {
      issues.push(`요소 부족: 원본 ${srcTotal} → PPTX ${pptxTotal}`)
    }

    // Check gradients
    if (srcGrads > 0 && pptxGrads === 0) {
      issues.push(`그라데이션 누락: 원본 ${srcGrads}개 → PPTX 0개`)
    }

    // Check text content
    const srcTextSet = new Set(srcTexts)
    const pptxTextJoined = pptxTexts.join(' ')
    let missingTexts = 0
    for (const t of srcTextSet) {
      if (t.length > 3 && !pptxTextJoined.includes(t.substring(0, 10))) {
        missingTexts++
      }
    }
    if (missingTexts > 0) {
      issues.push(`텍스트 누락 의심: ${missingTexts}개`)
    }

    const status = issues.length === 0 ? '✓' : `✗ (${issues.length})`
    console.log(`  Slide ${si + 1} (${pageKey}): ${status}`)
    console.log(`    원본: ${srcTotal}개 (${Object.entries(srcTypes).map(([k,v]) => `${k}:${v}`).join(', ')}) grad:${srcGrads}`)
    console.log(`    PPTX: shapes=${pptxShapes} pics=${pptxPics} grad=${pptxGrads} noFill=${pptxNoFills}`)
    if (issues.length > 0) {
      for (const issue of issues) {
        console.log(`    ⚠ ${issue}`)
      }
    }

    report.push({
      slide: si + 1,
      pageKey,
      source: { total: srcTotal, types: srcTypes, gradients: srcGrads, texts: srcTexts.length },
      pptx: { shapes: pptxShapes, pics: pptxPics, gradients: pptxGrads },
      issues,
    })
  }

  // Summary
  const totalIssues = report.reduce((sum, r) => sum + (r.issues?.length || 0), 0)
  console.log(`\n=== 요약 ===`)
  console.log(`슬라이드: ${report.length}`)
  console.log(`문제 발견: ${totalIssues}`)

  writeFileSync(`${OUT_DIR}/compare-report.json`, JSON.stringify(report, null, 2))
  console.log(`상세 리포트: ${OUT_DIR}/compare-report.json`)
}

main().catch(console.error)
