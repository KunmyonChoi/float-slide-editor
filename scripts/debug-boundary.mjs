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

// Detailed boundary condition debug for "Energy Supply" and similar elements
const result = await page.evaluate(() => {
  const textEls = [...document.querySelectorAll('[data-editor-type="text"]')]
  return textEls.filter(el => {
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height < 50 && rect.y > 400
  }).map(el => {
    const rect = el.getBoundingClientRect()
    const cs = window.getComputedStyle(el)

    // Measure nowrap
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

    const width = rect.width
    const nowrapWidth = nowrapRect.width
    const diff = nowrapWidth - width

    // Check boundary conditions (matching FlatExtractor logic)
    const bgColor = cs.backgroundColor
    const hasBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent'
    const bgClip = cs.webkitBackgroundClip
    const bgImage = cs.backgroundImage
    const hasGradientText = bgClip === 'text' || (bgImage && bgImage !== 'none')
    const textAlign = cs.textAlign
    const isLeftAligned = !textAlign || textAlign === 'start' || textAlign === 'left'

    // Parent info
    const parent = el.parentElement
    const parentCs = parent ? window.getComputedStyle(parent) : null
    const parentBg = parentCs ? parentCs.backgroundColor : 'N/A'
    const parentDisplay = parentCs ? parentCs.display : 'N/A'
    const parentTextAlign = parentCs ? parentCs.textAlign : 'N/A'

    return {
      text: (el.textContent || '').trim().substring(0, 30),
      width: width.toFixed(2),
      nowrapWidth: nowrapWidth.toFixed(2),
      diff: diff.toFixed(2),
      // Condition checks
      cond1_nowrapGtWidthPlus2: nowrapWidth > width + 2,
      cond2_boundary: nowrapWidth > 0 && nowrapWidth >= width - 1,
      hasBg,
      bgColor,
      hasGradientText,
      bgClip,
      bgImage: bgImage ? bgImage.substring(0, 50) : '',
      textAlign,
      isLeftAligned,
      wouldFix: !hasBg && !hasGradientText && isLeftAligned,
      // Parent
      parentTag: parent ? parent.tagName : 'N/A',
      parentBg,
      parentDisplay,
      parentTextAlign,
    }
  })
})

result.forEach(r => {
  const status = r.cond1_nowrapGtWidthPlus2 ? '🔴 WRAP(+2)' :
                 r.cond2_boundary ? (r.wouldFix ? '🟢 FIX-APPLIES' : '🟡 BOUNDARY-BLOCKED') :
                 '✅ OK'
  console.log(`\n${status} "${r.text}"`)
  console.log(`  w=${r.width} nowrap=${r.nowrapWidth} diff=${r.diff}`)
  console.log(`  cond1(nowrap>w+2)=${r.cond1_nowrapGtWidthPlus2} cond2(boundary)=${r.cond2_boundary}`)
  console.log(`  hasBg=${r.hasBg} bg="${r.bgColor}"`)
  console.log(`  hasGradientText=${r.hasGradientText} bgClip="${r.bgClip}"`)
  console.log(`  textAlign="${r.textAlign}" isLeftAligned=${r.isLeftAligned}`)
  console.log(`  wouldFix=${r.wouldFix}`)
  console.log(`  parent: <${r.parentTag}> display=${r.parentDisplay} textAlign=${r.parentTextAlign}`)
})
await browser.close()
