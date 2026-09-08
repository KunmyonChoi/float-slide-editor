import { describe, it, expect } from 'vitest'
import {
  animObjectName, buildTransitionXml, buildTimingXml, readSpids, injectSlideMotion,
} from '../core/PptMotion'

const el = (id, anim) => ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, styles: {}, anim })
const anim = (over = {}) => ({
  effect: 'fadeIn', durationMs: 500, delayMs: 0, trigger: { mode: 'click', ref: null }, seq: 0, ...over,
})
const spids = (obj) => new Map(Object.entries(obj))
const cvNode = (id, name) => `<p:cNvPr id="${id}" name="${name}"/>`

describe('PptMotion — 전환', () => {
  it('fade / slide(dir) / zoom을 PowerPoint 전환으로 옮긴다', () => {
    expect(buildTransitionXml({ type: 'fade', durationMs: 400 })).toContain('<p:fade/>')
    expect(buildTransitionXml({ type: 'slide', dir: 'left', durationMs: 400 })).toContain('<p:push dir="l"/>')
    expect(buildTransitionXml({ type: 'zoom', durationMs: 400 })).toContain('<p:zoom dir="in"/>')
  })

  it('전환이 없으면 빈 문자열', () => {
    expect(buildTransitionXml(null)).toBe('')
    expect(buildTransitionXml({ type: 'none' })).toBe('')
  })

  it('ms를 PowerPoint의 3단 속도로 접는다', () => {
    expect(buildTransitionXml({ type: 'fade', durationMs: 200 })).toContain('spd="fast"')
    expect(buildTransitionXml({ type: 'fade', durationMs: 400 })).toContain('spd="med"')
    expect(buildTransitionXml({ type: 'fade', durationMs: 900 })).toContain('spd="slow"')
  })
})

describe('PptMotion — spid 수집', () => {
  it('요소 하나가 도형 여럿을 낳으면 모두 모은다', () => {
    const xml = cvNode(2, animObjectName('a')) + cvNode(3, animObjectName('a')) + cvNode(4, 'Shape 9')
    const map = readSpids(xml)
    expect(map.get('a')).toEqual([2, 3])
    expect(map.has('Shape 9')).toBe(false)
  })
})

describe('PptMotion — 등장 타이밍', () => {
  it('click 요소마다 클릭 단계가 하나씩 생긴다', () => {
    const xml = buildTimingXml(
      [el('a', anim({ seq: 0 })), el('b', anim({ seq: 1 }))],
      spids({ a: [2], b: [3] }),
    )
    expect((xml.match(/nodeType="clickEffect"/g) || []).length).toBe(2)
    expect((xml.match(/delay="indefinite"/g) || []).length).toBe(2)
    expect(xml).toContain('<p:spTgt spid="2"/>')
    expect(xml).toContain('<p:spTgt spid="3"/>')
  })

  it('auto 요소는 클릭 없이 슬라이드 진입에서 자기 delay로 시작한다', () => {
    const xml = buildTimingXml(
      [el('a', anim({ trigger: { mode: 'auto', ref: null }, delayMs: 120 }))],
      spids({ a: [2] }),
    )
    expect(xml).toContain('nodeType="afterEffect"')
    expect(xml).not.toContain('delay="indefinite"')
    expect(xml).toContain('<p:cond delay="120"/>')
  })

  it('with는 앞 요소와 같은 단계에 묶인다', () => {
    const xml = buildTimingXml([
      el('a', anim({ seq: 0 })),
      el('b', anim({ seq: 1, trigger: { mode: 'with', ref: 'a' } })),
    ], spids({ a: [2], b: [3] }))
    expect((xml.match(/nodeType="clickEffect"/g) || []).length).toBe(1)
    expect((xml.match(/nodeType="withEffect"/g) || []).length).toBe(1)
  })

  it('after는 같은 단계에서 앞 효과가 끝난 뒤로 밀린다', () => {
    const xml = buildTimingXml([
      el('a', anim({ seq: 0, durationMs: 500 })),
      el('b', anim({ seq: 1, delayMs: 150, trigger: { mode: 'after', ref: 'a' } })),
    ], spids({ a: [2], b: [3] }))
    expect((xml.match(/nodeType="clickEffect"/g) || []).length).toBe(1)
    expect(xml).toContain('<p:cond delay="650"/>') // 500 + 150
  })

  it('요소가 도형 여럿이면 한 단계에서 함께 움직인다', () => {
    const xml = buildTimingXml([el('a', anim())], spids({ a: [2, 3] }))
    expect((xml.match(/nodeType="clickEffect"/g) || []).length).toBe(1)
    expect((xml.match(/nodeType="withEffect"/g) || []).length).toBe(1)
    expect((xml.match(/<p:bldP /g) || []).length).toBe(2)
  })

  it('효과별 filter와 presetClass를 옮긴다', () => {
    const wipe = buildTimingXml([el('a', anim({ effect: 'slideIn', dir: 'up' }))], spids({ a: [2] }))
    expect(wipe).toContain('filter="wipe(up)"')
    expect(wipe).toContain('presetClass="entr"')
    const out = buildTimingXml([el('a', anim({ effect: 'fadeOut' }))], spids({ a: [2] }))
    expect(out).toContain('presetClass="exit"')
    expect(out).toContain('transition="out"')
    expect(out).toContain('<p:strVal val="hidden"/>')
  })

  it('cTn id는 슬라이드 안에서 겹치지 않는다', () => {
    const xml = buildTimingXml([
      el('a', anim({ seq: 0 })), el('b', anim({ seq: 1 })), el('c', anim({ seq: 2, trigger: { mode: 'with', ref: 'b' } })),
    ], spids({ a: [2], b: [3], c: [4] }))
    const ids = [...xml.matchAll(/<p:cTn id="(\d+)"/g)].map(m => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('1') // tmRoot
    expect(ids).toContain('2') // mainSeq
  })

  it('모르는 효과나 도형 못 찾은 요소는 건너뛴다', () => {
    expect(buildTimingXml([el('a', anim({ effect: 'wobble' }))], spids({ a: [2] }))).toBe('')
    expect(buildTimingXml([el('a', anim())], spids({}))).toBe('')
    expect(buildTimingXml([], spids({}))).toBe('')
  })
})

describe('PptMotion — 슬라이드 주입', () => {
  const slide = (body) => `<p:sld><p:cSld>${body}</p:cSld><p:clrMapOvr/></p:sld>`

  it('transition과 timing을 p:sld 끝에 넣는다', () => {
    const xml = injectSlideMotion(slide(cvNode(2, animObjectName('a'))), {
      elements: [el('a', anim())],
      transition: { type: 'fade', durationMs: 400 },
    })
    expect(xml.indexOf('<p:transition')).toBeGreaterThan(xml.indexOf('</p:cSld>'))
    expect(xml.indexOf('<p:timing')).toBeGreaterThan(xml.indexOf('<p:transition'))
    expect(xml.endsWith('</p:sld>')).toBe(true)
  })

  it('모션이 없으면 원본 그대로 돌려준다', () => {
    const src = slide(cvNode(2, 'Shape 1'))
    expect(injectSlideMotion(src, { elements: [el('a', null)], transition: null })).toBe(src)
  })
})
