import { describe, it, expect } from 'vitest'
import {
  computeSnapGuides,
  computeResizeSnapGuides,
  computeAlignmentChanges,
  computeDistributionChanges,
  isBackgroundElement,
} from '../core/SnapEngine'

const CANVAS = { w: 1280, h: 800 }

// ── computeSnapGuides ────────────────────────────────

describe('computeSnapGuides', () => {
  it('다른 요소 왼쪽 가장자리에 스냅', () => {
    const moving = { x: 97, y: 200, width: 100, height: 50 }
    const others = [{ x: 100, y: 50, width: 200, height: 80 }]
    const result = computeSnapGuides(moving, others, CANVAS)
    expect(result.snappedX).toBe(100) // left → left
    expect(result.guides).toContainEqual({ orientation: 'v', position: 100 })
  })

  it('다른 요소 오른쪽 가장자리에 스냅', () => {
    const moving = { x: 297, y: 200, width: 100, height: 50 } // right edge = 397
    const others = [{ x: 100, y: 50, width: 300, height: 80 }] // right edge = 400
    const result = computeSnapGuides(moving, others, CANVAS)
    expect(result.snappedX).toBe(300) // moving.right(400) → other.right(400), so x = 300
  })

  it('중심-중심 스냅', () => {
    const moving = { x: 447, y: 200, width: 100, height: 50 } // center = 497
    const others = [{ x: 450, y: 50, width: 100, height: 80 }] // center = 500
    // distance = |497 - 500| = 3 → 스냅됨
    const result = computeSnapGuides(moving, others, CANVAS)
    expect(result.snappedX).toBe(450) // center→500, x = 500 - 50 = 450
  })

  it('캔버스 왼쪽 가장자리(0)에 스냅', () => {
    const moving = { x: 3, y: 200, width: 100, height: 50 }
    const result = computeSnapGuides(moving, [], CANVAS)
    expect(result.snappedX).toBe(0)
    expect(result.guides).toContainEqual({ orientation: 'v', position: 0 })
  })

  it('캔버스 가로 중심에 스냅', () => {
    const moving = { x: 588, y: 200, width: 100, height: 50 } // center = 638, canvas center = 640
    const result = computeSnapGuides(moving, [], CANVAS)
    expect(result.snappedX).toBe(590) // center → 640, so x = 640 - 50 = 590
  })

  it('캔버스 세로 중심에 스냅', () => {
    const moving = { x: 100, y: 373, width: 100, height: 50 } // middle = 398, canvas middle = 400
    const result = computeSnapGuides(moving, [], CANVAS)
    expect(result.snappedY).toBe(375) // middle → 400, so y = 400 - 25 = 375
  })

  it('threshold 밖이면 스냅 안 됨', () => {
    const moving = { x: 90, y: 200, width: 100, height: 50 }
    const others = [{ x: 100, y: 50, width: 200, height: 80 }]
    // left→left distance = 10, threshold 5 이상 → 스냅 안 됨
    const result = computeSnapGuides(moving, others, CANVAS)
    expect(result.snappedX).toBeNull()
  })

  it('X/Y 독립 스냅', () => {
    const moving = { x: 98, y: 48, width: 100, height: 50 }
    const others = [{ x: 100, y: 50, width: 200, height: 80 }]
    const result = computeSnapGuides(moving, others, CANVAS)
    expect(result.snappedX).toBe(100)
    expect(result.snappedY).toBe(50)
    expect(result.guides.length).toBe(2)
  })

  it('otherRects 비어있으면 캔버스만 대상', () => {
    const moving = { x: 1177, y: 747, width: 100, height: 50 } // right=1277, bottom=797
    const result = computeSnapGuides(moving, [], CANVAS)
    expect(result.snappedX).toBe(1180) // right → 1280
    expect(result.snappedY).toBe(750)  // bottom → 800
  })

  it('가이드가 없으면 빈 배열', () => {
    const moving = { x: 500, y: 300, width: 100, height: 50 }
    const result = computeSnapGuides(moving, [], CANVAS)
    expect(result.snappedX).toBeNull()
    expect(result.snappedY).toBeNull()
    expect(result.guides).toEqual([])
  })
})

// ── computeResizeSnapGuides ──────────────────────────

describe('computeResizeSnapGuides', () => {
  it('오른쪽(e) 리사이즈 — 다른 요소 오른쪽 edge에 스냅', () => {
    // rect right = 497, other right = 500
    const rect = { x: 100, y: 100, width: 397, height: 50 }
    const others = [{ x: 400, y: 50, width: 100, height: 80 }] // right = 500
    const result = computeResizeSnapGuides(rect, 'e', others, CANVAS)
    expect(result.width).toBe(400) // right → 500
    expect(result.x).toBe(100) // x 변동 없음
    expect(result.guides).toContainEqual({ orientation: 'v', position: 500 })
  })

  it('왼쪽(w) 리사이즈 — 다른 요소 왼쪽 edge에 스냅', () => {
    // rect left = 98, other left = 100, rect right = 500
    const rect = { x: 98, y: 100, width: 402, height: 50 }
    const others = [{ x: 100, y: 50, width: 100, height: 80 }]
    const result = computeResizeSnapGuides(rect, 'w', others, CANVAS)
    expect(result.x).toBe(100)
    expect(result.width).toBe(400)
    expect(result.guides).toContainEqual({ orientation: 'v', position: 100 })
  })

  it('아래쪽(s) 리사이즈 — 캔버스 하단에 스냅', () => {
    // rect bottom = 797, canvas bottom = 800
    const rect = { x: 100, y: 600, width: 100, height: 197 }
    const result = computeResizeSnapGuides(rect, 's', [], CANVAS)
    expect(result.height).toBe(200) // bottom → 800
    expect(result.y).toBe(600) // y 변동 없음
    expect(result.guides).toContainEqual({ orientation: 'h', position: 800 })
  })

  it('위쪽(n) 리사이즈 — 캔버스 상단에 스냅', () => {
    // rect top = 3, canvas top = 0
    const rect = { x: 100, y: 3, width: 100, height: 197 }
    const result = computeResizeSnapGuides(rect, 'n', [], CANVAS)
    expect(result.y).toBe(0)
    expect(result.height).toBe(200) // 200 - 0
    expect(result.guides).toContainEqual({ orientation: 'h', position: 0 })
  })

  it('코너(se) 리사이즈 — X/Y 동시 스냅', () => {
    // right = 298 → 300, bottom = 798 → 800
    const rect = { x: 100, y: 600, width: 198, height: 198 }
    const others = [{ x: 200, y: 50, width: 100, height: 80 }] // right = 300
    const result = computeResizeSnapGuides(rect, 'se', others, CANVAS)
    expect(result.width).toBe(200)  // right → 300
    expect(result.height).toBe(200) // bottom → 800
    expect(result.guides.length).toBe(2)
  })

  it('threshold 밖이면 스냅 안 됨', () => {
    const rect = { x: 100, y: 100, width: 190, height: 50 } // right = 290
    const others = [{ x: 200, y: 50, width: 100, height: 80 }] // right = 300
    // distance = 10, threshold = 5
    const result = computeResizeSnapGuides(rect, 'e', others, CANVAS)
    expect(result.width).toBe(190) // 변경 없음
    expect(result.guides).toEqual([])
  })

  it('edge가 center보다 우선 — 둘 다 threshold 안일 때 edge 선택', () => {
    // rect right = 402, center = 252
    // other left = 400 (edge dist=2), other center = 250 (center dist=2)
    // 둘 다 threshold 이내지만 edge가 우선
    const rect = { x: 102, y: 100, width: 300, height: 50 }
    const others = [{ x: 400, y: 50, width: 100, height: 80 }] // left=400, center=450
    const result = computeResizeSnapGuides(rect, 'e', others, CANVAS)
    expect(result.guides).toContainEqual({ orientation: 'v', position: 400 })
    expect(result.width).toBe(298) // right → 400
  })

  it('edge 매치 없으면 center 폴백', () => {
    // rect right = 500, center = 350 → center와 캔버스 중심 640 거리 290 (안 됨)
    // 하지만 center = 350이 other center 350에 매치
    const rect = { x: 200, y: 100, width: 300, height: 50 }
    const others = [{ x: 300, y: 50, width: 100, height: 80 }] // center = 350
    // rect right = 500 — 어디에도 안 맞음 (500은 target에 없음... canvas w=1280)
    // rect center = 350 — other center = 350에 정확히 매치
    const result = computeResizeSnapGuides(rect, 'e', others, CANVAS)
    expect(result.guides).toContainEqual({ orientation: 'v', position: 350 })
  })

  it('캔버스 중심에 스냅', () => {
    // right = 638, canvas center = 640
    const rect = { x: 100, y: 100, width: 538, height: 50 }
    const result = computeResizeSnapGuides(rect, 'e', [], CANVAS)
    expect(result.width).toBe(540) // right → 640
    expect(result.guides).toContainEqual({ orientation: 'v', position: 640 })
  })
})

// ── computeAlignmentChanges ──────────────────────────

describe('computeAlignmentChanges', () => {
  const els = [
    { id: 'a', x: 10, y: 20, width: 100, height: 50 },
    { id: 'b', x: 200, y: 100, width: 150, height: 80 },
    { id: 'c', x: 100, y: 300, width: 120, height: 60 },
  ]

  it('alignLeft — 가장 왼쪽에 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignLeft')
    // a는 이미 x=10, 변경 없음 → 필터됨
    expect(changes).toEqual([
      { id: 'b', changes: { x: 10 } },
      { id: 'c', changes: { x: 10 } },
    ])
  })

  it('alignRight — 가장 오른쪽에 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignRight')
    // maxRight = max(110, 350, 220) = 350
    expect(changes.find(c => c.id === 'a').changes.x).toBe(250)  // 350 - 100
    expect(changes.find(c => c.id === 'c').changes.x).toBe(230)  // 350 - 120
    // b는 이미 right=350, 변경 없음 → 필터됨
    expect(changes.find(c => c.id === 'b')).toBeUndefined()
  })

  it('alignCenterH — 가로 중심 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignCenterH')
    // minX=10, maxRight=350, centerX=180
    expect(changes.find(c => c.id === 'a').changes.x).toBe(130) // 180 - 50
    expect(changes.find(c => c.id === 'b').changes.x).toBe(105) // 180 - 75
    expect(changes.find(c => c.id === 'c').changes.x).toBe(120) // 180 - 60
  })

  it('alignTop — 가장 위에 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignTop')
    // minY = 20, a는 이미 y=20
    expect(changes).toEqual([
      { id: 'b', changes: { y: 20 } },
      { id: 'c', changes: { y: 20 } },
    ])
  })

  it('alignBottom — 가장 아래에 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignBottom')
    // maxBottom = max(70, 180, 360) = 360
    expect(changes.find(c => c.id === 'a').changes.y).toBe(310) // 360 - 50
    expect(changes.find(c => c.id === 'b').changes.y).toBe(280) // 360 - 80
    // c는 이미 bottom=360, 변경 없음
    expect(changes.find(c => c.id === 'c')).toBeUndefined()
  })

  it('alignMiddleV — 세로 가운데 맞춤', () => {
    const changes = computeAlignmentChanges(els, 'alignMiddleV')
    // minY=20, maxBottom=360, centerY=190
    expect(changes.find(c => c.id === 'a').changes.y).toBe(165) // 190 - 25
    expect(changes.find(c => c.id === 'b').changes.y).toBe(150) // 190 - 40
    expect(changes.find(c => c.id === 'c').changes.y).toBe(160) // 190 - 30
  })

  it('요소 1개면 빈 배열', () => {
    expect(computeAlignmentChanges([els[0]], 'alignLeft')).toEqual([])
  })
})

// ── computeDistributionChanges ───────────────────────

describe('computeDistributionChanges', () => {
  it('distributeH — 가로 균등 분배', () => {
    const els = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 200, y: 0, width: 50, height: 50 },
      { id: 'c', x: 50, y: 0, width: 50, height: 50 },
    ]
    const changes = computeDistributionChanges(els, 'distributeH')
    // sorted by x: a(0), c(50), b(200)
    // totalSpace = (250 - 0) - 150 = 100, gap = 50
    // a: x=0 (no change), c: x=100, b: x=200 (no change)
    expect(changes.length).toBe(1) // only c changes
    expect(changes[0]).toEqual({ id: 'c', changes: { x: 100 } })
  })

  it('distributeV — 세로 균등 분배', () => {
    const els = [
      { id: 'a', x: 0, y: 0, width: 50, height: 40 },
      { id: 'b', x: 0, y: 200, width: 50, height: 40 },
      { id: 'c', x: 0, y: 50, width: 50, height: 40 },
    ]
    const changes = computeDistributionChanges(els, 'distributeV')
    // sorted by y: a(0), c(50), b(200)
    // totalSpace = (240 - 0) - 120 = 120, gap = 60
    // a: y=0, c: y=100, b: y=200
    expect(changes.length).toBe(1)
    expect(changes[0]).toEqual({ id: 'c', changes: { y: 100 } })
  })

  it('2개 이하면 빈 배열', () => {
    const els = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 200, y: 0, width: 50, height: 50 },
    ]
    expect(computeDistributionChanges(els, 'distributeH')).toEqual([])
  })

  it('이미 균등하면 변경 없음', () => {
    const els = [
      { id: 'a', x: 0, y: 0, width: 50, height: 50 },
      { id: 'b', x: 100, y: 0, width: 50, height: 50 },
      { id: 'c', x: 200, y: 0, width: 50, height: 50 },
    ]
    // gap = (250 - 0 - 150) / 2 = 50
    // a: x=0, b: x=100, c: x=200 → 모두 동일
    expect(computeDistributionChanges(els, 'distributeH')).toEqual([])
  })
})

// ── isBackgroundElement ──────────────────────────────

describe('isBackgroundElement', () => {
  it('배경 요소 판정', () => {
    const bg = { type: 'shape', content: '', x: 0, y: 0, width: 1280, height: 800 }
    expect(isBackgroundElement(bg, CANVAS)).toBe(true)
  })

  it('비배경 요소', () => {
    const el = { type: 'text', content: 'hello', x: 100, y: 100, width: 200, height: 50 }
    expect(isBackgroundElement(el, CANVAS)).toBe(false)
  })

  it('크기가 다른 shape는 배경 아님', () => {
    const el = { type: 'shape', content: '', x: 0, y: 0, width: 500, height: 300 }
    expect(isBackgroundElement(el, CANVAS)).toBe(false)
  })
})
