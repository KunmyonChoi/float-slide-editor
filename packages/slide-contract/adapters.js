/**
 * adapters — 내부 FlatElement ↔ 공개 SlideDeck 변환.
 *
 * 경계 원칙:
 * - 공개 envelope는 깔끔하게(type/geometry/z/text|src/style…), 내부 전용 필드
 *   (id/sourceId/_domOrder/originalRect/_pseudoBefore 등)는 숨긴다.
 * - `style`은 **CSS-native 통과**(내부 styles 객체 그대로). 엔진이 CSS 문자열을
 *   파싱하므로 구조화하면 오히려 손실 → 통과가 무손실.
 * - 엔진이 실제 읽는 요소 키(type,x,y,width,height,rotation,zIndex,content,
 *   isRich,styles,merged,locked)를 모두 보존 → HTML 경로 라운드트립 무손실.
 *
 * 프레임워크/런타임 무의존.
 */
import { deck as makeDeck } from './schema.js'

// ── 요소 레벨 ──

/** 내부 FlatElement → 공개 SlideElement */
export function internalElementToPublic(el) {
  const out = {
    type: el.type,
    x: el.x, y: el.y, width: el.width, height: el.height,
  }
  if (el.rotation) out.rotation = el.rotation
  if (el.zIndex) out.z = el.zIndex
  if (el.type === 'text') {
    out.text = el.isRich ? { html: el.content || '' } : { plain: el.content || '' }
  } else if (el.type === 'table') {
    out.table = el.table // 구조화 표 데이터(통과)
  } else {
    out.src = el.content || ''
  }
  if (el.type === 'video') { // 영상별 재생 옵션 — 변환기가 PPT 자동재생/반복/음소거에 반영
    if (el.autoplay) out.autoplay = true
    if (el.loop) out.loop = true
    if (el.muted) out.muted = true
    if (el.hideControls) out.hideControls = true
  }
  if (el.type === 'shape' && el.fillRatio != null) { // 부분 채우기 → PPT 솔리드 사각형
    out.fillRatio = el.fillRatio
    out.fillDir = el.fillDir || 'left'
    if (el.fillColor) out.fillColor = el.fillColor
  }
  if (el.points != null) out.points = el.points
  if (el.link != null) out.link = el.link
  if (el.merged) out.merged = true
  if (el.locked) out.locked = true
  if (el.groupId != null) out.groupId = el.groupId
  if (el.styles) out.style = { ...el.styles } // CSS-native 통과(얕은 복사로 참조 분리)
  return out
}

/** 공개 SlideElement → 내부 FlatElement (엔진 입력) */
export function publicElementToInternal(pel) {
  const out = {
    type: pel.type,
    x: pel.x, y: pel.y, width: pel.width, height: pel.height,
    rotation: pel.rotation || 0,
    zIndex: pel.z || 0,
    styles: pel.style || {},
  }
  if (pel.type === 'text') {
    out.content = pel.text?.html ?? pel.text?.plain ?? ''
    out.isRich = pel.text?.html != null
  } else if (pel.type === 'table') {
    out.content = ''
    out.isRich = false
    if (pel.table != null) out.table = pel.table
  } else {
    out.content = pel.src || ''
    out.isRich = false
  }
  if (pel.type === 'video') {
    if (pel.autoplay) out.autoplay = true
    if (pel.loop) out.loop = true
    if (pel.muted) out.muted = true
    if (pel.hideControls) out.hideControls = true
  }
  if (pel.type === 'shape' && pel.fillRatio != null) {
    out.fillRatio = pel.fillRatio
    out.fillDir = pel.fillDir || 'left'
    if (pel.fillColor) out.fillColor = pel.fillColor
  }
  if (pel.points != null) out.points = pel.points
  if (pel.link != null) out.link = pel.link
  if (pel.merged) out.merged = true
  if (pel.locked) out.locked = true
  if (pel.groupId != null) out.groupId = pel.groupId
  return out
}

// ── 덱 레벨 ──

/** 페이지 키 "p-v" 숫자 정렬 */
function pageKeySort(a, b) {
  const [aP, aV] = String(a).split('-').map(Number)
  const [bP, bV] = String(b).split('-').map(Number)
  return (aP - bP) || ((aV || 0) - (bV || 0))
}

/**
 * 내부 pages 맵 → 공개 SlideDeck.
 * @param {Object} pages - { [key]: { elements, canvasSize?, fontImports? } }
 * @param {{w,h}} defaultCanvasSize
 * @param {Array} [fonts] - 이미 수집된 폰트 디스크립터(없으면 [])
 */
export function pagesToDeck(pages, defaultCanvasSize, fonts = []) {
  const keys = Object.keys(pages || {}).sort(pageKeySort)
  return makeDeck({
    canvasSize: defaultCanvasSize,
    fonts: fonts || [],
    pages: keys.map((k) => {
      const p = pages[k] || {}
      const page = { elements: (p.elements || []).map(internalElementToPublic) }
      if (p.canvasSize) page.canvasSize = p.canvasSize
      return page
    }),
  })
}

/**
 * 공개 SlideDeck → 엔진 입력(내부 pages 맵 + defaultCanvasSize + fonts).
 * 페이지 키는 순서 기준으로 재생성("0-0","1-0"…) — 엔진은 순서만 사용.
 */
export function deckToInternalPages(deck) {
  const pages = {}
  ;(deck.pages || []).forEach((p, i) => {
    pages[`${i}-0`] = {
      elements: (p.elements || []).map(publicElementToInternal),
      canvasSize: p.canvasSize || deck.canvasSize,
      fontImports: [], // 공개 계약은 폰트를 deck.fonts(디스크립터)로 운반
    }
  })
  return { pages, defaultCanvasSize: deck.canvasSize, fonts: deck.fonts || [] }
}
