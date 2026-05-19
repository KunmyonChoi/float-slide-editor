import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

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

// Extract flat elements and generate flat HTML
const flatHtml = await page.evaluate((canvasW, canvasH) => {
  const { extractFlatElements, exportFlatHtml } = window.FlatPipeline
  const fakeIframeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements, canvasSize, fontImports } = extractFlatElements(fakeIframeRef)
  return exportFlatHtml(elements, canvasSize || { w: canvasW, h: canvasH }, fontImports || [])
}, CANVAS_W, CANVAS_H)

// Load flat HTML in a new page and check for wrapping
const flatPage = await browser.newPage()
await flatPage.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 2 })
await flatPage.setContent(flatHtml, { waitUntil: 'networkidle0', timeout: 20000 })
await flatPage.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 400))

const result = await flatPage.evaluate(() => {
  const divs = [...document.querySelectorAll('body > div')]
  return divs.filter(div => {
    const cs = window.getComputedStyle(div)
    return cs.padding && cs.padding !== '0px' && div.textContent.trim()
  }).map(div => {
    const cs = window.getComputedStyle(div)
    const text = div.textContent.trim().substring(0, 40)
    const rect = div.getBoundingClientRect()

    // Check if text wraps: compare scrollHeight vs single line height
    const fontSize = parseFloat(cs.fontSize) || 16
    const lineHeight = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight) || fontSize * 1.2
    const paddingTop = parseFloat(cs.paddingTop) || 0
    const paddingBottom = parseFloat(cs.paddingBottom) || 0
    const borderTop = parseFloat(cs.borderTopWidth) || 0
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0
    const expectedSingleLineH = lineHeight + paddingTop + paddingBottom + borderTop + borderBottom

    // Measure nowrap
    const origWS = div.style.whiteSpace
    const origWB = div.style.wordBreak
    div.style.whiteSpace = 'nowrap'
    div.style.wordBreak = 'normal'
    const nowrapSW = div.scrollWidth
    div.style.whiteSpace = origWS
    div.style.wordBreak = origWB

    const wraps = div.scrollHeight > expectedSingleLineH + 2
    const wouldOverflow = nowrapSW > rect.width

    return {
      text,
      // container box
      width: rect.width.toFixed(1),
      height: rect.height.toFixed(1),
      // padding/border
      padding: cs.padding,
      borderWidth: cs.borderWidth,
      borderRadius: cs.borderRadius,
      boxSizing: cs.boxSizing,
      // content area
      clientW: div.clientWidth,
      scrollW: div.scrollWidth,
      scrollH: div.scrollHeight,
      nowrapSW,
      // wrapping check
      expectedSingleLineH: expectedSingleLineH.toFixed(1),
      wraps,
      wouldOverflow,
    }
  })
})

console.log(`\n=== Slide ${SLIDE_INDEX + 1}: flat 렌더링 결과 (padding 있는 요소) ===\n`)
result.forEach(r => {
  const flag = r.wraps ? '🔴 WRAP' : '✅ OK'
  console.log(`${flag} "${r.text}"`)
  console.log(`  box: w=${r.width} h=${r.height} boxSizing=${r.boxSizing}`)
  console.log(`  padding=${r.padding} border=${r.borderWidth} br=${r.borderRadius}`)
  console.log(`  clientW=${r.clientW} scrollW=${r.scrollW} nowrapSW=${r.nowrapSW}`)
  console.log(`  scrollH=${r.scrollH} expectedH=${r.expectedSingleLineH} wraps=${r.wraps}`)
  console.log()
})

await browser.close()
