/**
 * captionPlacement — 가라오케 자막을 슬라이드 위에 덮을지, 슬라이드 아래 여백에 둘지 정한다.
 *
 * 발표 화면은 슬라이드를 `contain`으로 맞춘다(`scale = min(vw/cw, vh/ch)`). 그래서 슬라이드
 * 비율과 화면 비율이 다르면 위아래 또는 좌우에 검은 여백이 남는다. 16:9 슬라이드를 세로로 긴
 * 모니터에 띄우면 위아래로 꽤 넓게 남는데, **그 여백이 충분하면 자막이 슬라이드를 가릴 이유가
 * 없다.** 아래 여백에 내려놓으면 슬라이드 내용이 온전히 보인다.
 *
 * 여백이 모자라면(대개 화면과 슬라이드 비율이 같을 때) 종전처럼 슬라이드 위에 덮는다 —
 * 자막이 화면 밖으로 잘리는 것보다는 덮는 편이 낫다.
 *
 * 길이 단위에 주의. 자막은 `transform: scale()`이 걸린 캔버스 좌표계 안에 배치되므로
 * 여백도 **캔버스 단위**로 환산해서 넘겨야 한다(화면 px을 그대로 쓰면 배율만큼 어긋난다).
 */

/**
 * 화면 하단에 고정된 크롬이 차지하는 높이(화면 px).
 * 페이지 번호(bottom:60)와 발표 툴바(bottom:18~24)가 여기 산다 — 자막이 겹치면 안 된다.
 */
export const BOTTOM_CHROME_PX = 84

/** 슬라이드–자막, 자막–크롬 사이 간격(캔버스 단위). */
export const CAPTION_GAP = 18

/**
 * 아직 높이를 재지 못했을 때 쓰는 보수적 추정값(캔버스 단위).
 * 2줄(30px × 1.5) + 위아래 패딩 10px. 실측 전에는 이 값으로 판단해 **덮는 쪽으로 기운다** —
 * 첫 프레임에 아래에 그렸다가 위로 올리면 자막이 튀어 보이기 때문이다.
 */
export const CAPTION_FALLBACK_H = 110

/**
 * 슬라이드 아래 여백 중 자막이 실제로 쓸 수 있는 높이를 캔버스 단위로 돌려준다.
 *
 * @param {{w:number,h:number}} viewport 화면 크기(px)
 * @param {{w:number,h:number}} canvasSize 슬라이드 캔버스 크기
 * @param {number} scale 캔버스 → 화면 배율
 * @returns {number} 캔버스 단위 여백. 쓸 수 없으면 0
 */
export function captionSpaceBelow(viewport, canvasSize, scale) {
  if (!viewport || !canvasSize || !(scale > 0)) return 0
  const { h: vh } = viewport
  const { h: ch } = canvasSize
  if (!(vh > 0) || !(ch > 0)) return 0
  // 슬라이드는 화면 중앙에 놓이므로 남는 세로 공간이 위아래로 반씩 나뉜다.
  const band = (vh - ch * scale) / 2
  const usable = band - BOTTOM_CHROME_PX
  return usable > 0 ? usable / scale : 0
}

/**
 * 잰 자막 높이가 아래 여백에 들어가는지.
 *
 * @param {number} spaceBelow `captionSpaceBelow()`의 값(캔버스 단위)
 * @param {number} measuredH 실측 높이(캔버스 단위). 0이면 아직 못 잰 것으로 보고 추정값을 쓴다
 */
export function fitsBelow(spaceBelow, measuredH) {
  const h = measuredH > 0 ? measuredH : CAPTION_FALLBACK_H
  return spaceBelow >= h + CAPTION_GAP * 2
}
