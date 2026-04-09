/**
 * RotationUtils — 회전 관련 순수 함수
 */

const DEG = 180 / Math.PI

/**
 * 중심점에서 마우스까지의 각도 계산 (degrees)
 * 핸들이 상단 중앙에 있으므로 -90° 오프셋 적용
 */
export function computeRotationAngle(cx, cy, mouseX, mouseY) {
  return Math.atan2(mouseY - cy, mouseX - cx) * DEG + 90
}

/**
 * 45° 단위 스냅 (Shift 키)
 */
export function snapRotation(deg, snapAngles = [0, 45, 90, 135, 180, 225, 270, 315], threshold = 5) {
  // -180~180 범위로 정규화
  let norm = ((deg % 360) + 360) % 360
  for (const angle of snapAngles) {
    if (Math.abs(norm - angle) <= threshold || Math.abs(norm - angle + 360) <= threshold || Math.abs(norm - angle - 360) <= threshold) {
      return angle
    }
  }
  return deg
}

/**
 * 각도를 0~360 범위로 정규화
 */
export function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360
}

/**
 * 점을 중심점 기준으로 회전
 */
export function rotatePoint(px, py, cx, cy, angleDeg) {
  const rad = angleDeg / DEG
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = px - cx
  const dy = py - cy
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos,
  }
}

/**
 * 회전된 사각형의 축 정렬 바운딩박스 (AABB)
 */
export function getRotatedAABB(x, y, w, h, rotation) {
  if (!rotation) return { x, y, width: w, height: h }

  const cx = x + w / 2
  const cy = y + h / 2

  // 4개 꼭짓점 회전
  const corners = [
    rotatePoint(x, y, cx, cy, rotation),
    rotatePoint(x + w, y, cx, cy, rotation),
    rotatePoint(x + w, y + h, cx, cy, rotation),
    rotatePoint(x, y + h, cx, cy, rotation),
  ]

  const xs = corners.map(c => c.x)
  const ys = corners.map(c => c.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * 캔버스 좌표의 마우스 delta를 요소 로컬 좌표로 변환 (회전 역변환)
 */
export function canvasDeltaToLocal(dx, dy, rotationDeg) {
  if (!rotationDeg) return { dx, dy }
  const rad = -rotationDeg / DEG
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    dx: dx * cos - dy * sin,
    dy: dx * sin + dy * cos,
  }
}
