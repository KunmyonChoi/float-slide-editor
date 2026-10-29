import { describe, it, expect } from 'vitest'
import { visibleRect, panToCenter, minimapSize, zoomRange, scaleToT, tToScale, snapZoom, viewCenterOnCanvas, centerSpecsAt, insertCenter, placeAtViewCenter } from '../core/viewNav'

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

// 화면 영역(stage) 안에 배율·이동이 걸린 캔버스 요소 — getBoundingClientRect만 흉내
function fakeCanvasEl(stageRect, canvasRect) {
  return { getBoundingClientRect: () => canvasRect, parentElement: { getBoundingClientRect: () => stageRect } }
}

describe('viewCenterOnCanvas — 지금 보고 있는 화면 가운데의 캔버스 좌표', () => {
  const stageRect = { left: 0, top: 0, width: 400, height: 300 }

  it('맞춤처럼 가운데 둔 캔버스면 캔버스 가운데', () => {
    const el = fakeCanvasEl(stageRect, { left: 200 - 960, top: 150 - 540, width: 1920, height: 1080 })
    expect(viewCenterOnCanvas(el, canvas)).toEqual({ x: 960, y: 540 })
  })

  it('확대해 옮겨 둔 상태면 그 자리(배율 반영)', () => {
    const el = fakeCanvasEl(stageRect, { left: -1500, top: -900, width: 3840, height: 2160 }) // 배율 2
    expect(viewCenterOnCanvas(el, canvas)).toEqual({ x: 850, y: 525 })
  })

  it('요소가 없거나 크기가 0이면 null', () => {
    expect(viewCenterOnCanvas(null, canvas)).toBeNull()
    expect(viewCenterOnCanvas(fakeCanvasEl(stageRect, { left: 0, top: 0, width: 0, height: 0 }), canvas)).toBeNull()
  })
})

describe('centerSpecsAt — 스니펫 묶음을 화면 가운데로', () => {
  const specs = [
    { x: 100, y: 100, width: 120, height: 100 },
    { x: 240, y: 150, width: 60, height: 50 },   // 묶음 bbox (100,100)~(300,200)
  ]

  it('묶음 가운데가 그 점에 오고, 묶음 안의 배치는 그대로', () => {
    const out = centerSpecsAt(specs, { x: 1500, y: 800 }, canvas)
    expect(out.map(s => [s.x, s.y])).toEqual([[1400, 750], [1540, 800]])
  })

  it('캔버스 밖으로는 나가지 않는다(미니맵으로 슬라이드 밖까지 옮겨 둔 경우)', () => {
    const out = centerSpecsAt(specs, { x: 2100, y: 1300 }, canvas)
    expect([out[0].x, out[0].y]).toEqual([1920 - 200, 1080 - 100])
    expect(centerSpecsAt(specs, { x: -50, y: -50 }, canvas)[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('캔버스보다 큰 축은 캔버스 가운데', () => {
    const out = centerSpecsAt([{ x: 0, y: 0, width: 2000, height: 50 }], { x: 300, y: 300 }, canvas)
    expect(out[0]).toMatchObject({ x: -40, y: 275 })
  })
})

describe('placeAtViewCenter — 새 요소(텍스트·도형·표·이미지·영상)를 화면 가운데에', () => {
  const stageRect = { left: 0, top: 0, width: 400, height: 300 }
  const zoomed = fakeCanvasEl(stageRect, { left: -1500, top: -900, width: 3840, height: 2160 }) // 화면 가운데 = (850, 525)

  it('확대해 옮겨 둔 화면이면 그 가운데', () => {
    expect(insertCenter(zoomed, canvas)).toEqual({ x: 850, y: 525 })
    expect(placeAtViewCenter(200, 100, canvas, zoomed)).toEqual({ x: 750, y: 475 })
  })

  it('화면을 모르면 예전처럼 캔버스 가운데 — 같은 반올림', () => {
    expect(insertCenter(null, canvas)).toEqual({ x: 960, y: 540 })
    for (const [w, h] of [[200, 100], [131, 77], [301.5, 40], [2000, 50]]) {
      expect(placeAtViewCenter(w, h, canvas, null)).toEqual({ x: Math.round((1920 - w) / 2), y: Math.round((1080 - h) / 2) })
    }
  })

  it('캔버스 밖으로는 나가지 않는다', () => {
    const edge = fakeCanvasEl(stageRect, { left: -1900, top: -1000, width: 1920, height: 1080 }) // 화면 가운데 = (2100, 1150)
    expect(placeAtViewCenter(200, 100, canvas, edge)).toEqual({ x: 1720, y: 980 })
  })
})
