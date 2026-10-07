/**
 * slideAnimation — 요소 등장/퇴장 애니메이션 엔진(순수).
 * element.anim = {
 *   effect: 'fadeIn'|'slideIn'|'scaleIn'|'pop'|'fadeOut'|'slideOut'|'scaleOut',
 *   dir?: 'left'|'right'|'up'|'down',   // slide 계열만
 *   durationMs, delayMs,
 *   trigger: { mode:'auto'|'click'|'with'|'after', ref:<elementId>|null },
 *   seq: number,                        // 작성 순서(빌드 단계 계산 기준)
 * }
 * auto  = 페이지 진입 즉시 자동 재생 (delayMs로 지연, 클릭 단계에 포함되지 않음)
 * click = 새 단계, with = ref와 같은 단계 동시, after = ref 종료 후(+delay) 자동 연쇄.
 */

export const EFFECTS = [
  { id: 'none', label: '없음', kind: null, dir: false },
  { id: 'fadeIn', label: '페이드 인', kind: 'enter', dir: false },
  { id: 'slideIn', label: '슬라이드 인', kind: 'enter', dir: true },
  { id: 'scaleIn', label: '확대', kind: 'enter', dir: false },
  { id: 'pop', label: '팝', kind: 'enter', dir: false },
  { id: 'fadeOut', label: '페이드 아웃', kind: 'exit', dir: false },
  { id: 'slideOut', label: '슬라이드 아웃', kind: 'exit', dir: true },
  { id: 'scaleOut', label: '축소', kind: 'exit', dir: false },
]
const KIND = Object.fromEntries(EFFECTS.map(e => [e.id, e.kind]))
const HASDIR = Object.fromEntries(EFFECTS.map(e => [e.id, e.dir]))

export function isEntrance(effect) { return KIND[effect] === 'enter' }
export function isExit(effect) { return KIND[effect] === 'exit' }
export function effectHasDir(effect) { return !!HASDIR[effect] }

export const DEFAULT_DUR = 500

/**
 * 애니메이션 가진 요소들을 seq 순으로 정렬해 click 단계로 그룹핑.
 * auto 트리거 요소는 stepOf에 포함되지 않고 autoOffsets에 별도 보관된다.
 * @returns { stepCount, stepOf:{id->step}, offsetOf:{id->startMs}, autoOffsets:{id->delayMs}, order:[id...] }
 */
export function computeSteps(elements) {
  const animated = (elements || [])
    .filter(e => e?.anim && e.anim.effect && e.anim.effect !== 'none')
    .slice()
    .sort((a, b) => (a.anim.seq || 0) - (b.anim.seq || 0))
  const byId = {}
  for (const e of animated) byId[e.id] = e

  // ── 1) 참조 해소: 각 요소가 어느 '뿌리'에 매달렸는지 ──
  // 선언 순서와 무관하게 해소한다. 예전에는 앞에서 이미 처리된 참조만 인정해서, 뒤에 선언된
  // 앵커를 가리키면(표 10행이 아래쪽 구분선을 참조하는 식) 조용히 전부 각자의 클릭 단계로
  // 흩어졌다 — 클릭 4번이면 될 장이 44번이 됐다. 이름이 같은 슬라이드에 있으면 위치는 따지지 않는다.
  // 순환하거나 못 찾는 참조만 자기 자신이 뿌리(= 독립 클릭 단계)가 된다.
  const rootOf = {}
  const findRoot = (e, seen) => {
    if (rootOf[e.id]) return rootOf[e.id]
    const tr = e.anim.trigger || { mode: 'click' }
    const chained = tr.mode === 'with' || tr.mode === 'after'
    const ref = chained && tr.ref ? byId[tr.ref] : null
    if (!ref || ref.id === e.id || seen.has(ref.id)) return (rootOf[e.id] = e.id)
    seen.add(e.id)
    return (rootOf[e.id] = findRoot(ref, seen))
  }
  for (const e of animated) findRoot(e, new Set([e.id]))

  // ── 2) 뿌리에 단계 번호를 매긴다(번호는 선언 순서를 따른다) ──
  const stepOf = {}, offsetOf = {}, autoOffsets = {}
  let stepCount = 0
  for (const e of animated) {
    if (rootOf[e.id] !== e.id) continue
    // 자동: 클릭 단계에 포함하지 않음 — CSS animation-delay로 delayMs 그대로 사용
    if ((e.anim.trigger?.mode || 'click') === 'auto') autoOffsets[e.id] = e.anim.delayMs || 0
    else { stepOf[e.id] = stepCount++; offsetOf[e.id] = e.anim.delayMs || 0 }
  }

  // ── 3) 체인을 따라 시작 시각을 채운다 ──
  // 참조 대상이 먼저 계산되도록 재귀로 올라간다(뿌리는 2)에서 이미 값이 있다).
  // 뿌리가 auto면 체인 전체가 auto다 — "제목 뜨고 이어서 부제"가 클릭을 요구하지 않는다.
  const startOf = (e) => {
    const known = offsetOf[e.id] ?? autoOffsets[e.id]
    if (known != null) return known
    const tr = e.anim.trigger
    const ref = byId[tr.ref]
    const base = startOf(ref)
    const delay = e.anim.delayMs || 0
    // with = 같은 시작점 + 자기 지연(0이면 완전 동시). 지연을 주면 한 단계 안에서 계단식 등장이 된다.
    // after = 대상이 끝난 뒤 + 자기 지연.
    const off = tr.mode === 'after'
      ? base + (ref.anim.durationMs || DEFAULT_DUR) + delay
      : base + delay
    if (autoOffsets[ref.id] != null) autoOffsets[e.id] = off
    else { stepOf[e.id] = stepOf[ref.id]; offsetOf[e.id] = off }
    return off
  }
  for (const e of animated) startOf(e)

  return { stepCount, stepOf, offsetOf, autoOffsets, order: animated.map(e => e.id) }
}

/** 단계별 총 소요시간(ms) — 자동 진행(음성/미리보기) 타이밍용. offset+duration 최대값. */
export function stepDurations(info, elements) {
  const byId = {}
  for (const e of (elements || [])) byId[e.id] = e
  const durs = new Array(info.stepCount).fill(300)
  for (const id of info.order) {
    const s = info.stepOf[id], el = byId[id]
    if (s == null || !el) continue
    durs[s] = Math.max(durs[s], (info.offsetOf[id] || 0) + (el.anim?.durationMs || DEFAULT_DUR))
  }
  return durs
}

/** revealed 단계(클릭 수) 기준 요소가 숨김인지. 비애니 요소는 항상 보임(false). */
export function isHiddenAt(info, el, revealed) {
  if (!el?.anim || !el.anim.effect || el.anim.effect === 'none') return false
  const step = info.stepOf[el.id]
  if (step == null) return false
  if (isEntrance(el.anim.effect)) return step >= revealed   // 아직 등장 전
  if (isExit(el.anim.effect)) return step < revealed         // 이미 퇴장함
  return false
}

/** revealed로 막 진입(forward)했을 때 이 요소가 지금 재생되는 단계인지. */
export function isPlayingAt(info, el, revealed) {
  if (!el?.anim || !el.anim.effect || el.anim.effect === 'none') return false
  return info.stepOf[el.id] === revealed - 1
}

const KEYFRAME = {
  fadeIn: 'feElFadeIn', slideIn: 'feElSlideIn', scaleIn: 'feElScaleIn', pop: 'feElPop',
  fadeOut: 'feElFadeOut', slideOut: 'feElSlideOut', scaleOut: 'feElScaleOut',
}

/** 재생용 CSS animation 문자열. offsetMs는 단계 내 시작 지연(with/after 타임라인). */
export function animationCss(anim, offsetMs = 0) {
  const name = KEYFRAME[anim?.effect]
  if (!name) return null
  const dur = Math.max(50, anim.durationMs || DEFAULT_DUR)
  const delay = Math.max(0, offsetMs)
  return `${name} ${dur}ms ease-out ${delay}ms both`
}

/** 슬라이드 계열 방향 → translate CSS 변수(--fe-dx/--fe-dy).
 *  화살표 = 요소가 이동하는 방향(M). up은 화면상 -y, down은 +y.
 *  keyframe상 등장(slideIn)은 시작 오프셋=이동의 반대편(-M)에서 0으로,
 *  퇴장(slideOut)은 0에서 끝 오프셋=이동 방향(+M)으로 움직이므로 부호를 분기한다. */
export function directionVars(anim) {
  if (!effectHasDir(anim?.effect)) return null
  const OFF = 34
  const M = { left: [-OFF, 0], right: [OFF, 0], up: [0, -OFF], down: [0, OFF] }[anim.dir]
    || [-OFF, 0]
  const s = KIND[anim.effect] === 'enter' ? -1 : 1
  const fmt = (v) => (v === 0 ? '0' : `${v}%`)
  return { '--fe-dx': fmt(M[0] * s), '--fe-dy': fmt(M[1] * s) }
}

// ── 반복(강조) 효과 ──
// 등장/퇴장(el.anim)과 별개로 el.loopAnim에 둔다 — 같은 요소가 "팝으로 등장한 뒤 계속 맥박"처럼
// 둘을 함께 쓸 수 있어야 하기 때문이다. (el.loop는 영상·오디오 반복 재생 플래그라 이름을 피한다.)
// el.loopAnim = {
//   effect: LOOP_EFFECTS id, periodMs: 한 주기, intensity: 세기 배율(0.25~3),
//   phaseMs: 시차(주기를 이만큼 앞당겨 시작 — 여러 요소의 박자를 엇갈리게),
//   start: 'afterEnter'(등장이 끝난 뒤) | 'withEnter'(등장과 함께), repeat: 0=무한 | 횟수,
// }

export const LOOP_EFFECTS = [
  { id: 'pulse', label: '맥박', periodMs: 1200, timing: 'ease-in-out' },
  { id: 'breathe', label: '숨쉬기', periodMs: 3000, timing: 'ease-in-out' },
  { id: 'float', label: '떠다니기', periodMs: 3000, timing: 'ease-in-out' },
  { id: 'spin', label: '회전', periodMs: 8000, timing: 'linear' },
  { id: 'wiggle', label: '까딱임', periodMs: 1000, timing: 'ease-in-out' },
  { id: 'blink', label: '깜빡임', periodMs: 1000, timing: 'ease-in-out' },
  { id: 'shimmer', label: '반짝 스윕', periodMs: 2400, timing: 'ease-in-out' },
]
const LOOP_BY_ID = Object.fromEntries(LOOP_EFFECTS.map(e => [e.id, e]))
const LOOP_KEYFRAME = {
  pulse: 'feLoopPulse', breathe: 'feLoopBreathe', float: 'feLoopFloat', spin: 'feLoopSpin',
  wiggle: 'feLoopWiggle', blink: 'feLoopBlink', shimmer: 'feLoopShimmer',
}
export const LOOP_STARTS = ['afterEnter', 'withEnter']

export function hasLoop(el) { return !!LOOP_BY_ID[el?.loopAnim?.effect] }

/** 효과를 고를 때의 기본 스펙(주기는 효과별 기본값). 기존 값(세기·시차·시작·횟수)은 유지한다. */
export function makeLoopAnim(effect, prev = null) {
  const def = LOOP_BY_ID[effect]
  if (!def) return null
  return {
    intensity: 1, phaseMs: 0, start: 'afterEnter', repeat: 0,
    ...(prev || {}),
    effect,
    periodMs: def.periodMs,
  }
}

/**
 * 반복 효과가 시작되는 시각(ms) — 요소가 보이기 시작하는 순간(자동 요소는 슬라이드 진입, 클릭
 * 단계 요소는 그 단계 시작)을 0으로 한 값. 등장 효과가 없거나 퇴장 효과만 있으면 처음부터 보이므로 0.
 * afterEnter는 등장 시간만큼 기다리고, withEnter는 등장과 같이 움직인다.
 */
export function loopStartMs(info, el) {
  if (!hasLoop(el)) return null
  const a = el.anim
  if (!a || !isEntrance(a.effect)) return 0
  const enterAt = info?.autoOffsets?.[el.id] ?? info?.offsetOf?.[el.id] ?? 0
  const after = (el.loopAnim.start || 'afterEnter') === 'afterEnter'
  return enterAt + (after ? (a.durationMs || DEFAULT_DUR) : 0)
}

/** 반복 재생용 CSS animation 문자열. 시차는 시작 지연에서 빼서 주기 중간부터 시작하게 한다. */
export function loopAnimationCss(loopAnim, startMs = 0) {
  const def = LOOP_BY_ID[loopAnim?.effect]
  if (!def) return null
  const period = Math.max(200, loopAnim.periodMs || def.periodMs)
  const phase = Math.max(0, loopAnim.phaseMs || 0) % period
  const delay = Math.round((startMs || 0) - phase)
  const count = loopAnim.repeat > 0 ? Math.round(loopAnim.repeat) : 'infinite'
  return `${LOOP_KEYFRAME[loopAnim.effect]} ${period}ms ${def.timing} ${delay}ms ${count} both`
}

/** 세기 → CSS 변수(--fe-li). 키프레임이 진폭에 곱한다. */
export function loopVars(loopAnim) {
  const i = Number.isFinite(loopAnim?.intensity) ? Math.min(3, Math.max(0.25, loopAnim.intensity)) : 1
  return { '--fe-li': String(i) }
}

/** 반복 효과 래퍼 클래스 — 동작 줄이기 설정 대응(fe-loop-anim) + 반짝 스윕의 ::after 빛 띠. */
export function loopClassName(loopAnim) {
  return loopAnim?.effect === 'shimmer' ? 'fe-loop-anim fe-loop-shimmer' : 'fe-loop-anim'
}
