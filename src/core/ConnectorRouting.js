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

  // 부착 참조가 있으나 도형을 못 찾으면 저장 point로 폴백(없으면 계산 불가)
  const aFree = a.point || (aEl ? null : null)
  const bFree = b.point || (bEl ? null : null)

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

/**
 * 커넥터의 유도 기하(bbox + bbox 상대 points) 계산.
 * @returns {{x,y,width,height,points:[{x,y},{x,y}]} | null}
 */
export function resolveConnectorGeometry(connector, byId, pad = DEFAULT_PAD) {
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
  const cand = elements
    .filter(el =>
      !isConnector(el) &&
      !el.isBackground &&
      el.sourceId !== '__bg' &&
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
