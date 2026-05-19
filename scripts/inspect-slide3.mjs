import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

const SOURCE_HTML = '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const PIPELINE_BUNDLE = '/home/kunmyon/Slide-editor/float-editor/scripts/dist/pipeline.iife.js'
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

const elements = await page.evaluate((cw, ch) => {
  const { extractFlatElements } = window.FlatPipeline
  const fakeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements } = extractFlatElements(fakeRef)
  return elements.map(e => ({
    id: e.id, type: e.type,
    x: Math.round(e.x), y: Math.round(e.y),
    width: Math.round(e.width), height: Math.round(e.height),
    content: e.content?.substring(0, 40),
    bg: e.styles?.backgroundColor,
    gradient: e.styles?.background?.substring(0, 60)
  }))
}, CANVAS_W, CANVAS_H)

elements.forEach(e => {
  const r = e.x + e.width, b = e.y + e.height
  // Flag elements that overlap the diff region (x=640-800, y=270-360)
  const inDiff = r > 640 && e.x < 800 && b > 270 && e.y < 360
  console.log(`${inDiff ? '>>> ' : '    '}[${e.id}/${e.type}] content="${e.content||''}" x=${e.x} y=${e.y} w=${e.width} h=${e.height}${e.gradient ? ' GRAD' : ''}`)
})
await browser.close()
