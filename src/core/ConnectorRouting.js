/**
 * ConnectorRouting — 다이어그램 커넥터(도형 연결선)의 기하 계산 (순수 함수, API/캔버스 의존 없음)
 *
 * 커넥터의 끝점/bbox/points는 "유도값"이다. 모델에는 연결 참조(connection)만 저장하고,
 * 렌더·선택·내보내기 직전에 참조 도형의 현재 위치에서 끝점을 계산한다.
 * → 도형이 이동/리사이즈되면 커넥터가 자동으로 따라 붙는다(별도 리라우팅 훅 불필요).
 *
 * v1: 직선(straight)만. 가장자리 자유점(도형 둘레 최근접점) 부착.
 *
 * connection 모델:
 *   { start: {elementId} | {point:{x,y}}, end: {elementId} | {point:{x,y}} }
 */

const DEFAULT_PAD = 4        // stroke 가시성을 위한 bbox 여백 (finalizeDraw 규약과 동일)
const ATTACH_THRESHOLD = 12  // 자석 스냅 임계(캔버스 단위)

/** 사각형 중심 */
export function rectCenter(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/**
 * 사각형 중심에서 toward 방향 광선이 사각형 변과 만나는 점.
 * (축 정렬 bbox 근사 — 회전/둥근 모서리는 v1에서 bbox로 취급)
 */
export function rectBorderPoint(rect, toward) {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = rect.width / 2
  const hh = rect.height / 2
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** connection의 한쪽 끝에서 참조 요소(있으면) 반환 */
function endEl(end, byId) {
  return end && end.elementId != null ? (byId[end.elementId] || null) : null
}

// ── 고정 연결점(핸들) — draw.io식 fixed connection point ──
// 정규화 좌표(fx,fy)로 도형 둘레의 특정 지점에 부착. 도형 이동/리사이즈해도 상대 위치 유지.
// 8개: 4변 중점 + 4모서리.
export const CONNECTION_ANCHORS = [
  { fx: 0.5, fy: 0 }, { fx: 1, fy: 0.5 }, { fx: 0.5, fy: 1 }, { fx: 0, fy: 0.5 }, // N E S W
  { fx: 0, fy: 0 }, { fx: 1, fy: 0 }, { fx: 1, fy: 1 }, { fx: 0, fy: 1 },          // NW NE SE SW
]

/** 끝점이 고정 연결점인지 (elementId + fx/fy 보유) */
export function isFixedEnd(end) {
  return !!(end && end.elementId != null && end.fx != null && end.fy != null)
}

/** 도형 + 정규화 좌표 → 절대 좌표 */
export function anchorPoint(el, fx, fy) {
  return { x: el.x + fx * el.width, y: el.y + fy * el.height }
}

/** 도형의 8개 연결점(절대 좌표 + fx/fy) */
export function connectionPoints(el) {
  return CONNECTION_ANCHORS.map(a => ({ fx: a.fx, fy: a.fy, ...anchorPoint(el, a.fx, a.fy) }))
}

/** (px,py)에서 threshold 내 가장 가까운 연결점 반환(없으면 null) */
export function nearestConnectionPoint(px, py, el, threshold) {
  let best = null, bestD = threshold
  for (const p of connectionPoints(el)) {
    const d = Math.hypot(px - p.x, py - p.y)
    if (d <= bestD) { bestD = d; best = p }
  }
  return best
}

/** 고정 연결점(fx,fy)의 바깥 진출 법선. 모서리/내부는 상대편(dx,dy) 우세축으로. */
function anchorNormal(fx, fy, dx, dy) {
  const onLeft = fx === 0, onRight = fx === 1, onTop = fy === 0, onBottom = fy === 1
  const corner = (onLeft || onRight) && (onTop || onBottom)
  if (corner) {
    return Math.abs(dx) >= Math.abs(dy)
      ? { x: onRight ? 1 : -1, y: 0 }
      : { x: 0, y: onBottom ? 1 : -1 }
  }
  if (onLeft) return { x: -1, y: 0 }
  if (onRight) return { x: 1, y: 0 }
  if (onTop) return { x: 0, y: -1 }
  if (onBottom) return { x: 0, y: 1 }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 }
}

/** 끝점의 '참조점'(상대편이 향할 좌표) — 고정점/도형중심/자유점 */
function endRefPoint(end, byId) {
  const el = endEl(end, byId)
  if (el && isFixedEnd(end)) return anchorPoint(el, end.fx, end.fy)
  if (el) return rectCenter(el)
  return end && end.point ? { x: end.point.x, y: end.point.y } : null
}

/**
 * 커넥터 양 끝의 절대 좌표를 계산.
 * - 둘 다 부착: 각 도형 둘레에서 상대 도형 중심을 향한 변 위의 점
 * - 한쪽만 부착: 부착끝은 자유점을 향한 변 위의 점, 자유끝은 자유점 그대로
 * - 둘 다 자유: 저장된 point 사용
 * @returns {{start:{x,y}, end:{x,y}} | null}
 */
export function resolveConnectorEndpoints(connection, byId) {
  if (!connection || !connection.start || !connection.end) return null
  const a = connection.start
  const b = connection.end
  const aEl = endEl(a, byId)
  const bEl = endEl(b, byId)

  // 상대편이 향할 참조점(고정점/중심/자유점)
  const aRef = endRefPoint(a, byId)
  const bRef = endRefPoint(b, byId)

  // 각 끝의 위치: 고정점이면 그 점, 부착이면 상대 참조점을 향한 변 위 점, 자유면 그 점
  const resolveEnd = (end, el, otherRef) => {
    if (el && isFixedEnd(end)) return anchorPoint(el, end.fx, end.fy)
    if (el) return otherRef ? rectBorderPoint(el, otherRef) : rectCenter(el)
    return end && end.point ? { x: end.point.x, y: end.point.y } : null
  }
  const start = resolveEnd(a, aEl, bRef)
  const end = resolveEnd(b, bEl, aRef)
  if (!start || !end) return null
  return { start, end }
}

const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 큐빅 베지어 점 B(t) */
function _cubic(p0, c1, c2, p1, t) {
  const u = 1 - t
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
  }
}

/**
 * 한 끝점의 위치 + 바깥 진출 법선 계산.
 * - 고정 연결점(fx/fy): 그 점 + 변 법선(모서리는 상대 우세축).
 * - 플로팅(부착): 상대 참조점을 향한 우세축 변에 수직(변 위 점은 상대 cross좌표로 클램프).
 * - 자유점: 상대 향한 우세축.
 */
function endpointGeom(end, el, otherRef) {
  if (el && isFixedEnd(end)) {
    const pos = anchorPoint(el, end.fx, end.fy)
    const dx = (otherRef?.x ?? pos.x) - pos.x, dy = (otherRef?.y ?? pos.y) - pos.y
    return { pos, normal: anchorNormal(end.fx, end.fy, dx, dy) }
  }
  if (el) {
    const cx = el.x + el.width / 2, cy = el.y + el.height / 2
    const ref = otherRef || { x: cx, y: cy }
    const dx = ref.x - cx, dy = ref.y - cy
    if (Math.abs(dx) >= Math.abs(dy)) {
      const right = dx >= 0
      return {
        pos: { x: right ? el.x + el.width : el.x, y: _clamp(ref.y, el.y, el.y + el.height) },
        normal: { x: right ? 1 : -1, y: 0 },
      }
    }
    const down = dy >= 0
    return {
      pos: { x: _clamp(ref.x, el.x, el.x + el.width), y: down ? el.y + el.height : el.y },
      normal: { x: 0, y: down ? 1 : -1 },
    }
  }
  if (!end || !end.point) return null
  const pos = { x: end.point.x, y: end.point.y }
  const dx = (otherRef?.x ?? pos.x) - pos.x, dy = (otherRef?.y ?? pos.y) - pos.y
  const normal = Math.abs(dx) >= Math.abs(dy)
    ? { x: Math.sign(dx) || 1, y: 0 }
    : { x: 0, y: Math.sign(dy) || 1 }
  return { pos, normal }
}

/**
 * 곡선 커넥터 기하 — draw.io 'curved' 식. 변(side) 수직 진출/진입 + 대칭 제어점.
 * 끝점이 고정 연결점(fx/fy)이면 그 점에서, 플로팅이면 상대 향한 변에서 수직 진출.
 * @returns {{start,end,c1,c2} | null} 모두 절대 좌표
 */
export function resolveConnectorCurve(connection, byId) {
  if (!connection || !connection.start || !connection.end) return null
  const a = connection.start, b = connection.end
  const aEl = endEl(a, byId), bEl = endEl(b, byId)
  const aRef = endRefPoint(a, byId), bRef = endRefPoint(b, byId)
  const aG = endpointGeom(a, aEl, bRef)
  const bG = endpointGeom(b, bEl, aRef)
  if (!aG || !bG) return null
  const start = aG.pos, end = bG.pos
  const dist = Math.hypot(end.x - start.x, end.y - start.y)
  const d = Math.max(30, Math.min(dist * 0.5, 200)) // 수직 진출 길이(대칭)
  return {
    start, end,
    c1: { x: start.x + aG.normal.x * d, y: start.y + aG.normal.y * d },
    c2: { x: end.x + bG.normal.x * d, y: end.y + bG.normal.y * d },
  }
}

/**
 * 커넥터의 유도 기하(bbox + bbox 상대 points[, curve]) 계산.
 * 곡선(routing==='curved')이면 곡선 샘플로 타이트한 bbox + curve(제어점, bbox 상대) 포함.
 * @returns {{x,y,width,height,points:[{x,y},{x,y}],curve?:{c1,c2}} | null}
 */
export function resolveConnectorGeometry(connector, byId, pad = DEFAULT_PAD) {
  if (connector.routing === 'curved') {
    const cv = resolveConnectorCurve(connector.connection, byId)
    if (cv) {
      // 곡선을 샘플링해 실제 곡선이 포함되는 타이트한 bbox
      const xs = [], ys = []
      const N = 16
      for (let i = 0; i <= N; i++) {
        const p = _cubic(cv.start, cv.c1, cv.c2, cv.end, i / N)
        xs.push(p.x); ys.push(p.y)
      }
      const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
      const width = (Math.max(...xs) - Math.min(...xs)) + pad * 2
      const height = (Math.max(...ys) - Math.min(...ys)) + pad * 2
      return {
        x, y, width, height,
        points: [{ x: cv.start.x - x, y: cv.start.y - y }, { x: cv.end.x - x, y: cv.end.y - y }],
        curve: { c1: { x: cv.c1.x - x, y: cv.c1.y - y }, c2: { x: cv.c2.x - x, y: cv.c2.y - y } },
      }
    }
  }
  const eps = resolveConnectorEndpoints(connector.connection, byId)
  if (!eps) return null
  const { start, end } = eps
  const minX = Math.min(start.x, end.x)
  const minY = Math.min(start.y, end.y)
  const maxX = Math.max(start.x, end.x)
  const maxY = Math.max(start.y, end.y)
  const x = minX - pad
  const y = minY - pad
  const width = (maxX - minX) + pad * 2
  const height = (maxY - minY) + pad * 2
  const points = [
    { x: start.x - x, y: start.y - y },
    { x: end.x - x, y: end.y - y },
  ]
  return { x, y, width, height, points }
}

/** 커넥터 여부 */
export function isConnector(el) {
  return !!(el && el.shapeType === 'connector')
}

/**
 * flatElements 중 커넥터의 기하(x/y/width/height/points)를 참조 도형 기준으로 채운 새 배열 반환.
 * 도형 요소는 그대로 통과. (해석 불가한 커넥터는 원본 유지)
 */
export function resolveConnectors(flatElements, pad = DEFAULT_PAD) {
  if (!Array.isArray(flatElements)) return flatElements
  const byId = {}
  for (const el of flatElements) byId[el.id] = el
  let changed = false
  const out = flatElements.map(el => {
    if (!isConnector(el) || !el.connection) return el
    const geo = resolveConnectorGeometry(el, byId, pad)
    if (!geo) return el
    changed = true
    return { ...el, ...geo }
  })
  return changed ? out : flatElements
}

/**
 * 커서 위치(px,py)에서 부착 후보 요소 id 반환(없으면 null).
 * 커넥터·배경은 제외, z 최상위 우선, 임계 확장 rect 안이면 후보.
 */
export function attachTargetAt(px, py, elements, opts = {}) {
  const threshold = opts.threshold ?? ATTACH_THRESHOLD
  const excludeId = opts.excludeId ?? null
  const cs = opts.canvasSize ?? null
  // 전체 캔버스를 덮는 요소(플래그 없는 크기추론 배경 포함)는 부착 대상에서 제외
  const isFullCanvas = (el) => cs &&
    Math.abs(el.width - cs.w) < 2 && Math.abs(el.height - cs.h) < 2 &&
    Math.abs(el.x) < 2 && Math.abs(el.y) < 2
  const cand = elements
    .filter(el =>
      !isConnector(el) &&
      !el.isBackground &&
      el.sourceId !== '__bg' &&
      !isFullCanvas(el) &&
      el.id !== excludeId
    )
    .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
  for (const el of cand) {
    if (
      px >= el.x - threshold && px <= el.x + el.width + threshold &&
      py >= el.y - threshold && py <= el.y + el.height + threshold
    ) {
      return el.id
    }
  }
  return null
}

export { DEFAULT_PAD as CONNECTOR_PAD, ATTACH_THRESHOLD }
