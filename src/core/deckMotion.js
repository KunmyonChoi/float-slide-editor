/**
 * deckMotion — 덱 HTML에 실린 "발표자 노트 + 모션" 규약의 파서/직렬화기(순수).
 *
 * Genitor는 HTML을 flat 요소로 추출한다(FlatExtractor). 그 과정에서 화면에 보이는
 * 것만 넘어오므로, 발표에 필요한 두 가지 — 발표자가 말할 원고와 요소 등장 모션 —
 * 는 별도 규약으로 실어 나른다. 규약은 브라우저 렌더에 아무 영향이 없다(데이터
 * 속성 + display:none 스크립트).
 *
 *   <div class="slide active" data-transition="fade" data-transition-duration="400">
 *     <div data-anim="fadeIn" data-anim-name="title" ...>제목</div>
 *     <div data-anim="slideIn" data-anim-dir="up"
 *          data-anim-trigger="after" data-anim-ref="title" data-anim-delay="150" ...>본문</div>
 *     <script type="text/plain" class="fe-notes">발표자가 말할 원고…</script>
 *   </div>
 *
 * 파싱 결과는 에디터 내부 모델과 1:1 대응한다:
 *   요소 → element.anim  (src/core/slideAnimation.js)
 *   슬라이드 → page.notes / page.transition
 *
 * 프레임워크 무의존. DOM 요소를 받지만 getAttribute/querySelector만 쓴다(jsdom 가능).
 */

export const ANIM_EFFECTS = [
  'fadeIn', 'slideIn', 'scaleIn', 'pop', 'fadeOut', 'slideOut', 'scaleOut',
]
export const ANIM_DIRS = ['left', 'right', 'up', 'down']
export const ANIM_TRIGGERS = ['click', 'auto', 'with', 'after']
export const TRANSITION_TYPES = ['fade', 'slide', 'zoom']

// 방향을 갖는 효과(그 외에는 dir 무시)
const DIR_EFFECTS = new Set(['slideIn', 'slideOut'])

export const DEFAULT_ANIM_DURATION = 500
export const DEFAULT_TRANSITION_DURATION = 400

/** 노트 스크립트/블록을 찾는 선택자 — 슬라이드당 하나 */
export const NOTES_SELECTOR = '.fe-notes'

const clampInt = (raw, def, min, max) => {
  const n = parseInt(String(raw ?? '').trim(), 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

const attr = (el, name) => {
  const v = el?.getAttribute?.(name)
  return v == null ? '' : String(v).trim()
}

/**
 * 요소의 data-anim* 속성 → anim 스펙.
 * 반환값은 element.anim과 같은 모양이되, 참조는 아직 저자 이름(refName)이다.
 * seq와 trigger.ref(flat id)는 추출기가 채운다.
 * @param {Element} el
 * @returns {null | { effect, dir?, durationMs, delayMs, trigger:{mode, refName:string|null}, name:string|null }}
 */
export function parseAnimAttrs(el) {
  const effect = attr(el, 'data-anim')
  if (!effect || effect === 'none') return null
  if (!ANIM_EFFECTS.includes(effect)) return null

  const modeRaw = attr(el, 'data-anim-trigger') || 'click'
  const mode = ANIM_TRIGGERS.includes(modeRaw) ? modeRaw : 'click'
  const refName = (mode === 'with' || mode === 'after') ? (attr(el, 'data-anim-ref') || null) : null

  const spec = {
    effect,
    durationMs: clampInt(attr(el, 'data-anim-duration') || attr(el, 'data-anim-dur'),
      DEFAULT_ANIM_DURATION, 50, 10000),
    delayMs: clampInt(attr(el, 'data-anim-delay'), 0, 0, 60000),
    trigger: { mode, refName },
    name: attr(el, 'data-anim-name') || null,
  }
  if (DIR_EFFECTS.has(effect)) {
    const dir = attr(el, 'data-anim-dir')
    spec.dir = ANIM_DIRS.includes(dir) ? dir : 'up'
  }
  return spec
}

/**
 * 슬라이드의 data-transition* 속성 → page.transition.
 * @param {Element} slideEl
 * @returns {null | { type, durationMs, dir? }}
 */
export function parseTransitionAttrs(slideEl) {
  const type = attr(slideEl, 'data-transition')
  if (!type || type === 'none' || !TRANSITION_TYPES.includes(type)) return null
  const t = {
    type,
    durationMs: clampInt(attr(slideEl, 'data-transition-duration'),
      DEFAULT_TRANSITION_DURATION, 50, 3000),
  }
  if (type === 'slide') {
    const dir = attr(slideEl, 'data-transition-dir')
    t.dir = ANIM_DIRS.includes(dir) ? dir : 'right'
  }
  return t
}

/**
 * 여러 줄 원고의 공통 들여쓰기를 제거하고 앞뒤 빈 줄을 정리한다.
 * (HTML 안에 들여써 넣은 <script class="fe-notes"> 내용을 그대로 쓰기 위함)
 */
export function dedent(text) {
  if (!text) return ''
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && !lines[0].trim()) lines.shift()
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  let indent = Infinity
  for (const l of lines) {
    if (!l.trim()) continue
    const m = l.match(/^[ \t]*/)
    indent = Math.min(indent, m ? m[0].length : 0)
  }
  if (!Number.isFinite(indent) || indent === 0) return lines.join('\n')
  return lines.map(l => l.slice(indent)).join('\n')
}

/**
 * 슬라이드 루트에서 발표자 노트를 읽는다.
 * @param {Element|Document} root
 * @returns {string} 없으면 ''
 */
export function readSlideNotes(root) {
  const node = root?.querySelector?.(NOTES_SELECTOR)
  if (!node) return ''
  // notesToScript가 넣은 `<\/script` 이스케이프를 되돌린다(안 하면 왕복마다 역슬래시가 쌓인다).
  return dedent((node.textContent || '').replace(/<\\\/script/gi, '</script'))
}

/**
 * 파싱된 스펙을 flat 요소의 `anim`으로 확정한다(추출 후처리).
 *
 * · seq = 호스트(=data-anim 선언 요소)의 문서 순서 → 빌드 단계 계산 기준.
 * · 한 호스트가 여러 flat 요소를 낳으면(예: <ul>의 li들, 아이콘+글자) 첫 요소만 선언된
 *   트리거를 갖고 나머지는 `with`로 묶어 한 단계에서 함께 움직인다. 항목마다 따로
 *   등장시키고 싶으면 저자가 각 항목에 data-anim을 단다.
 * · data-anim-ref(저자 이름) → 그 호스트의 첫 flat 요소 id로 해소. 실패 시 click 폴백
 *   (slideAnimation.computeSteps도 미해소 참조를 새 단계로 폴백한다).
 *
 * @param {Array} elements flat 요소 배열(_animIdx가 붙어 있음 — 처리 후 제거)
 * @param {Array} specs parseAnimAttrs 결과 배열(호스트 순서)
 * @param {Map<string,number>} byName data-anim-name → 호스트 인덱스
 */
export function resolveAnimSpecs(elements, specs, byName) {
  const firstIdOf = new Map()   // 호스트 인덱스 → 첫 flat 요소 id
  for (const el of elements || []) {
    const i = el?._animIdx
    if (i == null || i < 0) continue
    if (!firstIdOf.has(i)) firstIdOf.set(i, el.id)
  }
  for (const el of elements || []) {
    const i = el?._animIdx
    if (el) delete el._animIdx
    if (i == null || i < 0) continue
    const spec = specs?.[i]
    if (!spec) continue
    const isFirst = firstIdOf.get(i) === el.id
    let trigger
    if (!isFirst) {
      trigger = { mode: 'with', ref: firstIdOf.get(i) }
    } else if (spec.trigger.mode === 'with' || spec.trigger.mode === 'after') {
      const refIdx = spec.trigger.refName != null ? byName?.get(spec.trigger.refName) : undefined
      const refId = refIdx != null ? firstIdOf.get(refIdx) : null
      trigger = (refId && refId !== el.id)
        ? { mode: spec.trigger.mode, ref: refId }
        : { mode: 'click', ref: null }
    } else {
      trigger = { mode: spec.trigger.mode, ref: null }
    }
    el.anim = {
      effect: spec.effect,
      ...(spec.dir ? { dir: spec.dir } : {}),
      durationMs: spec.durationMs,
      delayMs: spec.delayMs,
      trigger,
      seq: i,
    }
  }
  return elements
}

// ── 내보내기(직렬화) ──

const escAttr = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * element.anim → data-anim* 속성 문자열(앞에 공백 포함). 없으면 ''.
 * @param {Object} anim
 * @param {(id:string)=>string|null} [nameOf] flat id → 저자 이름(참조 직렬화용)
 * @param {string|null} [selfName] 이 요소의 이름(다른 요소가 참조할 때 필요)
 */
export function animToAttrs(anim, nameOf = null, selfName = null) {
  if (!anim || !anim.effect || !ANIM_EFFECTS.includes(anim.effect)) return ''
  const parts = [`data-anim="${anim.effect}"`]
  if (DIR_EFFECTS.has(anim.effect) && anim.dir) parts.push(`data-anim-dir="${escAttr(anim.dir)}"`)
  const dur = anim.durationMs || DEFAULT_ANIM_DURATION
  if (dur !== DEFAULT_ANIM_DURATION) parts.push(`data-anim-duration="${dur}"`)
  if (anim.delayMs) parts.push(`data-anim-delay="${anim.delayMs}"`)
  const mode = anim.trigger?.mode || 'click'
  if (mode !== 'click') parts.push(`data-anim-trigger="${escAttr(mode)}"`)
  if ((mode === 'with' || mode === 'after') && anim.trigger?.ref) {
    const refName = nameOf ? nameOf(anim.trigger.ref) : null
    if (refName) parts.push(`data-anim-ref="${escAttr(refName)}"`)
  }
  if (selfName) parts.push(`data-anim-name="${escAttr(selfName)}"`)
  return ' ' + parts.join(' ')
}

/** page.transition → .slide용 data-transition* 속성 문자열(앞에 공백 포함). 없으면 ''. */
export function transitionToAttrs(t) {
  if (!t || !t.type || !TRANSITION_TYPES.includes(t.type)) return ''
  const parts = [`data-transition="${escAttr(t.type)}"`]
  if (t.type === 'slide' && t.dir) parts.push(`data-transition-dir="${escAttr(t.dir)}"`)
  const dur = t.durationMs || DEFAULT_TRANSITION_DURATION
  if (dur !== DEFAULT_TRANSITION_DURATION) parts.push(`data-transition-duration="${dur}"`)
  return ' ' + parts.join(' ')
}

/**
 * 발표자 노트 → 슬라이드 안에 넣을 <script class="fe-notes"> 블록. 없으면 ''.
 * type="text/plain"이라 실행되지 않고, 렌더에도 잡히지 않는다.
 */
export function notesToScript(notes) {
  const text = (notes || '').trim()
  if (!text) return ''
  // </script>만 깨뜨리지 않으면 나머지는 원문 그대로 보존된다.
  const safe = text.replace(/<\/script/gi, '<\\/script')
  return `<script type="text/plain" class="fe-notes">\n${safe}\n</script>`
}

/**
 * 이름 없는 요소들에 참조용 이름을 붙여준다(내보내기 시).
 * with/after로 참조되는 요소만 이름이 필요하므로, 참조 대상만 골라 "a1, a2…"를 발급.
 * @param {Array} elements flat 요소 배열
 * @returns {Map<string,string>} flat id → 이름
 */
export function buildAnimNameMap(elements) {
  const referenced = new Set()
  for (const el of elements || []) {
    const ref = el?.anim?.trigger?.ref
    if (ref) referenced.add(ref)
  }
  const map = new Map()
  let n = 0
  for (const el of elements || []) {
    if (referenced.has(el.id)) map.set(el.id, `a${++n}`)
  }
  return map
}
