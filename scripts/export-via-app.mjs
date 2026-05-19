/**
 * export-via-app.mjs
 * float-editor 앱을 Puppeteer로 열어 HTML을 로드하고 전체 페이지를 PNG로 내보낸다.
 *
 * 사용법:
 *   node scripts/export-via-app.mjs [source-html] [output-dir] [app-url]
 *
 * 기본값:
 *   source:    /home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html
 *   output-dir: scripts/exported-pngs/
 *   app-url:   http://localhost:5173
 *
 * 사전 조건: npm run dev (Vite 개발 서버)가 실행 중이어야 합니다.
 */

import puppeteer from 'puppeteer'
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createServer } from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SOURCE_HTML = process.argv[2]
  || '/home/kunmyon/Slide-editor/slides/AI DC Study Book_slides.html'
const OUTPUT_DIR = process.argv[3]
  || resolve(__dirname, 'exported-pngs')
const APP_URL = process.argv[4] || 'http://localhost:5173'

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  const sourceHtml = readFileSync(SOURCE_HTML, 'utf-8')
  const slideCount = (sourceHtml.match(/class="slide"/g) || []).length
  console.log(`슬라이드 수: ${slideCount}`)
  console.log(`앱 URL: ${APP_URL}`)

  // 앱이 실행 중인지 확인
  try {
    const res = await fetch(APP_URL)
    if (!res.ok) throw new Error('앱 응답 오류')
  } catch (e) {
    console.error(`❌ 앱에 연결할 수 없습니다: ${APP_URL}`)
    console.error('   npm run dev 로 개발 서버를 먼저 실행하세요.')
    process.exit(1)
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1440, height: 900 },
  })

  const page = await browser.newPage()

  // 파일 다운로드 디렉토리 설정
  const client = await page.createCDPSession()
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: OUTPUT_DIR,
  })

  console.log('앱 로딩...')
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 30000 })
  await new Promise(r => setTimeout(r, 1000))

  // HTML 파일 로드: 파일 입력 대신 store를 직접 조작
  console.log('HTML 파일 로드 중...')
  await page.evaluate((html) => {
    // React 앱의 store에 직접 접근
    const event = new CustomEvent('__load-html-for-test', { detail: { html } })
    document.dispatchEvent(event)
  }, sourceHtml)

  // 앱이 HTML 로드 이벤트를 수신하는지 확인
  // 앱에 이벤트 리스너가 없다면 파일 드롭 시뮬레이션
  await new Promise(r => setTimeout(r, 2000))

  // flat 변환이 완료되었는지 확인 (캔버스 요소 등장)
  const hasCanvas = await page.evaluate(() => {
    return !!document.querySelector('[data-flat-canvas]')
  })

  if (!hasCanvas) {
    console.log('캔버스가 없음 — 파일 입력 방식으로 재시도...')
    // 파일 선택 대화상자 없이 로드하는 방법이 필요
    // 앱의 내부 API를 직접 호출
    const loaded = await page.evaluate(async (html) => {
      // window.__flatStore 또는 zustand store에 접근 시도
      const storeEl = document.querySelector('[data-testid="load-html"]')
      if (storeEl) {
        storeEl.dispatchEvent(new Event('click'))
        return false
      }
      return false
    }, sourceHtml)

    if (!loaded) {
      console.error('앱에서 HTML 로드 방법을 찾지 못했습니다.')
      console.error('앱에 __loadHtmlForTest 훅을 추가해야 합니다.')
      await browser.close()
      process.exit(1)
    }
  }

  await browser.close()
  console.log('완료')
}

main().catch(e => { console.error(e); process.exit(1) })
