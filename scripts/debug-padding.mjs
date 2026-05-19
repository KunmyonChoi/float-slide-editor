import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'

const SOURCE_HTML = process.argv[2] || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const PIPELINE_BUNDLE = '/home/kunmyon/Slide-editor/float-editor/scripts/dist/pipeline.iife.js'
const CANVAS_W = 1280, CANVAS_H = 720
const SLIDE_INDEX = parseInt(process.argv[3] || '0', 10)

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
    .filter(el => el.type === 'text' && el.styles.padding && el.styles.padding !== '0px')
    .map(el => {
      const pad = el.styles.padding
      const padParts = pad.split(' ').map(p => parseFloat(p) || 0)
      const padL = padParts.length === 4 ? padParts[3] : padParts.length >= 2 ? padParts[1] : padParts[0]
      const padR = padParts.length === 4 ? padParts[1] : padParts.length >= 2 ? padParts[1] : padParts[0]
      const padTotal = padL + padR
      const contentW = el.width - padTotal
      const hasBorderRadius = el.styles.borderRadius && el.styles.borderRadius !== '0px'

      // nowrap width 측정 (flat export 시 콘텐츠 영역에서 텍스트가 들어가는지)
      const testDiv = document.createElement('div')
      testDiv.style.cssText = [
        `position:absolute;left:-9999px;top:-9999px`,
        `box-sizing:border-box`,
        `width:${el.width}px`,
        `padding:${pad}`,
        `font-size:${el.styles.fontSize}`,
        `font-family:${el.styles.fontFamily}`,
        `font-weight:${el.styles.fontWeight || 'normal'}`,
        `line-height:${el.styles.lineHeight || 'normal'}`,
        `letter-spacing:${el.styles.letterSpacing || 'normal'}`,
        `white-space:nowrap`,
      ].join(';')
      testDiv.textContent = el.content.replace(/<[^>]+>/g, '')
      document.body.appendChild(testDiv)
      const nowrapW = testDiv.scrollWidth
      testDiv.style.whiteSpace = 'pre-wrap'
      testDiv.style.wordBreak = 'break-word'
      const wrapW = testDiv.scrollWidth
      document.body.removeChild(testDiv)

      const wouldWrap = nowrapW > contentW

      return {
        text: (el.content || '').replace(/<[^>]+>/g, '').trim().substring(0, 40),
        width: Math.round(el.width * 10) / 10,
        height: Math.round(el.height * 10) / 10,
        padding: pad,
        padTotal: Math.round(padTotal * 10) / 10,
        contentW: Math.round(contentW * 10) / 10,
        nowrapW,
        wouldWrap,
        hasBorderRadius,
        borderRadius: el.styles.borderRadius || '0px',
        border: el.styles.border || 'none',
        merged: !!el.merged,
      }
    })
}, CANVAS_W, CANVAS_H)

console.log(`\n=== Slide ${SLIDE_INDEX + 1}: padding 있는 텍스트 요소 (${result.length}개) ===\n`)
result.forEach(r => {
  const flag = r.wouldWrap ? '🔴 WRAP' : '✅ OK'
  const br = r.hasBorderRadius ? ` br=${r.borderRadius}` : ''
  console.log(`${flag} "${r.text}"`)
  console.log(`  w=${r.width} pad=${r.padding} padTotal=${r.padTotal} contentW=${r.contentW}`)
  console.log(`  nowrapW=${r.nowrapW} wouldWrap=${r.wouldWrap}${br}`)
  console.log(`  border=${r.border} merged=${r.merged}`)
})

await browser.close()
