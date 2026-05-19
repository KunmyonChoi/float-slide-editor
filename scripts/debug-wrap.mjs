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

// Measure nowrap widths for specific text elements
const result = await page.evaluate(() => {
  // Find text editor elements
  const textEls = [...document.querySelectorAll('[data-editor-type="text"]')]
  return textEls.filter(el => {
    const rect = el.getBoundingClientRect()
    // Focus on tag-type elements (small height)
    return rect.width > 0 && rect.height < 40 && rect.y > 400
  }).map(el => {
    const rect = el.getBoundingClientRect()
    const cs = window.getComputedStyle(el)
    
    // Measure nowrap width
    const origWS = el.style.whiteSpace
    const origWB = el.style.wordBreak
    const origW = el.style.width
    el.style.whiteSpace = 'nowrap'
    el.style.wordBreak = 'normal'
    el.style.width = 'auto'
    const nowrapRect = el.getBoundingClientRect()
    el.style.whiteSpace = origWS
    el.style.wordBreak = origWB
    el.style.width = origW
    
    return {
      text: (el.textContent || '').trim().substring(0, 30),
      width: rect.width,
      height: rect.height,
      nowrapWidth: nowrapRect.width,
      diff: nowrapRect.width - rect.width,
      fs: cs.fontSize,
      bg: cs.backgroundColor
    }
  })
})

result.forEach(r => {
  const flag = r.diff > 2 ? '🔴 WRAP' : r.diff > -1 ? '🟡 EDGE' : '✅ OK'
  console.log(`${flag} "${r.text}" w=${r.width.toFixed(1)} nowrap=${r.nowrapWidth.toFixed(1)} diff=${r.diff.toFixed(1)} fs=${r.fs}`)
})
await browser.close()
