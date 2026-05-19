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

// Find the CPU/GPU cards (large container elements with background)
const result = await page.evaluate(() => {
  const allEls = [...document.querySelectorAll('[data-editor-type="container"]')]
  return allEls.filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.width > 400 && rect.height > 200 && rect.y < 500
  }).map(el => {
    const cs = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage?.substring(0, 100),
      boxShadow: cs.boxShadow,
      filter: cs.filter,
      mixBlendMode: cs.mixBlendMode,
      backdropFilter: cs.backdropFilter
    }
  })
})
result.forEach(r => {
  console.log(`Card: ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h}`)
  if (r.bgColor !== 'rgba(0, 0, 0, 0)') console.log(`  bgColor: ${r.bgColor}`)
  if (r.bgImage && r.bgImage !== 'none') console.log(`  bgImage: ${r.bgImage}`)
  if (r.boxShadow && r.boxShadow !== 'none') console.log(`  shadow: ${r.boxShadow}`)
  if (r.filter && r.filter !== 'none') console.log(`  filter: ${r.filter}`)
  if (r.mixBlendMode && r.mixBlendMode !== 'normal') console.log(`  blendMode: ${r.mixBlendMode}`)
  if (r.backdropFilter && r.backdropFilter !== 'none') console.log(`  backdropFilter: ${r.backdropFilter}`)
})

// Also check the DPU bar
const dpu = await page.evaluate(() => {
  const allEls = [...document.querySelectorAll('[data-editor-type="container"]')]
  return allEls.filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.width > 800 && rect.height < 100 && rect.y > 450
  }).map(el => {
    const cs = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return {
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      bgColor: cs.backgroundColor,
      bgImage: cs.backgroundImage?.substring(0, 100),
      boxShadow: cs.boxShadow,
      filter: cs.filter
    }
  })
})
console.log('\nDPU bar:')
dpu.forEach(r => {
  console.log(`  ${r.rect.x},${r.rect.y} ${r.rect.w}×${r.rect.h} bgColor=${r.bgColor} shadow=${r.boxShadow}`)
  if (r.filter && r.filter !== 'none') console.log(`  filter: ${r.filter}`)
})
await browser.close()
