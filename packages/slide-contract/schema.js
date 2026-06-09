/**
 * slide-contract — PPTX 엔진의 공개 계약(SlideDeck).
 *
 * 이 모듈이 STAGE1(계약 생산: HTML flat 변환 / 자체 모델 매퍼)과
 * STAGE2(PPTX 엔진: SlideDeck → .pptx)를 잇는 유일한 외부 API다.
 * 내부 FlatElement 표현은 어댑터 뒤에 숨기고, 소비 SW는 SlideDeck만 다룬다.
 *
 * 프레임워크/런타임 무의존 (브라우저·Node 공용, 순수 함수).
 * 단위 규약: 좌표·크기 = CSS px(좌상단 기준), 폰트 크기 = px(엔진이 ×0.75 → pt), 색 = hex.
 *
 * @typedef {Object} SlideDeck
 * @property {string} schemaVersion            - 계약 버전 (SCHEMA_VERSION)
 * @property {{w:number,h:number}} canvasSize  - 덱 기본 캔버스 크기(px)
 * @property {FontDescriptor[]} [fonts]        - 임베딩용 폰트(@font-face/google-import)
 * @property {SlidePage[]} pages
 *
 * @typedef {Object} SlidePage
 * @property {{w:number,h:number}} [canvasSize] - 페이지별 오버라이드(없으면 덱 기본)
 * @property {SlideElement[]} elements
 *
 * @typedef {Object} SlideElement
 * @property {'text'|'image'|'shape'|'svg'} type
 * @property {number} x @property {number} y @property {number} width @property {number} height  - px
 * @property {number} [rotation]               - deg, 기본 0
 * @property {number} [z]                       - z-order, 기본 0
 * @property {{html?:string, plain?:string}} [text]  - type='text'
 * @property {string} [src]                     - type='image'|'svg' (data: 또는 URL)
 * @property {Array} [points]                   - type='shape' (선/도형 포인트)
 * @property {{href:string, target?:string}} [link]
 * @property {ElementStyle} [style]
 *
 * @typedef {Object} ElementStyle
 * @property {string} [color] @property {number} [fontSize] @property {string} [fontFamily]
 * @property {number|string} [fontWeight] @property {boolean} [italic]
 * @property {'left'|'center'|'right'} [align]
 * @property {string} [background] @property {number} [radius]
 * @property {[number,number,number,number]} [padding] @property {number} [lineHeight]
 * @property {number} [opacity] @property {Object} [shadow] @property {Object} [gradient]
 *
 * @typedef {Object} FontDescriptor
 * @property {'font-face'|'google-import'} type
 * @property {string} [family] @property {string} [url]
 * @property {number} [weight] @property {string} [style]
 */

export const SCHEMA_VERSION = '1.0'

export const ELEMENT_TYPES = ['text', 'image', 'shape', 'svg']

// ── 빌더 (자체 모델 → SlideDeck 매핑을 쉽게) ──

/** 새 덱 생성. pages는 page()로 만들어 넣는다. */
export function deck({ canvasSize = { w: 1280, h: 720 }, fonts = [], pages = [] } = {}) {
  return { schemaVersion: SCHEMA_VERSION, canvasSize, fonts, pages }
}

/** 새 페이지 생성. */
export function page(elements = [], canvasSize) {
  const p = { elements }
  if (canvasSize) p.canvasSize = canvasSize
  return p
}

function baseEl(type, { x = 0, y = 0, width = 0, height = 0, rotation = 0, z = 0, style, link } = {}) {
  const el = { type, x, y, width, height }
  if (rotation) el.rotation = rotation
  if (z) el.z = z
  if (style) el.style = style
  if (link) el.link = link
  return el
}

/** 텍스트 요소. content는 html 문자열(또는 plain). */
export function text(html, opts = {}) {
  const el = baseEl('text', opts)
  el.text = typeof html === 'string' ? { html } : (html || {})
  return el
}

/** 이미지 요소. src = data:URL 또는 외부 URL. */
export function image(src, opts = {}) {
  const el = baseEl('image', opts)
  el.src = src
  return el
}

/** SVG 요소. src = data:image/svg... 또는 인라인 svg data URL. */
export function svg(src, opts = {}) {
  const el = baseEl('svg', opts)
  el.src = src
  return el
}

/** 도형 요소. */
export function shape(opts = {}) {
  const el = baseEl('shape', opts)
  if (opts.points) el.points = opts.points
  return el
}

// ── 검증 (경량, 외부 의존 없음) ──

const isNum = (v) => typeof v === 'number' && !Number.isNaN(v)
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)

/**
 * SlideDeck 구조 검증. 무거운 JSON Schema 없이 핵심만 점검.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateDeck(d) {
  const errors = []
  const warnings = []
  if (!isObj(d)) return { valid: false, errors: ['deck must be an object'], warnings }

  if (d.schemaVersion == null) {
    errors.push('schemaVersion is required')
  } else if (d.schemaVersion !== SCHEMA_VERSION) {
    warnings.push(`schemaVersion "${d.schemaVersion}" != engine "${SCHEMA_VERSION}" (호환성 미보장)`)
  }

  if (!isObj(d.canvasSize) || !isNum(d.canvasSize.w) || !isNum(d.canvasSize.h)) {
    errors.push('canvasSize {w:number,h:number} is required')
  }
  if (d.fonts != null && !Array.isArray(d.fonts)) errors.push('fonts must be an array')

  if (!Array.isArray(d.pages)) {
    errors.push('pages must be an array')
  } else {
    d.pages.forEach((p, pi) => {
      if (!isObj(p)) { errors.push(`pages[${pi}] must be an object`); return }
      if (p.canvasSize && (!isNum(p.canvasSize.w) || !isNum(p.canvasSize.h))) {
        errors.push(`pages[${pi}].canvasSize must be {w,h}`)
      }
      if (!Array.isArray(p.elements)) { errors.push(`pages[${pi}].elements must be an array`); return }
      p.elements.forEach((el, ei) => validateElement(el, `pages[${pi}].elements[${ei}]`, errors, warnings))
    })
  }
  return { valid: errors.length === 0, errors, warnings }
}

function validateElement(el, path, errors, warnings) {
  if (!isObj(el)) { errors.push(`${path} must be an object`); return }
  if (!ELEMENT_TYPES.includes(el.type)) {
    errors.push(`${path}.type must be one of ${ELEMENT_TYPES.join('|')} (got ${JSON.stringify(el.type)})`)
  }
  for (const k of ['x', 'y', 'width', 'height']) {
    if (!isNum(el[k])) errors.push(`${path}.${k} must be a number`)
  }
  if (el.type === 'text' && !isObj(el.text)) {
    errors.push(`${path}.text {html|plain} is required for text`)
  }
  if ((el.type === 'image' || el.type === 'svg') && typeof el.src !== 'string') {
    errors.push(`${path}.src (string) is required for ${el.type}`)
  }
  if (el.style != null && !isObj(el.style)) errors.push(`${path}.style must be an object`)
  if (el.link != null && (!isObj(el.link) || typeof el.link.href !== 'string')) {
    errors.push(`${path}.link must be {href:string,...}`)
  }
  if (el.style && el.style.fontSize != null && !isNum(el.style.fontSize)) {
    warnings.push(`${path}.style.fontSize 는 px 숫자 권장(예: 32, "32px" 아님)`)
  }
}

/** 검증 실패 시 예외를 던지는 헬퍼(엔진 입구/생산기에서 사용). */
export function assertDeck(d) {
  const { valid, errors } = validateDeck(d)
  if (!valid) throw new Error('Invalid SlideDeck: ' + errors.join('; '))
  return d
}
