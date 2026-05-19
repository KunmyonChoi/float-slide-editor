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

const result = await page.evaluate(() => {
  // Find elements with nowrap or specific whitespace
  const allEls = [...document.querySelectorAll('[data-editor-id]')]
  return allEls.slice(0, 20).map(el => {
    const cs = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return null
    return {
      tag: el.tagName,
      editorType: el.getAttribute('data-editor-type'),
      text: (el.textContent || '').trim().substring(0, 30),
      whiteSpace: cs.whiteSpace,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
    }
  }).filter(Boolean)
})

console.log('Elements with their white-space values:')
result.forEach(r => {
  if (r.whiteSpace !== 'normal') {
    console.log(`[${r.tag}/${r.editorType}] "${r.text}" ws="${r.whiteSpace}" ${r.rect.x},${r.rect.y} ${r.rect.w}x${r.rect.h}`)
  }
})
await browser.close()
