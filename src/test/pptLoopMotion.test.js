import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildTimingXml, isPptLoop, animObjectName, applyMotionToPptx } from '../core/PptMotion'
import { makeLoopAnim } from '../core/slideAnimation'

const el = (id, extra = {}) => ({ id, type: 'shape', x: 0, y: 0, width: 10, height: 10, zIndex: 1, styles: {}, ...extra })
const enter = (over = {}) => ({ effect: 'pop', durationMs: 500, delayMs: 0, trigger: { mode: 'click', ref: null }, seq: 0, ...over })
const spids = (obj) => new Map(Object.entries(obj))
// 반복 효과 par의 바깥 cTn(속성 문자열)
const loopCtns = (xml) => [...xml.matchAll(/<p:cTn [^>]*repeatCount="[^"]*"[^>]*>/g)].map(m => m[0])

describe('PptMotion — 반복(강조) 효과', () => {
  it('isPptLoop — 반짝 스윕·모르는 효과는 PowerPoint로 옮기지 않는다', () => {
    expect(isPptLoop(el('a', { loopAnim: makeLoopAnim('pulse') }))).toBe(true)
    expect(isPptLoop(el('a', { loopAnim: makeLoopAnim('shimmer') }))).toBe(false)
    expect(isPptLoop(el('a', { loopAnim: { effect: 'constructor' } }))).toBe(false)
    expect(isPptLoop(el('a'))).toBe(false)
  })

  it('반복만 있는 요소는 슬라이드 진입 묶음에서 무한 반복한다', () => {
    const xml = buildTimingXml([el('a', { loopAnim: makeLoopAnim('spin') })], spids({ a: [2] }))
    const [ctn] = loopCtns(xml)
    expect(ctn).toContain('presetClass="emph"')
    expect(ctn).toContain('presetID="8"')
    expect(ctn).toContain('repeatCount="indefinite"')
    expect(ctn).toContain('nodeType="afterEffect"')
    expect(xml).not.toContain('delay="indefinite"')       // 클릭 단계 없음
    expect(xml).toContain('<p:animRot by="21600000">')
    expect(xml).toContain('<p:bldP spid="2"')
  })

  it('클릭 등장 + 반복: 같은 클릭 단계에서 등장이 끝난 뒤(withEffect, 지연 = 등장 시간)', () => {
    const xml = buildTimingXml([el('a', { anim: enter(), loopAnim: makeLoopAnim('pulse') })], spids({ a: [2] }))
    expect((xml.match(/delay="indefinite"/g) || []).length).toBe(1)
    const [ctn] = loopCtns(xml)
    expect(ctn).toContain('nodeType="withEffect"')
    expect(xml).toMatch(/repeatCount="indefinite" fill="hold" grpId="0" nodeType="withEffect"><p:stCondLst><p:cond delay="500"\/>/)
    expect(xml).toContain('<p:by x="108000" y="108000"/>')
  })

  it('등장과 함께 + 시차 + 횟수: 지연은 시차만큼 박자를 맞추고 repeatCount는 1000 단위', () => {
    const loop = { ...makeLoopAnim('blink'), start: 'withEnter', phaseMs: 300, repeat: 3 }
    const xml = buildTimingXml([el('a', { anim: enter({ trigger: { mode: 'auto', ref: null }, delayMs: 200 }), loopAnim: loop })], spids({ a: [2] }))
    const [ctn] = loopCtns(xml)
    expect(ctn).toContain('repeatCount="3000"')
    // 등장 시작 200ms + (1000 - 300) = 900ms
    expect(xml).toMatch(/repeatCount="3000"[^>]*><p:stCondLst><p:cond delay="900"\/>/)
    expect(xml).toContain('<p:attrName>style.opacity</p:attrName>')
  })

  it('퇴장만 있는 요소의 반복은 처음부터(자동 묶음), 퇴장은 클릭 단계', () => {
    const xml = buildTimingXml([el('a', { anim: enter({ effect: 'fadeOut' }), loopAnim: makeLoopAnim('pulse') })], spids({ a: [2] }))
    const [ctn] = loopCtns(xml)
    expect(ctn).toContain('nodeType="afterEffect"')
    expect((xml.match(/delay="indefinite"/g) || []).length).toBe(1)
  })

  it('떠다니기/까딱임은 슬라이드 크기 대비 이동 경로', () => {
    const xml = buildTimingXml([
      el('f', { loopAnim: makeLoopAnim('float') }),
      el('w', { loopAnim: { ...makeLoopAnim('wiggle'), intensity: 2 } }),
    ], spids({ f: [2], w: [3] }), null, { canvas: { w: 1000, h: 600 } })
    expect(xml).toContain('path="M 0 0 L 0 -0.02 E"')
    expect(xml).toContain('path="M 0 0 L 0.02 0 L -0.02 0 L 0 0 E"')
    expect(xml).toContain('presetClass="path"')
  })

  it('반짝 스윕만 있으면 타이밍 없음', () => {
    expect(buildTimingXml([el('a', { loopAnim: makeLoopAnim('shimmer') })], spids({ a: [2] }))).toBe('')
  })

  it('applyMotionToPptx — 반복 요소 도형에 강조 타이밍을 심는다', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types></Types>')
    zip.file('ppt/presentation.xml', '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>')
    zip.file('ppt/slides/slide1.xml',
      `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="5" name="${animObjectName('a')}"/></p:nvSpPr></p:sp></p:spTree></p:cSld></p:sld>`)
    const blob = await applyMotionToPptx(await zip.generateAsync({ type: 'uint8array' }),
      [{ elements: [el('a', { loopAnim: makeLoopAnim('pulse') })], canvasSize: { w: 1920, h: 1080 } }])
    const out = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('ppt/slides/slide1.xml').async('string')
    expect(out).toContain('<p:timing>')
    expect(out).toContain('<p:spTgt spid="5"/>')
    expect(out).toContain('repeatCount="indefinite"')
  })
})
