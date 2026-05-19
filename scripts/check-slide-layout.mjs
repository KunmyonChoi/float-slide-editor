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

const result = await page.evaluate(() => {
  const slide = document.querySelector('.slide')
  if (!slide) return { error: 'no .slide found' }
  const cs = window.getComputedStyle(slide)
  const rect = slide.getBoundingClientRect()
  
  // Get direct children
  const children = [...slide.children].slice(0, 3)
  return {
    slideRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    slidePadding: cs.padding,
    slideDisplay: cs.display,
    slideFlexDir: cs.flexDirection,
    firstChildren: children.map(c => {
      const cr = c.getBoundingClientRect()
      const ccs = window.getComputedStyle(c)
      return {
        tag: c.tagName,
        class: c.className?.substring(0, 30),
        rect: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) },
        margin: ccs.margin,
        padding: ccs.padding
      }
    })
  }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
