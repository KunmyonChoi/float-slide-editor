import { describe, it, expect } from 'vitest'
import { visibleRect, panToCenter, minimapSize, zoomRange, scaleToT, tToScale, snapZoom } from '../core/viewNav'

const canvas = { w: 1920, h: 1080 }
const stage = { w: 400, h: 300 }

describe('visibleRect — 지금 화면에 보이는 슬라이드 영역', () => {
  it('pan 0이면 슬라이드 가운데를 본다', () => {
    expect(visibleRect(stage, canvas, 1, { x: 0, y: 0 })).toEqual({ x: 760, y: 390, w: 400, h: 300 })
  })

  it('맞춤 근처에선 화면이 슬라이드보다 넓어 음수 좌표가 나온다', () => {
    const r = visibleRect(stage, canvas, 0.2, { x: 0, y: 0 })
    expect(r.w).toBeCloseTo(2000)
    expect(r.x).toBeCloseTo(-40)
    expect(r.y).toBeCloseTo(-210)
  })

  it('캔버스를 오른쪽으로 밀면(pan.x > 0) 왼쪽을 본다', () => {
    expect(visibleRect(stage, canvas, 1, { x: 100, y: 0 }).x).toBe(660)
    expect(visibleRect(stage, canvas, 2, { x: 100, y: 0 }).x).toBe(960 - 50 - 100)
  })
})

describe('panToCenter — 미니맵에서 고른 점을 화면 가운데로', () => {
  it('visibleRect의 가운데를 넣으면 원래 pan이 나온다', () => {
    const pan = { x: -300, y: 120 }
    const r = visibleRect(stage, canvas, 2, pan)
    const p = panToCenter(r.x + r.w / 2, r.y + r.h / 2, canvas, 2, r)
    expect(p.x).toBeCloseTo(-300)
    expect(p.y).toBeCloseTo(120)
  })

  it('보이는 영역이 슬라이드 밖으로 나가지 않게 가운데를 제한한다', () => {
    expect(panToCenter(0, 0, canvas, 1, stage)).toEqual({ x: 760, y: 390 })
    expect(panToCenter(5000, 5000, canvas, 1, stage)).toEqual({ x: -760, y: -390 })
  })

  it('슬라이드보다 넓게 보이는 축은 가운데에 고정한다', () => {
    const p = panToCenter(100, 100, canvas, 0.3, { w: 2000, h: 1000 })
    expect(p.x).toBe(0)
    expect(p.y).toBeCloseTo((540 - 500) * 0.3)
  })
})

describe('panToCenter — 오른쪽 아래 컨트롤에 가린 구석 꺼내 보기(extra)', () => {
  it('오른쪽·아래로는 extra만큼 슬라이드 밖까지 간다', () => {
    // 보이는 영역 오른쪽 끝이 1920+200, 아래 끝이 1080+100까지
    expect(panToCenter(5000, 5000, canvas, 1, stage, { w: 200, h: 100 })).toEqual({ x: -960, y: -490 })
  })

  it('왼쪽·위로는 늘지 않는다', () => {
    expect(panToCenter(0, 0, canvas, 1, stage, { w: 200, h: 100 })).toEqual({ x: 760, y: 390 })
  })

  it('슬라이드보다 넓게 보이는 축도 extra만큼은 슬라이드를 왼쪽·위로 밀 수 있다', () => {
    const view = { w: 2000, h: 1000 }
    const p = panToCenter(5000, 5000, canvas, 0.3, view, { w: 300, h: 50 })
    expect(p.x).toBeCloseTo((960 - 1260) * 0.3)   // 가운데에서 300만큼
    expect(p.y).toBeCloseTo((540 - 630) * 0.3)    // 1080 - 500 + 50
    expect(panToCenter(0, 0, canvas, 0.3, view, { w: 300, h: 50 }).x).toBeCloseTo(0) // 오른쪽으로는 가운데까지만
  })
})

describe('minimapSize', () => {
  it('가로 슬라이드는 폭 132에 맞춘다', () => {
    expect(minimapSize(canvas)).toEqual({ w: 132, h: 74, k: 132 / 1920 })
  })
  it('세로 슬라이드는 높이 96에 맞춘다', () => {
    expect(minimapSize({ w: 1080, h: 1920 })).toEqual({ w: 54, h: 96, k: 96 / 1920 })
  })
})

describe('줌 슬라이더 — 로그 눈금 · 자석', () => {
  it('범위는 맞춤 ~ 200%, 맞춤이 크면 맞춤의 4배까지', () => {
    expect(zoomRange(0.18)).toEqual({ lo: 0.18, hi: 2 })
    expect(zoomRange(0.6)).toEqual({ lo: 0.6, hi: 2.4 })
  })

  it('양 끝과 왕복 변환', () => {
    const r = zoomRange(0.2)
    expect(scaleToT(0.2, r)).toBe(0)
    expect(scaleToT(2, r)).toBe(1)
    expect(scaleToT(0.1, r)).toBe(0)   // 맞춤보다 작으면 왼쪽 끝
    expect(scaleToT(8, r)).toBe(1)
    expect(tToScale(scaleToT(0.75, r), r)).toBeCloseTo(0.75)
  })

  it('로그 눈금: 같은 거리 = 같은 배수', () => {
    const r = zoomRange(0.2)   // 0.2 → 2, 10배
    expect(tToScale(0.5, r)).toBeCloseTo(0.2 * Math.sqrt(10))
  })

  it('왼쪽 끝 근처는 맞춤, 100% 근처는 정확히 1', () => {
    const r = zoomRange(0.2)
    expect(snapZoom(0.02, r)).toEqual({ fit: true, scale: 0.2 })
    expect(snapZoom(-0.3, r).fit).toBe(true)
    expect(snapZoom(scaleToT(1, r) + 0.03, r)).toEqual({ fit: false, scale: 1 })
    expect(snapZoom(0.3, r).scale).toBeCloseTo(tToScale(0.3, r))
  })
})
