import puppeteer from 'puppeteer'
import { readFileSync, writeFileSync } from 'fs'

const SOURCE_HTML = process.argv[2] || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const PIPELINE_BUNDLE = '/home/kunmyon/Slide-editor/float-editor/scripts/dist/pipeline.iife.js'
const CANVAS_W = 1280, CANVAS_H = 720
const SLIDE_INDEX = parseInt(process.argv[3] || '1', 10)

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

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-web-security'],
  defaultViewport: { width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 }
})
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

const flatHtml = await page.evaluate((canvasW, canvasH) => {
  const { extractFlatElements, exportFlatHtml } = window.FlatPipeline
  const fakeIframeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements, canvasSize, fontImports } = extractFlatElements(fakeIframeRef)
  return exportFlatHtml(elements, canvasSize || { w: canvasW, h: canvasH }, fontImports || [])
}, CANVAS_W, CANVAS_H)

// Save the flat HTML for manual inspection
writeFileSync('/tmp/flat-debug.html', flatHtml)
console.log('Flat HTML saved to /tmp/flat-debug.html')

// Check specific elements
const flatPage = await browser.newPage()
await flatPage.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 })
await flatPage.setContent(flatHtml, { waitUntil: 'networkidle0', timeout: 20000 })
await flatPage.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 400))

const result = await flatPage.evaluate(() => {
  const divs = [...document.querySelectorAll('body > div')]
  return divs.filter(div => {
    const cs = window.getComputedStyle(div)
    const pad = cs.padding
    return pad && pad !== '0px' && div.textContent.trim()
  }).map(div => {
    const cs = window.getComputedStyle(div)
    const text = div.textContent.trim().substring(0, 40)
    const rect = div.getBoundingClientRect()

    // Get the full style attribute for inspection
    const styleAttr = div.getAttribute('style') || ''

    // Check text rendering
    const range = document.createRange()
    range.selectNodeContents(div)
    const textRects = range.getClientRects()
    const lines = []
    let lastY = -999
    for (const r of textRects) {
      if (Math.abs(r.top - lastY) > 2) lines.push({ y: r.top, w: r.width, h: r.height })
      lastY = r.top
    }

    return {
      text,
      style: styleAttr.substring(0, 200),
      display: cs.display,
      width: rect.width.toFixed(1),
      height: rect.height.toFixed(1),
      padding: cs.padding,
      borderWidth: cs.borderWidth,
      lineCount: lines.length,
      lines: lines.map(l => `y=${l.y.toFixed(0)} w=${l.w.toFixed(0)}`),
    }
  })
})

result.forEach(r => {
  const flag = r.lineCount > 1 ? '🔴 MULTI-LINE' : '✅ SINGLE'
  console.log(`\n${flag} "${r.text}"`)
  console.log(`  display=${r.display} w=${r.width} h=${r.height}`)
  console.log(`  padding=${r.padding} border=${r.borderWidth}`)
  console.log(`  lines: ${r.lines.join(' | ')}`)
})

await browser.close()
