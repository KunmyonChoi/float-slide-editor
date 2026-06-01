/**
 * verify-flat-fix.mjs — F1+F2+F3+F4 회귀 검증
 *
 * Puppeteer로 진짜 브라우저를 띄워 사용자의 덱 HTML을 로드하고
 * `extractFlatElements`(Vite 모듈 그래프 경유)를 실제 실행하여
 * 슬라이드별로 누락되던 아이콘/불릿/번호가 결과에 들어왔는지 확인한다.
 *
 * 전제: `npm run dev` (port 5173)가 떠 있어야 한다.
 */
import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

const VITE = 'http://localhost:5173'
const DECK_PATH = '/home/kunmyon/Downloads/AI와블록체인_강의자료_1.html'

const deckHtml = readFileSync(DECK_PATH, 'utf8')

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('console', m => console.log(`[page:${m.type()}]`, m.text()))

await page.goto(VITE, { waitUntil: 'networkidle0', timeout: 30_000 })

// 페이지 컨텍스트에서 모듈을 dynamic import하여 그대로 실행
const summary = await page.evaluate(async (deckHtml) => {
  const { parseSlideDeck, wrapSlideAsDocument } = await import('/src/core/SlideParser.js')
  const { prepareHtmlForEditor } = await import('/src/core/ElementRegistry.js')
  const { extractFlatElements } = await import('/src/core/FlatExtractor.js')

  const { slides, globalStyles } = parseSlideDeck(deckHtml)
  const results = []

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]
    const slideDoc = wrapSlideAsDocument(slide, globalStyles)
    const { html } = prepareHtmlForEditor(slideDoc)

    // off-screen iframe에 주입 → 폰트 로드 대기 → extract
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:absolute;left:-9999px;top:0;width:1280px;height:720px;border:0'
    iframe.srcdoc = html
    document.body.appendChild(iframe)
    await new Promise(r => iframe.addEventListener('load', r, { once: true }))
    // FA 폰트 로드 대기 (cdnjs 캐시 워밍)
    try { await iframe.contentDocument.fonts.ready } catch {}
    await new Promise(r => setTimeout(r, 800))


    // extractFlatElements는 { current: iframe } 형태의 ref를 받는다
    const { elements: flat = [] } = extractFlatElements({ current: iframe }) || {}
    iframe.remove()

    // 아이콘 글리프(Font Awesome PUA 영역 –) 개수
    const PUA = /[-]/
    const iconCount = flat.filter(e => e.content && PUA.test(stripTags(e.content))).length
    // 불릿 / 번호 prefix
    const bulletCount = flat.filter(e => /^•\s/.test(stripTags(e.content || ''))).length
    const numberCount = flat.filter(e => /^\d+\.\s/.test(stripTags(e.content || ''))).length

    results.push({
      page: i + 1,
      title: slide.title,
      total: flat.length,
      icons: iconCount,
      bullets: bulletCount,
      numbers: numberCount,
    })
  }

  function stripTags(s) { return String(s).replace(/<[^>]+>/g, '') }
  return results
}, deckHtml)

console.log('\n페이지별 추출 통계 (icons / bullets / numbers / total):')
console.log('─'.repeat(80))
for (const r of summary) {
  console.log(
    `  p${String(r.page).padStart(2)}  icons=${String(r.icons).padStart(2)}  ` +
    `bullets=${String(r.bullets).padStart(2)}  numbers=${String(r.numbers).padStart(2)}  ` +
    `total=${String(r.total).padStart(3)}   — ${r.title}`
  )
}
console.log('─'.repeat(80))
const totals = summary.reduce((a, r) => ({
  icons: a.icons + r.icons, bullets: a.bullets + r.bullets, numbers: a.numbers + r.numbers
}), { icons: 0, bullets: 0, numbers: 0 })
console.log(`  합계  icons=${totals.icons}  bullets=${totals.bullets}  numbers=${totals.numbers}`)

await browser.close()
