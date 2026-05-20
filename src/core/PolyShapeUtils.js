/**
 * PolyShapeUtils — 포인트 기반 shape (선, 폴리라인, 폴리곤) 유틸
 */

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
