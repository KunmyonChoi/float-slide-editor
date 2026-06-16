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

function plainOf(el) {
  if (el.isCode) return el.code || ''
  if (!el.isRich) return el.content || ''
  try { return new DOMParser().parseFromString(`<body>${el.content || ''}</body>`, 'text/html').body.textContent || '' }
  catch { return '' }
}

/**
 * 오토핏 적용 — afContainer 그룹마다 콘텐츠 높이를 재계산하고 컨테이너를 Hug.
 * 순수 함수: 변경 없으면 같은 배열 반환, 변경 시 새 배열 반환.
 */
export function applyAutoFit(elements) {
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
        ? estimateCodeHeight(plainOf(c), { width: cw, fontSizePx: fs, lineHeightRatio: lh })
        : c.height
      if (c.x !== container.x + pad.left || c.width !== cw || Math.round(c.y) !== Math.round(cursorY) || c.height !== h) {
        patch(c.id, { x: container.x + pad.left, y: Math.round(cursorY), width: cw, height: h })
      }
      cursorY += h + gap
    }
    const totalH = Math.round((cursorY - gap) - container.y + pad.bottom)
    if (Math.abs(totalH - container.height) > 0.5) patch(container.id, { height: totalH })
  }
  return changed ? out : elements
}
