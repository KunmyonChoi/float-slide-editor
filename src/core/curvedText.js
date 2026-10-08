/**
 * curvedText — 곡선(원호) 글자. 텍스트 요소의 element.textArc(−100~100, 0=직선)만큼 글자가 원호를 따라 휜다.
 *  +값: 위로 볼록한 아치(∩) — 배지·로고 위쪽 글자, 100이면 반원
 *  −값: 아래로 오목한 미소(∪) — 배지 아래쪽 글자
 *
 * 발표·편집 화면(FlatElementRenderer)과 PPTX(그림으로 래스터화)가 같은 SVG를 쓰도록 문자열로 만든다.
 * 글자 모양(글꼴·크기·굵기·자간·색·외곽선·그림자·대소문자)은 요소 styles를 그대로 따른다.
 * 여러 줄은 한 줄로 이어 원호에 얹는다(원호 글자는 한 줄이 기본).
 */

export const TEXT_ARC_MIN = -100
export const TEXT_ARC_MAX = 100

/** 휘는 정도(−100~100)로 자른 값. 숫자가 아니거나 0이면 0(직선). */
export function textArcOf(el) {
  const v = Number(el?.textArc)
  if (!Number.isFinite(v) || v === 0) return 0
  return Math.max(TEXT_ARC_MIN, Math.min(TEXT_ARC_MAX, Math.round(v)))
}

/** 곡선 글자로 그릴 요소인가 — 텍스트이고 휘기가 0이 아닐 때. */
export function isCurvedText(el) {
  return el?.type === 'text' && textArcOf(el) !== 0
}

/** 리치 텍스트(HTML) → 원호에 얹을 한 줄 평문. */
export function plainTextOf(content, isRich) {
  let s = String(content || '')
  if (isRich) {
    s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|div|li)>/gi, ' ').replace(/<[^>]+>/g, '')
    s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  }
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * 원호 기하 — 요소 상자 안에 가로로 걸친 원호. 휘기 100이면 반원(높이 = 폭의 절반).
 * 글자 덩어리(원호 + 글자 높이)가 상자 세로 가운데에 오도록 기준선을 잡는다.
 * @returns {{ d: string, r: number, sagitta: number }} d: SVG path, sagitta: 원호의 볼록한 높이
 */
export function arcGeometry(w, h, bend, fontPx) {
  const pad = Math.min(w * 0.1, fontPx * 0.25)
  const x0 = pad, x1 = Math.max(pad + 1, w - pad)
  const chord = x1 - x0
  const k = Math.min(1, Math.abs(bend) / 100)
  const s = Math.max(0.5, k * chord / 2)
  const r = (chord * chord / 4 + s * s) / (2 * s)
  const up = bend > 0
  // 글자 윗부분 ≈ 기준선 위 0.7em — (덩어리 위 + 덩어리 아래)/2 = h/2
  const yb = up ? h / 2 + s / 2 + fontPx * 0.35 : h / 2 - s / 2 + fontPx * 0.35
  const f = (n) => Math.round(n * 100) / 100
  // SVG y는 아래로 증가 — 왼→오 시계 방향(sweep 1)이면 위로 지나간다
  const d = `M ${f(x0)} ${f(yb)} A ${f(r)} ${f(r)} 0 0 ${up ? 1 : 0} ${f(x1)} ${f(yb)}`
  return { d, r, sagitta: s }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** text-shadow 목록 → filter: drop-shadow(...) 연쇄(SVG 글자는 text-shadow를 일관되게 그리지 않는다). */
export function shadowToFilter(textShadow) {
  if (!textShadow || textShadow === 'none') return ''
  const parts = []
  let depth = 0, cur = ''
  for (const ch of textShadow) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts.map(p => `drop-shadow(${p})`).join(' ')
}

/** '2px rgb(…)' → { width: 2, color: 'rgb(…)' } */
function parseStroke(stroke) {
  if (!stroke || stroke === 'none') return null
  const m = /^\s*([\d.]+)px\s+(.+)$/.exec(stroke)
  return m ? { width: parseFloat(m[1]), color: m[2].trim() } : null
}

/**
 * 곡선 글자 SVG 문자열.
 * @param {object} el 텍스트 요소 { width, height, content, isRich, styles, textArc }
 * @param {string} uid path id 접미사 — 한 화면에 같은 요소가 여러 번(썸네일 등) 그려져도 겹치지 않게
 */
export function curvedTextSvg(el, uid = '') {
  const w = Math.max(1, el.width || 1), h = Math.max(1, el.height || 1)
  const s = el.styles || {}
  const bend = textArcOf(el)
  const fontPx = parseFloat(s.fontSize) || 32
  const { d } = arcGeometry(w, h, bend, fontPx)
  const id = `fe-arc-${String(el.id || 'x').replace(/[^\w-]/g, '')}${uid ? '-' + uid : ''}`
  const text = plainTextOf(el.content, el.isRich)
  // 그래디언트 글자는 원호에서 채움색을 쓸 수 없어 글자 채움색(없으면 검정)으로 대신한다
  const fill = s.webkitBackgroundClip === 'text'
    ? (s.webkitTextFillColor && s.webkitTextFillColor !== 'transparent' ? s.webkitTextFillColor : '#000')
    : (s.color || '#000')
  const stroke = parseStroke(s.textStroke)
  const style = [
    s.fontFamily ? `font-family:${s.fontFamily.replace(/"/g, "'")}` : '',
    `font-size:${fontPx}px`,
    s.fontWeight ? `font-weight:${s.fontWeight}` : '',
    s.fontStyle && s.fontStyle !== 'normal' ? `font-style:${s.fontStyle}` : '',
    s.letterSpacing && s.letterSpacing !== 'normal' ? `letter-spacing:${s.letterSpacing}` : '',
    s.textTransform && s.textTransform !== 'none' ? `text-transform:${s.textTransform}` : '',
    shadowToFilter(s.textShadow) ? `filter:${shadowToFilter(s.textShadow)}` : '',
    stroke ? 'paint-order:stroke fill' : '',
  ].filter(Boolean).join(';')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible" style="display:block;overflow:visible">`
    + `<path id="${id}" d="${d}" fill="none" stroke="none"/>`
    + `<text fill="${esc(fill)}"${stroke ? ` stroke="${esc(stroke.color)}" stroke-width="${stroke.width}"` : ''} style="${esc(style)}">`
    + `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text></svg>`
}
