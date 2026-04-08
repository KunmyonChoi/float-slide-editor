/**
 * SnapEngine — 스냅 가이드, 정렬, 분배를 위한 순수 함수 모듈
 */

/**
 * 배경 요소 판정 (캔버스 전체를 덮는 shape)
 */
export function isBackgroundElement(el, canvasSize) {
  return el.type === 'shape' && !el.content
    && Math.abs(el.width - canvasSize.w) < 2 && Math.abs(el.height - canvasSize.h) < 2
    && Math.abs(el.x) < 2 && Math.abs(el.y) < 2
}

/**
 * 드래그 중 스냅 가이드 계산
 *
 * @param {{ x, y, width, height }} movingRect - 이동 중인 요소/그룹 bbox
 * @param {Array<{ x, y, width, height }>} otherRects - 비선택/비배경 요소들
 * @param {{ w, h }} canvasSize
 * @param {number} threshold - 스냅 임계값 (기본 5px)
 * @returns {{ snappedX: number|null, snappedY: number|null, guides: Array<{ orientation: 'h'|'v', position: number }> }}
 */
export function computeSnapGuides(movingRect, otherRects, canvasSize, threshold = 5) {
  const { x, y, width, height } = movingRect

  // 이동 요소의 참조점
  const movingXPoints = [x, x + width / 2, x + width]           // left, center, right
  const movingYPoints = [y, y + height / 2, y + height]          // top, middle, bottom

  // 대상 참조점 수집 (다른 요소 + 캔버스)
  const targetXPoints = [0, canvasSize.w / 2, canvasSize.w]
  const targetYPoints = [0, canvasSize.h / 2, canvasSize.h]

  for (const r of otherRects) {
    targetXPoints.push(r.x, r.x + r.width / 2, r.x + r.width)
    targetYPoints.push(r.y, r.y + r.height / 2, r.y + r.height)
  }

  // X축 스냅 — 가장 가까운 매치 찾기
  let bestXDist = Infinity
  let bestXDelta = 0
  let bestXGuide = null

  for (const mp of movingXPoints) {
    for (const tp of targetXPoints) {
      const dist = Math.abs(mp - tp)
      if (dist < threshold && dist < bestXDist) {
        bestXDist = dist
        bestXDelta = tp - mp
        bestXGuide = tp
      }
    }
  }

  // Y축 스냅 — 가장 가까운 매치 찾기
  let bestYDist = Infinity
  let bestYDelta = 0
  let bestYGuide = null

  for (const mp of movingYPoints) {
    for (const tp of targetYPoints) {
      const dist = Math.abs(mp - tp)
      if (dist < threshold && dist < bestYDist) {
        bestYDist = dist
        bestYDelta = tp - mp
        bestYGuide = tp
      }
    }
  }

  const guides = []
  if (bestXGuide !== null) guides.push({ orientation: 'v', position: bestXGuide })
  if (bestYGuide !== null) guides.push({ orientation: 'h', position: bestYGuide })

  return {
    snappedX: bestXGuide !== null ? x + bestXDelta : null,
    snappedY: bestYGuide !== null ? y + bestYDelta : null,
    guides,
  }
}

/**
 * 리사이즈 중 스냅 가이드 계산
 * 드래그 중인 변(edge)만 스냅 대상으로 삼는다.
 *
 * @param {{ x, y, width, height }} rect - 리사이즈 후 제안 rect
 * @param {string} dir - 리사이즈 방향 ('n','s','e','w','ne','nw','se','sw')
 * @param {Array<{ x, y, width, height }>} otherRects
 * @param {{ w, h }} canvasSize
 * @param {number} threshold
 * @returns {{ x, y, width, height, guides }}
 */
export function computeResizeSnapGuides(rect, dir, otherRects, canvasSize, threshold = 5) {
  let { x, y, width, height } = rect

  // 대상 참조점 수집
  const targetXPoints = [0, canvasSize.w / 2, canvasSize.w]
  const targetYPoints = [0, canvasSize.h / 2, canvasSize.h]
  for (const r of otherRects) {
    targetXPoints.push(r.x, r.x + r.width / 2, r.x + r.width)
    targetYPoints.push(r.y, r.y + r.height / 2, r.y + r.height)
  }

  const guides = []

  // X축: 드래그 중인 변의 edge 우선, 없으면 center 폴백
  if (dir.includes('e')) {
    const right = x + width
    // 1) edge 스냅 먼저
    let bestDist = Infinity, bestDelta = 0, bestGuide = null
    for (const tp of targetXPoints) {
      const dist = Math.abs(right - tp)
      if (dist < threshold && dist < bestDist) {
        bestDist = dist; bestDelta = tp - right; bestGuide = tp
      }
    }
    // 2) edge 매치 없으면 center 폴백
    if (bestGuide === null) {
      const center = x + width / 2
      for (const tp of targetXPoints) {
        const dist = Math.abs(center - tp)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist; bestDelta = (tp - center) * 2; bestGuide = tp
        }
      }
    }
    if (bestGuide !== null) {
      width += bestDelta
      guides.push({ orientation: 'v', position: bestGuide })
    }
  } else if (dir.includes('w')) {
    // 1) edge 스냅 먼저
    let bestDist = Infinity, bestDelta = 0, bestGuide = null
    for (const tp of targetXPoints) {
      const dist = Math.abs(x - tp)
      if (dist < threshold && dist < bestDist) {
        bestDist = dist; bestDelta = tp - x; bestGuide = tp
      }
    }
    // 2) edge 매치 없으면 center 폴백
    if (bestGuide === null) {
      const center = x + width / 2
      for (const tp of targetXPoints) {
        const dist = Math.abs(center - tp)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist; bestDelta = (tp - center) * 2; bestGuide = tp
        }
      }
    }
    if (bestGuide !== null) {
      x += bestDelta
      width -= bestDelta
      guides.push({ orientation: 'v', position: bestGuide })
    }
  }

  if (dir.includes('s')) {
    const bottom = y + height
    // 1) edge 스냅 먼저
    let bestDist = Infinity, bestDelta = 0, bestGuide = null
    for (const tp of targetYPoints) {
      const dist = Math.abs(bottom - tp)
      if (dist < threshold && dist < bestDist) {
        bestDist = dist; bestDelta = tp - bottom; bestGuide = tp
      }
    }
    // 2) edge 매치 없으면 center 폴백
    if (bestGuide === null) {
      const middle = y + height / 2
      for (const tp of targetYPoints) {
        const dist = Math.abs(middle - tp)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist; bestDelta = (tp - middle) * 2; bestGuide = tp
        }
      }
    }
    if (bestGuide !== null) {
      height += bestDelta
      guides.push({ orientation: 'h', position: bestGuide })
    }
  } else if (dir.includes('n')) {
    // 1) edge 스냅 먼저
    let bestDist = Infinity, bestDelta = 0, bestGuide = null
    for (const tp of targetYPoints) {
      const dist = Math.abs(y - tp)
      if (dist < threshold && dist < bestDist) {
        bestDist = dist; bestDelta = tp - y; bestGuide = tp
      }
    }
    // 2) edge 매치 없으면 center 폴백
    if (bestGuide === null) {
      const middle = y + height / 2
      for (const tp of targetYPoints) {
        const dist = Math.abs(middle - tp)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist; bestDelta = (tp - middle) * 2; bestGuide = tp
        }
      }
    }
    if (bestGuide !== null) {
      y += bestDelta
      height -= bestDelta
      guides.push({ orientation: 'h', position: bestGuide })
    }
  }

  return { x, y, width, height, guides }
}

/**
 * 정렬 변경 계산
 *
 * @param {Array<{ id, x, y, width, height }>} elements
 * @param {'alignLeft'|'alignCenterH'|'alignRight'|'alignTop'|'alignMiddleV'|'alignBottom'} action
 * @returns {Array<{ id, changes: { x?, y? } }>}
 */
export function computeAlignmentChanges(elements, action) {
  if (elements.length < 2) return []

  const minX = Math.min(...elements.map(e => e.x))
  const maxRight = Math.max(...elements.map(e => e.x + e.width))
  const minY = Math.min(...elements.map(e => e.y))
  const maxBottom = Math.max(...elements.map(e => e.y + e.height))
  const centerX = (minX + maxRight) / 2
  const centerY = (minY + maxBottom) / 2

  return elements.map(el => {
    let changes = {}
    switch (action) {
      case 'alignLeft':    changes = { x: minX }; break
      case 'alignCenterH': changes = { x: centerX - el.width / 2 }; break
      case 'alignRight':   changes = { x: maxRight - el.width }; break
      case 'alignTop':     changes = { y: minY }; break
      case 'alignMiddleV': changes = { y: centerY - el.height / 2 }; break
      case 'alignBottom':  changes = { y: maxBottom - el.height }; break
    }
    return { id: el.id, changes }
  }).filter(({ id, changes }) => {
    const el = elements.find(e => e.id === id)
    // 변경 없는 요소 필터
    if (changes.x !== undefined && changes.x === el.x) return false
    if (changes.y !== undefined && changes.y === el.y) return false
    return true
  })
}

/**
 * 분배 변경 계산
 *
 * @param {Array<{ id, x, y, width, height }>} elements
 * @param {'distributeH'|'distributeV'} action
 * @returns {Array<{ id, changes: { x?, y? } }>}
 */
export function computeDistributionChanges(elements, action) {
  if (elements.length < 3) return []

  if (action === 'distributeH') {
    const sorted = [...elements].sort((a, b) => a.x - b.x)
    const minLeft = sorted[0].x
    const maxRight = Math.max(...sorted.map(e => e.x + e.width))
    const totalWidth = sorted.reduce((sum, e) => sum + e.width, 0)
    const gap = (maxRight - minLeft - totalWidth) / (sorted.length - 1)

    let cursor = minLeft
    return sorted.map(el => {
      const newX = cursor
      cursor += el.width + gap
      if (Math.abs(newX - el.x) < 0.01) return null
      return { id: el.id, changes: { x: newX } }
    }).filter(Boolean)
  }

  if (action === 'distributeV') {
    const sorted = [...elements].sort((a, b) => a.y - b.y)
    const minTop = sorted[0].y
    const maxBottom = Math.max(...sorted.map(e => e.y + e.height))
    const totalHeight = sorted.reduce((sum, e) => sum + e.height, 0)
    const gap = (maxBottom - minTop - totalHeight) / (sorted.length - 1)

    let cursor = minTop
    return sorted.map(el => {
      const newY = cursor
      cursor += el.height + gap
      if (Math.abs(newY - el.y) < 0.01) return null
      return { id: el.id, changes: { y: newY } }
    }).filter(Boolean)
  }

  return []
}
