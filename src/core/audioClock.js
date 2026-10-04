/**
 * audioClock — 발표 중 재생되는 오디오 요소의 재생 시각을 다른 요소가 읽게 하는 작은 등록부.
 *
 * 오디오 요소는 AudioVisualizer가 자체 Audio 객체로 재생해 바깥에서 currentTime을 볼 수 없다.
 * 가사 싱크(LyricScroller)처럼 그 시각에 맞춰 움직여야 하는 요소를 위해, 재생을 시작하면 요소 id로
 * Audio 객체를 등록하고 멈추면 지운다. 읽는 쪽은 requestAnimationFrame마다 get(id)로 시각을 읽는다.
 */
const clocks = new Map()

/** 재생 시작 시 등록 — 반환 함수로 해제(같은 객체일 때만 지운다: 재마운트 경합 방지). */
export function registerAudioClock(elementId, audio) {
  if (!elementId || !audio) return () => {}
  clocks.set(elementId, audio)
  return () => { if (clocks.get(elementId) === audio) clocks.delete(elementId) }
}

/** 등록된 Audio 객체(없으면 null). */
export function getAudioClock(elementId) {
  return clocks.get(elementId) || null
}
