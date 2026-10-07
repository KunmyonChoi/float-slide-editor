import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseLoopAttrs, loopToAttrs } from '../core/deckMotion'
import { makeLoopAnim } from '../core/slideAnimation'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements } from '../core/FlatExtractor'

const elOf = (attrs) => new DOMParser().parseFromString(`<div id="t" ${attrs}></div>`, 'text/html').querySelector('#t')

describe('data-anim-loop 파싱/직렬화', () => {
  it('없거나 모르는 효과는 null', () => {
    expect(parseLoopAttrs(elOf(''))).toBeNull()
    expect(parseLoopAttrs(elOf('data-anim-loop="none"'))).toBeNull()
    expect(parseLoopAttrs(elOf('data-anim-loop="explode"'))).toBeNull()
    expect(parseLoopAttrs(elOf('data-anim-loop="constructor"'))).toBeNull()   // 프로토타입 키
    expect(loopToAttrs({ effect: 'toString' })).toBe('')
  })

  it('효과만 쓰면 효과별 기본 주기와 기본값', () => {
    expect(parseLoopAttrs(elOf('data-anim-loop="spin"'))).toEqual(
      { effect: 'spin', periodMs: 8000, intensity: 1, phaseMs: 0, start: 'afterEnter', repeat: 0 })
  })

  it('값은 범위로 자르고 잘못된 시작값은 기본으로', () => {
    const s = parseLoopAttrs(elOf('data-anim-loop="pulse" data-anim-loop-period="50" data-anim-loop-intensity="9" data-anim-loop-phase="-3" data-anim-loop-start="soon" data-anim-loop-repeat="500"'))
    expect(s).toEqual({ effect: 'pulse', periodMs: 200, intensity: 3, phaseMs: 0, start: 'afterEnter', repeat: 99 })
  })

  it('loopToAttrs ↔ parseLoopAttrs 왕복, 기본값은 속성으로 쓰지 않는다', () => {
    expect(loopToAttrs(null)).toBe('')
    expect(loopToAttrs({ effect: 'bogus' })).toBe('')
    expect(loopToAttrs(makeLoopAnim('float'))).toBe(' data-anim-loop="float"')
    const full = { effect: 'blink', periodMs: 700, intensity: 1.5, phaseMs: 250, start: 'withEnter', repeat: 4 }
    expect(parseLoopAttrs(elOf(loopToAttrs(full)))).toEqual(full)
  })
})

// jsdom은 레이아웃이 없으므로 인라인 left/top/width/height로 사각형을 흉내 낸다(부모 오프셋 누적).
function fakeRect() {
  let x = 0, y = 0
  for (let n = this.parentElement; n && n.tagName !== 'BODY'; n = n.parentElement) {
    x += parseFloat(n.style.left) || 0; y += parseFloat(n.style.top) || 0
  }
  x += parseFloat(this.style.left) || 0; y += parseFloat(this.style.top) || 0
  const w = this.tagName === 'BODY' ? 1920 : parseFloat(this.style.width) || 0
  const h = this.tagName === 'BODY' ? 1080 : parseFloat(this.style.height) || 0
  return { left: x, top: y, x, y, width: w, height: h, right: x + w, bottom: y + h }
}
function extract(html) {
  const { html: prepared } = prepareHtmlForEditor(html)
  // 추출기가 el.ownerDocument.defaultView를 쓰므로 창이 있는 전역 document에 그린다
  document.documentElement.innerHTML = new DOMParser().parseFromString(prepared, 'text/html').documentElement.innerHTML
  return extractFlatElements(document, window).elements.filter(e => !e.isBackground)
}

describe('HTML 가져오기 — el.loopAnim 복원', () => {
  let orig
  beforeEach(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = fakeRect })
  afterEach(() => { Element.prototype.getBoundingClientRect = orig })

  const box = (attrs, left = 100) =>
    `<div ${attrs} style="position:absolute;left:${left}px;top:100px;width:200px;height:100px;background:#f00;"></div>`

  it('반복만 / 등장+반복 / 등장 호스트 안쪽 아이콘의 반복이 각각 복원된다', () => {
    const els = extract(`<!DOCTYPE html><html><body><div class="slide active" style="position:absolute;left:0;top:0;width:1920px;height:1080px;">
      ${box('data-anim-loop="spin" data-anim-loop-period="20000"', 100)}
      ${box('data-anim="pop" data-anim-loop="pulse" data-anim-loop-start="withEnter"', 400)}
      <div data-anim="fadeIn" style="position:absolute;left:700px;top:100px;width:300px;height:200px;background:#00f;">
        <div data-anim-loop="float" data-anim-loop-phase="300" style="position:absolute;left:10px;top:10px;width:50px;height:50px;background:#0f0;"></div>
      </div>
    </div></body></html>`)
    const at = (x) => els.find(e => Math.round(e.x) === x)
    expect(at(100).loopAnim).toMatchObject({ effect: 'spin', periodMs: 20000 })
    expect(at(100).anim).toBeUndefined()
    expect(at(400).anim.effect).toBe('pop')
    expect(at(400).loopAnim).toMatchObject({ effect: 'pulse', start: 'withEnter' })
    expect(at(700).loopAnim).toBeUndefined()            // 카드 자체는 반복 없음
    expect(at(710).loopAnim).toMatchObject({ effect: 'float', phaseMs: 300 })
    expect(at(710).anim).toBeTruthy()                   // 카드의 등장 단계에 함께 묶인다
    expect(els.some(e => '_loopIdx' in e)).toBe(false)  // 임시 필드 정리
  })

  it('내보낸 HTML을 다시 가져오면 같은 반복 효과', () => {
    const loopAnim = { effect: 'wiggle', periodMs: 900, intensity: 2, phaseMs: 100, start: 'afterEnter', repeat: 0 }
    const html = exportFlatHtmlAllPages({
      '0-0': {
        canvasSize: { w: 1920, h: 1080 },
        elements: [{ id: 'flat-1', type: 'shape', x: 300, y: 200, width: 120, height: 80, zIndex: 1, content: '', isRich: false,
          styles: { backgroundColor: 'rgb(0, 128, 0)', borderRadius: '0px', opacity: '1' }, loopAnim }],
      },
    })
    expect(html).toContain('data-anim-loop="wiggle"')
    const back = extract(html).find(e => Math.round(e.x) === 300)
    expect(back.loopAnim).toEqual(loopAnim)
  })
})
