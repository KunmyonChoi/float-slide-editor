/**
 * CssColor — CSS 색상 → RGBA/HEX 변환 (pptx-server/gradient.py 미러)
 * hex / rgb(a) / oklch / oklab / transparent / 기본 named 색상 지원.
 * Tailwind v4의 oklch 색을 지원하지 않으면 PPT 변환 시 색이 기본값으로 잘못 나온다.
 */

const NAMED_COLORS = {
  white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0],
  green: [0, 128, 0], blue: [0, 0, 255], gray: [128, 128, 128],
  grey: [128, 128, 128], silver: [192, 192, 192], yellow: [255, 255, 0],
  orange: [255, 165, 0],
}

/** OKLab → sRGB(0~255) */
function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  const enc = (x) => {
    x = Math.max(0, Math.min(1, x))
    x = x > 0.0031308 ? 1.055 * (x ** (1 / 2.4)) - 0.055 : 12.92 * x
    return Math.max(0, Math.min(255, Math.round(x * 255)))
  }
  return [enc(r), enc(g), enc(bl)]
}

/** oklch()/oklab() → [r,g,b,alpha] | null */
function parseOk(color) {
  const m = color.match(/(oklch|oklab)\(\s*([^)]+)\)/i)
  if (!m) return null
  const func = m[1].toLowerCase()
  const [body, alphaS = ''] = m[2].split('/')
  const toks = body.replace(/,/g, ' ').trim().split(/\s+/)
  if (toks.length < 3) return null
  const num = (t) => {
    t = t.trim().toLowerCase()
    if (t.endsWith('%')) return parseFloat(t) / 100
    return parseFloat(t.replace(/[a-z]+$/, ''))
  }
  try {
    const L = num(toks[0])
    let a, b
    if (func === 'oklch') {
      const C = num(toks[1]); const H = num(toks[2])
      a = C * Math.cos(H * Math.PI / 180)
      b = C * Math.sin(H * Math.PI / 180)
    } else {
      a = num(toks[1]); b = num(toks[2])
    }
    if ([L, a, b].some(v => Number.isNaN(v))) return null
    const [r, g, bl] = oklabToSrgb(L, a, b)
    const alpha = alphaS.trim() ? num(alphaS) : 1.0
    return [r, g, bl, Number.isNaN(alpha) ? 1.0 : alpha]
  } catch { return null }
}

/** CSS 색상 → [r,g,b,alpha] | null */
export function cssColorToRgba(color) {
  if (!color) return null
  color = String(color).trim()
  if (color.startsWith('#')) {
    let h = color.slice(1)
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    if (h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16) / 255]
    if (h.length >= 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1.0]
    return null
  }
  let m = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)/)
  if (m) return [+m[1], +m[2], +m[3], parseFloat(m[4])]
  m = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) return [+m[1], +m[2], +m[3], 1.0]
  if (/^okl[ca]/i.test(color)) {
    const ok = parseOk(color)
    if (ok) return ok
  }
  const low = color.toLowerCase()
  if (low === 'transparent') return [0, 0, 0, 0]
  if (NAMED_COLORS[low]) return [...NAMED_COLORS[low], 1.0]
  return null
}

/** CSS 색상 → 'rrggbb' | undefined (alpha 무시) */
export function cssColorToHex(color) {
  const rgba = cssColorToRgba(color)
  if (!rgba) return undefined
  return rgba.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')
}
