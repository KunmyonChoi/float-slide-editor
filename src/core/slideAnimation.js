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

  const stepOf = {}, offsetOf = {}, autoOffsets = {}
  let stepCount = 0
  for (const e of animated) {
    const tr = e.anim.trigger || { mode: 'click' }
    // 자동: 클릭 단계에 포함하지 않음 — CSS animation-delay로 delayMs 그대로 사용
    if (tr.mode === 'auto') {
      autoOffsets[e.id] = e.anim.delayMs || 0
      continue
    }
    const ref = tr.ref && byId[tr.ref] && stepOf[tr.ref] != null ? tr.ref : null
    if (tr.mode === 'with' && ref) {
      stepOf[e.id] = stepOf[ref]
      offsetOf[e.id] = offsetOf[ref]
    } else if (tr.mode === 'after' && ref) {
      stepOf[e.id] = stepOf[ref]
      offsetOf[e.id] = offsetOf[ref] + (byId[ref].anim.durationMs || DEFAULT_DUR) + (e.anim.delayMs || 0)
    } else {
      // click(또는 ref 해소 실패 폴백) → 새 단계
      stepOf[e.id] = stepCount
      offsetOf[e.id] = e.anim.delayMs || 0
      stepCount++
    }
  }
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
