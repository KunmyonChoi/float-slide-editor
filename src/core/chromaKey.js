/**
 * chromaKey — 이미지 배경(특정 색)을 투명하게 만드는 클라이언트 크로마키.
 * canvas로 픽셀을 읽어 key 색과의 거리(tolerance) 안의 픽셀 알파를 0으로.
 * 외부 url(CORS 미허용)은 canvas tainting으로 읽기 불가 → 호출부에서 에러 처리.
 */

export const MAX_COLOR_DIST = Math.sqrt(3 * 255 * 255) // ≈ 441.67

/**
 * chroma 설정을 키 항목 배열로 정규화 — 구버전 단일 키({key,tolerance,feather})와
 * 신버전 다중 키({keys:[...]})를 한 형태로 통일. 항상 최소 1개 항목 반환.
 * @param {object|null} chroma element.chroma
 * @returns {Array<{key:{r,g,b}|null, tolerance:number, feather:number|null|undefined}>}
 */
export function chromaEntries(chroma) {
  if (chroma && Array.isArray(chroma.keys)) {
    return chroma.keys.length ? chroma.keys : [{ key: null, tolerance: 18, feather: null }]
  }
  // 구버전 단일 키 → 1개짜리 배열
  return [{
    key: chroma?.key ?? null,
    tolerance: chroma?.tolerance ?? 18,
    feather: chroma?.feather ?? null,
  }]
}

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
 * @param {number} [featherPct] 경계 페더 0~100 비율(미지정 시 tol*0.3 자동). tolerance와 동일 단위.
 * @returns {ImageData} 같은 imgData (체이닝용)
 */
export function applyChromaToImageData(imgData, key, tolerancePct, featherPct) {
  const px = imgData.data
  const tol = (tolerancePct / 100) * MAX_COLOR_DIST
  const f = featherPct != null ? Math.max(0, (featherPct / 100) * MAX_COLOR_DIST) : Math.max(1, tol * 0.3)
  for (let i = 0; i < px.length; i += 4) {
    const dist = colorDist(px[i], px[i + 1], px[i + 2], key.r, key.g, key.b)
    px[i + 3] = pixelAlpha(dist, tol, f, px[i + 3])
  }
  return imgData
}

/**
 * 여러 키를 '순차' 적용 — 1차 제거 후 잔류색을 2차로 제거하는 용도.
 * 각 키는 자기 허용치/페더를 가진다. 순차이므로 각 패스가 이전 결과 위에 더 깎는다
 * (어느 키든 일치하는 픽셀이 제거됨). key가 없는 항목은 건너뛴다(자동 추정은 호출부 책임).
 * @param {ImageData} imgData (제자리 변경)
 * @param {Array<{key:{r,g,b}, tolerance:number, feather?:number}>} entries
 * @returns {ImageData} 같은 imgData
 */
export function applyChromaKeysToImageData(imgData, entries) {
  for (const e of (entries || [])) {
    if (!e || !e.key) continue
    applyChromaToImageData(imgData, e.key, e.tolerance ?? 18, e.feather)
  }
  return imgData
}

/**
 * 디스필(spill suppression) — 전경에 묻은 키색 끼(녹색/파란 번짐)를 자연색 쪽으로 보정.
 * 알파(매트)만으론 안 빠지는 색번짐을 제거하는 표준 단계. 키색의 우세 채널을
 * 나머지 두 채널 평균(=중립) 쪽으로 강도만큼 끌어내린다(그 평균을 초과할 때만).
 * ⚠️ 진짜 그 색의 사물(예: 녹색 의상)도 함께 빠지므로 강도는 사용자 조절.
 * @param {ImageData} imgData (제자리 변경)
 * @param {{r,g,b}} key 기준 키색(우세 채널 판정용)
 * @param {number} strengthPct 0~100 (0=미적용)
 * @returns {ImageData} 같은 imgData
 */
export function despillImageData(imgData, key, strengthPct) {
  const s = Math.max(0, Math.min(1, (strengthPct ?? 0) / 100))
  if (s <= 0 || !key) return imgData
  // 키색에서 가장 큰 채널 = 스필 채널 (그린스크린→G(1), 블루스크린→B(2))
  const ch = (key.g >= key.r && key.g >= key.b) ? 1 : (key.b >= key.r && key.b >= key.g) ? 2 : 0
  const a1 = (ch + 1) % 3, a2 = (ch + 2) % 3
  const px = imgData.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue // 완전 투명은 스킵
    const limit = (px[i + a1] + px[i + a2]) / 2 // 중립 기준(나머지 두 채널 평균)
    const v = px[i + ch]
    if (v > limit) px[i + ch] = v - s * (v - limit)
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
