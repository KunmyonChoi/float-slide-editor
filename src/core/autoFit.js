/**
 * autoFit — "콘텐츠가 자라면 컨테이너가 패딩 유지하며 신축"하는 세로 스택 오토레이아웃(경량).
 * Figma Auto Layout의 부분집합: 컨테이너(afContainer)가 자식(afContent)들을 세로로 쌓고
 * 패딩/간격을 유지하며 높이를 Hug한다. 단방향(콘텐츠 → 컨테이너), 커밋 시 1회 reflow.
 *
 * 요소 필드:
 *  - 컨테이너: afContainer:true, afPad:{top,right,bottom,left}, afGap
 *  - 콘텐츠:   afContent:true, autoHeight:true (코드면 isCode+code 사용)
 *  - 헤더(시스템바 등): 별도 필드 없이 위치 고정(컨테이너 top 기준 그대로)
 */

/** 모노스페이스 코드 높이 추정 (줄 수 + 폭 초과 줄바꿈 추정) */
export function estimateCodeHeight(code, { width, fontSizePx = 15, lineHeightRatio = 1.6 }) {
  const charW = fontSizePx * 0.6 // 모노스페이스 평균 글자폭 근사
  const cap = Math.max(1, Math.floor(width / charW))
  const lines = String(code || '').split('\n')
  let total = 0
  for (const ln of lines) total += Math.max(1, Math.ceil(ln.length / cap))
  return Math.ceil(total * fontSizePx * lineHeightRatio)
}

/** CSS padding 단축 문자열 → {top,right,bottom,left} (px 가정, 1~4값 모두 처리) */
export function parsePadding(padding) {
  const zero = { top: 0, right: 0, bottom: 0, left: 0 }
  if (!padding || typeof padding !== 'string') return zero
  const v = padding.trim().split(/\s+/).map(p => parseFloat(p) || 0)
  if (v.length === 1) return { top: v[0], right: v[0], bottom: v[0], left: v[0] }
  if (v.length === 2) return { top: v[0], right: v[1], bottom: v[0], left: v[1] }
  if (v.length === 3) return { top: v[0], right: v[1], bottom: v[2], left: v[1] }
  return { top: v[0], right: v[1], bottom: v[2], left: v[3] }
}

function plainOf(el) {
  if (el.isCode) return el.code || ''
  if (!el.isRich) return el.content || ''
  // <br>/<div> 경계를 줄바꿈으로 보존한 뒤 텍스트 추출 (textContent는 br을 무시함)
  const html = (el.content || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n')
  try { return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent || '' }
  catch { return '' }
}

/**
 * 오토핏 적용 — afContainer 그룹마다 콘텐츠 높이를 재계산하고 컨테이너를 Hug.
 * 순수 함수: 변경 없으면 같은 배열 반환, 변경 시 새 배열 반환.
 */
export function applyAutoFit(elements, measured = {}) {
  const byGroup = {}
  for (const el of elements) if (el.groupId) (byGroup[el.groupId] = byGroup[el.groupId] || []).push(el)

  let changed = false
  let out = elements
  const patch = (id, changes) => {
    if (out === elements) out = elements.slice()
    const i = out.findIndex(e => e.id === id)
    if (i < 0) return
    out[i] = { ...out[i], ...changes }
    changed = true
  }

  for (const gid in byGroup) {
    const members = byGroup[gid]
    const container = members.find(m => m.afContainer)
    if (!container) continue
    const pad = container.afPad || { top: 0, right: 0, bottom: 0, left: 0 }
    const gap = container.afGap || 0
    const contents = members.filter(m => m.afContent).sort((a, b) => a.y - b.y)
    if (!contents.length) continue

    const cw = Math.max(1, container.width - pad.left - pad.right)
    let cursorY = container.y + pad.top
    for (const c of contents) {
      const fs = parseFloat(c.styles?.fontSize) || 15
      const lh = parseFloat(c.styles?.lineHeight) || 1.6
      const h = c.autoHeight
        ? (measured[c.id] != null ? Math.round(measured[c.id]) : estimateCodeHeight(plainOf(c), { width: cw, fontSizePx: fs, lineHeightRatio: lh }))
        : c.height
      if (c.x !== container.x + pad.left || c.width !== cw || Math.round(c.y) !== Math.round(cursorY) || c.height !== h) {
        patch(c.id, { x: container.x + pad.left, y: Math.round(cursorY), width: cw, height: h })
      }
      cursorY += h + gap
    }
    const totalH = Math.round((cursorY - gap) - container.y + pad.bottom)
    if (Math.abs(totalH - container.height) > 0.5) patch(container.id, { height: totalH })
  }

  // 단독(그룹 없음) autoHeight 요소: 자신의 패딩 안에서 내용 높이만큼 자체 신축.
  // 코드 블록(단일 요소) 등 — 편집 중엔 measured(scrollHeight), 아니면 추정값.
  // afContent(컨테이너가 배치하는 콘텐츠)는 제외 — 그룹 해제로 groupId만 떨어진 잔여
  // afContent 요소를 0패딩으로 잘못 줄이지 않도록(자기 패딩이 없어 윈도우와 분리됨).
  for (const el of elements) {
    if (el.groupId || el.afContent || !el.autoHeight) continue
    const pad = parsePadding(el.styles?.padding)
    let h
    if (measured[el.id] != null) {
      h = Math.round(measured[el.id]) // scrollHeight = 콘텐츠 + 패딩
    } else {
      const cw = Math.max(1, el.width - pad.left - pad.right)
      const fs = parseFloat(el.styles?.fontSize) || 15
      const lh = parseFloat(el.styles?.lineHeight) || 1.6
      h = estimateCodeHeight(plainOf(el), { width: cw, fontSizePx: fs, lineHeightRatio: lh }) + pad.top + pad.bottom
    }
    if (Math.abs(h - el.height) > 0.5) patch(el.id, { height: h })
  }

  return changed ? out : elements
}
