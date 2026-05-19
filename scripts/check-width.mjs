import puppeteer from 'puppeteer'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const PIPELINE_JS = './scripts/dist/pipeline.iife.js'
const pipelineJs = readFileSync(PIPELINE_JS, 'utf-8')
const sourceHtml = readFileSync('/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html', 'utf-8')

function makeSlideVisible(html, index) {
  let r = html.replace(/<script>[\s\S]*?window\.hasSlideNav[\s\S]*?<\/script>/m, '')
  r = r.replace(/class="slide active"/g, 'class="slide"').replace(/class="slide active /g, 'class="slide ')
  r = r.replace('</head>', `<style>.slide{display:none!important}.deck>.slide:nth-child(${index+1}){display:flex!important}</style></head>`)
  r = r.replace('<body>', '<body style="width:1280px;height:720px;overflow:hidden;margin:0;padding:0;">')
  return r
}

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-web-security'] })
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 720 })
await page.setContent(makeSlideVisible(sourceHtml, 0), { waitUntil: 'networkidle0' })
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 500))
await page.addScriptTag({ content: pipelineJs })
await page.evaluate((pj) => {
  const { html } = window.FlatPipeline.prepareHtmlForEditor('<!DOCTYPE html>\n' + document.documentElement.outerHTML)
  document.open(); document.write(html); document.close()
}, pipelineJs)
await page.evaluate(() => document.fonts.ready)
await new Promise(r => setTimeout(r, 500))
await page.addScriptTag({ content: pipelineJs })

const info = await page.evaluate(() => {
  const fakeRef = { current: { contentDocument: document, contentWindow: window } }
  const { elements } = window.FlatPipeline.extractFlatElements(fakeRef)
  return elements
    .filter(el => el.content && (el.content.includes('Energy') || el.content.includes('Cooling') || el.content.includes('Compute') || el.content.includes('운영')))
    .map(el => ({ content: el.content.replace(/<[^>]+>/g,''), w: Math.round(el.width), h: Math.round(el.height) }))
})

console.log(JSON.stringify(info, null, 2))
await browser.close()
