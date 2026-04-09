/**
 * GradientParser — CSS gradient 파싱/직렬화
 */

/**
 * CSS gradient 문자열 → 구조화된 객체
 * @param {string} css - e.g. "linear-gradient(135deg, #ff0000 0%, #0000ff 100%)"
 * @returns {{ type: 'linear'|'radial'|'none', angle: number, stops: Array<{color: string, position: number}> }}
 */
export function parseGradient(css) {
  if (!css || css === 'none') return { type: 'none', angle: 180, stops: [] }

  const linearMatch = css.match(/^linear-gradient\((.+)\)$/)
  if (linearMatch) {
    return parseLinear(linearMatch[1])
  }

  const radialMatch = css.match(/^radial-gradient\((.+)\)$/)
  if (radialMatch) {
    return parseRadial(radialMatch[1])
  }

  return { type: 'none', angle: 180, stops: [] }
}

function parseLinear(inner) {
  // 각도와 색상 스톱 분리
  // 각도: "135deg" 또는 "to right" 등
  let angle = 180
  let stopsStr = inner

  const angleMatch = inner.match(/^([\d.]+)deg\s*,\s*/)
  if (angleMatch) {
    angle = parseFloat(angleMatch[1])
    stopsStr = inner.slice(angleMatch[0].length)
  } else {
    const dirMatch = inner.match(/^to\s+([\w\s]+)\s*,\s*/)
    if (dirMatch) {
      angle = directionToAngle(dirMatch[1].trim())
      stopsStr = inner.slice(dirMatch[0].length)
    }
  }

  return { type: 'linear', angle, stops: parseStops(stopsStr) }
}

function parseRadial(inner) {
  // radial은 각도 없이 스톱만 파싱 (circle at center 등은 무시)
  let stopsStr = inner
  const shapeMatch = inner.match(/^(?:circle|ellipse)?\s*(?:at\s+[\w\s%]+)?\s*,\s*/)
  if (shapeMatch) {
    stopsStr = inner.slice(shapeMatch[0].length)
  }
  return { type: 'radial', angle: 0, stops: parseStops(stopsStr) }
}

/**
 * 색상 스톱 문자열 파싱
 * "rgba(255,0,0,1) 0%, #0000ff 100%" → [{color, position}]
 */
function parseStops(str) {
  const stops = []
  // 괄호 안의 콤마를 보호하면서 분리
  const parts = splitStops(str)

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue

    // 마지막 토큰이 퍼센트인지 확인
    const posMatch = trimmed.match(/\s+([\d.]+)%\s*$/)
    if (posMatch) {
      const color = trimmed.slice(0, trimmed.length - posMatch[0].length).trim()
      stops.push({ color, position: parseFloat(posMatch[1]) })
    } else {
      // 위치 없으면 나중에 균등 배분
      stops.push({ color: trimmed, position: -1 })
    }
  }

  // 위치 없는 스톱에 균등 배분
  if (stops.length > 0) {
    if (stops[0].position === -1) stops[0].position = 0
    if (stops.length > 1 && stops[stops.length - 1].position === -1) {
      stops[stops.length - 1].position = 100
    }
    // 중간 스톱 보간
    for (let i = 1; i < stops.length - 1; i++) {
      if (stops[i].position === -1) {
        const prev = stops[i - 1].position
        let next = 100
        for (let j = i + 1; j < stops.length; j++) {
          if (stops[j].position !== -1) { next = stops[j].position; break }
        }
        stops[i].position = prev + (next - prev) / (stops.length - i)
      }
    }
  }

  return stops
}

/** 괄호 깊이를 고려한 콤마 분리 */
function splitStops(str) {
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

function directionToAngle(dir) {
  const map = {
    'top': 0, 'right': 90, 'bottom': 180, 'left': 270,
    'top right': 45, 'right top': 45,
    'bottom right': 135, 'right bottom': 135,
    'bottom left': 225, 'left bottom': 225,
    'top left': 315, 'left top': 315,
  }
  return map[dir] ?? 180
}

/**
 * 구조화된 객체 → CSS gradient 문자열
 */
export function serializeGradient(grad) {
  if (!grad || grad.type === 'none' || grad.stops.length === 0) return 'none'

  const stopsStr = grad.stops
    .map(s => `${s.color} ${Math.round(s.position)}%`)
    .join(', ')

  if (grad.type === 'linear') {
    return `linear-gradient(${Math.round(grad.angle)}deg, ${stopsStr})`
  }
  if (grad.type === 'radial') {
    return `radial-gradient(circle, ${stopsStr})`
  }
  return 'none'
}
