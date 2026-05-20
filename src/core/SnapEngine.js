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
  const movingXPoints = [x, x + width / 2, x + width]
  const movingYPoints = [y, y + height / 2, y + height]

  // 대상 참조점 수집 (다른 요소 + 캔버스)
  const targetXPoints = [0, canvasSize.w / 2, canvasSize.w]
  const targetYPoints = [0, canvasSize.h / 2, canvasSize.h]

  for (const r of otherRects) {
    targetXPoints.push(r.x, r.x + r.width / 2, r.x + r.width)
    targetYPoints.push(r.y, r.y + r.height / 2, r.y + r.height)
  }

  // X축 정렬 스냅
  let bestXDist = Infinity, bestXDelta = 0, bestXGuide = null
  for (const mp of movingXPoints) {
    for (const tp of targetXPoints) {
      const dist = Math.abs(mp - tp)
      if (dist < threshold && dist < bestXDist) {
        bestXDist = dist; bestXDelta = tp - mp; bestXGuide = tp
      }
    }
  }

  // Y축 정렬 스냅
  let bestYDist = Infinity, bestYDelta = 0, bestYGuide = null
  for (const mp of movingYPoints) {
    for (const tp of targetYPoints) {
      const dist = Math.abs(mp - tp)
      if (dist < threshold && dist < bestYDist) {
        bestYDist = dist; bestYDelta = tp - mp; bestYGuide = tp
      }
    }
  }

  // ── 균등 간격 스냅 ──
  // X축: 이동 요소와 좌우 인접 요소 간 간격이 동일해지는 위치에 스냅
  const eqSnap = _computeEqualSpacingSnap(movingRect, otherRects, threshold)
  if (eqSnap.snapX !== null && (bestXGuide === null || Math.abs(eqSnap.snapX - x) < bestXDist)) {
    bestXDelta = eqSnap.snapX - x; bestXGuide = '__eq'
  }
  if (eqSnap.snapY !== null && (bestYGuide === null || Math.abs(eqSnap.snapY - y) < bestYDist)) {
    bestYDelta = eqSnap.snapY - y; bestYGuide = '__eq'
  }

  const guides = []
  if (bestXGuide !== null && bestXGuide !== '__eq') guides.push({ orientation: 'v', position: bestXGuide })
  if (bestYGuide !== null && bestYGuide !== '__eq') guides.push({ orientation: 'h', position: bestYGuide })

  // 균등 간격 가이드 (분홍 점선)
  if (eqSnap.guides) guides.push(...eqSnap.guides)

  // ── 간격 표시 (Gap Indicators) ──
  const snappedX = bestXGuide !== null ? x + bestXDelta : x
  const snappedY = bestYGuide !== null ? y + bestYDelta : y
  const gapGuides = _computeGapIndicators({ x: snappedX, y: snappedY, width, height }, otherRects)
  guides.push(...gapGuides)

  return {
    snappedX: bestXGuide !== null ? snappedX : null,
    snappedY: bestYGuide !== null ? snappedY : null,
    guides,
  }
}

/**
 * 균등 간격 스냅 — 인접 요소들 사이 간격이 동일해지는 위치 감지
 */
function _computeEqualSpacingSnap(movingRect, otherRects, threshold) {
  const { x, y, width, height } = movingRect
  let snapX = null, snapY = null
  const guides = []

  if (otherRects.length < 2) return { snapX, snapY, guides }

  // X축: 좌측/우측에 가장 가까운 요소 찾기
  const sortedX = otherRects
    .map(r => ({ ...r, cx: r.x + r.width / 2 }))
    .sort((a, b) => a.cx - b.cx)

  const myCx = x + width / 2
  // 인접 요소 쌍의 간격을 수집
  for (let i = 0; i < sortedX.length - 1; i++) {
    const a = sortedX[i], b = sortedX[i + 1]
    const gapAB = b.x - (a.x + a.width) // a와 b 사이 간격

    // 이동 요소가 a 왼쪽에 올 때: x + width ~ a.x 간격 = gapAB
    const posLeft = a.x - gapAB - width
    if (Math.abs(posLeft - x) < threshold) {
      snapX = posLeft
      const gapPos = posLeft + width + gapAB / 2
      const abMid = a.x + a.width + gapAB / 2
      guides.push(
        { orientation: 'v', position: posLeft + width + gapAB / 2, type: 'spacing', distance: Math.round(gapAB) },
        { orientation: 'v', position: abMid, type: 'spacing', distance: Math.round(gapAB) },
      )
      break
    }
    // 이동 요소가 b 오른쪽에 올 때
    const posRight = b.x + b.width + gapAB
    if (Math.abs(posRight - x) < threshold) {
      snapX = posRight
      const abMid = a.x + a.width + gapAB / 2
      guides.push(
        { orientation: 'v', position: b.x + b.width + gapAB / 2, type: 'spacing', distance: Math.round(gapAB) },
        { orientation: 'v', position: abMid, type: 'spacing', distance: Math.round(gapAB) },
      )
      break
    }
    // 이동 요소가 a와 b 사이에 올 때: 양쪽 간격 동일
    const gapEach = (b.x - (a.x + a.width) - width) / 2
    if (gapEach > 0) {
      const posBetween = a.x + a.width + gapEach
      if (Math.abs(posBetween - x) < threshold) {
        snapX = posBetween
        guides.push(
          { orientation: 'v', position: a.x + a.width + gapEach / 2, type: 'spacing', distance: Math.round(gapEach) },
          { orientation: 'v', position: posBetween + width + gapEach / 2, type: 'spacing', distance: Math.round(gapEach) },
        )
        break
      }
    }
  }

  // Y축: 동일 로직
  const sortedY = otherRects
    .map(r => ({ ...r, cy: r.y + r.height / 2 }))
    .sort((a, b) => a.cy - b.cy)

  for (let i = 0; i < sortedY.length - 1; i++) {
    const a = sortedY[i], b = sortedY[i + 1]
    const gapAB = b.y - (a.y + a.height)

    const posTop = a.y - gapAB - height
    if (Math.abs(posTop - y) < threshold) {
      snapY = posTop
      guides.push(
        { orientation: 'h', position: posTop + height + gapAB / 2, type: 'spacing', distance: Math.round(gapAB) },
        { orientation: 'h', position: a.y + a.height + gapAB / 2, type: 'spacing', distance: Math.round(gapAB) },
      )
      break
    }
    const posBottom = b.y + b.height + gapAB
    if (Math.abs(posBottom - y) < threshold) {
      snapY = posBottom
      guides.push(
        { orientation: 'h', position: b.y + b.height + gapAB / 2, type: 'spacing', distance: Math.round(gapAB) },
      )
      break
    }
    const gapEach = (b.y - (a.y + a.height) - height) / 2
    if (gapEach > 0) {
      const posBetween = a.y + a.height + gapEach
      if (Math.abs(posBetween - y) < threshold) {
        snapY = posBetween
        guides.push(
          { orientation: 'h', position: a.y + a.height + gapEach / 2, type: 'spacing', distance: Math.round(gapEach) },
          { orientation: 'h', position: posBetween + height + gapEach / 2, type: 'spacing', distance: Math.round(gapEach) },
        )
        break
      }
    }
  }

  return { snapX, snapY, guides }
}

/**
 * 간격 표시 — 이동 요소와 가장 가까운 요소 사이 거리
 */
function _computeGapIndicators(rect, otherRects) {
  const guides = []
  const { x, y, width, height } = rect

  // 가장 가까운 요소 (상하좌우)
  let closestLeft = null, closestRight = null, closestTop = null, closestBottom = null
  let minDL = Infinity, minDR = Infinity, minDT = Infinity, minDB = Infinity

  for (const r of otherRects) {
    // 수직 겹침 확인 (좌우 간격 측정 가능)
    const vOverlap = !(y + height <= r.y || y >= r.y + r.height)
    if (vOverlap) {
      const dLeft = x - (r.x + r.width) // 왼쪽 요소와의 간격
      if (dLeft > 0 && dLeft < minDL) { minDL = dLeft; closestLeft = r }
      const dRight = r.x - (x + width)
      if (dRight > 0 && dRight < minDR) { minDR = dRight; closestRight = r }
    }
    // 수평 겹침 확인 (상하 간격 측정 가능)
    const hOverlap = !(x + width <= r.x || x >= r.x + r.width)
    if (hOverlap) {
      const dTop = y - (r.y + r.height)
      if (dTop > 0 && dTop < minDT) { minDT = dTop; closestTop = r }
      const dBottom = r.y - (y + height)
      if (dBottom > 0 && dBottom < minDB) { minDB = dBottom; closestBottom = r }
    }
  }

  const midY = y + height / 2
  const midX = x + width / 2

  if (closestLeft && minDL < 200) {
    guides.push({ type: 'gap', orientation: 'h', position: midY,
      from: closestLeft.x + closestLeft.width, to: x, distance: Math.round(minDL) })
  }
  if (closestRight && minDR < 200) {
    guides.push({ type: 'gap', orientation: 'h', position: midY,
      from: x + width, to: closestRight.x, distance: Math.round(minDR) })
  }
  if (closestTop && minDT < 200) {
    guides.push({ type: 'gap', orientation: 'v', position: midX,
      from: closestTop.y + closestTop.height, to: y, distance: Math.round(minDT) })
  }
  if (closestBottom && minDB < 200) {
    guides.push({ type: 'gap', orientation: 'v', position: midX,
      from: y + height, to: closestBottom.y, distance: Math.round(minDB) })
  }

  return guides
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

  // edge 우선 스냅: edgePos에서 먼저 찾고, 없으면 centerPos 폴백
  function findSnap(targets, edgePos, centerPos) {
    let bestDist = Infinity, bestDelta = 0, bestGuide = null
    for (const tp of targets) {
      const dist = Math.abs(edgePos - tp)
      if (dist < threshold && dist < bestDist) {
        bestDist = dist; bestDelta = tp - edgePos; bestGuide = tp
      }
    }
    if (bestGuide === null) {
      for (const tp of targets) {
        const dist = Math.abs(centerPos - tp)
        if (dist < threshold && dist < bestDist) {
          bestDist = dist; bestDelta = (tp - centerPos) * 2; bestGuide = tp
        }
      }
    }
    return { bestDelta, bestGuide }
  }

  const guides = []

  // X축
  if (dir.includes('e')) {
    const { bestDelta, bestGuide } = findSnap(targetXPoints, x + width, x + width / 2)
    if (bestGuide !== null) {
      width += bestDelta
      guides.push({ orientation: 'v', position: bestGuide })
    }
  } else if (dir.includes('w')) {
    const { bestDelta, bestGuide } = findSnap(targetXPoints, x, x + width / 2)
    if (bestGuide !== null) {
      x += bestDelta; width -= bestDelta
      guides.push({ orientation: 'v', position: bestGuide })
    }
  }

  // Y축
  if (dir.includes('s')) {
    const { bestDelta, bestGuide } = findSnap(targetYPoints, y + height, y + height / 2)
    if (bestGuide !== null) {
      height += bestDelta
      guides.push({ orientation: 'h', position: bestGuide })
    }
  } else if (dir.includes('n')) {
    const { bestDelta, bestGuide } = findSnap(targetYPoints, y, y + height / 2)
    if (bestGuide !== null) {
      y += bestDelta; height -= bestDelta
      guides.push({ orientation: 'h', position: bestGuide })
    }
  }

  // ── 크기 매칭 스냅: 인접 요소와 동일 width/height에 스냅 ──
  for (const r of otherRects) {
    if (dir.includes('e') || dir.includes('w')) {
      if (Math.abs(width - r.width) < threshold) {
        const delta = r.width - width
        if (dir.includes('e')) width += delta
        else { x -= delta; width += delta }
        guides.push({ type: 'size', orientation: 'v', dimension: 'width', targetSize: r.width,
          position: r.x, from: r.y, to: r.y + r.height })
        break
      }
    }
    if (dir.includes('s') || dir.includes('n')) {
      if (Math.abs(height - r.height) < threshold) {
        const delta = r.height - height
        if (dir.includes('s')) height += delta
        else { y -= delta; height += delta }
        guides.push({ type: 'size', orientation: 'h', dimension: 'height', targetSize: r.height,
          position: r.y, from: r.x, to: r.x + r.width })
        break
      }
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
