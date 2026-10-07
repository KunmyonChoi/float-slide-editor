import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  waitsForEnd, canWaitForEnd, isBgm, effectiveLoop, effectiveAutoplay, applySlideAdvance,
  effectiveAdvanceMode, activeBgm, waitMediaIds, mediaAdvanceDecision,
  onMediaSignal, reportMediaEnded, reportMediaFailed,
} from '../core/mediaAdvance'
import { maxPlayGain, MAX_PLAY_FADE_SEC } from '../core/useMediaEndSignal'
import { parseAdvanceAttrs, advanceToAttrs, parseMediaAttrs, mediaToAttrs } from '../core/deckMotion'
import { prepareHtmlForEditor } from '../core/ElementRegistry'
import { extractFlatElements } from '../core/FlatExtractor'
import { exportFlatHtmlAllPages } from '../core/FlatExporter'

vi.mock('../core/BlobStore', () => {
  const BlobStore = {
    put: vi.fn(async () => 'k1'),
    toRef: (k) => `idb://${k}`,
    isIdbRef: (s) => typeof s === 'string' && s.startsWith('idb://'),
    parseRef: (s) => s.slice(6),
  }
  return { BlobStore, default: BlobStore }
})

const audio = (over = {}) => ({ id: 'a', type: 'audio', content: 'idb://song', ...over })
const video = (over = {}) => ({ id: 'v', type: 'video', content: 'idb://clip', ...over })

describe('끝까지 재생 후 다음 — 대상 판정', () => {
  it('옵션을 켠 오디오·영상만 기다린다', () => {
    expect(waitsForEnd(audio({ advanceOnEnd: true }))).toBe(true)
    expect(waitsForEnd(video({ advanceOnEnd: true }))).toBe(true)
    expect(waitsForEnd(audio())).toBe(false)
    expect(waitsForEnd({ id: 't', type: 'text', content: 'x', advanceOnEnd: true })).toBe(false)
  })

  it('임베드·배경 영상·BGM은 끝을 알 수 없어 기다리지 않는다', () => {
    expect(canWaitForEnd(video({ content: 'https://www.youtube.com/embed/abc' }))).toBe(false)
    expect(canWaitForEnd(video({ isBackground: true }))).toBe(false)
    expect(canWaitForEnd(audio({ bgmSpan: 3 }))).toBe(false)
    expect(waitsForEnd(audio({ bgmSpan: 0, advanceOnEnd: true }))).toBe(false)
  })

  it('기다리는 요소는 반복을 끄고 자동 재생을 켠다', () => {
    const el = video({ advanceOnEnd: true, loop: true, autoplay: false })
    expect(effectiveLoop(el)).toBe(false)
    expect(effectiveAutoplay(el)).toBe(true)
    expect(effectiveLoop(video({ loop: true }))).toBe(true)
    expect(effectiveAutoplay(video())).toBe(false)
  })

  it('BGM 판정 — bgmSpan이 0(끝까지) 이상의 정수', () => {
    expect(isBgm(audio({ bgmSpan: 0 }))).toBe(true)
    expect(isBgm(audio({ bgmSpan: 2 }))).toBe(true)
    expect(isBgm(audio())).toBe(false)
    expect(isBgm(video({ bgmSpan: 2 }))).toBe(false)
  })
})

describe('슬라이드 진행 기준', () => {
  it('auto는 기다릴 미디어가 있으면 all, 없으면 narration', () => {
    expect(effectiveAdvanceMode('auto', 1)).toBe('all')
    expect(effectiveAdvanceMode(undefined, 0)).toBe('narration')
  })

  it('media/all인데 기다릴 미디어가 없으면 narration으로 — 덱이 멈추지 않게', () => {
    expect(effectiveAdvanceMode('media', 0)).toBe('narration')
    expect(effectiveAdvanceMode('all', 0)).toBe('narration')
    expect(effectiveAdvanceMode('media', 2)).toBe('media')
    expect(effectiveAdvanceMode('time', 0)).toBe('time')
    expect(effectiveAdvanceMode('click', 1)).toBe('click')
  })

  it('media/all 기준이면 옵션을 단 요소가 없을 때 그 장의 오디오·영상 전부를 기다린다', () => {
    const els = [audio(), video(), video({ id: 'bg', isBackground: true }), { id: 't', type: 'text', content: 'x' }]
    const out = applySlideAdvance(els, 'media')
    expect(waitMediaIds(out)).toEqual(['a', 'v'])
    expect(applySlideAdvance(els, 'narration')).toBe(els)
  })

  it('옵션을 단 요소가 하나라도 있으면 그것만 기다린다', () => {
    const els = [audio({ advanceOnEnd: true }), video()]
    expect(waitMediaIds(applySlideAdvance(els, 'all'))).toEqual(['a'])
  })
})

describe('넘김 판정', () => {
  const base = { auto: true, narrationPending: false, waitIds: ['v'], status: {} }
  it('기다릴 미디어가 없으면 none(기존 규칙)', () => {
    expect(mediaAdvanceDecision({ ...base, waitIds: [] })).toBe('none')
  })
  it('자동 진행이 꺼져 있거나 나레이션이 흐르면 wait', () => {
    expect(mediaAdvanceDecision({ ...base, auto: false, status: { v: 'ended' } })).toBe('wait')
    expect(mediaAdvanceDecision({ ...base, narrationPending: true, status: { v: 'ended' } })).toBe('wait')
  })
  it('모두 끝나면 advance, 하나라도 남으면 wait', () => {
    expect(mediaAdvanceDecision({ ...base, waitIds: ['v', 'a'], status: { v: 'ended' } })).toBe('wait')
    expect(mediaAdvanceDecision({ ...base, waitIds: ['v', 'a'], status: { v: 'ended', a: 'failed' } })).toBe('advance')
  })
  it('전부 실패면 dwell — 머무는 시간 뒤에 넘긴다', () => {
    expect(mediaAdvanceDecision({ ...base, status: { v: 'failed' } })).toBe('dwell')
  })
})

describe('신호 통로', () => {
  it('구독자에게 끝남·실패를 전하고 해제하면 멈춘다', () => {
    const got = []
    const off = onMediaSignal((id, kind) => got.push(`${id}:${kind}`))
    reportMediaEnded('v')
    reportMediaFailed('a')
    reportMediaEnded(null)
    off()
    reportMediaEnded('v')
    expect(got).toEqual(['v:ended', 'a:failed'])
  })
})

describe('최대 재생 시간 페이드', () => {
  it('제한 직전 페이드 길이 동안 0으로 줄어든다', () => {
    expect(maxPlayGain(10, 0)).toBe(1)
    expect(maxPlayGain(80, 90)).toBe(1)
    expect(maxPlayGain(90 - MAX_PLAY_FADE_SEC / 2, 90)).toBeCloseTo(0.5)
    expect(maxPlayGain(95, 90)).toBe(0)
  })
  it('페이드보다 짧은 제한이면 처음부터 비례해 줄인다', () => {
    expect(maxPlayGain(0, 1)).toBe(1)
    expect(maxPlayGain(0.5, 1)).toBeCloseTo(0.5)
  })
})

describe('BGM 범위', () => {
  const pages = [
    { elements: [audio({ id: 'b1', bgmSpan: 2 })] }, // 0~1장
    { elements: [] },
    { elements: [] },                                 // 2장: 없음
    { elements: [audio({ id: 'b2', bgmSpan: 0 })] }, // 3장~끝
    { elements: [] },
  ]
  it('N장 동안 이어지고 그 뒤에는 멈춘다', () => {
    expect(activeBgm(pages, 0)?.element.id).toBe('b1')
    expect(activeBgm(pages, 1)?.element.id).toBe('b1')
    expect(activeBgm(pages, 2)).toBeNull()
  })
  it('0은 끝까지, 새 BGM은 앞의 것을 대신한다', () => {
    expect(activeBgm(pages, 4)?.element.id).toBe('b2')
    const overlap = [{ elements: [audio({ id: 'b1', bgmSpan: 0 })] }, { elements: [audio({ id: 'b2', bgmSpan: 1 })] }, { elements: [] }]
    expect(activeBgm(overlap, 1)?.element.id).toBe('b2')
    // b2가 끝난 뒤 b1으로 되돌아가지 않는다
    expect(activeBgm(overlap, 2)).toBeNull()
  })
})

describe('HTML 규약 — data-advance / data-max-play / data-bgm', () => {
  const node = (attrs) => ({ getAttribute: (n) => (n in attrs ? attrs[n] : null) })

  it('슬라이드 진행 기준 파싱·직렬화', () => {
    expect(parseAdvanceAttrs(node({}))).toBeNull()
    expect(parseAdvanceAttrs(node({ 'data-advance': 'auto' }))).toBeNull()
    expect(parseAdvanceAttrs(node({ 'data-advance': 'bogus' }))).toBeNull()
    expect(parseAdvanceAttrs(node({ 'data-advance': 'all' }))).toEqual({ mode: 'all' })
    expect(parseAdvanceAttrs(node({ 'data-advance': 'time', 'data-advance-after': '12' }))).toEqual({ mode: 'time', seconds: 12 })
    expect(advanceToAttrs(null)).toBe('')
    expect(advanceToAttrs({ mode: 'time', seconds: 12 })).toBe(' data-advance="time" data-advance-after="12"')
    expect(advanceToAttrs({ mode: 'media' })).toBe(' data-advance="media"')
  })

  it('미디어 옵션 파싱 — 노드 자신, 다음 래퍼 순', () => {
    expect(parseMediaAttrs(node({ 'data-advance': 'end', 'data-max-play': '90' }))).toEqual({ advanceOnEnd: true, playMaxSec: 90 })
    expect(parseMediaAttrs(node({}), node({ 'data-bgm': 'end' }))).toEqual({ bgmSpan: 0 })
    expect(parseMediaAttrs(node({ 'data-bgm': '3' }))).toEqual({ bgmSpan: 3 })
    expect(parseMediaAttrs(node({ 'data-advance': 'media' }))).toEqual({}) // 슬라이드용 값은 무시
    expect(parseMediaAttrs(null, node({}))).toEqual({})
  })

  it('미디어 옵션 직렬화', () => {
    expect(mediaToAttrs({})).toBe('')
    expect(mediaToAttrs({ advanceOnEnd: true, playMaxSec: 90 })).toBe(' data-advance="end" data-max-play="90"')
    expect(mediaToAttrs({ bgmSpan: 0 })).toBe(' data-bgm="end"')
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
  const doc = document.implementation.createHTMLDocument('')
  doc.documentElement.innerHTML = new DOMParser().parseFromString(prepared, 'text/html').documentElement.innerHTML
  return extractFlatElements(doc, window)
}

describe('HTML 가져오기·내보내기', () => {
  let orig
  beforeEach(() => { orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = fakeRect })
  afterEach(() => { Element.prototype.getBoundingClientRect = orig })

  it('<audio controls data-advance="end" data-max-play>와 슬라이드 data-advance를 읽는다', () => {
    const { elements, advance } = extract(`<!DOCTYPE html><html><body data-advance="all">
      <div style="position:absolute;left:840px;top:900px;width:960px;height:54px;overflow:hidden;">
        <audio controls data-advance="end" data-max-play="90" src="audio/song1.mp3"
               style="display:block;width:960px;height:54px;border-radius:27px;background:#2a4157;"></audio>
      </div></body></html>`)
    const a = elements.find(e => e.type === 'audio')
    expect(a).toMatchObject({ advanceOnEnd: true, playMaxSec: 90 })
    expect(advance).toEqual({ mode: 'all' })
  })

  it('래퍼 div에 단 data-bgm도 읽는다', () => {
    const { elements, advance } = extract(`<!DOCTYPE html><html><body>
      <div data-bgm="end" style="position:absolute;left:0px;top:0px;width:400px;height:54px;overflow:hidden;">
        <audio controls src="audio/bgm.mp3" style="display:block;width:400px;height:54px;border-radius:27px;"></audio>
      </div></body></html>`)
    expect(elements.find(e => e.type === 'audio')).toMatchObject({ bgmSpan: 0 })
    expect(advance).toBeNull()
  })

  it('내보낸 덱을 다시 가져오면 진행 기준·미디어 옵션이 그대로', () => {
    const html = exportFlatHtmlAllPages({
      '0-0': {
        canvasSize: { w: 1920, h: 1080 },
        advance: { mode: 'time', seconds: 20 },
        elements: [{
          id: 'flat-1', type: 'audio', content: 'audio/song1.mp3', x: 100, y: 100, width: 600, height: 80, zIndex: 1,
          styles: { backgroundColor: 'rgb(42, 65, 87)' }, autoplay: true, advanceOnEnd: true, playMaxSec: 45,
        }],
      },
    })
    expect(html).toContain('data-advance="time" data-advance-after="20"')
    expect(html).toContain('data-advance="end" data-max-play="45"')
  })
})
