/**
 * chromaKey — 이미지 배경(특정 색)을 투명하게 만드는 클라이언트 크로마키.
 * canvas로 픽셀을 읽어 key 색과의 거리(tolerance) 안의 픽셀 알파를 0으로.
 * 외부 url(CORS 미허용)은 canvas tainting으로 읽기 불가 → 호출부에서 에러 처리.
 */

export const MAX_COLOR_DIST = Math.sqrt(3 * 255 * 255) // ≈ 441.67

/** RGB 유클리드 거리 (순수 함수 — 테스트 대상) */
export function colorDist(r1, g1, b1, r2, g2, b2) {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/**
 * 한 픽셀의 새 알파 계산 (순수 함수 — 테스트 대상).
 * @returns 0(완전 제거) ~ origAlpha(유지). tolPx 안이면 0, feather 구간은 부분 투명.
 */
export function pixelAlpha(dist, tolPx, featherPx, origAlpha) {
  if (dist <= tolPx - featherPx) return 0
  if (dist < tolPx) return Math.round(origAlpha * (dist - (tolPx - featherPx)) / featherPx)
  return origAlpha
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다'))
    img.src = src
  })
}

/** 네 모서리 픽셀 평균으로 배경색 추정 → {r,g,b} */
export async function detectBgColor(src) {
  const img = await loadImage(src)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  return detectBgColorFromCtx(ctx, c.width, c.height)
}

/** 모서리 픽셀 평균으로 배경색 추정 (이미 그려진 2D 컨텍스트 기준) → {r,g,b}.
 *  이미지(detectBgColor)와 영상 프레임(ChromaVideoPlayer)에서 공용. */
export function detectBgColorFromCtx(ctx, w, h) {
  const pts = [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]
  let r = 0, g = 0, b = 0
  for (const [x, y] of pts) {
    const d = ctx.getImageData(x, y, 1, 1).data
    r += d[0]; g += d[1]; b += d[2]
  }
  return { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) }
}

/**
 * ImageData 픽셀 알파를 키색 기준으로 제자리 갱신 — 이미지/영상 프레임 공용 코어.
 * 영상은 매 프레임 이 함수를 호출하므로 가볍게 유지(픽셀 루프만).
 * @param {ImageData} imgData 캔버스에서 읽은 프레임/이미지 데이터(제자리 변경)
 * @param {{r,g,b}} key 제거할 색
 * @param {number} tolerancePct 0~100 (허용 색 거리 비율)
 * @param {number} [feather] 경계 페더 px(미지정 시 tol*0.3 자동)
 * @returns {ImageData} 같은 imgData (체이닝용)
 */
export function applyChromaToImageData(imgData, key, tolerancePct, feather) {
  const px = imgData.data
  const tol = (tolerancePct / 100) * MAX_COLOR_DIST
  const f = feather != null ? Math.max(0, feather) : Math.max(1, tol * 0.3)
  for (let i = 0; i < px.length; i += 4) {
    const dist = colorDist(px[i], px[i + 1], px[i + 2], key.r, key.g, key.b)
    px[i + 3] = pixelAlpha(dist, tol, f, px[i + 3])
  }
  return imgData
}

/**
 * 크로마키 적용 → 투명 PNG data URL.
 * @param {string} src 이미지 소스(data/blob/same-origin url)
 * @param {{r,g,b}} key 제거할 색
 * @param {number} tolerancePct 0~100 (허용 색 거리 비율)
 */
export async function applyChromaKey(src, key, tolerancePct) {
  const img = await loadImage(src)
  const c = document.createElement('canvas')
  c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0)
  const imgData = ctx.getImageData(0, 0, c.width, c.height)
  applyChromaToImageData(imgData, key, tolerancePct)
  ctx.putImageData(imgData, 0, 0)
  return c.toDataURL('image/png')
}
