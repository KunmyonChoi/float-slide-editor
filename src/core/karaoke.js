/**
 * karaoke — STT 단어 타임스탬프를 가라오케 자막으로 바꾸는 순수 로직 + STT 정확도 측정(WER/CER).
 * DOM에 의존하지 않아 노드/브라우저 어디서나(테스트 포함) 동일하게 동작한다.
 */

/**
 * 현재 재생 시간(t, 초)에 활성화(하이라이트)할 단어 인덱스.
 * 아직 첫 단어가 시작 전이면 -1. 그 외에는 "start ≤ t"인 마지막 단어를 계속 하이라이트한다
 * (다음 단어가 시작되기 전까지 이전 단어가 눌린 채로 남아있는 자연스러운 카라오케 느낌).
 * @param {{word:string,start:number,end:number}[]} words
 * @param {number} t
 * @returns {number}
 */
export function activeWordIndex(words, t) {
  if (!words || !words.length) return -1
  if (t < words[0].start) return -1
  let lo = 0, hi = words.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (words[mid].start <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

// 문장 종결로 보고 자막 줄을 끊을 패턴: 단어가 문장부호로 끝나는 경우.
// (한국어 종결어미(다/요) 자체는 사용하지 않는다 — "근데요", "그래요" 처럼 문장 중간에도
//  흔히 나타나 오탐이 많다. Whisper verbose_json은 대개 문장부호를 단어에 그대로 붙여 반환하므로
//  punctuation 기준이면 충분하고, 부호가 전혀 없는 구간은 아래 pauseGapSec(침묵) 기준이 보완한다.)
const SENTENCE_END_RE = /[.!?…。]$/
// 이보다 긴 침묵이 있으면(문장부호가 없어도) 새 자막 줄로 분리한다.
const DEFAULT_PAUSE_GAP_SEC = 1.0

/**
 * 단어 배열 → 화면에 함께 표시할 자막 줄(cue) 묶음.
 * 문장 종결 / 긴 침묵 / 최대 단어수 중 먼저 오는 기준으로 끊는다.
 * @param {{word:string,start:number,end:number}[]} words
 * @param {{ maxWords?: number, pauseGapSec?: number }} [opts]
 * @returns {{ start:number, end:number, text:string, words:{word:string,start:number,end:number}[], startIndex:number, endIndex:number }[]}
 */
export function groupWordsIntoCues(words, { maxWords = 10, pauseGapSec = DEFAULT_PAUSE_GAP_SEC } = {}) {
  if (!words || !words.length) return []
  const cues = []
  let cur = []
  let curStartIndex = 0

  const flush = (endIndex) => {
    if (!cur.length) return
    cues.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map(w => w.word).join(' '),
      words: cur,
      startIndex: curStartIndex,
      endIndex,
    })
    cur = []
  }

  words.forEach((w, i) => {
    const prev = cur[cur.length - 1]
    const bigGap = prev && (w.start - prev.end) > pauseGapSec
    if (bigGap) flush(i - 1)
    if (cur.length === 0) curStartIndex = i
    cur.push(w)
    if (SENTENCE_END_RE.test(w.word.trim()) || cur.length >= maxWords) flush(i)
  })
  flush(words.length - 1)
  return cues
}

/**
 * 현재 재생 시간에 해당하는 cue 인덱스(없으면 -1). 다음 cue가 시작되기 전까지 유지된다
 * (activeWordIndex와 같은 "직전 것을 유지" 규칙).
 * @param {ReturnType<typeof groupWordsIntoCues>} cues
 * @param {number} t
 */
export function cueIndexForTime(cues, t) {
  if (!cues || !cues.length) return -1
  if (t < cues[0].start) return -1
  let lo = 0, hi = cues.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

// ── STT 정확도 측정(WER/CER) ──
// 발표자 노트 원문(정답)과 STT 결과(가설)를 비교해 오류율을 낸다. TTS로 노트를 음성화한 경우
// 노트 원문이 곧 정답 텍스트이므로, "노트→TTS→STT" 왕복으로 이 함수들을 이용해 정확도를 잴 수 있다.

const PUNCT_RE = /[,.!?;:'"()[\]{}…~\-–—]/g

function normalizeForWer(text) {
  return String(text || '')
    .toLowerCase()
    .replace(PUNCT_RE, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function normalizeForCer(text, { includeSpaces = false } = {}) {
  let s = String(text || '').toLowerCase().replace(PUNCT_RE, '').trim()
  if (!includeSpaces) s = s.replace(/\s+/g, '')
  return Array.from(s) // 코드포인트 단위(서로게이트 페어 안전)
}

/** Levenshtein 편집거리 + 연산 분류(치환/삭제/삽입). ref를 hyp로 바꾸는 데 필요한 연산 기준. */
function editOps(ref, hyp) {
  const n = ref.length, m = hyp.length
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = ref[i - 1] === hyp[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  let i = n, j = m, substitutions = 0, deletions = 0, insertions = 0
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && dp[i][j] === dp[i - 1][j - 1]) { i--; j-- }
    else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { substitutions++; i--; j-- }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { deletions++; i-- }
    else { insertions++; j-- }
  }
  return { distance: dp[n][m], substitutions, deletions, insertions }
}

/**
 * 단어 오류율(Word Error Rate). reference=정답(노트 원문), hypothesis=STT 결과.
 * 대소문자·문장부호를 무시하고 공백 기준 토큰으로 비교한다.
 * @returns {{ wer:number, distance:number, refWords:number, substitutions:number, deletions:number, insertions:number }}
 */
export function wordErrorRate(reference, hypothesis) {
  const ref = normalizeForWer(reference)
  const hyp = normalizeForWer(hypothesis)
  if (!ref.length) {
    return { wer: hyp.length ? 1 : 0, distance: hyp.length, refWords: 0, substitutions: 0, deletions: 0, insertions: hyp.length }
  }
  const ops = editOps(ref, hyp)
  return { wer: ops.distance / ref.length, refWords: ref.length, ...ops }
}

/**
 * 문자 오류율(Character Error Rate). 한국어처럼 띄어쓰기가 형태소 경계와 어긋나
 * 단어 단위 비교가 불안정한 언어에서 WER보다 안정적인 보조 지표로 쓴다.
 * @param {{ includeSpaces?: boolean }} [opts]
 * @returns {{ cer:number, distance:number, refChars:number, substitutions:number, deletions:number, insertions:number }}
 */
export function charErrorRate(reference, hypothesis, opts) {
  const ref = normalizeForCer(reference, opts)
  const hyp = normalizeForCer(hypothesis, opts)
  if (!ref.length) {
    return { cer: hyp.length ? 1 : 0, distance: hyp.length, refChars: 0, substitutions: 0, deletions: 0, insertions: hyp.length }
  }
  const ops = editOps(ref, hyp)
  return { cer: ops.distance / ref.length, refChars: ref.length, ...ops }
}
