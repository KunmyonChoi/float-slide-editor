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

const result = await page.evaluate((canvasW, canvasH) => {
  const { extractFlatElements } = window.FlatPipeline
  const fakeIframeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements } = extractFlatElements(fakeIframeRef)

  return elements
    .filter(el => el.type === 'text' && el.styles.borderRadius && el.styles.borderRadius !== '0px')
    .map(el => ({
      text: (el.content || '').replace(/<[^>]+>/g, '').trim().substring(0, 40),
      width: el.width,
      height: el.height,
      padding: el.styles.padding,
      borderRadius: el.styles.borderRadius,
      border: el.styles.border,
      borderTop: el.styles.borderTop,
      backgroundColor: el.styles.backgroundColor,
      backgroundImage: el.styles.backgroundImage,
      textAlign: el.styles.textAlign,
      merged: !!el.merged,
      isFlex: !!el.styles.isFlex,
      justifyContent: el.styles.justifyContent,
      alignItems: el.styles.alignItems,
    }))
}, CANVAS_W, CANVAS_H)

console.log(`\n=== Slide ${SLIDE_INDEX + 1}: borderRadius 있는 텍스트 (${result.length}개) ===\n`)
result.forEach(r => {
  const hasBg = r.backgroundColor && r.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.backgroundColor !== 'transparent'
  const hasBorder = (r.border && !r.border.startsWith('0px')) || (r.borderTop && !r.borderTop.startsWith('0px'))
  const isBadge = (hasBg || hasBorder) && r.height <= 60
  console.log(`${isBadge ? '🏷️ BADGE' : '📝 TEXT'} "${r.text}"`)
  console.log(`  bg=${r.backgroundColor} hasBg=${hasBg}`)
  console.log(`  border=${r.border} hasBorder=${hasBorder}`)
  console.log(`  padding=${r.padding} textAlign=${r.textAlign}`)
  console.log(`  merged=${r.merged} isFlex=${r.isFlex} jc=${r.justifyContent} ai=${r.alignItems}`)
  console.log()
})

await browser.close()
