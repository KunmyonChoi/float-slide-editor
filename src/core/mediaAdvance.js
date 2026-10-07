/**
 * mediaAdvance — "이 미디어가 끝날 때까지 기다렸다가 다음 슬라이드" (요소 옵션 advanceOnEnd).
 *
 * 자동 진행('음성 후 자동 진행')과 루프(전시회)는 원래 노트 나레이션의 종료만 신호로 썼다.
 * 음악·영상이 든 슬라이드는 나레이션이 먼저 끝나면 영상이 잘리고, 나레이션이 없으면 루프의
 * 머무는 시간(5초)에 노래가 끊긴다. advanceOnEnd를 켠 오디오·영상 요소는 그 재생이 끝날
 * 때까지 슬라이드를 붙든다 — 나레이션이 있으면 나레이션과 미디어가 모두 끝나야 넘어간다.
 *
 * 미디어는 FlatElementRenderer/AudioVisualizer가 각자 재생하므로, 끝남·실패를 이 작은
 * 신호 통로로 엔진(usePresentationEngine)에 알린다. 발표 재생(playNow) 중일 때만 보낸다 —
 * 편집 캔버스·썸네일의 같은 요소가 신호를 섞지 않게.
 */
import { isBackgroundElement } from './SnapEngine'

const EMBED_RE = /youtube\.com|youtu\.be|vimeo\.com|\/embed\//i

/**
 * 이 요소의 끝을 기다릴 수 있는가.
 * 임베드(YouTube/Vimeo iframe)는 종료 이벤트를 받을 수 없고, 배경 영상은 항상 반복이라 제외.
 */
export function waitsForEnd(el) {
  return !!el?.advanceOnEnd && canWaitForEnd(el)
}

/** 끝을 알 수 있는 오디오·영상인가(옵션과 무관). BGM은 여러 장에 걸쳐 흐르므로 제외. */
export function canWaitForEnd(el) {
  if (!el?.content || isBgm(el)) return false
  if (el.type === 'audio') return true
  if (el.type === 'video') return !EMBED_RE.test(el.content) && !isBackgroundElement(el)
  return false
}

/** 슬라이드를 넘겨도 이어지는 배경 음악인가(bgmSpan: 이 장부터 N장, 0=끝까지). */
export function isBgm(el) {
  return el?.type === 'audio' && Number.isInteger(el.bgmSpan) && el.bgmSpan >= 0
}

/** 끝을 기다리는 요소는 반복하면 영영 끝나지 않으므로 반복을 끈다. */
export function effectiveLoop(el, fallback = false) {
  if (waitsForEnd(el)) return false
  return el?.loop ?? fallback
}

/** 끝을 기다리는 요소는 눌러 줄 사람이 없어도 시작해야 하므로 자동 재생을 켠다. */
export function effectiveAutoplay(el, fallback = false) {
  if (waitsForEnd(el)) return true
  return el?.autoplay ?? fallback
}

/**
 * 슬라이드 진행 기준(page.advance.mode)이 '미디어 끝'·'모두 끝날 때'인데 요소에 옵션을 단 게
 * 하나도 없으면, 그 장의 끝을 알 수 있는 오디오·영상 전부를 기다린다(요소마다 켜지 않아도 되게).
 */
export function applySlideAdvance(elements, mode) {
  if (mode !== 'media' && mode !== 'all') return elements
  if ((elements || []).some(waitsForEnd)) return elements
  if (!(elements || []).some(canWaitForEnd)) return elements
  return elements.map(e => (canWaitForEnd(e) ? { ...e, advanceOnEnd: true } : e))
}

/**
 * 이 장에서 실제로 쓸 진행 기준.
 *  - auto: 기다릴 미디어가 있으면 all, 없으면 narration
 *  - media/all인데 기다릴 미디어가 없으면 narration으로(덱이 멈추지 않게)
 * @returns {'narration'|'media'|'all'|'time'|'click'}
 */
export function effectiveAdvanceMode(mode, waitCount) {
  const m = mode || 'auto'
  if (m === 'auto') return waitCount ? 'all' : 'narration'
  if ((m === 'media' || m === 'all') && !waitCount) return 'narration'
  return m
}

/**
 * 지금 장에서 흐를 BGM — 앞 장들에 놓인 BGM 중 지금 장까지 이어지는 것, 여럿이면 가장 늦게
 * 시작한 것(새 BGM이 앞의 것을 대신한다). 없으면 null.
 * @param {Array<{elements: object[]}>} pagesInOrder 진행 순서의 페이지
 */
export function activeBgm(pagesInOrder, current) {
  for (let i = Math.min(current, pagesInOrder.length - 1); i >= 0; i--) {
    const els = pagesInOrder[i]?.elements || []
    for (let j = els.length - 1; j >= 0; j--) {
      const e = els[j]
      if (!isBgm(e)) continue
      if (e.bgmSpan === 0 || current < i + e.bgmSpan) return { element: e, startSlide: i }
      // 이 장의 BGM이 이미 끝났으면 더 앞의 BGM도 이어지지 않는다 — 새 BGM이 대신했으니까
      return null
    }
  }
  return null
}

/** 슬라이드에서 끝을 기다릴 요소 id 목록. */
export function waitMediaIds(elements) {
  return (elements || []).filter(waitsForEnd).map(e => e.id)
}

// ── 끝남/실패 신호 ──
const listeners = new Set()

/** 엔진이 구독한다. 반환 함수로 해제. fn(elementId, 'ended' | 'failed') */
export function onMediaSignal(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 미디어 재생이 끝났다. */
export function reportMediaEnded(elementId) {
  if (elementId) listeners.forEach(fn => fn(elementId, 'ended'))
}

/** 미디어가 재생되지 못했다(자동재생 차단·파일 유실·디코드 실패) — 덱이 멈추지 않게 알린다. */
export function reportMediaFailed(elementId) {
  if (elementId) listeners.forEach(fn => fn(elementId, 'failed'))
}

/**
 * 지금 슬라이드를 넘길 차례인가.
 * @param {object} s
 * @param {boolean} s.auto          자동 진행 또는 루프가 켜져 있는가
 * @param {boolean} s.narrationPending 나레이션이 아직 흐르는 중인가
 * @param {string[]} s.waitIds      끝을 기다릴 요소 id
 * @param {Record<string,'ended'|'failed'>} s.status 이 슬라이드에서 받은 신호
 * @returns {'wait' | 'advance' | 'dwell' | 'none'}
 *   none: 기다릴 미디어가 없다(기존 규칙대로) · wait: 아직 · advance: 바로 넘긴다 ·
 *   dwell: 미디어가 하나도 제대로 재생되지 못했다 — 루프의 머무는 시간 뒤에 넘긴다
 */
export function mediaAdvanceDecision({ auto, narrationPending, waitIds, status }) {
  if (!waitIds.length) return 'none'
  if (!auto || narrationPending) return 'wait'
  if (waitIds.some(id => !status[id])) return 'wait'
  return waitIds.every(id => status[id] === 'failed') ? 'dwell' : 'advance'
}
