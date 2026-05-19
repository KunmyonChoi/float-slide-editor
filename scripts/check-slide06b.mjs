import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const CANVAS_W = 1280, CANVAS_H = 720

function makeSlideVisible(html, index) {
  let result = html
  result = result.replace(/<script>[\s\S]*?window\.hasSlideNav[\s\S]*?<\/script>/m, '')
  result = result.replace(/class="slide active"/g, 'class="slide"')
  result = result.replace(/class="slide active /g, 'class="slide ')
  const injection = `<style>.slide{display:none!important}.deck>.slide:nth-child(${index+1}),body>.slide:nth-child(${index+1}){display:flex!important}</style>`
  result = result.replace('</head>', injection + '\n</head>')
  result = result.replace('<body>', `<body style="width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;margin:0;padding:0;">`)
  return result
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'], defaultViewport: { width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 } })
const page = await browser.newPage()
const sourceHtml = readFileSync(SOURCE_HTML, 'utf-8')
await page.setContent(makeSlideVisible(sourceHtml, 5), { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 300))

// Find elements with significant size (cards, bars)
const result = await page.evaluate(() => {
  const allEls = [...document.querySelectorAll('div')]
  return allEls.filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.width > 400 && rect.y > 100 && rect.y < 550 && rect.width < 700
  }).slice(0, 10).map(el => {
    const cs = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      class: el.className?.substring(0, 40),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage?.substring(0, 100),
      boxShadow: cs.boxShadow,
      filter: cs.filter
    }
  })
})
result.forEach(r => {
  if (r.bgColor && r.bgColor !== 'rgba(0, 0, 0, 0)' && r.bgColor !== 'rgb(255, 255, 255)') {
    console.log(`[${r.class}] ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}`)
    console.log(`  bgColor: ${r.bgColor}`)
    if (r.bgImage && r.bgImage !== 'none') console.log(`  bgImage: ${r.bgImage}`)
    if (r.boxShadow && r.boxShadow !== 'none') console.log(`  shadow: ${r.boxShadow}`)
    if (r.filter && r.filter !== 'none') console.log(`  filter: ${r.filter}`)
  }
})
await browser.close()
