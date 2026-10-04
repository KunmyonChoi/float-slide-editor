import { useAiJobStore } from '../store/aiJobStore'
import { useFlatStore } from '../store/flatStore'
import { BlobStore } from './BlobStore'
import { nextFlatId } from './FlatExtractor'
import { chat, hasApiKey } from './OpenAIClient'
import { isLocalLlmEnabled } from './LlmBackendClient'
import { DEFAULT_VIZ } from './audioViz'
import { DEFAULT_LYRIC_OFFSET, lyricLinkChanges } from './lyricSync'
import { createMusicJob, waitMusicJob, fetchMusicAudio, cancelMusicJob } from './MusicBackendClient'

/**
 * musicJobRunner — 텍스트 박스 내용을 지시문으로 음악을 생성해 오디오 요소로 넣는다.
 * (imageJobRunner와 같은 패턴: 전역 aiJobStore로 넘겨 생성 중에도 편집을 계속하고,
 *  결과는 트레이에서 듣고 적용한다.)
 *
 * 모드
 *  - 'instrumental': 텍스트 = 음악 설명. YuE2가 악보를 쓰고 연주곡으로 렌더링(BGM).
 *  - 'song':         텍스트 = 가사, 별도 입력 = 스타일.
 */

// 진행 중 작업 기록 — 생성이 10분 넘게 걸려 그사이 새로고침·탭 종료가 흔하다. 서버가 결과를 들고
// 있으므로 서버 작업 id만 남겨 두면 다시 열었을 때 이어서 받을 수 있다(lipsyncRecovery와 같은 취지).
const PENDING_KEY = 'music-pending-jobs'
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000
function readPending() {
  try {
    const arr = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]')
    return Array.isArray(arr) ? arr.filter(e => e?.serverId && Date.now() - (e.createdAt || 0) < PENDING_MAX_AGE_MS) : []
  } catch { return [] }
}
function writePending(arr) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(arr)) } catch { /* 저장 불가 — 복구만 못 할 뿐 */ }
}
const savePending = (entry) => writePending([...readPending().filter(e => e.serverId !== entry.serverId), entry])
const removePending = (serverId) => writePending(readPending().filter(e => e.serverId !== serverId))

// 기록은 '결과를 다 쓴 뒤'에 지운다 — 적용됐거나 트레이에서 닫혔을 때. 완료(ready) 직후 지우면
// 적용 전에 새로고침한 결과를 잃는다.
useAiJobStore.subscribe((state, prev) => {
  for (const job of prev.jobs) {
    if (job.kind !== 'music-gen' || !job.serverId) continue
    const now = state.jobs.find(x => x.id === job.id)
    if (!now || now.status === 'applied' || now.status === 'cancelled') removePending(job.serverId)
  }
})

// 서버(music-server/engine.py MAX_SECONDS)가 악보를 이 길이 안으로 자른다 — 둘을 함께 바꿀 것.
export const MUSIC_LENGTHS = [
  { id: 'short', label: '짧게', hint: '최대 약 1분 15초' },
  { id: 'medium', label: '보통', hint: '최대 약 2분' },
  { id: 'long', label: '길게', hint: '최대 약 3분 20초' },
]

/** 스타일 다듬기에 쓸 텍스트 모델이 있는가(OpenAI 키 또는 로컬 LLM). */
export function canRefineStyle() {
  return hasApiKey() || isLocalLlmEnabled()
}

const STYLE_SYSTEM = `You write the style prompt ("tags") for the YuE2 music generation model.
Turn the user's description (any language) into ONE line of concise English, comma-separated:
genre, mood, main instruments, rhythm/drums, tempo as "<number> BPM", optional key.
Rules:
- Output only the line. No quotes, no explanations, at most 45 words.
- Keep concrete musical intent from the description; infer sensible defaults when vague.
- INSTRUMENTAL mode: start with "Instrumental", and never mention singers or lyrics.
- SONG mode: include the lyric language and the vocal character (e.g. "warm female vocal").`

/** 한국어 등 자유 서술 → YuE2 스타일 태그(영어 한 줄). LLM이 없거나 실패하면 원문 그대로. */
export async function refineMusicStyle(text, { mode, lyrics = '', signal } = {}) {
  const src = (text || '').trim()
  if (!src || !canRefineStyle()) return src
  try {
    const out = await chat({
      system: STYLE_SYSTEM,
      user: `Mode: ${mode === 'song' ? 'SONG' : 'INSTRUMENTAL'}\nDescription:\n"""\n${src}\n"""`
        + (mode === 'song' && lyrics ? `\nLyrics excerpt (for language only):\n"""\n${lyrics.slice(0, 300)}\n"""` : ''),
      temperature: 0.4,
      signal,
    })
    const line = String(out || '').split('\n').map(s => s.trim()).find(Boolean)
    return line ? line.replace(/^["']|["']$/g, '') : src
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return src
  }
}

/** 텍스트 박스 아래(캔버스 안으로 클램프)에 오디오 요소를 추가한다. */
async function addAudioElement(job, anchor) {
  const st = useFlatStore.getState()
  const key = job.result.key || await BlobStore.put(job.result.blob)
  const onCurrent = !job.targetPageKey || job.targetPageKey === st.getCurrentPageKey()
  const maxZ = onCurrent && st.flatElements.length ? Math.max(...st.flatElements.map(e => e.zIndex)) : 1
  const cs = st.canvasSize || { w: 1280, h: 720 }
  const w = Math.min(640, Math.round(cs.w * 0.6)), h = 160
  const live = job.targetElementId ? st.flatElements.find(e => e.id === job.targetElementId) : null
  const a = live ? { x: live.x, y: live.y + live.height + 16 } : anchor
  const el = {
    id: nextFlatId(), sourceId: null,
    type: 'audio', width: w, height: h,
    content: BlobStore.toRef(key),
    isRich: false, merged: false,
    autoplay: true, loop: true, muted: false, // BGM: 발표 시 자동재생·반복
    viz: { ...DEFAULT_VIZ },
    x: Math.round(Math.max(0, Math.min(a.x, cs.w - w))),
    y: Math.round(Math.max(0, Math.min(a.y, cs.h - h))),
    zIndex: maxZ + 1,
    styles: {
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      borderRadius: '8px', border: '0px none', boxShadow: 'none', opacity: '1', padding: '0px',
    },
  }
  if (job.result.serverId) el.musicJobId = job.result.serverId
  const ok = st.addElementToPage(job.targetPageKey, el)
  // 노래면 가사를 담은 텍스트 박스를 이 오디오에 연결 — 발표 중 재생되면 가사가 흐르며 현재 줄이 강조된다.
  const lines = job.result.lyricsTiming
  if (ok && live && Array.isArray(lines) && lines.length) {
    linkLyrics(job.targetPageKey, live.id, {
      audioId: el.id, jobId: job.result.serverId, lines,
      offset: job.result.lyricsOffset, source: job.result.lyricsSource,
    })
  }
  if (ok && onCurrent) st.setSelectedFlat(el.id)
  return ok
}

/**
 * 텍스트 박스 ↔ 오디오 요소 가사 싱크 연결.
 * source='vocal'(소리에 맞춘 타이밍)은 이미 오디오 시각이라 보정 0, 'score'(악보 기반)는 기본 보정.
 */
export function linkLyrics(pageKey, textId, { audioId, jobId = null, lines, offset, source = 'score' }) {
  const off = Number.isFinite(offset) ? offset : (source === 'vocal' ? 0 : DEFAULT_LYRIC_OFFSET)
  const st = useFlatStore.getState()
  // 현재 페이지에 없으면(다른 페이지 대상) 연결 전 넘침 값은 모른다 → 해제 시 기본(보이기)으로
  const current = st.flatElements.find(e => e.id === textId) || null
  return st.applyToElementOnPage(pageKey, textId,
    lyricLinkChanges(current, { audioId, jobId, lines, offset: off, source }))
}

/**
 * 음악 생성 작업 시작 → jobId.
 * @param {{ element, mode: 'instrumental'|'song', description: string, lyrics?: string,
 *           length?: string, refine?: boolean, pageKey?: string, now?: number }} opts
 */
export function startMusicJob({ element, mode = 'instrumental', description, lyrics = '', length = 'medium', refine = true, pageKey, now = Date.now() }) {
  const desc = (description || '').trim()
  if (!desc) throw new Error(mode === 'song' ? '스타일을 입력하세요.' : '음악 설명이 비어 있습니다.')
  if (mode === 'song' && !lyrics.trim()) throw new Error('텍스트 박스에 가사가 없습니다.')

  const meta = {
    label: mode === 'song' ? '노래 생성' : `배경음악 생성 · ${MUSIC_LENGTHS.find(l => l.id === length)?.label || length}`,
    targetPageKey: pageKey || null,
    targetElementId: element.id,
    anchor: { x: element.x, y: element.y + element.height + 16 },
    createdAt: now,
  }
  const { id, ctrl, setServerId } = registerJob(meta)

  const j = () => useAiJobStore.getState()
  ;(async () => {
    let style = desc
    if (refine && canRefineStyle()) {
      j().updateJob(id, { statusText: '스타일 프롬프트 다듬는 중… (LLM)', progress: 1 })
      style = await refineMusicStyle(desc, { mode, lyrics, signal: ctrl.signal })
    }
    j().updateJob(id, { statusText: '음악 서버에 요청 중…', progress: 2 })
    const created = await createMusicJob(
      mode === 'song' ? { mode, style, lyrics } : { mode, style, length },
      { signal: ctrl.signal },
    )
    setServerId(created.id)
    savePending({ ...meta, serverId: created.id })
    await followServerJob(id, created.id, ctrl, style)
  })().catch(e => settleError(id, e))

  return id
}

/** 트레이에 작업을 등록한다. 취소하면 서버 작업도 취소한다. */
function registerJob(meta) {
  const ctrl = new AbortController()
  let serverId = null
  const id = useAiJobStore.getState().startJob({
    kind: 'music-gen',
    label: meta.label,
    targetPageKey: meta.targetPageKey,
    targetElementId: meta.targetElementId,
    createdAt: meta.createdAt,
    abort: () => { ctrl.abort(); if (serverId) cancelMusicJob(serverId) },
    applyOptions: [{ mode: 'add', label: '오디오 요소로 추가' }],
    apply: (job) => addAudioElement(job, meta.anchor),
  })
  const setServerId = (sid) => { serverId = sid; useAiJobStore.getState().updateJob(id, { serverId: sid }) }
  return { id, ctrl, setServerId }
}

function settleError(id, e) {
  const j = useAiJobStore.getState()
  const cur = j.jobs.find(x => x.id === id)
  if (!cur || cur.status !== 'running') return
  if (e?.name === 'AbortError') j.cancelJob(id)
  else j.failJob(id, e?.message || '음악 생성에 실패했습니다.')
}

/** 서버 작업 완료까지 폴링 → 오디오를 받아 트레이에 'ready'로 올린다. 끝나면(성공·실패) 기록을 지운다. */
async function followServerJob(id, serverId, ctrl, style = '') {
  const j = () => useAiJobStore.getState()
  try {
    const done = await waitMusicJob(serverId, {
      signal: ctrl.signal,
      onUpdate: (s) => {
        const cur = j().jobs.find(x => x.id === id)
        if (cur?.status !== 'running') return
        const queued = s.status === 'queued'
        j().updateJob(id, {
          statusText: queued ? '대기 중… (앞 작업이 끝나면 시작)' : (s.stage || '생성 중…'),
          progress: Math.max(cur.progress, Math.min(99, s.progress || 0)),
        })
      },
    })
    const blob = await fetchMusicAudio(serverId, { signal: ctrl.signal })
    j().completeJob(id, {
      blob, kind: 'audio',
      seconds: done.result?.seconds, style: done.result?.style || style,
      truncated: !!done.result?.truncated, serverId,
      lyricsTiming: done.result?.lyrics_timing || null,
      lyricsOffset: done.result?.lyrics_offset,
      lyricsSource: done.result?.lyrics_source || 'score',
    })
  } catch (e) {
    // 취소가 아닌 오류(서버 재시작으로 작업이 사라짐 등)도 더 회수할 수 없으니 기록을 지운다.
    // 네트워크가 끊긴 경우(fetch TypeError)는 서버가 다시 뜨면 회수할 수 있게 남겨 둔다.
    if (!(e instanceof TypeError)) removePending(serverId)
    throw e
  }
}

let recovered = false
/**
 * 이전 세션(새로고침·탭 종료)에 서버로 보낸 음악 작업을 트레이에 다시 올려 이어서 받는다.
 * 앱 시작 시 한 번 호출(중복 호출 무시). 서버가 결과를 지웠거나 재시작됐으면 실패로 표시된다.
 * @returns {number} 복구한 작업 수
 */
export function recoverPendingMusicJobs() {
  if (recovered) return 0
  recovered = true
  const pending = readPending()
  for (const e of pending) {
    const { id, ctrl, setServerId } = registerJob({ ...e, label: `${e.label || '음악 생성'} (복구)` })
    setServerId(e.serverId)
    useAiJobStore.getState().updateJob(id, { statusText: '이전 작업 이어 받는 중…' })
    followServerJob(id, e.serverId, ctrl).catch(err => settleError(id, err))
  }
  return pending.length
}
