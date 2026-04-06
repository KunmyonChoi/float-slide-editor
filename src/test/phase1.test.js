import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { prepareHtmlForEditor, resetCounter, exportCleanHtml } from '../core/ElementRegistry'
import { SelectionManager } from '../core/SelectionManager'

// ── 테스트 픽스처 ──────────────────────────────────────────────
const SIMPLE_HTML = `<!DOCTYPE html><html><head><title>Test</title></head><body>
  <div>
    <h1>제목</h1>
    <p>단락 텍스트</p>
    <img src="test.png" alt="테스트 이미지" />
    <div><span>인라인 텍스트</span></div>
  </div>
</body></html>`

const NAV_HTML = `<!DOCTYPE html><html><body>
  <div class="slide active"><h1>슬라이드 1</h1></div>
  <div class="slide"><h1>슬라이드 2</h1></div>
  <div id="nav">
    <button onclick="nav(-1)">‹</button>
    <button onclick="nav(1)">›</button>
  </div>
  <script>
    var cur = 0;
    var slides = document.querySelectorAll('.slide');
    function nav(d) { cur += d; }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight') nav(1);
    });
    document.addEventListener('click', function(e) {
      if (e.clientX > window.innerWidth / 2) nav(1);
    });
  </script>
</body></html>`

// ═══════════════════════════════════════════════════════════════
//  prepareHtmlForEditor
// ═══════════════════════════════════════════════════════════════
describe('prepareHtmlForEditor — HTML 파싱 및 에디터 준비', () => {
  it('편집 가능한 요소에 data-editor-id가 부여된다', () => {
    const { elements } = prepareHtmlForEditor(SIMPLE_HTML)
    expect(elements.size).toBeGreaterThan(0)
    for (const [, meta] of elements) {
      expect(meta.id).toMatch(/^fe-\d+$/)
    }
  })

  it('반환된 html에 data-editor-id와 data-editor-type 속성이 포함된다', () => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    expect(html).toContain('data-editor-id')
    expect(html).toContain('data-editor-type')
  })

  it('전체 HTML 문서 구조가 유지된다 (<!DOCTYPE>, <html>, <head>, <body>)', () => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<html')
    expect(html).toContain('<head')
    expect(html).toContain('<body')
  })

  it('resetCounter() 호출 시 id 카운터가 초기화된다', () => {
    resetCounter()
    const { elements: e1 } = prepareHtmlForEditor(SIMPLE_HTML)
    const ids1 = [...e1.keys()]
    resetCounter()
    const { elements: e2 } = prepareHtmlForEditor(SIMPLE_HTML)
    const ids2 = [...e2.keys()]
    expect(ids1).toEqual(ids2)
  })
})

// ═══════════════════════════════════════════════════════════════
//  타입 분류 (text / image / container)
// ═══════════════════════════════════════════════════════════════
describe('prepareHtmlForEditor — 타입 분류', () => {
  let elements

  beforeEach(() => {
    resetCounter()
    ;({ elements } = prepareHtmlForEditor(SIMPLE_HTML))
  })

  it('img → image 타입', () => {
    const images = [...elements.values()].filter((m) => m.type === 'image')
    expect(images).toHaveLength(1)
    expect(images[0].tag).toBe('img')
  })

  it('h1, p, span → text 타입', () => {
    const tags = [...elements.values()].filter((m) => m.type === 'text').map((m) => m.tag)
    expect(tags).toContain('h1')
    expect(tags).toContain('p')
    expect(tags).toContain('span')
  })

  it('div → container 타입', () => {
    const containers = [...elements.values()].filter((m) => m.type === 'container')
    expect(containers.length).toBeGreaterThan(0)
    expect(containers.every((m) => m.tag === 'div')).toBe(true)
  })

  it('각 요소 메타에 id, tag, type 필드가 존재한다', () => {
    for (const [, meta] of elements) {
      expect(meta).toHaveProperty('id')
      expect(meta).toHaveProperty('tag')
      expect(meta).toHaveProperty('type')
      expect(['text', 'image', 'container']).toContain(meta.type)
    }
  })
})

// ═══════════════════════════════════════════════════════════════
//  확장된 태그 분류 — 추가 태그 지원
// ═══════════════════════════════════════════════════════════════
describe('prepareHtmlForEditor — 확장 태그 분류', () => {
  const EXTENDED_HTML = `<!DOCTYPE html><html><body>
    <pre>코드 블록</pre>
    <code>인라인 코드</code>
    <blockquote>인용문</blockquote>
    <dl><dt>정의 제목</dt><dd>정의 내용</dd></dl>
    <ul><li>목록 항목</li></ul>
    <ol><li>순서 항목</li></ol>
    <details><summary>요약</summary></details>
  </body></html>`

  it('pre → text 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const pre = [...elements.values()].find(m => m.tag === 'pre')
    expect(pre).toBeDefined()
    expect(pre.type).toBe('text')
  })

  it('code → text 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const code = [...elements.values()].find(m => m.tag === 'code')
    expect(code).toBeDefined()
    expect(code.type).toBe('text')
  })

  it('blockquote → text 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const bq = [...elements.values()].find(m => m.tag === 'blockquote')
    expect(bq).toBeDefined()
    expect(bq.type).toBe('text')
  })

  it('dt, dd → text 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const dt = [...elements.values()].find(m => m.tag === 'dt')
    const dd = [...elements.values()].find(m => m.tag === 'dd')
    expect(dt).toBeDefined()
    expect(dt.type).toBe('text')
    expect(dd).toBeDefined()
    expect(dd.type).toBe('text')
  })

  it('ul, ol → container 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const ul = [...elements.values()].find(m => m.tag === 'ul')
    const ol = [...elements.values()].find(m => m.tag === 'ol')
    expect(ul).toBeDefined()
    expect(ul.type).toBe('container')
    expect(ol).toBeDefined()
    expect(ol.type).toBe('container')
  })

  it('dl → container 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const dl = [...elements.values()].find(m => m.tag === 'dl')
    expect(dl).toBeDefined()
    expect(dl.type).toBe('container')
  })

  it('details, summary → container 타입', () => {
    resetCounter()
    const { elements } = prepareHtmlForEditor(EXTENDED_HTML)
    const details = [...elements.values()].find(m => m.tag === 'details')
    const summary = [...elements.values()].find(m => m.tag === 'summary')
    expect(details).toBeDefined()
    expect(details.type).toBe('container')
    expect(summary).toBeDefined()
    expect(summary.type).toBe('container')
  })
})

// ═══════════════════════════════════════════════════════════════
//  SelectionManager
// ═══════════════════════════════════════════════════════════════
describe('SelectionManager', () => {
  let manager, root

  beforeEach(() => {
    manager = new SelectionManager()
    root = document.createElement('div')
    root.innerHTML = `
      <p data-editor-id="el-1">텍스트</p>
      <p data-editor-id="el-2">다른 텍스트</p>
    `
    document.body.appendChild(root)
    manager.attach(root)
  })

  afterEach(() => {
    manager.detach()
    document.body.removeChild(root)
  })

  it('select(id) → selected가 해당 id', () => {
    manager.select('el-1')
    expect(manager.selected).toBe('el-1')
  })

  it('select(id) → DOM에 data-editor-selected="true" 부여', () => {
    manager.select('el-1')
    expect(root.querySelector('[data-editor-id="el-1"]').getAttribute('data-editor-selected')).toBe('true')
  })

  it('deselect() → selected가 null', () => {
    manager.select('el-1')
    manager.deselect()
    expect(manager.selected).toBeNull()
  })

  it('deselect() → data-editor-selected 속성 제거', () => {
    manager.select('el-1')
    manager.deselect()
    expect(root.querySelector('[data-editor-id="el-1"]').hasAttribute('data-editor-selected')).toBe(false)
  })

  it('다른 요소 선택 시 이전 선택이 해제된다', () => {
    manager.select('el-1')
    manager.select('el-2')
    expect(root.querySelector('[data-editor-id="el-1"]').hasAttribute('data-editor-selected')).toBe(false)
    expect(manager.selected).toBe('el-2')
  })

  it('같은 id를 다시 select해도 콜백이 중복 호출되지 않는다', () => {
    const calls = []
    manager.subscribe((id) => calls.push(id))
    manager.select('el-1')
    manager.select('el-1')
    expect(calls).toEqual(['el-1'])
  })

  it('subscribe 콜백이 select/deselect마다 호출된다', () => {
    const calls = []
    manager.subscribe((id) => calls.push(id))
    manager.select('el-1')
    manager.select('el-2')
    manager.deselect()
    expect(calls).toEqual(['el-1', 'el-2', null])
  })

  it('unsubscribe 후 콜백이 호출되지 않는다', () => {
    const calls = []
    const unsub = manager.subscribe((id) => calls.push(id))
    manager.select('el-1')
    unsub()
    manager.select('el-2')
    expect(calls).toEqual(['el-1'])
  })

  it('detach 후 DOM에 data-editor-selected 잔여물이 없다', () => {
    manager.select('el-1')
    manager.detach()
    expect(root.querySelector('[data-editor-selected]')).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════
//  에디터 에이전트 — 슬라이드 네비게이션 보존
// ═══════════════════════════════════════════════════════════════
describe('에디터 에이전트 — 슬라이드 네비게이션 보존', () => {
  it('에이전트 스크립트가 __fe-agent id로 주입된다', () => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    expect(html).toContain('id="__fe-agent"')
    expect(html).toContain('__floatEditorAgentLoaded')
  })

  it('슬라이드 자체 keydown/click 스크립트가 제거되지 않는다', () => {
    const { html } = prepareHtmlForEditor(NAV_HTML)
    expect(html).toContain('ArrowRight')
    expect(html).toContain("e.clientX > window.innerWidth / 2")
  })

  it('슬라이드 자체 함수(nav)가 보존된다', () => {
    const { html } = prepareHtmlForEditor(NAV_HTML)
    expect(html).toContain('function nav(d)')
  })
})

// ═══════════════════════════════════════════════════════════════
//  에디터 에이전트 — 편집/발표 모드
// ═══════════════════════════════════════════════════════════════
describe('에디터 에이전트 — 모드 전환', () => {
  let agentCode

  beforeEach(() => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    agentCode = html.slice(html.indexOf('__floatEditorAgentLoaded'))
  })

  it('fe:setMode 메시지 핸들러가 존재한다', () => {
    expect(agentCode).toContain('fe:setMode')
  })

  it("발표 모드에서 클릭 개입을 건너뛰는 조건 (__feMode !== 'edit') 이 존재한다", () => {
    expect(agentCode).toContain("__feMode !== 'edit'")
  })

  it('발표 모드 진입 시 모든 data-editor-selected가 제거된다', () => {
    expect(agentCode).toContain('data-editor-selected')
    expect(agentCode).toContain('removeAttribute')
  })

  it('발표 모드 진입 시 __fe-style이 비활성화된다', () => {
    expect(agentCode).toContain('st.disabled = true')
  })

  it('편집 모드 복귀 시 __fe-style이 활성화된다', () => {
    expect(agentCode).toContain('st.disabled = false')
  })
})

// ═══════════════════════════════════════════════════════════════
//  에디터 에이전트 — 네비게이션 버튼 클릭 통과
// ═══════════════════════════════════════════════════════════════
describe('에디터 에이전트 — 네비게이션 요소 클릭 통과', () => {
  let agentCode

  beforeEach(() => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    agentCode = html.slice(html.indexOf('__floatEditorAgentLoaded'))
  })

  it('isSlideInteractive 함수가 존재한다', () => {
    expect(agentCode).toContain('isSlideInteractive')
  })

  it('<button> 태그를 인터랙티브로 판단한다', () => {
    expect(agentCode).toContain("tag === 'button'")
  })

  it('onclick 속성을 가진 요소를 인터랙티브로 판단한다', () => {
    expect(agentCode).toContain("getAttribute('onclick')")
  })

  it('<a href> 요소를 인터랙티브로 판단한다', () => {
    expect(agentCode).toContain("getAttribute('href')")
  })

  it('input[type=button/submit/reset]을 인터랙티브로 판단한다', () => {
    expect(agentCode).toContain("tag === 'input'")
    expect(agentCode).toContain("'submit'")
    expect(agentCode).toContain("'reset'")
  })

  it('인터랙티브 요소 감지 시 stopPropagation 없이 fe:deselect만 전송한다', () => {
    // isSlideInteractive(el) 가 참일 때의 분기가 stopPropagation보다 먼저 나와야 함
    const navPos = agentCode.indexOf('isSlideInteractive(el)')
    const stopPos = agentCode.indexOf('stopPropagation')
    expect(navPos).toBeGreaterThan(-1)
    expect(stopPos).toBeGreaterThan(-1)
    expect(navPos).toBeLessThan(stopPos)
  })
})

// ═══════════════════════════════════════════════════════════════
//  에디터 에이전트 — iframe 명령 수신
// ═══════════════════════════════════════════════════════════════
describe('에디터 에이전트 — 부모 명령 수신', () => {
  let agentCode

  beforeEach(() => {
    const { html } = prepareHtmlForEditor(SIMPLE_HTML)
    agentCode = html.slice(html.indexOf('__floatEditorAgentLoaded'))
  })

  it('fe:highlight 명령 핸들러가 존재한다', () => {
    expect(agentCode).toContain("e.data.type === 'fe:highlight'")
  })

  it('fe:setText 명령 핸들러가 존재한다', () => {
    expect(agentCode).toContain("e.data.type === 'fe:setText'")
  })

  it('fe:setStyle 명령 핸들러가 존재한다', () => {
    expect(agentCode).toContain("e.data.type === 'fe:setStyle'")
  })

  it('fe:setAttribute 명령 핸들러가 존재한다', () => {
    expect(agentCode).toContain("e.data.type === 'fe:setAttribute'")
  })

  it('fe: 접두사가 아닌 메시지는 무시한다', () => {
    expect(agentCode).toContain("!e.data.type.startsWith('fe:')")
  })

  it('goto 메시지 핸들러가 존재한다', () => {
    expect(agentCode).toContain("e.data.type === 'goto'")
  })

  it('goto 핸들러에서 .slide 직접 DOM 조작을 수행한다', () => {
    const gotoPos = agentCode.indexOf("e.data.type === 'goto'")
    // 직접 DOM 조작: querySelectorAll('.slide') 사용
    const slideQueryInGoto = agentCode.indexOf("querySelectorAll('.slide')", gotoPos)
    expect(slideQueryInGoto).toBeGreaterThan(gotoPos)
  })

  it('fe:navigate 핸들러에서 .slide 직접 DOM 조작을 수행한다', () => {
    const navPos = agentCode.indexOf("e.data.type === 'fe:navigate'")
    // 직접 DOM 조작: querySelectorAll('.slide') 사용
    const slideQueryInNav = agentCode.indexOf("querySelectorAll('.slide')", navPos)
    expect(slideQueryInNav).toBeGreaterThan(navPos)
  })
})

// ═══════════════════════════════════════════════════════════════
//  캔버스 크기 프리셋
// ═══════════════════════════════════════════════════════════════
describe('CanvasSizeSelector — 캔버스 크기 프리셋', () => {
  let CANVAS_PRESETS

  beforeEach(async () => {
    ;({ CANVAS_PRESETS } = await import('../components/CanvasSizeSelector.jsx'))
  })

  it('첫 번째 프리셋이 자동 감지(auto)이다', () => {
    expect(CANVAS_PRESETS[0].id).toBe('auto')
    expect(CANVAS_PRESETS[0].w).toBeNull()
    expect(CANVAS_PRESETS[0].h).toBeNull()
  })

  it('기본 해상도 1280×800이 존재하고 (기본) 표시가 있다', () => {
    const p = CANVAS_PRESETS.find((p) => p.w === 1280 && p.h === 800)
    expect(p).toBeDefined()
    expect(p.ratio).toContain('기본')
  })

  it('16:9 주요 해상도가 포함된다 (720, 768, 900, 1080, 1440)', () => {
    const heights = CANVAS_PRESETS.filter((p) => p.w !== null).map((p) => p.h)
    expect(heights).toContain(720)
    expect(heights).toContain(768)
    expect(heights).toContain(900)
    expect(heights).toContain(1080)
    expect(heights).toContain(1440)
  })

  it('16:10 해상도가 포함된다 (800, 900, 1050, 1200)', () => {
    const sizes = CANVAS_PRESETS.filter((p) => p.ratio?.includes('10')).map((p) => `${p.w}x${p.h}`)
    expect(sizes).toContain('1280x800')
    expect(sizes).toContain('1440x900')
    expect(sizes).toContain('1680x1050')
    expect(sizes).toContain('1920x1200')
  })

  it('모든 프리셋의 id가 고유하다', () => {
    const ids = CANVAS_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('auto 이외의 프리셋이 너비 오름차순으로 정렬되어 있다', () => {
    const sized = CANVAS_PRESETS.filter((p) => p.w !== null)
    for (let i = 1; i < sized.length; i++) {
      expect(sized[i].w * 10000 + sized[i].h).toBeGreaterThanOrEqual(
        sized[i - 1].w * 10000 + sized[i - 1].h
      )
    }
  })
})

// ═══════════════════════════════════════════════════════════════
//  exportCleanHtml
// ═══════════════════════════════════════════════════════════════
describe('exportCleanHtml — 클린 HTML 내보내기', () => {
  it('data-editor-id, data-editor-type, data-editor-selected 속성이 모두 제거된다', () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <p data-editor-id="fe-1" data-editor-type="text" data-editor-selected="true">텍스트</p>
        <div data-editor-id="fe-2" data-editor-type="container">컨테이너</div>
        <script id="__fe-agent">/* agent */</script>
        <style id="__fe-style">/* style */</style>
      </body></html>`,
      'text/html'
    )
    const clean = exportCleanHtml(doc)
    expect(clean).not.toContain('data-editor-id')
    expect(clean).not.toContain('data-editor-type')
    expect(clean).not.toContain('data-editor-selected')
  })

  it('__fe-agent 스크립트와 __fe-style이 제거된다', () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <p>내용</p>
        <script id="__fe-agent">/* agent */</script>
        <style id="__fe-style">/* style */</style>
      </body></html>`,
      'text/html'
    )
    const clean = exportCleanHtml(doc)
    expect(clean).not.toContain('__fe-agent')
    expect(clean).not.toContain('__fe-style')
  })

  it('원본 콘텐츠는 보존된다', () => {
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <h1 data-editor-id="fe-1" data-editor-type="text">슬라이드 제목</h1>
        <p data-editor-id="fe-2" data-editor-type="text">본문 내용</p>
        <img data-editor-id="fe-3" data-editor-type="image" src="photo.png" />
        <script id="__fe-agent">/* agent */</script>
      </body></html>`,
      'text/html'
    )
    const clean = exportCleanHtml(doc)
    expect(clean).toContain('슬라이드 제목')
    expect(clean).toContain('본문 내용')
    expect(clean).toContain('src="photo.png"')
  })

  it('DOCTYPE html이 포함된 완전한 HTML 문서를 반환한다', () => {
    const doc = new DOMParser().parseFromString(
      `<html><body><p>테스트</p></body></html>`, 'text/html'
    )
    const clean = exportCleanHtml(doc)
    expect(clean).toMatch(/^<!DOCTYPE html>/)
    expect(clean).toContain('<html')
  })
})
