/**
 * BoxShadowParser — CSS box-shadow 파싱/직렬화
 */

/**
 * CSS box-shadow 문자열 → 구조화된 배열
 * @param {string} css - e.g. "0px 4px 8px rgba(0,0,0,0.2), inset 0px 1px 2px #000"
 * @returns {Array<{ offsetX: number, offsetY: number, blur: number, spread: number, color: string, inset: boolean }>}
 */
export function parseBoxShadow(css) {
  if (!css || css === 'none') return []

  // 괄호 깊이를 고려한 콤마 분리 (rgba 안의 콤마 보호)
  const parts = splitShadows(css)
  return parts.map(parseSingleShadow).filter(Boolean)
}

function parseSingleShadow(str) {
  let s = str.trim()
  if (!s || s === 'none') return null

  let inset = false
  if (s.startsWith('inset')) {
    inset = true
    s = s.slice(5).trim()
  }
  // inset이 뒤에 올 수도 있음
  if (s.endsWith('inset')) {
    inset = true
    s = s.slice(0, -5).trim()
  }

  // 색상 추출: rgba(...), rgb(...), #hex, named color
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

  // 남은 숫자값 파싱: offsetX offsetY blur? spread?
  const nums = s.match(/-?[\d.]+px/g) || []
  const values = nums.map(n => parseFloat(n))

  return {
    offsetX: values[0] || 0,
    offsetY: values[1] || 0,
    blur: values[2] || 0,
    spread: values[3] || 0,
    color,
    inset,
  }
}

/** 괄호 깊이를 고려한 콤마 분리 */
function splitShadows(str) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of str) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

/**
 * 구조화된 배열 → CSS box-shadow 문자열
 */
export function serializeBoxShadow(shadows) {
  if (!shadows || shadows.length === 0) return 'none'

  return shadows.map(s => {
    const parts = []
    if (s.inset) parts.push('inset')
    parts.push(`${s.offsetX}px`)
    parts.push(`${s.offsetY}px`)
    parts.push(`${s.blur}px`)
    parts.push(`${s.spread}px`)
    parts.push(s.color)
    return parts.join(' ')
  }).join(', ')
}
