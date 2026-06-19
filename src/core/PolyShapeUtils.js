/**
 * PolyShapeUtils — 포인트 기반 shape (선, 폴리라인, 폴리곤) 유틸
 */

/** 커넥터 곡선 기본 곡률(현 길이 대비 제어점 수직 오프셋 비율) */
export const CURVE_CURVATURE = 0.22

/**
 * 2점 커넥터의 큐빅 베지어 제어점 계산.
 * 현(chord)의 1/3·2/3 지점에서 같은 방향으로 수직 오프셋 → 부드러운 C자 곡선.
 * @returns {{ c1:{x,y}, c2:{x,y} } | null} 점이 2개 미만이면 null
 */
export function connectorCurveControls(points, curvature = CURVE_CURVATURE) {
  if (!points || points.length < 2) return null
  const a = points[0], b = points[points.length - 1]
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return { c1: { ...a }, c2: { ...b } }
  // 수직 단위벡터 × 오프셋(길이에 비례, 과도하지 않게 상한)
  const off = Math.min(len * curvature, 160)
  const px = -dy / len * off, py = dx / len * off
  return {
    c1: { x: a.x + dx / 3 + px, y: a.y + dy / 3 + py },
    c2: { x: a.x + dx * 2 / 3 + px, y: a.y + dy * 2 / 3 + py },
  }
}

/**
 * 2점 커넥터 → 곡선(큐빅 베지어) SVG path d. 점이 2개 미만이면 직선 폴백.
 * @param {{x,y}[]} points
 */
export function connectorCurvePath(points, curvature = CURVE_CURVATURE) {
  if (!points || points.length < 2) return pointsToSvgPath(points, false)
  const a = points[0], b = points[points.length - 1]
  const ctrl = connectorCurveControls(points, curvature)
  if (!ctrl) return pointsToSvgPath(points, false)
  return `M ${a.x} ${a.y} C ${ctrl.c1.x} ${ctrl.c1.y} ${ctrl.c2.x} ${ctrl.c2.y} ${b.x} ${b.y}`
}

/**
 * 커넥터 곡선의 중점(t=0.5) — 라벨 배치용. routing이 곡선이 아니면 현의 중점.
 * @param {{x,y}[]} points
 * @param {boolean} curved
 */
export function connectorLabelMid(points, curved, curvature = CURVE_CURVATURE) {
  if (!points || points.length < 2) return points?.[0] || { x: 0, y: 0 }
  const a = points[0], b = points[points.length - 1]
  if (!curved) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const ctrl = connectorCurveControls(points, curvature)
  if (!ctrl) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  // 큐빅 베지어 B(0.5) = (a + 3·c1 + 3·c2 + b) / 8
  const { c1, c2 } = ctrl
  return {
    x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
    y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
  }
}

/**
 * points 배열 → SVG path d 속성
 * @param {{ x: number, y: number }[]} points - bbox 내 상대 좌표
 * @param {boolean} closed - 닫힌 도형 여부
 * @returns {string} SVG path d attribute
 */
export function pointsToSvgPath(points, closed) {
  if (!points || points.length < 2) return ''
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return closed ? d + ' Z' : d
}

/**
 * points 배열 → bounding box
 * @param {{ x: number, y: number }[]} points - 캔버스 절대 좌표
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function pointsToBBox(points) {
  if (!points || points.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const maxX = Math.max(...xs), maxY = Math.max(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  }
}

/**
 * 캔버스 절대 좌표의 points를 bbox 상대 좌표로 변환
 * (요소의 x,y를 원점으로 한 로컬 좌표)
 */
export function absoluteToRelativePoints(points, bbox) {
  return points.map(p => ({ x: p.x - bbox.x, y: p.y - bbox.y }))
}

/**
 * bbox 상대 좌표의 points를 캔버스 절대 좌표로 변환
 */
export function relativeToAbsolutePoints(points, element) {
  return points.map(p => ({ x: p.x + element.x, y: p.y + element.y }))
}

/**
 * 선분 위의 가장 가까운 점과의 거리 계산 (포인트 삽입 판정용)
 * @returns {{ distance: number, segmentIndex: number, point: { x, y } }}
 */
export function closestPointOnSegments(px, py, points) {
  let minDist = Infinity, bestSeg = -1, bestPt = null

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0
    t = Math.max(0, Math.min(1, t))
    const cx = a.x + t * dx, cy = a.y + t * dy
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
    if (dist < minDist) {
      minDist = dist; bestSeg = i; bestPt = { x: cx, y: cy }
    }
  }

  return { distance: minDist, segmentIndex: bestSeg, point: bestPt }
}

/**
 * points를 SVG 문자열로 (export용)
 */
export function pointsToSvgElement(points, closed, styles, width, height) {
  const d = pointsToSvgPath(
    points.map(p => ({ x: p.x, y: p.y })),
    closed
  )
  const stroke = styles.stroke || '#000'
  const sw = styles.strokeWidth || '2'
  const dash = styles.strokeDasharray || ''
  const fill = closed ? (styles.fill || 'none') : 'none'

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<path d="${d}" stroke="${stroke}" stroke-width="${sw}" fill="${fill}"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') +
    ` stroke-linecap="round" stroke-linejoin="round" />` +
    `</svg>`
}
