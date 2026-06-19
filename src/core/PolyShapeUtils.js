/**
 * PolyShapeUtils — 포인트 기반 shape (선, 폴리라인, 폴리곤) 유틸
 */

function cubicPoint(a, c1, c2, b, t) {
  const u = 1 - t
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  }
}

/**
 * 커넥터 곡선 SVG path d. curve({c1,c2})가 있으면 큐빅 베지어, 없으면 직선.
 * 제어점은 ConnectorRouting이 변(side) 수직 진출 기준으로 계산해 넘겨준다(여기선 그리기만).
 * @param {{x,y}[]} points 끝점 2개(bbox 상대)
 * @param {{c1:{x,y},c2:{x,y}}} [curve] 제어점(bbox 상대)
 */
export function connectorCurvePath(points, curve) {
  if (!points || points.length < 2) return pointsToSvgPath(points, false)
  const a = points[0], b = points[points.length - 1]
  if (!curve || !curve.c1 || !curve.c2) return pointsToSvgPath([a, b], false)
  return `M ${a.x} ${a.y} C ${curve.c1.x} ${curve.c1.y} ${curve.c2.x} ${curve.c2.y} ${b.x} ${b.y}`
}

/**
 * 커넥터의 시각적 중점 — 라벨 배치용.
 * curve 없으면 현의 중점. 있으면 호 길이 기준 중점(균일 t는 한쪽으로 치우침).
 * @param {{x,y}[]} points 끝점 2개
 * @param {{c1,c2}} [curve] 제어점(있으면 곡선)
 */
export function connectorLabelMid(points, curve) {
  if (!points || points.length < 2) return points?.[0] || { x: 0, y: 0 }
  const a = points[0], b = points[points.length - 1]
  const chordMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (!curve || !curve.c1 || !curve.c2) return chordMid
  const { c1, c2 } = curve
  const N = 24
  const samples = [{ p: a, len: 0 }]
  let prev = a, total = 0
  for (let i = 1; i <= N; i++) {
    const p = cubicPoint(a, c1, c2, b, i / N)
    total += Math.hypot(p.x - prev.x, p.y - prev.y)
    samples.push({ p, len: total })
    prev = p
  }
  if (total < 1e-6) return chordMid
  const half = total / 2
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].len >= half) {
      const s0 = samples[i - 1], s1 = samples[i]
      const r = (half - s0.len) / ((s1.len - s0.len) || 1)
      return { x: s0.p.x + (s1.p.x - s0.p.x) * r, y: s0.p.y + (s1.p.y - s0.p.y) * r }
    }
  }
  return cubicPoint(a, c1, c2, b, 0.5)
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
