import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync } from 'fs'

const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const PIPELINE_BUNDLE = '/home/kunmyon/Slide-editor/float-editor/scripts/dist/pipeline.iife.js'
const CANVAS_W = 1280, CANVAS_H = 720
const SLIDE_INDEX = parseInt(process.argv[2] || '0')

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
const pipelineJs = readFileSync(PIPELINE_BUNDLE, 'utf-8')
await page.setContent(makeSlideVisible(sourceHtml, SLIDE_INDEX), { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 300))
await page.addScriptTag({ content: pipelineJs })
await page.evaluate(() => {
  const { prepareHtmlForEditor } = window.FlatPipeline
  const { html } = prepareHtmlForEditor('<!DOCTYPE html>\n' + document.documentElement.outerHTML)
  document.open(); document.write(html); document.close()
})
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 500))
await page.addScriptTag({ content: pipelineJs })

const { elements, flatHtml } = await page.evaluate((cw, ch) => {
  const { extractFlatElements, exportFlatHtml } = window.FlatPipeline
  const fakeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements, canvasSize, fontImports } = extractFlatElements(fakeRef)
  const flatHtml = exportFlatHtml(elements, canvasSize || { w: cw, h: ch }, fontImports || [])
  return {
    elements: elements.map(e => ({
      id: e.id, type: e.type,
      x: Math.round(e.x), y: Math.round(e.y),
      width: Math.round(e.width), height: Math.round(e.height),
      content: e.content?.substring(0, 60),
      fontSize: e.styles?.fontSize,
      fontWeight: e.styles?.fontWeight,
      hasBg: !!(e.styles?.backgroundColor && e.styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && e.styles.backgroundColor !== 'transparent')
    })),
    flatHtml
  }
}, CANVAS_W, CANVAS_H)

writeFileSync(`/tmp/slide-${SLIDE_INDEX+1}-flat.html`, flatHtml)
console.log('Text elements:')
elements.filter(e => e.type === 'text').forEach(e => {
  console.log(`  [${e.id}] "${e.content}" x=${e.x} y=${e.y} w=${e.width} h=${e.height} fs=${e.fontSize} fw=${e.fontWeight} hasBg=${e.hasBg}`)
})
console.log(`\nFlat HTML saved to /tmp/slide-${SLIDE_INDEX+1}-flat.html`)
await browser.close()
