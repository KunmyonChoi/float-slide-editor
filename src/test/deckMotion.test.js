import { describe, it, expect } from 'vitest'
import {
  parseAnimAttrs, parseTransitionAttrs, readSlideNotes, dedent,
  resolveAnimSpecs, animToAttrs, transitionToAttrs, notesToScript, buildAnimNameMap,
} from '../core/deckMotion'
import { computeSteps } from '../core/slideAnimation'
import { exportFlatHtml, exportFlatHtmlAllPages } from '../core/FlatExporter'

/** 슬라이드 HTML 문자열 → .slide 요소 */
function slideOf(html) {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><body>${html}</body>`, 'text/html')
  return doc.querySelector('.slide') || doc.body
}

describe('parseAnimAttrs — 요소 모션 선언', () => {
  const el = (attrs) => slideOf(`<div class="slide"><div id="t" ${attrs}></div></div>`).querySelector('#t')

  it('data-anim이 없으면 null', () => {
    expect(parseAnimAttrs(el(''))).toBeNull()
  })

  it('none / 알 수 없는 효과는 무시(null)', () => {
    expect(parseAnimAttrs(el('data-anim="none"'))).toBeNull()
    expect(parseAnimAttrs(el('data-anim="explode"'))).toBeNull()
  })

  it('효과만 선언하면 나머지는 기본값(클릭 단계·500ms·지연 0)', () => {
    expect(parseAnimAttrs(el('data-anim="fadeIn"'))).toEqual({
      effect: 'fadeIn', durationMs: 500, delayMs: 0,
      trigger: { mode: 'click', refName: null }, name: null,
    })
  })

  it('slideIn만 방향을 갖는다(기본 up, 잘못된 값도 up)', () => {
    expect(parseAnimAttrs(el('data-anim="slideIn" data-anim-dir="left"')).dir).toBe('left')
    expect(parseAnimAttrs(el('data-anim="slideIn"')).dir).toBe('up')
    expect(parseAnimAttrs(el('data-anim="slideIn" data-anim-dir="sideways"')).dir).toBe('up')
    expect(parseAnimAttrs(el('data-anim="fadeIn" data-anim-dir="left"')).dir).toBeUndefined()
  })

  it('시간 값은 정수로 파싱하고 범위를 넘으면 자른다', () => {
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-duration="800"')).durationMs).toBe(800)
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-dur="800"')).durationMs).toBe(800)
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-duration="9"')).durationMs).toBe(50)
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-duration="abc"')).durationMs).toBe(500)
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-delay="250"')).delayMs).toBe(250)
    expect(parseAnimAttrs(el('data-anim="pop" data-anim-delay="-5"')).delayMs).toBe(0)
  })

  it('trigger와 참조 이름', () => {
    const a = parseAnimAttrs(el('data-anim="fadeIn" data-anim-trigger="after" data-anim-ref="hero" data-anim-name="sub"'))
    expect(a.trigger).toEqual({ mode: 'after', refName: 'hero' })
    expect(a.name).toBe('sub')
    // click/auto는 참조를 쓰지 않는다
    expect(parseAnimAttrs(el('data-anim="fadeIn" data-anim-trigger="auto" data-anim-ref="hero"')).trigger)
      .toEqual({ mode: 'auto', refName: null })
    // 알 수 없는 트리거는 click 폴백
    expect(parseAnimAttrs(el('data-anim="fadeIn" data-anim-trigger="hover"')).trigger.mode).toBe('click')
  })
})

describe('parseTransitionAttrs — 슬라이드 전환', () => {
  it('선언이 없거나 none이면 null', () => {
    expect(parseTransitionAttrs(slideOf('<div class="slide"></div>'))).toBeNull()
    expect(parseTransitionAttrs(slideOf('<div class="slide" data-transition="none"></div>'))).toBeNull()
    expect(parseTransitionAttrs(slideOf('<div class="slide" data-transition="spin"></div>'))).toBeNull()
  })

  it('type/기간/방향', () => {
    expect(parseTransitionAttrs(slideOf('<div class="slide" data-transition="fade"></div>')))
      .toEqual({ type: 'fade', durationMs: 400 })
    expect(parseTransitionAttrs(slideOf('<div class="slide" data-transition="slide" data-transition-dir="left" data-transition-duration="600"></div>')))
      .toEqual({ type: 'slide', durationMs: 600, dir: 'left' })
    // slide가 아니면 방향은 무시
    expect(parseTransitionAttrs(slideOf('<div class="slide" data-transition="zoom" data-transition-dir="left"></div>')).dir)
      .toBeUndefined()
  })
})

describe('readSlideNotes — 발표자 노트', () => {
  it('.fe-notes 스크립트의 원고를 들여쓰기 없이 읽는다', () => {
    const slide = slideOf(`<div class="slide">
      <div>제목</div>
      <script type="text/plain" class="fe-notes">
        여기서 첫 문장을 말합니다.

        그리고 다음 단락.
      </script>
    </div>`)
    expect(readSlideNotes(slide)).toBe('여기서 첫 문장을 말합니다.\n\n그리고 다음 단락.')
  })

  it('노트가 없으면 빈 문자열', () => {
    expect(readSlideNotes(slideOf('<div class="slide"><div>제목</div></div>'))).toBe('')
  })

  it('dedent는 공통 들여쓰기만 제거하고 상대 들여쓰기는 남긴다', () => {
    expect(dedent('\n    a\n      b\n    c\n')).toBe('a\n  b\nc')
  })
})

describe('resolveAnimSpecs — 선언 → element.anim 확정', () => {
  const specOf = (over = {}) => ({
    effect: 'fadeIn', durationMs: 500, delayMs: 0,
    trigger: { mode: 'click', refName: null }, name: null, ...over,
  })

  it('seq는 선언(호스트) 순서, 참조 없는 트리거는 그대로', () => {
    const els = [{ id: 'flat-1', _animIdx: 0 }, { id: 'flat-2', _animIdx: 1 }]
    resolveAnimSpecs(els, [specOf(), specOf({ effect: 'pop', trigger: { mode: 'auto', refName: null } })], new Map())
    expect(els[0].anim).toEqual({ effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click', ref: null }, seq: 0 })
    expect(els[1].anim.seq).toBe(1)
    expect(els[1].anim.trigger).toEqual({ mode: 'auto', ref: null })
    expect(els[0]._animIdx).toBeUndefined()   // 임시 필드는 제거
  })

  it('한 선언이 여러 요소를 낳으면 나머지는 with로 묶여 한 단계가 된다', () => {
    const els = [
      { id: 'flat-1', _animIdx: 0 }, { id: 'flat-2', _animIdx: 0 }, { id: 'flat-3', _animIdx: 0 },
    ]
    resolveAnimSpecs(els, [specOf()], new Map())
    expect(els[0].anim.trigger).toEqual({ mode: 'click', ref: null })
    expect(els[1].anim.trigger).toEqual({ mode: 'with', ref: 'flat-1' })
    expect(els[2].anim.trigger).toEqual({ mode: 'with', ref: 'flat-1' })
    expect(computeSteps(els).stepCount).toBe(1)
  })

  it('data-anim-ref는 대상 선언의 첫 요소 id로 해소된다', () => {
    const els = [{ id: 'flat-1', _animIdx: 0 }, { id: 'flat-2', _animIdx: 1 }]
    const specs = [specOf({ name: 'hero' }), specOf({ trigger: { mode: 'after', refName: 'hero' } })]
    resolveAnimSpecs(els, specs, new Map([['hero', 0]]))
    expect(els[1].anim.trigger).toEqual({ mode: 'after', ref: 'flat-1' })
    expect(computeSteps(els).stepCount).toBe(1) // after는 앞 단계에 이어붙는다
  })

  it('없는 이름을 참조하면 독립 클릭 단계로 폴백', () => {
    const els = [{ id: 'flat-1', _animIdx: 0 }, { id: 'flat-2', _animIdx: 1 }]
    const specs = [specOf(), specOf({ trigger: { mode: 'with', refName: '없음' } })]
    resolveAnimSpecs(els, specs, new Map())
    expect(els[1].anim.trigger).toEqual({ mode: 'click', ref: null })
    expect(computeSteps(els).stepCount).toBe(2)
  })

  it('선언 없는 요소는 건드리지 않는다', () => {
    const els = [{ id: 'flat-1' }]
    resolveAnimSpecs(els, [specOf()], new Map())
    expect(els[0].anim).toBeUndefined()
  })
})

describe('직렬화 — 내보낸 HTML을 다시 읽어도 같은 선언', () => {
  it('animToAttrs ↔ parseAnimAttrs 왕복', () => {
    const anim = { effect: 'slideIn', dir: 'left', durationMs: 700, delayMs: 120, trigger: { mode: 'after', ref: 'flat-9' }, seq: 3 }
    const attrs = animToAttrs(anim, (id) => (id === 'flat-9' ? 'a1' : null), null)
    const el = slideOf(`<div class="slide"><div id="t"${attrs}></div></div>`).querySelector('#t')
    const parsed = parseAnimAttrs(el)
    expect(parsed).toMatchObject({
      effect: 'slideIn', dir: 'left', durationMs: 700, delayMs: 120,
      trigger: { mode: 'after', refName: 'a1' },
    })
  })

  it('기본값은 속성으로 쓰지 않는다(HTML을 깔끔하게)', () => {
    expect(animToAttrs({ effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click' } }))
      .toBe(' data-anim="fadeIn"')
  })

  it('transitionToAttrs ↔ parseTransitionAttrs 왕복', () => {
    const attrs = transitionToAttrs({ type: 'slide', dir: 'up', durationMs: 250 })
    const slide = slideOf(`<div class="slide"${attrs}></div>`)
    expect(parseTransitionAttrs(slide)).toEqual({ type: 'slide', dir: 'up', durationMs: 250 })
  })

  it('notesToScript ↔ readSlideNotes 왕복(</script> 포함 원고도 원문 그대로)', () => {
    const notes = '첫 문장.\n\n</script> 같은 글자가 있어도 깨지지 않아야 한다.'
    const slide = slideOf(`<div class="slide">${notesToScript(notes)}</div>`)
    expect(slide.querySelector('.fe-notes')).not.toBeNull()
    expect(readSlideNotes(slide)).toBe(notes)          // 이스케이프가 되돌려진다
  })

  it('여러 번 내보내고 다시 읽어도 원고가 변형되지 않는다', () => {
    let notes = '</script> 반복 왕복'
    for (let i = 0; i < 3; i++) {
      notes = readSlideNotes(slideOf(`<div class="slide">${notesToScript(notes)}</div>`))
    }
    expect(notes).toBe('</script> 반복 왕복')          // 역슬래시가 쌓이지 않는다
  })

  it('buildAnimNameMap은 참조되는 요소에만 이름을 붙인다', () => {
    const els = [
      { id: 'flat-1' },
      { id: 'flat-2', anim: { effect: 'fadeIn', trigger: { mode: 'after', ref: 'flat-1' } } },
    ]
    const map = buildAnimNameMap(els)
    expect(map.get('flat-1')).toBe('a1')
    expect(map.has('flat-2')).toBe(false)
  })
})

describe('FlatExporter — 노트/모션이 실린 HTML 내보내기', () => {
  const CANVAS = { w: 1920, h: 1080 }
  const textEl = (id, over = {}) => ({
    id, type: 'text', x: 100, y: 100, width: 400, height: 80, zIndex: 1,
    content: '본문', isRich: false, styles: { color: '#111', fontSize: '40px' }, ...over,
  })

  it('현재 페이지 내보내기에 노트 스크립트와 data-anim이 담긴다', () => {
    const els = [textEl('flat-1', { anim: { effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click' }, seq: 0 } })]
    const html = exportFlatHtml(els, CANVAS, [], { notes: '여기서 이렇게 말한다', transition: { type: 'fade', durationMs: 400 } })
    expect(html).toContain('data-anim="fadeIn"')
    expect(html).toContain('class="fe-notes"')
    expect(html).toContain('여기서 이렇게 말한다')
    expect(html).toContain('data-transition="fade"')
  })

  it('노트/모션이 없으면 아무 것도 덧붙이지 않는다', () => {
    const html = exportFlatHtml([textEl('flat-1')], CANVAS)
    expect(html).not.toContain('fe-notes')
    expect(html).not.toContain('data-anim')
    expect(html).not.toContain('data-transition')
  })

  it('전체 페이지 내보내기 → 다시 파싱하면 선언이 그대로 살아난다', () => {
    const pages = {
      '0-0': {
        canvasSize: CANVAS,
        notes: '표지에서 할 말',
        transition: { type: 'slide', dir: 'left', durationMs: 600 },
        elements: [
          textEl('flat-1', { anim: { effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click' }, seq: 0 } }),
          textEl('flat-2', { y: 300, anim: { effect: 'slideIn', dir: 'up', durationMs: 700, delayMs: 150, trigger: { mode: 'after', ref: 'flat-1' }, seq: 1 } }),
        ],
      },
    }
    const html = exportFlatHtmlAllPages(pages)
    const slide = new DOMParser().parseFromString(html, 'text/html').querySelector('.slide')

    expect(readSlideNotes(slide)).toBe('표지에서 할 말')
    expect(parseTransitionAttrs(slide)).toEqual({ type: 'slide', dir: 'left', durationMs: 600 })

    const hosts = slide.querySelectorAll('[data-anim]')
    expect(hosts.length).toBe(2)
    const first = parseAnimAttrs(hosts[0])
    const second = parseAnimAttrs(hosts[1])
    expect(first.effect).toBe('fadeIn')
    expect(first.name).toBe('a1')                    // 참조 대상이므로 이름이 붙는다
    expect(second).toMatchObject({
      effect: 'slideIn', dir: 'up', durationMs: 700, delayMs: 150,
      trigger: { mode: 'after', refName: 'a1' },
    })
  })
})
