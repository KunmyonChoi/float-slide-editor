import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const CANVAS_W = 1280, CANVAS_H = 720, SLIDE_INDEX = 0

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
await page.setContent(makeSlideVisible(sourceHtml, SLIDE_INDEX), { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 300))

// Find what element has the background gradient
const result = await page.evaluate(() => {
  const allEls = [...document.querySelectorAll('*')]
  const withGrad = allEls.filter(el => {
    const cs = window.getComputedStyle(el)
    return cs.backgroundImage && cs.backgroundImage.includes('gradient') && cs.backgroundImage.includes('10, 15, 44')
  })
  return withGrad.map(el => {
    const cs = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName,
      class: el.className?.substring(0, 60),
      id: el.id,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      bgImage: cs.backgroundImage?.substring(0, 100),
      position: cs.position,
      backgroundSize: cs.backgroundSize,
      backgroundPosition: cs.backgroundPosition
    }
  })
})
result.forEach(r => {
  console.log(`[${r.tag}] class="${r.class}" id="${r.id}"`)
  console.log(`  rect: ${r.rect.x},${r.rect.y} ${r.rect.w}x${r.rect.h}`)
  console.log(`  pos: ${r.position}`)
  console.log(`  bgImage: ${r.bgImage}`)
  console.log(`  bgSize: ${r.backgroundSize} bgPos: ${r.backgroundPosition}`)
})
await browser.close()
