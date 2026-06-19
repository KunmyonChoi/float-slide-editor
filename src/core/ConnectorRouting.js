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

  // 자유 끝점(부착 안 됨) 또는 참조 도형을 못 찾을 때의 폴백 좌표
  const aFree = a.point || null
  const bFree = b.point || null

  let start, end
  if (aEl && bEl) {
    start = rectBorderPoint(aEl, rectCenter(bEl))
    end = rectBorderPoint(bEl, rectCenter(aEl))
  } else if (aEl && !bEl) {
    if (!bFree) return null
    start = rectBorderPoint(aEl, bFree)
    end = { x: bFree.x, y: bFree.y }
  } else if (!aEl && bEl) {
    if (!aFree) return null
    start = { x: aFree.x, y: aFree.y }
    end = rectBorderPoint(bEl, aFree)
  } else {
    if (!aFree || !bFree) return null
    start = { x: aFree.x, y: aFree.y }
    end = { x: bFree.x, y: bFree.y }
  }
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
 * 곡선 커넥터 기하 — draw.io 'curved' 식. 변(side) 기반 수직 진출/진입 + 대칭 제어점.
 * - 양끝이 도형이면: 상대 위치(분리 큰 축)로 마주보는 변 선택 → 그 변에 **수직**으로
 *   나가는 대칭 큐빅(정렬=직선, 오프셋=부드러운 대칭 S).
 * - 한쪽이 자유점이면: 끝점 사이 우세축으로 진출하는 근사 곡선(드래그 중 등).
 * @returns {{start,end,c1,c2} | null} 모두 절대 좌표
 */
export function resolveConnectorCurve(connection, byId) {
  if (!connection || !connection.start || !connection.end) return null
  const aEl = endEl(connection.start, byId)
  const bEl = endEl(connection.end, byId)
  if (aEl && bEl) {
    const A = { x: aEl.x, y: aEl.y, w: aEl.width, h: aEl.height }
    const B = { x: bEl.x, y: bEl.y, w: bEl.width, h: bEl.height }
    const acx = A.x + A.w / 2, acy = A.y + A.h / 2
    const bcx = B.x + B.w / 2, bcy = B.y + B.h / 2
    const dx = bcx - acx, dy = bcy - acy
    let start, end, nA, nB
    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) { // B가 오른쪽 → A 동, B 서
        start = { x: A.x + A.w, y: _clamp(bcy, A.y, A.y + A.h) }; nA = { x: 1, y: 0 }
        end = { x: B.x, y: _clamp(acy, B.y, B.y + B.h) }; nB = { x: -1, y: 0 }
      } else {
        start = { x: A.x, y: _clamp(bcy, A.y, A.y + A.h) }; nA = { x: -1, y: 0 }
        end = { x: B.x + B.w, y: _clamp(acy, B.y, B.y + B.h) }; nB = { x: 1, y: 0 }
      }
    } else {
      if (dy >= 0) { // B가 아래 → A 남, B 북
        start = { x: _clamp(bcx, A.x, A.x + A.w), y: A.y + A.h }; nA = { x: 0, y: 1 }
        end = { x: _clamp(acx, B.x, B.x + B.w), y: B.y }; nB = { x: 0, y: -1 }
      } else {
        start = { x: _clamp(bcx, A.x, A.x + A.w), y: A.y }; nA = { x: 0, y: -1 }
        end = { x: _clamp(acx, B.x, B.x + B.w), y: B.y + B.h }; nB = { x: 0, y: 1 }
      }
    }
    const dist = Math.hypot(end.x - start.x, end.y - start.y)
    const d = Math.max(30, Math.min(dist * 0.5, 200)) // 수직 진출 길이(대칭)
    return {
      start, end,
      c1: { x: start.x + nA.x * d, y: start.y + nA.y * d },
      c2: { x: end.x + nB.x * d, y: end.y + nB.y * d },
    }
  }
  // 자유 끝점 폴백 — 우세축으로 진출
  const eps = resolveConnectorEndpoints(connection, byId)
  if (!eps) return null
  const { start, end } = eps
  const dx = end.x - start.x, dy = end.y - start.y
  const d = Math.max(20, Math.min(Math.hypot(dx, dy) * 0.4, 140))
  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx) || 1
    return { start, end, c1: { x: start.x + s * d, y: start.y }, c2: { x: end.x - s * d, y: end.y } }
  }
  const s = Math.sign(dy) || 1
  return { start, end, c1: { x: start.x, y: start.y + s * d }, c2: { x: end.x, y: end.y - s * d } }
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
