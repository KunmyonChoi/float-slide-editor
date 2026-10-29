/**
 * 터치 기기용 화면 이동 내비게이터(미니맵 패드 · 줌 슬라이더) 계산.
 *
 * 좌표 규약은 FlatCanvas와 같다 — 캔버스(슬라이드) 중심이 stage 중심 + pan(화면 px)에 놓이고,
 * 화면 배율은 scale. stage·view 크기는 { w, h }.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** 지금 화면에 보이는 영역(캔버스 좌표). 캔버스 밖으로 나간 부분도 그대로 돌려준다. */
export function visibleRect(stage, canvas, scale, pan) {
  const w = stage.w / scale, h = stage.h / scale
  return {
    x: canvas.w / 2 - pan.x / scale - w / 2,
    y: canvas.h / 2 - pan.y / scale - h / 2,
    w, h,
  }
}

/**
 * 캔버스 점 (cx, cy)를 화면 가운데에 두는 pan.
 * 보이는 영역이 슬라이드 밖으로 나가지 않게 가운데 점을 제한하고,
 * 그 축이 슬라이드보다 넓게 보이면 그 축은 가운데에 고정한다.
 */
export function panToCenter(cx, cy, canvas, scale, view) {
  const x = view.w >= canvas.w ? canvas.w / 2 : clamp(cx, view.w / 2, canvas.w - view.w / 2)
  const y = view.h >= canvas.h ? canvas.h / 2 : clamp(cy, view.h / 2, canvas.h - view.h / 2)
  return { x: (canvas.w / 2 - x) * scale, y: (canvas.h / 2 - y) * scale }
}

/** 미니맵 패드 크기 — 슬라이드 비율 그대로 maxW×maxH 안에. k = 패드 px / 캔버스 px. */
export function minimapSize(canvas, maxW = 132, maxH = 96) {
  const k = Math.min(maxW / canvas.w, maxH / canvas.h)
  return { w: Math.round(canvas.w * k), h: Math.round(canvas.h * k), k }
}

/**
 * 줌 슬라이더 범위: 맞춤 ~ 200%. 휴대폰은 맞춤이 20% 안팎이라 그보다 작게 줄이거나
 * 800%까지 키울 일이 없다. 맞춤이 이미 크면(작은 캔버스) 맞춤의 4배까지.
 */
export function zoomRange(fit, max = 8) {
  const hi = Math.min(max, Math.max(2, fit * 4))
  return { lo: fit, hi: Math.max(hi, fit) }
}

/** 배율 → 슬라이더 위치 0..1 (로그 눈금: 같은 거리 = 같은 배수). */
export function scaleToT(s, range) {
  if (!(range.hi > range.lo)) return 0
  return clamp(Math.log(s / range.lo) / Math.log(range.hi / range.lo), 0, 1)
}

/** 슬라이더 위치 0..1 → 배율. */
export function tToScale(t, range) {
  return range.lo * Math.pow(range.hi / range.lo, clamp(t, 0, 1))
}

/**
 * 슬라이더 위치를 배율로 바꾸며 자석을 건다. 왼쪽 끝 근처는 맞춤({ fit: true }),
 * 100% 근처는 정확히 1. snap = 슬라이더 길이에 대한 비율.
 */
export function snapZoom(t, range, snap = 0.04) {
  if (t <= snap) return { fit: true, scale: range.lo }
  if (range.lo < 1 && range.hi >= 1 && Math.abs(t - scaleToT(1, range)) <= snap) return { fit: false, scale: 1 }
  return { fit: false, scale: tToScale(t, range) }
}
