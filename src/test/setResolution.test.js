import { describe, it, expect, beforeEach } from 'vitest'
import { useFlatStore } from '../store/flatStore'

const CS = (w, h) => ({ w, h })
function el(id, extra = {}) {
  return { id, type: 'shape', x: 100, y: 200, width: 300, height: 150, zIndex: 1, content: '', styles: { fontSize: '20px' }, ...extra }
}
function page(tags, cs) {
  return { elements: tags.map(t => el(t)), canvasSize: cs, htmlSlideIndex: null }
}
function load(pages, currentKey) {
  const data = {}
  pages.forEach((p, i) => { data[`${i}-0`] = p })
  useFlatStore.getState().loadAllPages(data, currentKey)
}
const listTags = () => useFlatStore.getState().getFlatPageList().map(p => p.elements.map(e => e.id))

describe('setResolution — 통합 비례 스케일', () => {
  beforeEach(() => {
    load([page(['a'], CS(1280, 720)), page(['b'], CS(1280, 720)), page(['c'], CS(1280, 720))], '1-0')
  })

  it('모든 페이지 보존(소실 없음)', () => {
    useFlatStore.getState().setResolution(CS(1920, 1080))
    expect(useFlatStore.getState().flatPageCount).toBe(3)
    expect(listTags()).toEqual([['a'], ['b'], ['c']])
  })

  it('요소 좌표/크기/글자크기 비례 스케일(1280→1920 = 1.5x)', () => {
    useFlatStore.getState().setResolution(CS(1920, 1080)) // sx=sy=1.5
    const list = useFlatStore.getState().getFlatPageList()
    const a = list[0].elements[0]
    expect(a.x).toBeCloseTo(150)   // 100*1.5
    expect(a.y).toBeCloseTo(300)   // 200*1.5
    expect(a.width).toBeCloseTo(450)  // 300*1.5
    expect(a.height).toBeCloseTo(225) // 150*1.5
    expect(a.styles.fontSize).toBe('30px') // 20*1.5
    expect(list[0].canvasSize).toEqual(CS(1920, 1080))
  })

  it('현재 페이지 라이브 상태도 스케일', () => {
    useFlatStore.getState().setResolution(CS(640, 360)) // 0.5x
    expect(useFlatStore.getState().canvasSize).toEqual(CS(640, 360))
    expect(useFlatStore.getState().flatElements[0].x).toBeCloseTo(50) // 100*0.5
  })

  it('비대칭(가로만 2x) — x/너비만 2x, y/높이 유지', () => {
    useFlatStore.getState().setResolution(CS(2560, 720)) // sx=2, sy=1
    const a = useFlatStore.getState().getFlatPageList()[0].elements[0]
    expect(a.x).toBeCloseTo(200)
    expect(a.width).toBeCloseTo(600)
    expect(a.y).toBeCloseTo(200)
    expect(a.height).toBeCloseTo(150)
    expect(a.styles.fontSize).toBe('30px') // 20 * (2+1)/2 = 30
  })

  it('poly points도 스케일', () => {
    load([{ elements: [el('p', { points: [{ x: 0, y: 0 }, { x: 100, y: 50 }] })], canvasSize: CS(1280, 720), htmlSlideIndex: null }], '0-0')
    useFlatStore.getState().setResolution(CS(2560, 1440)) // 2x
    const p = useFlatStore.getState().flatElements[0]
    expect(p.points).toEqual([{ x: 0, y: 0 }, { x: 200, y: 100 }])
  })

  it('padding/border 등 px 스타일도 함께 스케일(줄바꿈 방지)', () => {
    load([{ elements: [el('t', { type: 'text', styles: { fontSize: '20px', padding: '4px 8px', borderRadius: '6px', lineHeight: '1.5' } })], canvasSize: CS(1280, 720), htmlSlideIndex: null }], '0-0')
    useFlatStore.getState().setResolution(CS(1920, 1080)) // 1.5x
    const s = useFlatStore.getState().flatElements[0].styles
    expect(s.fontSize).toBe('30px')
    expect(s.padding).toBe('6px 12px')   // 4*1.5, 8*1.5
    expect(s.borderRadius).toBe('9px')
    expect(s.lineHeight).toBe('1.5')      // 단위 없는 값은 불변
  })

  it('잘못된 크기는 무시', () => {
    useFlatStore.getState().setResolution({ w: 0, h: 100 })
    expect(useFlatStore.getState().flatElements[0].x).toBeCloseTo(100) // 변화 없음
  })
})
