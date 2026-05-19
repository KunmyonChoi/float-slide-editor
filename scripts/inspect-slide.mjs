import puppeteer from 'puppeteer'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const PIPELINE_BUNDLE = '/home/kunmyon/Slide-editor/float-editor/scripts/dist/pipeline.iife.js'
const CANVAS_W = 1280, CANVAS_H = 720
const SLIDE_INDEX = parseInt(process.argv[2] || '0')

function makeSlideVisible(html, index) {
  let result = html
  result = result.replace(/<script>[\s\S]*?window\.hasSlideNav[\s\S]*?<\/script>/m, '')
  result = result.replace(/class="slide active"/g, 'class="slide"')
  result = result.replace(/class="slide active /g, 'class="slide ')
  const injection = `<style>.slide { display: none !important; }.deck > .slide:nth-child(${index + 1}),body > .slide:nth-child(${index + 1}) { display: flex !important; }</style>`
  result = result.replace('</head>', injection + '\n</head>')
  result = result.replace('<body>', `<body style="width:${CANVAS_W}px;height:${CANVAS_H}px;overflow:hidden;margin:0;padding:0;">`)
  return result
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'], defaultViewport: { width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 } })
const page = await browser.newPage()
const sourceHtml = readFileSync(SOURCE_HTML, 'utf-8')
const pipelineJs = readFileSync(PIPELINE_BUNDLE, 'utf-8')
const slideHtml = makeSlideVisible(sourceHtml, SLIDE_INDEX)
await page.setContent(slideHtml, { waitUntil: 'networkidle0', timeout: 20000 })
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 300))
await page.addScriptTag({ content: pipelineJs })
await page.evaluate(() => {
  const { prepareHtmlForEditor } = window.FlatPipeline
  const currentHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
  const { html: preparedHtml } = prepareHtmlForEditor(currentHtml)
  document.open(); document.write(preparedHtml); document.close()
})
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 500))
await page.addScriptTag({ content: pipelineJs })

const flatData = await page.evaluate((canvasW, canvasH) => {
  const { extractFlatElements, exportFlatHtml } = window.FlatPipeline
  const fakeIframeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements, canvasSize, fontImports } = extractFlatElements(fakeIframeRef)
  const flatHtml = exportFlatHtml(elements, canvasSize || { w: canvasW, h: canvasH }, fontImports || [])
  // Return elements data for inspection
  return {
    flatHtml,
    elements: elements.map(e => ({
      id: e.id, type: e.type,
      x: Math.round(e.x), y: Math.round(e.y),
      w: Math.round(e.w), h: Math.round(e.h),
      text: e.text?.substring(0, 50),
      fontSize: e.style?.fontSize,
      hasBg: !!(e.style?.backgroundColor && e.style.backgroundColor !== 'rgba(0, 0, 0, 0)' && e.style.backgroundColor !== 'transparent')
    }))
  }
}, CANVAS_W, CANVAS_H)

writeFileSync(`/tmp/slide-${SLIDE_INDEX+1}-flat.html`, flatData.flatHtml)
console.log(JSON.stringify(flatData.elements.filter(e => e.type === 'text'), null, 2))
await browser.close()
