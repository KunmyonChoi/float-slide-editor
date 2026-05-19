/**
 * gen-reference.mjs
 * 원본 HTML 슬라이드 덱에서 각 슬라이드를 Puppeteer로 렌더링하여 레퍼런스 PNG 생성
 *
 * 사용법:
 *   node scripts/gen-reference.mjs [source-html] [output-dir]
 *
 * 기본값:
 *   source: /home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html
 *   output: scripts/reference-pngs/
 */

import puppeteer from 'puppeteer'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOURCE_HTML = process.argv[2]
  || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const OUTPUT_DIR = process.argv[3]
  || resolve(__dirname, 'reference-pngs')

const CANVAS_W = 1280
const CANVAS_H = 720

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const html = readFileSync(SOURCE_HTML, 'utf-8')

  // .slide 요소 수 파악 (간단 정규식)
  const slideCount = (html.match(/class="slide"/g) || []).length
  console.log(`슬라이드 수: ${slideCount}`)

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
  })

  const scores = []

  for (let i = 0; i < slideCount; i++) {
    const page = await browser.newPage()
    await page.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 })

    // 특정 슬라이드만 표시하도록 HTML 수정
    const modifiedHtml = makeSlideVisible(html, i)

    await page.setContent(modifiedHtml, { waitUntil: 'networkidle0', timeout: 15000 })

    // 폰트 로딩 대기
    await page.evaluate(() => document.fonts.ready)
    await new Promise(r => setTimeout(r, 300))

    // 네비게이션 UI 제거 (FlatExtractor도 네비 요소를 제외하므로 레퍼런스에서도 숨김)
    await page.evaluate(() => {
      // position:fixed 요소 제거 (네비 바)
      document.querySelectorAll('*').forEach(el => {
        const cs = window.getComputedStyle(el)
        if (cs.position === 'fixed') el.style.display = 'none'
      })
      // onclick 속성을 가진 네비 버튼 제거
      document.querySelectorAll('[onclick]').forEach(el => el.style.display = 'none')
      // 슬라이드 카운터 패턴 "N / M" 제거
      document.querySelectorAll('*').forEach(el => {
        if (/^\d+\s*\/\s*\d+$/.test(el.textContent?.trim())) el.style.display = 'none'
      })
    })

    const outPath = resolve(OUTPUT_DIR, `slide-${String(i + 1).padStart(2, '0')}.png`)
    await page.screenshot({ path: outPath, fullPage: false, clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H } })

    console.log(`  ✓ slide-${i + 1} → ${outPath}`)
    await page.close()
  }

  await browser.close()
  console.log(`\n레퍼런스 PNG ${slideCount}장 생성 완료: ${OUTPUT_DIR}`)
}

/**
 * HTML에서 i번째 슬라이드만 표시하도록 수정
 */
function makeSlideVisible(html, index) {
  // 모든 .slide를 display:none으로 → i번째만 display:flex
  // SlideInternal 스크립트 제거 (자동 실행 방지)
  let result = html

  // SlideInternal 인라인 스크립트 제거 (페이지 상단 nav 스크립트)
  result = result.replace(/<script>[\s\S]*?window\.hasSlideNav[\s\S]*?<\/script>/m, '')

  // 기존 .slide 클래스에 active 제거
  result = result.replace(/class="slide active"/g, 'class="slide"')
  result = result.replace(/class="slide active /g, 'class="slide ')

  // i번째 슬라이드를 active로 만드는 style 주입
  const injection = `
<style>
  .slide { display: none !important; }
  .slide:nth-child(${index + 1}) { display: flex !important; }
</style>`

  result = result.replace('</head>', injection + '\n</head>')

  // body에 고정 크기 설정
  result = result.replace('<body>', `<body style="width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;">`)

  return result
}

main().catch(e => { console.error(e); process.exit(1) })
