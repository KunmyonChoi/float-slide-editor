/**
 * ideogramCaption — 선택한 텍스트 요소들 → Ideogram 4 JSON 캡션(bbox+텍스트 쌍).
 * 순수 함수(DOM 비의존) — imgen-server(/api/generate)로 보낼 caption 객체를 만든다.
 *
 * 스키마(github.com/ideogram-oss/ideogram4 docs/prompting.md):
 *   { high_level_description?, style_description?, compositional_deconstruction: { background, elements[] } }
 *   element(text): { type:'text', bbox, text, desc?, color_palette? }   (이 키 순서 유지)
 *   bbox = [y_min, x_min, y_max, x_max], 0–1000 정규화, 좌상단 원점.
 * 직렬화(compact json.dumps)는 서버가 수행 — 여기선 객체만 만든다(JSON.stringify가 키 순서 보존).
 */
import { htmlToPlain } from './slideTextDigest'

/** 요소 박스(px) → bbox [y_min,x_min,y_max,x_max] (0–1000 정규화, 정수, 범위 클램프). */
export function toBbox(el, canvasSize) {
  const w = canvasSize?.w || 1
  const h = canvasSize?.h || 1
  const n = (v, span) => Math.max(0, Math.min(1000, Math.round((v / span) * 1000)))
  const x = el.x || 0, y = el.y || 0
  return [n(y, h), n(x, w), n(y + (el.height || 0), h), n(x + (el.width || 0), w)]
}

/** 텍스트 요소 1개 → caption element(키 순서: type, bbox, text, desc?, color_palette?). */
function textElement(el, canvasSize, desc) {
  const entry = { type: 'text', bbox: toBbox(el, canvasSize), text: htmlToPlain(el.content || '') }
  if (desc) entry.desc = desc
  return entry
}

/**
 * 선택 텍스트 요소들 → Ideogram 4 caption 객체.
 * @param {Array} textEls  선택된 요소들(type==='text'만 사용, 빈 텍스트 제외)
 * @param {{w:number,h:number}} canvasSize
 * @param {{ description?:string, style?:object, background?:string, descById?:Object<string,string> }} [opts]
 */
export function buildCaption(textEls, canvasSize, opts = {}) {
  const { description = '', style = null, background = '', descById = {} } = opts
  const elements = (textEls || [])
    .filter(el => el && el.type === 'text')
    .map(el => textElement(el, canvasSize, descById[el.id]))
    .filter(e => e.text)  // 빈 텍스트 제외

  const caption = {}
  if (description) caption.high_level_description = description
  if (style) caption.style_description = style
  caption.compositional_deconstruction = { background: background || '', elements }
  return caption
}

/** style_description을 스키마 키 순서로 구성(선택 도우미). photo면 art_style 대신 photo 사용. */
export function buildStyle({ aesthetics, lighting, medium, art_style, photo, color_palette } = {}) {
  const s = {}
  if (aesthetics) s.aesthetics = aesthetics
  if (lighting) s.lighting = lighting
  if (photo) { s.photo = photo; if (medium) s.medium = medium }
  else { if (medium) s.medium = medium; if (art_style) s.art_style = art_style }
  if (color_palette && color_palette.length) s.color_palette = color_palette
  return s
}
