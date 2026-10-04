/**
 * lyricSync — 텍스트 박스 가사 싱크의 순수 로직(DOM 비의존, 테스트 가능).
 *
 * element.lyricSync = {
 *   audioId,                 // 같은 슬라이드의 오디오 요소 id(재생 시각의 출처)
 *   jobId,                   // 음악 서버 작업 id(타이밍을 다시 받을 때)
 *   lines: [{ start, end, text, section }],   // 초(music-server align.py / lyrics.py)
 *   offset,                  // 초. 타이밍 + offset = 오디오 시각. 소리 정렬(source=vocal)은 0, 악보 기반은 기본 0.4.
 *   source,                  // 'vocal'(보컬 분리 + 강제 정렬로 소리에 맞춤) | 'score'(노래를 만든 악보에서 계산)
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

/** 텍스트 요소의 평문(리치 HTML이면 태그 제거, <br>·블록은 줄바꿈). */
function plainText(el) {
  const c = String(el?.content || '')
  if (!el?.isRich) return c
  return c.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
}

/**
 * 오디오에 가사를 붙일 때 기본으로 고를 텍스트 박스 — 이미 이 오디오에 연결된 박스, 다음은
 * 구간 태그([Verse] 등)가 있는 박스, 그다음은 줄이 가장 많은 박스. 없으면 null.
 */
export function pickLyricsText(texts, audioId) {
  if (!texts?.length) return null
  const linked = texts.find(t => t.lyricSync?.audioId === audioId)
  if (linked) return linked
  const rank = (t) => {
    const s = plainText(t)
    const tagged = /^\s*\[[^\]]+\]\s*$/m.test(s) ? 1000 : 0
    return tagged + s.split('\n').filter(l => l.trim()).length
  }
  return [...texts].sort((a, b) => rank(b) - rank(a))[0]
}

/** 선택 목록에 보일 텍스트 박스 이름 — 태그가 아닌 첫 줄 앞부분. */
export function textLabel(el, max = 24) {
  const first = plainText(el).split('\n').map(l => l.trim()).find(l => l && !/^\[[^\]]+\]$/.test(l)) || '(빈 텍스트)'
  return first.length > max ? first.slice(0, max) + '…' : first
}
