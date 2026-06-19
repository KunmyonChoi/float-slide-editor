/**
 * PolyShapeUtils — 포인트 기반 shape (선, 폴리라인, 폴리곤) 유틸
 */

/** 커넥터 곡선 제어점 세기(코너점까지 당기는 비율) */
export const CURVE_STRENGTH = 0.5

/**
 * 2점 커넥터의 큐빅 베지어 제어점 계산 — '한 번 꺾인' 둥근 엘보 곡선.
 * 분리가 큰 축의 코너점(가로 우세=(b.x,a.y), 세로 우세=(a.x,b.y))을 향해 양끝을 같은 쪽으로
 * 당겨, 상대 위치에 맞는 유연한 단일 곡선을 만든다(변곡 없음 = S자 안 생김).
 * - 좌우 정렬(높이 같음): 코너가 직선 위 → 직선.
 * - 좌상-우하 등 대각: 코너 쪽으로 한 번만 부드럽게 휨.
 * @returns {{ c1:{x,y}, c2:{x,y} } | null} 점이 2개 미만이면 null
 */
export function connectorCurveControls(points, strength = CURVE_STRENGTH) {
  if (!points || points.length < 2) return null
  const a = points[0], b = points[points.length - 1]
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return { c1: { ...a }, c2: { ...b } }
  // 분리가 큰 축으로 먼저 빠져나가는 코너점
  const corner = Math.abs(dx) >= Math.abs(dy)
    ? { x: b.x, y: a.y }
    : { x: a.x, y: b.y }
  // 양끝을 같은 코너로 당김 → 두 제어점이 현(chord)의 같은 쪽 → 단일 곡선
  return {
    c1: { x: a.x + (corner.x - a.x) * strength, y: a.y + (corner.y - a.y) * strength },
    c2: { x: b.x + (corner.x - b.x) * strength, y: b.y + (corner.y - b.y) * strength },
  }
}

/**
 * 2점 커넥터 → 곡선(큐빅 베지어) SVG path d. 점이 2개 미만이면 직선 폴백.
 * @param {{x,y}[]} points
 */
export function connectorCurvePath(points, strength = CURVE_STRENGTH) {
  if (!points || points.length < 2) return pointsToSvgPath(points, false)
  const a = points[0], b = points[points.length - 1]
  const ctrl = connectorCurveControls(points, strength)
  if (!ctrl) return pointsToSvgPath(points, false)
  return `M ${a.x} ${a.y} C ${ctrl.c1.x} ${ctrl.c1.y} ${ctrl.c2.x} ${ctrl.c2.y} ${b.x} ${b.y}`
}

function cubicPoint(a, c1, c2, b, t) {
  const u = 1 - t
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
  return {
    x: w0 * a.x + w1 * c1.x + w2 * c2.x + w3 * b.x,
    y: w0 * a.y + w1 * c1.y + w2 * c2.y + w3 * b.y,
  }
}

/**
 * 커넥터 곡선/직선의 시각적 중점 — 라벨 배치용.
 * 직선이면 현의 중점. 곡선이면 호 길이 기준 중점(균일 t는 코너로 치우쳐 라벨이 어긋남).
 * @param {{x,y}[]} points
 * @param {boolean} curved
 */
export function connectorLabelMid(points, curved, strength = CURVE_STRENGTH) {
  if (!points || points.length < 2) return points?.[0] || { x: 0, y: 0 }
  const a = points[0], b = points[points.length - 1]
  const chordMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if (!curved) return chordMid
  const ctrl = connectorCurveControls(points, strength)
  if (!ctrl) return chordMid
  const { c1, c2 } = ctrl
  // 호 길이 절반 지점 샘플링
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
