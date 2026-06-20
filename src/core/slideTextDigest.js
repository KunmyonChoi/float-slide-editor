/**
 * slideTextDigest — flat 슬라이드 요소에서 발표 원고 생성용 텍스트를 추출한다.
 * 순수 함수(브라우저/DOM 비의존) — AI 발표자 노트 생성 입력으로 사용.
 */

/** HTML 문자열 → 평문(블록 태그는 줄바꿈, 기본 엔티티 디코드) */
export function htmlToPlain(html) {
  if (!html) return ''
  let s = String(html)
  s = s.replace(/<\s*br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 한 요소의 평문 텍스트 (text/shape의 content, table의 셀) */
export function elementText(el) {
  if (!el) return ''
  // 미디어 타입은 텍스트 없음(content는 data:/idb:///http URL) — 타입으로 판별(평문 URL 오판 방지)
  if (el.type === 'image' || el.type === 'video' || el.type === 'svg') return ''
  if (el.type === 'table' && el.table && Array.isArray(el.table.cells)) {
    return el.table.cells
      .flat()
      .filter(c => c && !c.covered)
      .map(c => (c.text || '').trim())
      .filter(Boolean)
      .join(' | ')
  }
  const content = el.content
  if (!content || typeof content !== 'string') return ''
  return el.isRich ? htmlToPlain(content) : content.trim()
}

function fontPx(el) {
  const n = parseFloat(el?.styles?.fontSize)
  return Number.isNaN(n) ? 0 : n
}

/**
 * 한 페이지(elements) → { title, text }.
 * 읽기 순서(위→아래, 좌→우) 정렬, 제목은 가장 큰 폰트(동률이면 최상단) 추정.
 */
export function slidePageDigest(elements) {
  const items = []
  for (const el of (elements || [])) {
    if (el.isBackground) continue
    if (el.shapeType === 'connector') continue // 커넥터 라벨은 본문성 약함 → 제외
    const t = elementText(el)
    if (!t) continue
    items.push({ text: t, y: el.y ?? 0, x: el.x ?? 0, fs: fontPx(el) })
  }
  items.sort((a, b) => (a.y - b.y) || (a.x - b.x))
  let title = ''
  if (items.length) {
    const maxFs = Math.max(...items.map(i => i.fs))
    const titleItem = (maxFs > 0 ? items.find(i => i.fs === maxFs) : null) || items[0]
    title = titleItem.text.split('\n')[0].trim().slice(0, 200)
  }
  return { title, text: items.map(i => i.text).join('\n') }
}

/**
 * 정렬된 페이지 elements 배열 → 슬라이드 요약 배열 [{ index, title, text }].
 * @param {Array<Array>} pagesElements 슬라이드 순서대로의 elements 배열들
 */
export function deckDigest(pagesElements) {
  return (pagesElements || []).map((els, i) => {
    const d = slidePageDigest(els)
    return { index: i, title: d.title, text: d.text }
  })
}
