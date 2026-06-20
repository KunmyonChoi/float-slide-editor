import { describe, it, expect } from 'vitest'
import { htmlToPlain, elementText, slidePageDigest, deckDigest } from '../core/slideTextDigest'

describe('htmlToPlain', () => {
  it('블록 태그→줄바꿈, 태그 제거, 엔티티 디코드', () => {
    expect(htmlToPlain('<p>A</p><p>B</p>')).toBe('A\nB')
    expect(htmlToPlain('first<br>second')).toBe('first\nsecond')
    expect(htmlToPlain('<b>굵게</b> &amp; <i>기울임</i>')).toBe('굵게 & 기울임')
    expect(htmlToPlain('')).toBe('')
  })
})

describe('elementText', () => {
  it('리치 텍스트는 HTML→plain, 일반은 그대로', () => {
    expect(elementText({ type: 'text', isRich: true, content: '<p>제목</p>' })).toBe('제목')
    expect(elementText({ type: 'text', isRich: false, content: '  평문  ' })).toBe('평문')
  })
  it('미디어 타입(image/video/svg)은 텍스트 아님 — 타입으로 판별', () => {
    expect(elementText({ type: 'image', content: 'data:image/png;base64,AAA' })).toBe('')
    expect(elementText({ type: 'video', content: 'idb://abc' })).toBe('')
    expect(elementText({ type: 'svg', content: '<svg/>' })).toBe('')
  })
  it('URL/data:로 시작하는 평문 텍스트는 유지(미디어로 오판 안 함)', () => {
    expect(elementText({ type: 'text', isRich: false, content: 'https://github.com/me/repo' })).toBe('https://github.com/me/repo')
    expect(elementText({ type: 'text', isRich: false, content: 'data: 부록 참고' })).toBe('data: 부록 참고')
  })
  it('표는 셀 텍스트를 합침(covered 제외)', () => {
    const el = { type: 'table', table: { cells: [[{ text: 'A' }, { text: 'B' }], [{ text: 'C', covered: true }, { text: 'D' }]] } }
    expect(elementText(el)).toBe('A | B | D')
  })
})

describe('slidePageDigest', () => {
  it('제목=가장 큰 폰트, 본문=읽기순(위→아래)', () => {
    const els = [
      { type: 'text', isRich: false, content: '본문 둘', y: 200, x: 0, styles: { fontSize: '16px' } },
      { type: 'text', isRich: false, content: '제목', y: 20, x: 0, styles: { fontSize: '40px' } },
      { type: 'text', isRich: false, content: '본문 하나', y: 120, x: 0, styles: { fontSize: '16px' } },
    ]
    const d = slidePageDigest(els)
    expect(d.title).toBe('제목')
    expect(d.text).toBe('제목\n본문 하나\n본문 둘')
  })
  it('배경/커넥터/빈 요소 제외', () => {
    const els = [
      { type: 'shape', isBackground: true, content: '배경텍스트', y: 0, styles: {} },
      { type: 'shape', shapeType: 'connector', content: '라벨', y: 0, styles: {} },
      { type: 'text', isRich: false, content: '실제', y: 10, styles: { fontSize: '20px' } },
    ]
    const d = slidePageDigest(els)
    expect(d.text).toBe('실제')
  })
  it('빈 페이지', () => {
    expect(slidePageDigest([])).toEqual({ title: '', text: '' })
  })
})

describe('deckDigest', () => {
  it('페이지별 index/title/text', () => {
    const out = deckDigest([
      [{ type: 'text', isRich: false, content: 'S1', y: 0, styles: { fontSize: '30px' } }],
      [{ type: 'text', isRich: false, content: 'S2', y: 0, styles: { fontSize: '30px' } }],
    ])
    expect(out).toEqual([
      { index: 0, title: 'S1', text: 'S1' },
      { index: 1, title: 'S2', text: 'S2' },
    ])
  })
})
