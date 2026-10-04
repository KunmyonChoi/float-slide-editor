/**
 * lyricSync — 텍스트 박스 가사 싱크의 순수 로직(DOM 비의존, 테스트 가능).
 *
 * element.lyricSync = {
 *   audioId,                 // 같은 슬라이드의 오디오 요소 id(재생 시각의 출처)
 *   jobId,                   // 음악 서버 작업 id(타이밍을 다시 받을 때)
 *   lines: [{ start, end, text, section }],   // 초, 노래 악보 기준(music-server/lyrics.py)
 *   offset,                  // 초. 악보 시각 + offset = 오디오 시각. 생성 오디오는 악보보다 조금 늦게 시작한다.
 *   highlightColor?,         // 현재 줄 색(없으면 글자색)
 * }
 */

// YuE2 오디오는 악보 t=0보다 약간 늦게 시작한다(실측: 120 BPM 곡의 첫 다운비트 0.39초).
export const DEFAULT_LYRIC_OFFSET = 0.4
// 노래방처럼 부르기 직전에 줄을 미리 띄운다.
export const LYRIC_LEAD_SEC = 0.25

/**
 * 재생 시각 t(초)에 강조할 줄 인덱스. 첫 줄 전이면 -1.
 * 줄 사이(간주)에는 직전 줄을 유지한다 — 다음 줄이 시작될 때까지 화면이 흔들리지 않게.
 */
export function activeLyricIndex(lines, t, offset = DEFAULT_LYRIC_OFFSET, lead = LYRIC_LEAD_SEC) {
  if (!lines || !lines.length) return -1
  const s = t - offset + lead
  let lo = 0, hi = lines.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= s) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/**
 * 가운데 정렬 스크롤 위치(px) — 컨테이너 높이 h, 줄 i의 위쪽 top과 높이 lh일 때 줄 중심이 가운데로 오는
 * 안쪽 목록의 translateY. 첫 줄 전(i=-1)에는 첫 줄을 가운데에 둔다.
 */
export function centerTranslate(h, tops, heights, i) {
  const k = Math.max(0, Math.min(i, tops.length - 1))
  if (!tops.length) return 0
  return h / 2 - (tops[k] + heights[k] / 2)
}

/** 링크가 유효한가 — 줄이 있고 오디오 요소가 같은 슬라이드에 있다. */
export function hasLyricSync(element, elements) {
  const ls = element?.lyricSync
  if (!ls || !Array.isArray(ls.lines) || !ls.lines.length || !ls.audioId) return false
  return !elements || elements.some(e => e.id === ls.audioId && e.type === 'audio')
}
