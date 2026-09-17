import { charErrorRate } from './karaoke'

/**
 * captionAlign — STT 자막을 발표자 노트 원문에 맞춰 교정한다.
 *
 * 노트 음성은 대개 노트 텍스트를 TTS로 읽힌 것이다. 그렇다면 **노트가 정답지**이고 STT 결과는
 * 그 정답지를 귀로 받아쓴 사본이다. 고유명사·숫자·영문 약어에서 오인식이 나기 쉬운데
 * (예: "Genitor" → "제니터", "API" → "에이피아이"), 정답지가 손에 있으니 다시 물어볼 필요 없이
 * 맞춰 넣으면 된다. LLM에 재차 검수를 시키는 것보다 정확하고, 공짜고, 결과가 흔들리지 않는다.
 *
 * 타임스탬프는 STT의 것을 그대로 살린다 — 가라오케 하이라이트는 시간이 생명이라
 * 글자만 정답지 것으로 바꿔 끼운다.
 *
 * 노트가 음성과 무관할 수도 있다(음성을 따로 업로드했거나, 음성을 만든 뒤 노트를 갈아엎었거나).
 * 그때 억지로 맞추면 자막이 통째로 거짓말이 되므로, 너무 다르면 교정하지 않고 STT 원본을 둔다.
 */

// 노트와 STT가 이 정도보다 더 다르면 '다른 내용'으로 보고 교정하지 않는다(문자 오류율 기준).
// 오인식이 꽤 있어도 같은 원고면 보통 0.2~0.3 아래다. 0.5는 넉넉한 안전선.
export const MAX_ALIGN_CER = 0.5
// 문자 기준만 보면 짧은 원고가 억울하게 걸린다 — "Genitor는 좋아요"를 "제니터는 좋아요"로 들으면
// 두 단어 중 하나가 통째로 어긋나 CER이 치솟는다. 그래서 단어가 절반 이상 그대로 맞으면
// (= 같은 원고를 읽은 게 거의 확실하면) 문자 기준을 넘겨도 교정한다.
export const MIN_TOKEN_MATCH = 0.5

const PUNCT_RE = /[,.!?;:'"()[\]{}…~\-–—*#>•·]/g

/** 비교용 정규화 — 대소문자·문장부호·마크다운 기호·공백 차이는 같은 말로 본다. */
function norm(token) {
  return String(token || '').toLowerCase().replace(PUNCT_RE, '').trim()
}

/**
 * 자막에 실제로 띄울 형태로 다듬는다.
 * 노트는 사람이 읽는 원고라 마크다운이 섞인다("- 항목", "**중요**"). TTS는 그 기호를 읽지 않으므로
 * 자막에도 남으면 안 된다. 말이 되는 글자가 남지 않는 토큰(불릿 기호 하나짜리)은 아예 버린다.
 */
function displayToken(token) {
  let t = String(token || '').trim()
  // 감싸기(**강조**)를 먼저 벗겨야 한다 — 불릿을 먼저 떼면 앞의 '**'만 사라져 뒤가 남는다.
  for (let i = 0; i < 2; i++) {
    const before = t
    t = t.replace(/^(\*\*|__|\*|_)(.+?)\1$/, '$2')
    t = t.replace(/^[-*+#>•·]+\s*/, '')
    if (t === before) break
  }
  return t.trim()
}

/**
 * 두 토큰열을 정렬해 연산 목록을 낸다(ref를 기준으로).
 * @returns {{op:'match'|'sub'|'del'|'ins', ri:number, hi:number}[]}
 *   match/sub = ref[ri] ↔ hyp[hi], del = ref[ri]가 hyp에 없음, ins = hyp[hi]가 ref에 없음
 */
export function alignTokens(ref, hyp) {
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
  const ops = []
  let i = n, j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      ops.push({ op: 'match', ri: i - 1, hi: j - 1 }); i--; j--
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', ri: i - 1, hi: j - 1 }); i--; j--
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ op: 'del', ri: i - 1, hi: -1 }); i--
    } else {
      ops.push({ op: 'ins', ri: -1, hi: j - 1 }); j--
    }
  }
  return ops.reverse()
}

/**
 * STT 단어들을 노트 원문에 맞춰 교정한다.
 * @param {{word:string,start:number,end:number}[]} words  STT 단어 + 타임스탬프
 * @param {string} referenceText  노트 원문(정답지)
 * @returns {{ words:object[], changed:number, applied:boolean, reason?:string }}
 */
export function alignWordsToReference(words, referenceText) {
  const src = Array.isArray(words) ? words.filter(w => w && w.word != null) : []
  const refTokens = String(referenceText || '').trim().split(/\s+/)
    .map(displayToken)
    .filter(t => t && norm(t))  // 순수 기호(불릿 등)는 말이 아니므로 자막에서 뺀다
  if (!src.length) return { words: src, changed: 0, applied: false, reason: 'no-words' }
  if (!refTokens.length) return { words: src, changed: 0, applied: false, reason: 'no-reference' }

  const ops = alignTokens(refTokens.map(norm), src.map(w => norm(w.word)))

  // 같은 원고인지 먼저 본다 — 다른 내용이면 손대지 않는다(억지로 맞추면 자막이 통째로 거짓말).
  // 문자 오류율과 '그대로 맞은 단어 비율' 중 하나라도 같은 원고라고 말하면 교정한다.
  const sttText = src.map(w => w.word).join(' ')
  const { cer } = charErrorRate(referenceText, sttText)
  const matchRatio = ops.filter(o => o.op === 'match').length / refTokens.length
  if (cer > MAX_ALIGN_CER && matchRatio < MIN_TOKEN_MATCH) {
    return { words: src, changed: 0, applied: false, reason: 'too-different', cer, matchRatio }
  }

  const out = []
  let changed = 0
  // ref에는 있는데 STT가 통째로 놓친 단어들 — 앞뒤 단어 사이 침묵을 나눠 갖는다.
  let pendingRefs = []

  const flushPending = (nextStart) => {
    if (!pendingRefs.length) return
    const prevEnd = out.length ? out[out.length - 1].end : (src[0]?.start ?? 0)
    const end = Number.isFinite(nextStart) ? Math.max(nextStart, prevEnd) : prevEnd
    const span = end - prevEnd
    const step = span > 0 ? span / pendingRefs.length : 0
    pendingRefs.forEach((token, k) => {
      out.push({ word: token, start: prevEnd + step * k, end: prevEnd + step * (k + 1) })
      changed++
    })
    pendingRefs = []
  }

  for (const { op, ri, hi } of ops) {
    if (op === 'match' || op === 'sub') {
      const w = src[hi]
      flushPending(w.start)
      const token = refTokens[ri]
      if (norm(token) !== norm(w.word) || token !== w.word) changed++
      out.push({ ...w, word: token })
    } else if (op === 'del') {
      pendingRefs.push(refTokens[ri])
    } else {
      // STT에만 있는 단어(헛들음·잡음) — 버리되, 그 시간은 앞 단어가 물려받아 흐름이 끊기지 않게.
      const w = src[hi]
      if (out.length) out[out.length - 1].end = Math.max(out[out.length - 1].end, w.end)
      changed++
    }
  }
  flushPending(src[src.length - 1]?.end)

  return { words: out, changed, applied: true, cer, matchRatio }
}

/**
 * 전사 결과 전체를 노트 원문에 맞춰 교정한다(자막 저장 직전 단계).
 * 교정하지 않기로 한 경우엔 입력을 그대로 돌려준다 — 호출부가 분기할 필요가 없다.
 * @param {{text:string, words:object[]}} transcript
 * @param {string} notes  발표자 노트 원문
 */
export function correctTranscriptWithNotes(transcript, notes) {
  if (!transcript?.words?.length) return transcript
  const { words, changed, applied, reason } = alignWordsToReference(transcript.words, notes)
  if (!applied) return { ...transcript, notesAligned: false, notesAlignSkipped: reason }
  return {
    ...transcript,
    words,
    text: words.map(w => w.word).join(' '),
    notesAligned: true,      // 이미 교정됨 — 다시 열어도 또 돌리지 않는다
    notesAlignChanged: changed,
  }
}
