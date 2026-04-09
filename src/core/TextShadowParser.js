/**
 * TextShadowParser — CSS text-shadow 파싱/직렬화
 * text-shadow: offsetX offsetY blur color (spread/inset 없음)
 */

/**
 * CSS text-shadow → 구조화 배열
 * @param {string} css
 * @returns {Array<{ offsetX: number, offsetY: number, blur: number, color: string }>}
 */
export function parseTextShadow(css) {
  if (!css || css === 'none') return []
  const parts = splitShadows(css)
  return parts.map(parseSingle).filter(Boolean)
}

function parseSingle(str) {
  let s = str.trim()
  if (!s || s === 'none') return null

  // 색상 추출
  let color = 'rgba(0, 0, 0, 1)'
  const rgbaMatch = s.match(/rgba?\([^)]+\)/)
  if (rgbaMatch) {
    color = rgbaMatch[0]
    s = s.replace(rgbaMatch[0], '').trim()
  } else {
    const hexMatch = s.match(/#[0-9a-fA-F]{3,8}/)
    if (hexMatch) {
      color = hexMatch[0]
      s = s.replace(hexMatch[0], '').trim()
    }
  }

  const nums = s.match(/-?[\d.]+px/g) || []
  const values = nums.map(n => parseFloat(n))

  return {
    offsetX: values[0] || 0,
    offsetY: values[1] || 0,
    blur: values[2] || 0,
    color,
  }
}

function splitShadows(str) {
  const parts = []
  let depth = 0, current = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(current); current = '' }
    else current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

/**
 * 구조화 배열 → CSS text-shadow
 */
export function serializeTextShadow(shadows) {
  if (!shadows || shadows.length === 0) return 'none'
  return shadows.map(s =>
    `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.color}`
  ).join(', ')
}
