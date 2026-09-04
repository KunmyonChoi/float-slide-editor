#!/usr/bin/env node
/**
 * 덱 규약(발표자 노트 + 모션) 회귀 검사 — 실제 브라우저에서 추출기를 돌린다.
 *
 * 왜 vitest가 아니라 이 스크립트인가: FlatExtractor는 getBoundingClientRect와
 * getComputedStyle로 "렌더된 결과"를 읽는다. jsdom엔 레이아웃이 없어 요소가 하나도
 * 잡히지 않으므로 단위 테스트로는 이 경로를 덮을 수 없다. 실제로 그 공백 때문에
 * 병합 카드(플렉스 + 텍스트, SKILL.md 데모와 같은 모양)가 data-anim을 통째로
 * 잃는 버그가 리뷰 전까지 살아 있었다.
 *
 * 하는 일: 앱과 똑같이 prepareHtmlForEditor로 덱을 준비해 Chrome에 띄우고,
 * 슬라이드를 하나씩 활성화하며 extractFlatElements 결과를 확인한다.
 *
 * 실행: node scripts/check-deck-motion.mjs      (설치된 Chrome을 사용)
 *       실패하면 exit 1 + 어긋난 항목 출력.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer'

const DECK = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: 1920px; height: 1080px; overflow: hidden; position: relative; background: #0f172a; }
.slide { position: absolute; inset: 0; display: none; overflow: hidden; }
.slide.active { display: block; }
</style></head><body>

<div class="slide active" data-transition="fade" style="width:1920px;height:1080px;background:#0f172a;font-family:sans-serif;">
  <div data-anim="fadeIn" data-anim-trigger="auto" style="position:absolute;left:120px;top:120px;width:1680px;height:105px;font-size:72px;font-weight:900;color:#f8fafc;">핵심 지표</div>
  <!-- 병합 카드: 플렉스 컨테이너 + 텍스트 한 줄 → 하나의 텍스트 요소로 병합된다 -->
  <div data-anim="slideIn" data-anim-dir="up" data-anim-name="m1" style="position:absolute;left:120px;top:300px;width:540px;height:360px;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:30px;display:flex;align-items:center;justify-content:center;color:#818cf8;font-size:84px;font-weight:900;">+38%</div>
  <div data-anim="fadeIn" data-anim-trigger="with" data-anim-ref="m1" style="position:absolute;left:120px;top:690px;width:540px;height:75px;font-size:33px;color:#cbd5e1;text-align:center;">매출 성장</div>
  <!-- 한 선언 → 여러 요소(li 둘): 한 단계로 묶여야 한다 -->
  <div data-anim="fadeIn" style="position:absolute;left:760px;top:300px;width:1040px;height:300px;font-size:40px;color:#e2e8f0;line-height:1.8;">
    <ul style="padding-left:1.2em;"><li>첫 번째 항목</li><li>두 번째 항목</li></ul>
  </div>
  <script type="text/plain" class="fe-notes">
    첫 장 원고입니다.

    둘째 문단.
  </script>
</div>

<!-- 배경과 원고만 있는 간지: 원고가 텍스트 요소로 새면 안 된다 -->
<div class="slide" data-transition="zoom" style="width:1920px;height:1080px;background:#111827;">
  <script type="text/plain" class="fe-notes">잠깐 쉬어 가는 장. 원고만 있습니다.</script>
</div>

</body></html>`

const EXTRACT = `async () => {
  const { extractFlatElements } = await import('/src/core/FlatExtractor.js')
  const r = extractFlatElements(document, window)
  return {
    notes: r.notes,
    transition: r.transition,
    els: r.elements.filter(e => !e.isBackground).map(e => ({
      id: e.id, type: e.type,
      text: (e.content || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
      anim: e.anim || null,
    })),
  }
}`

const problems = []
const check = (ok, label, got) => { if (!ok) problems.push(`${label}  ← ${JSON.stringify(got)}`) }

/**
 * 저장소를 그대로 서빙하는 최소 정적 서버.
 * 번들러 없이 페이지에서 `import('/src/core/FlatExtractor.js')`로 원본 모듈을 쓰기 위함
 * (file://에서는 모듈 import가 막힌다).
 */
function serveRepo() {
  const root = process.cwd()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!DOCTYPE html><body>'); return }
    const file = path.join(root, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/plain' })
      res.end(body)
    } catch { res.writeHead(404); res.end('not found') }
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })))
}

async function main() {
  const { server, port } = await serveRepo()
  // 설치된 Chrome 사용 — puppeteer가 내려받은 크로미움이 없어도 돌아간다.
  const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new' })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    await page.goto(`http://127.0.0.1:${port}/`)
    // 앱과 동일한 준비 단계(data-editor-id 부여 + 에이전트 주입)
    await page.evaluate(async (raw) => {
      const { prepareHtmlForEditor } = await import('/src/core/ElementRegistry.js')
      const { html } = prepareHtmlForEditor(raw)
      document.open(); document.write(html); document.close()
    }, DECK)
    await new Promise(r => setTimeout(r, 400))

    const read = async (index) => {
      await page.evaluate((i) => {
        document.querySelectorAll('.slide').forEach((el, j) => el.classList.toggle('active', i === j))
      }, index)
      await new Promise(r => setTimeout(r, 250))
      return page.evaluate(`(${EXTRACT})()`)   // 문자열은 표현식으로 평가되므로 즉시 호출
    }

    // ── 1장: 제목(auto) + 병합 카드 + 캡션(with) + 목록(li 둘) ──
    const s1 = await read(0)
    check(s1.notes === '첫 장 원고입니다.\n\n둘째 문단.', '1장 노트를 그대로 읽는다', s1.notes)
    check(s1.transition?.type === 'fade', '1장 전환은 fade', s1.transition)
    check(s1.els.length === 5, '1장 요소 5개(제목·카드·캡션·li 둘)', s1.els.map(e => e.text))

    const title = s1.els.find(e => e.text === '핵심 지표')
    check(title?.anim?.trigger.mode === 'auto', '제목은 auto', title?.anim)

    // 병합 카드(플렉스+텍스트)가 data-anim을 잃지 않는지 — 과거 회귀 지점
    const card = s1.els.find(e => e.text === '+38%')
    check(card?.anim?.effect === 'slideIn' && card?.anim?.dir === 'up',
      '병합 카드가 모션을 갖는다(회귀 지점)', card?.anim)

    // 캡션의 data-anim-ref가 그 카드의 flat id로 해소되는지
    const caption = s1.els.find(e => e.text === '매출 성장')
    check(caption?.anim?.trigger.mode === 'with' && caption?.anim?.trigger.ref === card?.id,
      '캡션의 with 참조가 카드로 해소된다', { ref: caption?.anim?.trigger.ref, card: card?.id })

    // <ul> 하나의 선언 → li 둘이 같은 단계
    const lis = s1.els.filter(e => e.text.includes('항목'))
    check(lis.length === 2 && lis[0].anim?.seq === lis[1].anim?.seq
      && lis[1].anim?.trigger.mode === 'with' && lis[1].anim?.trigger.ref === lis[0].id,
      '목록 두 항목이 한 단계로 묶인다', lis.map(e => e.anim))

    // ── 2장: 배경 + 원고만 ──
    const s2 = await read(1)
    check(s2.notes === '잠깐 쉬어 가는 장. 원고만 있습니다.', '2장 노트를 읽는다', s2.notes)
    check(s2.transition?.type === 'zoom', '2장 전환은 zoom', s2.transition)
    check(s2.els.length === 0, '원고가 텍스트 요소로 새지 않는다', s2.els)
  } finally {
    await browser.close()
    server.close()
  }

  if (problems.length) {
    console.error(`\n덱 모션 규약 검사 실패 ${problems.length}건:\n`)
    for (const p of problems) console.error('  ✗ ' + p)
    process.exit(1)
  }
  console.log('OK — 덱 모션 규약(노트·병합 카드·참조 해소·목록 묶음) 정상.')
}

main().catch((e) => { console.error(e); process.exit(1) })
