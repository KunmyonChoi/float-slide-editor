/**
 * imageFx — 그림 보정(밝기·대비·채도·색온도·흐림·비네팅). 이미지·영상·배경 그림(배경 레이어의 url 그림)에 쓴다.
 *
 * element.imageFx = { brightness, contrast, saturation, warmth, blur, vignette }
 *   brightness·contrast·saturation: % (0~200, 기본 100) — CSS filter
 *   warmth: −100(차갑게)~100(따뜻하게) — 그림 위 색 레이어(soft-light 섞기). 색상환을 돌리는 hue-rotate와 달리
 *           그림 색은 그대로 두고 따뜻한/차가운 빛만 얹는다
 *   blur: px (0~40) — CSS filter
 *   vignette: 0~100 — 가장자리를 어둡게 하는 원형 그라디언트 레이어(가운데 글자를 읽기 쉽게)
 * 기본값이면 null(보정 없음). 렌더러·HTML 왕복·PPTX(캔버스로 구워 넣기)가 이 모듈 하나를 쓴다.
 */

export const FX_DEFAULTS = { brightness: 100, contrast: 100, saturation: 100, warmth: 0, blur: 0, vignette: 0 }
export const FX_RANGES = {
  brightness: [0, 200], contrast: [0, 200], saturation: [0, 200], warmth: [-100, 100], blur: [0, 40], vignette: [0, 100],
}
const KEYS = Object.keys(FX_DEFAULTS)

/** 범위로 자르고 기본값과 같은 항목은 뺀다. 남는 게 없으면 null. */
export function normalizeFx(fx) {
  if (!fx || typeof fx !== 'object') return null
  const out = {}
  for (const k of KEYS) {
    const v = Number(fx[k])
    if (!Number.isFinite(v)) continue
    const [lo, hi] = FX_RANGES[k]
    const c = Math.round(Math.max(lo, Math.min(hi, v)))
    if (c !== FX_DEFAULTS[k]) out[k] = c
  }
  return Object.keys(out).length ? out : null
}

/** 모든 항목을 채운 값(UI 슬라이더용). */
export function fullFx(fx) {
  return { ...FX_DEFAULTS, ...(normalizeFx(fx) || {}) }
}

/** CSS filter 문자열(밝기·대비·채도·흐림). 없으면 ''. */
export function fxFilterCss(fx) {
  const f = normalizeFx(fx)
  if (!f) return ''
  const parts = []
  if (f.brightness != null) parts.push(`brightness(${f.brightness / 100})`)
  if (f.contrast != null) parts.push(`contrast(${f.contrast / 100})`)
  if (f.saturation != null) parts.push(`saturate(${f.saturation / 100})`)
  if (f.blur) parts.push(`blur(${f.blur}px)`)
  return parts.join(' ')
}

/** 색온도 레이어 색 — 따뜻하면 주황, 차가우면 파랑. 세기는 |warmth| 비례. 없으면 null. */
export function warmthTint(fx) {
  const w = normalizeFx(fx)?.warmth
  if (!w) return null
  const a = Math.round(Math.abs(w) / 100 * 0.55 * 1000) / 1000
  return w > 0 ? `rgba(255, 150, 50, ${a})` : `rgba(60, 130, 255, ${a})`
}

/** 비네팅 레이어 배경 — 가운데는 비우고 가장자리로 갈수록 어둡게. 없으면 null. */
export function vignetteGradient(fx) {
  const v = normalizeFx(fx)?.vignette
  if (!v) return null
  const a = Math.round(v / 100 * 0.85 * 1000) / 1000
  const inner = Math.round(70 - v * 0.3)   // 세질수록 어두운 테두리가 안쪽까지
  return `radial-gradient(ellipse at center, rgba(0, 0, 0, 0) ${inner}%, rgba(0, 0, 0, ${a}) 100%)`
}

/** 그림 위에 얹을 레이어들의 스타일(렌더러가 absolute로 덮는다). */
export function fxOverlayStyles(fx) {
  const out = []
  const tint = warmthTint(fx)
  if (tint) out.push({ background: tint, mixBlendMode: 'soft-light' })
  const vig = vignetteGradient(fx)
  if (vig) out.push({ background: vig })
  return out
}

// ── HTML 규약: data-img-fx="brightness:110;contrast:105;saturation:120;warmth:20;blur:2;vignette:40" ──

/** data-img-fx 값 → imageFx(없으면 null). 모르는 키·숫자 아닌 값은 버린다. */
export function parseFxAttr(str) {
  if (!str) return null
  const fx = {}
  for (const part of String(str).split(';')) {
    const [k, v] = part.split(':').map(s => s && s.trim())
    if (KEYS.includes(k)) fx[k] = parseFloat(v)
  }
  return normalizeFx(fx)
}

/** imageFx → data-img-fx 값(없으면 ''). */
export function fxToAttr(fx) {
  const f = normalizeFx(fx)
  return f ? KEYS.filter(k => f[k] != null).map(k => `${k}:${f[k]}`).join(';') : ''
}

/**
 * CSS filter 문자열(img의 computed filter 등) → imageFx 일부(밝기·대비·채도·흐림).
 * 색온도·비네팅은 filter로 표현되지 않으므로 data-img-fx로만 들어온다.
 */
export function fxFromCssFilter(filter) {
  if (!filter || filter === 'none') return null
  const fx = {}
  const num = (re) => { const m = re.exec(filter); return m ? parseFloat(m[1]) * (m[2] === '%' ? 1 : 100) : null }
  const b = num(/brightness\(([\d.]+)(%?)\)/); if (b != null) fx.brightness = b
  const c = num(/contrast\(([\d.]+)(%?)\)/); if (c != null) fx.contrast = c
  const s = num(/saturate\(([\d.]+)(%?)\)/); if (s != null) fx.saturation = s
  const bl = /blur\(([\d.]+)px\)/.exec(filter); if (bl) fx.blur = parseFloat(bl[1])
  return normalizeFx(fx)
}

/**
 * 보정을 구운 그림(PNG data URL) — PPTX처럼 필터를 못 쓰는 곳에 넣는다. 브라우저 캔버스 전용.
 * 그림 원래 비율 그대로 굽는다(비네팅도 그림 기준).
 */
export async function bakeFxToDataUrl(dataUrl, fx) {
  const f = normalizeFx(fx)
  if (!f || typeof document === 'undefined') return dataUrl
  const cv = document.createElement('canvas')
  const ctx = cv.getContext?.('2d')
  if (!ctx) return dataUrl                 // 캔버스가 없는 환경(테스트 등) — 원본 그대로
  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    const t = setTimeout(() => reject(new Error('image load timeout')), 8000)
    im.onload = () => { clearTimeout(t); resolve(im) }
    im.onerror = (e) => { clearTimeout(t); reject(e) }
    im.src = dataUrl
  })
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
  cv.width = w; cv.height = h
  ctx.filter = fxFilterCss(f) || 'none'
  ctx.drawImage(img, 0, 0, w, h)
  ctx.filter = 'none'
  const tint = warmthTint(f)
  if (tint) {
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = tint
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
  }
  if (f.vignette) {
    const a = f.vignette / 100 * 0.85
    const inner = (70 - f.vignette * 0.3) / 100
    const r = Math.hypot(w, h) / 2
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r)
    g.addColorStop(Math.max(0, Math.min(0.99, inner)), 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${a})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  return cv.toDataURL('image/png')
}
