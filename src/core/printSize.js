/**
 * printSize — 인쇄물(포스터·배너·패널) 치수 계산.
 *
 * 화면용 캔버스는 "몇 픽셀인가"가 전부지만, 인쇄물은 **몇 밀리미터인가**가 먼저다.
 * 픽셀은 거기서 역산된다. 이 모듈이 그 역산과, 인쇄에만 있는 개념(해상도·재단 여백·
 * 안전 영역·보는 거리)을 한 곳에 모은다.
 *
 * **캔버스를 인쇄 픽셀(300dpi)로 잡지 않는다.** A2만 해도 4961×7016이라 캔버스 상한을
 * 넘고, 에디터의 좌표·글자 크기 감각(1920 기준)과도 어긋난다. 대신 **비율만 맞추고
 * 해상도는 내보내기 배율로 만든다** — 캔버스 2250×3750을 2배로 내보내면 152dpi다.
 *
 * 대형 출력에 300dpi는 필요 없다. 보는 거리가 멀기 때문이다.
 */

export const MM_PER_IN = 25.4

/** 재단 여유 — 인쇄소가 보통 요구하는 사방 여분(mm). 이만큼 잘려 나간다. */
export const BLEED_MM = 3

/** 글자를 두지 않을 가장자리 폭(mm). 대형 출력은 재단 오차가 커서 넉넉히 잡는다. */
export const SAFE_MM = 50

/** 보는 거리별 적정 해상도. 멀리서 보는 것에 300dpi는 낭비다. */
export const DPI_BY_DISTANCE = [
  { maxM: 0.5, dpi: 300, label: '손에 드는 인쇄물' },
  { maxM: 2,   dpi: 150, label: '부스 포스터 · 패널' },
  { maxM: 5,   dpi: 100, label: '대형 패널' },
  { maxM: Infinity, dpi: 72, label: '현수막 · 간판' },
]

/**
 * 인쇄 규격. w/h는 mm.
 * portrait=true면 세로가 긴 것이고, 가로로 쓰려면 swap()으로 뒤집는다.
 */
export const PRINT_FORMATS = [
  { id: 'a4',      label: 'A4',        w: 210,  h: 297  },
  { id: 'a3',      label: 'A3',        w: 297,  h: 420  },
  { id: 'a2',      label: 'A2',        w: 420,  h: 594  },
  { id: 'a1',      label: 'A1',        w: 594,  h: 841  },
  { id: 'a0',      label: 'A0',        w: 841,  h: 1189 },
  { id: 'b2',      label: 'B2',        w: 500,  h: 707  },
  { id: 'b1',      label: 'B1',        w: 707,  h: 1000 },
  { id: 'booth',   label: '부스 포스터', w: 750,  h: 1250, note: '전시 부스 벽면' },
  { id: 'xbanner', label: 'X 배너',    w: 600,  h: 1800, note: '거치대 배너' },
  { id: 'rollup',  label: '롤업 배너',  w: 850,  h: 2000, note: '롤업 거치대' },
]

/** 가로/세로 뒤집기. */
export function swap(mm) {
  return { w: mm.h, h: mm.w }
}

/** 보는 거리(m)에 맞는 권장 해상도. */
export function dpiForDistance(distM) {
  return (DPI_BY_DISTANCE.find(r => distM <= r.maxM) || DPI_BY_DISTANCE[DPI_BY_DISTANCE.length - 1]).dpi
}

/**
 * 인쇄 mm와 캔버스 px에서 내보내기 배율의 실제 해상도를 구한다.
 * @returns {number} dpi
 */
export function dpiFor(canvasW, printWmm, scale = 1) {
  if (!(canvasW > 0) || !(printWmm > 0)) return 0
  return (canvasW * scale) / (printWmm / MM_PER_IN)
}

/**
 * 목표 해상도를 내려면 몇 배로 내보내야 하는지.
 * 배율은 정수로 올린다 — 소수 배율은 브라우저 캡처에서 가장자리가 흐려진다.
 */
export function scaleForDpi(canvasW, printWmm, targetDpi) {
  if (!(canvasW > 0) || !(printWmm > 0) || !(targetDpi > 0)) return 1
  return Math.max(1, Math.ceil(targetDpi / dpiFor(canvasW, printWmm, 1)))
}

/**
 * 인쇄 크기에서 캔버스 px을 역산한다.
 *
 * 상한에 닿는 가장 큰 값을 고르면 안 된다 — 그러면 750×1250mm가 4px/mm(3000×5000)이 되어
 * 2배 내보내기에 203dpi가 나온다. 필요 이상이고 캡처가 6천만 픽셀이다.
 * **목표 해상도에서 역산한다**: dpi = ppmm × 25.4 × 배율이므로 ppmm = dpi / (25.4 × 배율).
 * 150dpi를 2배로 내려면 ppmm ≈ 2.95 → 3이고, 이것이 1mm = 3px이라 암산도 쉽다.
 *
 * @param {{w:number,h:number}} mm 인쇄 크기
 * @param {{targetDpi?:number, exportScale?:number, maxW?:number, maxH?:number}} opts
 * @returns {{w:number,h:number,ppmm:number}}
 */
export function canvasForPrint(mm, { targetDpi = 150, exportScale = 2, maxW = 7680, maxH = 12000 } = {}) {
  if (!mm || !(mm.w > 0) || !(mm.h > 0)) return null
  const ideal = targetDpi / (MM_PER_IN * exportScale)
  // 2~4 사이의 정수로 — 그 바깥은 캔버스가 지나치게 크거나 좌표가 너무 거칠어진다
  let ppmm = Math.min(4, Math.max(2, Math.round(ideal)))
  while (ppmm > 1 && (mm.w * ppmm > maxW || mm.h * ppmm > maxH)) ppmm -= 1
  const w = Math.round(mm.w * ppmm)
  const h = Math.round(mm.h * ppmm)
  if (w <= maxW && h <= maxH) return { w, h, ppmm }
  // 1px/mm으로도 상한을 넘는 아주 큰 규격: 비율을 지키며 들어가는 최대 크기로.
  const k = Math.min(maxW / mm.w, maxH / mm.h)
  return { w: Math.round(mm.w * k), h: Math.round(mm.h * k), ppmm: k }
}

/** 캔버스 비율이 인쇄 비율과 맞는지. 어긋나면 내보낼 때 늘어나거나 잘린다. */
export function ratioMatches(canvas, mm, tol = 0.005) {
  if (!canvas || !mm || !(canvas.h > 0) || !(mm.h > 0)) return true
  return Math.abs(canvas.w / canvas.h - mm.w / mm.h) <= tol
}

/**
 * 재단 여백과 안전 영역을 캔버스 px로. 가이드 표시와 검사에 함께 쓴다.
 * @returns {{ppmm:number, bleed:number, safe:number}}
 */
export function printGuides(canvas, mm, { bleedMm = BLEED_MM, safeMm = SAFE_MM } = {}) {
  if (!canvas || !mm || !(mm.w > 0)) return null
  const ppmm = canvas.w / mm.w
  return { ppmm, bleed: Math.round(bleedMm * ppmm), safe: Math.round(safeMm * ppmm) }
}

/**
 * 보는 거리에서 읽히는 최소 글자 크기(px).
 * 판독 바닥은 글자높이 ≥ 거리/250이고, font-size는 글자높이의 약 1/0.7이다.
 */
export function minFontPx(ppmm, distM) {
  if (!(ppmm > 0) || !(distM > 0)) return 0
  const glyphMm = (distM * 1000) / 250
  return Math.round((glyphMm / 0.7) * ppmm)
}

/** 보는 거리에서 보이는 최소 선 굵기(px). 가는 선은 인쇄에서 사라진다. */
export function minLinePx(ppmm, distM) {
  if (!(ppmm > 0) || !(distM > 0)) return 0
  return Math.round(distM * 1.3 * ppmm)
}

/** `"750x1250"` · `"750×1250"` → {w,h}. 못 읽으면 null. */
export function parseMm(text) {
  const m = String(text || '').trim().match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i)
  if (!m) return null
  const w = parseFloat(m[1]), h = parseFloat(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return { w, h }
}
