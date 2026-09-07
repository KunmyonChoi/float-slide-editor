/**
 * 슬라이드 전환(fade/slide/zoom) → CSS animation 값.
 * 발표 경로마다 다르게 계산되면 청중 창과 발표자 창의 전환이 어긋나므로 한 곳에 둔다.
 */

const TRANSITION_KEYFRAMES = { fade: 'feSlideFade', slide: 'feSlideSlide', zoom: 'feSlideZoom' }

// 슬라이드 전환 → CSS animation 문자열 (없으면 undefined). 들어오는 슬라이드에 적용.
export function slideTransitionCss(t) {
  if (!t || !TRANSITION_KEYFRAMES[t.type]) return undefined
  const dur = Math.max(50, t.durationMs || 400)
  return `${TRANSITION_KEYFRAMES[t.type]} ${dur}ms ease-out`
}

// 슬라이드 전환 방향 변수(slide 타입만) — 화살표 = 들어오는 슬라이드가 이동하는 방향.
// (시작 오프셋은 이동 방향의 반대편; from=offset → to=0으로 애니메이션)
const SLIDE_OFF = '30%'

export function slideTransitionVars(t) {
  if (!t || t.type !== 'slide') return null
  switch (t.dir) {
    case 'left': return { '--fe-sx': SLIDE_OFF, '--fe-sy': '0' }        // ← 왼쪽으로 이동
    case 'up': return { '--fe-sx': '0', '--fe-sy': SLIDE_OFF }          // ↑ 위로 이동
    case 'down': return { '--fe-sx': '0', '--fe-sy': `-${SLIDE_OFF}` }  // ↓ 아래로 이동
    case 'right':
    default: return { '--fe-sx': `-${SLIDE_OFF}`, '--fe-sy': '0' }      // → 오른쪽으로 이동(기본)
  }
}
