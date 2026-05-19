/**
 * export-via-pipeline.mjs
 * Puppeteer에서 FlatPipeline 번들을 주입하여
 * 원본 HTML → 평면 요소 추출 → FlatExporter → PNG 캡처
 *
 * 사용법:
 *   node scripts/export-via-pipeline.mjs [source-html] [output-dir]
 */

import puppeteer from 'puppeteer'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOURCE_HTML = process.argv[2]
  || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const OUTPUT_DIR  = process.argv[3]
  || resolve(__dirname, 'exported-pngs')
const PIPELINE_BUNDLE = resolve(__dirname, 'dist/pipeline.iife.js')

const CANVAS_W = 1280
const CANVAS_H = 720

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const sourceHtml  = readFileSync(SOURCE_HTML, 'utf-8')
  const pipelineJs  = readFileSync(PIPELINE_BUNDLE, 'utf-8')
  const slideCount  = (sourceHtml.match(/class="slide"/g) || []).length
  console.log(`슬라이드 수: ${slideCount}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
    defaultViewport: { width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 },
  })

  const errors = []

  for (let i = 0; i < slideCount; i++) {
    const page = await browser.newPage()

    // 1. 원본 슬라이드를 페이지에 로드 (i번째 슬라이드만 표시)
    const slideHtml = makeSlideVisible(sourceHtml, i)
    await page.setContent(slideHtml, { waitUntil: 'networkidle0', timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 300))

    // 2. FlatPipeline 번들 주입
    await page.addScriptTag({ content: pipelineJs })

    // 3. prepareHtmlForEditor → data-editor-id 주입
    //    (현재 페이지 DOM에 직접 적용)
    await page.evaluate(() => {
      const { prepareHtmlForEditor } = window.FlatPipeline

      // DOM을 HTML 문자열로 변환 후 prepareHtmlForEditor 적용
      const currentHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
      const { html: preparedHtml } = prepareHtmlForEditor(currentHtml)

      // 준비된 HTML을 현재 문서에 적용
      document.open()
      document.write(preparedHtml)
      document.close()
    })

    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 500))

    // 4. FlatPipeline 번들 재주입 (document.open/write 후 스크립트 제거됨)
    await page.addScriptTag({ content: pipelineJs })

    // 5. extractFlatElements 실행
    const flatData = await page.evaluate((canvasW, canvasH) => {
      try {
        const { extractFlatElements, exportFlatHtml } = window.FlatPipeline

        // iframe ref 대신 현재 문서를 직접 사용하는 어댑터
        const fakeIframeRef = {
          current: {
            contentDocument: document,
            contentWindow: window,
          }
        }

        const { elements, canvasSize, fontImports } = extractFlatElements(fakeIframeRef)
        if (!elements || elements.length === 0) {
          return { error: '요소 추출 실패: 빈 결과', elementCount: 0 }
        }

        const flatHtml = exportFlatHtml(elements, canvasSize || { w: canvasW, h: canvasH }, fontImports || [])
        return { flatHtml, elementCount: elements.length, canvasSize }
      } catch (e) {
        return { error: e.message + '\n' + e.stack }
      }
    }, CANVAS_W, CANVAS_H)

    if (flatData.error) {
      console.log(`  ⚠️  slide-${i + 1}: 추출 오류 — ${flatData.error.split('\n')[0]}`)
      errors.push({ slide: i + 1, error: flatData.error })
      await page.close()
      continue
    }

    console.log(`  → slide-${i + 1}: ${flatData.elementCount}개 요소 추출 (캔버스: ${flatData.canvasSize?.w}×${flatData.canvasSize?.h})`)

    // 6. Flat HTML을 새 페이지에 로드하여 캡처
    const flatPage = await browser.newPage()
    await flatPage.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 })
    await flatPage.setContent(flatData.flatHtml, { waitUntil: 'networkidle0', timeout: 20000 })
    await flatPage.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 400))

    const outPath = resolve(OUTPUT_DIR, `slide-${String(i + 1).padStart(2, '0')}.png`)
    await flatPage.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H },
    })

    console.log(`  ✓ slide-${i + 1} → ${outPath}`)

    await flatPage.close()
    await page.close()
  }

  await browser.close()

  if (errors.length > 0) {
    console.log(`\n⚠️  오류 슬라이드: ${errors.map(e => e.slide).join(', ')}`)
    writeFileSync(resolve(OUTPUT_DIR, 'errors.json'), JSON.stringify(errors, null, 2))
  }

  console.log(`\n내보내기 완료: ${OUTPUT_DIR}`)
}

/**
 * HTML에서 i번째 슬라이드만 표시하도록 수정
 */
function makeSlideVisible(html, index) {
  let result = html
  result = result.replace(/<script>[\s\S]*?window\.hasSlideNav[\s\S]*?<\/script>/m, '')
  result = result.replace(/class="slide active"/g, 'class="slide"')
  result = result.replace(/class="slide active /g, 'class="slide ')

  const injection = `
<style>
  .slide { display: none !important; }
  .deck > .slide:nth-child(${index + 1}),
  body > .slide:nth-child(${index + 1}),
  .deck:nth-child(1) > .slide:nth-child(${index + 1}) { display: flex !important; }
</style>`

  result = result.replace('</head>', injection + '\n</head>')
  result = result.replace('<body>', `<body style="width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;margin:0;padding:0;">`)

  return result
}

main().catch(e => { console.error(e); process.exit(1) })
